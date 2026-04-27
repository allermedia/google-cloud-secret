# AGENTS.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm t` / `npm test` — runs Mocha (mocha-cakes-2 BDD UI) and on success also runs `lint` and `build` via `posttest`.
- `npm run lint` — `eslint . --cache` followed by `prettier . -c`.
- `npm run build` — `rollup -c` (ESM → CJS in `lib/`) then `dts-buddy` (regenerates `types/index.d.ts`).
- `npm run cov:html` / `npm run test:lcov` — coverage via `c8` (excludes `src/fake-server`).
- Run a single test file: `npx mocha test/features/secrets-cache-feature.js`. Filter by name: `npx mocha -g 'pattern'`. Bail on first failure: `npx mocha -b`.
- gRPC-level debug: `GRPC_TRACE=all GRPC_VERBOSITY=DEBUG npx mocha -b`. Library debug: `DEBUG=aller:google-cloud-secret*`.

## One-time test setup (required)

The fake gRPC server requires real TLS certs. Tests will fail to start without them:

```sh
brew install mkcert && mkcert -install
mkdir -p ./tmp/mkcert
mkcert -key-file ./tmp/mkcert/dev-key.pem -cert-file ./tmp/mkcert/dev-cert.pem localhost
```

CI does the equivalent in `.github/workflows/build.yaml`. Node `>=22` is required (`.nvmrc` pins 22).

## Architecture

This is a small library (`@aller/google-cloud-secret`) wrapping `@google-cloud/secret-manager` with two public surfaces, both defined in `src/index.js`:

- **`ConcurrentSecret`** — optimistic concurrency for "rotate this secret" workflows. Locking is _not_ a real lock: `lock()` writes a `locked_at` annotation using the current etag; if another writer raced and won, gRPC returns `FAILED_PRECONDITION` (code 9). `gracePeriodMs` (default 60s) lets a stale lock be broken. `optimisticUpdate(fn)` calls `fn`, adds a new version, **destroys the previous version**, then unlocks by clearing the annotation. Because old versions are destroyed, **don't seed an initial version via Terraform** — Terraform will keep recreating it (see README "Not recommended" block).
- **`SecretsCache` / `CachedSecret`** — `lru-cache` wrapper whose `fetchMethod` delegates to `CachedSecret.update()`. `CachedSecret` extends `ConcurrentSecret` and decides per call whether to use the cached value, refresh from the latest version, or call `optimisticUpdate` to mint a new one. `set(name, undefined, fn)` triggers an immediate `forceRefresh` fetch.

Both classes either accept an existing `SecretManagerServiceClient` or construct one from `ClientOptions`. The instance is exposed as `.client` so callers who passed options can `.close()` it.

`callOptions` (object or factory function) is forwarded to `updateSecret`, `addSecretVersion`, and `accessSecretVersion` as gax call options — that's how callers inject gRPC headers (e.g. `traceparent`).

### Build pipeline

Source is ESM in `src/`. Rollup reads `package.json#exports` and emits a `.cjs` per export into `lib/`. Each export's `output.footer` is `module.exports = Object.assign(exports.default, exports);` — this is what makes `require('@aller/google-cloud-secret')` return both the default export _and_ named exports. `external` is derived from `peerDependencies` so peer deps stay un-bundled. `dts-buddy` then bundles `.d.ts` files into `types/index.d.ts`. The published artifacts are `lib/`, `src/`, and `types/index.d*` (see `files` in `package.json`); `lib/` is gitignored and built on `prepublishOnly`.

### Fake gRPC server

`src/fake-server/fake-secret-manager-server.js` is an in-memory gRPC implementation of the Secret Manager API used both by this repo's tests and re-exported as a public entry (`@aller/google-cloud-secret/fake-server/fake-secret-manager-server`) for downstream consumers. It enforces real etag semantics (mismatch → `FAILED_PRECONDITION`) — that's what makes the concurrency tests meaningful. State lives in a module-level `Map`; tests must call `reset()` in an `after` hook. `c8` excludes this directory from coverage.

## Testing conventions

- BDD style via `mocha-cakes-2`: `Feature` / `Scenario` / `Given` / `When` / `Then` / `And` are globals (configured in `eslint.config.js`). Files live in `test/features/`.
- Tests run against the real fake gRPC server in-process; they do **not** mock `@google-cloud/secret-manager`. `nock` is enabled but `enableNetConnect(/127\.0\.0\.1|localhost/)` allows the local gRPC traffic.
- `chronokinesis` (`ck.freeze()` / `ck.reset()`) is used to control time for grace-period and TTL assertions — always pair `freeze` with a `reset` in `after`.
- `test/helpers/fake-auth.js` short-circuits the Google auth client so tests don't hit real auth (much faster).
- `setup.js` polyfills `globalThis.performance.now` to `Date.now()` so `lru-cache` TTLs respect mocked time.

## Style

- Prettier: 2-space, 140 cols, single quotes, ES5 trailing commas. ESLint enforces import ordering (`builtin → external → internal → parent → sibling`, alphabetized, blank line between groups) — keep new imports compliant or `npm t` will fail in `posttest`.

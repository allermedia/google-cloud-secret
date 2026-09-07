# AGENTS.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm t` / `npm test` — runs Mocha (mocha-cakes-2 BDD UI) and on success also runs `lint`, `build`, `test:types` and `test:md` via `posttest`.
- `npm run lint` — `eslint . --cache` followed by `prettier . -c`.
- `npm run build` — `dts-buddy` (regenerates `types/index.d.ts`) then the README TOC check.
- `npm run test:types` — `tsc -p . && tsc -p test` (type-checks src and tests; BDD globals declared in `test/global.d.ts`).
- `npm run cov:html` / `npm run test:lcov` — coverage via `c8`, the emulator is included.
- Run a single test file: `npx mocha test/features/secrets-cache-feature.js`. Filter by name: `npx mocha -g 'pattern'`. Bail on first failure: `npx mocha -b`.
- gRPC-level debug: `GRPC_TRACE=all GRPC_VERBOSITY=DEBUG npx mocha -b`. Library debug: `DEBUG=aller:google-cloud-secret*`.

## Test setup

No setup needed beyond `npm i` — the gRPC emulator runs without TLS by default and clients connect with `sslCreds: grpc.credentials.createInsecure()`. TLS is opt-in via `startServer({ cert })` (mkcert instructions in the README). Node `>=22` is required (`.nvmrc` pins 22).

## Architecture

This is a small library (`@aller/google-cloud-secret`) wrapping `@google-cloud/secret-manager` with two public surfaces, both defined in `src/index.js`:

- **`ConcurrentSecret`** — optimistic concurrency for "rotate this secret" workflows. Locking is _not_ a real lock: `lock()` writes a `locked_at` annotation using the current etag; if another writer raced and won, gRPC returns `FAILED_PRECONDITION` (code 9). `gracePeriodMs` (default 60s) lets a stale lock be broken. `optimisticUpdate(fn)` calls `fn`, adds a new version, **destroys the previous version**, then unlocks by clearing the annotation. Because old versions are destroyed, **don't seed an initial version via Terraform** — Terraform will keep recreating it (see README "Not recommended" block).
- **`SecretsCache` / `CachedSecret`** — `lru-cache` wrapper whose `fetchMethod` delegates to `CachedSecret.update()`. `CachedSecret` extends `ConcurrentSecret` and decides per call whether to use the cached value, refresh from the latest version, or call `optimisticUpdate` to mint a new one. `set(name, undefined, fn)` triggers an immediate `forceRefresh` fetch.

Both classes either accept an existing `SecretManagerServiceClient` or construct one from `ClientOptions`. The instance is exposed as `.client` so callers who passed options can `.close()` it.

`callOptions` (object or factory function) is forwarded to `updateSecret`, `addSecretVersion`, and `accessSecretVersion` as gax call options — that's how callers inject gRPC headers (e.g. `traceparent`).

### Build pipeline

The package is ESM only (Node `>=22`), published straight from `src/` with no bundling step — named exports only, no default exports. `dts-buddy` bundles `.d.ts` files into `types/index.d.ts`. The published artifacts are `src/` and `types/index.d*` (see `files` in `package.json`).

### gRPC emulator

`src/emulator/index.js` is an in-memory gRPC emulator of the Secret Manager API used both by this repo's tests and re-exported as a public entry (`@aller/google-cloud-secret/emulator`) for downstream consumers. It enforces real etag semantics (mismatch → `FAILED_PRECONDITION`) — that's what makes the concurrency tests meaningful. State lives in a per-server `Map` (exposed as `server.secrets`, optionally prefilled via `startServer({ secrets })`); inspect with `server.getSecret(name)`, clear with `server.reset()`. Servers bind port 0 by default and report the OS-assigned port via `server.origin.port`. Its error paths are covered by `test/emulator-test.js`.

## Testing conventions

- BDD style via `mocha-cakes-2`: `Feature` / `Scenario` / `Given` / `When` / `Then` / `And` are globals (configured in `eslint.config.js`). Files live in `test/features/`.
- Tests run against the real gRPC emulator in-process; they do **not** mock `@google-cloud/secret-manager`. `nock` is enabled but `enableNetConnect(/127\.0\.0\.1|localhost/)` allows the local gRPC traffic.
- `chronokinesis` (`ck.freeze()` / `ck.reset()`) is used to control time for grace-period and TTL assertions — always pair `freeze` with a `reset` in `after`.
- `test/helpers/fake-auth.js` short-circuits the Google auth client so tests don't hit real auth (much faster).
- `setup.js` polyfills `globalThis.performance.now` to `Date.now()` so `lru-cache` TTLs respect mocked time.

## Style

- Prettier: 2-space, 140 cols, single quotes, ES5 trailing commas. ESLint enforces import ordering (`builtin → external → internal → parent → sibling`, alphabetized, blank line between groups) — keep new imports compliant or `npm t` will fail in `posttest`.

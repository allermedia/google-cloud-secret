# CHANGELOG

## v2.0.0 - 2026-07-28

### Breaking

- package is ESM only, the rollup CJS build and the `lib/` artifact are dropped. Requires node `>=22`
- default exports are removed, use the named exports `ConcurrentSecret` and `startServer`
- fake server state is now kept per server instance instead of in a module-level map
  - module exports `reset()` and `getSecret(name)` are removed, use `server.reset()` and `server.getSecret(name)` on the started server
  - the backing store is exposed as `server.secrets` and a prefilled store can be passed with `startServer({ secrets })`
  - the fake service implementation is exported as `FakeSecretManager` for custom composition
- fake server `startServer` defaults to port 0, letting the OS assign a free port, instead of a random port in the narrow 50000-50999 range that could collide between concurrent servers. An explicit `port` option still works

### Additions

- `startServer` accepts a `credentials` option with server credentials, taking precedence over `cert`
- fake server defaults to insecure credentials when neither `cert` nor `credentials` is given — connect the client with `sslCreds: grpc.credentials.createInsecure()`. No more mkcert/TLS requirement to run tests, TLS is opt-in via `cert`
- type-check src and tests with `npm run test:types` in `posttest`

### Fixes

- `callOptions` option type union had a precedence bug hiding the plain object form, now `(() => CallOptions) | CallOptions`
- `updateMethod` and `optimisticUpdate` function types accept sync return values, which always worked at runtime

- fake server resolves google protos with `createRequire` from its own location instead of cwd-relative `./node_modules` paths, making the published fake-server entry work regardless of cwd and package manager layout
- fake server `ListSecretVersions` for a non-existing secret responds with `NOT_FOUND` instead of crashing on a typo
- fake server `DisableSecretVersion` for a non-existing version responds with `NOT_FOUND` instead of crashing

## v1.0.5 - 2026-03-07

- tsconfig modification resulted in tiny update of type declarations
- remove nocking google-apis token in tests, redundant since fake auth does the trick
- implement fake server delete secret

## v1.0.4 - 2025-11-12

- publish package with github actions

## v1.0.3 - 2025-11-04

- add `has` method to secrets cache

## v1.0.2 - 2025-11-04

- what if your secret is not in cache? How about an attempt to get it from gcp!? Good idea, done!
- mitigate possible race conditions by checking for new secret version before updating secret
- add `clone` method to cached secret to facilitate passing along original options

### Breaking

- cached secret constructor signature changed

## v0.1.1 - 2025-09-08

- introduce rudimentary secrets cache with `new SecretsCache(client)`
- update README with IAM policy example that actually works

## v0.1.0 - 2025-08-26

### Breaking

- change signature to `ConcurrentSecret(name[, client, options])` from `ConcurrentSecret(name[, client, gracePeriodMs])`. Grace period is moved to new fancy options object

### Fixes

- accept gax callOptions option as either object or function
- implement some [debug](https://www.npmjs.com/package/debug) logging with `DEBUG=aller:google-cloud-secret*`
- update README with IAM policy example

## v0.0.4 - 2025-08-22

- the only version at the moment since all previous versions has disappeared from npm, we have seen alot in this business but this was new

## ~~v0.0.3 - 2025-08-21~~

- fake secret server trows on invalid secret resource name
- fake secret server accepts updating secret property to nothing

## ~~v0.0.2 - 2025-08-20~~

- add method to get latest secret data, returns actual secret
- consequently `AccessSecretVersion` is implemented in fake server, but without [CRC-32C (Castagnoli)](https://en.wikipedia.org/wiki/Cyclic_redundancy_check) hash

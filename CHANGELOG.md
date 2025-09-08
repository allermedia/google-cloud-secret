# CHANGELOG

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

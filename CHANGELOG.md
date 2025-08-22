# CHANGELOG

## v0.0.4 - 2025-08-22

- the only version at the moment since all previous versions has disappeared from npm, we have seen alot in this business but this was new

## ~~v0.0.3 - 2025-08-21~~

- fake secret server trows on invalid secret resource name
- fake secret server accepts updating secret property to nothing

## ~~v0.0.2 - 2025-08-20~~

- add method to get latest secret data, returns actual secret
- consequently `AccessSecretVersion` is implemented in fake server, but without [CRC-32C (Castagnoli)](https://en.wikipedia.org/wiki/Cyclic_redundancy_check) hash

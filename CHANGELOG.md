# CHANGELOG

## v0.0.2 - 2025-08-20

- add method to get latest secret data, returns actual secret
- consequently `AccessSecretVersion` is implemented in fake server, but without [CRC-32C (Castagnoli)](https://en.wikipedia.org/wiki/Cyclic_redundancy_check) hash

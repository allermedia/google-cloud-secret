# @aller/google-cloud-secret

Concurrent update of google cloud secret. No rocket science, just rely on secret etag to give a hint if secret has been locked by someone else.

## Example

```javascript
import { ConcurrentSecret } from '@aller/google-secret';

const concurrentSecret = new ConcurrentSecret('projects/1234567/secrets/my-concurrent-secret-1');

await concurrentSecret.optimisticUpdate(async () => {
  const newSecretValue = await fetchFreshSecret();
  return newSecretValue;
});

function fetchFreshSecret() {
  return new Promise((resolve) => {
    setImmediate(() => {
      return resolve('fresh-secret-version-2');
    });
  });
}
```

## Testing

Tests are ran against a fake grpc Secret Manager server. Package `@google-cloud/secret-manager` requires TLS so certs has to be created.

### Make certificates with mkcert ca

To add mkcert ca run this command once:

```sh
brew install mkcert
mkcert -install
```

Generate certificates

```sh
md -p ./tmp/mkcert
mkcert -key-file ./tmp/mkcert/dev-key.pem -cert-file ./tmp/mkcert/dev-cert.pem localhost
```

### Run tests

```sh
npm i
npm t
```

### Run with gRPC DEBUG

```sh
GRPC_TRACE=all GRPC_VERBOSITY=DEBUG mocha -b
```

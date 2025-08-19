# @aller/google-cloud-secret

Concurrent safe update of google cloud secret. No rocket science, just rely on secret etag to give a hint if secret has been locked by someone else.

[![Build](https://github.com/allermedia/google-secret/actions/workflows/build.yaml/badge.svg)](https://github.com/allermedia/google-secret/actions/workflows/build.yaml)

- [Api](#api)
- [Fake google secret manager server](#fake-google-secret-manager-server)

## Api

### `new ConcurrentSecret(name[, clientOrClientOptions, gracePeriodMs])`

**Arguments:**

- `name`: secret resource name in format `projects/{project number}/secrets/{secret name}`
- `clientOrClientOptions`: optional [`@google-cloud/secret-manager`](https://www.npmjs.com/package/@google-cloud/secret-manager) secret manager client or options to pass to secret manager client
- `gracePeriodMs`: optional lock grace period in milliseconds, continue if secret is locked beyond grace period, defaults to 60000

**Properties**:

- `client`: [`@google-cloud/secret-manager`](https://www.npmjs.com/package/@google-cloud/secret-manager) secret manager client
  can be closed if created with client options

#### `concurrentSecret.optimisticUpdate(fn, ...args)`

Update secret with new version.

**Arguments:**

- `fn`: function to be called if lock succeeds, must return string of buffer
- `...args`: optional arguments passed to `fn`

**Returns:**

Result from `fn(...args)`.

Throws if lock or fn fails. If lock fails inspect `error.code`.

**Common failure gRPC codes:**

- 9: `FAILED_PRECONDITION` on etag mismatch

#### Example

```javascript
import { ConcurrentSecret } from '@aller/google-cloud-secret';

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

### Fake google secret manager server

The package ships with a fake google secret manager gRPC server to facilitate testing your library.

To prepare for running fake server follow [make certs](#make-certificates-with-mkcert-ca) before starting.

```javascript
import { randomInt } from 'node:crypto';
import fs from 'node:fs';

import secretManager from '@google-cloud/secret-manager';
import * as ck from 'chronokinesis';
import nock from 'nock';

import { ConcurrentSecret } from '@aller/google-cloud-secret';

import { startServer, reset } from '@aller/google-cloud-secret/fake-server/fake-secret-manager-server';

describe('concurrent secret', () => {
  before(() => {
    nock('https://oauth2.googleapis.com')
      .post('/token', (body) => {
        return body.target_audience ? new URL(body.target_audience) : true;
      })
      .query(true)
      .reply(200, { id_token: 'google-auth-id-token' })
      .persist();
  });
  after(nock.cleanAll);

  let server;
  let client;
  before('grpc server', async () => {
    server = await startServer({
      cert: [
        {
          private_key: fs.readFileSync('./tmp/mkcert/dev-key.pem'),
          cert_chain: fs.readFileSync('./tmp/mkcert/dev-cert.pem'),
        },
      ],
    });
    client = new secretManager.v1.SecretManagerServiceClient({
      apiEndpoint: 'localhost',
      port: server.origin.port,
    });
  });
  after(async () => {
    client = await client.close();
    server = server?.forceShutdown();
    reset();
  });
  after(ck.reset);

  describe('getLatestVersion(throwOnNotFound)', () => {
    it('getLatestVersion() null if not found', async () => {
      const secretId = `my-secret-${randomInt(10000)}`;

      await client.createSecret({
        parent: 'projects/1234',
        secretId,
        secret: { versionDestroyTtl: { seconds: 86400, nanos: 0 }, replication: { automatic: {} }, annotations: { foo: 'bar' } },
      });

      const concurrentSecret = new ConcurrentSecret(`projects/1234/secrets/${secretId}`, client);
      expect(await concurrentSecret.getLatestVersion()).to.be.null;
    });
  });
});
```

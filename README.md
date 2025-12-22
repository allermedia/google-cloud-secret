# @aller/google-cloud-secret

Concurrent safe update of google cloud secret. No rocket science, just rely on secret etag to give a hint if secret has been locked by someone else.

[![Build](https://github.com/allermedia/google-secret/actions/workflows/build.yaml/badge.svg)](https://github.com/allermedia/google-secret/actions/workflows/build.yaml)

- [Api](#api)
  - [Concurrent secret](#new-concurrentsecretname-clientorclientoptions-options)
  - [Secret cache](#new-secretscacheclientorclientoptions-cacheoptions)
- [IAM policy](#iam-policy)
- [Fake google secret manager server](#fake-google-secret-manager-server)
- [Debug](#debug)

## Api

### `new ConcurrentSecret(name[, clientOrClientOptions, options])`

Secret that manages concurrent updates hopefully adding only one new version.

**Arguments:**

- `name`: secret resource name in format `projects/{project number}/secrets/{secret name}`
- `clientOrClientOptions`: optional [`@google-cloud/secret-manager`](https://www.npmjs.com/package/@google-cloud/secret-manager) client or options to pass to secret manager client
- `options`: optional options
  - `gracePeriodMs`: optional lock grace period in milliseconds, continue if secret is locked beyond grace period, defaults to 60000
  - [`callOptions`](#call-options): optional call options as object or function to pass on update requests

**Properties**:

- `client`: [`@google-cloud/secret-manager`](https://www.npmjs.com/package/@google-cloud/secret-manager) client
  can be closed if created with client options

#### `concurrentSecret.optimisticUpdate(fn, ...args)`

Update secret with new version. Destroy the previous version on successful update.

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

### `concurrentSecret.getLatestData()`

Get latest version secret data.

**Returns:**

- `name`: secret version name
- `payload`:
  - `data`: buffer with actual secret

### `new SecretsCache([clientOrClientOptions, cacheOptions])`

Rough secrets cache that rely on secrets persisted in Google Cloud Secret Manager. The caching functionality is provided by [`lru-cache`](https://www.npmjs.com/package/lru-cache).

**Arguments:**

- `clientOrClientOptions`: optional [`@google-cloud/secret-manager`](https://www.npmjs.com/package/@google-cloud/secret-manager) client or options to pass to secret manager client
- `cacheOptions`: [`lru-cache`](https://www.npmjs.com/package/lru-cache) options, `fetchMethod` excluded

**Properties:**

- `client`: [`@google-cloud/secret-manager`](https://www.npmjs.com/package/@google-cloud/secret-manager) client
  can be closed if created with client options
- `cache`: [`lru-cache`](https://www.npmjs.com/package/lru-cache) caching provider

#### Example

```javascript
import { randomUUID } from 'node:crypto';

import { SecretsCache } from '@aller/google-cloud-secret';
import secretManager from '@google-cloud/secret-manager';

const client = new secretManager.v1.SecretManagerServiceClient();

const secretsCache = new SecretsCache(client, { max: 100 });

const secretName = 'projects/1234567/secrets/my-concurrent-secret-1';

// initiate new cached secret without initial value and a function to set new secret value
secretsCache.set(secretName, undefined, (fetcherOptions) => {
  fetcherOptions.options.ttl = 1000 * 60 * 5; // set cache ttl to 5 minutes
  return randomUUID();
});

// get secret value from google secret manager
await secretsCache.get(secretName); // .value should be undefined

// first update should fetch latest version value since initial value is missing
await secretsCache.update(secretName);

// second update should create a new secret version with a uuid
await secretsCache.update(secretName);
```

#### `secretsCache.set(name[, initialValue, updateMethod, options])`

Set cached secret.

**Arguments:**

- `name`: secret name, see [`ConcurrentSecret`](#new-concurrentsecretname-clientorclientoptions-options)
- `initialValue`: optional string, initial secret data value
- [`updateMethod`](#concurrentsecretoptimisticupdatefn-args): optional function to create new secret value
- [`options`](#concurrentsecretoptimisticupdatefn-args): optional options object, see [`ConcurrentSecret`](#new-concurrentsecretname-clientorclientoptions-options) options

#### `async secretsCache.get(name)`

Get cached secret.

**Arguments:**

- `name`: secret name

**Returns:**

- cached secret instance
  - `value`: string with secret version data

#### `async secretsCache.update(name)`

Update cached concurrent secret with new version by calling [`concurrentSecret.optimisticUpdate`](#concurrentsecretoptimisticupdatefn-args) with [`updateMethod`](#secretscachesetname-initialvalue-updateMethod-options).

**Arguments:**

- `name`: secret name

**Returns:**

- cached secret instance
  - `value`: string with updated secret version data

#### `secretsCache.has(name)`

Underlying LRUCache has secret.

**Arguments:**

- `name`: secret name

**Returns:**

Boolean indicating if secret is in cache.

## IAM Policy

The service account for cloud run or function needs access to update the secret and add versions.

Terraform example:

```t
# Define an IAM policy to allow accounts to administer secret
data "google_iam_policy" "secret_admin_policy" {
  binding {
    role = "roles/secretmanager.admin"
    members = [
      "serviceAccount:${google_service_account.default.email}",
      "serviceAccount:${google_service_account.functions.email}",
    ]
  }
}

# Create secret
resource "google_secret_manager_secret" "rotated_by_app_secret" {
  secret_id           = "app-rotating-token"
  version_destroy_ttl = "86400s"
  replication {
    auto {}
  }
}

# Add IAM policy to secret
resource "google_secret_manager_secret_iam_policy" "rotated_by_app_secret_policy" {
  secret_id   = google_secret_manager_secret.rotated_by_app_secret.secret_id
  policy_data = data.google_iam_policy.secret_admin_policy.policy_data
}

## Not recommended: Adding an inital version to be able to address it as latest
##                  will not work when the version is eventually destroyed by this package.
##                  Terraform will attempt to recreate the secret version which is unintended.
# resource "google_secret_manager_secret_version" "rotated_by_app_secret_first_version" {
#   secret          = google_secret_manager_secret.rotated_by_app_secret.id
#   secret_data     = "dummy-data"
#   deletion_policy = "DISABLE"
#
#   # Ignore if the secret version is disabled
#   lifecycle {
#     ignore_changes = [
#       enabled,
#     ]
#   }
# }
```

## Testing

Tests are ran against a fake grpc Secret Manager server. Package `@google-cloud/secret-manager` requires TLS so a cert has to be created.

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
      .reply(200, { id_token: 'google-auth-id-token', access_token: 'google-auth-access-token' })
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
      // Faking auth client makes test run faster
      auth: {
        getUniverseDomain() {
          return 'googleapis.com';
        },
        getClient() {
          return {
            getRequestHeaders() {
              return new Map();
            },
          };
        },
      },
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

## Call options

[Gax](https://github.com/googleapis/gax-nodejs) call options that can be passed as options object or as a function returning the same. Used in update secret and add secret version calls.

How to set grpc headers:

```javascript
import { randomBytes } from 'node:crypto';

import { ConcurrentSecret } from '@aller/google-cloud-secret';

const concurrentSecret = new ConcurrentSecret('projects/1234567/secrets/my-concurrent-secret-2', null, {
  callOptions() {
    return {
      otherArgs: {
        headers: {
          traceparent: `00-${randomBytes(16).toString('hex')}-${randomBytes(8).toString('hex')}-00`,
        },
      },
    };
  },
});
```

We have attempted to pass opentelemetry tracing header `traceparent` as well as the legacy `x-cloud-trace-context` expecting tracing to be represented in the secret audit log. To no avail. Both tracing headers are ignored. But with more extensive testing it may work...

## Debug

Run with environment parameter `DEBUG=aller:google-cloud-secret*`

### Run with gRPC DEBUG

```sh
GRPC_TRACE=all GRPC_VERBOSITY=DEBUG mocha -b
```

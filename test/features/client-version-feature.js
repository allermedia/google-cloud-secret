import { randomInt } from 'node:crypto';
import path from 'node:path/posix';

import { ConcurrentSecret } from '@aller/google-cloud-secret';
import { startServer } from '@aller/google-cloud-secret/emulator';
import secretManager from '@google-cloud/secret-manager';
import * as grpc from '@grpc/grpc-js';

import { fakeAuth } from '../helpers/fake-auth.js';

Feature('client versions', () => {
  const secretId = `my-secret-${randomInt(10000)}`;
  const parent = 'projects/1234';
  const secretName = path.join(parent, 'secrets', secretId);

  /** @type {Awaited<ReturnType<typeof startServer>>} */
  let server;
  before('grpc server and a secret', async () => {
    server = await startServer();

    const client = new secretManager.v1.SecretManagerServiceClient({
      apiEndpoint: 'localhost',
      sslCreds: grpc.credentials.createInsecure(),
      port: server.origin.port,
      auth: fakeAuth(),
    });

    await client.createSecret({
      parent: 'projects/1234',
      secretId,
      secret: { versionDestroyTtl: { seconds: 86400, nanos: 0 }, replication: { automatic: {} }, annotations: { foo: 'bar' } },
    });
  });
  after(() => {
    server?.forceShutdown();
  });

  Scenario('v1 client is used to update secret', () => {
    /** @type {import('@google-cloud/secret-manager').SecretManagerServiceClient} */
    let client;
    before('grpc client', () => {
      client = new secretManager.v1.SecretManagerServiceClient({
        apiEndpoint: 'localhost',
        sslCreds: grpc.credentials.createInsecure(),
        port: server.origin.port,
        auth: fakeAuth(),
      });
    });
    after(async () => {
      await client.close();
    });

    /** @type {ConcurrentSecret} */
    let concurrentSecret;
    Given('a concurrent secret initiated', () => {
      concurrentSecret = new ConcurrentSecret(secretName, client, {
        callOptions() {
          return {
            otherArgs: {
              headers: {
                traceparent: '00-traceid1-spanid-00',
              },
            },
          };
        },
      });
    });

    When('updating concurrent secret', () => {
      return concurrentSecret.optimisticUpdate(() => {
        return Buffer.from('version-2');
      });
    });

    Then('the request was made with call options headers', async () => {
      expect((await concurrentSecret.getLatestData()).payload.data.toString()).to.equal('version-2');
    });
  });

  Scenario.skip('v1beta1 client is used to update secret', () => {
    /** @type {import('@google-cloud/secret-manager').SecretManagerServiceClient} */
    let client;
    before('grpc server', () => {
      // @ts-ignore deprecated v1beta1 surface exists at runtime but not in the package types
      client = new secretManager.v1beta1.SecretManagerServiceClient({
        apiEndpoint: 'localhost',
        sslCreds: grpc.credentials.createInsecure(),
        port: server.origin.port,
      });
    });
    after(async () => {
      await client.close();
    });

    /** @type {ConcurrentSecret} */
    let concurrentSecret;
    Given('a concurrent secret initiated', () => {
      concurrentSecret = new ConcurrentSecret(secretName, client, {
        callOptions() {
          return {
            otherArgs: {
              headers: {
                traceparent: '00-traceid1-spanid-00',
              },
            },
          };
        },
      });
    });

    When('updating concurrent secret', () => {
      return concurrentSecret.optimisticUpdate(() => {
        return Buffer.from('version-2');
      });
    });

    Then('the request was made with call options headers', async () => {
      expect((await concurrentSecret.getLatestData()).payload.data.toString()).to.equal('version-2');
    });
  });

  Scenario.skip('v1beta2 client is used to update secret', () => {
    /** @type {import('@google-cloud/secret-manager').SecretManagerServiceClient} */
    let client;
    before('grpc server', () => {
      // @ts-ignore v1beta2 client lacks a few v1 methods but satisfies the used surface
      client = new secretManager.v1beta2.SecretManagerServiceClient({
        apiEndpoint: 'localhost',
        sslCreds: grpc.credentials.createInsecure(),
        port: server.origin.port,
      });
    });
    after(async () => {
      await client.close();
    });

    /** @type {ConcurrentSecret} */
    let concurrentSecret;
    Given('a concurrent secret initiated', () => {
      concurrentSecret = new ConcurrentSecret(secretName, client, {
        callOptions() {
          return {
            otherArgs: {
              headers: {
                traceparent: '00-traceid1-spanid-00',
              },
            },
          };
        },
      });
    });

    When('updating concurrent secret', () => {
      return concurrentSecret.optimisticUpdate(() => {
        return Buffer.from('version-2');
      });
    });

    Then('the request was made with call options headers', async () => {
      expect((await concurrentSecret.getLatestData()).payload.data.toString()).to.equal('version-2');
    });
  });
});

import { randomInt } from 'node:crypto';
import path from 'node:path/posix';

import { ConcurrentSecret } from '@aller/google-cloud-secret';
import { startServer } from '@aller/google-cloud-secret/fake-server/fake-secret-manager-server';
import secretManager from '@google-cloud/secret-manager';
import * as grpc from '@grpc/grpc-js';
import * as ck from 'chronokinesis';

import { fakeAuth } from '../helpers/fake-auth.js';

Feature('call options option', () => {
  /** @type {Awaited<ReturnType<typeof startServer>>} */
  let server;
  /** @type {import('@google-cloud/secret-manager').SecretManagerServiceClient} */
  let client;
  before('grpc server', async () => {
    server = await startServer();
    client = new secretManager.v1.SecretManagerServiceClient({
      apiEndpoint: 'localhost',
      sslCreds: grpc.credentials.createInsecure(),
      port: server.origin.port,
      auth: fakeAuth(),
    });
  });
  after(async () => {
    await client.close();
    server?.forceShutdown();
  });
  after(ck.reset);

  Scenario('update concurrent secret with call options function', () => {
    const secretId = `my-secret-${randomInt(1000000)}`;
    const parent = 'projects/1234';
    const secretName = path.join(parent, 'secrets', secretId);

    after(ck.reset);

    Given('a secret matching scenario', async () => {
      await client.createSecret({
        parent: 'projects/1234',
        secretId,
        secret: { versionDestroyTtl: { seconds: 86400, nanos: 0 }, replication: { automatic: {} }, annotations: { foo: 'bar' } },
      });
      await client.addSecretVersion({ parent: secretName, payload: { data: Buffer.from('version-1') } });
    });

    /** @type {ConcurrentSecret} */
    let concurrentSecret;
    And('a concurrent secret is configured with call options function that sets headers', () => {
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

    Then('the request was made with call options headers', () => {
      expect(server.getSecret(secretName).metadata.getMap()).to.have.property('traceparent', '00-traceid1-spanid-00');
    });
  });

  Scenario('update concurrent secret with call options object', () => {
    const secretId = `my-secret-${randomInt(1000000)}`;
    const parent = 'projects/1234';
    const secretName = path.join(parent, 'secrets', secretId);

    after(ck.reset);

    Given('a secret matching scenario', async () => {
      await client.createSecret({
        parent: 'projects/1234',
        secretId,
        secret: { versionDestroyTtl: { seconds: 86400, nanos: 0 }, replication: { automatic: {} }, annotations: { foo: 'bar' } },
      });
      await client.addSecretVersion({ parent: secretName, payload: { data: Buffer.from('version-1') } });
    });

    /** @type {ConcurrentSecret} */
    let concurrentSecret;
    And('a concurrent secret is configured with call options function that sets headers', () => {
      concurrentSecret = new ConcurrentSecret(secretName, client, {
        callOptions: {
          otherArgs: {
            headers: {
              traceparent: '00-traceid2-spanid-00',
            },
          },
        },
      });
    });

    When('updating concurrent secret', () => {
      return concurrentSecret.optimisticUpdate(() => {
        return Buffer.from('version-2');
      });
    });

    Then('the request was made with call options headers', () => {
      expect(server.getSecret(secretName).metadata.getMap()).to.have.property('traceparent', '00-traceid2-spanid-00');
    });
  });
});

import { randomInt, randomUUID } from 'node:crypto';
import path from 'node:path/posix';

import { ConcurrentSecret } from '@aller/google-cloud-secret';
import secretManager from '@google-cloud/secret-manager';
import nock from 'nock';

import { startServer, reset } from '../helpers/fake-server.js';

Feature('client versions', () => {
  const secretId = `my-secret-${randomInt(10000)}`;
  const parent = 'projects/1234';
  const secretName = path.join(parent, 'secrets', secretId);

  before(() => {
    nock('https://oauth2.googleapis.com')
      .post('/token', (body) => {
        return body.target_audience ? new URL(body.target_audience) : true;
      })
      .query(true)
      .reply(200, {
        id_token: 'google-auth-id-token',
        access_token: randomUUID(),
      })
      .persist();
  });
  after(nock.cleanAll);

  /** @type {import('@grpc/grpc-js').Server} */
  let server;
  before('grpc server and a secret', async () => {
    server = await startServer();

    const client = new secretManager.v1.SecretManagerServiceClient({
      apiEndpoint: 'localhost',
      port: server.origin.port,
    });

    await client.createSecret({
      parent: 'projects/1234',
      secretId,
      secret: { versionDestroyTtl: { seconds: 86400, nanos: 0 }, replication: { automatic: {} }, annotations: { foo: 'bar' } },
    });
  });
  after(() => {
    server?.forceShutdown();
    reset();
  });

  Scenario('v1 client is used to update secret', () => {
    /** @type {import('@google-cloud/secret-manager').SecretManagerServiceClient} */
    let client;
    before('grpc server', () => {
      client = new secretManager.v1.SecretManagerServiceClient({
        apiEndpoint: 'localhost',
        port: server.origin.port,
      });
    });
    after(async () => {
      client = await client.close();
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
      client = new secretManager.v1beta1.SecretManagerServiceClient({
        apiEndpoint: 'localhost',
        port: server.origin.port,
      });
    });
    after(async () => {
      client = await client.close();
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
      client = new secretManager.v1beta2.SecretManagerServiceClient({
        apiEndpoint: 'localhost',
        port: server.origin.port,
      });
    });
    after(async () => {
      client = await client.close();
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

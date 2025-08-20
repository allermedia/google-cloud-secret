import { randomInt } from 'node:crypto';
import path from 'node:path/posix';

import secretManager from '@google-cloud/secret-manager';
import nock from 'nock';

import { ConcurrentSecret } from '../../src/index.js';
import { startServer, reset } from '../helpers/fake-server.js';

Feature('get secret data', () => {
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

  /** @type {import('@grpc/grpc-js').Server} */
  let server;
  /** @type {import('@google-cloud/secret-manager').SecretManagerServiceClient} */
  let client;
  before('grpc server', async () => {
    server = await startServer();
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

  Scenario('get secret data for existing version', () => {
    const secretId = `my-secret-${randomInt(10000)}`;
    const parent = 'projects/1234';
    const secretName = path.join(parent, 'secrets', secretId);

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
    let result;
    When('attempting get secret data', async () => {
      concurrentSecret = new ConcurrentSecret(secretName, client);
      result = await concurrentSecret.getLatestData();
    });

    Then('secret data is returned', () => {
      expect(result.name).to.equal(`${secretName}/versions/1`);
      expect(result.payload.data.toString()).to.equal('version-1');
    });
  });
});

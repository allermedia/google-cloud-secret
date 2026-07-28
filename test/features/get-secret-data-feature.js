import { randomInt } from 'node:crypto';
import path from 'node:path/posix';

import { ConcurrentSecret } from '@aller/google-cloud-secret';
import { startServer } from '@aller/google-cloud-secret/fake-server/fake-secret-manager-server';
import secretManager from '@google-cloud/secret-manager';
import * as grpc from '@grpc/grpc-js';

import { fakeAuth } from '../helpers/fake-auth.js';

Feature('get secret data', () => {
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

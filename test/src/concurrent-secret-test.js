import { randomInt } from 'node:crypto';

import secretManager from '@google-cloud/secret-manager';
import * as ck from 'chronokinesis';
import nock from 'nock';

import { ConcurrentSecret } from '../../src/index.js';
import { fakeAuth } from '../helpers/fake-auth.js';
import { startServer, reset } from '../helpers/fake-server.js';

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

  /** @type {import('@grpc/grpc-js').Server} */
  let server;
  /** @type {import('@google-cloud/secret-manager').SecretManagerServiceClient} */
  let client;
  before('grpc server', async () => {
    server = await startServer();
    client = new secretManager.v1.SecretManagerServiceClient({
      apiEndpoint: 'localhost',
      port: server.origin.port,
      auth: fakeAuth(),
    });
  });
  after(async () => {
    client = await client.close();
    server = server?.forceShutdown();
    reset();
  });
  after(ck.reset);

  describe('prepare', () => {
    it('two calls to prepare returns same promise', async () => {
      const secretId = `my-secret-${randomInt(10000)}`;

      await client.createSecret({
        parent: 'projects/1234',
        secretId,
        secret: { versionDestroyTtl: { seconds: 86400, nanos: 0 }, replication: { automatic: {} }, annotations: { foo: 'bar' } },
      });

      const concurrentSecret = new ConcurrentSecret(`projects/1234/secrets/${secretId}`, client);
      const prep1 = concurrentSecret._prepare();
      const prep2 = concurrentSecret._prepare();

      expect(await prep1).to.equal(await prep2);
    });
  });

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

    it('getLatestVersion(true) throws if not found', async () => {
      const secretId = `my-secret-${randomInt(10000)}`;

      await client.createSecret({
        parent: 'projects/1234',
        secretId,
        secret: { versionDestroyTtl: { seconds: 86400, nanos: 0 }, replication: { automatic: {} }, annotations: { foo: 'bar' } },
      });

      const concurrentSecret = new ConcurrentSecret(`projects/1234/secrets/${secretId}`, client);

      try {
        await concurrentSecret.getLatestVersion(true);
      } catch (err) {
        // eslint-disable-next-line no-var
        var error = err;
      }

      expect(error?.code).to.equal(5);
    });

    it('getLatestVersion(true) throws if not found', async () => {
      const secretId = `my-secret-${randomInt(10000)}`;

      await client.createSecret({
        parent: 'projects/1234',
        secretId,
        secret: { versionDestroyTtl: { seconds: 86400, nanos: 0 }, replication: { automatic: {} }, annotations: { foo: 'bar' } },
      });

      const concurrentSecret = new ConcurrentSecret(`projects/1234/secrets/${secretId}`, client);

      try {
        await concurrentSecret.getLatestVersion(true);
      } catch (err) {
        // eslint-disable-next-line no-var
        var error = err;
      }

      expect(error?.code).to.equal(5);
    });
  });

  describe('lock', () => {
    it('multiple lock is ignored', async () => {
      const secretId = `my-secret-${randomInt(10000)}`;

      await client.createSecret({
        parent: 'projects/1234',
        secretId,
        secret: { versionDestroyTtl: { seconds: 86400, nanos: 0 }, replication: { automatic: {} }, annotations: { foo: 'bar' } },
      });

      const concurrentSecret = new ConcurrentSecret(`projects/1234/secrets/${secretId}`, client);
      await concurrentSecret.lock();
      await concurrentSecret.lock();

      await concurrentSecret.unlock();
    });
  });

  describe('unlock', () => {
    it('unlock without lock is ignored', async () => {
      const secretId = `my-secret-${randomInt(10000)}`;

      await client.createSecret({
        parent: 'projects/1234',
        secretId,
        secret: { versionDestroyTtl: { seconds: 86400, nanos: 0 }, replication: { automatic: {} }, annotations: { foo: 'bar' } },
      });

      const concurrentSecret = new ConcurrentSecret(`projects/1234/secrets/${secretId}`, client);

      await concurrentSecret.unlock();
    });

    it('multiple unlock is ignored', async () => {
      const secretId = `my-secret-${randomInt(10000)}`;

      await client.createSecret({
        parent: 'projects/1234',
        secretId,
        secret: { versionDestroyTtl: { seconds: 86400, nanos: 0 }, replication: { automatic: {} }, annotations: { foo: 'bar' } },
      });

      const concurrentSecret = new ConcurrentSecret(`projects/1234/secrets/${secretId}`, client);
      await concurrentSecret.lock();

      await concurrentSecret.unlock();
      await concurrentSecret.unlock();
    });
  });
});

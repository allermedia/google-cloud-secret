import { randomInt } from 'node:crypto';

import { startServer } from '@aller/google-cloud-secret/emulator';
import secretManager from '@google-cloud/secret-manager';
import * as grpc from '@grpc/grpc-js';
import * as ck from 'chronokinesis';

import { ConcurrentSecret } from '../../src/index.js';
import { fakeAuth } from '../helpers/fake-auth.js';

describe('concurrent secret', () => {
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

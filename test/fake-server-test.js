import { randomInt } from 'node:crypto';

import secretManager from '@google-cloud/secret-manager';
import Debug from 'debug';

import { fakeAuth } from './helpers/fake-auth.js';
import { startServer, RpcCodes } from './helpers/fake-server.js';

const debug = Debug('test:aller:google-cloud-secret');

describe('fake grpc server', () => {
  it('can be started and stopped', async () => {
    const server = await startServer();
    server.forceShutdown();
  });

  it('can be started and stopped again', async () => {
    const server = await startServer();
    server.forceShutdown();
  });

  describe('api', () => {
    /** @type {import('@grpc/grpc-js').Server} */
    let server;
    /** @type {import('@google-cloud/secret-manager').SecretManagerServiceClient} */
    let client;
    before('grpc server', async () => {
      debug('initiate server');

      server = await startServer();

      debug('server initiated');

      client = new secretManager.v1.SecretManagerServiceClient({
        apiEndpoint: 'localhost',
        port: server.origin.port,
        auth: fakeAuth(),
      });

      debug('client created');
    });
    after(async () => {
      client = await client.close();
      server = server?.forceShutdown();
    });

    it('getSecret returns secret metadata', async () => {
      const secretId = `my-secret-${randomInt(10000)}`;

      const [newSecret] = await client.createSecret({
        parent: 'projects/1234',
        secretId: secretId,
        secret: { replication: { automatic: {} } },
      });

      const [secret] = await client.getSecret({ name: newSecret.name });
      expect(secret).to.be.ok;

      expect(secret.etag).to.be.ok;
    });

    it('getSecretVersion latest returns secret version metadata', async () => {
      const secretId = `my-secret-${randomInt(10000)}`;

      const [newSecret] = await client.createSecret({
        parent: 'projects/1234',
        secretId: secretId,
        secret: { replication: { automatic: {} } },
      });

      await client.addSecretVersion({ parent: newSecret.name, payload: { data: Buffer.from('version-1') } });

      const [secret] = await client.getSecretVersion({ name: `projects/1234/secrets/${secretId}/versions/latest` });
      expect(secret).to.be.ok;
    });

    it('deleteSecret non-existing secret returns not found', async () => {
      const secretId = `my-secret-${randomInt(10000)}`;

      try {
        await client.deleteSecret({
          name: `projects/1234/secrets/${secretId}`,
        });
      } catch (err) {
        // eslint-disable-next-line no-var
        var error = err;
      }

      expect(error).to.have.property('code', RpcCodes.NOT_FOUND);
      expect(error?.message).to.include(`Secret [projects/1234/secrets/${secretId}] not found.`);
    });

    it('deleteSecret existing secret returns empty', async () => {
      const secretId = `my-secret-${randomInt(10000)}`;

      const [newSecret] = await client.createSecret({
        parent: 'projects/1234',
        secretId: secretId,
        secret: { replication: { automatic: {} } },
      });

      const response = await client.deleteSecret({
        name: newSecret.name,
      });

      expect(response[0]).to.be.empty;
    });

    it('deleteSecret matching etag returns empty', async () => {
      const secretId = `my-secret-${randomInt(10000)}`;

      const [newSecret] = await client.createSecret({
        parent: 'projects/1234',
        secretId: secretId,
        secret: { replication: { automatic: {} } },
      });

      const response = await client.deleteSecret({
        name: newSecret.name,
        etag: newSecret.etag,
      });

      expect(response[0]).to.be.empty;
    });

    it('deleteSecret with mismatching etag returns failed precondition', async () => {
      const secretId = `my-secret-${randomInt(10000)}`;

      const [newSecret] = await client.createSecret({
        parent: 'projects/1234',
        secretId: secretId,
        secret: { replication: { automatic: {} } },
      });

      await client.updateSecret({
        secret: {
          name: `projects/1234/secrets/${secretId}`,
          etag: newSecret.etag,
        },
        updateMask: { paths: ['annotations'] },
      });

      try {
        await client.deleteSecret({
          name: `projects/1234/secrets/${secretId}`,
          etag: newSecret.etag,
        });
      } catch (err) {
        // eslint-disable-next-line no-var
        var error = err;
      }

      expect(error).to.have.property('code', RpcCodes.FAILED_PRECONDITION);
    });

    ['foo', 'projects/foo', 'projects/123a/secrets/bar'].forEach((name) => {
      it(`getSecret with malformatted name (${name}) throws`, async () => {
        try {
          await client.getSecret({ name });
        } catch (err) {
          // eslint-disable-next-line no-var
          var error = err;
        }

        expect(error.code).to.equal(RpcCodes.INVALID_ARGUMENT);
      });
    });
  });
});

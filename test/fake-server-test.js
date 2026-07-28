import { randomInt } from 'node:crypto';

import { startServer, RpcCodes } from '@aller/google-cloud-secret/fake-server/fake-secret-manager-server';
import secretManager from '@google-cloud/secret-manager';
import * as grpc from '@grpc/grpc-js';
import Debug from 'debug';

import { fakeAuth } from './helpers/fake-auth.js';

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

  it('can be started with explicit server credentials instead of cert', async () => {
    const server = await startServer({ credentials: grpc.ServerCredentials.createInsecure() });
    expect(server.origin.port).to.be.above(0);
    server.forceShutdown();
  });

  it('keeps state per server instance', async () => {
    const server1 = await startServer();
    const server2 = await startServer();

    const client = new secretManager.v1.SecretManagerServiceClient({
      apiEndpoint: 'localhost',
      sslCreds: grpc.credentials.createInsecure(),
      port: server1.origin.port,
      auth: fakeAuth(),
    });

    await client.createSecret({
      parent: 'projects/1234',
      secretId: 'isolated',
      secret: { replication: { automatic: {} } },
    });

    expect(server1.getSecret('projects/1234/secrets/isolated'), 'secret on addressed server').to.be.ok;
    expect(server2.getSecret('projects/1234/secrets/isolated'), 'secret on other server').to.be.undefined;

    server1.reset();
    expect(server1.secrets.size).to.equal(0);

    await client.close();
    server1.forceShutdown();
    server2.forceShutdown();
  });

  describe('api', () => {
    /** @type {Awaited<ReturnType<typeof startServer>>} */
    let server;
    /** @type {import('@google-cloud/secret-manager').SecretManagerServiceClient} */
    let client;
    before('grpc server', async () => {
      debug('initiate server');

      server = await startServer();

      debug('server initiated');

      client = new secretManager.v1.SecretManagerServiceClient({
        apiEndpoint: 'localhost',
        sslCreds: grpc.credentials.createInsecure(),
        port: server.origin.port,
        auth: fakeAuth(),
      });

      debug('client created');
    });
    after(async () => {
      await client.close();
      server?.forceShutdown();
    });

    it('getSecret returns secret metadata', async () => {
      const secretId = `my-secret-${randomInt(1000000)}`;

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
      const secretId = `my-secret-${randomInt(1000000)}`;

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
      const secretId = `my-secret-${randomInt(1000000)}`;

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
      const secretId = `my-secret-${randomInt(1000000)}`;

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
      const secretId = `my-secret-${randomInt(1000000)}`;

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
      const secretId = `my-secret-${randomInt(1000000)}`;

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

    it('listSecretVersions for non-existing secret returns not found', async () => {
      try {
        await client.listSecretVersions({ parent: 'projects/1234/secrets/no-such-secret' });
      } catch (err) {
        // eslint-disable-next-line no-var
        var error = err;
      }

      expect(error).to.have.property('code', RpcCodes.NOT_FOUND);
      expect(error?.message).to.include('Secret [projects/1234/secrets/no-such-secret] not found.');
    });

    it('disableSecretVersion for non-existing version returns not found', async () => {
      const secretId = `my-secret-${randomInt(1000000)}`;

      await client.createSecret({
        parent: 'projects/1234',
        secretId: secretId,
        secret: { replication: { automatic: {} } },
      });

      try {
        await client.disableSecretVersion({ name: `projects/1234/secrets/${secretId}/versions/1` });
      } catch (err) {
        // eslint-disable-next-line no-var
        var error = err;
      }

      expect(error).to.have.property('code', RpcCodes.NOT_FOUND);
      expect(error?.message).to.include(`Secret Version [projects/1234/secrets/${secretId}/versions/1] not found.`);
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

import { randomInt } from 'node:crypto';

import { startServer, RpcCodes } from '@aller/google-cloud-secret/emulator';
import secretManager from '@google-cloud/secret-manager';
import * as grpc from '@grpc/grpc-js';
import Debug from 'debug';

import { fakeAuth } from './helpers/fake-auth.js';

const debug = Debug('test:aller:google-cloud-secret');

/**
 * @param {() => Promise<unknown>} fn
 * @returns {Promise<any>} thrown error, if any
 */
async function catchError(fn) {
  try {
    await fn();
  } catch (err) {
    return err;
  }
}

describe('emulator', () => {
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

  it('rejects when the requested port is taken', async () => {
    const server = await startServer();

    const error = await catchError(() => startServer({ port: server.origin.port }));
    expect(error, 'bind error').to.be.instanceOf(Error);

    server.forceShutdown();
  });

  it('prefilled store with plain number destroy ttl schedules destruction', async () => {
    const name = 'projects/1234/secrets/prefilled';
    /** @type {Map<string, import('@aller/google-cloud-secret/emulator').EmulatorSecret>} */
    const secrets = new Map([
      [
        name,
        {
          metadata: new grpc.Metadata(),
          secret: { name, etag: 'secret-etag', replication: { automatic: {} }, versionDestroyTtl: { seconds: 60 } },
          versions: [{ version: { name: `${name}/versions/1`, etag: 'version-etag', state: 'ENABLED' }, data: Buffer.from('v1') }],
        },
      ],
    ]);
    const server = await startServer({ secrets });
    const client = new secretManager.v1.SecretManagerServiceClient({
      apiEndpoint: 'localhost',
      sslCreds: grpc.credentials.createInsecure(),
      port: server.origin.port,
      auth: fakeAuth(),
    });

    const [scheduled] = await client.destroySecretVersion({ name: `${name}/versions/1` });
    expect(scheduled).to.have.property('state', 'DISABLED');
    expect(Number(scheduled.scheduledDestroyTime.seconds)).to.be.above(Math.floor(Date.now() / 1000));

    await client.close();
    server.forceShutdown();
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

    describe('createSecret', () => {
      it('with malformatted parent returns invalid argument', async () => {
        const error = await catchError(() =>
          client.createSecret({ parent: 'projects/abc', secretId: 'foo', secret: { replication: { automatic: {} } } })
        );
        expect(error).to.have.property('code', RpcCodes.INVALID_ARGUMENT);
      });

      it('with existing secret id returns already exists', async () => {
        const secretId = `my-secret-${randomInt(1000000)}`;
        const request = { parent: 'projects/1234', secretId, secret: { replication: { automatic: {} } } };

        await client.createSecret(request);

        const error = await catchError(() => client.createSecret(request));
        expect(error).to.have.property('code', RpcCodes.ALREADY_EXISTS);
        expect(error?.message).to.include(`projects/1234/secrets/${secretId} already exists`);
      });

      it('with user managed replication keeps replication type', async () => {
        const secretId = `my-secret-${randomInt(1000000)}`;

        const [secret] = await client.createSecret({
          parent: 'projects/1234',
          secretId,
          secret: { replication: { userManaged: { replicas: [{ location: 'europe-north1' }] } } },
        });

        expect(server.getSecret(secret.name)?.secret.replication).to.have.property('replication', 'userManaged');
      });
    });

    describe('getSecret', () => {
      it('non-existing secret returns not found', async () => {
        const error = await catchError(() => client.getSecret({ name: 'projects/1234/secrets/no-such-secret' }));
        expect(error).to.have.property('code', RpcCodes.NOT_FOUND);
        expect(error?.message).to.include('Secret [projects/1234/secrets/no-such-secret] not found.');
      });
    });

    describe('addSecretVersion', () => {
      it('with malformatted parent returns invalid argument', async () => {
        const error = await catchError(() =>
          client.addSecretVersion({ parent: 'projects/abc/secrets/foo', payload: { data: Buffer.from('x') } })
        );
        expect(error).to.have.property('code', RpcCodes.INVALID_ARGUMENT);
      });

      it('for non-existing secret returns not found', async () => {
        const error = await catchError(() =>
          client.addSecretVersion({ parent: 'projects/1234/secrets/no-such-secret', payload: { data: Buffer.from('x') } })
        );
        expect(error).to.have.property('code', RpcCodes.NOT_FOUND);
      });
    });

    describe('disableSecretVersion', () => {
      it('for non-existing secret returns not found', async () => {
        const error = await catchError(() => client.disableSecretVersion({ name: 'projects/1234/secrets/no-such-secret/versions/1' }));
        expect(error).to.have.property('code', RpcCodes.NOT_FOUND);
        expect(error?.message).to.include('Secret [projects/1234/secrets/no-such-secret] not found.');
      });

      it('with mismatching etag returns failed precondition', async () => {
        const [version] = await createSecretWithVersion();

        const error = await catchError(() => client.disableSecretVersion({ name: version.name, etag: 'stale' }));
        expect(error).to.have.property('code', RpcCodes.FAILED_PRECONDITION);
      });

      it('with matching etag disables version and rotates etag', async () => {
        const [version] = await createSecretWithVersion();

        const [disabled] = await client.disableSecretVersion({ name: version.name, etag: version.etag });
        expect(disabled).to.have.property('state', 'DISABLED');
        expect(disabled.etag).to.be.ok.and.not.equal(version.etag);
      });
    });

    describe('enableSecretVersion', () => {
      it('enables a disabled version and rotates etag', async () => {
        const [version] = await createSecretWithVersion();
        const [disabled] = await client.disableSecretVersion({ name: version.name });

        const [enabled] = await client.enableSecretVersion({ name: version.name, etag: disabled.etag });
        expect(enabled).to.have.property('state', 'ENABLED');
        expect(enabled.etag).to.be.ok.and.not.equal(disabled.etag);
      });

      it('for non-existing secret returns not found', async () => {
        const error = await catchError(() => client.enableSecretVersion({ name: 'projects/1234/secrets/no-such-secret/versions/1' }));
        expect(error).to.have.property('code', RpcCodes.NOT_FOUND);
        expect(error?.message).to.include('Secret [projects/1234/secrets/no-such-secret] not found.');
      });

      it('for non-existing version returns not found', async () => {
        const [, secret] = await createSecretWithVersion();

        const error = await catchError(() => client.enableSecretVersion({ name: `${secret.name}/versions/42` }));
        expect(error).to.have.property('code', RpcCodes.NOT_FOUND);
        expect(error?.message).to.include(`Secret Version [${secret.name}/versions/42] not found.`);
      });

      it('with mismatching etag returns failed precondition', async () => {
        const [version] = await createSecretWithVersion();

        const error = await catchError(() => client.enableSecretVersion({ name: version.name, etag: 'stale' }));
        expect(error).to.have.property('code', RpcCodes.FAILED_PRECONDITION);
      });
    });

    describe('getSecretVersion', () => {
      it('for non-existing secret returns not found', async () => {
        const error = await catchError(() => client.getSecretVersion({ name: 'projects/1234/secrets/no-such-secret/versions/latest' }));
        expect(error).to.have.property('code', RpcCodes.NOT_FOUND);
        expect(error?.message).to.include('Secret [projects/1234/secrets/no-such-secret] not found.');
      });

      it('latest for secret without versions returns not found', async () => {
        const [secret] = await client.createSecret({
          parent: 'projects/1234',
          secretId: `my-secret-${randomInt(1000000)}`,
          secret: { replication: { automatic: {} } },
        });

        const error = await catchError(() => client.getSecretVersion({ name: `${secret.name}/versions/latest` }));
        expect(error).to.have.property('code', RpcCodes.NOT_FOUND);
        expect(error?.message).to.include(`Secret [${secret.name}] not found or has no versions.`);
      });

      it('for non-existing version returns not found', async () => {
        const [, secret] = await createSecretWithVersion();

        const error = await catchError(() => client.getSecretVersion({ name: `${secret.name}/versions/42` }));
        expect(error).to.have.property('code', RpcCodes.NOT_FOUND);
        expect(error?.message).to.include(`Secret Version [${secret.name}/versions/42] not found.`);
      });

      it('by version name returns that version', async () => {
        const [version] = await createSecretWithVersion();

        const [found] = await client.getSecretVersion({ name: version.name });
        expect(found).to.have.property('name', version.name);
      });
    });

    describe('destroySecretVersion', () => {
      it('for non-existing secret returns not found', async () => {
        const error = await catchError(() => client.destroySecretVersion({ name: 'projects/1234/secrets/no-such-secret/versions/1' }));
        expect(error).to.have.property('code', RpcCodes.NOT_FOUND);
        expect(error?.message).to.include('Secret [projects/1234/secrets/no-such-secret] not found.');
      });

      it('for non-existing version returns not found', async () => {
        const [, secret] = await createSecretWithVersion();

        const error = await catchError(() => client.destroySecretVersion({ name: `${secret.name}/versions/42` }));
        expect(error).to.have.property('code', RpcCodes.NOT_FOUND);
        expect(error?.message).to.include(`Secret Version [${secret.name}/versions/42] not found.`);
      });

      it('with mismatching etag returns failed precondition', async () => {
        const [version] = await createSecretWithVersion();

        const error = await catchError(() => client.destroySecretVersion({ name: version.name, etag: 'stale' }));
        expect(error).to.have.property('code', RpcCodes.FAILED_PRECONDITION);
      });

      it('without destroy ttl destroys immediately', async () => {
        const [version] = await createSecretWithVersion();

        const [destroyed] = await client.destroySecretVersion({ name: version.name, etag: version.etag });
        expect(destroyed).to.have.property('state', 'DESTROYED');
        expect(destroyed.destroyTime).to.be.ok;
      });

      it('on already destroyed version returns failed precondition', async () => {
        const [version] = await createSecretWithVersion();
        await client.destroySecretVersion({ name: version.name });

        const error = await catchError(() => client.destroySecretVersion({ name: version.name }));
        expect(error).to.have.property('code', RpcCodes.FAILED_PRECONDITION);
        expect(error?.message).to.include('SecretVersion.state is already DESTROYED.');
      });

      it('with destroy ttl schedules destruction and disables version', async () => {
        const [version] = await createSecretWithVersion({ versionDestroyTtl: { seconds: 3600 } });

        const [scheduled] = await client.destroySecretVersion({ name: version.name });
        expect(scheduled).to.have.property('state', 'DISABLED');
        expect(scheduled.scheduledDestroyTime).to.be.ok;
      });

      it('on version already scheduled for destruction returns failed precondition', async () => {
        const [version] = await createSecretWithVersion({ versionDestroyTtl: { seconds: 3600, nanos: 500 } });
        await client.destroySecretVersion({ name: version.name });

        const error = await catchError(() => client.destroySecretVersion({ name: version.name }));
        expect(error).to.have.property('code', RpcCodes.FAILED_PRECONDITION);
        expect(error?.message).to.include('SecretVersion is already scheduled for DESTRUCTION.');
      });
    });

    describe('updateSecret', () => {
      it('for non-existing secret returns not found', async () => {
        const error = await catchError(() =>
          client.updateSecret({ secret: { name: 'projects/1234/secrets/no-such-secret' }, updateMask: { paths: ['annotations'] } })
        );
        expect(error).to.have.property('code', RpcCodes.NOT_FOUND);
        expect(error?.message).to.include('Secret [projects/1234/secrets/no-such-secret] not found.');
      });
    });

    describe('accessSecretVersion', () => {
      it('by version name returns payload', async () => {
        const [version] = await createSecretWithVersion();

        const [accessed] = await client.accessSecretVersion({ name: version.name });
        expect(accessed).to.have.property('name', version.name);
        expect(Buffer.from(accessed.payload.data).toString()).to.equal('version-1');
      });

      it('for non-existing secret returns not found', async () => {
        const error = await catchError(() => client.accessSecretVersion({ name: 'projects/1234/secrets/no-such-secret/versions/latest' }));
        expect(error).to.have.property('code', RpcCodes.NOT_FOUND);
        expect(error?.message).to.include('Secret [projects/1234/secrets/no-such-secret] not found.');
      });

      it('latest for secret without versions returns not found', async () => {
        const [secret] = await client.createSecret({
          parent: 'projects/1234',
          secretId: `my-secret-${randomInt(1000000)}`,
          secret: { replication: { automatic: {} } },
        });

        const error = await catchError(() => client.accessSecretVersion({ name: `${secret.name}/versions/latest` }));
        expect(error).to.have.property('code', RpcCodes.NOT_FOUND);
        expect(error?.message).to.include(`Secret [${secret.name}] not found or has no versions.`);
      });

      it('for non-existing version returns not found', async () => {
        const [, secret] = await createSecretWithVersion();

        const error = await catchError(() => client.accessSecretVersion({ name: `${secret.name}/versions/42` }));
        expect(error).to.have.property('code', RpcCodes.NOT_FOUND);
        expect(error?.message).to.include(`Secret Version [${secret.name}/versions/42] not found.`);
      });
    });

    /**
     * @param {Partial<import('@google-cloud/secret-manager').protos.google.cloud.secretmanager.v1.ISecret>} [secretProps]
     */
    async function createSecretWithVersion(secretProps) {
      const [secret] = await client.createSecret({
        parent: 'projects/1234',
        secretId: `my-secret-${randomInt(1000000)}`,
        secret: { replication: { automatic: {} }, ...secretProps },
      });
      const [version] = await client.addSecretVersion({ parent: secret.name, payload: { data: Buffer.from('version-1') } });
      return /** @type {const} */ ([version, secret]);
    }

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

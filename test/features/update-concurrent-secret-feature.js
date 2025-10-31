import { randomInt } from 'node:crypto';
import path from 'node:path/posix';

import { ConcurrentSecret } from '@aller/google-cloud-secret';
import secretManager from '@google-cloud/secret-manager';
import * as ck from 'chronokinesis';
import nock from 'nock';

import { startServer, RpcCodes, reset } from '../helpers/fake-server.js';

Feature('update concurrent secret', () => {
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
    });
  });
  after(async () => {
    client = await client.close();
    server = server?.forceShutdown();
    reset();
  });
  after(ck.reset);

  Scenario('update concurrent secret with version destroy ttl', () => {
    const secretId = `my-secret-${randomInt(10000)}`;
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
    When('attempting to lock secret', async () => {
      concurrentSecret = new ConcurrentSecret(secretName, client);

      ck.freeze();

      await concurrentSecret.lock();
    });

    Then('secret is updated with lock annotation', async () => {
      const [secret] = await client.getSecret({ name: secretName });

      expect(secret.annotations).to.deep.equal({ foo: 'bar', locked_at: new Date().toISOString() });
    });

    And('another attempt to lock secret fails with PRECONDITION FAILED already disabled', async () => {
      const anotherConcurrentSecret = new ConcurrentSecret(secretName, {
        apiEndpoint: 'localhost',
        port: server.origin.port,
      });

      try {
        await anotherConcurrentSecret.lock();
      } catch (err) {
        /** @type {import('../../src/index.js').ConcurrentSecretError} */
        // eslint-disable-next-line no-var
        var error = err;
      } finally {
        anotherConcurrentSecret.client.close();
      }

      expect(error.code).to.equal(RpcCodes.FAILED_PRECONDITION);
      expect(error).to.match(/by another process/i);
    });

    When('unlocking secret', async () => {
      await concurrentSecret.unlock();
    });

    let result;
    When('updating concurrent secret', async () => {
      result = await concurrentSecret.optimisticUpdate(() => {
        return new Promise((resolve) => {
          setImmediate(() => {
            return resolve('version-2');
          });
        });
      });
    });

    Then('a new version was added', async () => {
      const [latestVersion] = await client.getSecretVersion({ name: path.join(secretName, 'versions/latest') });

      expect(latestVersion.name, latestVersion.name).to.match(/\/versions\/2$/);
    });

    And('update result is return from secret function', () => {
      expect(result).to.equal('version-2');
    });

    And('previous version is disabled and destroyed within ttl', async () => {
      const [previousVersion] = await client.getSecretVersion({ name: path.join(secretName, 'versions/1') });

      expect(previousVersion.state).to.equal('DISABLED');
      expect(previousVersion.scheduledDestroyTime).to.deep.equal({
        nanos: new Date().getUTCMilliseconds() * 1e6,
        seconds: Math.floor(new Date().setSeconds(new Date().getUTCSeconds() + 86400) / 1000).toString(),
      });
    });

    And('secret is decorated with updated annotation', async () => {
      const [secret] = await client.getSecret({ name: secretName });

      expect(secret.annotations).to.deep.equal({ foo: 'bar', updated_at: new Date().toISOString() });
    });

    When('updating concurrent secret with another Buffer secret', async () => {
      result = await concurrentSecret.optimisticUpdate(() => {
        return new Promise((resolve) => {
          setImmediate(() => {
            return resolve(Buffer.from('version-3'));
          });
        });
      });
    });

    Then('a new version was added', async () => {
      const [latestVersion] = await client.getSecretVersion({ name: path.join(secretName, 'versions/latest') });

      expect(latestVersion.name, latestVersion.name).to.match(/\/versions\/3$/);
    });

    And('update result is return from secret function', () => {
      expect(result.toString()).to.equal('version-3');
      expect(Buffer.isBuffer(result), 'is buffer').to.be.true;
    });

    And('previous version is disabled and destroyed within ttl', async () => {
      const [previousVersion] = await client.getSecretVersion({ name: path.join(secretName, 'versions/1') });

      expect(previousVersion.state).to.equal('DISABLED');
      expect(previousVersion.scheduledDestroyTime).to.deep.equal({
        nanos: new Date().getUTCMilliseconds() * 1e6,
        seconds: Math.floor(new Date().setSeconds(new Date().getUTCSeconds() + 86400) / 1000).toString(),
      });
    });

    And('secret is decorated with updated annotation', async () => {
      const [secret] = await client.getSecret({ name: secretName });

      expect(secret.annotations).to.deep.equal({ foo: 'bar', updated_at: new Date().toISOString() });
    });
  });

  Scenario('update concurrent secret without version destroy ttl', () => {
    const secretId = `my-secret-${randomInt(10000)}`;
    const parent = 'projects/1234';
    const secretName = path.join(parent, 'secrets', secretId);

    after(ck.reset);

    Given('a secret matching scenario', async () => {
      await client.createSecret({
        parent: 'projects/1234',
        secretId,
        secret: { replication: { automatic: {} }, annotations: { foo: 'bar' } },
      });
      await client.addSecretVersion({ parent: secretName, payload: { data: Buffer.from('version-1') } });
    });

    /** @type {ConcurrentSecret} */
    let concurrentSecret;
    let result;
    When('updating concurrent secret', async () => {
      concurrentSecret = new ConcurrentSecret(secretName, client);

      ck.freeze();

      result = await concurrentSecret.optimisticUpdate(() => {
        return new Promise((resolve) => {
          setImmediate(() => {
            return resolve('version-2');
          });
        });
      });
    });

    Then('a new version was added', async () => {
      const [latestVersion] = await client.getSecretVersion({ name: path.join(secretName, 'versions/latest') });

      expect(latestVersion.name, latestVersion.name).to.match(/\/versions\/2$/);
    });

    And('update result is return from secret function', () => {
      expect(result).to.equal('version-2');
    });

    And('previous version is destroyed', async () => {
      const [previousVersion] = await client.getSecretVersion({ name: path.join(secretName, 'versions/1') });

      expect(previousVersion.state).to.equal('DESTROYED');
      expect(previousVersion.destroyTime).to.deep.equal({
        nanos: new Date().getUTCMilliseconds() * 1e6,
        seconds: Math.floor(Date.now() / 1000).toString(),
      });
    });

    And('secret is decorated with updated annotation', async () => {
      const [secret] = await client.getSecret({ name: secretName });

      expect(secret.annotations).to.deep.equal({ foo: 'bar', updated_at: new Date().toISOString() });
    });
  });

  Scenario('update secret fails in get new secret function', () => {
    const secretId = `my-secret-${randomInt(10000)}`;
    const parent = 'projects/1234';
    const secretName = path.join(parent, 'secrets', secretId);

    Given('a secret with version exists', async () => {
      await client.createSecret({ parent: 'projects/1234', secretId, secret: { replication: { automatic: {} } } });
      await client.addSecretVersion({ parent: secretName, payload: { data: Buffer.from('version-1') } });
    });

    /** @type {ConcurrentSecret} */
    let concurrentSecret;
    let result;
    When('updating concurrent secret with a failing function', async () => {
      concurrentSecret = new ConcurrentSecret(secretName, client);

      result = await concurrentSecret
        .optimisticUpdate(() => {
          return new Promise((_resolve, reject) => {
            setImmediate(() => {
              return reject(new Error('this was unexpected'));
            });
          });
        })
        .catch((err) => err);
    });

    Then('update failed', () => {
      expect(result).to.match(/this was unexpected/);
    });

    And('latest version is still enabled', async () => {
      const [previousVersion] = await client.getSecretVersion({ name: path.join(secretName, 'versions/latest') });

      expect(previousVersion.state).to.equal('ENABLED');
    });

    And('only one version is present', async () => {
      const [versions] = await client.listSecretVersions({ parent: secretName });
      expect(versions).to.have.length(1);
    });
  });

  Scenario("update secret with function that doesn't return string or buffer", () => {
    const secretId = `my-secret-${randomInt(10000)}`;
    const parent = 'projects/1234';
    const secretName = path.join(parent, 'secrets', secretId);

    function getNewSecret(val) {
      return val;
    }

    let latestVersion;
    Given('a secret with version exists', async () => {
      await client.createSecret({ parent: 'projects/1234', secretId, secret: { replication: { automatic: {} } } });
      const versionResult = await client.addSecretVersion({ parent: secretName, payload: { data: Buffer.from('version-1') } });
      latestVersion = versionResult[0];
    });

    [undefined, null, {}, true, false, 100].forEach((value) => {
      /** @type {ConcurrentSecret} */
      let concurrentSecret;
      let result;
      When(`updating concurrent secret with a function that returns ${`${value}`}`, async () => {
        concurrentSecret = new ConcurrentSecret(secretName, client);

        result = await concurrentSecret.optimisticUpdate(getNewSecret, value).catch((err) => err);
      });

      Then('update failed', () => {
        expect(result, result.message).to.match(/must be/);
      });

      And('latest version is still enabled', async () => {
        const [previousVersion] = await client.getSecretVersion({ name: path.join(latestVersion.name) });

        expect(previousVersion.state).to.equal('ENABLED');
      });

      And('only one version is present', async () => {
        const [versions] = await client.listSecretVersions({ parent: secretName });
        expect(versions).to.have.length(1);
      });
    });
  });

  Scenario('unlock secret fails while unlocking after update failed secret function', () => {
    const secretId = `my-secret-${randomInt(10000)}`;
    const parent = 'projects/1234';
    const secretName = path.join(parent, 'secrets', secretId);

    Given('a secret with version exists', async () => {
      await client.createSecret({ parent: 'projects/1234', secretId, secret: { replication: { automatic: {} } } });
      await client.addSecretVersion({ parent: secretName, payload: { data: Buffer.from('version-1') } });
    });

    /** @type {ConcurrentSecret} */
    let concurrentSecret;
    When('secret version is updated while attempting failing update secret function', async () => {
      concurrentSecret = new ConcurrentSecret(secretName, client);

      await concurrentSecret
        .optimisticUpdate(async () => {
          await client.disableSecretVersion({ name: path.join(secretName, '/versions/1') });

          return new Promise((_resolve, reject) => {
            setImmediate(() => {
              return reject(new Error('this was unexpected'));
            });
          });
        })
        .catch((err) => err);
    });

    Then('latest version is not updated', async () => {
      const [previousVersion] = await client.getSecretVersion({ name: path.join(secretName, 'versions/latest') });

      expect(previousVersion.state).to.equal('DISABLED');
    });

    And('only one version is present', async () => {
      const [versions] = await client.listSecretVersions({ parent: secretName });
      expect(versions).to.have.length(1);
    });
  });

  Scenario('update secret fails when attempting lock', () => {
    const secretId = `my-secret-${randomInt(10000)}`;
    const parent = 'projects/1234';
    const secretName = path.join(parent, 'secrets', secretId);

    Given('a secret with version exists', async () => {
      await client.createSecret({ parent: 'projects/1234', secretId, secret: { replication: { automatic: {} } } });
      await client.addSecretVersion({ parent: secretName, payload: { data: Buffer.from('version-1') } });
    });

    /** @type {ConcurrentSecret} */
    let concurrentSecret;
    Given('concurrent secret is initiated', async () => {
      concurrentSecret = new ConcurrentSecret(secretName, client);
      await concurrentSecret._prepare();
    });

    But('secret is updated by another client, etag is updated', () => {
      return client.updateSecret({ secret: { name: secretName }, updateMask: { paths: [] } });
    });

    let result;
    When('an attempt is made to update concurrent secret', async () => {
      result = await concurrentSecret
        .optimisticUpdate(() => {
          return new Promise((resolve) => {
            setImmediate(() => {
              return resolve('version-3');
            });
          });
        })
        .catch((err) => err);
    });

    Then('update failed', () => {
      expect(result.code).to.equal(RpcCodes.FAILED_PRECONDITION);
      expect(result).to.match(/etag/);
    });

    And('latest version is enabled', async () => {
      const [previousVersion] = await client.getSecretVersion({ name: path.join(secretName, 'versions/latest') });

      expect(previousVersion.state).to.equal('ENABLED');
    });

    And('only one version is present', async () => {
      const [versions] = await client.listSecretVersions({ parent: secretName });
      expect(versions).to.have.length(1);

      await client.destroySecretVersion({ name: path.join(secretName, 'versions/1') });
    });
  });

  Scenario('update secret that has no versions', () => {
    const secretId = `my-secret-${randomInt(10000)}`;
    const parent = 'projects/1234';
    const secretName = path.join(parent, 'secrets', secretId);

    Given('a secret without versions', async () => {
      await client.createSecret({ parent: 'projects/1234', secretId, secret: { replication: { automatic: {} } } });
    });

    /** @type {ConcurrentSecret} */
    let concurrentSecret;
    let result;
    When('an attempt is made to update concurrent secret', async () => {
      concurrentSecret = new ConcurrentSecret(secretName, client);
      result = await concurrentSecret
        .optimisticUpdate(() => {
          return new Promise((resolve) => {
            setImmediate(() => {
              return resolve('version-1');
            });
          });
        })
        .catch((err) => err);
    });

    Then('update succeeds', () => {
      expect(result, result?.message).to.equal('version-1');
    });
  });

  Scenario('update secret with one disabled version', () => {
    const secretId = `my-secret-${randomInt(10000)}`;
    const parent = 'projects/1234';
    const secretName = path.join(parent, 'secrets', secretId);

    Given('a secret matching scenario', async () => {
      await client.createSecret({ parent: 'projects/1234', secretId, secret: { replication: { automatic: {} } } });
      const [secretVersion] = await client.addSecretVersion({ parent: secretName, payload: { data: Buffer.from('version-1') } });
      await client.disableSecretVersion({ name: secretVersion.name });
    });

    /** @type {ConcurrentSecret} */
    let concurrentSecret;
    let result;
    When('an attempt is made to update concurrent secret', async () => {
      concurrentSecret = new ConcurrentSecret(secretName, client);
      result = await concurrentSecret
        .optimisticUpdate(() => {
          return new Promise((resolve) => {
            setImmediate(() => {
              return resolve('version-2');
            });
          });
        })
        .catch((err) => err);
    });

    Then('update succeeds', () => {
      expect(result, result?.message).to.equal('version-2');
    });
  });

  Scenario('update secret where latest version is disabled', () => {
    const secretId = `my-secret-${randomInt(10000)}`;
    const parent = 'projects/1234';
    const secretName = path.join(parent, 'secrets', secretId);

    Given('a secret matching scenario', async () => {
      await client.createSecret({ parent: 'projects/1234', secretId, secret: { replication: { automatic: {} } } });
      await client.addSecretVersion({ parent: secretName, payload: { data: Buffer.from('version-1') } });

      const [secretVersion] = await client.addSecretVersion({ parent: secretName, payload: { data: Buffer.from('version-2') } });
      await client.disableSecretVersion({ name: secretVersion.name });
    });

    /** @type {ConcurrentSecret} */
    let concurrentSecret;
    let result;
    When('an attempt is made to update concurrent secret', async () => {
      concurrentSecret = new ConcurrentSecret(secretName, client);
      result = await concurrentSecret
        .optimisticUpdate(() => {
          return new Promise((resolve) => {
            setImmediate(() => {
              return resolve('version-3');
            });
          });
        })
        .catch((err) => err);
    });

    Then('update succeeds', () => {
      expect(result, result?.message).to.equal('version-3');
    });
  });

  Scenario('update secret where latest version is destroyed', () => {
    const secretId = `my-secret-${randomInt(10000)}`;
    const parent = 'projects/1234';
    const secretName = path.join(parent, 'secrets', secretId);

    Given('a secret matching scenario', async () => {
      await client.createSecret({ parent: 'projects/1234', secretId, secret: { replication: { automatic: {} } } });
      await client.addSecretVersion({ parent: secretName, payload: { data: Buffer.from('version-1') } });

      const [secretVersion] = await client.addSecretVersion({ parent: secretName, payload: { data: Buffer.from('version-2') } });
      await client.destroySecretVersion({ name: secretVersion.name });
    });

    /** @type {ConcurrentSecret} */
    let concurrentSecret;
    let result;
    When('an attempt is made to update concurrent secret', async () => {
      concurrentSecret = new ConcurrentSecret(secretName, client);
      result = await concurrentSecret
        .optimisticUpdate(() => {
          return new Promise((resolve) => {
            setImmediate(() => {
              return resolve('version-3');
            });
          });
        })
        .catch((err) => err);
    });

    Then('update succeeds', () => {
      expect(result, result?.message).to.equal('version-3');
    });
  });

  Scenario('update secret where latest version is scheduled for destruction', () => {
    const secretId = `my-secret-${randomInt(10000)}`;
    const parent = 'projects/1234';
    const secretName = path.join(parent, 'secrets', secretId);

    Given('a secret matching scenario', async () => {
      await client.createSecret({
        parent: 'projects/1234',
        secretId,
        secret: { versionDestroyTtl: { seconds: 86400, nanos: 0 }, replication: { automatic: {} } },
      });
      await client.addSecretVersion({ parent: secretName, payload: { data: Buffer.from('version-1') } });

      const [secretVersion] = await client.addSecretVersion({ parent: secretName, payload: { data: Buffer.from('version-2') } });
      await client.destroySecretVersion({ name: secretVersion.name });
    });

    /** @type {ConcurrentSecret} */
    let concurrentSecret;
    let result;
    When('an attempt is made to update concurrent secret', async () => {
      concurrentSecret = new ConcurrentSecret(secretName, client);
      result = await concurrentSecret
        .optimisticUpdate(() => {
          return new Promise((resolve) => {
            setImmediate(() => {
              return resolve('version-3');
            });
          });
        })
        .catch((err) => err);
    });

    Then('update succeeds', () => {
      expect(result, result?.message).to.equal('version-3');
    });
  });

  Scenario('reuse concurrent secret', () => {
    const secretId = `my-secret-${randomInt(10000)}`;
    const parent = 'projects/1234';
    const secretName = path.join(parent, 'secrets', secretId);

    Given('a secret with one version', async () => {
      await client.createSecret({ parent: 'projects/1234', secretId, secret: { replication: { automatic: {} } } });
      await client.addSecretVersion({ parent: secretName, payload: { data: Buffer.from('version-1') } });
    });

    /** @type {ConcurrentSecret} */
    let concurrentSecret;
    let result;
    When('an attempt is made to update concurrent secret', async () => {
      concurrentSecret = new ConcurrentSecret(secretName, client);
      result = await concurrentSecret
        .optimisticUpdate(() => {
          return new Promise((resolve) => {
            setImmediate(() => {
              return resolve('version-2');
            });
          });
        })
        .catch((err) => err);
    });

    Then('update succeeds', () => {
      expect(result, result?.message).to.equal('version-2');
    });

    When('same concurrent secret attempts to update concurrent secret again', async () => {
      result = await concurrentSecret
        .optimisticUpdate(() => {
          return new Promise((resolve) => {
            setImmediate(() => {
              return resolve('version-3');
            });
          });
        })
        .catch((err) => err);
    });

    Then('update succeeds', () => {
      expect(result, result?.message).to.equal('version-3');
    });
  });

  Scenario('lock has expired', () => {
    after(ck.reset);

    const secretId = `my-secret-${randomInt(10000)}`;
    const parent = 'projects/1234';
    const secretName = path.join(parent, 'secrets', secretId);
    Given('a secret with one version', async () => {
      await client.createSecret({ parent: 'projects/1234', secretId, secret: { replication: { automatic: {} } } });
      await client.addSecretVersion({ parent: secretName, payload: { data: Buffer.from('version-1') } });
    });

    /** @type {ConcurrentSecret} */
    let concurrentSecret1;
    Given('one instance has locked secret', async () => {
      concurrentSecret1 = new ConcurrentSecret(secretName, client);
      await concurrentSecret1.lock();
    });

    /** @type {ConcurrentSecret} */
    let concurrentSecret2;
    let result;
    When('another instance attempts to update secret', async () => {
      concurrentSecret2 = new ConcurrentSecret(secretName, client, { gracePeriodMs: 30000 });

      result = await concurrentSecret2
        .optimisticUpdate(() => {
          return new Promise((resolve) => {
            setImmediate(() => {
              return resolve('version-3');
            });
          });
        })
        .catch((err) => err);
    });

    Then('update failed', () => {
      expect(result.code, result?.message).to.equal(RpcCodes.FAILED_PRECONDITION);
    });

    Given('a grace period has passed', () => {
      ck.travel(new Date(Date.now() + 30001));
    });

    When('another instance makes a new attempt to update secret', async () => {
      concurrentSecret2 = new ConcurrentSecret(secretName, client, { gracePeriodMs: 30000 });

      result = await concurrentSecret2
        .optimisticUpdate(() => {
          return new Promise((resolve) => {
            setImmediate(() => {
              return resolve('version-4');
            });
          });
        })
        .catch((err) => err);
    });

    Then('update succeeds', () => {
      expect(result, result?.message).to.equal('version-4');
    });
  });

  Scenario('a new version appears during lock', () => {
    after(ck.reset);

    const secretId = `my-secret-${randomInt(10000)}`;
    const parent = 'projects/1234';
    const secretName = path.join(parent, 'secrets', secretId);
    Given('a secret with one version', async () => {
      await client.createSecret({ parent: 'projects/1234', secretId, secret: { replication: { automatic: {} } } });
      await client.addSecretVersion({ parent: secretName, payload: { data: Buffer.from('version-1') } });
    });

    /** @type {ConcurrentSecret} */
    let concurrentSecret;
    Given('current instance has locked secret', async () => {
      concurrentSecret = new ConcurrentSecret(secretName, client);
      await concurrentSecret.lock();
    });

    And('a new secret version has appeared', async () => {
      await client.addSecretVersion({ parent: secretName, payload: { data: Buffer.from('new-version-2') } });
    });

    let result;
    When('current instance attempts to update secret', async () => {
      result = await concurrentSecret
        .optimisticUpdate(() => {
          return new Promise((resolve) => {
            setImmediate(() => {
              return resolve('version-3');
            });
          });
        })
        .catch((err) => err);
    });

    Then('update succeeds since latest version was replaced', () => {
      expect(result, result?.message).to.equal('version-3');
    });
  });

  Scenario('secret is updated from somewhere else before unlock', () => {
    after(ck.reset);

    const secretId = `my-secret-${randomInt(10000)}`;
    const parent = 'projects/1234';
    const secretName = path.join(parent, 'secrets', secretId);
    Given('a secret with one version', async () => {
      await client.createSecret({ parent: 'projects/1234', secretId, secret: { replication: { automatic: {} } } });
      await client.addSecretVersion({ parent: secretName, payload: { data: Buffer.from('version-1') } });
    });

    /** @type {ConcurrentSecret} */
    let concurrentSecret;
    Given('current instance has locked secret', async () => {
      concurrentSecret = new ConcurrentSecret(secretName, client);
      await concurrentSecret.lock();
    });

    And('secret is updated from somewhere else', async () => {
      await client.updateSecret({ secret: { name: secretName }, updateMask: { paths: [] } });
    });

    let result;
    When('current instance attempts to unlock secret', async () => {
      result = await concurrentSecret.unlock().catch((err) => err);
    });

    Then('unlock fails', () => {
      expect(result.code, result?.message).to.equal(RpcCodes.FAILED_PRECONDITION);
    });

    But('another lock is possible after grace period', async () => {
      ck.travel(Date.now() + 60001);

      await concurrentSecret.lock();
    });
  });
});

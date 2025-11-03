import { randomInt } from 'node:crypto';
import path from 'node:path/posix';
import { mock } from 'node:test';

import { SecretsCache } from '@aller/google-cloud-secret';
import secretManager from '@google-cloud/secret-manager';
import nock from 'nock';

import { RpcCodes } from '../../src/fake-server/rpc-codes.js';
import { startServer, reset } from '../helpers/fake-server.js';

Feature('secrets cache', () => {
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
  after(() => mock.timers.reset());

  Scenario('cached secret without initial value', () => {
    const secretId = `my-secret-${randomInt(1000000)}`;
    const parent = 'projects/1234';
    const secretName = path.join(parent, 'secrets', secretId);

    /** @type {SecretsCache} */
    let cache;
    before(() => {
      cache = new SecretsCache({
        apiEndpoint: 'localhost',
        port: server.origin.port,
      });
    });

    function updateMethod() {
      return 'updated-value';
    }

    Given('a secret with two versions', async () => {
      await client.createSecret({
        parent: parent,
        secretId,
        secret: { versionDestroyTtl: { seconds: 86400, nanos: 0 }, replication: { automatic: {} } },
      });

      const [version1] = await client.addSecretVersion({ parent: secretName, payload: { data: Buffer.from('initial-value') } });
      await client.destroySecretVersion({ name: version1.name });
      await client.addSecretVersion({ parent: secretName, payload: { data: Buffer.from('new-value') } });
    });

    And('secret is in cache without initial first version value', () => {
      cache.set(secretName, null, updateMethod);
    });

    let promisedGet;
    When('getting cached secret', () => {
      promisedGet = cache.get(secretName);
    });

    let cachedSecret;
    Then('latest version is returned', async () => {
      cachedSecret = await promisedGet;
      expect(cachedSecret.value).to.equal('new-value');
    });

    And('cached secret current version is 2', () => {
      expect(cachedSecret.versionName).to.equal(`projects/1234/secrets/${secretId}/versions/2`);
    });
  });

  Scenario('cached secret with initial value has new version', () => {
    const secretId = `my-secret-${randomInt(1000000)}`;
    const parent = 'projects/1234';
    const secretName = path.join(parent, 'secrets', secretId);

    /** @type {SecretsCache} */
    let cache;
    before(() => {
      cache = new SecretsCache(client);
    });

    function updateMethod() {
      return 'updated-value';
    }

    Given('a secret with two versions', async () => {
      await client.createSecret({
        parent: parent,
        secretId,
        secret: { versionDestroyTtl: { seconds: 86400, nanos: 0 }, replication: { automatic: {} } },
      });

      const [version1] = await client.addSecretVersion({ parent: secretName, payload: { data: Buffer.from('initial-value') } });
      await client.destroySecretVersion({ name: version1.name });
      await client.addSecretVersion({ parent: secretName, payload: { data: Buffer.from('new-value') } });
    });

    And('secret is in cache with initial first version value', () => {
      cache.set(secretName, 'initial-value', updateMethod);
    });

    let promisedGet;
    When('getting cached secret', () => {
      promisedGet = cache.get(secretName);
    });

    let cachedSecret;
    Then('version from initial set is returned', async () => {
      cachedSecret = await promisedGet;
      expect(cachedSecret.value).to.equal('initial-value');
    });

    And('cached secret lacks information about version', () => {
      expect(cachedSecret.versionName).to.be.undefined;
    });

    let promisedUpdate;
    When('secret is deemed invalid for some reason and wants an update', () => {
      promisedUpdate = cache.update(secretName);
    });

    Then('new version from gcp is returned', async () => {
      cachedSecret = await promisedUpdate;
      expect(cachedSecret.value).to.equal('new-value');
    });

    And('cached secret current version is 2', () => {
      expect(cachedSecret.versionName).to.equal(`projects/1234/secrets/${secretId}/versions/2`);
    });

    When('getting cached secret again', () => {
      promisedGet = cache.get(secretName);
    });

    Then('new version value is returned', async () => {
      cachedSecret = await promisedGet;
      expect(cachedSecret.value).to.equal('new-value');
    });

    When('secret is deemed invalid again for some reason and wants an update', () => {
      promisedUpdate = cache.update(secretName);
    });

    Then('new updated version is saved', async () => {
      cachedSecret = await promisedUpdate;
      expect(cachedSecret.value).to.equal('updated-value');
    });

    When('getting cached secret again', () => {
      promisedGet = cache.get(secretName);
    });

    Then('updated version value is returned', async () => {
      cachedSecret = await promisedGet;
      expect(cachedSecret.value).to.equal('updated-value');
    });

    And('cached secret current version is 3', () => {
      expect(cachedSecret.versionName).to.equal(`projects/1234/secrets/${secretId}/versions/3`);
    });

    Given('a new version is created by someone else', async () => {
      await client.destroySecretVersion({ name: cachedSecret.versionName });
      await client.addSecretVersion({ parent: secretName, payload: { data: Buffer.from('updated-by-someone-value') } });
    });

    When('secret is deemed invalid again for some reason and wants an update', () => {
      promisedUpdate = cache.update(secretName);
    });

    Then('latest updated secret is returned', async () => {
      cachedSecret = await promisedUpdate;
      expect(cachedSecret.value).to.equal('updated-by-someone-value');
    });

    And('cached secret current version is 4', () => {
      expect(cachedSecret.versionName).to.equal(`projects/1234/secrets/${secretId}/versions/4`);
    });

    When('secret is deemed invalid again for some reason and wants an update', () => {
      promisedUpdate = cache.update(secretName);
    });

    Then('latest updated secret is returned', async () => {
      cachedSecret = await promisedUpdate;
      expect(cachedSecret.value).to.equal('updated-value');
    });

    And('cached secret current version is 5', () => {
      expect(cachedSecret.versionName).to.equal(`projects/1234/secrets/${secretId}/versions/5`);
    });
  });

  Scenario('cached secret with initial value has no new version', () => {
    const secretId = `my-secret-${randomInt(1000000)}`;
    const parent = 'projects/1234';
    const secretName = path.join(parent, 'secrets', secretId);

    /** @type {SecretsCache} */
    let cache;
    before(() => {
      cache = new SecretsCache(client);
    });

    function updateMethod() {
      return 'updated-value';
    }

    Given('a secret with two versions', async () => {
      await client.createSecret({
        parent: parent,
        secretId,
        secret: { versionDestroyTtl: { seconds: 86400, nanos: 0 }, replication: { automatic: {} } },
      });

      const [version1] = await client.addSecretVersion({ parent: secretName, payload: { data: Buffer.from('initial-value') } });
      await client.destroySecretVersion({ name: version1.name });
      await client.addSecretVersion({ parent: secretName, payload: { data: Buffer.from('new-value') } });
    });

    And('secret is in cache with initial second version value', () => {
      cache.set(secretName, 'new-value', updateMethod);
    });

    let promisedGet;
    When('getting cached secret', () => {
      promisedGet = cache.get(secretName);
    });

    let cachedSecret;
    Then('version from initial set is returned', async () => {
      cachedSecret = await promisedGet;
      expect(cachedSecret.value).to.equal('new-value');
    });

    And('cached secret lacks information about version', () => {
      expect(cachedSecret.versionName).to.be.undefined;
    });

    let promisedUpdate;
    When('secret is deemed invalid for some reason and wants an update', () => {
      promisedUpdate = cache.update(secretName);
    });

    Then('new version from gcp is returned', async () => {
      cachedSecret = await promisedUpdate;
      expect(cachedSecret.value).to.equal('updated-value');
    });

    And('cached secret current version is 3', () => {
      expect(cachedSecret.versionName).to.equal(`projects/1234/secrets/${secretId}/versions/3`);
    });
  });

  Scenario('cached secret without initial value or versions', () => {
    const secretId = `my-secret-${randomInt(1000000)}`;
    const parent = 'projects/1234';
    const secretName = path.join(parent, 'secrets', secretId);

    /** @type {SecretsCache} */
    let cache;
    before(() => {
      cache = new SecretsCache(client);
    });

    function updateMethod() {
      return 'updated-value';
    }

    Given('a secret without versions', async () => {
      await client.createSecret({
        parent: parent,
        secretId,
        secret: { versionDestroyTtl: { seconds: 86400, nanos: 0 }, replication: { automatic: {} } },
      });
    });

    And('secret is in cache without initial first version value', () => {
      cache.set(secretName, null, updateMethod);
    });

    let promisedGet;
    When('getting cached secret', () => {
      promisedGet = cache.get(secretName);
    });

    let cachedSecret;
    Then('updated version is returned', async () => {
      cachedSecret = await promisedGet;
      expect(cachedSecret.value).to.equal('updated-value');
    });

    And('cached secret current version is 1', () => {
      expect(cachedSecret.versionName).to.equal(`projects/1234/secrets/${secretId}/versions/1`);
    });
  });

  Scenario('cached secret with initial value but without any secret versions', () => {
    const secretId = `my-secret-${randomInt(1000000)}`;
    const parent = 'projects/1234';
    const secretName = path.join(parent, 'secrets', secretId);

    /** @type {SecretsCache} */
    let cache;
    before(() => {
      cache = new SecretsCache(client);
    });

    function updateMethod() {
      return 'updated-value';
    }

    Given('a secret without versions', async () => {
      await client.createSecret({
        parent: parent,
        secretId,
        secret: { versionDestroyTtl: { seconds: 86400, nanos: 0 }, replication: { automatic: {} } },
      });
    });

    And('secret is in cache without initial first version value', () => {
      cache.set(secretName, 'old-value', updateMethod);
    });

    let promisedGet;
    When('getting cached secret', () => {
      promisedGet = cache.get(secretName);
    });

    let cachedSecret;
    Then('initial value is returned', async () => {
      cachedSecret = await promisedGet;
      expect(cachedSecret.value).to.equal('old-value');
    });

    let promisedUpdate;
    When('secret is deemed invalid for some reason and wants an update', () => {
      promisedUpdate = cache.update(secretName);
    });

    Then('new updated version is saved', async () => {
      cachedSecret = await promisedUpdate;
      expect(cachedSecret.value).to.equal('updated-value');
    });

    And('cached secret current version is 1', () => {
      expect(cachedSecret.versionName).to.equal(`projects/1234/secrets/${secretId}/versions/1`);
    });
  });

  Scenario('cached secret without initial value or fetch method and without any secret versions', () => {
    const secretId = `my-secret-${randomInt(1000000)}`;
    const parent = 'projects/1234';
    const secretName = path.join(parent, 'secrets', secretId);

    /** @type {SecretsCache} */
    let cache;
    before(() => {
      cache = new SecretsCache(client);
    });

    Given('a secret without versions', async () => {
      await client.createSecret({
        parent: parent,
        secretId,
        secret: { versionDestroyTtl: { seconds: 86400, nanos: 0 }, replication: { automatic: {} } },
      });
    });

    And('secret is in cache without initial value and fetch method', () => {
      cache.set(secretName);
    });

    let promisedGet;
    When('getting cached secret', () => {
      promisedGet = cache.get(secretName).catch((err) => err);
    });

    Then('item is not updated', async () => {
      await promisedGet;
      expect((await cache.get(secretName).catch((err) => err)).value).to.be.undefined;
    });

    let promisedUpdate;
    When('attempting to update cached secret that still has no versions', () => {
      promisedUpdate = cache.update(secretName).catch((err) => err);
    });

    Then('item is not updated', async () => {
      expect((await cache.get(secretName).catch((err) => err)).value).to.be.undefined;
    });

    Given('a new version is created by someone else', async () => {
      await client.addSecretVersion({ parent: secretName, payload: { data: Buffer.from('updated-by-someone-value') } });
    });

    When('attempting to update cached secret', () => {
      promisedUpdate = cache.update(secretName);
    });

    Then('item has new secret version value', async () => {
      const cachedSecret = await promisedUpdate;
      expect(cachedSecret.value).to.equal('updated-by-someone-value');
      expect(cachedSecret.versionName).to.equal(`projects/1234/secrets/${secretId}/versions/1`);
    });
  });

  Scenario('cached secret without initial value and only one secret disabled versions', () => {
    const secretId = `my-secret-${randomInt(1000000)}`;
    const parent = 'projects/1234';
    const secretName = path.join(parent, 'secrets', secretId);

    /** @type {SecretsCache} */
    let cache;
    before(() => {
      cache = new SecretsCache(client);
    });

    Given('a secret without versions', async () => {
      await client.createSecret({
        parent: parent,
        secretId,
        secret: { versionDestroyTtl: { seconds: 86400, nanos: 0 }, replication: { automatic: {} } },
      });
    });

    And('secret is in cache without initial value and fetch method', () => {
      cache.set(secretName);
    });

    let promisedGet;
    When('getting cached secret', () => {
      promisedGet = cache.get(secretName).catch((err) => err);
    });

    Then('item is not updated', async () => {
      await promisedGet;
      expect((await cache.get(secretName).catch((err) => err)).value).to.be.undefined;
    });

    let promisedUpdate;
    When('attempting to update cached secret that still has no versions', () => {
      promisedUpdate = cache.update(secretName).catch((err) => err);
    });

    Then('item is not updated', async () => {
      expect((await cache.get(secretName).catch((err) => err)).value).to.be.undefined;
    });

    Given('a new version is created by someone else', async () => {
      await client.addSecretVersion({ parent: secretName, payload: { data: Buffer.from('updated-by-someone-value') } });
    });

    When('attempting to update cached secret', () => {
      promisedUpdate = cache.update(secretName);
    });

    Then('item has new secret version value', async () => {
      const cachedSecret = await promisedUpdate;
      expect(cachedSecret.value).to.equal('updated-by-someone-value');
      expect(cachedSecret.versionName).to.equal(`projects/1234/secrets/${secretId}/versions/1`);
    });
  });

  Scenario('secret is not in cache', () => {
    const secretId = `my-secret-${randomInt(100000)}`;
    const parent = 'projects/1234';
    const secretName = path.join(parent, 'secrets', secretId);

    /** @type {SecretsCache} */
    let cache;
    before(() => {
      cache = new SecretsCache(client);
    });

    Given('a secret with one versions', async () => {
      await client.createSecret({
        parent: parent,
        secretId,
        secret: { versionDestroyTtl: { seconds: 86400, nanos: 0 }, replication: { automatic: {} } },
      });
      await client.addSecretVersion({ parent: secretName, payload: { data: Buffer.from('initial-value') } });
    });

    let promisedGet;
    When('getting secret from cache', () => {
      promisedGet = cache.get(secretName);
    });

    Then('version one secret is returned', async () => {
      const secret = await promisedGet;
      expect(secret.value).to.equal('initial-value');
    });

    And('remaining ttl is infinity', () => {
      expect(cache.getRemainingTTL(secretName)).to.equal(Infinity);
    });
  });

  Scenario('secret is not in cache and not in gcp', () => {
    const secretId = `my-secret-${randomInt(100000)}`;
    const parent = 'projects/1234';
    const secretName = path.join(parent, 'secrets', secretId);

    /** @type {SecretsCache} */
    let cache;
    before(() => {
      cache = new SecretsCache(client);
    });

    let promisedGet;
    When('getting non-existing secret from cache', () => {
      promisedGet = cache.get(secretName).catch((err) => err);
    });

    Then('version one secret is returned', async () => {
      const secretError = await promisedGet;
      expect(secretError.code).to.equal(RpcCodes.NOT_FOUND);
    });
  });

  Scenario('secret is in cache with default value but not in gcp', () => {
    const secretId = `my-secret-${randomInt(100000)}`;
    const parent = 'projects/1234';
    const secretName = path.join(parent, 'secrets', secretId);

    /** @type {SecretsCache} */
    let cache;
    before(() => {
      cache = new SecretsCache(client);
    });

    Given('item is added to cache with default value', () => {
      cache.set(secretName, 'dummy-value');
    });

    let promisedGet;
    When('getting non-existing secret from cache', () => {
      promisedGet = cache.get(secretName);
    });

    Then('version one secret is returned', async () => {
      const secret = await promisedGet;
      expect(secret.value).to.equal('dummy-value');
    });
  });

  Scenario('Default secrets cache with default ttl', () => {
    before(() => {
      mock.timers.enable({ apis: ['Date', 'setTimeout'], now: new Date() });
    });
    after(() => mock.timers.reset());

    /** @type {SecretsCache} */
    let cache;
    Given('a cache matching scenario', () => {
      cache = new SecretsCache(client, { ttl: 60000 });
    });

    And('cache has default options', () => {
      expect(cache.cache).to.have.property('allowStale', false);
      expect(cache.cache).to.have.property('noDeleteOnStaleGet', true);
    });

    describe('item is in cache with default value and update method', () => {
      const secretId = `my-secret-${randomInt(1000000)}`;
      const parent = 'projects/1234';
      const secretName = path.join(parent, 'secrets', secretId);

      Given('a secret with one versions', async () => {
        await client.createSecret({
          parent: parent,
          secretId,
          secret: { versionDestroyTtl: { seconds: 86400, nanos: 0 }, replication: { automatic: {} } },
        });
        await client.addSecretVersion({ parent: secretName, payload: { data: Buffer.from('version-1-value') } });
      });

      let count = 0;
      And('item is in cache', () => {
        cache.set(secretName, 'default-value', () => `updated-value-${++count}`);
      });

      let promisedGet;
      When('getting secret from cache', () => {
        promisedGet = cache.get(secretName);
      });

      Then('version one secret is returned', async () => {
        const secret = await promisedGet;
        expect(secret.value).to.equal('default-value');
      });

      And('remaining ttl is default', () => {
        expect(cache.getRemainingTTL(secretName)).to.equal(60000);
      });

      Given('time has ticked beyond ttl', () => {
        mock.timers.tick(60001);
      });

      When('getting secret from cache', () => {
        promisedGet = cache.get(secretName);
      });

      Then('version one secret is returned again', async () => {
        const secret = await promisedGet;
        expect(secret.value).to.equal('version-1-value');
      });

      And('remaining ttl is default', () => {
        expect(cache.getRemainingTTL(secretName)).to.equal(60000);
      });

      Given('time has ticked beyond ttl again', () => {
        mock.timers.tick(60001);
      });

      When('getting secret from cache', () => {
        promisedGet = cache.get(secretName);
      });

      Then('update method was called and new version is returned', async () => {
        const secret = await promisedGet;
        expect(secret.value).to.equal('updated-value-1');
      });

      And('remaining ttl is default', () => {
        expect(cache.getRemainingTTL(secretName)).to.equal(60000);
      });

      Given('time has ticked beyond ttl again', () => {
        mock.timers.tick(60001);
      });

      When('getting secret from cache', () => {
        promisedGet = cache.get(secretName);
      });

      Then('update method was called and new version is returned', async () => {
        const secret = await promisedGet;
        expect(secret.value).to.equal('updated-value-2');
      });

      And('remaining ttl is default', () => {
        expect(cache.getRemainingTTL(secretName)).to.equal(60000);
      });
    });

    describe('item is not in cache', () => {
      const secretId = `my-secret-${randomInt(1000000)}`;
      const parent = 'projects/1234';
      const secretName = path.join(parent, 'secrets', secretId);

      Given('a secret with one versions', async () => {
        await client.createSecret({
          parent: parent,
          secretId,
          secret: { versionDestroyTtl: { seconds: 86400, nanos: 0 }, replication: { automatic: {} } },
        });
        await client.addSecretVersion({ parent: secretName, payload: { data: Buffer.from('initial-value') } });
      });

      /** @type {SecretsCache} */
      let cache;
      And('a cache with default ttl, disallow stale', () => {
        cache = new SecretsCache(client, { ttl: 60000, allowStale: false, noDeleteOnStaleGet: false });
      });

      let promisedGet;
      When('getting secret from cache', () => {
        promisedGet = cache.get(secretName);
      });

      Then('version one secret is returned', async () => {
        const secret = await promisedGet;
        expect(secret.value).to.equal('initial-value');
      });

      And('remaining ttl is default', () => {
        expect(cache.getRemainingTTL(secretName)).to.equal(60000);
      });

      When('time has ticked close to ttl', () => {
        mock.timers.tick(59000);
      });

      Then('remaining ttl is default', () => {
        expect(cache.getRemainingTTL(secretName)).to.be.below(60000);
      });

      Given('time has ticked beyond ttl', () => {
        mock.timers.tick(1001);
      });

      When('getting secret from cache', () => {
        promisedGet = cache.get(secretName);
      });

      Then('version one secret is returned again', async () => {
        const secret = await promisedGet;
        expect(secret.value).to.equal('initial-value');
      });

      And('remaining ttl is default', () => {
        expect(cache.getRemainingTTL(secretName)).to.equal(60000);
      });

      Given('a new version has been added to secret', async () => {
        await client.addSecretVersion({ parent: secretName, payload: { data: Buffer.from('new-value') } });
      });

      And('time has ticked beyond ttl', () => {
        mock.timers.tick(60001);
      });

      When('getting secret from cache', () => {
        promisedGet = cache.get(secretName);
      });

      Then('latest version is returned', async () => {
        const secret = await promisedGet;
        expect(secret.value).to.equal('new-value');
      });

      And('remaining ttl is default', () => {
        expect(cache.getRemainingTTL(secretName)).to.equal(60000);
      });
    });

    describe('item is in cache with default value', () => {
      const secretId = `my-secret-${randomInt(1000000)}`;
      const parent = 'projects/1234';
      const secretName = path.join(parent, 'secrets', secretId);

      Given('a secret with one versions', async () => {
        await client.createSecret({
          parent: parent,
          secretId,
          secret: { versionDestroyTtl: { seconds: 86400, nanos: 0 }, replication: { automatic: {} } },
        });
        await client.addSecretVersion({ parent: secretName, payload: { data: Buffer.from('version-1-value') } });
      });

      And('item is in cache', () => {
        cache.set(secretName, 'default-value');
      });

      let promisedGet;
      When('getting secret from cache', () => {
        promisedGet = cache.get(secretName);
      });

      Then('version one secret is returned', async () => {
        const secret = await promisedGet;
        expect(secret.value).to.equal('default-value');
      });

      And('remaining ttl is default', () => {
        expect(cache.getRemainingTTL(secretName)).to.equal(60000);
      });

      Given('time has ticked beyond ttl', () => {
        mock.timers.tick(60001);
      });

      When('getting secret from cache', () => {
        promisedGet = cache.get(secretName);
      });

      Then('version one secret is returned again', async () => {
        const secret = await promisedGet;
        expect(secret.value).to.equal('version-1-value');
      });

      And('remaining ttl is default', () => {
        expect(cache.getRemainingTTL(secretName)).to.equal(60000);
      });

      Given('time has ticked beyond ttl again', () => {
        mock.timers.tick(60001);
      });

      When('getting secret from cache', () => {
        promisedGet = cache.get(secretName);
      });

      Then('update method was called and new version is returned', async () => {
        const secret = await promisedGet;
        expect(secret.value).to.equal('version-1-value');
      });

      And('remaining ttl is default', () => {
        expect(cache.getRemainingTTL(secretName)).to.equal(60000);
      });
    });
  });

  Scenario('LRU cache with default ttl, disallow stale and delete on stale get', () => {
    before(() => {
      mock.timers.enable({ apis: ['Date', 'setTimeout'], now: new Date() });
    });
    after(() => mock.timers.reset());

    /** @type {SecretsCache} */
    let cache;
    Given('a cache matching scenario', () => {
      cache = new SecretsCache(client, { ttl: 60000, allowStale: false, noDeleteOnStaleGet: false });
    });

    describe('item is in cache with default value and update method', () => {
      const secretId = `my-secret-${randomInt(1000000)}`;
      const parent = 'projects/1234';
      const secretName = path.join(parent, 'secrets', secretId);

      Given('a secret with one versions', async () => {
        await client.createSecret({
          parent: parent,
          secretId,
          secret: { versionDestroyTtl: { seconds: 86400, nanos: 0 }, replication: { automatic: {} } },
        });
        await client.addSecretVersion({ parent: secretName, payload: { data: Buffer.from('version-1-value') } });
      });

      let count = 0;
      And('item is in cache', () => {
        cache.set(secretName, 'default-value', () => `updated-value-${++count}`);
      });

      let promisedGet;
      When('getting secret from cache', () => {
        promisedGet = cache.get(secretName);
      });

      Then('version one secret is returned', async () => {
        const secret = await promisedGet;
        expect(secret.value).to.equal('default-value');
      });

      And('remaining ttl is default', () => {
        expect(cache.getRemainingTTL(secretName)).to.equal(60000);
      });

      Given('time has ticked beyond ttl', () => {
        mock.timers.tick(60001);
      });

      When('getting secret from cache', () => {
        promisedGet = cache.get(secretName);
      });

      Then('version one secret is returned again', async () => {
        const secret = await promisedGet;
        expect(secret.value).to.equal('version-1-value');
      });

      And('remaining ttl is default', () => {
        expect(cache.getRemainingTTL(secretName)).to.equal(60000);
      });

      Given('time has ticked beyond ttl again', () => {
        mock.timers.tick(60001);
      });

      When('getting secret from cache', () => {
        promisedGet = cache.get(secretName);
      });

      Then('update method was called and new version is returned', async () => {
        const secret = await promisedGet;
        expect(secret.value).to.equal('updated-value-1');
      });

      And('remaining ttl is default', () => {
        expect(cache.getRemainingTTL(secretName)).to.equal(60000);
      });

      Given('time has ticked beyond ttl again', () => {
        mock.timers.tick(60001);
      });

      When('getting secret from cache', () => {
        promisedGet = cache.get(secretName);
      });

      Then('update method was called and new version is returned', async () => {
        const secret = await promisedGet;
        expect(secret.value).to.equal('updated-value-2');
      });

      And('remaining ttl is default', () => {
        expect(cache.getRemainingTTL(secretName)).to.equal(60000);
      });
    });

    describe('item is not in cache', () => {
      const secretId = `my-secret-${randomInt(1000000)}`;
      const parent = 'projects/1234';
      const secretName = path.join(parent, 'secrets', secretId);

      Given('a secret with one versions', async () => {
        await client.createSecret({
          parent: parent,
          secretId,
          secret: { versionDestroyTtl: { seconds: 86400, nanos: 0 }, replication: { automatic: {} } },
        });
        await client.addSecretVersion({ parent: secretName, payload: { data: Buffer.from('initial-value') } });
      });

      /** @type {SecretsCache} */
      let cache;
      And('a cache with default ttl, disallow stale', () => {
        cache = new SecretsCache(client, { ttl: 60000, allowStale: false, noDeleteOnStaleGet: false });
      });

      let promisedGet;
      When('getting secret from cache', () => {
        promisedGet = cache.get(secretName);
      });

      Then('version one secret is returned', async () => {
        const secret = await promisedGet;
        expect(secret.value).to.equal('initial-value');
      });

      And('remaining ttl is default', () => {
        expect(cache.getRemainingTTL(secretName)).to.equal(60000);
      });

      When('time has ticked close to ttl', () => {
        mock.timers.tick(59000);
      });

      Then('remaining ttl is default', () => {
        expect(cache.getRemainingTTL(secretName)).to.be.below(60000);
      });

      Given('time has ticked beyond ttl', () => {
        mock.timers.tick(1001);
      });

      When('getting secret from cache', () => {
        promisedGet = cache.get(secretName);
      });

      Then('version one secret is returned again', async () => {
        const secret = await promisedGet;
        expect(secret.value).to.equal('initial-value');
      });

      And('remaining ttl is default', () => {
        expect(cache.getRemainingTTL(secretName)).to.equal(60000);
      });

      Given('a new version has been added to secret', async () => {
        await client.addSecretVersion({ parent: secretName, payload: { data: Buffer.from('new-value') } });
      });

      And('time has ticked beyond ttl', () => {
        mock.timers.tick(60001);
      });

      When('getting secret from cache', () => {
        promisedGet = cache.get(secretName);
      });

      Then('latest version is returned', async () => {
        const secret = await promisedGet;
        expect(secret.value).to.equal('new-value');
      });

      And('remaining ttl is default', () => {
        expect(cache.getRemainingTTL(secretName)).to.equal(60000);
      });
    });

    describe('item is in cache with default value', () => {
      const secretId = `my-secret-${randomInt(1000000)}`;
      const parent = 'projects/1234';
      const secretName = path.join(parent, 'secrets', secretId);

      Given('a secret with one versions', async () => {
        await client.createSecret({
          parent: parent,
          secretId,
          secret: { versionDestroyTtl: { seconds: 86400, nanos: 0 }, replication: { automatic: {} } },
        });
        await client.addSecretVersion({ parent: secretName, payload: { data: Buffer.from('version-1-value') } });
      });

      And('item is in cache', () => {
        cache.set(secretName, 'default-value');
      });

      let promisedGet;
      When('getting secret from cache', () => {
        promisedGet = cache.get(secretName);
      });

      Then('version one secret is returned', async () => {
        const secret = await promisedGet;
        expect(secret.value).to.equal('default-value');
      });

      And('remaining ttl is default', () => {
        expect(cache.getRemainingTTL(secretName)).to.equal(60000);
      });

      Given('time has ticked beyond ttl', () => {
        mock.timers.tick(60001);
      });

      When('getting secret from cache', () => {
        promisedGet = cache.get(secretName);
      });

      Then('version one secret is returned again', async () => {
        const secret = await promisedGet;
        expect(secret.value).to.equal('version-1-value');
      });

      And('remaining ttl is default', () => {
        expect(cache.getRemainingTTL(secretName)).to.equal(60000);
      });

      Given('time has ticked beyond ttl again', () => {
        mock.timers.tick(60001);
      });

      When('getting secret from cache', () => {
        promisedGet = cache.get(secretName);
      });

      Then('update method was called and new version is returned', async () => {
        const secret = await promisedGet;
        expect(secret.value).to.equal('version-1-value');
      });

      And('remaining ttl is default', () => {
        expect(cache.getRemainingTTL(secretName)).to.equal(60000);
      });
    });
  });
});

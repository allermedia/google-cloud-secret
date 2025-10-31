import { randomInt } from 'node:crypto';
import path from 'node:path/posix';

import { SecretsCache } from '@aller/google-cloud-secret';
import secretManager from '@google-cloud/secret-manager';
import * as ck from 'chronokinesis';
import nock from 'nock';

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
  after(ck.reset);

  Scenario('cached secret without initial value', () => {
    const secretId = `my-secret-${randomInt(10000)}`;
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
    const secretId = `my-secret-${randomInt(10000)}`;
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
    const secretId = `my-secret-${randomInt(10000)}`;
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
    const secretId = `my-secret-${randomInt(10000)}`;
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
    const secretId = `my-secret-${randomInt(10000)}`;
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
    const secretId = `my-secret-${randomInt(10000)}`;
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
    const secretId = `my-secret-${randomInt(10000)}`;
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
});

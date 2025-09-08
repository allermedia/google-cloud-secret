import { randomInt, randomUUID } from 'node:crypto';
import path from 'node:path/posix';
import { mock } from 'node:test';

import { SecretsCache } from '@aller/google-cloud-secret';
import secretManager from '@google-cloud/secret-manager';
import nock from 'nock';

import { startServer, reset, RpcCodes } from '../helpers/fake-server.js';

describe('secrets cache', () => {
  let secretManagerServer;
  /** @type {import('@google-cloud/secret-manager').v1.SecretManagerServiceClient} */
  let secretManagerClient;
  before(async () => {
    secretManagerServer = await startServer();
    secretManagerClient = new secretManager.v1.SecretManagerServiceClient({
      apiEndpoint: 'localhost',
      port: secretManagerServer.origin.port,
    });

    nock('https://oauth2.googleapis.com')
      .post('/token')
      .reply(200, { id_token: 'google-auth-id-token', access_token: 'google-auth-access-token' });
  });

  after(() => {
    secretManagerClient.close();
    secretManagerServer.forceShutdown();
    reset();
    nock.cleanAll();
    mock.timers.enable({ apis: ['Date'], now: 1000 });
  });
  afterEach(() => {
    mock.timers.reset();
  });

  describe('new SecretsCache(client[, cacheOptions])', () => {
    it('can be initiated with client instance', async () => {
      const secretName = await createSecret('dummy-value-1');

      const cache = new SecretsCache(secretManagerClient);

      cache.set(secretName, undefined, getNewValue);

      const updated = await cache.update(secretName);
      expect(updated?.value).to.equal('dummy-value-1');
    });

    it('can be initiated with client options', async () => {
      nock('https://oauth2.googleapis.com')
        .post('/token')
        .reply(200, { id_token: 'google-auth-id-token', access_token: 'google-auth-access-token' });

      const secretName = await createSecret('dummy-value-1');

      const cache = new SecretsCache({
        apiEndpoint: 'localhost',
        port: secretManagerServer.origin.port,
      });

      cache.set(secretName, undefined, getNewValue);

      const updated = await cache.update(secretName);
      expect(updated?.value).to.equal('dummy-value-1');

      cache.client.close();
    });

    it('cache options is passed to LRU cache', () => {
      const cache = new SecretsCache(secretManagerClient, { max: 10 });

      expect(cache.cache.max).to.equal(10);
    });

    it('fetchMethod is ignored cache options is passed to LRU cache', () => {
      const cache = new SecretsCache(secretManagerClient, { max: 10, fetchMethod });

      expect(cache.cache.max).to.equal(10);
      expect(cache.cache.fetchMethod).to.not.equal(fetchMethod);

      function fetchMethod() {}
    });
  });

  describe('cache.get', () => {
    /** @type {SecretsCache} */
    let cache;
    before(() => {
      cache = new SecretsCache(secretManagerClient);
    });

    it('get secret with initial value returns initial value', async () => {
      const secretName = await createSecret('dummy-value-1');

      const newValue = randomUUID();
      cache.set(secretName, 'initial-dummy-value-1', getNewValue.bind(null, newValue));

      const first = await cache.get(secretName);
      expect(first?.value).to.equal('initial-dummy-value-1');

      const updated = await cache.get(secretName);
      expect(updated?.value).to.equal('initial-dummy-value-1');
    });

    it('get secret with no inital value is set updates value before returning cached secret', async () => {
      const secretName = await createSecret('dummy-value-1');

      const newValue = randomUUID();
      cache.set(secretName, undefined, getNewValue.bind(null, newValue));

      const first = await cache.get(secretName);
      expect(first?.value).to.equal('dummy-value-1');

      const updated = await cache.get(secretName);
      expect(updated?.value).to.equal('dummy-value-1');
    });

    it('get non-existing secret with no inital value', async () => {
      const secretName = 'projects/1234/non-existing-secret';

      cache.set(
        secretName,
        undefined,
        getNewValue.bind(null, () => randomUUID())
      );

      try {
        await cache.get(secretName);
      } catch (err) {
        // eslint-disable-next-line no-var
        var error = err;
      }

      expect(error?.code).to.equal(RpcCodes.NOT_FOUND);
    });

    it('get stale value keeps cached secret fetch method', async () => {
      mock.timers.enable({ apis: ['Date'], now: new Date() });

      const secretName = await createSecret('dummy-value');

      const newValue = randomUUID();
      cache.set(
        secretName,
        'dummy-value',
        (fetcherOptions) => {
          fetcherOptions.options.ttl = 10000;
          return newValue;
        },
        { ttl: 100 }
      );

      mock.timers.tick(100000);

      const updated = await cache.get(secretName);

      expect(updated?.value, 'updated value').to.equal(newValue);
      expect(cache.getRemainingTTL(secretName)).to.equal(10000);
    });

    it('get disposed cached secret returns nothing', async () => {
      mock.timers.enable({ apis: ['Date'], now: new Date(2023, 1, 28) });

      const secretName = await createSecret('dummy-value');

      const newValue = randomUUID();
      cache.set(
        secretName,
        'dummy-value',
        (fetcherOptions) => {
          fetcherOptions.options.ttl = 10000;
          return newValue;
        },
        { ttl: 100 }
      );

      mock.timers.tick(100000);

      expect(cache.cache.get(secretName)?.value, 'cached value').to.be.undefined;

      const updated = await cache.get(secretName);

      expect(updated, 'get value').to.be.undefined;
    });
  });

  describe('cache.update', () => {
    /** @type {SecretsCache} */
    let cache;
    before(() => {
      cache = new SecretsCache(secretManagerClient);
    });

    it('update when secret exists updates value', async () => {
      const secretName = await createSecret('dummy-value');

      const newValue = randomUUID();
      cache.set(secretName, 'dummy-value', getNewValue.bind(null, newValue));

      const first = await cache.get(secretName);
      expect(first.value).to.equal('dummy-value');

      const updated = await cache.update(secretName);
      expect(updated?.value).to.equal(newValue);

      const second = await cache.get(secretName);
      expect(second?.value, 'cached value').to.equal(newValue);
    });

    it('multiple update when secret exists updates value once', async () => {
      const secretName = await createSecret('dummy-value');

      cache.set(secretName, 'dummy-value', getNewValue.bind(null, false));

      const mfetch = Promise.all([await cache.update(secretName), await cache.update(secretName)]);

      expect(mfetch[0], 'waiting secrets promise are the same').to.equal(mfetch[1]);

      const [update1, update2] = await mfetch;

      expect(update1.value, 'waiting secrets values are the same').to.equal(update2.value).that.is.ok;
    });

    it('update passes cache options to update secret', async () => {
      mock.timers.enable({ apis: ['Date'], now: new Date() });

      const secretName = await createSecret('dummy-value');

      const newValue = randomUUID();
      cache.set(secretName, 'dummy-value', (fetcherOptions) => {
        fetcherOptions.options.ttl = 10000;
        return newValue;
      });

      const updated = await cache.update(secretName);

      expect(updated?.value, 'updated value').to.equal(newValue);
      expect(cache.getRemainingTTL(secretName)).to.equal(10000);
    });

    it('update cached secret without fetch method returns latest secret version value', async () => {
      const secretName = await createSecret('latest-value');

      cache.set(secretName, 'dummy-value');

      const value1 = await cache.update(secretName);

      expect(value1?.value, 'updated value').to.equal('latest-value');

      const value2 = await cache.get(secretName);

      expect(value2?.value, 'get value').to.equal('latest-value');
    });

    it('update cached secret without initial value returns latest secret version value', async () => {
      const secretName = await createSecret('latest-value');

      cache.set(secretName, undefined, () => 'updated-value');

      const value1 = await cache.update(secretName);

      expect(value1?.value, 'updated value').to.equal('latest-value');

      const value2 = await cache.get(secretName);

      expect(value2?.value, 'get value').to.equal('latest-value');
    });

    it('concurrent update and get cached secret without initial value returns latest secret version value', async () => {
      const secretName = await createSecret('latest-value');

      cache.set(secretName, undefined, () => 'updated-value');

      const mfetch = Promise.all([await cache.update(secretName), await cache.get(secretName)]);

      expect(mfetch[0], 'fetch promises').to.equal(mfetch[1]);

      const [value1, value2] = await mfetch;

      expect(value1?.value, 'get value').to.equal('latest-value');
      expect(value2?.value, 'get value').to.equal('latest-value');
    });

    it('concurrent update where update secret function fails returns initial value', async () => {
      const secretName = await createSecret('latest-value');

      cache.set(secretName, 'dummy-value', () => {
        throw new Error('foo');
      });

      const mfetch = Promise.all([await cache.update(secretName).catch(() => {}), await cache.update(secretName).catch(() => {})]);

      expect(mfetch[0], 'fetch promises').to.equal(mfetch[1]);

      await mfetch;

      const secretValue = await cache.get(secretName);

      expect(secretValue.value).to.equal('dummy-value');
    });
  });

  async function createSecret(secretValue) {
    const secretName = `projects/${randomInt(1000000)}/secrets/my-secret-${randomInt(10000).toString().padStart(5, '0')}`;

    await secretManagerClient.createSecret({
      parent: path.join(...secretName.split('/').slice(0, 2)),
      secretId: secretName.split('/').pop(),
      secret: { versionDestroyTtl: { seconds: 86400, nanos: 0 }, replication: { automatic: {} } },
    });

    await secretManagerClient.addSecretVersion({
      parent: secretName,
      payload: { data: Buffer.from(secretValue) },
    });

    return secretName;
  }
});

function getNewValue(v) {
  return new Promise((resolve) => {
    setImmediate(() => {
      return resolve(v || randomUUID());
    });
  });
}

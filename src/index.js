import path from 'node:path/posix';

import secretManager from '@google-cloud/secret-manager';
import Debug from 'debug';
import { LRUCache } from 'lru-cache';

import { RpcCodes } from './fake-server/rpc-codes.js';

const debug = Debug('aller:google-cloud-secret');

export class ConcurrentSecretError extends Error {
  /**
   * @param {string} message
   * @param {import('google-gax').Status} code
   */
  constructor(message, code) {
    super(message);
    /** @type {import('google-gax').Status} */
    this.code = code;
  }
}

export class ConcurrentSecret {
  /**
   * @param {string} name secret resource name, e.g. `projects/1234/secrets/concurrent-test-secret`
   * @param {import('google-gax').ClientOptions | import('@google-cloud/secret-manager').v1.SecretManagerServiceClient} [clientOrClientOptions] Secret Manager client instance or the options for a new one
   * @param {concurrentSecretOptions} [options] options
   */
  constructor(name, clientOrClientOptions, options) {
    this.name = name;
    this.latestVersionName = path.join(name, '/versions/latest');
    this.client =
      clientOrClientOptions instanceof secretManager.v1.SecretManagerServiceClient
        ? clientOrClientOptions
        : new secretManager.v1.SecretManagerServiceClient(clientOrClientOptions);

    /** @type {import('@google-cloud/secret-manager').protos.google.cloud.secretmanager.v1.ISecret | undefined} */
    this.secret = undefined;

    /** @type {Promise<import('@google-cloud/secret-manager').protos.google.cloud.secretmanager.v1.ISecret> | undefined} */
    this.pendingSecret = undefined;

    /**
     * Updated version name
     * @type {string|undefined}
     */
    this.updatedVersionName = undefined;

    /** @type {concurrentSecretOptions} [gracePeriodMs] Lock grace period in milliseconds, continue if secret is locked beyond grace period */
    this.options = { gracePeriodMs: 60000, ...options };
  }
  /**
   * Get latest version
   * @param {boolean} [throwOnNotFound]
   */
  async getLatestVersion(throwOnNotFound) {
    try {
      const [version] = await this.client.getSecretVersion({ name: this.latestVersionName });
      return version;
    } catch (err) {
      // @ts-ignore
      if (!throwOnNotFound && err.code === RpcCodes.NOT_FOUND) {
        return null;
      }

      throw err;
    }
  }
  /**
   * Get latest version secret data
   * @param {boolean} [throwOnNotFound]
   */
  async getLatestData(throwOnNotFound) {
    try {
      const [data] = await this.client.accessSecretVersion({ name: this.latestVersionName }, this._getCallOptions());
      return data;
    } catch (err) {
      // @ts-ignore
      if (!throwOnNotFound && err.code === RpcCodes.NOT_FOUND) {
        return null;
      }
      debug('failed to get latest data for %s', this.name, err);

      throw err;
    }
  }
  /**
   * @param {(...args: any) => Promise<string | Buffer>} fn get new secret function, call this function if a lock was acheieved
   * @param  {...any} args optional arguments to function
   * @returns {Promise<string | Buffer>} new secret version data
   */
  async optimisticUpdate(fn, ...args) {
    const secret = await this.lock();

    try {
      // eslint-disable-next-line no-var
      var secretData = await fn(...args);

      const latestVersion = await this.getLatestVersion();

      const [newVersion] = await this.client.addSecretVersion(
        {
          parent: secret.name,
          payload: { data: Buffer.from(secretData) },
        },
        this._getCallOptions()
      );

      this.updatedVersionName = newVersion.name;

      if (latestVersion && latestVersion.state !== 'DESTROYED' && !latestVersion.scheduledDestroyTime) {
        await this.client.destroySecretVersion({ name: latestVersion.name });
        debug('secret version %s destroyed', latestVersion.name);
      }

      const [updatedSecret] = await this._updateSecret({
        name: secret.name,
        etag: secret.etag,
        annotations: {
          ...secret.annotations,
          updated_at: new Date().toISOString(),
        },
      });

      this.secret = updatedSecret;
    } finally {
      await this.unlock();
    }

    return secretData;
  }
  /**
   * Lock secret by updating it so that it rotates etag
   * @returns locked secret
   */
  async lock() {
    if (this.secret) return this.secret;

    const secret = await this._prepare();

    // @ts-ignore
    const lockedAt = new Date(secret.annotations?.locked_at);

    const now = new Date();

    // @ts-ignore
    if (!isNaN(lockedAt)) {
      const gracePeriodEat = new Date(lockedAt.getTime() + this.options.gracePeriodMs);
      if (now <= gracePeriodEat) {
        throw new ConcurrentSecretError(`Secret is updated by another process since ${lockedAt.toISOString()}`, 9);
      }
    }

    const [lockedSecret] = await this._updateSecret({
      name: secret.name,
      etag: secret.etag,
      annotations: {
        ...secret.annotations,
        locked_at: now.toJSON(),
      },
    });

    this.secret = lockedSecret;

    debug('secret %s locked with etag %s', lockedSecret.name, lockedSecret.etag);

    return lockedSecret;
  }
  /**
   * Unlock secret
   */
  async unlock() {
    if (!this.secret) return;

    const secret = this.secret;
    this.secret = undefined;
    this.pendingSecret = undefined;

    // @ts-ignore
    const { locked_at, ...annotations } = secret.annotations;

    const [updatedSecret] = await this._updateSecret({
      name: secret.name,
      etag: secret.etag,
      annotations,
    });

    this.secret = updatedSecret;

    debug('secret %s released with etag %s', updatedSecret.name, updatedSecret.etag);
  }
  /**
   * @internal Prepare optimistic update
   */
  _prepare() {
    if (this.pendingSecret) return this.pendingSecret;

    debug('preparing secret %s for update', this.name);

    this.pendingSecret = this.client.getSecret({ name: this.name }, this._getCallOptions()).then(([secret]) => secret);
    return this.pendingSecret;
  }
  /**
   * @internal Get gax call options
   * @param {import('@google-cloud/secret-manager').protos.google.cloud.secretmanager.v1.ISecret} secret
   */
  _updateSecret(secret) {
    return this.client.updateSecret(
      {
        secret,
        updateMask: {
          paths: secret.annotations && ['annotations'],
        },
      },
      this._getCallOptions()
    );
  }
  /**
   * @internal Get gax call options
   * @returns {import('google-gax').CallOptions}
   */
  _getCallOptions() {
    if (typeof this.options.callOptions === 'function') {
      return this.options.callOptions();
    }
    // @ts-ignore
    return { ...this.options.callOptions };
  }
}

export default ConcurrentSecret;

export class CachedSecret extends ConcurrentSecret {
  /**
   * @param {string} name
   * @param {string} initialValue
   * @param {cachedSecretOptions & concurrentSecretOptions} options
   */
  constructor(name, initialValue, options) {
    super(name, options?.client, options);

    /**
     * Secret value
     * @type {string}
     */
    this.value = initialValue;

    /**
     * Update secret value function
     * @type {(...args: any) => Promise<string|Buffer>}
     */
    this.updateMethod = options?.updateMethod;

    /**
     * Current version name
     * @type {string|undefined}
     */
    this.versionName = options?.versionName;
  }

  /**
   * Use method to get new secret value, missing method fetches latest version data
   * @param  {...any} args
   * @returns {Promise<string>}
   */
  async update(...args) {
    if (!this.updateMethod || !this.value) {
      const secretData = await this.getLatestData(!this.updateMethod);
      if (!secretData && this.updateMethod) {
        return this._updateCachedSecret(...args);
      }

      debug('cached secret %s lacks updateMethod, using latest version', this.name);

      this.versionName = secretData.name;
      this.value = secretData.payload.data?.toString();

      return this.value;
    } else if (!this.versionName) {
      debug('cached secret %s lacks secret version information', this.name);
      const latestVersionData = await this.getLatestData();
      if (!latestVersionData) {
        debug('%s lacks versions, updating secret', this.name);
        return this._updateCachedSecret(...args);
      }

      this.versionName = latestVersionData.name;

      debug('%s last version is %s', this.name, latestVersionData.name);

      if (Buffer.from(this.value).compare(Buffer.from(latestVersionData.payload.data)) !== 0) {
        debug('latest version differs from cached value, using latest secret value');
        this.value = latestVersionData.payload.data.toString();
        return this.value;
      }

      return this._updateCachedSecret(...args);
    }

    debug('cached secret %s has version %s, checking for new version before update', this.name, this.versionName);

    const latestVersionData = await this.getLatestData();

    if (latestVersionData.name > this.versionName) {
      debug('a more recent version %s is present, using latest secret value', latestVersionData.name);
      this.versionName = latestVersionData.name;
      this.value = latestVersionData.payload.data.toString();
      return this.value;
    }

    return this._updateCachedSecret(...args);
  }

  /**
   * Update cached secret value and version name
   * @param  {...any} args
   * @returns {Promise<string>}
   */
  async _updateCachedSecret(...args) {
    this.value = (await this.optimisticUpdate(this.updateMethod, ...args))?.toString();
    this.versionName = this.updatedVersionName;
    return this.value;
  }

  /**
   * Clone current secret with new value
   * @param {string|Buffer} newValue
   * @returns {CachedSecret}
   */
  clone(newValue) {
    // @ts-ignore
    return new this.constructor(this.name, newValue, { ...this.options, versionName: this.versionName });
  }
}

export class SecretsCache {
  /**
   * @param {import('google-gax').ClientOptions | import('@google-cloud/secret-manager').v1.SecretManagerServiceClient} [clientOrClientOptions] Secret Manager client instance or the options for a new one
   * @param {Omit<LRUCache.Options<string, CachedSecret, any>,'fetchMethod'>} [cacheOptions] LRU Cache options
   */
  constructor(clientOrClientOptions, cacheOptions) {
    /** @type {import('@google-cloud/secret-manager').v1.SecretManagerServiceClient} */
    const client = (this.client =
      clientOrClientOptions instanceof secretManager.v1.SecretManagerServiceClient
        ? clientOrClientOptions
        : new secretManager.v1.SecretManagerServiceClient(clientOrClientOptions));

    this.cache = new LRUCache({
      max: 500,
      allowStale: false,
      noDeleteOnStaleGet: true,
      noDeleteOnFetchRejection: true,
      ...cacheOptions,
      async fetchMethod(key, staleValue, fetcherOptions) {
        if (!staleValue) {
          debug('secret %s is not in cache', key);
          const secret = new CachedSecret(key, null, { client });
          await secret.update();
          return secret;
        }

        const updatedValue = await staleValue.update(fetcherOptions);
        return staleValue.clone(updatedValue);
      },
    });
  }
  /**
   * Get cached secret
   * @param {string} name
   */
  get(name) {
    return this.cache.fetch(name);
  }
  /**
   * Set cached secret
   * @param {string} name
   * @param {string} [initialValue] initial value
   * @param {(options: LRUCache.FetcherOptions<string, CachedSecret, any>) => Promise<string|Buffer>} [updateMethod] function to use when to update secret with new value, if omitted return latest secret version data
   * @param {concurrentSecretOptions & cachedSetSecretOptions} [options] cached secret options, plus ttl which is passed to underlying cache
   */
  set(name, initialValue, updateMethod, options) {
    this.cache.set(name, new CachedSecret(name, initialValue, { updateMethod, client: this.client, ...options }), {
      ttl: options?.ttl,
    });
    if (!initialValue) this.cache.fetch(name, { forceRefresh: true });
  }
  /**
   * Update secret and return cached secret with new value
   * @param {string} name
   */
  update(name) {
    return this.cache.fetch(name, { forceRefresh: true });
  }
  /**
   * Get cached secret remaining ttl
   * @param {string} name
   */
  getRemainingTTL(name) {
    return this.cache.getRemainingTTL(name);
  }
}

/**
 * @typedef {object} concurrentSecretOptions
 * @property {number} [gracePeriodMs] lock grace period in milliseconds, continue if secret is locked beyond grace period, default is 60000ms
 * @property {()=>import('google-gax').CallOptions|import('google-gax').CallOptions} [callOptions] optional function to pass other args to pass to each request, tracing for instance
 *
 * @typedef {object} cachedSetSecretOptions
 * @property {number} [ttl] Time to live
 *
 * @typedef {object} cachedSecretOptions
 * @property {(...args: any) => Promise<string|Buffer>} [updateMethod] use this method to update with new secret value
 * @property {import('google-gax').ClientOptions | import('@google-cloud/secret-manager').v1.SecretManagerServiceClient} [client] Secret Manager client instance or the options for a new one
 * @property {string} [versionName] version name
 */

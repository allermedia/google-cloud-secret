import path from 'node:path/posix';

import secretManager from '@google-cloud/secret-manager';
import Debug from 'debug';

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
   * @param {import('google-gax').ClientOptions | import('@google-cloud/secret-manager').v1.SecretManagerServiceClient} [clientOptions] Secret Manager client instance or the options for a new one
   * @param {concurrentSecretOptions} [options] options
   */
  constructor(name, clientOptions, options) {
    this.name = name;
    this.latestVersionName = path.join(name, '/versions/latest');
    this.client =
      clientOptions instanceof secretManager.v1.SecretManagerServiceClient
        ? clientOptions
        : new secretManager.v1.SecretManagerServiceClient(clientOptions);

    /** @type {import('@google-cloud/secret-manager').protos.google.cloud.secretmanager.v1.ISecret | undefined} */
    this.secret = undefined;

    /** @type {Promise<import('@google-cloud/secret-manager').protos.google.cloud.secretmanager.v1.ISecret> | undefined} */
    this.pendingSecret = undefined;

    /** @type {import('@google-cloud/secret-manager').protos.google.cloud.secretmanager.v1.ISecretVersion | undefined} */
    this.secretVersion = undefined;

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
      if (!throwOnNotFound && err.code === 5) {
        return null;
      }

      throw err;
    }
  }
  /**
   * Get latest version secret data
   */
  async getLatestData() {
    const [data] = await this.client.accessSecretVersion({ name: this.latestVersionName }, this._getCallOptions());
    return data;
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

      await this.client.addSecretVersion(
        {
          parent: secret.name,
          payload: { data: Buffer.from(secretData) },
        },
        this._getCallOptions()
      );

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

    debug('preparing secret %s', this.name);

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

/**
 * @typedef {object} concurrentSecretOptions
 * @property {number} [gracePeriodMs] lock grace period in milliseconds, continue if secret is locked beyond grace period, default is 60000ms
 * @property {()=>import('google-gax').CallOptions|import('google-gax').CallOptions} [callOptions] optional function to pass other args to pass to each request, tracing for instance
 */

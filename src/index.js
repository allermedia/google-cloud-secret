import path from 'node:path/posix';

import secretManager from '@google-cloud/secret-manager';

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
   * @param {import('google-gax').ClientOptions | import('@google-cloud/secret-manager').v1.SecretManagerServiceClient} [clientOptions]
   * @param {number} [gracePeriodMs] lock grace period in milliseconds, continue if secret is locked beyond grace period
   */
  constructor(name, clientOptions, gracePeriodMs) {
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

    /** @type {number} [gracePeriodMs] Lock grace period in milliseconds, continue if secret is locked beyond grace period */
    this.gracePeriodMs = gracePeriodMs ?? 60000;
  }
  /**
   * Prepare optimistic update
   * @internal
   */
  _prepare() {
    if (this.pendingSecret) return this.pendingSecret;
    this.pendingSecret = this.client.getSecret({ name: this.name }).then(([secret]) => secret);
    return this.pendingSecret;
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
    const [data] = await this.client.accessSecretVersion({ name: this.latestVersionName });
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

      await this.client.addSecretVersion({ parent: secret.name, payload: { data: Buffer.from(secretData) } });
      if (latestVersion && latestVersion.state !== 'DESTROYED' && !latestVersion.scheduledDestroyTime) {
        await this.client.destroySecretVersion({ name: latestVersion.name });
      }

      const [updatedSecret] = await this.client.updateSecret({
        secret: {
          name: secret.name,
          etag: secret.etag,
          annotations: {
            ...secret.annotations,
            updated_at: new Date().toISOString(),
          },
        },
        updateMask: {
          paths: ['annotations'],
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
      const gracePeriodEat = new Date(lockedAt.getTime() + this.gracePeriodMs);

      if (now <= gracePeriodEat) {
        throw new ConcurrentSecretError(`Secret is updated by another process since ${lockedAt.toISOString()}`, 9);
      }
    }

    const [lockedSecret] = await this.client.updateSecret({
      secret: {
        name: secret.name,
        etag: secret.etag,
        annotations: {
          ...secret.annotations,
          locked_at: now.toJSON(),
        },
      },
      updateMask: {
        paths: ['annotations'],
      },
    });

    this.secret = lockedSecret;

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

    const [updatedSecret] = await this.client.updateSecret({
      secret: {
        name: secret.name,
        etag: secret.etag,
        annotations,
      },
      updateMask: {
        paths: ['annotations'],
      },
    });
    this.secret = updatedSecret;
  }
}

export default ConcurrentSecret;

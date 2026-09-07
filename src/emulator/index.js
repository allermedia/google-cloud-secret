import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import path from 'node:path/posix';

import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
// import { ReflectionService } from '@grpc/reflection';
import Debug from 'debug';
import Long from 'long';

import { RpcCodes } from './rpc-codes.js';

export { RpcCodes } from './rpc-codes.js';

const debug = Debug('aller:google-cloud-secret:emulator');

const validSecretNamePattern = /^projects\/\d+\/secrets\/[\w-]+$/;

class EmulatorRpcError extends Error {
  /**
   * @param {string} message
   * @param {number} code
   */
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}

class EmulatorRpcMismatchingEtagError extends EmulatorRpcError {
  constructor() {
    super(
      "The etag provided in the request does not match the resource's current etag. Please retry the whole read-modify-write with exponential backoff.",
      RpcCodes.FAILED_PRECONDITION
    );
  }
}

class EmulatorRpcSecretNotFoundError extends EmulatorRpcError {
  /**
   * @param {string} name secret name
   */
  constructor(name) {
    super(`Secret [${name}] not found.`, RpcCodes.NOT_FOUND);
  }
}

/**
 * Secret Manager emulator service implementation
 */
export class SecretManagerEmulator {
  /**
   * @param {Map<string, EmulatorSecret>} [secrets] backing secret store, e.g. prefilled with secrets, defaults to a new empty store
   */
  constructor(secrets) {
    /** @type {Map<string, EmulatorSecret>} */
    this.secrets = secrets ?? new Map();
  }

  /**
   * @param {import('types').AddSecretRequest} req
   * @param {CallableFunction} respond
   */
  CreateSecret(req, respond) {
    const payload = req.request;

    const name = path.join(payload.parent, 'secrets', payload.secretId);

    if (!validSecretNamePattern.test(name)) {
      return respond(new EmulatorRpcError('Invalid resource field value in the request.', RpcCodes.INVALID_ARGUMENT));
    }

    if (this.secrets.has(name)) {
      return respond(new EmulatorRpcError(`${name} already exists`, RpcCodes.ALREADY_EXISTS));
    }

    debug('create secret %s', name);

    const now = new Date();

    /** @type {import('@google-cloud/secret-manager').protos.google.cloud.secretmanager.v1.ISecret} */
    const secret = {
      topics: [],
      labels: {},
      versionAliases: {},
      annotations: {},
      tags: {},
      rotation: null,
      versionDestroyTtl: null,
      customerManagedEncryption: null,
      ...payload.secret,
      name,
      replication: {
        ...payload.secret.replication,
        // @ts-ignore
        replication: !payload.secret.replication?.automatic ? 'userManaged' : 'automatic',
      },
      etag: generateEtag(),
      createTime: {
        nanos: now.getUTCMilliseconds() * 1e6,
        seconds: Math.floor(now.setUTCMilliseconds(0) / 1000),
      },
    };

    this.secrets.set(name, { metadata: req.metadata, secret, versions: [] });

    debug('secret %s created', name);

    respond(null, secret);
  }

  /**
   * @param {import('types').GetSecretRequest} req
   * @param {CallableFunction} respond
   */
  GetSecret(req, respond) {
    const name = req.request.name;

    if (!validSecretNamePattern.test(name)) {
      return respond(new EmulatorRpcError('Invalid resource field value in the request.', RpcCodes.INVALID_ARGUMENT));
    }

    let storedSecret;
    if (!(storedSecret = this.secrets.get(name))) {
      return respond(new EmulatorRpcSecretNotFoundError(name));
    }

    respond(null, { ...storedSecret.secret });
  }

  /**
   * @param {import('types').AddSecretVersionRequest} req
   * @param {CallableFunction} respond
   */
  AddSecretVersion(req, respond) {
    const payload = req.request;

    if (!validSecretNamePattern.test(payload.parent)) {
      return respond(new EmulatorRpcError('Invalid resource field value in the request.', RpcCodes.INVALID_ARGUMENT));
    }

    const parentSecret = this.secrets.get(payload.parent);

    if (!parentSecret) {
      return respond(new EmulatorRpcSecretNotFoundError(payload.parent));
    }

    const now = new Date();

    debug('add secret version to %s', payload.parent, req.metadata.getMap());

    /** @type {import('@google-cloud/secret-manager').protos.google.cloud.secretmanager.v1.ISecretVersion} */
    const secretVersion = {
      name: path.join(payload.parent, 'versions', (parentSecret.versions.length + 1).toString()),
      etag: generateEtag(),
      state: 'ENABLED',
      createTime: {
        nanos: now.getUTCMilliseconds() * 1e6,
        seconds: Math.floor(now.setUTCMilliseconds(0) / 1000),
      },
    };

    parentSecret.versions.unshift({
      version: secretVersion,
      ...(payload.payload.data && { data: Buffer.from(payload.payload.data) }),
    });

    respond(null, secretVersion);
  }

  /**
   * Disable version, the method is idempotent but etag is updated
   * @param {import('types').DisableSecretVersionRequest} req
   * @param {CallableFunction} respond
   */
  DisableSecretVersion(req, respond) {
    const payload = req.request;
    const parts = payload.name.split('/');
    parts.splice(-2);
    const parent = path.join(...parts);

    let storedSecret;
    if (!(storedSecret = this.secrets.get(parent))) {
      return respond(new EmulatorRpcSecretNotFoundError(parent));
    }

    const storedVersion = storedSecret.versions.find((v) => v.version.name === payload.name);
    if (!storedVersion) {
      return respond(new EmulatorRpcError(`Secret Version [${payload.name}] not found.`, RpcCodes.NOT_FOUND));
    }

    if (payload.etag && payload.etag !== storedVersion.version.etag) {
      return respond(new EmulatorRpcMismatchingEtagError());
    }

    storedVersion.version.state = 'DISABLED';
    storedVersion.version.etag = generateEtag();

    respond(null, storedVersion.version);
  }

  /**
   * Enable version, the method is idempotent but etag is updated
   * @param {import('types').EnableSecretVersionRequest} req
   * @param {CallableFunction} respond
   */
  EnableSecretVersion(req, respond) {
    const payload = req.request;
    const parts = payload.name.split('/');
    parts.splice(-2);
    const parent = path.join(...parts);

    let storedSecret;
    if (!(storedSecret = this.secrets.get(parent))) {
      return respond(new EmulatorRpcSecretNotFoundError(parent));
    }

    const storedVersion = storedSecret.versions.find((v) => v.version.name === payload.name);
    if (!storedVersion) {
      return respond(new EmulatorRpcError(`Secret Version [${payload.name}] not found.`, RpcCodes.NOT_FOUND));
    }

    if (payload.etag && payload.etag !== storedVersion.version.etag) {
      return respond(new EmulatorRpcMismatchingEtagError());
    }

    storedVersion.version.state = 'ENABLED';
    storedVersion.version.etag = generateEtag();

    respond(null, storedVersion.version);
  }

  /**
   * Get secret version
   * @param {any} req
   * @param {CallableFunction} respond
   */
  GetSecretVersion(req, respond) {
    const payload = req.request;
    const parts = payload.name.split('/');
    const [, version] = parts.splice(-2);
    const parent = path.join(...parts);

    let storedSecret;
    if (!(storedSecret = this.secrets.get(parent))) {
      return respond(new EmulatorRpcSecretNotFoundError(parent));
    }

    storedSecret.metadata = req.metadata;

    const storedVersions = storedSecret.versions;
    const storedVersion = version === 'latest' ? storedVersions[0] : storedVersions.find((v) => v.version.name === payload.name);

    if (!storedVersion) {
      return respond(
        new EmulatorRpcError(
          !storedVersions.length ? `Secret [${parent}] not found or has no versions.` : `Secret Version [${payload.name}] not found.`,
          RpcCodes.NOT_FOUND
        )
      );
    }

    respond(null, storedVersion.version);
  }

  /**
   * List secret versions
   * @param {any} req
   * @param {CallableFunction} respond
   */
  ListSecretVersions(req, respond) {
    let storedSecret;
    if (!(storedSecret = this.secrets.get(req.request.parent))) {
      return respond(new EmulatorRpcSecretNotFoundError(req.request.parent));
    }

    const versions = storedSecret.versions.map((v) => v.version);

    /** @type {import('@google-cloud/secret-manager').protos.google.cloud.secretmanager.v1.IListSecretVersionsResponse} */
    const response = {
      totalSize: versions.length,
      versions,
    };

    respond(null, response);
  }

  /**
   * Destroy secret version
   * @param {any} req
   * @param {CallableFunction} respond
   */
  DestroySecretVersion(req, respond) {
    const payload = req.request;
    const parts = payload.name.split('/');
    parts.splice(-2);
    const parent = path.join(...parts);

    let storedSecret;
    if (!(storedSecret = this.secrets.get(parent))) {
      return respond(new EmulatorRpcSecretNotFoundError(parent));
    }

    const storedVersion = storedSecret.versions.find((v) => v.version.name === payload.name);

    if (!storedVersion) {
      return respond(new EmulatorRpcError(`Secret Version [${payload.name}] not found.`, RpcCodes.NOT_FOUND));
    }

    if (storedVersion.version.state === 'DESTROYED') {
      return respond(new EmulatorRpcError('SecretVersion.state is already DESTROYED.', RpcCodes.FAILED_PRECONDITION));
    }

    if (storedVersion.version.scheduledDestroyTime) {
      return respond(new EmulatorRpcError('SecretVersion is already scheduled for DESTRUCTION.', RpcCodes.FAILED_PRECONDITION));
    }

    if (payload.etag && payload.etag !== storedVersion.version.etag) {
      return respond(new EmulatorRpcMismatchingEtagError());
    }

    const now = new Date();

    storedVersion.version.etag = generateEtag();
    storedSecret.metadata = req.metadata;

    if (storedSecret.secret.versionDestroyTtl) {
      storedVersion.version.state = 'DISABLED';

      const seconds = storedSecret.secret.versionDestroyTtl.seconds;
      const nSeconds = seconds instanceof Long ? seconds.toNumber() : Number(seconds);

      const destroy = new Date(now);
      destroy.setSeconds(destroy.getSeconds() + nSeconds);
      destroy.setMilliseconds(destroy.getUTCMilliseconds() + (storedSecret.secret.versionDestroyTtl.nanos ?? 0) / 1e6);

      storedVersion.version.scheduledDestroyTime = {
        nanos: destroy.getUTCMilliseconds() * 1e6,
        seconds: Math.floor(destroy.setUTCMilliseconds(0) / 1000),
      };
    } else {
      storedVersion.version.state = 'DESTROYED';

      storedVersion.version.destroyTime = {
        nanos: now.getUTCMilliseconds() * 1e6,
        seconds: Math.floor(now.setUTCMilliseconds(0) / 1000),
      };
    }

    respond(null, storedVersion.version);
  }

  /**
   * Update secret, the method is idempotent but etag is updated
   * @param {import('types').UpdatesSecretRequest} req
   * @param {CallableFunction} respond
   */
  UpdateSecret(req, respond) {
    const payload = req.request;
    const name = payload.secret?.name;

    let storedSecret;
    if (!(storedSecret = this.secrets.get(name))) {
      return respond(new EmulatorRpcSecretNotFoundError(name));
    }

    if (payload.secret?.etag && payload.secret?.etag !== storedSecret.secret.etag) {
      return respond(new EmulatorRpcMismatchingEtagError());
    }

    if (payload.updateMask?.paths?.length) {
      for (const prop of payload.updateMask.paths) {
        // @ts-ignore
        storedSecret.secret[prop] = payload.secret[prop];
      }
    }

    debug('secret %s was updated', name, req.metadata.getMap());

    storedSecret.metadata = req.metadata;
    storedSecret.secret.etag = generateEtag();

    respond(null, storedSecret.secret);
  }

  /**
   * Access secret version data
   * @param {import('types').AccessSecretVersionRequest} req
   * @param {CallableFunction} respond
   */
  AccessSecretVersion(req, respond) {
    const payload = req.request;
    const parts = payload.name.split('/');
    const [, version] = parts.splice(-2);
    const parent = path.join(...parts);

    let storedSecret;
    if (!(storedSecret = this.secrets.get(parent))) {
      return respond(new EmulatorRpcSecretNotFoundError(parent));
    }

    const storedVersions = storedSecret.versions;
    const storedVersion = version === 'latest' ? storedVersions[0] : storedVersions.find((v) => v.version.name === payload.name);

    if (!storedVersion) {
      return respond(
        new EmulatorRpcError(
          !storedVersions.length ? `Secret [${parent}] not found or has no versions.` : `Secret Version [${payload.name}] not found.`,
          RpcCodes.NOT_FOUND
        )
      );
    }

    respond(null, { name: storedVersion.version.name, payload: { data: storedVersion.data } });
  }

  /**
   * Delete secret
   * @param {import('types').DeleteSecretRequest} req
   * @param {CallableFunction} respond
   */
  DeleteSecret(req, respond) {
    const payload = req.request;
    const { name, etag } = payload;

    let storedSecret;
    if (!(storedSecret = this.secrets.get(name))) {
      return respond(new EmulatorRpcSecretNotFoundError(name));
    }

    if (etag && etag !== storedSecret.secret.etag) {
      return respond(new EmulatorRpcMismatchingEtagError());
    }

    this.secrets.delete(name);

    return respond(null, {});
  }
}

const nodeRequire = createRequire(import.meta.url);
const secretManagerPkg = nodeRequire.resolve('@google-cloud/secret-manager/package.json');
const secretManagerProtoDir = join(dirname(secretManagerPkg), 'build/protos');
// google-gax does not export its package.json, resolve protos relative to its main entry (build/src/index.js)
const gaxProtoDir = join(dirname(createRequire(secretManagerPkg).resolve('google-gax')), '../protos');

const servicePackageDefinition = protoLoader.loadSync(['google/cloud/secretmanager/v1/service.proto'], {
  includeDirs: [gaxProtoDir, secretManagerProtoDir],
});

const serviceProto = grpc.loadPackageDefinition(servicePackageDefinition);

/**
 * Start emulator with its own secret store, or a prefilled one passed in options
 * @param {EmulatorOptions} [options] Emulator options
 * @returns {Promise<EmulatorServer>} Secret Manager gRPC emulator server
 */
export async function startServer(options) {
  const requestedPort = options?.port ?? 0;
  const credentials =
    options?.credentials ??
    (options?.cert ? grpc.ServerCredentials.createSsl(null, options.cert, false) : grpc.ServerCredentials.createInsecure());
  const service = new SecretManagerEmulator(options?.secrets);
  const secrets = service.secrets;

  debug('start server at port %d', requestedPort);
  const server = new grpc.Server();

  // @ts-ignore
  server.addService(serviceProto.google.cloud.secretmanager.v1.SecretManagerService.service, service);
  debug('added emulator service implementation');

  //// import { ReflectionService } from '@grpc/reflection';
  // const reflection = new ReflectionService(servicePackageDefinition);
  // reflection.addToServer(server);

  const port = await new Promise((resolve, reject) => {
    server.bindAsync(`0.0.0.0:${requestedPort}`, credentials, (err, boundPort) => {
      if (err) {
        return reject(err);
      }
      debug('service started at %d', boundPort);
      resolve(boundPort);
    });
  });

  Object.defineProperties(server, {
    origin: {
      enumerable: true,
      get() {
        return { hostname: 'localhost', port };
      },
    },
    secrets: {
      enumerable: true,
      value: secrets,
    },
    getSecret: {
      /** @param {string} name secret name */
      value: function getSecret(name) {
        return secrets.get(name);
      },
    },
    reset: {
      value: function reset() {
        secrets.clear();
      },
    },
  });

  return /** @type {EmulatorServer} */ (server);
}

function generateEtag() {
  return `"${randomBytes(7).toString('hex')}"`;
}

/**
 * @typedef {import('@grpc/grpc-js').Server & {
 *   origin: { hostname: string, port: number },
 *   secrets: Map<string, EmulatorSecret>,
 *   getSecret: (name: string) => EmulatorSecret | undefined,
 *   reset: () => void,
 * }} EmulatorServer
 *
 * @typedef {object} EmulatorOptions
 * @property {import('@grpc/grpc-js').KeyCertPair[]} [cert] server TLS certs, e.g. from mkcert, starts a TLS server
 * @property {import('@grpc/grpc-js').ServerCredentials} [credentials] server credentials, takes precedence over cert; defaults to SSL credentials built from cert, or insecure credentials when neither is given — then connect the client with `sslCreds: grpc.credentials.createInsecure()`
 * @property {number} [port] gRPC server port, defaults to 0 which lets the OS assign a free port
 * @property {Map<string, EmulatorSecret>} [secrets] backing secret store, e.g. prefilled with secrets, defaults to a new empty store
 *
 * @typedef {object} EmulatorSecretVersion
 * @property {import('@google-cloud/secret-manager').protos.google.cloud.secretmanager.v1.ISecretVersion} version secret versions
 * @property {Buffer} [data] secret data
 *
 * @typedef {object} EmulatorSecret
 * @property {import('@google-cloud/secret-manager').protos.google.cloud.secretmanager.v1.ISecret} secret Secret
 * @property {EmulatorSecretVersion[]} versions secret versions
 * @property {import('@grpc/grpc-js').Metadata} metadata last request metadata
 */

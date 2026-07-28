import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path/posix';

import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
// import { ReflectionService } from '@grpc/reflection';
import Debug from 'debug';
import Long from 'long';

import { RpcCodes } from './rpc-codes.js';

export { RpcCodes } from './rpc-codes.js';

const debug = Debug('aller:google-cloud-secret:fake-server');

const validSecretNamePattern = /^projects\/\d+\/secrets\/[\w-]+$/;

class FakeRpcError extends Error {
  /**
   * @param {string} message
   * @param {number} code
   */
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}

class FakeRpcMismatchingEtagError extends FakeRpcError {
  constructor() {
    super(
      "The etag provided in the request does not match the resource's current etag. Please retry the whole read-modify-write with exponential backoff.",
      RpcCodes.FAILED_PRECONDITION
    );
  }
}

class FakeRpcSecretNotFoundError extends FakeRpcError {
  /**
   * @param {string} name secret name
   */
  constructor(name) {
    super(`Secret [${name}] not found.`, RpcCodes.NOT_FOUND);
  }
}

/**
 * Fake Secret Manager service implementation
 */
export class FakeSecretManager {
  /**
   * @param {Map<string, FakeSecretData>} [secrets] backing secret store, e.g. prefilled with secrets, defaults to a new empty store
   */
  constructor(secrets) {
    /** @type {Map<string, FakeSecretData>} */
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
      return respond(new FakeRpcError('Invalid resource field value in the request.', RpcCodes.INVALID_ARGUMENT));
    }

    if (this.secrets.has(name)) {
      return respond(new FakeRpcError(`${name} already exists`, RpcCodes.ALREADY_EXISTS));
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
      return respond(new FakeRpcError('Invalid resource field value in the request.', RpcCodes.INVALID_ARGUMENT));
    }

    let fakeSecret;
    if (!(fakeSecret = this.secrets.get(name))) {
      return respond(new FakeRpcSecretNotFoundError(name));
    }

    respond(null, { ...fakeSecret.secret });
  }

  /**
   * @param {import('types').AddSecretVersionRequest} req
   * @param {CallableFunction} respond
   */
  AddSecretVersion(req, respond) {
    const payload = req.request;

    if (!validSecretNamePattern.test(payload.parent)) {
      return respond(new FakeRpcError('Invalid resource field value in the request.', RpcCodes.INVALID_ARGUMENT));
    }

    const parentSecret = this.secrets.get(payload.parent);

    if (!parentSecret) {
      return respond(new FakeRpcSecretNotFoundError(payload.parent));
    }

    const now = new Date();

    debug('add secret version to %s', payload.parent, req.metadata.getMap());

    /** @type {import('@google-cloud/secret-manager').protos.google.cloud.secretmanager.v1.ISecretVersion} */
    const fakeVersion = {
      name: path.join(payload.parent, 'versions', (parentSecret.versions.length + 1).toString()),
      etag: generateEtag(),
      state: 'ENABLED',
      createTime: {
        nanos: now.getUTCMilliseconds() * 1e6,
        seconds: Math.floor(now.setUTCMilliseconds(0) / 1000),
      },
    };

    parentSecret.versions.unshift({
      version: fakeVersion,
      ...(payload.payload.data && { data: Buffer.from(payload.payload.data) }),
    });

    respond(null, fakeVersion);
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

    let fakeSecret;
    if (!(fakeSecret = this.secrets.get(parent))) {
      return respond(new FakeRpcSecretNotFoundError(parent));
    }

    const fakeVersion = fakeSecret.versions.find((v) => v.version.name === payload.name);
    if (!fakeVersion) {
      return respond(new FakeRpcError(`Secret Version [${payload.name}] not found.`, RpcCodes.NOT_FOUND));
    }

    if (payload.etag && payload.etag !== fakeVersion.version.etag) {
      return respond(new FakeRpcMismatchingEtagError());
    }

    fakeVersion.version.state = 'DISABLED';
    fakeVersion.version.etag = generateEtag();

    respond(null, fakeVersion.version);
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

    let fakeSecret;
    if (!(fakeSecret = this.secrets.get(parent))) {
      return respond(new FakeRpcSecretNotFoundError(parent));
    }

    const fakeVersion = fakeSecret.versions.find((v) => v.version.name === payload.name);
    if (!fakeVersion) {
      return respond(new FakeRpcError(`Secret Version [${payload.name}] not found.`, RpcCodes.NOT_FOUND));
    }

    if (payload.etag && payload.etag !== fakeVersion.version.etag) {
      return respond(new FakeRpcMismatchingEtagError());
    }

    fakeVersion.version.state = 'ENABLED';
    fakeVersion.version.etag = generateEtag();

    respond(null, fakeVersion.version);
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

    let fakeSecret;
    if (!(fakeSecret = this.secrets.get(parent))) {
      return respond(new FakeRpcSecretNotFoundError(parent));
    }

    fakeSecret.metadata = req.metadata;

    const fakeVersions = fakeSecret.versions;
    const fakeVersion = version === 'latest' ? fakeVersions[0] : fakeVersions.find((v) => v.version.name === payload.name);

    if (!fakeVersion) {
      return respond(
        new FakeRpcError(
          !fakeVersions.length ? `Secret [${parent}] not found or has no versions.` : `Secret Version [${payload.name}] not found.`,
          RpcCodes.NOT_FOUND
        )
      );
    }

    respond(null, fakeVersion.version);
  }

  /**
   * List secret versions
   * @param {any} req
   * @param {CallableFunction} respond
   */
  ListSecretVersions(req, respond) {
    let fakeSecret;
    if (!(fakeSecret = this.secrets.get(req.request.parent))) {
      return respond(new FakeRpcSecretNotFoundError(req.request.parent));
    }

    const versions = fakeSecret.versions.map((v) => v.version);

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

    let fakeSecret;
    if (!(fakeSecret = this.secrets.get(parent))) {
      return respond(new FakeRpcSecretNotFoundError(parent));
    }

    const fakeVersion = fakeSecret.versions.find((v) => v.version.name === payload.name);

    if (!fakeVersion) {
      return respond(new FakeRpcError(`Secret Version [${payload.name}] not found.`, RpcCodes.NOT_FOUND));
    }

    if (fakeVersion.version.state === 'DESTROYED') {
      return respond(new FakeRpcError('SecretVersion.state is already DESTROYED.', RpcCodes.FAILED_PRECONDITION));
    }

    if (fakeVersion.version.scheduledDestroyTime) {
      return respond(new FakeRpcError('SecretVersion is already scheduled for DESTRUCTION.', RpcCodes.FAILED_PRECONDITION));
    }

    if (payload.etag && payload.etag !== fakeVersion.version.etag) {
      return respond(new FakeRpcMismatchingEtagError());
    }

    const now = new Date();

    fakeVersion.version.etag = generateEtag();
    fakeSecret.metadata = req.metadata;

    if (fakeSecret.secret.versionDestroyTtl) {
      fakeVersion.version.state = 'DISABLED';

      const seconds = fakeSecret.secret.versionDestroyTtl.seconds;
      const nSeconds = seconds instanceof Long ? seconds.toNumber() : Number(seconds);

      const destroy = new Date(now);
      destroy.setSeconds(destroy.getSeconds() + nSeconds);
      destroy.setMilliseconds(destroy.getUTCMilliseconds() + (fakeSecret.secret.versionDestroyTtl.nanos ?? 0) / 1e6);

      fakeVersion.version.scheduledDestroyTime = {
        nanos: destroy.getUTCMilliseconds() * 1e6,
        seconds: Math.floor(destroy.setUTCMilliseconds(0) / 1000),
      };
    } else {
      fakeVersion.version.state = 'DESTROYED';

      fakeVersion.version.destroyTime = {
        nanos: now.getUTCMilliseconds() * 1e6,
        seconds: Math.floor(now.setUTCMilliseconds(0) / 1000),
      };
    }

    respond(null, fakeVersion.version);
  }

  /**
   * Update secret, the method is idempotent but etag is updated
   * @param {import('types').UpdatesSecretRequest} req
   * @param {CallableFunction} respond
   */
  UpdateSecret(req, respond) {
    const payload = req.request;
    const name = payload.secret?.name;

    let fakeSecret;
    if (!(fakeSecret = this.secrets.get(name))) {
      return respond(new FakeRpcSecretNotFoundError(name));
    }

    if (payload.secret?.etag && payload.secret?.etag !== fakeSecret.secret.etag) {
      return respond(new FakeRpcMismatchingEtagError());
    }

    if (payload.updateMask?.paths?.length) {
      for (const prop of payload.updateMask.paths) {
        // @ts-ignore
        fakeSecret.secret[prop] = payload.secret[prop];
      }
    }

    debug('secret %s was updated', name, req.metadata.getMap());

    fakeSecret.metadata = req.metadata;
    fakeSecret.secret.etag = generateEtag();

    respond(null, fakeSecret.secret);
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

    let fakeSecret;
    if (!(fakeSecret = this.secrets.get(parent))) {
      return respond(new FakeRpcSecretNotFoundError(parent));
    }

    const fakeVersions = fakeSecret.versions;
    const fakeVersion = version === 'latest' ? fakeVersions[0] : fakeVersions.find((v) => v.version.name === payload.name);

    if (!fakeVersion) {
      return respond(
        new FakeRpcError(
          !fakeVersions.length ? `Secret [${parent}] not found or has no versions.` : `Secret Version [${payload.name}] not found.`,
          RpcCodes.NOT_FOUND
        )
      );
    }

    respond(null, { name: fakeVersion.version.name, payload: { data: fakeVersion.data } });
  }

  /**
   * Delete secret
   * @param {import('types').DeleteSecretRequest} req
   * @param {CallableFunction} respond
   */
  DeleteSecret(req, respond) {
    const payload = req.request;
    const { name, etag } = payload;

    let fakeSecret;
    if (!(fakeSecret = this.secrets.get(name))) {
      return respond(new FakeRpcSecretNotFoundError(name));
    }

    if (etag && etag !== fakeSecret.secret.etag) {
      return respond(new FakeRpcMismatchingEtagError());
    }

    this.secrets.delete(name);

    return respond(null, {});
  }
}

const nodeRequire = createRequire(import.meta.url);
const secretManagerPkg = nodeRequire.resolve('@google-cloud/secret-manager/package.json');
const secretManagerProtoDir = path.join(path.dirname(secretManagerPkg), 'build/protos');
// google-gax does not export its package.json, resolve protos relative to its main entry (build/src/index.js)
const gaxProtoDir = path.join(path.dirname(createRequire(secretManagerPkg).resolve('google-gax')), '../protos');

const servicePackageDefinition = protoLoader.loadSync(['google/cloud/secretmanager/v1/service.proto'], {
  includeDirs: [gaxProtoDir, secretManagerProtoDir],
});

const serviceProto = grpc.loadPackageDefinition(servicePackageDefinition);

/**
 * Start fake server with its own secret store, or a prefilled one passed in options
 * @param {startServerOptions} [options] Fake gRPC server options
 * @returns {Promise<FakeSecretManagerServer>} Fake gRPC Google Secret Manager server
 */
export async function startServer(options) {
  const requestedPort = options?.port ?? 0;
  const credentials =
    options?.credentials ??
    (options?.cert ? grpc.ServerCredentials.createSsl(null, options.cert, false) : grpc.ServerCredentials.createInsecure());
  const service = new FakeSecretManager(options?.secrets);
  const secrets = service.secrets;

  debug('start server at port %d', requestedPort);
  const server = new grpc.Server();

  // @ts-ignore
  server.addService(serviceProto.google.cloud.secretmanager.v1.SecretManagerService.service, service);
  debug('added service fake implementation');

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

  return /** @type {FakeSecretManagerServer} */ (server);
}

function generateEtag() {
  return `"${randomBytes(7).toString('hex')}"`;
}

/**
 * @typedef {import('@grpc/grpc-js').Server & {
 *   origin: { hostname: string, port: number },
 *   secrets: Map<string, FakeSecretData>,
 *   getSecret: (name: string) => FakeSecretData | undefined,
 *   reset: () => void,
 * }} FakeSecretManagerServer
 *
 * @typedef {object} startServerOptions
 * @property {import('@grpc/grpc-js').KeyCertPair[]} [cert] server TLS certs, e.g. from mkcert, starts a TLS server
 * @property {import('@grpc/grpc-js').ServerCredentials} [credentials] server credentials, takes precedence over cert; defaults to SSL credentials built from cert, or insecure credentials when neither is given — then connect the client with `sslCreds: grpc.credentials.createInsecure()`
 * @property {number} [port] gRPC server port, defaults to 0 which lets the OS assign a free port
 * @property {Map<string, FakeSecretData>} [secrets] backing secret store, e.g. prefilled with secrets, defaults to a new empty store
 *
 * @typedef {object} FakeSecretVersion
 * @property {import('@google-cloud/secret-manager').protos.google.cloud.secretmanager.v1.ISecretVersion} version secret versions
 * @property {Buffer} [data] secret data
 *
 * @typedef {object} FakeSecretData
 * @property {import('@google-cloud/secret-manager').protos.google.cloud.secretmanager.v1.ISecret} secret Secret
 * @property {FakeSecretVersion[]} versions secret versions
 * @property {import('@grpc/grpc-js').Metadata} metadata last request metadata
 */

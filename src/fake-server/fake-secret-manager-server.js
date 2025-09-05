import { randomInt, randomBytes } from 'node:crypto';
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

/** @type {Map<string, FakeSecretData>} */
const db = new Map();

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

// Fake your secret manager implementation
const exampleServer = {
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

    if (db.has(name)) {
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
      etag: `"${randomBytes(7).toString('hex')}"`,
      createTime: {
        nanos: now.getUTCMilliseconds() * 1e6,
        seconds: Math.floor(now.setUTCMilliseconds(0) / 1000),
      },
    };

    db.set(name, { metadata: req.metadata, secret, versions: [] });

    debug('secret %s created', name);

    respond(null, secret);
  },
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
    if (!(fakeSecret = db.get(name))) {
      return respond(new FakeRpcError(`Secret [${name}] not found.`, RpcCodes.NOT_FOUND));
    }

    respond(null, { ...fakeSecret.secret });
  },
  /**
   * @param {import('types').AddSecretVersionRequest} req
   * @param {CallableFunction} respond
   */
  AddSecretVersion(req, respond) {
    const payload = req.request;

    if (!validSecretNamePattern.test(payload.parent)) {
      return respond(new FakeRpcError('Invalid resource field value in the request.', RpcCodes.INVALID_ARGUMENT));
    }

    const parentSecret = db.get(payload.parent);

    if (!parentSecret) {
      return respond(new FakeRpcError(`Secret [${payload.parent}] not found.`, RpcCodes.NOT_FOUND));
    }

    const now = new Date();

    debug('add secret version to %s', payload.parent, req.metadata.getMap());

    /** @type {import('@google-cloud/secret-manager').protos.google.cloud.secretmanager.v1.ISecretVersion} */
    const fakeVersion = {
      name: path.join(payload.parent, 'versions', (parentSecret.versions.length + 1).toString()),
      etag: `"${randomBytes(7).toString('hex')}"`,
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
  },
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
    if (!(fakeSecret = db.get(parent))) {
      return respond(new FakeRpcError(`Secret [${parent}] not found.`, RpcCodes.NOT_FOUND));
    }

    const fakeVersion = fakeSecret.versions.find((v) => v.version.name === payload.name);

    if (payload.etag && payload.etag !== fakeVersion.version.etag) {
      return respond(
        new FakeRpcError(
          "The etag provided in the request does not match the resource's current etag. Please retry the whole read-modify-write with exponential backoff.",
          RpcCodes.FAILED_PRECONDITION
        )
      );
    }

    fakeVersion.version.state = 'DISABLED';
    fakeVersion.version.etag = `"${randomBytes(7).toString('hex')}"`;

    respond(null, fakeVersion.version);
  },
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
    if (!(fakeSecret = db.get(parent))) {
      return respond(new FakeRpcError(`Secret [${parent}] not found.`, RpcCodes.NOT_FOUND));
    }

    const fakeVersion = fakeSecret.versions.find((v) => v.version.name === payload.name);
    if (!fakeVersion) {
      return respond(new FakeRpcError(`Secret Version [${payload.name}] not found.`, RpcCodes.NOT_FOUND));
    }

    if (payload.etag && payload.etag !== fakeVersion.version.etag) {
      return respond(
        new FakeRpcError(
          "The etag provided in the request does not match the resource's current etag. Please retry the whole read-modify-write with exponential backoff.",
          RpcCodes.FAILED_PRECONDITION
        )
      );
    }

    fakeVersion.version.state = 'ENABLED';
    fakeVersion.version.etag = `"${randomBytes(7).toString('hex')}"`;

    respond(null, fakeVersion.version);
  },
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
    if (!(fakeSecret = db.get(parent))) {
      return respond(new FakeRpcError(`Secret [${parent}] not found.`, RpcCodes.NOT_FOUND));
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
  },
  /**
   * List secret versions
   * @param {any} req
   * @param {CallableFunction} respond
   */
  ListSecretVersions(req, respond) {
    let fakeSecret;
    if (!(fakeSecret = db.get(req.request.parent))) {
      return respond(new FakeRpcError(`${req.payload.parent} doesn't exists`, RpcCodes.NOT_FOUND));
    }

    const versions = fakeSecret.versions.map((v) => v.version);

    /** @type {import('@google-cloud/secret-manager').protos.google.cloud.secretmanager.v1.IListSecretVersionsResponse} */
    const response = {
      totalSize: versions.length,
      versions,
    };

    respond(null, response);
  },
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
    if (!(fakeSecret = db.get(parent))) {
      return respond(new FakeRpcError(`Secret [${parent}] not found.`, RpcCodes.NOT_FOUND));
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
      return respond(
        new FakeRpcError(
          "The etag provided in the request does not match the resource's current etag. Please retry the whole read-modify-write with exponential backoff.",
          RpcCodes.FAILED_PRECONDITION
        )
      );
    }

    const now = new Date();

    fakeVersion.version.etag = `"${randomBytes(7).toString('hex')}"`;
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
  },
  /**
   * Enable version, the method is idempotent but etag is updated
   * @param {import('types').UpdatesSecretRequest} req
   * @param {CallableFunction} respond
   */
  UpdateSecret(req, respond) {
    const payload = req.request;
    const name = payload.secret?.name;

    let fakeSecret;
    if (!(fakeSecret = db.get(name))) {
      return respond(new FakeRpcError(`Secret [${name}] not found.`, RpcCodes.NOT_FOUND));
    }

    if (payload.secret?.etag && payload.secret?.etag !== fakeSecret.secret.etag) {
      return respond(
        new FakeRpcError(
          "The etag provided in the request does not match the resource's current etag. Please retry the whole read-modify-write with exponential backoff.",
          RpcCodes.FAILED_PRECONDITION
        )
      );
    }

    if (payload.updateMask?.paths?.length) {
      for (const prop of payload.updateMask.paths) {
        // @ts-ignore
        fakeSecret.secret[prop] = payload.secret[prop];
      }
    }

    debug('secret %s was updated', name, req.metadata.getMap());

    fakeSecret.metadata = req.metadata;
    fakeSecret.secret.etag = `"${randomBytes(7).toString('hex')}"`;

    respond(null, fakeSecret.secret);
  },
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
    if (!(fakeSecret = db.get(parent))) {
      return respond(new FakeRpcError(`Secret [${parent}] not found.`, RpcCodes.NOT_FOUND));
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
  },
};

const servicePackageDefinition = protoLoader.loadSync(['./google/cloud/secretmanager/v1/service.proto'], {
  includeDirs: ['./node_modules/google-gax/build/protos', './node_modules/@google-cloud/secret-manager/build/protos'],
});

const serviceProto = grpc.loadPackageDefinition(servicePackageDefinition);

/**
 * Start fake server
 * @param {startServerOptions} options Fake gRPC server options
 * @returns {Promise<import('@grpc/grpc-js').Server>} Fake gRPC Google Secret Manager server
 */
export async function startServer(options) {
  // const debug = Debug('aller:google-cloud-secret:fake-server');

  const { port, cert } = {
    ...options,
    port: options.port || Number(`5${randomInt(1000).toString().padStart(4, '0')}`),
  };

  debug('start server at port %d', port);
  const server = new grpc.Server();

  // @ts-ignore
  server.addService(serviceProto.google.cloud.secretmanager.v1.SecretManagerService.service, exampleServer);
  debug('added service fake implementation');

  //// import { ReflectionService } from '@grpc/reflection';
  // const reflection = new ReflectionService(servicePackageDefinition);
  // reflection.addToServer(server);

  await new Promise((resolve, reject) => {
    server.bindAsync(`0.0.0.0:${port}`, grpc.ServerCredentials.createSsl(null, cert, false), (err) => {
      if (err) {
        return reject(err);
      }
      debug('service started at %d', port);
      resolve(port);
    });
  });

  Object.defineProperties(server, {
    origin: {
      enumerable: true,
      get() {
        return { hostname: 'localhost', port };
      },
    },
  });

  return server;
}

/**
 * Reset all fake secrets and versions
 */
export function reset() {
  db.clear();
}

/**
 * Get fake secret
 * @param {string} name secret name
 */
export function getSecret(name) {
  return db.get(name);
}

export default startServer;

/**
 * @typedef {object} startServerOptions
 * @property {import('@grpc/grpc-js').KeyCertPair[]} cert secret manages sends credentials, hence certs need to be passed
 * @property {number} [port] gRPC server port, default to random 50NNN something
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

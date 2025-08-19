import { randomInt, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path/posix';

import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import { ReflectionService } from '@grpc/reflection';
import Long from 'long';

import { RpcCodes } from './rpc-codes.js';

export { RpcCodes } from './rpc-codes.js';

/** @type {Map<string, FakeSecretData} */
const db = new Map();

// Fake your secret manager implementation
const exampleServer = {
  /**
   * @param {import('../../types/types.js').AddSecretRequest} req
   * @param {CallableFunction} respond
   */
  CreateSecret(req, respond) {
    const payload = req.request;

    const name = path.join(payload.parent, 'secrets', payload.secretId);

    if (db.has(name)) {
      const err = new Error(`${name} already exists`);
      err.code = RpcCodes.ALREADY_EXISTS;
      return respond(err);
    }

    const now = new Date();

    /** @type {import('@google-cloud/secret-manager').protos.google.cloud.secretmanager.v1.ISecret} */
    const secret = {
      topics: [],
      labels: {},
      versionAliases: {},
      annotations: { updated_at: 'null' },
      tags: {},
      rotation: null,
      versionDestroyTtl: null,
      customerManagedEncryption: null,
      ...payload.secret,
      name,
      replication: {
        ...payload.secret.replication,
        replication: !payload.secret.replication?.automatic ? 'userManaged' : 'automatic',
      },
      etag: `"${randomBytes(7).toString('hex')}"`,
      createTime: {
        nanos: now.getUTCMilliseconds() * 1e6,
        seconds: Math.floor(now.setUTCMilliseconds(0) / 1000),
      },
    };

    db.set(name, { secret, versions: [] });

    respond(null, secret);
  },
  /**
   * @param {import('../../types/types.js').GetSecretRequest} req
   * @param {CallableFunction} respond
   */
  GetSecret(req, respond) {
    const payload = req.request;

    let fakeSecret;
    if (!(fakeSecret = db.get(payload.name))) {
      const err = new Error(`Secret [${payload.name}] not found.`);
      err.code = RpcCodes.NOT_FOUND;
      return respond(err);
    }

    respond(null, { ...fakeSecret.secret });
  },
  /**
   * @param {import('../../types/types.js').AddSecretVersionRequest} req
   * @param {CallableFunction} respond
   */
  AddSecretVersion(req, respond) {
    const payload = req.request;

    const parentSecret = db.get(payload.parent);

    if (!parentSecret) {
      const err = new Error(`Secret [${payload.parent}] not found.`);
      err.code = RpcCodes.NOT_FOUND;
      return respond(err);
    }

    const now = new Date();

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
   * @param {import('../../types/types.js').DisableSecretVersionRequest} req
   * @param {CallableFunction} respond
   */
  DisableSecretVersion(req, respond) {
    // Throw 9 FAILED_PRECONDITION if etag mismatch
    // Message: "The etag provided in the request does not match the resource's current etag. Please retry the whole read-modify-write with exponential backoff."

    const payload = req.request;
    const parts = payload.name.split('/');
    parts.splice(-2);
    const parent = path.join(...parts);

    let fakeSecret;
    if (!(fakeSecret = db.get(parent))) {
      const err = new Error(`Secret [${parent}] not found.`);
      err.code = RpcCodes.NOT_FOUND;
      return respond(err);
    }

    const fakeVersion = fakeSecret.versions.find((v) => v.version.name === payload.name);

    if (payload.etag && payload.etag !== fakeVersion.version.etag) {
      const err = new Error(
        "The etag provided in the request does not match the resource's current etag. Please retry the whole read-modify-write with exponential backoff."
      );
      err.code = RpcCodes.FAILED_PRECONDITION;
      return respond(err);
    }

    fakeVersion.version.state = 'DISABLED';
    fakeVersion.version.etag = `"${randomBytes(7).toString('hex')}"`;

    respond(null, fakeVersion.version);
  },
  /**
   * Enable version, the method is idempotent but etag is updated
   * @param {import('../../types/types.js').EnableSecretVersionRequest} req
   * @param {CallableFunction} respond
   */
  EnableSecretVersion(req, respond) {
    // Throw 9 FAILED_PRECONDITION if etag mismatch
    // Message: "The etag provided in the request does not match the resource's current etag. Please retry the whole read-modify-write with exponential backoff."

    const payload = req.request;
    const parts = payload.name.split('/');
    parts.splice(-2);
    const parent = path.join(...parts);

    let fakeSecret;
    if (!(fakeSecret = db.get(parent))) {
      const err = new Error(`Secret [${parent}] not found.`);
      err.code = RpcCodes.NOT_FOUND;
      return respond(err);
    }

    const fakeVersion = fakeSecret.versions.find((v) => v.version.name === payload.name);
    if (!fakeVersion) {
      const err = new Error(`Secret Version [${payload.name}] not found.`);
      err.code = RpcCodes.NOT_FOUND;
      return respond(err);
    }

    if (payload.etag && payload.etag !== fakeVersion.version.etag) {
      const err = new Error(
        "The etag provided in the request does not match the resource's current etag. Please retry the whole read-modify-write with exponential backoff."
      );
      err.code = RpcCodes.FAILED_PRECONDITION;
      return respond(err);
    }

    fakeVersion.version.state = 'ENABLED';
    fakeVersion.version.etag = `"${randomBytes(7).toString('hex')}"`;

    respond(null, fakeVersion.version);
  },
  GetSecretVersion(req, respond) {
    const payload = req.request;
    const parts = payload.name.split('/');
    const [, version] = parts.splice(-2);
    const parent = path.join(...parts);

    let fakeSecret;
    if (!(fakeSecret = db.get(parent))) {
      const err = new Error(`Secret [${parent}] not found.`);
      err.code = RpcCodes.NOT_FOUND;
      return respond(err);
    }

    const fakeVersions = fakeSecret.versions;
    const fakeVersion = version === 'latest' ? fakeVersions[0] : fakeVersions.find((v) => v.version.name === payload.name);

    if (!fakeVersion) {
      const err = new Error(
        !fakeVersions.length ? `Secret [${parent}] not found or has no versions.` : `Secret Version [${payload.name}] not found.`
      );
      err.code = RpcCodes.NOT_FOUND;
      return respond(err);
    }

    respond(null, fakeVersion.version);
  },

  ListSecretVersions(req, respond) {
    let fakeSecret;
    if (!(fakeSecret = db.get(req.request.parent))) {
      const err = new Error(`${req.payload.parent} doesn't exists`);
      err.code = RpcCodes.NOT_FOUND;
      return respond(err);
    }

    const versions = fakeSecret.versions.map((v) => v.version);

    /** @type {import('@google-cloud/secret-manager').protos.google.cloud.secretmanager.v1.ListSecretVersionsResponse} */
    const response = {
      totalSize: versions.length,
      versions,
    };

    respond(null, response);
  },

  DestroySecretVersion(req, respond) {
    const payload = req.request;
    const parts = payload.name.split('/');
    parts.splice(-2);
    const parent = path.join(...parts);

    let fakeSecret;
    if (!(fakeSecret = db.get(parent))) {
      const err = new Error(`Secret [${parent}] not found.`);
      err.code = RpcCodes.NOT_FOUND;
      return respond(err);
    }

    const fakeVersion = fakeSecret.versions.find((v) => v.version.name === payload.name);

    if (!fakeVersion) {
      const err = new Error(`Secret Version [${payload.name}] not found.`);
      err.code = RpcCodes.NOT_FOUND;
      return respond(err);
    }

    if (fakeVersion.version.state === 'DESTROYED') {
      const err = new Error('SecretVersion.state is already DESTROYED.');
      err.code = RpcCodes.FAILED_PRECONDITION;
      return respond(err);
    }

    if (fakeVersion.version.scheduledDestroyTime) {
      const err = new Error('SecretVersion is already scheduled for DESTRUCTION.');
      err.code = RpcCodes.FAILED_PRECONDITION;
      return respond(err);
    }

    if (payload.etag && payload.etag !== fakeVersion.version.etag) {
      const err = new Error(
        "The etag provided in the request does not match the resource's current etag. Please retry the whole read-modify-write with exponential backoff."
      );
      err.code = RpcCodes.FAILED_PRECONDITION;
      return respond(err);
    }

    const now = new Date();

    fakeVersion.version.etag = `"${randomBytes(7).toString('hex')}"`;

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
   * @param {import('../../types/types.js').UpdatesSecretRequest} req
   * @param {CallableFunction} respond
   */
  UpdateSecret(req, respond) {
    const payload = req.request;
    const name = payload.secret?.name;

    let fakeSecret;
    if (!(fakeSecret = db.get(name))) {
      const err = new Error(`Secret [${name}] not found.`);
      err.code = RpcCodes.NOT_FOUND;
      return respond(err);
    }

    if (payload.secret?.etag && payload.secret?.etag !== fakeSecret.secret.etag) {
      const err = new Error(
        "The etag provided in the request does not match the resource's current etag. Please retry the whole read-modify-write with exponential backoff."
      );
      err.code = RpcCodes.FAILED_PRECONDITION;
      return respond(err);
    }

    if (payload.updateMask?.paths?.length) {
      for (const prop of payload.updateMask.paths) {
        if (prop in payload.secret) {
          fakeSecret.secret[prop] = payload.secret[prop];
        }
      }
    }

    fakeSecret.secret.etag = `"${randomBytes(7).toString('hex')}"`;

    respond(null, fakeSecret.secret);
  },
};

const servicePackageDefinition = protoLoader.loadSync(['./google/cloud/secretmanager/v1/service.proto'], {
  includeDirs: ['./node_modules/google-gax/build/protos', './node_modules/@google-cloud/secret-manager/build/protos'],
});

const serviceProto = grpc.loadPackageDefinition(servicePackageDefinition);

const cert = {
  private_key: fs.readFileSync('./tmp/mkcert/dev-key.pem'),
  cert_chain: fs.readFileSync('./tmp/mkcert/dev-cert.pem'),
};

export async function startServer(port) {
  port = port || `50${randomInt(100).toString().padStart(3, '0')}`;

  const server = new grpc.Server();

  server.addService(serviceProto.google.cloud.secretmanager.v1.SecretManagerService.service, exampleServer);

  const reflection = new ReflectionService(servicePackageDefinition);
  reflection.addToServer(server);

  await new Promise((resolve, reject) => {
    server.bindAsync(`0.0.0.0:${port}`, grpc.ServerCredentials.createSsl(null, [cert], false), (err) => {
      if (err) {
        return reject(err);
      }
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

export function reset() {
  db.clear();
}

/**
 * @typedef {object} FakeSecretVersion
 * @property {import('@google-cloud/secret-manager').protos.google.cloud.secretmanager.v1.ISecretVersion} version secret versions
 * @property {Buffer} [data] secret data
 *
 * @typedef {object} FakeSecretData
 * @property {import('@google-cloud/secret-manager').protos.google.cloud.secretmanager.v1.ISecret} secret Secret
 * @property {FakeSecretVersion[]} versions secret versions
 */

import fs from 'node:fs';
import { createRequire } from 'node:module';

import secretManager from '@google-cloud/secret-manager';
import Mocha from 'mocha';
import { ExampleEvaluator } from 'texample';

import { reset, startServer } from '../src/fake-server/fake-secret-manager-server.js';

const require = createRequire(import.meta.url);
const packageDefinition = require('../package.json');

const cert = {
  private_key: fs.readFileSync('./tmp/mkcert/dev-key.pem'),
  cert_chain: fs.readFileSync('./tmp/mkcert/dev-cert.pem'),
};

const server = await startServer({ cert: [cert] });
const port = server.origin.port;

function fakeAuth() {
  return {
    getUniverseDomain() {
      return 'googleapis.com';
    },
    getClient() {
      return {
        getRequestHeaders() {
          return new Map();
        },
      };
    },
  };
}

const seedClient = new secretManager.v1.SecretManagerServiceClient({
  apiEndpoint: 'localhost',
  port,
  auth: fakeAuth(),
});

for (const id of ['my-concurrent-secret-1', 'my-concurrent-secret-2']) {
  await seedClient.createSecret({
    parent: 'projects/1234567',
    secretId: id,
    secret: { versionDestroyTtl: { seconds: 86400, nanos: 0 }, replication: { automatic: {} } },
  });
}
await seedClient.close();

const Original = secretManager.v1.SecretManagerServiceClient;
class FakeServerClient extends Original {
  constructor(opts) {
    super({ apiEndpoint: 'localhost', port, auth: fakeAuth(), ...(opts ?? {}) });
  }
}
Object.defineProperty(secretManager.v1, 'SecretManagerServiceClient', {
  configurable: true,
  enumerable: true,
  get() {
    return FakeServerClient;
  },
});

const mocha = new Mocha({ ui: 'bdd', reporter: 'spec', timeout: 10_000 });
mocha.suite.emit('pre-require', globalThis, 'README.md', mocha);

let exitCode = 0;
try {
  await new ExampleEvaluator('./README.md', packageDefinition, process.cwd()).evaluate();
  const failures = await new Promise((resolve) => mocha.run(resolve));
  if (failures) exitCode = 1;
} catch (err) {
  console.error(err.stack ?? err);
  exitCode = 1;
}

try {
  server.forceShutdown();
  reset();
} catch {
  // ignore
}

process.exit(exitCode);

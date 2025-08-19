import fs from 'node:fs';

import { startServer as startFakeServer } from '../../src/fake-server/fake-secret-manager-server.js';

export { reset, RpcCodes } from '../../src/fake-server/fake-secret-manager-server.js';

const cert = {
  private_key: fs.readFileSync('./tmp/mkcert/dev-key.pem'),
  cert_chain: fs.readFileSync('./tmp/mkcert/dev-cert.pem'),
};

export function startServer() {
  return startFakeServer({ cert: [cert] });
}

import { join } from 'node:path';

import nock from 'nock';

process.env.NODE_ENV = 'test';
process.env.GOOGLE_APPLICATION_CREDENTIALS = join(process.cwd(), 'test/helpers/fake-google-application-credentials.json');

nock.enableNetConnect(/127\.0\.0\.1|localhost/);

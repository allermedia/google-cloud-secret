import nock from 'nock';

process.env.NODE_ENV = 'test';

nock.enableNetConnect(/127\.0\.0\.1|localhost/);

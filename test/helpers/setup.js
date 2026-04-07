import nock from 'nock';

process.env.NODE_ENV = 'test';

nock.enableNetConnect(/127\.0\.0\.1|localhost/);

// LRUCache hack to enable Date manipulation
globalThis.performance = {
  now() {
    return Date.now();
  },
};

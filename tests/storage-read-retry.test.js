const test = require('node:test');
const assert = require('node:assert/strict');

process.env.ANNOUNCEMENT_STORAGE = 'local';
process.env.ANNOUNCEMENT_ADMIN_SALT = 'storage-test-salt';
process.env.ANNOUNCEMENT_ADMIN_HASH = 'storage-test-hash';
process.env.ANNOUNCEMENT_SESSION_SECRET = 'storage-test-session';
process.env.ANNOUNCEMENT_BOT_TOKEN = 'storage-test-bot';
process.env.ANNOUNCEMENT_DESKTOP_TOKEN = 'storage-test-desktop';
process.env.ANNOUNCEMENT_HIDDEN_GROUP_ID = 'storage-test-group';

const { OssStore } = require('../api/_lib/storage');

test('OSS snapshot reads retry one transient cross-region failure without retrying writes', async () => {
  const store = Object.create(OssStore.prototype);
  let attempts = 0;
  store.readClient = {
    async get() {
      attempts += 1;
      if (attempts === 1) {
        const error = new Error('read ECONNRESET');
        error.code = 'RequestError';
        throw error;
      }
      return { content: Buffer.from('snapshot'), res: { headers: { etag: '"etag"' } } };
    }
  };
  store.client = store.readClient;
  const result = await store.get('mobile-library/songs/current.json.gz');
  assert.equal(result.body.toString('utf8'), 'snapshot');
  assert.equal(attempts, 2);
});

test('OSS reads use a signed native HTTP request instead of the failing SDK path', async () => {
  const store = Object.create(OssStore.prototype);
  let sdkAttempts = 0;
  let httpAttempts = 0;
  store.readClient = {
    async get() {
      sdkAttempts += 1;
      const error = new Error('connect ETIMEDOUT');
      error.code = 'RequestError';
      throw error;
    },
  };
  store.client = {
    signatureUrl(key, options) {
      assert.equal(key, 'security/mobile-devices.json');
      assert.equal(options.method, 'GET');
      return 'https://example.oss-cn-beijing.aliyuncs.com/security/mobile-devices.json?signature=redacted';
    },
  };
  const originalFetch = global.fetch;
  global.fetch = async (url, options) => {
    httpAttempts += 1;
    assert.match(String(url), /^https:\/\/example\.oss-cn-beijing\.aliyuncs\.com\//);
    assert.ok(options.signal, 'native fallback must be abortable');
    return {
      ok: true,
      status: 200,
      headers: { get: name => name.toLowerCase() === 'etag' ? '"native-etag"' : null },
      arrayBuffer: async () => Buffer.from('{"devices":[]}'),
    };
  };
  try {
    const result = await store.get('security/mobile-devices.json');
    assert.equal(result.body.toString('utf8'), '{"devices":[]}');
    assert.equal(result.etag, 'native-etag');
    assert.equal(sdkAttempts, 0);
    assert.equal(httpAttempts, 1);
  } finally {
    global.fetch = originalFetch;
  }
});

test('OSS metadata reads use the signed native HTTP path needed by library status', async () => {
  const store = Object.create(OssStore.prototype);
  store.readClient = {
    async head() {
      throw new Error('SDK HEAD must not run when native HTTP is available');
    },
  };
  store.client = {
    signatureUrl(key, options) {
      assert.equal(key, 'mobile-library/songs/current.json.gz');
      assert.equal(options.method, 'HEAD');
      return 'https://example.oss-cn-beijing.aliyuncs.com/mobile-library/songs/current.json.gz?signature=redacted';
    },
  };
  const originalFetch = global.fetch;
  global.fetch = async (_url, options) => {
    assert.equal(options.method, 'HEAD');
    return {
      ok: true,
      status: 200,
      headers: {
        get(name) {
          if (name.toLowerCase() === 'etag') return '"snapshot-etag"';
          if (name.toLowerCase() === 'content-length') return '91234';
          return null;
        },
      },
    };
  };
  try {
    assert.deepEqual(
      await store.head('mobile-library/songs/current.json.gz'),
      { size: 91234, etag: 'snapshot-etag' },
    );
  } finally {
    global.fetch = originalFetch;
  }
});

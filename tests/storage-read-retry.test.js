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

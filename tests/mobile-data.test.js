const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'songbot-mobile-data-test-'));
process.env.ANNOUNCEMENT_STORAGE = 'local';
process.env.ANNOUNCEMENT_LOCAL_DIR = root;
process.env.ANNOUNCEMENT_ADMIN_SALT = 'mobile-data-test-salt';
process.env.ANNOUNCEMENT_ADMIN_HASH = crypto.scryptSync('password', 'mobile-data-test-salt', 32).toString('hex');
process.env.ANNOUNCEMENT_SESSION_SECRET = 'mobile-data-session-secret';
process.env.ANNOUNCEMENT_BOT_TOKEN = 'mobile-data-bot-token';
process.env.ANNOUNCEMENT_DESKTOP_TOKEN = 'mobile-data-desktop-token';
process.env.ANNOUNCEMENT_HIDDEN_GROUP_ID = 'mobile-data-group';

const relay = require('../api/mobile-relay');
const data = require('../api/mobile-data');
const { getStore } = require('../api/_lib/storage');
const desktop = { authorization: 'Desktop mobile-data-desktop-token' };

function call(handler, method, action, { body, headers = {}, query = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = { method, query: { action, ...query }, headers, body, socket: { remoteAddress: '203.0.113.4' } };
    const res = { statusCode: 200, setHeader() {}, end(payload) {
      try { resolve({ status: this.statusCode, body: payload ? JSON.parse(payload) : null }); }
      catch (error) { reject(error); }
    } };
    Promise.resolve(handler(req, res)).catch(reject);
  });
}

test('paired device reads and edits cloud data with no desktop poll', async () => {
  const songs = await call(data, 'POST', 'bootstrap-songs', { headers: desktop, body: {
    columns: ['id', 'song_name', 'author', '4k_ez'],
    items: [
      { id: '1', song_name: '第一首', author: 'A', '4k_ez': '1-100' },
      { id: '3', song_name: '第三首', author: 'B', '4k_ez': '0-0' }
    ]
  } });
  assert.equal(songs.status, 201);
  const stable = await call(data, 'POST', 'bootstrap-stable', { headers: desktop, body: {
    columns: ['sid', 'title', 'artist', 'bpm', 'length', 'creator', 'update_time', 'cover'],
    items: [{ sid: '22', title: 'Stable', artist: 'C', bpm: '120', length: '90', creator: 'D', update_time: '2026-08-27', cover: 'AUTO' }]
  } });
  assert.equal(stable.status, 201);

  const registered = await call(relay, 'POST', 'register-device', { headers: desktop, body: { name: '独立手机' } });
  const headers = { authorization: `Device ${registered.body.token}` };
  const listed = await call(data, 'GET', 'songs', { headers, query: { q: '第三', offset: '0', limit: '200' } });
  assert.equal(listed.status, 200);
  assert.equal(listed.body.total, 1);
  assert.equal(listed.body.items[0].id, '3');

  const updated = await call(data, 'POST', 'song', { headers, body: { id: '3', values: { song_name: '离线电脑也能修改', id: '999' } } });
  assert.equal(updated.status, 200);
  const changes = await call(data, 'GET', 'changes', {
    headers: desktop,
    query: { dataset: 'songs', after: '1', limit: '100' }
  });
  assert.equal(changes.status, 200, 'workstation agent must be able to pull cloud edits');
  assert.equal(changes.body.items.length, 1);
  assert.equal(changes.body.items[0].id, '3');
  assert.equal(changes.body.items[0].values.song_name, '离线电脑也能修改');
  assert.equal(changes.body.revision, updated.body.revision);
  assert.equal((await call(data, 'GET', 'changes', {
    headers, query: { dataset: 'songs', after: '1' }
  })).status, 401, 'change feed must remain workstation-only');
  const after = await call(data, 'GET', 'songs', { headers, query: { q: '离线电脑', offset: '0', limit: '200' } });
  assert.equal(after.body.items[0].id, '3');
  assert.equal(after.body.items[0].song_name, '离线电脑也能修改');
  assert.equal((await call(data, 'GET', 'status', { headers })).body.cloudIndependent, true);
});

test('revocation and emergency write lock apply to direct cloud data', async () => {
  const registered = await call(relay, 'POST', 'register-device', { headers: desktop, body: { name: '可撤销手机' } });
  const headers = { authorization: `Device ${registered.body.token}` };
  process.env.ANNOUNCEMENT_EMERGENCY_WRITE_LOCK = '1';
  try {
    assert.equal((await call(data, 'POST', 'stable', { headers, body: { sid: '22', values: { title: 'blocked' } } })).status, 423);
  } finally { delete process.env.ANNOUNCEMENT_EMERGENCY_WRITE_LOCK; }
  await call(relay, 'POST', 'revoke-device', { headers: desktop, body: { id: registered.body.id } });
  assert.equal((await call(data, 'GET', 'songs', { headers })).status, 401);
});

test('self-enrolled workstation editor can edit library data but cannot use the control relay', async () => {
  const installationId = crypto.randomUUID();
  const secret = crypto.randomBytes(32).toString('base64url');
  const enrolled = await call(data, 'POST', 'enroll-editor', {
    headers: { 'x-vercel-forwarded-for': '198.51.100.77' },
    body: { installationId, secret, name: '外部工作站' }
  });
  assert.equal(enrolled.status, 201);
  assert.equal(enrolled.body.scope, 'library-editor');
  assert.equal(enrolled.body.token.endsWith(`.${secret}`), true);
  const stored = (await getStore().get('security/library-editors.json')).body.toString('utf8');
  assert.doesNotMatch(stored, new RegExp(secret));

  const headers = { authorization: `Device ${enrolled.body.token}` };
  const listed = await call(data, 'GET', 'songs', { headers, query: { q: '第一', limit: '200' } });
  assert.equal(listed.status, 200);
  assert.equal(listed.body.items[0].id, '1');
  const updated = await call(data, 'POST', 'song', {
    headers,
    body: { id: '1', values: { song_name: '外部工作站修改' } }
  });
  assert.equal(updated.status, 200);
  const created = await call(data, 'POST', 'song-create', {
    headers,
    body: { id: '1273', values: { song_name: '云端新歌', author: '新作者', '4k_ez': '3-100' } }
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.created, true);
  const createdList = await call(data, 'GET', 'songs', { headers, query: { q: '1273', limit: '200' } });
  assert.equal(createdList.body.total, 1);
  assert.equal(createdList.body.items[0].song_name, '云端新歌');
  assert.equal((await call(data, 'POST', 'song-create', {
    headers, body: { id: '1273', values: { song_name: '重复' } }
  })).status, 409, 'duplicate cloud song IDs must be rejected without overwriting');
  const relayAttempt = await call(relay, 'GET', 'presence', { headers });
  assert.equal(relayAttempt.status, 401, 'library-only installation must not control SongBot or NapCat');
});

test('self enrollment is idempotent for one installation secret and emergency lock still blocks it', async () => {
  const installationId = crypto.randomUUID();
  const secret = crypto.randomBytes(32).toString('base64url');
  const request = {
    headers: { 'x-vercel-forwarded-for': '198.51.100.88' },
    body: { installationId, secret, name: '重复安装' }
  };
  const first = await call(data, 'POST', 'enroll-editor', request);
  const second = await call(data, 'POST', 'enroll-editor', request);
  assert.equal(first.status, 201);
  assert.equal(second.status, 201);
  assert.equal(first.body.id, second.body.id);
  process.env.ANNOUNCEMENT_EMERGENCY_WRITE_LOCK = '1';
  try {
    const blocked = await call(data, 'POST', 'song', {
      headers: { authorization: `Device ${first.body.token}` },
      body: { id: '1', values: { song_name: '不应写入' } }
    });
    assert.equal(blocked.status, 423);
  } finally { delete process.env.ANNOUNCEMENT_EMERGENCY_WRITE_LOCK; }
});

test('an unchanged desktop change cursor never downloads the full library snapshot', async () => {
  const store = getStore();
  const currentKey = 'mobile-library/songs/current.json';
  const current = await store.get(currentKey);
  const revision = JSON.parse(current.body.toString('utf8')).revision;
  const originalGet = store.get.bind(store);
  let snapshotReads = 0;
  let snapshotBytes = 0;
  store.get = async key => {
    const result = await originalGet(key);
    if (key === currentKey && result) {
      snapshotReads++;
      snapshotBytes += result.body.length;
    }
    return result;
  };
  try {
    for (let index = 0; index < 5; index++) {
      const response = await call(data, 'GET', 'changes', {
        headers: desktop,
        query: { dataset: 'songs', after: String(revision), limit: '100' }
      });
      assert.equal(response.status, 200);
      assert.deepEqual(response.body.items, []);
    }
  } finally {
    store.get = originalGet;
  }
  assert.equal(snapshotReads, 0,
    `idle synchronization downloaded the full snapshot ${snapshotReads} times (${snapshotBytes} bytes)`);
});

test('repeated cloud status checks never download full library snapshots', async () => {
  const store = getStore();
  const libraryModule = require.resolve('../api/_lib/mobile-library');
  delete require.cache[libraryModule];
  const coldLibrary = require('../api/_lib/mobile-library');
  const snapshotKeys = new Set([
    'mobile-library/songs/current.json',
    'mobile-library/stable/current.json'
  ]);
  const originalGet = store.get.bind(store);
  let snapshotReads = 0;
  let snapshotBytes = 0;
  store.get = async key => {
    const result = await originalGet(key);
    if (snapshotKeys.has(key) && result) {
      snapshotReads++;
      snapshotBytes += result.body.length;
    }
    return result;
  };
  try {
    for (let index = 0; index < 5; index++) {
      const response = await coldLibrary.status();
      assert.equal(response.songs.total, 3);
      assert.equal(response.stable.total, 1);
    }
  } finally {
    store.get = originalGet;
  }
  assert.equal(snapshotReads, 0,
    `status checks downloaded snapshots ${snapshotReads} times (${snapshotBytes} bytes)`);
});

test('cold library reads migrate to and prefer a compact gzip snapshot', async () => {
  const store = getStore();
  const rawKey = 'mobile-library/songs/current.json';
  const compactKey = 'mobile-library/songs/current.json.gz';
  await store.delete(compactKey);

  const libraryModule = require.resolve('../api/_lib/mobile-library');
  delete require.cache[libraryModule];
  const migratingLibrary = require('../api/_lib/mobile-library');
  const first = await migratingLibrary.list('songs', '', 0, 100);
  assert.equal(first.total, 3);
  const raw = await store.get(rawKey);
  const compact = await store.get(compactKey);
  assert.ok(compact, 'first legacy read should create the compact snapshot');
  assert.ok(compact.body.length < raw.body.length,
    `compact snapshot is not smaller (${compact.body.length} >= ${raw.body.length})`);

  delete require.cache[libraryModule];
  const coldLibrary = require('../api/_lib/mobile-library');
  const originalGet = store.get.bind(store);
  let rawReads = 0;
  store.get = async key => {
    if (key === rawKey) rawReads++;
    return originalGet(key);
  };
  try {
    const second = await coldLibrary.list('songs', '离线电脑', 0, 100);
    assert.equal(second.total, 1);
  } finally {
    store.get = originalGet;
  }
  assert.equal(rawReads, 0, 'cold reads must not download the legacy full snapshot');
});

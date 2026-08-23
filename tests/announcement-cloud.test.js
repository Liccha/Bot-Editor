const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'songbot-announcement-test-'));
const password = 'testsecreteditor';
const salt = 'test-salt';
process.env.ANNOUNCEMENT_STORAGE = 'local';
process.env.ANNOUNCEMENT_LOCAL_DIR = root;
process.env.ANNOUNCEMENT_ADMIN_SALT = salt;
process.env.ANNOUNCEMENT_ADMIN_HASH = crypto.scryptSync(password, salt, 32).toString('hex');
process.env.ANNOUNCEMENT_SESSION_SECRET = 'session-secret-for-tests-only';
process.env.ANNOUNCEMENT_BOT_TOKEN = 'bot-token-for-tests-only';
process.env.ANNOUNCEMENT_DESKTOP_TOKEN = 'desktop-token-for-tests-only';
process.env.ANNOUNCEMENT_HIDDEN_GROUP_ID = 'hidden-test-group';

const handler = require('../api/announcement-cloud');
const { getStore } = require('../api/_lib/storage');

function call(method, action, { body, headers = {}, query = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = { method, query: { action, ...query }, headers, body, socket: { remoteAddress: '127.0.0.1' } };
    const responseHeaders = {};
    const res = {
      statusCode: 200,
      setHeader(name, value) { responseHeaders[name.toLowerCase()] = value; },
      end(payload) {
        try { resolve({ status: this.statusCode, headers: responseHeaders, body: payload ? JSON.parse(payload) : null }); }
        catch (error) { reject(error); }
      }
    };
    Promise.resolve(handler(req, res)).catch(reject);
  });
}

test.before(async () => {
  await getStore().put('security/admin-devices.json', Buffer.from(JSON.stringify({ devices: [{ id: 'legacy-device', source: 'legacy' }] })));
});

test('legacy administrator is silently upgraded to a signed session', async () => {
  const result = await call('GET', 'admin-check', { headers: { 'x-admin-device': 'legacy-device' } });
  assert.equal(result.status, 200);
  assert.equal(result.body.admin, true);
  assert.match(result.headers['set-cookie'], /^sb_ann_session=[^;]+;.*HttpOnly; Secure; SameSite=Strict$/);
});

test('desktop editor has isolated token auth and writes the same cloud document', async () => {
  const desktopHeaders = { authorization: 'Desktop desktop-token-for-tests-only', 'x-admin-device': 'mczmaker-test' };
  const denied = await call('GET', 'list', { headers: { authorization: 'Bot bot-token-for-tests-only' } });
  assert.equal(denied.status, 401);
  const created = await call('POST', 'announcement', { headers: desktopHeaders, body: {
    groupId: '858973074', title: '桌面端', content: '桌面端公告', time: '2026-08-27 10:00'
  } });
  assert.equal(created.status, 201);
  const listed = await call('GET', 'list', { headers: desktopHeaders });
  assert.ok(listed.body.some(item => item.id === created.body.id));
  assert.equal((await call('DELETE', 'announcement', { headers: desktopHeaders, query: { id: created.body.id, revision: created.body.revision } })).status, 200);
});

test('wrong hidden passphrase is an ordinary search and never changes devices', async () => {
  const before = await getStore().get('security/admin-devices.json');
  const result = await call('POST', 'admin-grant', { headers: { 'x-admin-device': 'ordinary-searcher' }, body: { d: 'ordinary-searcher', p: 'englishsongname' } });
  const after = await getStore().get('security/admin-devices.json');
  assert.deepEqual(result.body, { admin: false });
  assert.equal(after.body.toString(), before.body.toString());
});

test('announcement lifecycle uses per-record revisions and soft delete', async () => {
  const grant = await call('POST', 'admin-grant', { headers: { 'x-admin-device': 'new-device' }, body: { d: 'new-device', p: password } });
  const headers = { cookie: grant.headers['set-cookie'].split(';')[0] };
  const created = await call('POST', 'announcement', { headers, body: { groupId: '858973074', title: '测试', content: '测试公告', time: '2026-08-25 10:00', pin: 'false', confirm: 'false' } });
  assert.equal(created.status, 201);
  assert.equal(created.body.revision, 1);
  const stale = { ...created.body, content: '过期修改', revision: 0 };
  assert.equal((await call('PATCH', 'announcement', { headers, query: { id: created.body.id }, body: stale })).status, 409);
  const updated = await call('PATCH', 'announcement', { headers, query: { id: created.body.id }, body: { ...created.body, content: '新内容' } });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.revision, 2);
  const removed = await call('DELETE', 'announcement', { headers, query: { id: created.body.id, revision: 2 } });
  assert.equal(removed.status, 200);
  const list = await call('GET', 'list', { headers });
  assert.deepEqual(list.body, []);
});

test('bot claim is leased and completion prevents a second send', async () => {
  const check = await call('GET', 'admin-check', { headers: { 'x-admin-device': 'legacy-device' } });
  const headers = { cookie: check.headers['set-cookie'].split(';')[0] };
  const created = await call('POST', 'announcement', { headers, body: { groupId: '858973074', title: '到期公告', content: '到期公告', time: '2026-08-20 10:00' } });
  const botHeaders = { authorization: 'Bot bot-token-for-tests-only' };
  const due = await call('GET', 'bot-due', { headers: botHeaders, query: { before: '2026-08-25 10:00' } });
  assert.ok(due.body.items.some(item => item.id === created.body.id));
  const claimed = await call('POST', 'bot-claim', { headers: botHeaders, body: { id: created.body.id, botId: 'test-bot' } });
  assert.equal(claimed.status, 200);
  assert.equal((await call('POST', 'bot-claim', { headers: botHeaders, body: { id: created.body.id, botId: 'other-bot' } })).status, 409);
  assert.equal((await call('POST', 'bot-complete', { headers: botHeaders, body: { id: created.body.id, claimToken: claimed.body.claimToken, messageId: '123' } })).status, 200);
  assert.equal((await call('POST', 'bot-claim', { headers: botHeaders, body: { id: created.body.id } })).status, 409);
});

test('future tasks cannot be claimed and uncertain sends never auto-retry', async () => {
  const check = await call('GET', 'admin-check', { headers: { 'x-admin-device': 'legacy-device' } });
  const headers = { cookie: check.headers['set-cookie'].split(';')[0] };
  const future = await call('POST', 'announcement', { headers, body: { groupId: '858973074', title: '未来公告', content: '未来公告', time: '2099-01-01 00:00' } });
  const botHeaders = { authorization: 'Bot bot-token-for-tests-only' };
  assert.equal((await call('POST', 'bot-claim', { headers: botHeaders, body: { id: future.body.id } })).status, 409);

  const due = await call('POST', 'announcement', { headers, body: { groupId: '858973074', title: '不确定公告', content: '不确定公告', time: '2026-08-20 10:00' } });
  const claimed = await call('POST', 'bot-claim', { headers: botHeaders, body: { id: due.body.id } });
  assert.equal((await call('POST', 'bot-fail', { headers: botHeaders, body: { id: due.body.id, claimToken: claimed.body.claimToken, error: 'NapCat timeout', uncertain: true } })).status, 200);
  const pending = await call('GET', 'bot-due', { headers: botHeaders, query: { before: '2099-01-02 00:00' } });
  assert.ok(!pending.body.items.some(item => item.id === due.body.id));
});

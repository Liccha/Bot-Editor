'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'portfolio-demo-'));
process.env.ANNOUNCEMENT_STORAGE = 'local';
process.env.ANNOUNCEMENT_LOCAL_DIR = root;
process.env.ANNOUNCEMENT_ADMIN_SALT = 'demo-salt';
process.env.ANNOUNCEMENT_ADMIN_HASH = 'demo-hash';
process.env.ANNOUNCEMENT_SESSION_SECRET = 'demo-session';
process.env.ANNOUNCEMENT_BOT_TOKEN = 'demo-bot';
process.env.ANNOUNCEMENT_DESKTOP_TOKEN = 'demo-owner';
process.env.ANNOUNCEMENT_HIDDEN_GROUP_ID = 'demo-group';
process.env.ANNOUNCEMENT_OBJECT_PREFIX = 'portfolio-demo/v1/';
process.env.PORTFOLIO_DEMO_MODE = '1';
process.env.PORTFOLIO_DEMO_EXPIRES_AT = '2099-01-01T00:00:00.000Z';

const { getStore } = require('../api/_lib/storage');
const { handleEvent } = require('../fc');

function event(method, requestPath, query = {}, body = null, token = '') {
  return {
    rawPath: requestPath,
    headers: {
      host: 'portfolio-demo.example.fcapp.run',
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: token } : {}),
    },
    queryParameters: query,
    body: body == null ? '' : JSON.stringify(body),
    requestContext: { http: { method, path: requestPath, sourceIp: '203.0.113.8' } },
  };
}

test('portfolio demo storage is isolated and the owner can revoke every write', async () => {
  await getStore().put('probe.json', Buffer.from('{}'));
  assert.equal(fs.existsSync(path.join(root, 'portfolio-demo', 'v1', 'probe.json')), true);
  assert.equal(fs.existsSync(path.join(root, 'probe.json')), false);

  const initial = await handleEvent(event('GET', '/api/demo-access'));
  assert.equal(initial.statusCode, 200);
  assert.equal(JSON.parse(initial.body).writeEnabled, true);

  const enrolled = await handleEvent(event('POST', '/api/mobile-data', { action: 'enroll-editor' }, {
    installationId: '11111111-1111-4111-8111-111111111111',
    secret: 'a'.repeat(43),
    name: 'demo',
  }));
  assert.equal(enrolled.statusCode, 201);
  const demoToken = JSON.parse(enrolled.body).token;
  assert.match(demoToken, /^demo\./);
  const authenticated = require('../api/_lib/demo-auth').editorFromRequest({ headers: { authorization: `Device ${demoToken}` } });
  assert.equal(authenticated?.scope, 'portfolio-demo-editor');

  const desktop = 'Desktop demo-owner';
  const seeded = await handleEvent(event('POST', '/api/mobile-data', { action: 'bootstrap-songs' }, {
    columns: ['id', 'song_name', 'author'], items: [{ id: '1', song_name: 'seed', author: 'demo' }],
  }, desktop));
  assert.equal(seeded.statusCode, 201);
  const created = await handleEvent(event('POST', '/api/mobile-data', { action: 'song-create' }, {
    id: '2', values: { song_name: 'created', author: 'visitor' },
  }, `Device ${demoToken}`));
  assert.equal(created.statusCode, 201);
  const item = await handleEvent(event('GET', '/api/mobile-data', { action: 'song-item', id: '2' }, null, `Device ${demoToken}`));
  assert.equal(JSON.parse(item.body).song_name, 'created');
  const deleted = await handleEvent(event('POST', '/api/mobile-data', { action: 'song-delete' }, { id: '2' }, `Device ${demoToken}`));
  assert.equal(deleted.statusCode, 200);

  const disabled = await handleEvent(event('POST', '/api/demo-access', {}, { enabled: false }, 'Desktop demo-owner'));
  assert.equal(disabled.statusCode, 200);
  assert.equal(JSON.parse(disabled.body).writeEnabled, false);

  const mutation = await handleEvent(event('POST', '/api/mobile-data', { action: 'enroll-editor' }, {
    installationId: '11111111-1111-4111-8111-111111111111',
    secret: 'a'.repeat(43),
    name: 'demo',
  }));
  assert.equal(mutation.statusCode, 423);
  assert.equal(JSON.parse(mutation.body).error, 'portfolio demo writes are closed');

  const relay = await handleEvent(event('GET', '/api/mobile-relay'));
  assert.equal(relay.statusCode, 404);
});

test.after(() => fs.rmSync(root, { recursive: true, force: true }));

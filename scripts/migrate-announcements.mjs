import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import OSS from 'ali-oss';

function env(name) { const value = process.env[name]; if (!value) throw new Error(`Missing ${name}`); return value; }
function sha256(buffer) { return crypto.createHash('sha256').update(buffer).digest('hex'); }
function now() { return new Date().toISOString(); }
function walk(dir) { return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? walk(path.join(dir, entry.name)) : [path.join(dir, entry.name)]); }
const root = path.resolve('..');
const dataFile = process.env.ANNOUNCEMENT_SOURCE_JSON || path.join(root, 'data', 'announcements.json');
const attachmentDir = process.env.ANNOUNCEMENT_SOURCE_FILES || path.join(root, 'announce_files');
const devicesFile = process.env.ANNOUNCEMENT_SOURCE_DEVICES || path.join(root, 'admin_devices.json');
const client = new OSS({ region: env('ALI_OSS_REGION'), bucket: env('ALI_OSS_BUCKET'), accessKeyId: env('ALI_OSS_ACCESS_KEY_ID'), accessKeySecret: env('ALI_OSS_ACCESS_KEY_SECRET'), secure: true });

const source = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
if (!Array.isArray(source)) throw new Error('Source announcements must be an array');
const migratedAt = now(); const uploaded = []; const missing = [];
const localFiles = fs.existsSync(attachmentDir) ? walk(attachmentDir) : [];
const available = new Set();
for (const local of localFiles) {
  const relative = path.relative(attachmentDir, local).split(path.sep).join('/');
  if (relative.includes('..') || relative.startsWith('/')) throw new Error(`Unsafe local attachment path: ${local}`);
  const content = fs.readFileSync(local); const key = `uploads/${relative}`;
  await client.put(key, content);
  const head = await client.head(key); const remoteSize = Number(head.res.headers['content-length'] || 0);
  if (remoteSize !== content.length) throw new Error(`Size verification failed for ${relative}`);
  uploaded.push({ key, bytes: content.length, sha256: sha256(content) }); available.add(relative);
}
for (const item of source) {
  item.id ||= crypto.randomUUID();
  item.revision = Number(item.revision || 1);
  item.createdAt ||= migratedAt; item.updatedAt ||= migratedAt;
  item.status = item.sent === 'true' ? 'sent' : 'scheduled';
  for (const field of ['image', 'attach']) {
    if (!item[field]) continue;
    const tokens = String(item[field]).split('|').filter(Boolean); const mapped = [];
    for (const token of tokens) {
      const safe = token.replace(/\\/g, '/');
      if (safe.includes('..') || safe.startsWith('/')) throw new Error(`Unsafe attachment token: ${token}`);
      if (!available.has(safe)) missing.push({ announcementId: item.id, field, token });
      mapped.push(`uploads/${safe}`);
    }
    item[field] = mapped.join('|');
  }
}
const document = { schema: 2, revision: 1, updatedAt: migratedAt, items: source };
await client.put('announcements/current.json', Buffer.from(JSON.stringify(document)));
await client.put(`announcements/revisions/migration-${migratedAt.replace(/[:.]/g, '-')}.json`, Buffer.from(JSON.stringify(document)));
const pending = source.filter(i => i.sent !== 'true').map(i => ({ id: i.id, time: i.time, revision: i.revision, status: i.status })).sort((a, b) => a.time.localeCompare(b.time));
await client.put('dispatch/index.json', Buffer.from(JSON.stringify({ updatedAt: migratedAt, items: pending })));
const rawDevices = JSON.parse(fs.readFileSync(devicesFile, 'utf8'));
const devices = (Array.isArray(rawDevices) ? rawDevices : []).map(value => typeof value === 'string' ? { id: value, source: 'legacy', migratedAt } : { ...value, id: String(value.id || value.device || ''), source: 'legacy', migratedAt }).filter(value => value.id);
await client.put('security/admin-devices.json', Buffer.from(JSON.stringify({ schema: 1, updatedAt: migratedAt, devices })));
const report = { migratedAt, announcements: source.length, pending: pending.length, devices: devices.length, uploadedFiles: uploaded.length, uploadedBytes: uploaded.reduce((n, f) => n + f.bytes, 0), missing, uploaded };
fs.writeFileSync('migration-report.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify({ ...report, uploaded: undefined }, null, 2));
if (missing.length) throw new Error(`${missing.length} referenced attachment(s) are missing; cloud data was uploaded but cutover must not continue`);

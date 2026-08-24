import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import OSS from 'ali-oss';

function readPairs(file) {
  const result = {};
  for (const rawLine of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const split = line.indexOf('=');
    if (split > 0) result[line.slice(0, split).trim()] = line.slice(split + 1).trim();
  }
  return result;
}

const deployDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const projectDir = path.resolve(deployDir, '..');
const sourceFile = path.join(projectDir, 'visits.log');
if (!fs.existsSync(sourceFile)) {
  console.log('No local visits.log was found; cloud counters will start empty.');
  process.exit(0);
}
const source = fs.readFileSync(sourceFile);
const importId = crypto.createHash('sha256').update(source).digest('hex');
const counts = {};
for (const line of source.toString('utf8').split(/\r?\n/)) {
  const match = line.match(/^\[(\d{4}-\d{2}-\d{2})\s/);
  if (match) counts[match[1]] = Number(counts[match[1]] || 0) + 1;
}
const importedTotal = Object.values(counts).reduce((sum, value) => sum + value, 0);
const credentials = readPairs(path.join(projectDir, 'data', 'cloud-announcement.credentials.properties'));
const client = new OSS({
  region: credentials.ALI_OSS_REGION,
  bucket: credentials.ALI_OSS_BUCKET,
  accessKeyId: credentials.ALI_OSS_ACCESS_KEY_ID,
  accessKeySecret: credentials.ALI_OSS_ACCESS_KEY_SECRET,
  secure: true
});
const key = 'announcements/site-visits.json';
let document = { schema: 1, revision: 0, updatedAt: new Date().toISOString(), total: 0, days: {}, hours: {}, imports: {} };
try { document = JSON.parse((await client.get(key)).content.toString('utf8')); }
catch (error) { if (!(error.status === 404 || error.code === 'NoSuchKey')) throw error; }
document.days ||= {}; document.imports ||= {};
if (!document.imports[importId]) {
  for (const [day, views] of Object.entries(counts)) {
    const current = document.days[day] && typeof document.days[day] === 'object' ? document.days[day] : {};
    current.views = Number(current.views || 0) + views;
    current.unique = Number(current.unique || 0);
    delete current.visitors;
    document.days[day] = current;
  }
  document.total = Number(document.total || 0) + importedTotal;
  document.imports[importId] = { importedAt: new Date().toISOString(), views: importedTotal };
  document.revision = Number(document.revision || 0) + 1;
  document.updatedAt = new Date().toISOString();
  await client.put(key, Buffer.from(JSON.stringify(document)));
}
const verified = JSON.parse((await client.get(key)).content.toString('utf8'));
if (!verified.imports?.[importId]) throw new Error('Cloud visit migration verification failed');
console.log(`Migrated ${importedTotal} historical visit events as daily aggregates; raw IP addresses stayed local.`);

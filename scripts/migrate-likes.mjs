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
const credentials = readPairs(path.join(projectDir, 'data', 'cloud-announcement.credentials.properties'));
const source = JSON.parse(fs.readFileSync(path.join(projectDir, 'song-library', 'data', 'likes.json'), 'utf8'));
const client = new OSS({
  region: credentials.ALI_OSS_REGION,
  bucket: credentials.ALI_OSS_BUCKET,
  accessKeyId: credentials.ALI_OSS_ACCESS_KEY_ID,
  accessKeySecret: credentials.ALI_OSS_ACCESS_KEY_SECRET,
  secure: true
});
const key = 'announcements/site-likes.json';
let document = null;
try {
  const current = await client.get(key);
  document = JSON.parse(current.content.toString('utf8'));
} catch (error) {
  if (!(error.status === 404 || error.code === 'NoSuchKey')) throw error;
}

if (!document) {
  document = { schema: 1, revision: 1, updatedAt: new Date().toISOString(), counts: source, days: {} };
  await client.put(key, Buffer.from(JSON.stringify(document)));
} else {
  document.counts ||= {};
  for (const [songId, count] of Object.entries(source)) {
    document.counts[songId] = Math.max(Number(document.counts[songId] || 0), Number(count || 0));
  }
  document.schema = 1;
  document.revision = Number(document.revision || 0) + 1;
  document.updatedAt = new Date().toISOString();
  await client.put(key, Buffer.from(JSON.stringify(document)));
}
const verified = JSON.parse((await client.get(key)).content.toString('utf8'));
if (!verified.counts || Object.keys(verified.counts).length < Object.keys(source).length) throw new Error('Cloud like migration verification failed');
console.log(`Migrated and verified ${Object.keys(verified.counts).length} song like counters.`);

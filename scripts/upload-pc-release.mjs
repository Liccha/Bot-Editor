import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import OSS from 'ali-oss';

const deployDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const songBotDir = path.resolve(deployDir, '..');

function properties(file) {
  const values = {};
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([^#=]+?)\s*=\s*(.*)\s*$/);
    if (match) values[match[1]] = match[2];
  }
  return values;
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function required(value, name) {
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

async function upload(client, key, file) {
  const size = fs.statSync(file).size;
  await client.multipartUpload(key, file, {
    parallel: 4,
    partSize: 5 * 1024 * 1024,
    headers: {
      'Content-Type': 'application/vnd.microsoft.portable-executable',
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
  const head = await client.head(key);
  if (Number(head.res.headers['content-length'] || 0) !== size) {
    throw new Error(`Remote size verification failed: ${key}`);
  }
  return size;
}

const [version, setupArg, standaloneArg] = process.argv.slice(2);
if (!/^\d+(?:\.\d+){1,3}$/.test(version || '')) throw new Error('Invalid version');
const setup = path.resolve(required(setupArg, 'setup path'));
const standalone = path.resolve(required(standaloneArg, 'standalone path'));
for (const file of [setup, standalone]) if (!fs.statSync(file).isFile()) throw new Error(`Not a file: ${file}`);

const cfg = properties(path.join(songBotDir, 'data', 'cloud-library.credentials.properties'));
const configuredRegion = required(cfg.ALI_OSS_REGION, 'ALI_OSS_REGION');
const publicBase = (cfg.ALI_LIBRARY_PUBLIC_BASE || 'https://assets.teacharm.moe').replace(/\/$/, '');
const client = new OSS({
  region: configuredRegion.startsWith('oss-') ? configuredRegion : `oss-${configuredRegion}`,
  bucket: required(cfg.ALI_OSS_BUCKET, 'ALI_OSS_BUCKET'),
  accessKeyId: required(cfg.ALI_OSS_ACCESS_KEY_ID, 'ALI_OSS_ACCESS_KEY_ID'),
  accessKeySecret: required(cfg.ALI_OSS_ACCESS_KEY_SECRET, 'ALI_OSS_ACCESS_KEY_SECRET'),
  secure: true,
});

const setupHash = sha256(setup);
const standaloneHash = sha256(standalone);
const root = `bot-workstation/releases/${version}`;
const setupKey = `${root}/BotWorkstation-Setup-${version}-${setupHash.slice(0, 12)}.exe`;
const standaloneKey = `${root}/BotWorkstation-${version}-${standaloneHash.slice(0, 12)}-standalone.exe`;
const setupSize = await upload(client, setupKey, setup);
const standaloneSize = await upload(client, standaloneKey, standalone);
const manifest = {
  schema: 1,
  version,
  url: `${publicBase}/${setupKey}`,
  sha256: setupHash,
  size: setupSize,
  publishedAt: new Date().toISOString(),
  notes: '发现新版本。',
  backup: {
    url: `${publicBase}/${standaloneKey}`,
    sha256: standaloneHash,
    size: standaloneSize,
  },
};
const latestKey = 'bot-workstation/releases/latest.json';
await client.put(latestKey, Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`), {
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store, max-age=0' },
});
const persisted = JSON.parse((await client.get(latestKey)).content.toString('utf8'));
if (persisted.version !== version || persisted.sha256 !== setupHash) throw new Error('Manifest verification failed');
console.log(JSON.stringify({ ok: true, version, setupSize, standaloneSize }, null, 2));

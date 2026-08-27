import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import OSS from 'ali-oss';

const deployDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const songBotDir = path.resolve(deployDir, '..');

function pairs(file) {
  const result = {};
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([^#=]+?)\s*=\s*(.*)\s*$/);
    if (match) result[match[1]] = match[2];
  }
  return result;
}

function required(value, name) {
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

const [version, setupArg, standaloneArg] = process.argv.slice(2);
if (!/^\d+(?:\.\d+){1,3}$/.test(version || '')) throw new Error('Version must be numeric, for example 1.1.0');
const setup = path.resolve(required(setupArg, 'setup path'));
const standalone = path.resolve(required(standaloneArg, 'standalone path'));
for (const file of [setup, standalone]) if (!fs.statSync(file).isFile()) throw new Error(`Not a file: ${file}`);

const cfg = pairs(path.join(songBotDir, 'data', 'cloud-library.credentials.properties'));
const publicBase = (cfg.ALI_LIBRARY_PUBLIC_BASE || 'https://assets.teacharm.moe').replace(/\/$/, '');
if (publicBase !== 'https://assets.teacharm.moe') throw new Error('Unexpected public release origin');
const configuredRegion = required(cfg.ALI_OSS_REGION, 'ALI_OSS_REGION');
const region = configuredRegion.startsWith('oss-') ? configuredRegion : `oss-${configuredRegion}`;
const client = new OSS({
  region,
  bucket: required(cfg.ALI_OSS_BUCKET, 'ALI_OSS_BUCKET'),
  accessKeyId: required(cfg.ALI_OSS_ACCESS_KEY_ID, 'ALI_OSS_ACCESS_KEY_ID'),
  accessKeySecret: required(cfg.ALI_OSS_ACCESS_KEY_SECRET, 'ALI_OSS_ACCESS_KEY_SECRET'),
  secure: true,
});

const root = 'bot-workstation/releases';
const setupHash = sha256(setup);
const standaloneHash = sha256(standalone);
const setupKey = `${root}/${version}/BotWorkstation-Setup-${version}-${setupHash.slice(0, 12)}.exe`;
const standaloneKey = `${root}/${version}/BotWorkstation-${version}-${standaloneHash.slice(0, 12)}-standalone.exe`;
const latestKey = `${root}/latest.json`;
const setupSize = fs.statSync(setup).size;
const standaloneSize = fs.statSync(standalone).size;
const manifest = {
  schema: 1,
  version,
  url: `${publicBase}/${setupKey}`,
  sha256: setupHash,
  size: setupSize,
  publishedAt: new Date().toISOString(),
  notes: '电脑在线状态改为轻量心跳并即时同步每日歌曲与竞猜开关；修复手机刷新等待远程命令队列的问题。',
  backup: {
    url: `${publicBase}/${standaloneKey}`,
    sha256: standaloneHash,
    size: standaloneSize,
  },
};

const binaryHeaders = {
  'Content-Type': 'application/vnd.microsoft.portable-executable',
  'Cache-Control': 'public, max-age=31536000, immutable',
};
await client.put(setupKey, setup, { headers: binaryHeaders });
await client.put(standaloneKey, standalone, { headers: binaryHeaders });
for (const [key, expected] of [[setupKey, setupSize], [standaloneKey, standaloneSize]]) {
  const head = await client.head(key);
  const actual = Number(head.res.headers['content-length'] || 0);
  if (actual !== expected) throw new Error(`Remote size verification failed: ${key}`);
}
await client.put(latestKey, Buffer.from(JSON.stringify(manifest, null, 2)), {
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store, max-age=0' },
});
const remoteManifest = JSON.parse((await client.get(latestKey)).content.toString('utf8'));
if (remoteManifest.sha256 !== manifest.sha256 || remoteManifest.version !== version) {
  throw new Error('Remote manifest verification failed');
}

const localManifest = path.resolve(path.dirname(setup), 'latest.json');
fs.writeFileSync(localManifest, JSON.stringify(manifest, null, 2));
console.log(JSON.stringify({ ok: true, version, setupKey, setupSize, standaloneKey, standaloneSize, latestKey }, null, 2));

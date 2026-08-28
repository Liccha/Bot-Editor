import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import OSS from 'ali-oss';

const deployDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const parentDir = path.resolve(deployDir, '..');
const credentialCandidates = [
  path.join(parentDir, 'data', 'cloud-library.credentials.properties'),
  path.join(parentDir, 'SongBot', 'data', 'cloud-library.credentials.properties'),
];

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

const [version, apkArg] = process.argv.slice(2);
if (!/^\d+(?:\.\d+){1,3}$/.test(version || '')) throw new Error('Version must be numeric, for example 1.0.1');
const apk = path.resolve(required(apkArg, 'APK path'));
if (!fs.statSync(apk).isFile() || path.extname(apk).toLowerCase() !== '.apk') throw new Error(`Not an APK: ${apk}`);

const credentialFile = credentialCandidates.find(file => fs.existsSync(file));
if (!credentialFile) throw new Error('Cloud library credential file was not found beside the deployment checkout');
const cfg = pairs(credentialFile);
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

const root = 'bot-workstation/mobile';
const hash = sha256(apk);
const size = fs.statSync(apk).size;
const apkKey = `${root}/releases/${version}/BotWorkstation-Mobile-${version}-${hash.slice(0, 12)}.apk`;
const latestKey = `${root}/latest.json`;
const manifest = {
  schema: 1,
  version,
  url: `${publicBase}/${apkKey}`,
  sha256: hash,
  size,
  publishedAt: new Date().toISOString(),
  notes: '歌曲列表改为首屏 100 首、触底再加载 100 首；已校验的同版本更新包可直接复用，避免重复下载。',
};

await client.put(apkKey, apk, {
  headers: {
    'Content-Type': 'application/vnd.android.package-archive',
    'Cache-Control': 'public, max-age=31536000, immutable',
  },
});
const head = await client.head(apkKey);
if (Number(head.res.headers['content-length'] || 0) !== size) throw new Error(`Remote size verification failed: ${apkKey}`);
await client.put(latestKey, Buffer.from(JSON.stringify(manifest, null, 2)), {
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store, max-age=0' },
});
const remoteManifest = JSON.parse((await client.get(latestKey)).content.toString('utf8'));
if (remoteManifest.version !== version || remoteManifest.sha256 !== hash || remoteManifest.url !== manifest.url) {
  throw new Error('Remote mobile manifest verification failed');
}

console.log(JSON.stringify({ ok: true, version, apkKey, size, latestKey }, null, 2));

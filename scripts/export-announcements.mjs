import fs from 'node:fs';
import path from 'node:path';
import OSS from 'ali-oss';
function env(name) { const value = process.env[name]; if (!value) throw new Error(`Missing ${name}`); return value; }
const client = new OSS({ region: env('ALI_OSS_REGION'), bucket: env('ALI_OSS_BUCKET'), accessKeyId: env('ALI_OSS_ACCESS_KEY_ID'), accessKeySecret: env('ALI_OSS_ACCESS_KEY_SECRET'), secure: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const output = path.resolve('..', 'backups', `cloud-export-${stamp}`);
fs.mkdirSync(path.join(output, 'announce_files'), { recursive: true });
const current = await client.get('announcements/current.json');
const document = JSON.parse(current.content.toString('utf8'));
const exported = document.items.filter(item => !item.deletedAt && item.status !== 'deleted').map(item => {
  const copy = { ...item };
  for (const field of ['image', 'attach']) if (copy[field]) copy[field] = String(copy[field]).split('|').map(key => key.replace(/^uploads\//, '')).join('|');
  delete copy.claim; delete copy.status; delete copy.revision; delete copy.createdAt; delete copy.updatedAt; delete copy.deletedAt;
  return copy;
});
fs.writeFileSync(path.join(output, 'announcements.json'), JSON.stringify(exported));
let marker; let count = 0;
do {
  const listed = await client.listV2({ prefix: 'uploads/', 'max-keys': 1000, ...(marker ? { 'continuation-token': marker } : {}) });
  for (const object of listed.objects || []) {
    const relative = object.name.replace(/^uploads\//, ''); const target = path.join(output, 'announce_files', ...relative.split('/'));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const downloaded = await client.get(object.name); fs.writeFileSync(target, downloaded.content); count++;
  }
  marker = listed.nextContinuationToken;
} while (marker);
console.log(`Exported ${exported.length} announcements and ${count} files to ${output}`);

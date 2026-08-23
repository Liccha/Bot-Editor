import fs from 'node:fs';
import OSS from 'ali-oss';
function env(name) { const value = process.env[name]; if (!value) throw new Error(`Missing ${name}`); return value; }
const report = JSON.parse(fs.readFileSync('migration-report.json', 'utf8'));
const client = new OSS({ region: env('ALI_OSS_REGION'), bucket: env('ALI_OSS_BUCKET'), accessKeyId: env('ALI_OSS_ACCESS_KEY_ID'), accessKeySecret: env('ALI_OSS_ACCESS_KEY_SECRET'), secure: true });
const object = await client.get('announcements/current.json');
const document = JSON.parse(object.content.toString('utf8'));
const errors = [];
if (document.items.length !== report.announcements) errors.push(`announcement count ${document.items.length} != ${report.announcements}`);
for (const file of report.uploaded) {
  try { const head = await client.head(file.key); if (Number(head.res.headers['content-length']) !== file.bytes) errors.push(`size mismatch: ${file.key}`); }
  catch (error) { errors.push(`missing: ${file.key}: ${error.code || error.message}`); }
}
if (errors.length) { console.error(errors.join('\n')); process.exitCode = 1; }
else console.log(`Verified ${document.items.length} announcements and ${report.uploaded.length} files.`);

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const root = path.resolve('..');
const dataFile = path.join(root, 'data', 'announcements.json');
const filesRoot = path.join(root, 'announce_files');
const devicesFile = path.join(root, 'admin_devices.json');
const announcements = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
const devices = JSON.parse(fs.readFileSync(devicesFile, 'utf8'));
if (!Array.isArray(announcements) || !Array.isArray(devices)) throw new Error('Announcements and devices must be JSON arrays');
const ids = new Set(); const refs = []; const errors = [];
for (const [index, item] of announcements.entries()) {
  if (!item.id) errors.push(`announcement ${index} has no id`); else if (ids.has(item.id)) errors.push(`duplicate id: ${item.id}`); else ids.add(item.id);
  if (!item.title || !item.content || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(String(item.time || ''))) errors.push(`invalid required fields: ${item.id || index}`);
  if (item.image) refs.push(item.image);
  if (item.attach) refs.push(...String(item.attach).split('|').filter(Boolean));
}
for (const token of refs) {
  const safe = String(token).replace(/\\/g, '/');
  if (safe.includes('..') || safe.startsWith('/')) { errors.push(`unsafe token: ${token}`); continue; }
  if (!fs.existsSync(path.join(filesRoot, ...safe.split('/')))) errors.push(`missing file: ${token}`);
}
const allFiles = [];
function walk(dir) { if (!fs.existsSync(dir)) return; for (const entry of fs.readdirSync(dir, { withFileTypes: true })) { const full = path.join(dir, entry.name); if (entry.isDirectory()) walk(full); else allFiles.push(full); } }
walk(filesRoot);
const totalBytes = allFiles.reduce((sum, file) => sum + fs.statSync(file).size, 0);
const fingerprint = crypto.createHash('sha256').update(fs.readFileSync(dataFile)).digest('hex');
const report = { ok: errors.length === 0, announcements: announcements.length, pending: announcements.filter(item => item.sent !== 'true').length, referencedFiles: refs.length, storedFiles: allFiles.length, storedBytes: totalBytes, adminDevices: devices.length, sourceSha256: fingerprint, errors };
console.log(JSON.stringify(report, null, 2));
if (errors.length) process.exitCode = 1;

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const source = process.env.WEBSITE_POST_SOURCE || 'D:/my-blog/source/_posts';
const propertiesFile = process.env.ANNOUNCEMENT_CLOUD_PROPERTIES || path.resolve('..', 'data', 'cloud-announcement.properties');

function readProperties(file) {
  const values = {};
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim(); if (!line || line.startsWith('#')) continue;
    const split = line.indexOf('='); if (split < 1) continue;
    values[line.slice(0, split).trim()] = line.slice(split + 1).trim();
  }
  return values;
}
const properties = readProperties(propertiesFile);
const api = String(process.env.ANNOUNCEMENT_CLOUD_API || properties.api || '').replace(/\/$/, '');
const desktopToken = String(process.env.ANNOUNCEMENT_DESKTOP_TOKEN || properties.desktopToken || '');
if (!api || !desktopToken) throw new Error('Cloud API or desktop token is missing');
const headers = { Authorization: `Desktop ${desktopToken}`, 'X-Admin-Device': 'website-migration', Accept: 'application/json' };
async function request(action, options = {}) {
  const response = await fetch(`${api}?action=${encodeURIComponent(action)}${options.name ? `&name=${encodeURIComponent(options.name)}` : ''}`, {
    method: options.method || 'GET', headers: { ...headers, ...(options.body ? { 'Content-Type': 'application/json; charset=utf-8' } : {}) },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  if (!response.ok) throw new Error(`${action} failed with HTTP ${response.status}`);
  return response.json();
}
const files = fs.readdirSync(source, { withFileTypes: true }).filter(entry => entry.isFile() && entry.name.toLowerCase().endsWith('.md'));
const posts = files.map(entry => {
  const file = path.join(source, entry.name); const content = fs.readFileSync(file, 'utf8'); const stat = fs.statSync(file);
  return { name: entry.name.normalize('NFC'), content, size: Buffer.byteLength(content), sha256: crypto.createHash('sha256').update(content).digest('hex'), modified: stat.mtimeMs };
}).sort((a, b) => b.modified - a.modified);
const existing = await request('website-list');
if (existing.length && process.env.WEBSITE_MIGRATION_REPLACE !== '1') {
  throw new Error('Cloud website posts already exist; migration stopped without changing them');
}
const existingByName = new Map(existing.map(item => [item.name, item]));
for (const post of posts) {
  const previous = existingByName.get(post.name);
  if (previous?.sha256 === post.sha256) continue;
  await request('website-save', { method: 'POST', name: post.name, body: {
    name: post.name, content: post.content, ...(previous ? { revision: previous.revision } : {})
  } });
}
const remote = await request('website-list');
const remoteByName = new Map(remote.map(item => [item.name, item]));
const errors = posts.filter(post => remoteByName.get(post.name)?.sha256 !== post.sha256).map(post => post.name);
if (errors.length) throw new Error(`Hash verification failed for ${errors.join(', ')}`);
console.log(JSON.stringify({ ok: true, site: 'teacharm.moe', posts: posts.length, bytes: posts.reduce((sum, post) => sum + post.size, 0), verified: posts.length }));

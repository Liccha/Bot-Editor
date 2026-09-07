import fs from 'node:fs';

function args(argv) {
  const values = {};
  for (let i = 0; i < argv.length; i += 2) values[argv[i].replace(/^--/, '')] = argv[i + 1];
  return values;
}

function env(file) {
  const result = {};
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const split = raw.indexOf('=');
    if (split > 0) result[raw.slice(0, split).trim()] = raw.slice(split + 1).trim().replace(/^['"]|['"]$/g, '');
  }
  return result;
}

const input = args(process.argv.slice(2));
if (!input.env || !input.endpoint || !/^(true|false)$/.test(input.enabled || '')) {
  throw new Error('Usage: node scripts/set-demo-access.mjs --env <private env> --endpoint <FC URL> --enabled <true|false> [--expires <ISO date>]');
}
const token = env(input.env).ANNOUNCEMENT_DESKTOP_TOKEN;
if (!token) throw new Error('private env is missing ANNOUNCEMENT_DESKTOP_TOKEN');
const url = new URL('/api/demo-access', input.endpoint);
if (url.protocol !== 'https:' || !url.hostname.endsWith('.fcapp.run')) throw new Error('demo endpoint must be an HTTPS FC URL');
const response = await fetch(url, {
  method: 'POST',
  headers: { Authorization: `Desktop ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ enabled: input.enabled === 'true', ...(input.expires ? { expiresAt: input.expires } : {}) }),
  signal: AbortSignal.timeout(10_000),
});
const value = await response.json();
if (!response.ok) throw new Error(`demo access update failed (HTTP ${response.status})`);
console.log(JSON.stringify(value));

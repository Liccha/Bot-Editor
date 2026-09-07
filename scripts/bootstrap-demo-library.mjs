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

function csv(text) {
  const rows = []; let row = []; let field = ''; let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted && char === '"' && text[i + 1] === '"') { field += '"'; i++; }
    else if (char === '"') quoted = !quoted;
    else if (!quoted && char === ',') { row.push(field); field = ''; }
    else if (!quoted && (char === '\r' || char === '\n')) {
      if (char === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += char;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const columns = (rows.shift() || []).map((value, index) => index === 0 ? value.replace(/^\ufeff/, '') : value);
  return { columns, items: rows.filter(values => values.some(Boolean)).map(values => Object.fromEntries(columns.map((column, index) => [column, values[index] || '']))) };
}

const input = args(process.argv.slice(2));
if (!input.env || !input.endpoint || !input.songs || !input.stable) {
  throw new Error('Usage: node scripts/bootstrap-demo-library.mjs --env <private env> --endpoint <FC URL> --songs <songs.csv> --stable <stable.csv>');
}
const token = env(input.env).ANNOUNCEMENT_DESKTOP_TOKEN;
if (!token) throw new Error('private env is missing ANNOUNCEMENT_DESKTOP_TOKEN');
const endpoint = new URL(input.endpoint);
if (endpoint.protocol !== 'https:' || !endpoint.hostname.endsWith('.fcapp.run')) throw new Error('demo endpoint must be an HTTPS FC URL');

for (const [name, file] of [['songs', input.songs], ['stable', input.stable]]) {
  const data = csv(fs.readFileSync(file, 'utf8'));
  const url = new URL('/api/mobile-data', endpoint);
  url.searchParams.set('action', `bootstrap-${name}`);
  const response = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Desktop ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
    signal: AbortSignal.timeout(30_000),
  });
  if (response.status === 409) { console.log(`${name}: already initialized`); continue; }
  if (!response.ok) throw new Error(`${name}: bootstrap failed (HTTP ${response.status})`);
  console.log(`${name}: ${data.items.length} records`);
}

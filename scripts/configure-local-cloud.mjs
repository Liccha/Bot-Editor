import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const deployDir = path.resolve(here, '..');
const projectDir = path.resolve(deployDir, '..');

function pairs(file) {
  const result = {};
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const index = line.indexOf('=');
    if (index > 0) result[line.slice(0, index).trim()] = line.slice(index + 1).trim();
  }
  return result;
}

const secrets = pairs(path.join(deployDir, '.env.announcement.generated'));
if (!secrets.ANNOUNCEMENT_BOT_TOKEN || !secrets.ANNOUNCEMENT_DESKTOP_TOKEN) {
  throw new Error('Cloud bot or desktop token is missing');
}

const dataDir = path.join(projectDir, 'data');
fs.mkdirSync(dataDir, { recursive: true });
const output = path.join(dataDir, 'cloud-announcement.properties');
const temp = `${output}.tmp`;
const body = [
  'backend=cloud',
  'api=https://songbotstic-api-cwpfgfkkpj.cn-beijing.fcapp.run/api/announcement-cloud',
  `botToken=${secrets.ANNOUNCEMENT_BOT_TOKEN}`,
  `desktopToken=${secrets.ANNOUNCEMENT_DESKTOP_TOKEN}`,
  `botId=${String(os.hostname() || 'songbot').replace(/[^A-Za-z0-9_.-]/g, '_')}`,
  '',
].join('\n');
fs.writeFileSync(temp, body, { encoding: 'utf8', mode: 0o600 });
fs.renameSync(temp, output);
console.log('Configured local cloud mode with separate bot and desktop credentials.');

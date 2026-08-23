import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const deployDir = path.resolve(here, '..');
const projectDir = path.resolve(deployDir, '..');

function readPairs(file) {
  const result = {};
  for (const rawLine of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const split = line.indexOf('=');
    if (split < 1) continue;
    result[line.slice(0, split).trim()] = line.slice(split + 1).trim();
  }
  return result;
}

const generatedFile = path.join(deployDir, '.env.announcement.generated');
const generated = readPairs(generatedFile);
if (!generated.ANNOUNCEMENT_DESKTOP_TOKEN) {
  generated.ANNOUNCEMENT_DESKTOP_TOKEN = crypto.randomBytes(48).toString('base64url');
  fs.appendFileSync(generatedFile, `ANNOUNCEMENT_DESKTOP_TOKEN=${generated.ANNOUNCEMENT_DESKTOP_TOKEN}\n`, { encoding: 'utf8', mode: 0o600 });
}
const oss = readPairs(path.join(projectDir, 'data', 'cloud-announcement.credentials.properties'));
const songBotSource = fs.readFileSync(
  path.join(projectDir, 'src', 'main', 'java', 'com', 'mybot', 'SongBot.java'),
  'utf8',
);
const hiddenGroup = songBotSource.match(/"(\d{5,20})"\.equals\(item\.optString\("groupId"\)\)/)?.[1];
if (!hiddenGroup) throw new Error('Unable to derive the hidden announcement group safely');

const variables = {
  ANNOUNCEMENT_STORAGE: 'oss',
  ALI_OSS_REGION: oss.ALI_OSS_REGION,
  ALI_OSS_BUCKET: oss.ALI_OSS_BUCKET,
  ALI_OSS_ACCESS_KEY_ID: oss.ALI_OSS_ACCESS_KEY_ID,
  ALI_OSS_ACCESS_KEY_SECRET: oss.ALI_OSS_ACCESS_KEY_SECRET,
  ANNOUNCEMENT_ADMIN_SALT: generated.ANNOUNCEMENT_ADMIN_SALT,
  ANNOUNCEMENT_ADMIN_HASH: generated.ANNOUNCEMENT_ADMIN_HASH,
  ANNOUNCEMENT_SESSION_SECRET: generated.ANNOUNCEMENT_SESSION_SECRET,
  ANNOUNCEMENT_BOT_TOKEN: generated.ANNOUNCEMENT_BOT_TOKEN,
  ANNOUNCEMENT_DESKTOP_TOKEN: generated.ANNOUNCEMENT_DESKTOP_TOKEN,
  ANNOUNCEMENT_HIDDEN_GROUP_ID: hiddenGroup,
};

for (const [name, value] of Object.entries(variables)) {
  if (!value || /[\r\n]/.test(value)) throw new Error(`Missing or unsafe value for ${name}`);
}

const output = path.join(deployDir, '.env.vercel.production');
fs.writeFileSync(output, Object.entries(variables).map(([key, value]) => `${key}=${value}\n`).join(''), {
  encoding: 'utf8',
  mode: 0o600,
});
fs.writeFileSync(path.join(deployDir, '.env.vercel.desktop-only'),
  `ANNOUNCEMENT_DESKTOP_TOKEN=${variables.ANNOUNCEMENT_DESKTOP_TOKEN}\n`, { encoding: 'utf8', mode: 0o600 });

console.log(`Prepared ${Object.keys(variables).length} Production-only variable names in an ignored local file.`);

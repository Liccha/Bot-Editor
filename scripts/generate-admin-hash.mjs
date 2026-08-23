import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';

const fileArg = process.argv.indexOf('--password-file');
const passwordFile = fileArg >= 0 ? process.argv[fileArg + 1] : path.resolve('..', 'admin_password.txt');
const outputArg = process.argv.indexOf('--output');
const output = outputArg >= 0 ? process.argv[outputArg + 1] : path.resolve('.env.announcement.generated');
const password = fs.readFileSync(passwordFile, 'utf8').trim();
if (!password) throw new Error('Administrator password file is empty');
const salt = crypto.randomBytes(24).toString('base64url');
const hash = crypto.scryptSync(password, salt, 32).toString('hex');
const sessionSecret = crypto.randomBytes(48).toString('base64url');
const botToken = crypto.randomBytes(48).toString('base64url');
const desktopToken = crypto.randomBytes(48).toString('base64url');
fs.writeFileSync(output, [
  `ANNOUNCEMENT_ADMIN_SALT=${salt}`,
  `ANNOUNCEMENT_ADMIN_HASH=${hash}`,
  `ANNOUNCEMENT_SESSION_SECRET=${sessionSecret}`,
  `ANNOUNCEMENT_BOT_TOKEN=${botToken}`,
  `ANNOUNCEMENT_DESKTOP_TOKEN=${desktopToken}`,
  ''
].join('\n'), { mode: 0o600 });
console.log(`Generated secrets in ${path.resolve(output)}. The password itself was not copied.`);

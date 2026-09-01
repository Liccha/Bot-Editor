import fs from 'node:fs';
import path from 'node:path';

import FCModule, {
  CreateFunctionInput,
  CreateFunctionRequest,
  CreateTriggerInput,
  CreateTriggerRequest,
  GetFunctionRequest,
  InputCodeLocation,
  UpdateFunctionInput,
  UpdateFunctionRequest,
  UpdateTriggerInput,
  UpdateTriggerRequest,
} from '@alicloud/fc20230330';
import { $OpenApiUtil } from '@alicloud/openapi-core';

const FC = FCModule.default || FCModule;
let fatalReported = false;
function reportFatal(error) {
  if (fatalReported) return;
  fatalReported = true;
  console.error(JSON.stringify({
    ok: false,
    code: String(error?.code || error?.name || 'deployment_failed'),
    statusCode: Number(error?.statusCode || 0),
    message: Number(error?.statusCode || 0) === 403
      ? 'RAM user is missing Function Compute deployment permission'
      : String(error?.message || 'deployment failed').slice(0, 240),
  }));
  process.exitCode = 1;
}
process.on('uncaughtException', reportFatal);
process.on('unhandledRejection', reportFatal);
const REQUIRED_ENV = [
  'ALI_OSS_REGION',
  'ALI_OSS_BUCKET',
  'ALI_OSS_ACCESS_KEY_ID',
  'ALI_OSS_ACCESS_KEY_SECRET',
  'ANNOUNCEMENT_ADMIN_SALT',
  'ANNOUNCEMENT_ADMIN_HASH',
  'ANNOUNCEMENT_SESSION_SECRET',
  'ANNOUNCEMENT_BOT_TOKEN',
  'ANNOUNCEMENT_DESKTOP_TOKEN',
  'ANNOUNCEMENT_HIDDEN_GROUP_ID',
];

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    result[token.slice(2)] = argv[index + 1];
    index += 1;
  }
  return result;
}

function parseEnv(file) {
  const result = {};
  for (const rawLine of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    result[key] = value.replace(/\\n/g, '\n');
  }
  return result;
}

function isNotFound(error) {
  return Number(error?.statusCode || 0) === 404 || String(error?.code || '') === 'NotFound';
}

const args = parseArgs(process.argv.slice(2));
if (!args.env) throw new Error('Usage: npm run deploy:fc -- --env <private env file> [--zip <package>]');
const envFile = path.resolve(args.env);
const zipFile = path.resolve(args.zip || '.fc-build/songbot-domestic-api.zip');
if (!fs.existsSync(envFile)) throw new Error('private env file not found');
if (!fs.existsSync(zipFile)) throw new Error('FC package not found; run npm run build:fc first');

const privateEnv = parseEnv(envFile);
const region = String(privateEnv.ALI_OSS_REGION).replace(/^oss-/, '');
if (!region || !privateEnv.ALI_OSS_ACCESS_KEY_ID || !privateEnv.ALI_OSS_ACCESS_KEY_SECRET) {
  throw new Error('private env is missing the Function Compute deployment credentials');
}
const functionName = String(args.function || 'songbot-domestic-api');
const triggerName = String(args.trigger || 'songbot-domestic-http');
const code = new InputCodeLocation({ zipFile: fs.readFileSync(zipFile).toString('base64') });

const client = new FC(new $OpenApiUtil.Config({
  accessKeyId: privateEnv.ALI_OSS_ACCESS_KEY_ID,
  accessKeySecret: privateEnv.ALI_OSS_ACCESS_KEY_SECRET,
  regionId: region,
  endpoint: `fcv3.${region}.aliyuncs.com`,
  connectTimeout: 5000,
  readTimeout: 30000,
}));

let exists = true;
let existingFunction = null;
try {
  existingFunction = (await client.getFunction(functionName, new GetFunctionRequest({ qualifier: 'LATEST' }))).body;
} catch (error) {
  if (!isNotFound(error)) throw error;
  exists = false;
}
const existingEnvironment = existingFunction?.environmentVariables || {};
const environmentVariables = {
  ...existingEnvironment,
  ...Object.fromEntries(REQUIRED_ENV.map(key => [key, privateEnv[key] || existingEnvironment[key]])),
};
const missing = REQUIRED_ENV.filter(key => !environmentVariables[key]);
if (missing.length) throw new Error(`private env and deployed function are missing required keys: ${missing.join(', ')}`);
environmentVariables.ANNOUNCEMENT_STORAGE = 'oss';
environmentVariables.ANNOUNCEMENT_EMERGENCY_WRITE_LOCK = Object.prototype.hasOwnProperty.call(privateEnv, 'ANNOUNCEMENT_EMERGENCY_WRITE_LOCK')
  ? privateEnv.ANNOUNCEMENT_EMERGENCY_WRITE_LOCK : (existingEnvironment.ANNOUNCEMENT_EMERGENCY_WRITE_LOCK || '');
environmentVariables.SONGBOT_RUNTIME = 'aliyun-fc';

const functionInput = {
  code,
  description: 'SongBot domestic data API',
  environmentVariables,
  handler: 'fc-entry.handler',
  instanceConcurrency: 20,
  internetAccess: true,
  memorySize: 512,
  cpu: 0.25,
  diskSize: 512,
  runtime: 'nodejs20',
  timeout: 20,
};
if (exists) {
  await client.updateFunction(functionName, new UpdateFunctionRequest({ body: new UpdateFunctionInput(functionInput) }));
} else {
  await client.createFunction(new CreateFunctionRequest({
    body: new CreateFunctionInput({ ...functionInput, functionName }),
  }));
}

const triggerConfig = JSON.stringify({
  authType: 'anonymous',
  disableURLInternet: false,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
});
let trigger;
try {
  trigger = (await client.getTrigger(functionName, triggerName)).body;
  trigger = (await client.updateTrigger(functionName, triggerName, new UpdateTriggerRequest({
    body: new UpdateTriggerInput({ qualifier: 'LATEST', triggerConfig }),
  }))).body;
} catch (error) {
  if (!isNotFound(error)) throw error;
  trigger = (await client.createTrigger(functionName, new CreateTriggerRequest({
    body: new CreateTriggerInput({
      description: 'Public HTTP entry; application handlers enforce authorization',
      qualifier: 'LATEST',
      triggerConfig,
      triggerName,
      triggerType: 'http',
    }),
  }))).body;
}

const endpoint = String(trigger?.httpTrigger?.urlInternet || '');
if (!endpoint) throw new Error('function deployed but no public trigger URL was returned');
console.log(JSON.stringify({ ok: true, region, functionName, endpoint }));

import OSS from 'ali-oss';
import crypto from 'node:crypto';

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

const client = new OSS({
  region: required('ALI_OSS_REGION'),
  bucket: required('ALI_OSS_BUCKET'),
  accessKeyId: required('ALI_OSS_ACCESS_KEY_ID'),
  accessKeySecret: required('ALI_OSS_ACCESS_KEY_SECRET'),
  secure: true,
});

const suffix = crypto.randomUUID();
const lockKey = `locks/permission-smoke-${suffix}.json`;
const outsideKey = 'permission-smoke/delete-must-be-denied.txt';
let lockCreated = false;

function isConflict(error) {
  return error?.status === 409
    || error?.code === 'FileAlreadyExists'
    || error?.code === 'ObjectAlreadyExists';
}

function isDenied(error) {
  return error?.status === 403 || error?.code === 'AccessDenied';
}

try {
  await client.put(lockKey, Buffer.from('{"test":true}'), {
    headers: { 'x-oss-forbid-overwrite': 'true' },
  });
  lockCreated = true;

  let duplicateRejected = false;
  try {
    await client.put(lockKey, Buffer.from('{"test":false}'), {
      headers: { 'x-oss-forbid-overwrite': 'true' },
    });
  } catch (error) {
    if (!isConflict(error)) throw error;
    duplicateRejected = true;
  }
  if (!duplicateRejected) throw new Error('Atomic lock creation did not reject an overwrite');

  await client.get(lockKey);
  await client.delete(lockKey);
  lockCreated = false;

  await client.put(outsideKey, Buffer.from(`permission-boundary:${suffix}`));
  let outsideDeleteDenied = false;
  try {
    await client.delete(outsideKey);
  } catch (error) {
    if (!isDenied(error)) throw error;
    outsideDeleteDenied = true;
  }
  if (!outsideDeleteDenied) {
    throw new Error('DANGEROUS: delete permission is broader than locks/*');
  }

  console.log(JSON.stringify({
    atomicLockCreation: 'pass',
    lockRead: 'pass',
    lockDelete: 'pass',
    deleteOutsideLocks: 'denied-as-required',
  }));
} finally {
  if (lockCreated) {
    try { await client.delete(lockKey); } catch {}
  }
}

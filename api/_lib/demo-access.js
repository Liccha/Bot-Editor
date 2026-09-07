'use strict';

const { getStore } = require('./storage');

const KEY = 'security/demo-access.json';

function demoMode() {
  return process.env.PORTFOLIO_DEMO_MODE === '1';
}

function iso(value) {
  const time = Date.parse(String(value || ''));
  return Number.isFinite(time) ? new Date(time).toISOString() : '';
}

async function state() {
  if (!demoMode()) return { demo: false, writeEnabled: true, expiresAt: '' };
  const fallbackExpiry = iso(process.env.PORTFOLIO_DEMO_EXPIRES_AT);
  const object = await getStore().get(KEY);
  const saved = object ? JSON.parse(object.body.toString('utf8')) : null;
  const expiresAt = iso(saved?.expiresAt) || fallbackExpiry;
  const enabled = saved ? saved.enabled === true : true;
  return {
    demo: true,
    writeEnabled: enabled && Boolean(expiresAt) && Date.parse(expiresAt) > Date.now(),
    expiresAt,
  };
}

async function assertMutationAllowed(req) {
  if (!demoMode() || ['GET', 'HEAD', 'OPTIONS'].includes(String(req?.method || 'GET').toUpperCase())) return;
  const current = await state();
  if (current.writeEnabled) return;
  const error = new Error('portfolio demo writes are closed');
  error.statusCode = 423;
  error.publicCode = 'demo_closed';
  throw error;
}

async function setState(enabled, expiresAt) {
  const expiry = iso(expiresAt) || iso(process.env.PORTFOLIO_DEMO_EXPIRES_AT);
  if (enabled && (!expiry || Date.parse(expiry) <= Date.now())) {
    const error = new Error('a future expiry is required'); error.statusCode = 400; throw error;
  }
  await getStore().put(KEY, Buffer.from(JSON.stringify({
    schema: 1,
    enabled: enabled === true,
    expiresAt: expiry,
    updatedAt: new Date().toISOString(),
  })));
  return state();
}

module.exports = { KEY, assertMutationAllowed, demoMode, setState, state };

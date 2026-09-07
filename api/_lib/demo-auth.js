'use strict';

const crypto = require('node:crypto');
const { config } = require('./config');

function sign(value) {
  return crypto.createHmac('sha256', config().sessionSecret).update(value).digest('base64url');
}

function validUuid(value) {
  return /^[a-f0-9-]{36}$/i.test(String(value || '')) ? String(value).toLowerCase() : '';
}

function enroll(input) {
  const id = validUuid(input?.installationId);
  if (!id) { const error = new Error('invalid installation identity'); error.statusCode = 400; throw error; }
  const configuredExpiry = Date.parse(String(process.env.PORTFOLIO_DEMO_EXPIRES_AT || ''));
  const exp = Math.floor(Math.min(configuredExpiry, Date.now() + 30 * 24 * 3600_000) / 1000);
  if (!Number.isFinite(exp) || exp <= Math.floor(Date.now() / 1000)) {
    const error = new Error('portfolio demo writes are closed'); error.statusCode = 423; error.publicCode = 'demo_closed'; throw error;
  }
  const payload = Buffer.from(JSON.stringify({ sub: id, scope: 'portfolio-demo-editor', exp })).toString('base64url');
  return { id, token: `demo.${payload}.${sign(payload)}`, name: '作品集临时体验', scope: 'portfolio-demo-editor', expiresAt: new Date(exp * 1000).toISOString() };
}

function editorFromRequest(req) {
  try {
    const header = String(req?.headers?.authorization || '');
    if (!header.startsWith('Device demo.')) return null;
    const [kind, payload, signature] = header.slice(7).split('.');
    if (kind !== 'demo' || !payload || !signature || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(sign(payload)))) return null;
    const value = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (value.scope !== 'portfolio-demo-editor' || !validUuid(value.sub) || Number(value.exp) <= Math.floor(Date.now() / 1000)) return null;
    return { id: value.sub, scope: value.scope };
  } catch (_) { return null; }
}

module.exports = { editorFromRequest, enroll };

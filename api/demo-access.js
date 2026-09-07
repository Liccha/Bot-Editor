'use strict';

const security = require('./_lib/security');
const access = require('./_lib/demo-access');

function json(res, status, value) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(value));
}

module.exports = async function handler(req, res) {
  if (!access.demoMode()) return json(res, 404, { error: 'not found' });
  try {
    if (req.method === 'GET') return json(res, 200, await access.state());
    if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed' });
    if (!security.desktopAuthorized(req)) return json(res, 401, { error: 'not authorized' });
    const input = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    if (typeof input.enabled !== 'boolean') return json(res, 400, { error: 'invalid request' });
    return json(res, 200, await access.setState(input.enabled, input.expiresAt));
  } catch (error) {
    const status = Number(error.statusCode || 500);
    return json(res, status >= 400 && status < 600 ? status : 500, {
      error: status === 400 ? 'invalid request' : 'internal',
    });
  }
};

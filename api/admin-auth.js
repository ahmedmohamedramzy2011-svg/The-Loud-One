// Server-side Admin Panel authentication endpoint (/api/admin-auth)
// Verifies POST { password } against process.env.ADMIN_SECRET using constant-time
// comparison and issues short-lived HMAC-signed admin tokens for /api/rooms actions.

const crypto = require('crypto');

const TOKEN_TTL_MS = 12 * 60 * 60 * 1000;

function getAdminSecret() {
  const raw = process.env.ADMIN_SECRET;
  if (typeof raw !== 'string' || !raw.length) return '';
  return raw;
}

function timingSafeEqualStr(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || !a.length || !b.length) return false;
  const ha = crypto.createHash('sha256').update(a, 'utf8').digest();
  const hb = crypto.createHash('sha256').update(b, 'utf8').digest();
  return crypto.timingSafeEqual(ha, hb);
}

function issueAdminToken(secret) {
  const payloadObj = {
    exp: Date.now() + TOKEN_TTL_MS,
    n: crypto.randomBytes(8).toString('hex'),
  };
  const payloadB64 = Buffer.from(JSON.stringify(payloadObj), 'utf8').toString('base64url');
  const sigB64 = crypto.createHmac('sha256', secret).update(payloadB64).digest('base64url');
  return `${payloadB64}.${sigB64}`;
}

function verifyAdminToken(token, secret) {
  if (typeof token !== 'string' || !secret) return false;
  const dot = token.indexOf('.');
  if (dot <= 0 || dot >= token.length - 1) return false;
  const payloadB64 = token.slice(0, dot);
  const sigB64 = token.slice(dot + 1);
  const expectedSig = crypto.createHmac('sha256', secret).update(payloadB64).digest('base64url');
  if (!timingSafeEqualStr(sigB64, expectedSig)) return false;
  try {
    const parsed = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
    if (!parsed || typeof parsed.exp !== 'number' || !Number.isFinite(parsed.exp)) return false;
    return parsed.exp > Date.now();
  } catch (e) {
    return false;
  }
}

function extractAdminCandidate(req) {
  if (!req || !req.headers) return '';
  const h = req.headers;
  const direct = h['admin_secret'] || h['x-admin-secret'] || h['admin-secret'] || h['x-admin-token'];
  if (typeof direct === 'string' && direct.trim()) return direct.trim();
  const auth = h.authorization;
  if (typeof auth === 'string' && /^Bearer\s+/i.test(auth)) {
    return auth.replace(/^Bearer\s+/i, '').trim();
  }
  return '';
}

function verifyAdminRequest(req) {
  const secret = getAdminSecret();
  if (!secret) return false;
  const candidate = extractAdminCandidate(req);
  if (!candidate) return false;
  return timingSafeEqualStr(candidate, secret) || verifyAdminToken(candidate, secret);
}

async function readJsonBody(req) {
  if (!req) return {};
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
    return req.body;
  }
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch (e) { return {}; }
  }
  if (Buffer.isBuffer(req.body)) {
    try { return JSON.parse(req.body.toString('utf8')); } catch (e) { return {}; }
  }
  if (typeof req.on !== 'function') return {};
  return await new Promise(resolve => {
    let raw = '';
    let settled = false;
    const finish = obj => {
      if (settled) return;
      settled = true;
      resolve(obj);
    };
    req.on('data', chunk => {
      raw += String(chunk || '');
      if (raw.length > 8192) finish({});
    });
    req.on('end', () => {
      if (!raw) return finish({});
      try { finish(JSON.parse(raw)); } catch (e) { finish({}); }
    });
    req.on('error', () => finish({}));
  });
}

async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('Content-Type', 'application/json');

  const method = String((req && req.method) || 'POST').toUpperCase();
  const secret = getAdminSecret();

  if (method === 'GET') {
    const authorized = verifyAdminRequest(req);
    return res.status(authorized ? 200 : 401).json({
      ok: authorized,
      authorized,
      configured: !!secret,
    });
  }

  if (method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ ok: false, authorized: false, error: 'Method not allowed.' });
  }

  if (!secret) {
    return res.status(503).json({
      ok: false,
      authorized: false,
      error: 'Admin authentication is not configured on the server (missing ADMIN_SECRET).',
    });
  }

  const body = await readJsonBody(req);
  const password = body && typeof body.password === 'string' ? body.password : '';
  if (!password || !timingSafeEqualStr(password, secret)) {
    return res.status(401).json({
      ok: false,
      authorized: false,
      error: 'Invalid admin password.',
    });
  }

  const token = issueAdminToken(secret);
  return res.status(200).json({
    ok: true,
    authorized: true,
    token,
  });
}

handler.verifyAdminRequest = verifyAdminRequest;
handler.verifyAdminToken = verifyAdminToken;
handler.getAdminSecret = getAdminSecret;

module.exports = handler;

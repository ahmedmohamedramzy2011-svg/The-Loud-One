// Server-side live multiplayer session registry (/api/rooms).
// Works as a Vercel Serverless Function and as an Express middleware route.
// Uses optional Vercel KV / Upstash Redis REST when configured, with automatic
// globalThis in-memory fallback for single-instance or local dev environments.

const {
  verifyAdminToken,
  timingSafeEqualStr,
  issueScopedTicket,
  verifyScopedTicket,
} = require('./admin-auth');

function verifyAdminSecretHeader(req) {
  const expected = (process.env.ADMIN_SECRET || '').trim();
  if (!expected) return false;
  const rawHeader = req && req.headers ? req.headers['x-admin-secret'] : '';
  const candidate = typeof rawHeader === 'string' ? rawHeader.trim() : '';
  if (!candidate) return false;
  return timingSafeEqualStr(candidate, expected) || verifyAdminToken(candidate, expected);
}

const ROOM_TTL_MS = 25000;
const KV_TTL_SEC = 35;
const KV_PREFIX = 'lo:rooms:';

function getMemStore() {
  if (!globalThis.__LO_ROOMS || !(globalThis.__LO_ROOMS instanceof Map)) {
    globalThis.__LO_ROOMS = new Map();
  }
  return globalThis.__LO_ROOMS;
}

function getKvConfig() {
  const url = String(process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '').trim().replace(/\/+$/, '');
  const token = String(process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '').trim();
  if (!url || !token || !/^https?:\/\//i.test(url)) return null;
  return { url, token };
}

async function kvPipeline(cfg, commands) {
  const ac = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const t = ac ? setTimeout(() => ac.abort(), 2500) : null;
  try {
    const res = await fetch(`${cfg.url}/pipeline`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${cfg.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(commands),
      signal: ac ? ac.signal : undefined,
    });
    if (!res.ok) return null;
    const json = await res.json();
    return Array.isArray(json) ? json : null;
  } catch (e) {
    return null;
  } finally {
    if (t) clearTimeout(t);
  }
}

async function storeGet(roomId) {
  const mem = getMemStore();
  const cfg = getKvConfig();
  if (cfg) {
    const res = await kvPipeline(cfg, [['GET', KV_PREFIX + roomId]]);
    if (res && res[0] && typeof res[0].result === 'string') {
      try {
        const parsed = JSON.parse(res[0].result);
        if (parsed && typeof parsed === 'object') {
          mem.set(roomId, parsed);
          return parsed;
        }
      } catch (e) {}
    }
  }
  return mem.get(roomId) || null;
}

async function storeSet(roomId, record) {
  const mem = getMemStore();
  mem.set(roomId, record);
  const cfg = getKvConfig();
  if (cfg) {
    await kvPipeline(cfg, [['SET', KV_PREFIX + roomId, JSON.stringify(record), 'EX', KV_TTL_SEC]]);
  }
}

async function storeDelete(roomId) {
  const mem = getMemStore();
  mem.delete(roomId);
  const cfg = getKvConfig();
  if (cfg) {
    await kvPipeline(cfg, [['DEL', KV_PREFIX + roomId]]);
  }
}

async function storeListActive(now) {
  const mem = getMemStore();
  for (const [k, v] of mem.entries()) {
    if (!v || (now - (v.lastHeartbeat || 0)) > ROOM_TTL_MS) mem.delete(k);
  }

  const byId = new Map();
  for (const [k, v] of mem.entries()) {
    byId.set(k, v);
  }

  const cfg = getKvConfig();
  if (cfg) {
    const keysRes = await kvPipeline(cfg, [['KEYS', KV_PREFIX + '*']]);
    const keys = keysRes && keysRes[0] && Array.isArray(keysRes[0].result) ? keysRes[0].result.slice(0, 100) : [];
    if (keys.length) {
      const mgetRes = await kvPipeline(cfg, [['MGET', ...keys]]);
      const vals = mgetRes && mgetRes[0] && Array.isArray(mgetRes[0].result) ? mgetRes[0].result : [];
      for (let i = 0; i < vals.length; i++) {
        if (typeof vals[i] !== 'string') continue;
        try {
          const rec = JSON.parse(vals[i]);
          if (rec && rec.roomId && (now - (rec.lastHeartbeat || 0)) <= ROOM_TTL_MS) {
            byId.set(rec.roomId, rec);
            mem.set(rec.roomId, rec);
          }
        } catch (e) {}
      }
    }
  }

  const out = [];
  for (const rec of byId.values()) {
    if (!rec || (now - (rec.lastHeartbeat || 0)) > ROOM_TTL_MS) continue;
    out.push({
      roomId: rec.roomId,
      hostCallsign: rec.hostCallsign,
      playerCount: rec.playerCount,
      maxPlayers: rec.maxPlayers,
      wave: rec.wave,
      startedAt: rec.startedAt,
      status: rec.status,
      lastHeartbeat: rec.lastHeartbeat,
      uptimeMs: Math.max(0, now - (rec.startedAt || rec.lastHeartbeat || now)),
      shutdown: !!rec.shutdown,
      shutdownReason: rec.shutdownReason || '',
    });
  }
  out.sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
  return out;
}

function cleanRoomId(raw) {
  const s = String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (s.length < 4 || s.length > 8) return '';
  return s;
}

function cleanText(raw, maxLen, fallback) {
  const s = String(raw || '').replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, maxLen);
  return s || fallback || '';
}

function cleanToken(raw) {
  return String(raw || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
}

function clampInt(raw, min, max, def) {
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n)) return def;
  return Math.max(min, Math.min(max, n));
}

function cleanStatus(raw) {
  const s = String(raw || '').trim().toLowerCase();
  const allowed = ['lobby', 'opening', 'playing', 'ending', 'wipe', 'paused', 'closing'];
  return allowed.includes(s) ? s : 'lobby';
}

function readQueryParam(req, name) {
  if (req && req.query && req.query[name] !== undefined) return String(req.query[name]);
  try {
    const u = new URL((req && req.url) || '/', 'http://localhost');
    return u.searchParams.get(name) || '';
  } catch (e) {
    return '';
  }
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
      if (raw.length > 16384) finish({});
    });
    req.on('end', () => {
      if (!raw) return finish({});
      try { finish(JSON.parse(raw)); } catch (e) { finish({}); }
    });
    req.on('error', () => finish({}));
  });
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('Content-Type', 'application/json');

  const method = String((req && req.method) || 'GET').toUpperCase();
  const now = Date.now();

  if (method === 'GET') {
    if (!verifyAdminSecretHeader(req)) {
      return res.status(401).json({ ok: false, error: 'Unauthorized: valid x-admin-secret header required.' });
    }
    const rooms = await storeListActive(now);
    return res.status(200).json({ ok: true, ttlMs: ROOM_TTL_MS, rooms });
  }

  if (method === 'POST') {
    const body = await readJsonBody(req);
    const roomId = cleanRoomId(body.roomId || readQueryParam(req, 'roomId'));
    if (!roomId) {
      return res.status(400).json({ ok: false, error: 'Invalid roomId.' });
    }

    const action = String(body.action || 'heartbeat').trim().toLowerCase();
    const existing = await storeGet(roomId);
    const headerToken = req && req.headers ? req.headers['x-host-token'] : '';
    const hostToken = cleanToken(body.hostToken || headerToken);

    if (action === 'admin_join') {
      if (!verifyAdminSecretHeader(req)) {
        return res.status(401).json({ ok: false, error: 'Unauthorized: valid x-admin-secret header required.' });
      }
      const isFreshRoom = existing && (now - (existing.lastHeartbeat || 0)) <= ROOM_TTL_MS && !existing.shutdown;
      if (!isFreshRoom) {
        return res.status(404).json({ ok: false, error: 'Active room not found.' });
      }
      const adminHidden = !!body.adminHidden;
      const adminJoinToken = issueScopedTicket({
        kind: 'admin_join',
        roomId,
        adminHidden,
      }, 60000);
      return res.status(200).json({
        ok: true,
        roomId,
        adminHidden,
        adminJoinToken,
      });
    }

    if (action === 'verify_admin_join') {
      const isFreshRoom = existing && (now - (existing.lastHeartbeat || 0)) <= ROOM_TTL_MS;
      if (!isFreshRoom) {
        return res.status(404).json({ ok: false, authorized: false, error: 'Active room not found.' });
      }
      if (existing.hostToken && existing.hostToken !== hostToken) {
        return res.status(403).json({ ok: false, authorized: false, error: 'Unauthorized host token.' });
      }
      const ticketStr = typeof body.adminJoinToken === 'string' ? body.adminJoinToken.trim() : '';
      const claims = verifyScopedTicket(ticketStr);
      if (!claims || claims.kind !== 'admin_join' || claims.roomId !== roomId) {
        return res.status(401).json({ ok: false, authorized: false, error: 'Invalid or expired admin join token.' });
      }
      return res.status(200).json({
        ok: true,
        authorized: true,
        roomId,
        adminHidden: !!claims.adminHidden,
      });
    }

    if (action === 'verify_admin_token') {
      const isFreshRoom = existing && (now - (existing.lastHeartbeat || 0)) <= ROOM_TTL_MS && !existing.shutdown;
      if (!isFreshRoom) {
        return res.status(404).json({ ok: false, authorized: false, error: 'Active room not found.' });
      }
      if (existing.hostToken && existing.hostToken !== hostToken) {
        return res.status(403).json({ ok: false, authorized: false, error: 'Unauthorized host token.' });
      }
      const tokenStr = typeof body.adminToken === 'string' ? body.adminToken.trim() : '';
      const expected = getAdminSecret();
      if (!expected || !tokenStr || !verifyAdminToken(tokenStr, expected)) {
        return res.status(401).json({ ok: false, authorized: false, error: 'Invalid or expired admin token.' });
      }
      return res.status(200).json({
        ok: true,
        authorized: true,
        roomId,
      });
    }

    if (action === 'shutdown') {
      if (!verifyAdminSecretHeader(req)) {
        return res.status(401).json({ ok: false, error: 'Unauthorized: valid x-admin-secret header required.' });
      }
      const reason = cleanText(body.reason, 80, 'Match shut down by Admin');
      const next = Object.assign({}, existing || {
        roomId,
        hostCallsign: 'Host',
        playerCount: 1,
        maxPlayers: 4,
        wave: 'Shutting down',
        startedAt: now,
        status: 'closing',
      }, {
        roomId,
        shutdown: true,
        shutdownReason: reason,
        status: 'closing',
        lastHeartbeat: now,
      });
      await storeSet(roomId, next);
      return res.status(200).json({ ok: true, roomId, shutdown: true, shutdownReason: reason });
    }

    if (action === 'leave') {
      if (existing && existing.hostToken && existing.hostToken !== hostToken) {
        return res.status(403).json({ ok: false, error: 'Unauthorized room token.' });
      }
      await storeDelete(roomId);
      return res.status(200).json({ ok: true, roomId, removed: true });
    }

    const isFresh = existing && (now - (existing.lastHeartbeat || 0)) <= ROOM_TTL_MS;
    if (isFresh && existing.hostToken && existing.hostToken !== hostToken) {
      return res.status(403).json({ ok: false, error: 'Room ID already owned by another host.' });
    }

    if (isFresh && existing.shutdown) {
      return res.status(200).json({
        ok: true,
        roomId,
        shutdown: true,
        shutdownReason: existing.shutdownReason || 'Match shut down by Admin',
      });
    }

    const startedRaw = Number(body.startedAt);
    const startedAt = Number.isFinite(startedRaw) && startedRaw > 0
      ? Math.min(now, Math.max(now - 86400000, startedRaw))
      : (isFresh && existing.startedAt ? existing.startedAt : now);

    const record = {
      roomId,
      hostCallsign: cleanText(body.hostCallsign, 24, 'Investigator 1'),
      playerCount: clampInt(body.playerCount, 1, 8, 1),
      maxPlayers: clampInt(body.maxPlayers, 1, 8, 4),
      wave: cleanText(body.wave, 32, 'Lobby'),
      startedAt,
      status: cleanStatus(body.status),
      lastHeartbeat: now,
      shutdown: false,
      shutdownReason: '',
      hostToken: hostToken || (isFresh ? existing.hostToken : '') || '',
    };

    await storeSet(roomId, record);
    return res.status(200).json({ ok: true, roomId, shutdown: false, shutdownReason: '' });
  }

  if (method === 'DELETE') {
    const body = await readJsonBody(req);
    const roomId = cleanRoomId(readQueryParam(req, 'roomId') || body.roomId);
    if (!roomId) {
      return res.status(400).json({ ok: false, error: 'Invalid roomId.' });
    }
    const existing = await storeGet(roomId);
    const headerToken = req && req.headers ? req.headers['x-host-token'] : '';
    const hostToken = cleanToken(readQueryParam(req, 'token') || headerToken || body.hostToken);
    const wantsAdmin = readQueryParam(req, 'admin') === '1' || body.admin === true;
    const isAdmin = wantsAdmin && verifyAdminSecretHeader(req);

    if (wantsAdmin && !isAdmin) {
      return res.status(401).json({ ok: false, error: 'Unauthorized: valid x-admin-secret header required.' });
    }
    if (!isAdmin && existing && existing.hostToken && existing.hostToken !== hostToken) {
      return res.status(403).json({ ok: false, error: 'Unauthorized room token.' });
    }

    await storeDelete(roomId);
    return res.status(200).json({ ok: true, roomId, removed: true });
  }

  res.setHeader('Allow', 'GET, POST, DELETE');
  return res.status(405).json({ ok: false, error: 'Method not allowed.' });
};

// Server-side ICE (STUN/TURN) + optional PeerJS signaling config endpoint.
// Works natively as a Vercel Serverless Function (/api/ice) and Express route.

const DEFAULT_STUN = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
  { urls: 'stun:stun3.l.google.com:19302' },
  { urls: 'stun:stun4.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' },
];

function urlLatencyRank(url) {
  const s = String(url || '').trim().toLowerCase();
  const isTurns = s.startsWith('turns:');
  const has443 = /:443(?:[/?]|$)/.test(s);
  const has3478 = /:3478(?:[/?]|$)/.test(s);
  const isTcp = /transport=tcp/.test(s);
  if (isTurns && has443) return 0; // Lowest-latency firewall-friendly TLS 443 endpoint
  if (has443) return 1;
  if (isTurns) return 2;
  if (has3478 && !isTcp) return 3;
  if (has3478) return 4;
  return 5;
}

function sortUrlsTls443First(urls) {
  const arr = Array.isArray(urls) ? urls.slice() : [urls];
  return arr
    .map(u => String(u || '').trim())
    .filter(Boolean)
    .sort((a, b) => urlLatencyRank(a) - urlLatencyRank(b));
}

function prioritizeTurnServers(list) {
  if (!Array.isArray(list) || !list.length) return list;
  return list
    .map(entry => {
      if (!entry || !entry.urls) return null;
      const sortedUrls = sortUrlsTls443First(entry.urls);
      if (!sortedUrls.length) return null;
      return Object.assign({}, entry, {
        urls: sortedUrls.length === 1 ? sortedUrls[0] : sortedUrls,
        _rank: urlLatencyRank(sortedUrls[0]),
      });
    })
    .filter(Boolean)
    .sort((a, b) => a._rank - b._rank)
    .map(entry => {
      const clean = Object.assign({}, entry);
      delete clean._rank;
      return clean;
    });
}

async function fetchJson(url, opts, timeoutMs = 4000) {
  const ac = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const t = ac ? setTimeout(() => ac.abort(), timeoutMs) : null;
  try {
    const res = await fetch(url, Object.assign({}, opts || {}, ac ? { signal: ac.signal } : {}));
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    return null;
  } finally {
    if (t) clearTimeout(t);
  }
}

async function getMeteredIce() {
  const rawDomain = String(process.env.METERED_DOMAIN || '').trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '');
  const apiKey = String(process.env.METERED_API_KEY || '').trim();
  if (!rawDomain || !apiKey || !/^[a-zA-Z0-9.-]+$/.test(rawDomain)) return null;
  const data = await fetchJson(`https://${rawDomain}/api/v1/turn/credentials?apiKey=${encodeURIComponent(apiKey)}`);
  if (!Array.isArray(data) || !data.length) return null;
  const list = data.filter(s => s && s.urls && (Array.isArray(s.urls) ? s.urls.length > 0 : String(s.urls).trim().length > 0));
  return list.length ? prioritizeTurnServers(list) : null;
}

async function getCloudflareIce() {
  const tokenId = String(process.env.CLOUDFLARE_TURN_TOKEN_ID || '').trim();
  const apiToken = String(process.env.CLOUDFLARE_TURN_API_TOKEN || '').trim();
  if (!tokenId || !apiToken || !/^[a-zA-Z0-9_-]+$/.test(tokenId)) return null;
  const rawTtl = parseInt(process.env.CLOUDFLARE_TURN_TTL || '86400', 10);
  const ttl = Number.isFinite(rawTtl) ? Math.max(60, Math.min(86400, rawTtl)) : 86400;
  const data = await fetchJson(
    `https://rtc.live.cloudflare.com/v1/turn/keys/${tokenId}/credentials/generate-ice-servers`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ttl }),
    }
  );
  const rawServers = data && (data.iceServers || (data.result && data.result.iceServers));
  const list = rawServers ? (Array.isArray(rawServers) ? rawServers : [rawServers]) : null;
  if (!list || !list.length) return null;
  const valid = list.filter(s => s && s.urls && (Array.isArray(s.urls) ? s.urls.length > 0 : String(s.urls).trim().length > 0));
  return valid.length ? prioritizeTurnServers(valid) : null;
}

function getStaticTurnIce(urlVar, userVar, credVar) {
  const rawUrl = String(process.env[urlVar] || '').trim();
  const username = String(process.env[userVar] || '').trim();
  const credential = String(process.env[credVar] || '').trim();
  if (!rawUrl || !username || !credential) return null;
  const urls = rawUrl
    .split(',')
    .map(u => u.trim())
    .filter(u => /^(stuns?|turns?):[^\s]+$/i.test(u));
  if (!urls.length) return null;
  const sorted = sortUrlsTls443First(urls);
  // Emit TLS port 443 endpoints as a dedicated leading entry so ICE probes them first
  const tls443 = sorted.filter(u => urlLatencyRank(u) <= 1);
  const other = sorted.filter(u => urlLatencyRank(u) > 1);
  const out = [];
  if (tls443.length) {
    out.push({ urls: tls443.length === 1 ? tls443[0] : tls443, username, credential });
  }
  if (other.length) {
    out.push({ urls: other.length === 1 ? other[0] : other, username, credential });
  }
  return out;
}

function getPeerOpts() {
  const host = String(process.env.PEER_HOST || '').trim();
  if (!host) return null;
  const opts = { host };
  const port = parseInt(process.env.PEER_PORT || '', 10);
  if (!Number.isNaN(port) && port > 0) opts.port = port;
  const path = String(process.env.PEER_PATH || '').trim();
  if (path) opts.path = path;
  if (process.env.PEER_SECURE !== undefined && process.env.PEER_SECURE !== '') {
    opts.secure = String(process.env.PEER_SECURE).toLowerCase() !== 'false';
  }
  const key = String(process.env.PEER_KEY || '').trim();
  if (key) opts.key = key;
  return opts;
}

function readPreferParam(req) {
  if (req && req.query && typeof req.query.prefer === 'string') {
    return req.query.prefer.trim().toLowerCase();
  }
  try {
    const u = new URL((req && req.url) || '/', 'http://localhost');
    return (u.searchParams.get('prefer') || '').trim().toLowerCase();
  } catch (e) {
    return '';
  }
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('Content-Type', 'application/json');

  const prefer = readPreferParam(req);
  const envPriority = String(process.env.TURN_PRIORITY || 'metered-first').trim().toLowerCase();
  const priority = prefer === 'cloudflare' ? 'cloudflare-first' : envPriority;

  const iceServers = DEFAULT_STUN.slice();
  let hasTurn = false;

  const wantMetered = priority !== 'cloudflare-only';
  const wantCloudflare = priority !== 'metered-only';

  // 1. Primary Metered (TURN_URL, TURN_USERNAME, TURN_CREDENTIAL)
  const primaryMetered = wantMetered ? getStaticTurnIce('TURN_URL', 'TURN_USERNAME', 'TURN_CREDENTIAL') : null;
  // 2. Secondary Metered (TURN_URL_2, TURN_USERNAME_2, TURN_CREDENTIAL_2)
  const secondaryMetered = wantMetered ? getStaticTurnIce('TURN_URL_2', 'TURN_USERNAME_2', 'TURN_CREDENTIAL_2') : null;

  // Optional dynamic Metered API + 3. Cloudflare TURN fallback
  const [meteredDynamic, cloudflare] = await Promise.all([
    wantMetered ? getMeteredIce() : Promise.resolve(null),
    wantCloudflare ? getCloudflareIce() : Promise.resolve(null),
  ]);

  const orderedTurn = (priority === 'cloudflare-first' || priority === 'cloudflare-only')
    ? [cloudflare, primaryMetered, secondaryMetered, meteredDynamic]
    : [primaryMetered, secondaryMetered, meteredDynamic, cloudflare];

  for (let i = 0; i < orderedTurn.length; i++) {
    const list = orderedTurn[i];
    if (list && list.length) {
      iceServers.push(...list);
      hasTurn = true;
    }
  }

  const payload = {
    iceServers,
    hasTurn,
    providers: {
      primaryMetered: !!(primaryMetered && primaryMetered.length),
      secondaryMetered: !!(secondaryMetered && secondaryMetered.length),
      metered: !!(primaryMetered && primaryMetered.length) || !!(secondaryMetered && secondaryMetered.length) || !!(meteredDynamic && meteredDynamic.length),
      cloudflare: !!(cloudflare && cloudflare.length),
    },
    priority,
    peerOpts: getPeerOpts(),
  };

  res.status(200).json(payload);
};

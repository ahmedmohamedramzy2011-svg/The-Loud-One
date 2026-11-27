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
  return data.filter(s => s && s.urls);
}

async function getCloudflareIce() {
  const tokenId = String(process.env.CLOUDFLARE_TURN_TOKEN_ID || '').trim();
  const apiToken = String(process.env.CLOUDFLARE_TURN_API_TOKEN || '').trim();
  if (!tokenId || !apiToken || !/^[a-zA-Z0-9_-]+$/.test(tokenId)) return null;
  const data = await fetchJson(
    `https://rtc.live.cloudflare.com/v1/turn/keys/${tokenId}/credentials/generate-ice-servers`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ttl: 86400 }),
    }
  );
  const list = data && (Array.isArray(data.iceServers) ? data.iceServers : (data.iceServers ? [data.iceServers] : null));
  if (!list || !list.length) return null;
  return list.filter(s => s && s.urls);
}

function getCustomTurnIce() {
  const rawUrl = String(process.env.TURN_URL || '').trim();
  const username = String(process.env.TURN_USERNAME || '').trim();
  const credential = String(process.env.TURN_CREDENTIAL || '').trim();
  if (!rawUrl || !username || !credential) return null;
  const urls = rawUrl.split(',').map(u => u.trim()).filter(Boolean);
  if (!urls.length) return null;
  return [{ urls: urls.length === 1 ? urls[0] : urls, username, credential }];
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

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('Content-Type', 'application/json');

  const iceServers = DEFAULT_STUN.slice();
  let hasTurn = false;

  const [metered, cloudflare] = await Promise.all([getMeteredIce(), getCloudflareIce()]);
  if (metered && metered.length) {
    iceServers.push(...metered);
    hasTurn = true;
  }
  if (cloudflare && cloudflare.length) {
    iceServers.push(...cloudflare);
    hasTurn = true;
  }
  const custom = getCustomTurnIce();
  if (custom && custom.length) {
    iceServers.push(...custom);
    hasTurn = true;
  }

  const payload = {
    iceServers,
    hasTurn,
    peerOpts: getPeerOpts(),
  };

  res.status(200).json(payload);
};

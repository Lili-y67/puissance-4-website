const http = require('http');
const RPC = require('discord-rpc');

const HOST = '127.0.0.1';
const PORT = 6464;
const CLIENT_ID = '1477252548090921060';
const LARGE_IMAGE = 'site-logo';
const BASE_URL = 'https://puissance-4-website-production.up.railway.app';
const STALE_AFTER_MS = 45_000;
const MAX_BODY_BYTES = 32 * 1024;

let rpc = null;
let rpcReady = false;
let reconnectTimer = null;
let clearTimer = null;
let latestActivity = null;
let lastPublishedSignature = '';

function text(value, max = 128) {
  const clean = String(value || '').replace(/\s+/g, ' ').trim();
  return clean ? clean.slice(0, max) : '';
}

function safeHttpUrl(value) {
  try {
    const url = new URL(String(value || ''));
    return ['http:', 'https:'].includes(url.protocol) ? url.toString() : '';
  } catch {
    return '';
  }
}

function isAllowedOrigin(origin) {
  if (!origin) return false;
  try {
    const url = new URL(origin);
    if (['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) return true;
    return Boolean(BASE_URL && origin === new URL(BASE_URL).origin);
  } catch {
    return false;
  }
}

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Private-Network': 'true',
    'Access-Control-Max-Age': '600',
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
    Vary: 'Origin',
  };
}

function reply(res, status, payload, origin = '') {
  res.writeHead(status, origin ? corsHeaders(origin) : {
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
  });
  res.end(JSON.stringify(payload));
}

function normalizeActivity(input = {}) {
  const details = text(input.details) || 'Sur Puissance 4';
  const state = text(input.state);
  const avatar = safeHttpUrl(input.smallImage);
  const requestedProfileUrl = safeHttpUrl(input.profileUrl);
  const requestedSiteUrl = safeHttpUrl(input.siteUrl);
  const publicSiteUrl = safeHttpUrl(BASE_URL);
  const playerId = text(input.playerId, 40);
  const siteUrl = requestedSiteUrl?.startsWith('https://') ? requestedSiteUrl : publicSiteUrl;
  const profileUrl = requestedProfileUrl?.startsWith('https://')
    ? requestedProfileUrl
    : playerId && publicSiteUrl?.startsWith('https://')
      ? `${publicSiteUrl}/profil?id=${encodeURIComponent(playerId)}`
      : '';
  const startedAt = Number(input.startedAt);
  const activity = {
    details,
    largeImageKey: LARGE_IMAGE,
    largeImageText: text(input.largeImageText, 128) || 'Puissance 4 Arena',
    instance: false,
  };

  if (state) activity.state = state;
  if (avatar) {
    activity.smallImageKey = avatar;
    activity.smallImageText = text(input.smallImageText, 128) || 'Membre connecté';
  }
  if (Number.isFinite(startedAt) && startedAt > 0) {
    activity.startTimestamp = new Date(startedAt);
  }

  const buttons = [];
  if (profileUrl?.startsWith('https://')) buttons.push({ label: 'Voir le Profil', url: profileUrl });
  if (siteUrl?.startsWith('https://')) buttons.push({ label: 'Puissance 4 Site', url: siteUrl });
  if (buttons.length) activity.buttons = buttons.slice(0, 2);
  return activity;
}

async function publishActivity(input) {
  const normalized = normalizeActivity(input);
  const signature = JSON.stringify(normalized);
  latestActivity = normalized;
  scheduleClear();
  if (!rpcReady || !rpc) return false;
  if (signature === lastPublishedSignature) return true;

  try {
    await rpc.setActivity(latestActivity);
    lastPublishedSignature = signature;
    return true;
  } catch (error) {
    if (latestActivity.smallImageKey) {
      const withoutAvatar = { ...latestActivity };
      delete withoutAvatar.smallImageKey;
      delete withoutAvatar.smallImageText;
      try {
        await rpc.setActivity(withoutAvatar);
        lastPublishedSignature = signature;
        return true;
      } catch {}
    }
    console.warn('[RPC] Activité refusée par Discord:', error?.message || error);
    return false;
  }
}

function scheduleClear() {
  clearTimeout(clearTimer);
  clearTimer = setTimeout(async () => {
    latestActivity = null;
    lastPublishedSignature = '';
    if (rpcReady && rpc) await rpc.clearActivity().catch(() => {});
  }, STALE_AFTER_MS);
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connectRpc();
  }, 8_000);
}

function connectRpc() {
  const client = new RPC.Client({ transport: 'ipc' });
  rpc = client;
  rpcReady = false;

  client.once('ready', async () => {
    rpcReady = true;
    console.log(`[RPC] Connecté à Discord avec l'application ${CLIENT_ID}.`);
    if (latestActivity) {
      try {
        await rpc.setActivity(latestActivity);
      } catch {
        const withoutAvatar = { ...latestActivity };
        delete withoutAvatar.smallImageKey;
        delete withoutAvatar.smallImageText;
        await rpc.setActivity(withoutAvatar).catch(() => {});
      }
    }
  });
  client.on('disconnected', () => {
    rpcReady = false;
    scheduleReconnect();
  });
  client.on('error', error => {
    rpcReady = false;
    console.warn('[RPC] Discord indisponible:', error?.message || error);
    scheduleReconnect();
  });
  client.login({ clientId: CLIENT_ID }).catch(error => {
    rpcReady = false;
    console.warn('[RPC] En attente du client Discord:', error?.message || error);
    scheduleReconnect();
  });
}

const server = http.createServer((req, res) => {
  const origin = String(req.headers.origin || '');
  if (req.method === 'GET' && req.url === '/status') {
    return reply(res, 200, { ok: true, discord: rpcReady, activity: Boolean(latestActivity) }, origin);
  }
  if (!isAllowedOrigin(origin)) return reply(res, 403, { ok: false, error: 'Origin refusée' });
  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders(origin));
    return res.end();
  }
  if (req.method === 'DELETE' && req.url === '/activity') {
    latestActivity = null;
    lastPublishedSignature = '';
    clearTimeout(clearTimer);
    if (rpcReady && rpc) rpc.clearActivity().catch(() => {});
    return reply(res, 200, { ok: true }, origin);
  }
  if (req.method !== 'POST' || req.url !== '/activity') {
    return reply(res, 404, { ok: false, error: 'Route inconnue' }, origin);
  }

  let body = '';
  req.setEncoding('utf8');
  req.on('data', chunk => {
    body += chunk;
    if (Buffer.byteLength(body) > MAX_BODY_BYTES) req.destroy();
  });
  req.on('end', async () => {
    try {
      const published = await publishActivity(JSON.parse(body || '{}'));
      reply(res, 200, { ok: true, discord: rpcReady, published }, origin);
    } catch {
      reply(res, 400, { ok: false, error: 'Payload invalide' }, origin);
    }
  });
});

server.listen(PORT, HOST, () => {
  console.log(`[RPC] Compagnon local sur http://${HOST}:${PORT}`);
  console.log('[RPC] Laisse cette fenêtre ouverte pendant que tu joues.');
  connectRpc();
});

function shutdown() {
  clearTimeout(clearTimer);
  clearTimeout(reconnectTimer);
  if (rpcReady && rpc) rpc.clearActivity().catch(() => {});
  try { rpc?.destroy(); } catch {}
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1_000).unref();
}

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);

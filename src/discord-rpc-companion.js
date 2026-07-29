const http = require('http');
const RPC = require('discord-rpc');

const HOST = '127.0.0.1';
const PORT = 6465;
const CLIENT_ID = '1477252548090921060';
const LARGE_IMAGE = 'site-logo';
const BASE_URL = (process.env.P4_SITE_URL || process.env.BASE_URL || 'http://127.0.0.1:3000').replace(/\/+$/, '');
const ALLOWED_SITE_ORIGINS = new Set([
  'https://puissance4.croustygame.fr',
  new URL(BASE_URL).origin,
]);
const LARGE_IMAGE_TEXT = `${BASE_URL}/`;
const STALE_AFTER_MS = 45_000;
const MIN_DISCORD_UPDATE_MS = 5_000;
const REASSERT_ACTIVITY_MS = 30_000;
const MAX_BODY_BYTES = 32 * 1024;

let rpc = null;
let rpcReady = false;
let reconnectTimer = null;
let clearTimer = null;
let latestActivity = null;
let lastPublishedSignature = '';
let lastSiteActivityAt = 0;
let lastDiscordUpdateAt = 0;
let pendingPublishTimer = null;
let discordUpdateCount = 0;

function defaultActivity() {
  return {
    details: 'Sur Puissance 4',
    state: 'Explore l’arène',
    largeImageKey: LARGE_IMAGE,
    largeImageText: LARGE_IMAGE_TEXT,
    startTimestamp: new Date(),
    buttons: [{ label: 'Puissance 4 Site', url: BASE_URL }],
    instance: false,
  };
}

function activityButtons(profileUrl, siteUrl) {
  const candidates = [
    profileUrl ? { label: 'Voir le Profil', url: profileUrl } : null,
    siteUrl ? { label: 'Puissance 4 Site', url: siteUrl } : null,
  ].filter(Boolean);
  return candidates.filter((button, index, list) =>
    list.findIndex(other => other.url === button.url) === index
  ).slice(0, 2);
}

function text(value, max = 128) {
  const clean = String(value || '').replace(/\s+/g, ' ').trim();
  return clean ? clean.slice(0, max) : '';
}

function dedupeSegments(value) {
  const seen = new Set();
  return text(value).split(/\s*•\s*/).filter(segment => {
    const key = segment.toLocaleLowerCase('fr-FR');
    if (!segment || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).join(' • ');
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
    return ALLOWED_SITE_ORIGINS.has(url.origin);
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

function statusPage(res) {
  const state = rpcReady ? 'Connecté à Discord' : 'En attente de Discord Desktop';
  const activity = lastSiteActivityAt ? 'Activité reçue du site' : 'Présence de secours active';
  res.writeHead(200, { 'Cache-Control': 'no-store', 'Content-Type': 'text/html; charset=utf-8' });
  res.end(`<!doctype html><html lang="fr"><meta charset="utf-8"><title>Puissance 4 RPC</title>
  <style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#090914;color:#eeeef5;font:16px Arial,sans-serif}.card{width:min(560px,calc(100vw - 48px));padding:28px;border:1px solid #5865f2;border-radius:22px;background:#111126;box-shadow:0 24px 80px #0008}h1{margin:0 0 18px;color:#aeb8ff}.line{margin:10px 0;padding:12px;border-radius:12px;background:#ffffff0a}.ok{color:#30d158}.warn{color:#ffd60a}</style>
  <main class="card"><h1>Puissance 4 Rich Presence</h1><div class="line ${rpcReady ? 'ok' : 'warn'}">${state}</div><div class="line ${latestActivity ? 'ok' : 'warn'}">${activity}</div><p>Dans Discord : Paramètres → Confidentialité de l’activité → active le partage d’activité.</p><p>Si le site ne détecte pas le compagnon, autorise son accès au réseau local dans Chrome.</p></main></html>`);
}

function normalizeActivity(input = {}) {
  const details = text(input.details) || 'Sur Puissance 4';
  const state = dedupeSegments(input.state);
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
    largeImageText: text(input.largeImageText, 128) || LARGE_IMAGE_TEXT,
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

  const buttons = activityButtons(
    profileUrl?.startsWith('https://') ? profileUrl : '',
    siteUrl?.startsWith('https://') ? siteUrl : ''
  );
  if (buttons.length) activity.buttons = buttons.slice(0, 2);
  return activity;
}

async function flushDiscordActivity({ force = false } = {}) {
  pendingPublishTimer = null;
  if (!rpcReady || !rpc || !latestActivity) return false;
  const signature = JSON.stringify(latestActivity);
  if (!force && signature === lastPublishedSignature) return true;
  try {
    await rpc.setActivity(latestActivity);
    lastPublishedSignature = signature;
    lastDiscordUpdateAt = Date.now();
    discordUpdateCount += 1;
    return true;
  } catch (error) {
    if (latestActivity.smallImageKey) {
      const withoutAvatar = { ...latestActivity };
      delete withoutAvatar.smallImageKey;
      delete withoutAvatar.smallImageText;
      try {
        await rpc.setActivity(withoutAvatar);
        lastPublishedSignature = signature;
        lastDiscordUpdateAt = Date.now();
        discordUpdateCount += 1;
        return true;
      } catch {}
    }
    console.warn('[RPC] Activité refusée par Discord:', error?.message || error);
    return false;
  }
}

function queueDiscordActivity({ immediate = false, force = false } = {}) {
  if (!rpcReady || !rpc || !latestActivity) return false;
  const signature = JSON.stringify(latestActivity);
  if (!force && signature === lastPublishedSignature) return true;
  clearTimeout(pendingPublishTimer);
  const elapsed = Date.now() - lastDiscordUpdateAt;
  const delay = immediate ? 0 : Math.max(0, MIN_DISCORD_UPDATE_MS - elapsed);
  pendingPublishTimer = setTimeout(() => {
    flushDiscordActivity({ force }).catch(error => {
      console.warn('[RPC] Publication impossible:', error?.message || error);
    });
  }, delay);
  return true;
}

function publishActivity(input) {
  latestActivity = normalizeActivity(input);
  lastSiteActivityAt = Date.now();
  scheduleClear();
  const shouldReassert = Date.now() - lastDiscordUpdateAt >= REASSERT_ACTIVITY_MS;
  return queueDiscordActivity({ force: shouldReassert });
}

function scheduleClear() {
  clearTimeout(clearTimer);
  clearTimer = setTimeout(async () => {
    latestActivity = defaultActivity();
    lastSiteActivityAt = 0;
    queueDiscordActivity();
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
    if (!latestActivity) latestActivity = defaultActivity();
    queueDiscordActivity({ immediate: true, force: true });
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
  if (req.method === 'GET' && req.url === '/') return statusPage(res);
  if (req.method === 'GET' && req.url === '/status') {
    if (origin && !isAllowedOrigin(origin)) return reply(res, 403, { ok: false, error: 'Origine refusée' });
    return reply(res, 200, {
      ok: true,
      discord: rpcReady,
      activity: Boolean(latestActivity),
      details: latestActivity?.details || '',
      state: latestActivity?.state || '',
      smallImage: latestActivity?.smallImageKey || '',
      smallImageText: latestActivity?.smallImageText || '',
      buttons: (latestActivity?.buttons || []).map(button => button.label),
      source: lastSiteActivityAt ? 'site' : 'fallback',
      rateLimitMs: MIN_DISCORD_UPDATE_MS,
      reassertMs: REASSERT_ACTIVITY_MS,
      discordUpdates: discordUpdateCount,
    }, origin);
  }
  if (!isAllowedOrigin(origin)) return reply(res, 403, { ok: false, error: 'Origine refusée' });
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
      const published = publishActivity(JSON.parse(body || '{}'));
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
  clearTimeout(pendingPublishTimer);
  if (rpcReady && rpc) rpc.clearActivity().catch(() => {});
  try { rpc?.destroy(); } catch {}
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1_000).unref();
}

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);

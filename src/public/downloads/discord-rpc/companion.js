const http = require('http');
const RPC = require('discord-rpc');

const HOST = '127.0.0.1';
const PORT = 6464;
const CLIENT_ID = '1477252548090921060';
const LARGE_IMAGE = 'site-logo';
const BASE_URL = 'https://puissance-4-website-production.up.railway.app';
const LARGE_IMAGE_TEXT = `${BASE_URL}/`;
const STALE_AFTER_MS = 45_000;
const MIN_DISCORD_UPDATE_MS = 5_000;
const REASSERT_ACTIVITY_MS = 30_000;

let rpc = null;
let rpcReady = false;
let latestActivity = null;
let lastSignature = '';
let reconnectTimer = null;
let clearTimer = null;
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

function activityButtons(profileUrl) {
  return [
    profileUrl ? { label: 'Voir le Profil', url: profileUrl } : null,
    { label: 'Puissance 4 Site', url: BASE_URL },
  ].filter(Boolean).filter((button, index, list) =>
    list.findIndex(other => other.url === button.url) === index
  ).slice(0, 2);
}

const clean = (value, max = 128) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);

function dedupeSegments(value) {
  const seen = new Set();
  return clean(value).split(/\s*•\s*/).filter(segment => {
    const key = segment.toLocaleLowerCase('fr-FR');
    if (!segment || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).join(' • ');
}

function safeUrl(value) {
  try {
    const url = new URL(String(value || ''));
    return ['http:', 'https:'].includes(url.protocol) ? url.toString() : '';
  } catch {
    return '';
  }
}

function allowedOrigin(origin) {
  try {
    const url = new URL(origin);
    return url.origin === new URL(BASE_URL).origin
      || ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  } catch {
    return false;
  }
}

function headers(origin) {
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
  res.writeHead(status, origin ? headers(origin) : {
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
  <style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#090914;color:#eeeef5;font:16px Arial,sans-serif}.card{width:min(560px,calc(100vw - 48px));padding:28px;border:1px solid #5865f2;border-radius:22px;background:#111126}h1{color:#aeb8ff}.line{margin:10px 0;padding:12px;border-radius:12px;background:#ffffff0a}.ok{color:#30d158}.warn{color:#ffd60a}</style>
  <main class="card"><h1>Puissance 4 Rich Presence</h1><div class="line ${rpcReady ? 'ok' : 'warn'}">${state}</div><div class="line ${latestActivity ? 'ok' : 'warn'}">${activity}</div><p>Dans Discord : Paramètres → Confidentialité de l’activité → active le partage d’activité.</p><p>Si le site ne détecte pas le compagnon, autorise son accès au réseau local dans Chrome.</p></main></html>`);
}

function normalize(input = {}) {
  const playerId = clean(input.playerId, 40);
  const requestedProfile = safeUrl(input.profileUrl);
  const profileUrl = requestedProfile.startsWith('https://')
    ? requestedProfile
    : playerId ? `${BASE_URL}/profil?id=${encodeURIComponent(playerId)}` : '';
  const avatar = safeUrl(input.smallImage);
  const activity = {
    details: clean(input.details) || 'Sur Puissance 4',
    state: dedupeSegments(input.state),
    largeImageKey: LARGE_IMAGE,
    largeImageText: clean(input.largeImageText) || LARGE_IMAGE_TEXT,
    startTimestamp: Number(input.startedAt) > 0 ? new Date(Number(input.startedAt)) : undefined,
    buttons: activityButtons(profileUrl),
    instance: false,
  };
  if (!activity.state) delete activity.state;
  if (!activity.startTimestamp) delete activity.startTimestamp;
  if (avatar) {
    activity.smallImageKey = avatar;
    activity.smallImageText = clean(input.smallImageText) || 'Membre connecté';
  }
  return activity;
}

async function flushDiscordActivity({ force = false } = {}) {
  pendingPublishTimer = null;
  if (!rpcReady || !rpc || !latestActivity) return false;
  const signature = JSON.stringify(latestActivity);
  if (!force && signature === lastSignature) return true;
  try {
    await rpc.setActivity(latestActivity);
    lastSignature = signature;
    lastDiscordUpdateAt = Date.now();
    discordUpdateCount += 1;
    return true;
  } catch {
    const fallback = { ...latestActivity };
    delete fallback.smallImageKey;
    delete fallback.smallImageText;
    await rpc.setActivity(fallback);
    lastSignature = signature;
    lastDiscordUpdateAt = Date.now();
    discordUpdateCount += 1;
    return true;
  }
}

function queueDiscordActivity({ immediate = false, force = false } = {}) {
  if (!rpcReady || !rpc || !latestActivity) return false;
  if (!force && JSON.stringify(latestActivity) === lastSignature) return true;
  clearTimeout(pendingPublishTimer);
  const elapsed = Date.now() - lastDiscordUpdateAt;
  const delay = immediate ? 0 : Math.max(0, MIN_DISCORD_UPDATE_MS - elapsed);
  pendingPublishTimer = setTimeout(() => flushDiscordActivity({ force }).catch(() => {}), delay);
  return true;
}

function publish(input) {
  latestActivity = normalize(input);
  lastSiteActivityAt = Date.now();
  clearTimeout(clearTimer);
  clearTimer = setTimeout(() => {
    latestActivity = defaultActivity();
    lastSiteActivityAt = 0;
    queueDiscordActivity();
  }, STALE_AFTER_MS);
  const shouldReassert = Date.now() - lastDiscordUpdateAt >= REASSERT_ACTIVITY_MS;
  return queueDiscordActivity({ force: shouldReassert });
}

function reconnect() {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, 8_000);
}

function connect() {
  rpc = new RPC.Client({ transport: 'ipc' });
  rpcReady = false;
  rpc.once('ready', async () => {
    rpcReady = true;
    console.log('[RPC] Connecté à Discord.');
    if (!latestActivity) latestActivity = defaultActivity();
    queueDiscordActivity({ immediate: true, force: true });
  });
  rpc.on('disconnected', () => {
    rpcReady = false;
    reconnect();
  });
  rpc.on('error', reconnect);
  rpc.login({ clientId: CLIENT_ID }).catch(() => {
    console.log('[RPC] En attente de Discord Desktop...');
    reconnect();
  });
}

const server = http.createServer((req, res) => {
  const origin = String(req.headers.origin || '');
  if (req.method === 'GET' && req.url === '/') return statusPage(res);
  if (req.method === 'GET' && req.url === '/status') {
    if (origin && !allowedOrigin(origin)) return reply(res, 403, { ok: false });
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
  if (!allowedOrigin(origin)) return reply(res, 403, { ok: false });
  if (req.method === 'OPTIONS') {
    res.writeHead(204, headers(origin));
    return res.end();
  }
  if (req.method !== 'POST' || req.url !== '/activity') return reply(res, 404, { ok: false }, origin);
  let body = '';
  req.setEncoding('utf8');
  req.on('data', chunk => { body += chunk; });
  req.on('end', async () => {
    try {
      const published = publish(JSON.parse(body || '{}'));
      reply(res, 200, { ok: true, discord: rpcReady, published }, origin);
    } catch {
      reply(res, 400, { ok: false }, origin);
    }
  });
});

server.listen(PORT, HOST, () => {
  console.log(`[RPC] Compagnon prêt sur http://${HOST}:${PORT}`);
  connect();
});

process.once('SIGINT', () => {
  clearTimeout(pendingPublishTimer);
  if (rpcReady) rpc.clearActivity().catch(() => {});
  process.exit(0);
});

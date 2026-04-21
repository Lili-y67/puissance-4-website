const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MINUTE = 60 * 1000;

function asBool(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').toLowerCase());
}

function now() {
  return Date.now();
}

function safeString(value, max = 120) {
  return String(value || '').trim().slice(0, max);
}

function slidingWindow(list, windowMs, at = now()) {
  while (list.length && at - list[0] > windowMs) list.shift();
  return list;
}

function normalizeIp(ip) {
  const raw = safeString(ip, 90);
  if (!raw) return 'unknown';
  if (raw.startsWith('::ffff:')) return raw.slice(7);
  return raw;
}

function ipv6Prefix(ip) {
  const parts = ip.split(':').filter(Boolean);
  return parts.slice(0, 4).join(':') || ip;
}

function ipFamily(ip) {
  const normalized = normalizeIp(ip);
  if (normalized.includes(':')) return `v6:${ipv6Prefix(normalized)}`;
  const parts = normalized.split('.');
  if (parts.length === 4) return `v4:${parts.slice(0, 3).join('.')}.0/24`;
  return normalized;
}

function createSecurity(options = {}) {
  const dataDir = options.dataDir || path.join(__dirname, '../data');
  const eventsPath = path.join(dataDir, 'security-events.jsonl');
  const salt = process.env.SECURITY_SALT || process.env.ADMIN_PASSWORD || 'p4-security-local-salt';
  const blockProxyChains = asBool(process.env.SECURITY_BLOCK_PROXY_CHAINS);
  const onEvent = typeof options.onEvent === 'function' ? options.onEvent : null;

  const buckets = new Map();
  const failures = new Map();
  const registrations = [];
  const recentEvents = [];

  function getClientIp(req) {
    const forwarded = safeString(req.headers['x-forwarded-for'] || '', 400);
    const firstForwarded = forwarded.split(',')[0]?.trim();
    return normalizeIp(
      req.headers['cf-connecting-ip']
      || req.headers['x-real-ip']
      || firstForwarded
      || req.socket?.remoteAddress
      || 'unknown'
    );
  }

  function hashIp(ip) {
    return crypto.createHash('sha256').update(`${salt}:${normalizeIp(ip)}`).digest('hex');
  }

  function keyFor(req, scope) {
    return `${scope}:${hashIp(getClientIp(req))}`;
  }

  function touch(key, windowMs, at = now()) {
    const list = buckets.get(key) || [];
    slidingWindow(list, windowMs, at);
    list.push(at);
    buckets.set(key, list);
    return list.length;
  }

  function count(key, windowMs, at = now()) {
    const list = buckets.get(key) || [];
    slidingWindow(list, windowMs, at);
    buckets.set(key, list);
    return list.length;
  }

  function writeEvent(event) {
    const payload = {
      at: new Date().toISOString(),
      level: event.level || 'info',
      type: safeString(event.type, 80),
      reason: safeString(event.reason, 180),
      ip_hash: event.ip_hash || null,
      ip_family_hash: event.ip_family_hash || null,
      pseudo: event.pseudo ? safeString(event.pseudo, 40) : null,
      route: event.route ? safeString(event.route, 120) : null,
    };
    recentEvents.unshift(payload);
    recentEvents.splice(80);
    try {
      if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
      fs.appendFileSync(eventsPath, JSON.stringify(payload) + '\n', 'utf8');
    } catch {}
    if (onEvent) onEvent(payload);
  }

  function deny(req, res, status, type, reason) {
    const ip = getClientIp(req);
    writeEvent({
      level: status >= 429 ? 'warning' : 'info',
      type,
      reason,
      ip_hash: hashIp(ip),
      ip_family_hash: hashIp(ipFamily(ip)),
      route: req.originalUrl || req.url,
      pseudo: req.body?.pseudo,
    });
    return res.status(status).json({
      error: reason,
      security: true,
    });
  }

  function inspectNetwork(req) {
    const forwarded = safeString(req.headers['x-forwarded-for'] || '', 400);
    const chainLength = forwarded ? forwarded.split(',').filter(Boolean).length : 0;
    const risk = [];
    if (chainLength >= 4) risk.push('proxy_chain');
    if (safeString(req.headers.via).length) risk.push('via_proxy');
    return { chainLength, risk, shouldBlock: blockProxyChains && chainLength >= 5 };
  }

  function middleware() {
    return (req, res, next) => {
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('X-Frame-Options', 'SAMEORIGIN');
      res.setHeader('Referrer-Policy', 'same-origin');
      res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
      if ((req.path || '').startsWith('/api/')) res.setHeader('Cache-Control', 'no-store');

      const network = inspectNetwork(req);
      if (network.shouldBlock) {
        return deny(req, res, 403, 'proxy-chain-blocked', 'Connexion proxy trop suspecte. Reessaie avec une connexion normale.');
      }

      if ((req.path || '').startsWith('/api/')) {
        const burst = touch(keyFor(req, 'api-burst'), 10 * 1000);
        const sustained = touch(keyFor(req, 'api-minute'), MINUTE);
        if (burst > 55 || sustained > 240) {
          return deny(req, res, 429, 'api-rate-limit', 'Trop de requetes. Patiente quelques secondes.');
        }
      }
      return next();
    };
  }

  function routeGuard(scope) {
    return (req, res, next) => {
      const at = now();
      const ip = getClientIp(req);
      const ipHash = hashIp(ip);
      const familyHash = hashIp(ipFamily(ip));

      if (scope === 'register') {
        const perMinute = touch(keyFor(req, 'register-minute'), MINUTE, at);
        const perTenMinutes = touch(keyFor(req, 'register-10min'), 10 * MINUTE, at);
        slidingWindow(registrations, 60 * 1000, at);
        const globalBurst = registrations.filter(e => at - e.at <= 10 * 1000).length;
        const familyRecent = registrations.filter(e => e.ip_family_hash === familyHash && at - e.at <= 10 * MINUTE).length;
        if (perMinute > 3 || perTenMinutes > 8) {
          return deny(req, res, 429, 'register-rate-limit', 'Trop de comptes crees depuis cette connexion. Reessaie plus tard.');
        }
        if (globalBurst >= 12 || familyRecent >= 14) {
          return deny(req, res, 429, 'register-raid-guard', 'Protection anti-raid active. Les inscriptions sont temporairement ralenties.');
        }
      }

      if (scope === 'login') {
        const attempts = touch(keyFor(req, 'login-minute'), MINUTE, at);
        const failedKey = `login-fail:${ipHash}:${safeString(req.body?.pseudo, 40).toLowerCase()}`;
        if (attempts > 18 || count(failedKey, 10 * MINUTE, at) >= 8) {
          return deny(req, res, 429, 'login-rate-limit', 'Trop de tentatives de connexion. Patiente un peu.');
        }
      }

      if (scope === 'reset' && touch(keyFor(req, 'reset-10min'), 10 * MINUTE, at) > 5) {
        return deny(req, res, 429, 'reset-rate-limit', 'Trop de demandes de reinitialisation. Patiente un peu.');
      }

      if (scope === 'duel' && touch(keyFor(req, 'duel-minute'), MINUTE, at) > 20) {
        return deny(req, res, 429, 'duel-rate-limit', 'Trop de demandes de duel. Patiente quelques secondes.');
      }

      if (scope === 'guest' && touch(keyFor(req, 'guest-minute'), MINUTE, at) > 24) {
        return deny(req, res, 429, 'guest-rate-limit', 'Trop de sessions invite creees. Patiente un peu.');
      }

      return next();
    };
  }

  function recordRegistration(req, pseudo, playerId) {
    const ip = getClientIp(req);
    const event = {
      at: now(),
      ip_hash: hashIp(ip),
      ip_family_hash: hashIp(ipFamily(ip)),
      pseudo: safeString(pseudo, 40),
      player_id: Number(playerId) || null,
    };
    registrations.push(event);
    slidingWindow(registrations, 30 * MINUTE);
    writeEvent({
      level: 'info',
      type: 'register',
      reason: 'Compte cree',
      ip_hash: event.ip_hash,
      ip_family_hash: event.ip_family_hash,
      pseudo,
      route: req.originalUrl || req.url,
    });
  }

  function recordLoginFailure(req, pseudo) {
    const ip = getClientIp(req);
    const key = `login-fail:${hashIp(ip)}:${safeString(pseudo, 40).toLowerCase()}`;
    const list = failures.get(key) || [];
    slidingWindow(list, 10 * MINUTE);
    list.push(now());
    failures.set(key, list);
    writeEvent({
      level: 'warning',
      type: 'login-failure',
      reason: 'Connexion refusee',
      ip_hash: hashIp(ip),
      ip_family_hash: hashIp(ipFamily(ip)),
      pseudo,
      route: req.originalUrl || req.url,
    });
  }

  function recordLoginSuccess(req, playerId) {
    const ip = getClientIp(req);
    writeEvent({
      level: 'info',
      type: 'login-success',
      reason: `Player ${Number(playerId) || 0}`,
      ip_hash: hashIp(ip),
      ip_family_hash: hashIp(ipFamily(ip)),
      route: req.originalUrl || req.url,
    });
  }

  function getSnapshot() {
    const at = now();
    let activeBuckets = 0;
    for (const [key, list] of buckets.entries()) {
      slidingWindow(list, 30 * MINUTE, at);
      if (list.length) activeBuckets += 1;
      else buckets.delete(key);
    }
    return {
      ok: true,
      mode: blockProxyChains ? 'strict' : 'monitor',
      active_buckets: activeBuckets,
      recent_registrations_10m: registrations.filter(e => at - e.at <= 10 * MINUTE).length,
      recent_registrations_60s: registrations.filter(e => at - e.at <= MINUTE).length,
      recent_events: recentEvents.slice(0, 50),
      note: 'Les IP sont stockees uniquement sous forme de hash.',
    };
  }

  return {
    middleware,
    routeGuard,
    recordRegistration,
    recordLoginFailure,
    recordLoginSuccess,
    getClientIp,
    hashIp,
    getSnapshot,
  };
}

module.exports = { createSecurity };

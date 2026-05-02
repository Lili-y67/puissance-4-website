require('dotenv').config();
const express    = require('express');
const http       = require('http');
const { Server } = require('socket.io');
const fs         = require('fs');
const path       = require('path');
const crypto     = require('crypto');

const { initDb, db, pQ, gQ, mQ, fQ, sQ, abQ, rQ, bQ, vipQ, tQ } = require('./db/db');
const { getRank } = require('./rank');
const { createSecurity } = require('./security');
const { Client, GatewayIntentBits, EmbedBuilder, ActivityType, REST, Routes, ActionRowBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

const ipToPlayers  = new Map(); 
const playerToIp   = new Map(); 
const onlineSockets = new Map();
const visitorSockets = new Map();
let lastPresenceSignature = '';
const { Matchmaking }         = require('./game/Matchmaking');
const { GameManager }         = require('./game/GameManager');

const MAIN_DB_PATH = path.join(__dirname, '../data/p4.db');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, {
  cors: { origin: '*' },
  transports: ['polling'],
  allowUpgrades: false,
});

const mm = new Matchmaking();
const gm = new GameManager();
const security = createSecurity({
  dataDir: path.join(__dirname, '../data'),
  onEvent: event => {
    if (event.level === 'warning') console.warn('[SECURITY]', event.type, event.reason || '');
  },
});
const tournamentQueues = new Map();
const duelChallenges = new Map();
const anonymousSessions = new Map();
const anonymousPlayers = new Map();
let nextAnonymousPlayerId = -1;

function getTournamentQueue(tournamentId) {
  const id = Number(tournamentId);
  if (!tournamentQueues.has(id)) tournamentQueues.set(id, new Matchmaking());
  return tournamentQueues.get(id);
}

function getOnlineSocketIds(playerId) {
  return [...(onlineSockets.get(Number(playerId)) || new Set())];
}

function registerVisitorSocket(socket, visitorIdRaw) {
  const visitorId = String(visitorIdRaw || '').trim().slice(0, 80);
  if (!visitorId) return;
  if (socket.visitorId === visitorId) return;
  unregisterVisitorSocket(socket);
  socket.visitorId = visitorId;
  if (!visitorSockets.has(visitorId)) visitorSockets.set(visitorId, new Set());
  visitorSockets.get(visitorId).add(socket.id);
}

function unregisterVisitorSocket(socket) {
  if (!socket?.visitorId) return;
  const sockets = visitorSockets.get(socket.visitorId);
  if (sockets) {
    sockets.delete(socket.id);
    if (sockets.size === 0) visitorSockets.delete(socket.visitorId);
  }
  socket.visitorId = null;
}

function getVisitorCount() {
  for (const [visitorId, socketIds] of visitorSockets.entries()) {
    for (const socketId of [...socketIds]) {
      if (!io.sockets.sockets.has(socketId)) socketIds.delete(socketId);
    }
    if (socketIds.size === 0) visitorSockets.delete(visitorId);
  }
  return visitorSockets.size;
}

function getPresenceCounts() {
  const onlinePlayers = Number(onlineSockets.size || 0);
  const visitors = Number(getVisitorCount() || 0);
  return {
    onlinePlayers,
    visitors,
    totalPresent: onlinePlayers + visitors,
  };
}

function getBoostDisplayName(rawName) {
  const name = String(rawName || '').trim();
  if (!name) return 'Puissance4-Booster';
  if (/^admin$/i.test(name)) return 'Puissance4-Booster';
  if (/^puissance4-booster$/i.test(name)) return 'Puissance4-Booster';
  return name;
}

function broadcastPresenceCounts(force = false) {
  const counts = getPresenceCounts();
  const signature = `${counts.onlinePlayers}:${counts.visitors}:${counts.totalPresent}`;
  if (!force && signature === lastPresenceSignature) return counts;
  lastPresenceSignature = signature;
  io.emit('presence_counts', counts);
  return counts;
}

function parseSqliteDateMs(value) {
  if (!value) return 0;
  const raw = String(value).trim();
  const normalized = raw.includes('T') ? raw : raw.replace(' ', 'T');
  const withZone = /Z$|[+-]\d{2}:\d{2}$/.test(normalized) ? normalized : `${normalized}Z`;
  const parsed = Date.parse(withZone);
  return Number.isFinite(parsed) ? parsed : 0;
}

function getWeekStartMs(inputMs) {
  const d = new Date(inputMs);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d.getTime();
}

function formatShortFrenchDate(inputMs) {
  return new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: 'short' }).format(new Date(inputMs));
}

function getOnlineSocketsForPlayer(playerId) {
  return getOnlineSocketIds(playerId)
    .map(socketId => io.sockets.sockets.get(socketId))
    .filter(Boolean);
}

function isAnonymousPlayerId(playerId) {
  return Number(playerId) < 0;
}

function getPlayerRecord(playerId) {
  const id = Number(playerId || 0);
  if (!id) return null;
  if (isAnonymousPlayerId(id)) return anonymousPlayers.get(id) || null;
  return pQ.getById.get(id) || null;
}

function purgeExpiredAnonymousSessions() {
  const now = Date.now();
  for (const [token, session] of anonymousSessions.entries()) {
    if (Number(session?.expires || 0) > now) continue;
    anonymousSessions.delete(token);
    if (session?.playerId) anonymousPlayers.delete(Number(session.playerId));
  }
}

function playerIsAlreadyPlaying(playerId) {
  return getOnlineSocketsForPlayer(playerId).some(socket => gm.socketToGame.has(socket.id));
}

function playerIsInAnyQueue(playerId) {
  const socketIds = getOnlineSocketIds(playerId);
  if (socketIds.some(socketId => mm.isInQueue(socketId))) return true;
  for (const queue of tournamentQueues.values()) {
    if (socketIds.some(socketId => queue.isInQueue(socketId))) return true;
  }
  return false;
}

function buildPlayableSocketPayload(player) {
  const fresh = sanitize(player);
  return {
    ...fresh,
    socketId: null,
    color: fresh.color || '#ff2d55',
    shape: fresh.shape || 'circle',
    token_emoji_image: fresh.token_emoji_image || '',
    avatar_decoration: fresh.avatar_decoration || '',
    profile_banner: fresh.profile_banner || '',
    color_secondary: fresh.color_secondary || '',
  };
}

function pickDuelSocket(playerId) {
  const sockets = getOnlineSocketsForPlayer(playerId);
  return sockets.find(socket => !gm.socketToGame.has(socket.id)) || sockets[0] || null;
}

function clearPlayerQueues(playerId) {
  const socketIds = getOnlineSocketIds(playerId);
  socketIds.forEach(socketId => mm.leave(socketId));
  for (const queue of tournamentQueues.values()) {
    socketIds.forEach(socketId => queue.leave(socketId));
  }
}

function scheduleDuelExpiration(challengeId, ttlMs = 90_000) {
  setTimeout(() => {
    const pending = duelChallenges.get(challengeId);
    if (!pending || pending.status !== 'pending') return;
    pending.status = 'expired';
    duelChallenges.set(challengeId, pending);
    if (pending.senderId) {
      getOnlineSocketsForPlayer(pending.senderId).forEach(socket => socket.emit('duel_invite_expired', { id: challengeId }));
    }
    if (pending.targetId) {
      getOnlineSocketsForPlayer(pending.targetId).forEach(socket => socket.emit('duel_invite_expired', { id: challengeId }));
    }
  }, ttlMs);
}

function createDuelChallenge({ senderId, targetId = null, mode = 'direct', ttlMs = 90_000, gameType = 'ranked' }) {
  const challengeId = crypto.randomUUID();
  const safeGameType = String(gameType || 'ranked') === 'friendly' ? 'friendly' : 'ranked';
  const createdAt = Date.now();
  const challenge = {
    id: challengeId,
    status: 'pending',
    senderId: Number(senderId),
    targetId: targetId ? Number(targetId) : null,
    mode,
    gameType: safeGameType,
    requireLogin: safeGameType !== 'friendly',
    createdAt,
    expiresAt: createdAt + Number(ttlMs || 0),
  };
  duelChallenges.set(challengeId, challenge);
  scheduleDuelExpiration(challengeId, ttlMs);
  return challenge;
}

function serializeDuelChallenge(req, challenge, sender, target = null) {
  return {
    id: challenge.id,
    mode: challenge.mode || 'direct',
    gameType: String(challenge.gameType || 'ranked'),
    requireLogin: Number(challenge.requireLogin ? 1 : 0) === 1,
    status: challenge.status,
    createdAt: Number(challenge.createdAt || Date.now()),
    expiresAt: Number(challenge.expiresAt || challenge.createdAt || Date.now()),
    shareUrl: `${req.protocol}://${req.get('host')}/duel/${challenge.id}`,
    sender: sender ? {
      id: sender.id,
      pseudo: sender.pseudo,
      elo: Number(sender.elo || 0),
      color: sender.color || '#ff2d55',
      avatar: sender.avatar || '',
    } : null,
    target: target ? {
      id: target.id,
      pseudo: target.pseudo,
      elo: Number(target.elo || 0),
      color: target.color || '#85EBFF',
      avatar: target.avatar || '',
    } : null,
  };
}

function acceptDuelChallenge(challenge, accepterId) {
  const sender = getPlayerRecord(Number(challenge.senderId || 0));
  const target = getPlayerRecord(Number(accepterId || challenge.targetId || 0));
  if (!sender || sender.deleted || !target || target.deleted) {
    challenge.status = 'expired';
    duelChallenges.set(challenge.id, challenge);
    return { error: 'Un des deux joueurs est introuvable.' };
  }
  if (sender.id === target.id) {
    return { error: 'Tu ne peux pas accepter ton propre duel.' };
  }
  if (challenge.mode !== 'link' && Number(challenge.targetId || 0) !== Number(target.id)) {
    return { error: 'Tu ne peux pas accepter ce duel.' };
  }
  if (playerIsAlreadyPlaying(sender.id) || playerIsAlreadyPlaying(target.id)) {
    challenge.status = 'expired';
    duelChallenges.set(challenge.id, challenge);
    return { error: 'Un des deux joueurs est deja en partie.' };
  }

  const senderSocket = pickDuelSocket(sender.id);
  const targetSocket = pickDuelSocket(target.id);
  if (!senderSocket || !targetSocket) {
    challenge.status = 'expired';
    duelChallenges.set(challenge.id, challenge);
    return { error: 'Le duel ne peut pas demarrer car un joueur n est plus connecte.' };
  }

  const p1 = buildPlayableSocketPayload(sender);
  const p2 = buildPlayableSocketPayload(target);
  p1.socketId = senderSocket.id;
  p2.socketId = targetSocket.id;

  clearPlayerQueues(sender.id);
  clearPlayerQueues(target.id);
  challenge.status = 'accepted';
  challenge.targetId = target.id;
  duelChallenges.set(challenge.id, challenge);

  getOnlineSocketsForPlayer(sender.id).forEach(s => s.emit('duel_invite_accepted', {
    id: challenge.id,
    target: { id: target.id, pseudo: target.pseudo, elo: Number(target.elo || 0), color: target.color || '#85EBFF', avatar: target.avatar || '' },
  }));
  getOnlineSocketsForPlayer(target.id).forEach(s => s.emit('duel_invite_accepted', {
    id: challenge.id,
    target: { id: sender.id, pseudo: sender.pseudo, elo: Number(sender.elo || 0), color: sender.color || '#ff2d55', avatar: sender.avatar || '' },
  }));

  const anonymousFriendlyMatch = String(challenge.gameType || 'ranked') === 'friendly'
    && (isAnonymousPlayerId(sender.id) || isAnonymousPlayerId(target.id));
  _startMatch(p1, p2, {
    duel: true,
    gameType: challenge.gameType || 'ranked',
    persist: !anonymousFriendlyMatch,
  });
  return { ok: true, sender, target };
}

gm._onAfkEnd = (result) => {
  if (!result) return;
  io.to('game:' + result.gameId).emit('game_over', result);
  io.to('live').emit('live_update');
  console.log(`[AFK] Partie ${result.gameId} terminee : winner side ${result.winner}`);
};
gm._onGameFinished = ({ gameId, player1Id, player2Id, winnerId, isDraw }) => {
  try {
    applyTournamentResult(gameId, player1Id, player2Id, winnerId, isDraw);
    finalizeExpiredTournaments();
  } catch (e) {
    console.error('[TOURNOI] result hook:', e.message);
  }
};

function getClientIp(req) {
  return (req.headers['x-forwarded-for'] || '').split(',')[0].trim()
    || req.socket?.remoteAddress
    || 'unknown';
}
function hashIp(ip) {
  // SHA-256 + sel fixe AAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAA AAaAasAAAAAAAAasAA...AAasAAAAAAAAasAA...AAasAA non-rAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAAversible mais dAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAAterministe
  return require('crypto').createHash('sha256').update('p4-ip-salt-2025:' + ip).digest('hex');
}
function getParisMidnightTs(now = Date.now()) {
  const parisNow = new Date(new Date(now).toLocaleString('en-US', { timeZone: 'Europe/Paris' }));
  const midnightParis = new Date(parisNow);
  midnightParis.setHours(0, 0, 0, 0);
  const offset = parisNow.getTime() - now;
  return midnightParis.getTime() - offset;
}

function hasVipRoleIds(roleIds = []) {
  return Array.isArray(roleIds) && (roleIds.includes(DISCORD_ROLE_VIP) || roleIds.includes(DISCORD_ROLE_VIP_PLUS));
}

function hasVipPlusRoleIds(roleIds = []) {
  return Array.isArray(roleIds) && roleIds.includes(DISCORD_ROLE_VIP_PLUS);
}

function hasPersoRoleIds(roleIds = []) {
  return Array.isArray(roleIds) && roleIds.includes(DISCORD_ROLE_CUSTOM);
}

function isPersoPlayer(player) {
  return !!player && Number(player.is_perso) === 1;
}

function isAdminPlayer(player) {
  return !!player && String(player.role || '') === 'admin';
}

function canUseGradientPlayer(player) {
  return isAdminPlayer(player) || isVipPlusPlayer(player) || isPersoPlayer(player);
}

function getPremiumTier(player) {
  if (isPersoPlayer(player)) return 'perso';
  if (isVipPlusPlayer(player)) return 'vip_plus';
  if (isVipPlayer(player)) return 'vip';
  return null;
}

function getPremiumBoostConfig(player) {
  const tier = getPremiumTier(player);
  if (tier === 'vip') return { tier, multiplier: 1.2, durationMs: 60 * 60 * 1000, daily: true, label: 'VIP' };
  if (tier === 'vip_plus') return { tier, multiplier: 1.3, durationMs: 60 * 60 * 1000, daily: true, label: 'VIP+' };
  if (tier === 'perso') return { tier, multiplier: 1.3, durationMs: 2 * 60 * 60 * 1000, daily: false, label: 'PERSO' };
  return null;
}

function isVipPlayer(player) {
  if (!player) return false;
  const vipExpiresAt = Number(player.vip_expires_at || 0);
  if (vipExpiresAt && vipExpiresAt < Date.now() && Number(player.is_vip_plus) !== 1 && Number(player.is_perso) !== 1) return false;
  return Number(player.is_vip) === 1 || Number(player.is_vip_plus) === 1 || Number(player.is_perso) === 1 || isAdminPlayer(player);
}

function isVipPlusPlayer(player) {
  return !!player && (Number(player.is_vip_plus) === 1 || Number(player.is_perso) === 1 || isAdminPlayer(player));
}

let canvasFontsRegistered = false;
function ensureCanvasFonts() {
  if (canvasFontsRegistered) return;
  try {
    const { registerFont } = require('canvas');
    const fontsDir = path.join(__dirname, 'assets', 'fonts');
    registerFont(path.join(fontsDir, 'BarlowCondensed-Bold.ttf'), { family: 'Barlow Condensed', weight: '700' });
    registerFont(path.join(fontsDir, 'Barlow-Regular.ttf'), { family: 'Barlow', weight: '400' });
    registerFont(path.join(fontsDir, 'Barlow-SemiBold.ttf'), { family: 'Barlow', weight: '600' });
    registerFont(path.join(fontsDir, 'BebasNeue-Regular.ttf'), { family: 'Bebas Neue', weight: '400' });
    canvasFontsRegistered = true;
  } catch (e) {
    console.error('[BOT] ensureCanvasFonts:', e.message);
  }
}

function genToken() {
  return require('crypto').randomBytes(32).toString('hex');
}
function createSession(playerId) {
  const token   = genToken();
  const expires = Date.now() + 30 * 24 * 60 * 60 * 1000;
  sQ.set.run(token, playerId, expires);
  return token;
}

function generateGuestPseudo() {
  let pseudo = '';
  do {
    pseudo = `Invite-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
  } while (pQ.getByPseudo.get(pseudo) || [...anonymousPlayers.values()].some(player => player.pseudo === pseudo));
  return pseudo;
}

function createAnonymousGuestSession() {
  const player = {
    id: nextAnonymousPlayerId--,
    pseudo: generateGuestPseudo(),
    password: '',
    elo: 0,
    wins: 0,
    losses: 0,
    draws: 0,
    color: '#ff7eb6',
    color_secondary: '',
    avatar: '',
    banner: '',
    role: 'user',
    shape: 'circle',
    avatar_decoration: '',
    token_emoji_image: '',
    profile_banner: '',
    queue_music: '',
    deleted: 0,
    is_guest: 1,
    is_vip: 0,
    is_vip_plus: 0,
    is_perso: 0,
    is_anonymous: 1,
    created_at: new Date().toISOString(),
  };
  const token = genToken();
  anonymousPlayers.set(player.id, player);
  anonymousSessions.set(token, {
    playerId: player.id,
    expires: Date.now() + 6 * 60 * 60 * 1000,
  });
  return { token, player: sanitize(player) };
}

function createGuestPlayerSession() {
  return createAnonymousGuestSession();
}

app.use(security.middleware());

app.post('/api/auth/guest', security.routeGuard('guest'), (req, res) => {
  try {
    const guestAuth = createGuestPlayerSession();
    res.json({ ok: true, ...guestAuth });
  } catch (error) {
    console.error('[AUTH] guest:', error.message);
    res.status(500).json({ error: 'Impossible de creer la session invite.' });
  }
});

function validateSession(token) {
  if (!token) return null;
  purgeExpiredAnonymousSessions();
  const anonSession = anonymousSessions.get(token);
  if (anonSession) {
    if (Date.now() > anonSession.expires) {
      anonymousSessions.delete(token);
      anonymousPlayers.delete(Number(anonSession.playerId));
      return null;
    }
    return Number(anonSession.playerId);
  }
  const row = sQ.get.get(token);
  if (!row) return null;
  if (Date.now() > row.expires) { sQ.del.run(token); return null; }
  return row.player_id;
}

const VIP_MEDIA_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const VIP_PLUS_MEDIA_COOLDOWN_MS = 12 * 60 * 60 * 1000;
const AVATAR_DECORATION_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const PROFILE_BANNER_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;
const PSEUDO_CHANGE_COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000;
const DECORATIONS_DIR = path.join(__dirname, 'public', 'decorations');
const PROFILE_BANNERS_DIR = path.join(__dirname, 'public', 'banners');
const QUEUE_MUSICS_DIR = path.join(__dirname, 'public', 'sounds');
const DEFAULT_QUEUE_MUSIC_FILE = 'Musique Chambre.mp3';
const DEFAULT_QUEUE_MUSIC_SRC = `/sounds/${DEFAULT_QUEUE_MUSIC_FILE}`;
const QUEUE_MUSIC_THEME_ORDER = ['cyber', 'dj', 'rock', 'country', 'zen', 'mystique', 'lounge', 'aventure', 'dark'];
const QUEUE_MUSIC_THEMES = {
  cyber: 'Cyber',
  dj: 'DJ',
  rock: 'Rock',
  country: 'Country',
  zen: 'Zen',
  mystique: 'Mystique',
  lounge: 'Lounge',
  aventure: 'Aventure',
  dark: 'Dark',
};
const QUEUE_MUSIC_CATALOG = [
  { file: 'Mesmerizing Galaxy Loop.mp3', theme: 'cyber' },
  { file: 'Voxel Revolution.mp3', theme: 'cyber' },
  { file: 'Blippy Trance.mp3', theme: 'cyber' },
  { file: 'Envision.mp3', theme: 'cyber' },
  { file: 'Rollin at 5 - electronic.mp3', theme: 'cyber' },

  { file: 'Brain Dance.mp3', theme: 'dj' },
  { file: 'Galactic Rap.mp3', theme: 'dj' },
  { file: 'Neon Laser Horizon.mp3', theme: 'dj' },
  { file: 'Vibing Over Venus.mp3', theme: 'dj' },
  { file: 'Space Jazz.mp3', theme: 'dj' },

  { file: 'Heroic Age.mp3', theme: 'rock' },
  { file: 'New Hero in Town.mp3', theme: 'rock' },
  { file: 'Strength of the Titans.mp3', theme: 'rock' },
  { file: 'Journey To Ascend.mp3', theme: 'rock' },
  { file: 'Take a Chance.mp3', theme: 'rock' },

  { file: 'Back on Track.mp3', theme: 'country' },
  { file: 'Cloud Dancer.mp3', theme: 'country' },
  { file: 'Musique Chambre.mp3', theme: 'country' },
  { file: 'Serenade D\'Amor.mp3', theme: 'country' },
  { file: 'Water Prelude.mp3', theme: 'country' },

  { file: 'Easy Lemon 60 second.mp3', theme: 'zen' },
  { file: 'Senbazuru.mp3', theme: 'zen' },
  { file: 'Water Lily.mp3', theme: 'zen' },
  { file: 'Clear Waters.mp3', theme: 'zen' },
  { file: 'Midsummer Sky.mp3', theme: 'zen' },
  { file: 'That Zen Moment.mp3', theme: 'zen' },

  { file: 'Guzheng City.mp3', theme: 'mystique' },
  { file: 'Ancient Rite.mp3', theme: 'mystique' },
  { file: 'Industrial Music Box.mp3', theme: 'mystique' },
  { file: 'Fairytale Waltz.mp3', theme: 'mystique' },
  { file: 'Adventure Meme.mp3', theme: 'mystique' },

  { file: 'B-Roll.mp3', theme: 'lounge' },
  { file: 'Off to Osaka.mp3', theme: 'lounge' },
  { file: 'No Frills Salsa - Alternate.mp3', theme: 'lounge' },
  { file: 'Vibe Ace.mp3', theme: 'lounge' },
  { file: 'Our Story Begins.mp3', theme: 'aventure' },

  { file: 'Mystery Sting.mp3', theme: 'dark' },
  { file: 'Not As It Seems.mp3', theme: 'dark' },
  { file: 'Gloom Horizon.mp3', theme: 'dark' },
  { file: 'Ghost Processional.mp3', theme: 'dark' },
  { file: 'Chase Pulse.mp3', theme: 'dark' },
  { file: 'Equatorial Complex.mp3', theme: 'dark' },
];

function getQueueMusicThemeSortIndex(themeId) {
  const index = QUEUE_MUSIC_THEME_ORDER.indexOf(String(themeId || ''));
  return index === -1 ? QUEUE_MUSIC_THEME_ORDER.length : index;
}

function getAvatarDecorationPaths() {
  try {
    return fs.readdirSync(DECORATIONS_DIR, { withFileTypes: true })
      .filter(entry => entry.isFile() && /\.(png|jpe?g|webp)$/i.test(entry.name))
      .map(entry => `/decorations/${entry.name}`)
      .sort((a, b) => a.localeCompare(b, 'fr', { sensitivity: 'base' }));
  } catch {
    return [];
  }
}

function getProfileBannerPaths() {
  try {
    return fs.readdirSync(PROFILE_BANNERS_DIR, { withFileTypes: true })
      .filter(entry => entry.isFile() && /\.(png|jpe?g|webp|gif)$/i.test(entry.name))
      .map(entry => `/banners/${entry.name}`)
      .sort((a, b) => a.localeCompare(b, 'fr', { sensitivity: 'base' }));
  } catch {
    return [];
  }
}

function getQueueMusicPaths() {
  try {
    const presentFiles = new Set(
      fs.readdirSync(QUEUE_MUSICS_DIR, { withFileTypes: true })
        .filter(entry => entry.isFile() && /\.(mp3|ogg|wav|m4a)$/i.test(entry.name))
        .map(entry => entry.name)
    );
    return QUEUE_MUSIC_CATALOG
      .filter(entry => presentFiles.has(entry.file))
      .map(entry => {
        const src = `/sounds/${entry.file}`;
        const label = entry.file
          .replace(/\.[^.]+$/, '')
          .replace(/[_-]+/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();
        return {
          src,
          label,
          theme: entry.theme,
          themeLabel: QUEUE_MUSIC_THEMES[entry.theme] || 'Autre',
        };
      })
      .sort((a, b) => {
        const themeDiff = getQueueMusicThemeSortIndex(a.theme) - getQueueMusicThemeSortIndex(b.theme);
        if (themeDiff !== 0) return themeDiff;
        return a.label.localeCompare(b.label, 'fr', { sensitivity: 'base' });
      });
  } catch {
    return [];
  }
}

function getVipMediaRemainingMs(player) {
  if (isAdminPlayer(player)) return 0;
  const lastChanged = Number(player?.vip_media_changed_at || 0);
  const cooldown = isVipPlusPlayer(player) ? VIP_PLUS_MEDIA_COOLDOWN_MS : VIP_MEDIA_COOLDOWN_MS;
  const remaining = lastChanged + cooldown - Date.now();
  return remaining > 0 ? remaining : 0;
}

function getAvatarDecorationRemainingMs(player) {
  if (isAdminPlayer(player)) return 0;
  const lastChanged = Number(player?.avatar_decoration_changed_at || 0);
  const remaining = lastChanged + AVATAR_DECORATION_COOLDOWN_MS - Date.now();
  return remaining > 0 ? remaining : 0;
}

function getProfileBannerRemainingMs(player) {
  if (isAdminPlayer(player)) return 0;
  const lastChanged = Number(player?.profile_banner_changed_at || 0);
  const remaining = lastChanged + PROFILE_BANNER_COOLDOWN_MS - Date.now();
  return remaining > 0 ? remaining : 0;
}

function formatCooldownHours(ms) {
  const hours = Math.ceil(ms / (60 * 60 * 1000));
  return `${hours}h`;
}
setInterval(() => {
  try { finalizeExpiredTournaments(); } catch (e) {}
}, 60_000);
try { sQ.purge.run(Date.now()); } catch(e) {}

const BOT_PSEUDO = 'Puissance4-AI';
const BOT_AVATAR = '/bot-avatar.svg';
const BOT_BANNER = 'https://i.pinimg.com/1200x/0b/10/ae/0b10aed237a4092f5b6ebf89bccdffbb.jpg';
const _BOT_COLORS = ['#ffd60a','#30d158','#0a84ff','#ff9f0a','#bf5af2','#00c7be','#ff375f','#5e5ce6'];
const _BOT_SHAPES = ['circle','diamond','triangle','star','heart'];
let BOT_PLAYER_ID;
{
  const existing = db.prepare(`SELECT id FROM players WHERE pseudo = ? LIMIT 1`).get(BOT_PSEUDO);
  if (existing) {
    BOT_PLAYER_ID = existing.id;
    db.prepare(`UPDATE players SET avatar=?, banner=?, deleted=0 WHERE id=?`).run(BOT_AVATAR, BOT_BANNER, BOT_PLAYER_ID);
  } else {
    const bc = _BOT_COLORS[Math.floor(Math.random() * _BOT_COLORS.length)];
    const bs = _BOT_SHAPES[Math.floor(Math.random() * _BOT_SHAPES.length)];
    const r  = db.prepare(`INSERT INTO players (pseudo, password, elo, wins, losses, draws, color, shape, avatar, banner, deleted) VALUES (?,''  ,1200,0,0,0,?,?,?,?,0)`).run(BOT_PSEUDO, bc, bs, BOT_AVATAR, BOT_BANNER);
    BOT_PLAYER_ID = r.lastInsertRowid;
  }
  console.log(`[Bot] Puissance4-AI id=${BOT_PLAYER_ID}`);
}

// AAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAA Archivage automatique des parties > 14 jours AAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAA
function archiveOldGames() {
  const cutoff = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
  const result = db.prepare(`
    UPDATE games SET archived = 1
    WHERE archived = 0
      AND status = 'finished'
      AND finished_at < ?
      AND finished_at IS NOT NULL
  `).run(cutoff);
  if (result.changes > 0) console.log(`[Archive] ${result.changes} partie(s) archivAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAAe(s)`);
}
// Lancer au dAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAAmarrage puis toutes les heures
archiveOldGames();
setInterval(archiveOldGames, 60 * 60 * 1000);

app.use(express.json({ limit: '8mb' })); // pour avatars/bannieres base64 et GIF VIP
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/system-status', (_, res) => {
  res.json(readSystemStatus());
});

// AAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAA SPA routing AAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAA
app.get('/',           (_, res) => res.sendFile(path.join(__dirname, 'public/index.html')));
app.get('/game',       (_, res) => res.sendFile(path.join(__dirname, 'public/game.html')));
app.get('/game/bot',   (_, res) => res.sendFile(path.join(__dirname, 'public/game.html')));
app.get('/spec/:id', (req, res) => {
  const gameId = Number(req.params.id);
  const state = gm.games.get(gameId);
  if (!state || state.status !== 'active') {
    return res.sendFile(path.join(__dirname, 'public/404.html'));
  }
  res.sendFile(path.join(__dirname, 'public/live.html'));
});

const DATA_DIR = path.join(__dirname, 'data');
const SYSTEM_STATUS_PATH = path.join(DATA_DIR, 'system-status.json');
const DEFAULT_SYSTEM_STATUS = {
  restarting: false,
  message: '',
  updated_at: 0,
};

function ensureSystemStatusFile() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(SYSTEM_STATUS_PATH)) {
    fs.writeFileSync(SYSTEM_STATUS_PATH, JSON.stringify(DEFAULT_SYSTEM_STATUS, null, 2), 'utf8');
  }
}

function readSystemStatus() {
  try {
    ensureSystemStatusFile();
    const parsed = JSON.parse(fs.readFileSync(SYSTEM_STATUS_PATH, 'utf8'));
    return {
      restarting: Boolean(parsed?.restarting),
      message: String(parsed?.message || ''),
      updated_at: Number(parsed?.updated_at || 0),
    };
  } catch {
    return { ...DEFAULT_SYSTEM_STATUS };
  }
}

function writeSystemStatus(nextStatus) {
  ensureSystemStatusFile();
  const payload = {
    restarting: Boolean(nextStatus?.restarting),
    message: String(nextStatus?.message || ''),
    updated_at: Date.now(),
  };
  fs.writeFileSync(SYSTEM_STATUS_PATH, JSON.stringify(payload, null, 2), 'utf8');
  return payload;
}
app.get('/game/:id',   (_, res) => res.sendFile(path.join(__dirname, 'public/game.html')));

// AAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAA
// DISCORD RESET MOT DE PASSE
// AAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAA
// Variables Discord lues dynamiquement (Railway les injecte aprAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAAs dAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAAmarrage)
const DISCORD_FALLBACK_CLIENT_ID = '1477252548090921060';
const DISCORD_FALLBACK_CLIENT_SECRET = 'KUUu6l5hxe9AIFdUI6V8ie7n8_3HxgVZ';
const DISCORD_FALLBACK_BOT_TOKEN = 'MTQ3NzI1MjU0ODA5MDkyMTA2MA.Gxv9su.HtL_16ym65VieW5VEL4Pr8EQI_AcZ6jFbgZKrc';

function discordConfig() {
  return {
    clientId:     process.env.DISCORD_CLIENT_ID || DISCORD_FALLBACK_CLIENT_ID,
    clientSecret: process.env.DISCORD_CLIENT_SECRET || DISCORD_FALLBACK_CLIENT_SECRET,
    botToken:     process.env.DISCORD_BOT_TOKEN || process.env.BOT_TOKEN || DISCORD_FALLBACK_BOT_TOKEN,
    baseUrl:      process.env.BASE_URL || 'https://puissance-4-website-production.up.railway.app',
  };
}

// Page mot de passe oubliAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAA

// AAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAA Suppression de compte AAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAA
app.delete('/api/players/:id', (req, res) => {
  const { token } = req.body;
  const id = Number(req.params.id);
  if (!token || validateSession(token) !== id) return res.status(403).json({ error: 'Erreur Lili (403) : Tu y as pas accès hihi !' });

  // Anonymiser le pseudo dans les parties (garder l'historique)
  const pseudo = `Joueur_${id}`;
  db.prepare(`UPDATE players SET
    pseudo    = ?,
    password  = '',
    avatar    = '',
    color     = '#444444',
    color_secondary = '',
    is_vip = 0,
    is_vip_plus = 0,
    is_perso = 0,
    discord_id = NULL,
    suspicious = 0
  WHERE id = ?`).run(pseudo, id);

  // Supprimer sessions, follows, reset_codes
  db.prepare(`DELETE FROM sessions    WHERE player_id = ?`).run(id);
  db.prepare(`DELETE FROM follows     WHERE follower_id = ? OR following_id = ?`).run(id, id);
  db.prepare(`DELETE FROM reset_codes WHERE player_id = ?`).run(id);

  // Marquer le compte comme supprimAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAA
  db.prepare(`UPDATE players SET deleted = 1 WHERE id = ?`).run(id);

  res.json({ ok: true });
});


// AAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAA
// PANEL ADMIN
// AAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAA
function getOrCreateAdminPassword() {
  const row = db.prepare('SELECT value FROM config WHERE key = ?').get('admin_password');
  if (row) return row.value;
  const pwd = require('crypto').randomBytes(10).toString('hex'); // 20 chars hex
  db.prepare('INSERT INTO config (key, value) VALUES (?, ?)').run('admin_password', pwd);
  console.log(`[ADMIN] Mot de passe genere : ${pwd}`);
  return pwd;
}
const ADMIN_PASSWORD = getOrCreateAdminPassword();

app.get('/admin', (_, res) => res.sendFile(path.join(__dirname, 'public/admin.html')));

// RAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAAcupAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAArer le mot de passe admin (rAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAAservAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAA aux joueurs rAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAAle admin)
app.get('/api/admin/password', async (req, res) => {
  const token = req.headers['x-token'];
  const playerId = validateSession(token);
  if (!playerId) return res.status(403).json({ error: 'Erreur Lili (403) : Tu y as pas accès hihi !' });
  const player = pQ.getById.get(playerId);
  if (!player?.discord_id) return res.status(403).json({ error: 'RAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAAservAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAA aux administrateurs.' });
  let role = player.role;
  try {
    const { botToken } = discordConfig();
    const discordRole = await getDiscordRole(player.discord_id, botToken);
    if (discordRole !== player.role) {
      pQ.updateRole.run({ role: discordRole, id: playerId });
      role = discordRole;
    }
  } catch(e) {}
  if (role !== 'admin') return res.status(403).json({ error: 'RAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAAservAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAA aux administrateurs.' });
  res.json({ password: ADMIN_PASSWORD });
});

// Auth admin
// Sessions admin en mAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAAmoire
const adminSessions = new Map(); // token AAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAA AAaAasAAAAAAAAasAA...AAasAAAAAAAAasAA...AAasAA { playerId, role }

function revokeAdminSessionsForPlayer(playerId) {
  for (const [token, session] of adminSessions.entries()) {
    if (session.playerId === playerId) adminSessions.delete(token);
  }
}

function getAdminSession(req) {
  const t = req.headers['x-admin-token'];
  if (!t) return null;
  const session = adminSessions.get(t);
  if (!session?.playerId) {
    if (session) adminSessions.delete(t);
    return null;
  }
  const player = pQ.getById.get(session.playerId);
  const liveRole = player?.discord_id && (player.role === 'admin' || player.role === 'moderator')
    ? player.role
    : null;
  if (!liveRole) {
    adminSessions.delete(t);
    return null;
  }
  if (session.role !== liveRole) {
    session.role = liveRole;
    adminSessions.set(t, session);
  }
  return session;
}
function isAdmin(req) {
  const s = getAdminSession(req);
  return s && s.role === 'admin';
}
function isModo(req) {
  const s = getAdminSession(req);
  return s && (s.role === 'admin' || s.role === 'moderator');
}

app.post('/api/admin/login', async (req, res) => {
  const { password, playerToken } = req.body;
  if (password !== ADMIN_PASSWORD) return res.status(403).json({ error: 'Mot de passe incorrect.' });

  const playerId = validateSession(playerToken);
  if (!playerId) return res.status(403).json({ error: 'Session joueur invalide.' });

  const player = pQ.getById.get(playerId);
  if (!player?.discord_id) return res.status(403).json({ error: 'Compte Discord requis pour accAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAAder au panel.' });

  let role = player.role;
  try {
    const { botToken } = discordConfig();
    const discordRole = await getDiscordRole(player.discord_id, botToken);
    if (discordRole !== player.role) {
      pQ.updateRole.run({ role: discordRole, id: playerId });
      role = discordRole;
    }
  } catch(e) {}

  if (!['admin', 'moderator'].includes(role)) {
    return res.status(403).json({ error: 'Ton rAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAAle Discord ne permet pas l\'accAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAAs au panel.' });
  }

  const token = require('crypto').randomBytes(32).toString('hex');
  adminSessions.set(token, { playerId, role });
  setTimeout(() => adminSessions.delete(token), 4 * 60 * 60 * 1000); // 4h
  WH.wlogAdminLogin();
  res.json({ token, role });
});

// Route pour rAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAAcupAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAArer le rAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAAle de la session courante
app.get('/api/admin/me', (req, res) => {
  const s = getAdminSession(req);
  if (!s) return res.status(403).json({ error: 'Erreur Lili (403) : Tu y as pas accès hihi !' });
  res.json({ role: s.role, playerId: s.playerId });
});

app.get('/api/admin/security', (req, res) => {
  if (!isModo(req)) return res.status(403).json({ error: 'Erreur Lili (403) : Tu y as pas acces hihi !' });
  res.json(security.getSnapshot());
});

// Liste tous les joueurs
app.get('/api/admin/players', (req, res) => {
  if (!isModo(req)) return res.status(403).json({ error: 'Erreur Lili (403) : Tu y as pas accès hihi !' });
  const players = db.prepare(`SELECT id, pseudo, elo, coins, role, is_vip, is_vip_plus, is_perso, vip_expires_at, color_secondary, custom_role_text, custom_role_color, custom_role_emoji, wins, losses, draws, suspicious, banned, muted_until, created_at, discord_id, discord_info, last_seen FROM players WHERE deleted = 0 ORDER BY elo DESC`).all();
  // Enrichir avec le statut en ligne
  const now = Date.now();
  const enriched = players.map(p => ({
    ...p,
    online: onlineSockets.has(p.id) && onlineSockets.get(p.id).size > 0,
    discord_linked: !!(p.discord_id),
    shop_inventory: Object.fromEntries(
      shopItemQ.getAllForPlayer.all(p.id).map(row => [row.item_key, Number(row.quantity || 0)])
    ),
  }));
  res.json(enriched);
});

app.patch('/api/admin/players/:id/coins', (req, res) => {
  if (!isModo(req)) return res.status(403).json({ error: 'Non autorise.' });
  const id = Number(req.params.id);
  const target = pQ.getById.get(id);
  if (!target) return res.status(404).json({ error: 'Joueur introuvable.' });
  const delta = Number(req.body?.delta);
  if (!Number.isFinite(delta) || !Number.isInteger(delta) || delta <= 0) {
    return res.status(400).json({ error: 'Montant invalide.' });
  }
  const nextCoins = Number(target.coins || 0) + delta;
  pQ.updateCoins.run({ coins: nextCoins, id });
  try {
    WH.wlogAdminAction('Coins ajoutes', target.pseudo, id, [
      ['Ajout', String(delta), true],
      ['Nouveau total', String(nextCoins), true],
    ]);
  } catch(e) {}
  res.json({ ok: true, coins: nextCoins, added: delta });
});

app.patch('/api/admin/players/:id/shop-item', (req, res) => {
  if (!isModo(req)) return res.status(403).json({ error: 'Non autorise.' });
  const id = Number(req.params.id);
  const target = pQ.getById.get(id);
  if (!target) return res.status(404).json({ error: 'Joueur introuvable.' });

  const itemKey = String(req.body?.itemKey || '').trim();
  const quantity = Number(req.body?.quantity);
  const item = SHOP_ITEMS[itemKey];

  if (!item || !item.boostType) {
    return res.status(400).json({ error: 'Booster invalide.' });
  }
  if (!Number.isFinite(quantity) || !Number.isInteger(quantity) || quantity <= 0 || quantity > 999) {
    return res.status(400).json({ error: 'Quantite invalide.' });
  }

  shopItemQ.addQty.run({ player_id: id, item_key: itemKey, quantity });
  const nextQty = Number(shopItemQ.getOne.get(id, itemKey)?.quantity || 0);

  try {
    WH.wlogAdminAction('Boosters ajoutes', target.pseudo, id, [
      ['Booster', item.label, true],
      ['Ajout', String(quantity), true],
      ['Nouveau total', String(nextQty), true],
    ]);
  } catch (e) {}

  res.json({ ok: true, itemKey, quantity, total: nextQty });
});

// Changer le rAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAAle
app.patch('/api/admin/players/:id/role', async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Seuls les admins peuvent changer les rôles.' });
  const { role } = req.body;
  const vipDuration = String(req.body?.vipDuration || '').trim();
  if (!['user','vip','vipplus','perso','moderator','admin'].includes(role)) return res.status(400).json({ error: 'Role invalide.' });
  const targetId = Number(req.params.id);
  const session = getAdminSession(req);
  const target = pQ.getById.get(targetId);
  if (!target) return res.status(404).json({ error: 'Joueur introuvable.' });
  if (!session?.playerId) return res.status(403).json({ error: 'Session admin invalide.' });
  if (session.playerId === targetId && role === 'admin' && target.role !== 'admin') {
    return res.status(403).json({ error: 'Auto-promotion interdite.' });
  }
  const oldRole = target.role;
  const oldVip  = Number(target.is_vip) === 1;
  const oldVipPlus = Number(target.is_vip_plus) === 1;
  const oldPerso = Number(target.is_perso) === 1;
  const vipExpiryMap = { '1m': 30 * 24 * 60 * 60 * 1000, '1y': 365 * 24 * 60 * 60 * 1000 };
  if (role === 'vip') {
    if (!vipExpiryMap[vipDuration]) return res.status(400).json({ error: 'Choisis une duree VIP valide.' });
    WH.wlogAdminAction('VIP accordAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAA', target.pseudo, req.params.id, [['VIP avant', oldVip ? 'oui' : 'non', true], ['VIP aprAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAAs', 'oui', true]]);
    pQ.updateVip.run({ is_vip: 1, id: targetId });
    pQ.updateVipPlus.run({ is_vip_plus: 0, id: targetId });
    pQ.updateVipExpiry.run({ vip_expires_at: Date.now() + vipExpiryMap[vipDuration], id: targetId });
  } else if (role === 'vipplus') {
    WH.wlogAdminAction('VIP+ accorde', target.pseudo, req.params.id, [['VIP+ avant', oldVipPlus ? 'oui' : 'non', true], ['VIP+ apres', 'oui', true]]);
    pQ.updateVip.run({ is_vip: 1, id: targetId });
    pQ.updateVipPlus.run({ is_vip_plus: 1, id: targetId });
    pQ.updateVipExpiry.run({ vip_expires_at: null, id: targetId });
  } else if (role === 'perso') {
    WH.wlogAdminAction('Perso accorde', target.pseudo, req.params.id, [['Perso avant', oldPerso ? 'oui' : 'non', true], ['Perso apres', 'oui', true]]);
    pQ.updatePerso.run({ is_perso: 1, id: targetId });
  } else {
    WH.wlogAdminAction('Rôle changé', target.pseudo, req.params.id, [['Ancien', oldRole, true], ['Nouveau', role, true]]);
    pQ.updateRole.run({ role, id: targetId });
  }

  const updatedTarget = pQ.getById.get(targetId);

  // Sync rAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAAle Discord si liAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAA
  if (target.discord_id) {
    try {
      await syncDiscordRole(
        target.discord_id,
        updatedTarget?.role || target.role,
        Number(updatedTarget?.is_vip || 0) === 1,
        Number(updatedTarget?.is_vip_plus || 0) === 1,
        Number(updatedTarget?.is_perso || 0) === 1
      );
    } catch(e) {}
    // DM de notification
    try { await sendDM(target.discord_id, [
      '**Puissance 4 Changement de rôle**',
      '',
      `Bonjour **${target.pseudo}** !`,
      '',
      role === 'vip'
        ? 'Le statut **VIP** vient de tAAaAa AaaAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAAtre attribuAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAA.'
        : role === 'vipplus'
          ? "Le statut **VIP+** vient de t'être attribue."
        : `Ton rôle a été modifié en : **${oldRole}** devient à présent **${role}**`,
      '_Si tu as des questions, contacte un administrateur sur le serveur Discord._',
    ].join('\n')); } catch(e) {}
  }
  res.json({ ok: true });
});

app.patch('/api/admin/players/:id/custom-role', (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Seuls les admins peuvent modifier le role personnalise.' });
  const id = Number(req.params.id);
  const target = pQ.getById.get(id);
  if (!target) return res.status(404).json({ error: 'Joueur introuvable.' });
  if (Number(target.is_perso) !== 1 && String(req.body?.text || '').trim()) {
    return res.status(403).json({ error: 'Le badge personnalise est reserve au pack Perso.' });
  }

  const rawText = String(req.body?.text || '').trim();
  const rawColor = String(req.body?.color || '').trim();
  const rawEmoji = String(req.body?.emoji || '').trim();
  if (rawText.length > CUSTOM_ROLE_MAX_LENGTH) return res.status(400).json({ error: `Le role personnalise doit faire ${CUSTOM_ROLE_MAX_LENGTH} caracteres max.` });
  if (rawText && !rawColor) return res.status(400).json({ error: 'Une couleur est requise pour le role personnalise.' });
  if (rawColor && !/^#[0-9a-fA-F]{6}$/.test(rawColor)) return res.status(400).json({ error: 'Couleur invalide.' });
  const emoji = rawEmoji ? [...rawEmoji][0] : '';

  pQ.updateCustomRole.run({
    id,
    text: rawText,
    color: rawText ? rawColor.toUpperCase() : '',
    emoji: rawText ? emoji : '',
  });
  WH.wlogAdminAction('Role personnalise', target.pseudo, id, [
    ['Texte', rawText || 'aucun', true],
    ['Couleur', rawText ? rawColor.toUpperCase() : 'aucune', true],
    ['Emoji', rawText ? (emoji || 'aucun') : 'aucun', true],
  ]);
  if (target.discord_id) {
    syncDiscordRole(
      target.discord_id,
      target.role,
      Number(target.is_vip) === 1,
      Number(target.is_vip_plus) === 1,
      Number(target.is_perso) === 1
    ).catch(() => {});
  }
  res.json({ ok: true });
});

app.patch('/api/players/:id/custom-role', (req, res) => {
  const id = Number(req.params.id);
  const token = String(req.body?.token || '');
  const playerId = validateSession(token);
  if (!playerId || playerId !== id) return res.status(401).json({ error: 'Session invalide.' });
  const target = pQ.getById.get(id);
  if (!target) return res.status(404).json({ error: 'Joueur introuvable.' });
  if (Number(target.is_perso || 0) !== 1) {
    return res.status(403).json({ error: 'Le badge personnalise est reserve au pack Perso.' });
  }

  const rawText = String(req.body?.text || '').trim();
  const rawColor = String(req.body?.color || '').trim();
  const rawEmoji = String(req.body?.emoji || '').trim();
  if (rawText.length > CUSTOM_ROLE_MAX_LENGTH) return res.status(400).json({ error: `Le badge perso doit faire ${CUSTOM_ROLE_MAX_LENGTH} caracteres max.` });
  if (rawText && !rawColor) return res.status(400).json({ error: 'Une couleur est requise.' });
  if (rawColor && !/^#[0-9a-fA-F]{6}$/.test(rawColor)) return res.status(400).json({ error: 'Couleur invalide.' });
  const emoji = rawEmoji ? [...rawEmoji][0] : '';
  const nextColor = rawText ? rawColor.toUpperCase() : '';

  pQ.updateCustomRole.run({
    id,
    text: rawText,
    color: nextColor,
    emoji: rawText ? emoji : '',
  });

  try {
    WH.wlogAdminAction('Badge perso profil', target.pseudo, id, [
      ['Texte', rawText || 'aucun', true],
      ['Couleur', nextColor || 'aucune', true],
      ['Emoji', rawText ? (emoji || 'aucun') : 'aucun', true],
    ]);
  } catch(e) {}

  res.json({ ok: true, text: rawText, color: nextColor, emoji: rawText ? emoji : '' });
});

// Changer le pseudo
app.patch('/api/admin/players/:id/pseudo', async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Seuls les admins peuvent changer les pseudos.' });
  const { pseudo } = req.body;
  if (!pseudo?.trim()) return res.status(400).json({ error: 'Pseudo invalide.' });
  try {
    const target = pQ.getById.get(Number(req.params.id));
    const oldPseudo = target?.pseudo || '?';
    WH.wlogAdminAction('Pseudo changé', oldPseudo, req.params.id, [['Nouveau', pseudo.trim(), true]]);
    pQ.updatePseudo.run({ pseudo: pseudo.trim(), id: Number(req.params.id) });

    // Notif DM + renommage sur le serveur Discord
    if (target?.discord_id) {
      try { await renameOnServer(target.discord_id, pseudo.trim()); } catch(e) {}
      try { await sendDM(target.discord_id, [
        '**Puissance 4 Changement de pseudo**',
        '',
        `Bonjour !`,
        '',
        `Ton pseudo a été modifié par un administrateur par un administrateur : **${oldPseudo}** a été changé en : **${pseudo.trim()}**`,
        '_Si tu n\'as pas demandé ce changement, contacte un administrateur._',
      ].join('\n')); } catch(e) {}
    }
    res.json({ ok: true });
  } catch(e) { res.status(400).json({ error: 'Ce pseudo est déjà utilisé' }); }
});

// Reset ELO
app.patch('/api/admin/players/:id/elo', (req, res) => {
  if (!isModo(req)) return res.status(403).json({ error: 'Erreur Lili (403) : Tu y as pas accès hihi !' });
  const { elo } = req.body;
  const _pe = pQ.getById.get(Number(req.params.id));
  WH.wlogAdminAction('ELO reset', _pe?.pseudo || req.params.id, req.params.id, [['Ancien ELO', _pe?.elo ?? '?', true], ['Nouveau ELO', elo, true]]);
  db.prepare('UPDATE players SET elo = ? WHERE id = ?').run(Number(elo) || 1000, Number(req.params.id));
  res.json({ ok: true });
});

// Mute temporaire (interdit de jouer)
app.patch('/api/admin/players/:id/mute', (req, res) => {
  if (!isModo(req)) return res.status(403).json({ error: 'Erreur Lili (403) : Tu y as pas accès hihi !' });
  const hours = Number(req.body?.hours);
  const minutes = Number(req.body?.minutes);
  const durationMinutes = Number.isFinite(minutes)
    ? Math.max(0, Math.floor(minutes))
    : (Number.isFinite(hours) ? Math.max(0, Math.floor(hours * 60)) : 0);
  const until = durationMinutes > 0 ? Date.now() + durationMinutes * 60 * 1000 : null;
  const _pm = pQ.getById.get(Number(req.params.id));
  WH.wlogMute(_pm?.pseudo || req.params.id, req.params.id, durationMinutes / 60);
  pQ.setMute.run({ until, id: Number(req.params.id) });
  res.json({ ok: true, minutes: durationMinutes });
});

// Ban / Unban
app.patch('/api/admin/players/:id/ban', (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Seuls les admins peuvent bannir.' });
  const { banned } = req.body;
  const _pb = pQ.getById.get(Number(req.params.id));
  WH.wlogBan(_pb?.pseudo || req.params.id, req.params.id, banned);
  pQ.setBanned.run({ banned: banned ? 1 : 0, id: Number(req.params.id) });
  res.json({ ok: true });
});

// Reset suspicious
app.patch('/api/admin/players/:id/suspicious', (req, res) => {
  if (!isModo(req)) return res.status(403).json({ error: 'Erreur Lili (403) : Tu y as pas accès hihi !' });
  abQ.setSuspicious.run({ val: 0, id: Number(req.params.id) });
  res.json({ ok: true });
});

app.get('/forgot-password', (_, res) => res.sendFile(path.join(__dirname, 'public/forgot-password.html')));
app.get('/reset-password',  (_, res) => res.sendFile(path.join(__dirname, 'public/reset-password.html')));


// AAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAA
// WEBHOOK DISCORD
// AAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAA
const WH = require('./webhooks');
const { wlog, mkEmbed: embed } = WH;

// AAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAA Constantes Discord rAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAAles AAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAA
const DISCORD_GUILD    = '1477078197530263582';
const DISCORD_ROLE_ADM = '1480180456782827530';
const DISCORD_ROLE_MOD = '1480180483613655181';
const DISCORD_ROLE_VIP = '1489360367246114866'; // RAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAAle VIP
const DISCORD_ROLE_VIP_PLUS = '1490328326806438058';
const DISCORD_ROLE_CUSTOM = '1490049340407021649';
const CUSTOM_ROLE_MAX_LENGTH = 8;
const SHOP_ITEMS = Object.freeze({
  vip_1m: { key: 'vip_1m', category: 'ranks', label: 'VIP 1 mois', price: 100 },
  vip_1y: { key: 'vip_1y', category: 'ranks', label: 'VIP 1 an', price: 1000 },
  vip_plus: { key: 'vip_plus', category: 'ranks', label: 'VIP+', price: 5000 },
  perso: { key: 'perso', category: 'ranks', label: 'Perso', price: 15000 },
  elo_mini: { key: 'elo_mini', category: 'elo_boosters', label: 'Mini Boost', price: 250, boostType: 'elo', multiplier: 1.05, defaultStock: 10 },
  elo_classic: { key: 'elo_classic', category: 'elo_boosters', label: 'Classic Boost', price: 750, boostType: 'elo', multiplier: 1.10, defaultStock: 5 },
  elo_max: { key: 'elo_max', category: 'elo_boosters', label: 'Max Boost', price: 2500, boostType: 'elo', multiplier: 1.25, defaultStock: 3 },
  elo_princess: { key: 'elo_princess', category: 'elo_boosters', label: 'Princess Boost', price: 5000, boostType: 'elo', multiplier: 1.50, defaultStock: 1 },
  coin_boost: { key: 'coin_boost', category: 'coin_boosters', label: 'Coin Boost', price: 3000, boostType: 'coins', multiplier: 5, defaultStock: 5 },
  coin_boost_plus: { key: 'coin_boost_plus', category: 'coin_boosters', label: 'Coin Boost +', price: 6000, boostType: 'coins', multiplier: 10, defaultStock: 3 },
});
const SHOP_PRICES = Object.freeze(Object.fromEntries(Object.entries(SHOP_ITEMS).map(([k, v]) => [k, v.price])));
const SHOP_STOCK_KEYS = Object.freeze(
  Object.fromEntries(Object.values(SHOP_ITEMS).filter(v => Number.isFinite(v.defaultStock)).map(v => [v.key, `shop_stock_${v.key}`]))
);

db.exec(`
  CREATE TABLE IF NOT EXISTS player_shop_items (
    player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    item_key  TEXT NOT NULL,
    quantity  INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (player_id, item_key)
  );
`);

const shopItemQ = {
  getAllForPlayer: db.prepare(`SELECT item_key, quantity FROM player_shop_items WHERE player_id = ?`),
  getOne: db.prepare(`SELECT quantity FROM player_shop_items WHERE player_id = ? AND item_key = ?`),
  addOne: db.prepare(`
    INSERT INTO player_shop_items (player_id, item_key, quantity)
    VALUES (?, ?, 1)
    ON CONFLICT(player_id, item_key) DO UPDATE SET quantity = quantity + 1
  `),
  addQty: db.prepare(`
    INSERT INTO player_shop_items (player_id, item_key, quantity)
    VALUES (@player_id, @item_key, @quantity)
    ON CONFLICT(player_id, item_key) DO UPDATE SET quantity = quantity + @quantity
  `),
};

for (const item of Object.values(SHOP_ITEMS)) {
  if (!Number.isFinite(item.defaultStock)) continue;
  db.prepare(`INSERT INTO config (key, value) VALUES (?, ?) ON CONFLICT(key) DO NOTHING`).run(SHOP_STOCK_KEYS[item.key], String(item.defaultStock));
}

function getShopStock(itemKey) {
  const item = SHOP_ITEMS[itemKey];
  if (!item || !Number.isFinite(item.defaultStock)) return null;
  const row = db.prepare(`SELECT value FROM config WHERE key = ?`).get(SHOP_STOCK_KEYS[itemKey]);
  const value = Number(row?.value);
  return Number.isFinite(value) ? Math.max(0, value) : item.defaultStock;
}

function normalizeCustomEloBonus(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  const stepped = Math.round(numeric * 10) / 10;
  if (stepped < 0.1 || stepped > 1.0) return null;
  return Number(stepped.toFixed(1));
}

function normalizeCustomCoinMultiplier(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  const stepped = Math.round(numeric);
  if (stepped < 1 || stepped > 10) return null;
  return stepped;
}

function buildCustomShopItem(pack, body = {}) {
  if (pack === 'elo_custom') {
    const bonus = normalizeCustomEloBonus(body.customMultiplier);
    if (bonus === null) return null;
    return {
      key: `elo_custom_${bonus.toFixed(1).replace('.', '_')}`,
      displayKey: 'elo_custom',
      category: 'elo_boosters',
      label: `Booster ELO x${(1 + bonus).toFixed(2)}`,
      price: Math.round((bonus / 0.1) * 750),
      boostType: 'elo',
      multiplier: Number((1 + bonus).toFixed(2)),
      bonus,
      isCustom: true,
    };
  }
  if (pack === 'coin_custom') {
    const multiplier = normalizeCustomCoinMultiplier(body.customMultiplier);
    if (multiplier === null) return null;
    return {
      key: `coin_custom_${String(multiplier).padStart(2, '0')}`,
      displayKey: 'coin_custom',
      category: 'coin_boosters',
      label: `Booster Coins x${multiplier}`,
      price: multiplier * 600,
      boostType: 'coins',
      multiplier,
      isCustom: true,
    };
  }
  return null;
}

function hashTournamentPassword(password = '') {
  return password ? crypto.createHash('sha256').update(`tournoi:${password}`).digest('hex') : '';
}

function generateTournamentPublicId() {
  let id = '';
  do {
    id = 'TRN-' + crypto.randomBytes(4).toString('hex').toUpperCase();
  } while (tQ.getByPublicId.get(id));
  return id;
}

function getParisDateParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Paris',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const map = Object.fromEntries(parts.filter(p => p.type !== 'literal').map(p => [p.type, p.value]));
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour),
    minute: Number(map.minute),
    second: Number(map.second),
  };
}

function getParisTimestampFor(dayOffset, hour, minute = 0, second = 0) {
  const now = new Date();
  const paris = getParisDateParts(now);
  const utcGuess = new Date(Date.UTC(paris.year, paris.month - 1, paris.day + dayOffset, hour, minute, second));
  const corrected = new Date(utcGuess.toLocaleString('en-US', { timeZone: 'Europe/Paris' }));
  const offset = corrected.getTime() - utcGuess.getTime();
  return utcGuess.getTime() - offset;
}

function getAutoTournamentName(hour) {
  return `Tournoi public ${String(hour).padStart(2, '0')}h`;
}

function findTournamentByRef(ref) {
  const value = String(ref || '').trim();
  if (!value) return null;
  return tQ.getByPublicId.get(value) || tQ.getById.get(Number(value));
}

function getTournamentTop3(tournamentId) {
  return tQ.standings.all(tournamentId).slice(0, 3).map((entry, index) => ({
    place: index + 1,
    player_id: entry.player_id,
    pseudo: entry.pseudo,
    score: Number(entry.score || 0),
    wins: Number(entry.wins || 0),
    streak: Number(entry.streak || 0),
    avatar: entry.avatar || '',
    color: entry.color || '#ff2d55',
  }));
}

function serializeTournament(row, playerId = null) {
  const top3 = getTournamentTop3(row.id);
  const joined = playerId ? !!tQ.getEntry.get(row.id, playerId) : false;
  const me = playerId ? tQ.getEntry.get(row.id, playerId) : null;
  const now = Date.now();
  return {
    id: row.id,
    public_id: row.public_id || `TRN-${row.id}`,
    name: row.name,
    mode: row.mode,
    duration_minutes: Number(row.duration_minutes || 0),
    move_time_seconds: Number(row.move_time_seconds || 0),
    reward_1: Number(row.reward_1 || 0),
    reward_2: Number(row.reward_2 || 0),
    reward_3: Number(row.reward_3 || 0),
    created_at: Number(row.created_at || 0),
    starts_at: Number(row.starts_at || 0),
    ends_at: Number(row.ends_at || 0),
    status: row.status,
    paused_at: Number(row.paused_at || 0) || null,
    finished_at: Number(row.finished_at || 0) || null,
    starts_in_ms: Math.max(0, Number(row.starts_at || 0) - now),
    creator_pseudo: row.creator_pseudo || '',
    participants: Number(row.participants || 0),
    has_password: !!row.password,
    joined,
    my_score: me ? Number(me.score || 0) : 0,
    my_streak: me ? Number(me.streak || 0) : 0,
    my_wins: me ? Number(me.wins || 0) : 0,
    top3,
  };
}

function getPublicActiveTournament() {
  const row = tQ.listAll.all().find(entry => entry.status === 'active' && !entry.password);
  return row ? serializeTournament(row, null) : null;
}

function getPublicPendingTournament() {
  const row = tQ.listAll.all().find(entry => entry.status === 'pending' && !entry.password);
  return row ? serializeTournament(row, null) : null;
}

function clearTournamentQueue(tournamentId) {
  try { tournamentQueues.get(Number(tournamentId))?.reset?.(); } catch (e) {}
}

function ensureAutoTournaments() {
  if (!BOT_PLAYER_ID) return;
  const candidates = [];
  for (const dayOffset of [0, 1, 2]) {
    for (const hour of [12, 20]) {
      const startsAt = getParisTimestampFor(dayOffset, hour, 0, 0);
      if (startsAt + (60 * 60 * 1000) <= Date.now()) continue;
      candidates.push({ hour, startsAt });
    }
  }
  candidates.sort((a, b) => a.startsAt - b.startsAt);
  for (const slot of candidates.slice(0, 2)) {
    const endsAt = slot.startsAt + 60 * 60 * 1000;
    const exists = db.prepare(`
      SELECT id FROM tournaments
      WHERE mode = 'auto' AND starts_at = ? AND created_by = ?
      LIMIT 1
    `).get(slot.startsAt, BOT_PLAYER_ID);
    if (exists) continue;
    tQ.create.run({
      public_id: generateTournamentPublicId(),
      name: getAutoTournamentName(slot.hour),
      created_by: BOT_PLAYER_ID,
      mode: 'auto',
      password: '',
      duration_minutes: 60,
      move_time_seconds: 30,
      reward_1: 1000,
      reward_2: 500,
      reward_3: 250,
      created_at: Date.now(),
      starts_at: slot.startsAt,
      ends_at: endsAt,
      status: slot.startsAt > Date.now() ? 'pending' : 'active',
      paused_at: null,
    });
  }
}

function activatePendingTournaments() {
  const now = Date.now();
  const pending = tQ.listPendingToStart.all(now);
  for (const tournament of pending) {
    try {
      tQ.markActive.run({ id: tournament.id });
    } catch (e) {
      console.error('[TOURNOI] activate:', e.message);
    }
  }
}

const finalizeTournament = db.transaction((tournamentId, finishedAt) => {
  const tournament = tQ.getById.get(tournamentId);
  if (!tournament || tournament.status !== 'active') return null;
  const standings = tQ.standings.all(tournamentId);
  const rewards = [Number(tournament.reward_1 || 0), Number(tournament.reward_2 || 0), Number(tournament.reward_3 || 0)];
  standings.slice(0, 3).forEach((entry, index) => {
    const reward = rewards[index] || 0;
    if (reward > 0) pQ.addCoins.run({ delta: reward, id: entry.player_id });
  });
  tQ.markFinished.run({ id: tournamentId, finished_at: finishedAt });
  return { tournamentId, standings: standings.slice(0, 3), rewards };
});

function finalizeExpiredTournaments() {
  ensureAutoTournaments();
  activatePendingTournaments();
  const now = Date.now();
  const expired = tQ.listExpiredActive.all(now);
  for (const tournament of expired) {
    try {
      finalizeTournament(tournament.id, now);
      clearTournamentQueue(tournament.id);
    } catch (e) {
      console.error('[TOURNOI] finalize:', e.message);
    }
  }
}

const applyTournamentResult = db.transaction((gameId, player1Id, player2Id, winnerId, isDraw) => {
  const tournaments = tQ.listActiveForPair.all(player1Id, player2Id, Date.now());
  for (const tournament of tournaments) {
    if (tQ.hasMatch.get(tournament.id, gameId)) continue;
    tQ.insertMatch.run(tournament.id, gameId, Date.now());
    if (isDraw || !winnerId) {
      tQ.addDraw.run({ tournament_id: tournament.id, player_id: player1Id });
      tQ.addDraw.run({ tournament_id: tournament.id, player_id: player2Id });
      continue;
    }
    const loserId = winnerId === player1Id ? player2Id : player1Id;
    const winnerEntry = tQ.getEntry.get(tournament.id, winnerId);
    const streak = Number(winnerEntry?.streak || 0);
    const scoreGain = 1 + streak;
    tQ.addWinner.run({ tournament_id: tournament.id, player_id: winnerId, score_gain: scoreGain });
    tQ.addLoser.run({ tournament_id: tournament.id, player_id: loserId });
  }
});

// Envoyer un DM Discord via le bot
async function sendDM(discordId, text) {
  const { botToken } = discordConfig();
  if (!botToken) return;
  const dmRes  = await fetch('https://discord.com/api/v10/users/@me/channels', {
    method: 'POST',
    headers: { 'Authorization': 'Bot ' + botToken, 'Content-Type': 'application/json' },
    body: JSON.stringify({ recipient_id: discordId }),
  });
  const dm = await dmRes.json();
  if (!dm.id) return;
  await fetch(`https://discord.com/api/v10/channels/${dm.id}/messages`, {
    method: 'POST',
    headers: { 'Authorization': 'Bot ' + botToken, 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: text }),
  });
}

// Renommer un membre sur le serveur Discord
async function renameOnServer(discordId, nickname) {
  const { botToken } = discordConfig();
  if (!botToken) return;

  // VAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAArifier si c'est le propriAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAAtaire du serveur (impossible AAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAA  renommer)
  const guildRes = await fetch(`https://discord.com/api/v10/guilds/${DISCORD_GUILD}`, {
    headers: { 'Authorization': 'Bot ' + botToken },
  });
  const guild = await guildRes.json();
  if (guild.owner_id === discordId) {
    console.log(`[RENAME] Impossible : ${discordId} est le propriAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAAtaire du serveur.`);
    return;
  }

  const res = await fetch(`https://discord.com/api/v10/guilds/${DISCORD_GUILD}/members/${discordId}`, {
    method: 'PATCH',
    headers: { 'Authorization': 'Bot ' + botToken, 'Content-Type': 'application/json' },
    body: JSON.stringify({ nick: nickname }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    // 403 = hiAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAArarchie insuffisante (rAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAAle du membre >= bot)
    console.log(`[RENAME] AAaAa AaaAAaA AAAasAAazAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAchec pour ${discordId} : ${res.status} AAaAa AaaAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAA ${err.message || 'permission refusAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAAe'}`);
  }
}

// Synchroniser le rAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAAle Discord d'un membre (ajoute/retire les rAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAAles)
async function syncDiscordRole(discordId, role, isVip = false, isVipPlus = false, isPerso = false) {
  const { botToken } = discordConfig();
  if (!botToken) return;
  const STAFF_ROLES = [DISCORD_ROLE_ADM, DISCORD_ROLE_MOD];
  const STAFF_TARGET = role === 'admin' ? DISCORD_ROLE_ADM
                    : role === 'moderator' ? DISCORD_ROLE_MOD
                    : null;
  for (const rid of [...STAFF_ROLES, DISCORD_ROLE_VIP, DISCORD_ROLE_VIP_PLUS, DISCORD_ROLE_CUSTOM]) {
    const shouldHave = rid === DISCORD_ROLE_VIP
      ? (!!isVip && !isVipPlus)
      : rid === DISCORD_ROLE_VIP_PLUS
        ? !!isVipPlus
      : rid === DISCORD_ROLE_CUSTOM
        ? !!isPerso
        : rid === STAFF_TARGET;
    const method = shouldHave ? 'PUT' : 'DELETE';
    await fetch(`https://discord.com/api/v10/guilds/${DISCORD_GUILD}/members/${discordId}/roles/${rid}`, {
      method,
      headers: { 'Authorization': 'Bot ' + botToken },
    });
  }
}

async function getDiscordRole(discordUserId, botToken) {
  try {
    const res = await fetch(`https://discord.com/api/v10/guilds/${DISCORD_GUILD}/members/${discordUserId}`, {
      headers: { 'Authorization': 'Bot ' + botToken },
    });
    if (!res.ok) return 'user';
    const member = await res.json();
    if (!Array.isArray(member.roles)) return 'user';
    if (member.roles.includes(DISCORD_ROLE_ADM)) return 'admin';
    if (member.roles.includes(DISCORD_ROLE_MOD)) return 'moderator';
    return 'user';
  } catch(e) { return 'user'; }
}

async function fetchDiscordMemberSnapshot(discordUserId, botToken) {
  try {
    const [memberRes, rolesRes] = await Promise.all([
      fetch(`https://discord.com/api/v10/guilds/${DISCORD_GUILD}/members/${discordUserId}`, {
        headers: { 'Authorization': 'Bot ' + botToken },
      }),
      fetch(`https://discord.com/api/v10/guilds/${DISCORD_GUILD}/roles`, {
        headers: { 'Authorization': 'Bot ' + botToken },
      }),
    ]);
    if (!memberRes.ok) return null;
    const memberInfo = await memberRes.json();
    const guildRoles = rolesRes.ok ? await rolesRes.json() : [];
    const rolesMap = {};
    guildRoles.forEach(r => {
      rolesMap[r.id] = {
        name: r.name,
        color: r.color ? '#' + r.color.toString(16).padStart(6, '0') : null,
      };
    });
    const server_roles_rich = (memberInfo.roles || [])
      .map(rid => ({ id: rid, name: rolesMap[rid]?.name || rid, color: rolesMap[rid]?.color || null }))
      .filter(r => r.name !== '@everyone');
    const newRole = Array.isArray(memberInfo.roles) && memberInfo.roles.includes(DISCORD_ROLE_ADM)
      ? 'admin'
      : Array.isArray(memberInfo.roles) && memberInfo.roles.includes(DISCORD_ROLE_MOD)
        ? 'moderator'
        : 'user';
    return { memberInfo, server_roles_rich, newRole };
  } catch(e) {
    return null;
  }
}

// AAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAA Job toutes les minutes AAaAa AaaAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAA sync rAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAAles Discord AAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAA
setInterval(async () => {
  const { botToken } = discordConfig();
  const linked = db.prepare(`SELECT id, pseudo, role, is_vip, is_vip_plus, is_perso, custom_role_text, custom_role_emoji, discord_id, discord_info FROM players WHERE discord_id IS NOT NULL AND discord_id != '' AND deleted = 0`).all();
  for (const player of linked) {
    const snapshot = await fetchDiscordMemberSnapshot(player.discord_id, botToken);
    if (!snapshot) continue;
    const { memberInfo, server_roles_rich, newRole } = snapshot;
    const roles = memberInfo.roles || [];
    const vipPlusNow = hasVipPlusRoleIds(roles) ? 1 : 0;
    const vipNow = hasVipRoleIds(roles) ? 1 : 0;
    const persoNow = hasPersoRoleIds(roles) ? 1 : 0;
    if (newRole !== player.role) {
      pQ.updateRole.run({ role: newRole, id: player.id });
      console.log(`[ROLE SYNC] ${player.pseudo} : ${player.role} AAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAA AAaAasAAAAAAAAasAA...AAasAAAAAAAAasAA...AAasAA ${newRole}`);
      WH.wlogRoleSync(player.pseudo, player.role, newRole);
    }
    if (vipNow !== Number(player.is_vip)) {
      pQ.updateVip.run({ is_vip: vipNow, id: player.id });
    }
    if (vipPlusNow !== Number(player.is_vip_plus || 0)) {
      pQ.updateVipPlus.run({ is_vip_plus: vipPlusNow, id: player.id });
    }
    if (persoNow !== Number(player.is_perso || 0)) {
      pQ.updatePerso.run({ is_perso: persoNow, id: player.id });
    }
    if (!vipNow && !vipPlusNow && Number(player.vip_expires_at || 0)) {
      pQ.updateVipExpiry.run({ vip_expires_at: null, id: player.id });
    }
    try {
      const existing = player.discord_info ? JSON.parse(player.discord_info) : {};
      rQ.setDiscord.run(player.discord_id, JSON.stringify({
        ...existing,
        server_roles: server_roles_rich,
      }), player.id);
    } catch(e) {}
    try {
      await syncDiscordRole(player.discord_id, newRole, vipNow === 1, vipPlusNow === 1, persoNow === 1);
    } catch(e) {}
  }
}, 60 * 1000);

setInterval(() => {
  const now = Date.now();
  const expiredVip = db.prepare(`SELECT id, discord_id, role, is_perso FROM players WHERE deleted = 0 AND is_vip = 1 AND is_vip_plus = 0 AND vip_expires_at IS NOT NULL AND vip_expires_at > 0 AND vip_expires_at <= ?`).all(now);
  for (const player of expiredVip) {
    pQ.updateVip.run({ is_vip: 0, id: player.id });
    pQ.updateVipExpiry.run({ vip_expires_at: null, id: player.id });
    if (player.discord_id) {
      syncDiscordRole(player.discord_id, player.role, false, false, Number(player.is_perso || 0) === 1).catch(() => {});
    }
  }
}, 60 * 1000);

// Liaison Discord depuis le profil (sans reset)
app.get('/auth/discord/link', (req, res) => {
  const { playerId } = req.query;
  if (!playerId) return res.redirect('/profil?error=invalid');
  const { clientId, baseUrl } = discordConfig();
  const state  = Buffer.from(JSON.stringify({ playerId: Number(playerId), mode: 'link' })).toString('base64');
  const params = new URLSearchParams({
    client_id:     clientId,
    redirect_uri:  baseUrl + '/auth/discord/callback',
    response_type: 'code',
    scope:         'identify',
    state,
  });
  res.redirect('https://discord.com/oauth2/authorize?' + params);
});

app.get('/auth/discord/signin', (req, res) => {
  const { clientId, baseUrl } = discordConfig();
  const state = Buffer.from(JSON.stringify({ mode: 'signin' })).toString('base64');
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: baseUrl + '/auth/discord/callback',
    response_type: 'code',
    scope: 'identify',
    state,
  });
  res.redirect('https://discord.com/oauth2/authorize?' + params);
});

// AAaAa AaaAAaA AAAasAAazAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAtape 1 AAaAa AaaAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAA Rediriger vers Discord OAuth (user-install, DM uniquement)
app.get('/auth/discord/reset', (req, res) => {
  const { pseudo } = req.query;
  if (!pseudo) return res.redirect('/forgot-password?error=pseudo_manquant');
  const player = pQ.getByPseudo.get(pseudo);
  if (!player) return res.redirect('/forgot-password?error=pseudo_introuvable');

  const { clientId, baseUrl } = discordConfig();
  const clientIp = getClientIp(req);
  const state  = Buffer.from(JSON.stringify({ playerId: player.id, ipHash: hashIp(clientIp) })).toString('base64');
  const params = new URLSearchParams({
    client_id:     clientId,
    redirect_uri:  baseUrl + '/auth/discord/callback',
    response_type: 'code',
    scope:         'identify',
    state,
  });
  res.redirect('https://discord.com/oauth2/authorize?' + params);
});

// AAaAa AaaAAaA AAAasAAazAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAtape 2 AAaAa AaaAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAA Callback Discord AAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAA AAaAasAAAAAAAAasAA...AAasAAAAAAAAasAA...AAasAA envoyer le code par DM
app.get('/auth/discord/callback', async (req, res) => {
  const { code, state, error } = req.query;
  let stateData = null;
  try {
    stateData = state ? JSON.parse(Buffer.from(state, 'base64').toString()) : null;
  } catch (e) {
    stateData = null;
  }
  const mode = String(stateData?.mode || 'reset');
  const redirectDiscordError = (errorKey) => {
    if (mode === 'signin') return res.redirect('/?error=' + encodeURIComponent(errorKey));
    if (mode === 'link') return res.redirect('/profil?error=' + encodeURIComponent(errorKey));
    return res.redirect('/forgot-password?error=' + encodeURIComponent(errorKey));
  };

  if (error || !code) return redirectDiscordError('discord_annule');

  try {
    const { playerId, ipHash } = stateData || {};
    const player = playerId ? pQ.getById.get(playerId) : null;
    if (mode !== 'signin' && !player) return redirectDiscordError('joueur_introuvable');

    const { clientId, clientSecret, baseUrl, botToken } = discordConfig();
    // AAaAa AaaAAaA AAAasAAazAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAchanger le code contre un access_token
    const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id:     clientId,
        client_secret: clientSecret,
        grant_type:    'authorization_code',
        code,
        redirect_uri:  baseUrl + '/auth/discord/callback',
      }),
    });
    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) return redirectDiscordError('discord_token');

    // RAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAAcupAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAArer l'identitAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAA Discord
    const userRes = await fetch('https://discord.com/api/users/@me', {
      headers: { Authorization: 'Bearer ' + tokenData.access_token },
    });
    const discordUser = await userRes.json();
    if (!discordUser.id) return redirectDiscordError('discord_id');

    const freshPlayer = pQ.getById.get(playerId);

    if (mode === 'signin') {
      let memberInfo = null;
      let guildRolesMap = {};
      try {
        const { botToken: bt } = discordConfig();
        const mRes = await fetch(`https://discord.com/api/v10/guilds/${DISCORD_GUILD}/members/${discordUser.id}`, {
          headers: { Authorization: 'Bot ' + bt }
        });
        if (mRes.ok) memberInfo = await mRes.json();
      } catch(e) {}
      try {
        const { botToken: bt2 } = discordConfig();
        const rolesRes = await fetch(`https://discord.com/api/v10/guilds/${DISCORD_GUILD}/roles`, {
          headers: { Authorization: 'Bot ' + bt2 }
        });
        if (rolesRes.ok) {
          const roles = await rolesRes.json();
          roles.forEach(r => { guildRolesMap[r.id] = { name: r.name, color: r.color }; });
        }
      } catch(e) {}
      const memberRoleIds = memberInfo?.roles || [];
      const server_roles_rich = memberRoleIds
        .map(id => ({
          id,
          name: guildRolesMap[id]?.name || id,
          color: guildRolesMap[id]?.color
            ? '#' + guildRolesMap[id].color.toString(16).padStart(6, '0')
            : null,
        }))
        .filter(r => r.name !== '@everyone' && r.color !== '#000000');
      const discordInfo = {
        id: discordUser.id,
        username: discordUser.username,
        global_name: discordUser.global_name || discordUser.username,
        discriminator: discordUser.discriminator !== '0' ? discordUser.discriminator : null,
        email: discordUser.email || null,
        verified: discordUser.verified || false,
        mfa_enabled: discordUser.mfa_enabled || false,
        premium_type: discordUser.premium_type || 0,
        public_flags: discordUser.public_flags || 0,
        created_at: new Date(Number(BigInt(discordUser.id) >> 22n) + 1420070400000).toISOString(),
        server_joined: memberInfo?.joined_at || null,
        server_nick: memberInfo?.nick || null,
        server_roles: server_roles_rich,
        boosting_since: memberInfo?.premium_since || null,
        linked_at: new Date().toISOString(),
      };

      let targetPlayer = findPlayerByDiscordIdentity(discordUser) || findReusableDiscordPseudoPlayer(discordUser);
      if (!targetPlayer) {
        const wantedPseudo = getUniquePseudo(discordUser.global_name || discordUser.username || `Discord${discordUser.id.slice(-4)}`);
        const created = pQ.register.get({
          pseudo: wantedPseudo,
          password: hashPwd(genToken()),
        });
        targetPlayer = pQ.getById.get(created.id);
        const avatarUrl = discordAvatarUrl(discordUser);
        const bannerUrl = discordBannerUrl(discordUser);
        if (avatarUrl) pQ.updateAvatar.run({ avatar: avatarUrl, id: targetPlayer.id });
        if (bannerUrl) pQ.updateBanner.run({ banner: bannerUrl, id: targetPlayer.id });
        targetPlayer = pQ.getById.get(targetPlayer.id);
      } else {
        const avatarUrl = discordAvatarUrl(discordUser);
        const bannerUrl = discordBannerUrl(discordUser);
        if (avatarUrl && !targetPlayer.avatar) pQ.updateAvatar.run({ avatar: avatarUrl, id: targetPlayer.id });
        if (bannerUrl && !targetPlayer.banner) pQ.updateBanner.run({ banner: bannerUrl, id: targetPlayer.id });
        targetPlayer = pQ.getById.get(targetPlayer.id);
      }

      claimDiscordIdentity(discordUser.id, discordInfo, targetPlayer.id);
      const linkedPlayer = pQ.getById.get(targetPlayer.id);
      try { await renameOnServer(discordUser.id, linkedPlayer.pseudo); } catch(e) {}
      const token = createSession(linkedPlayer.id);
      const payload = toBase64Url(JSON.stringify({ token, player: sanitize(linkedPlayer) }));
      return res.redirect('/#discord-auth=' + payload);
    }

    if (mode === 'link') {
      // RAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAAcupAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAArer les infos du membre sur le serveur Discord
      const { botToken: bt, baseUrl: bu } = discordConfig();
      let memberInfo = null;
      try {
        const mRes = await fetch(`https://discord.com/api/v10/guilds/${DISCORD_GUILD}/members/${discordUser.id}`, {
          headers: { Authorization: 'Bot ' + bt }
        });
        if (mRes.ok) memberInfo = await mRes.json();
      } catch(e) {}

      // RAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAAcupAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAArer les rAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAAles du guild avec noms et couleurs
      let guildRolesMap = {};
      try {
        const { botToken: bt2 } = discordConfig();
        const rolesRes = await fetch(`https://discord.com/api/v10/guilds/${DISCORD_GUILD}/roles`, {
          headers: { Authorization: 'Bot ' + bt2 }
        });
        if (rolesRes.ok) {
          const roles = await rolesRes.json();
          roles.forEach(r => { guildRolesMap[r.id] = { name: r.name, color: r.color }; });
        }
      } catch(e) {}

      // Construire les rAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAAles enrichis (id, nom, couleur hex)
      const memberRoleIds = memberInfo?.roles || [];
      const server_roles_rich = memberRoleIds
        .map(id => ({
          id,
          name:  guildRolesMap[id]?.name  || id,
          color: guildRolesMap[id]?.color
            ? '#' + guildRolesMap[id].color.toString(16).padStart(6, '0')
            : null,
        }))
        .filter(r => r.name !== '@everyone' && r.color !== '#000000');

      // Construire l'objet discord_info enrichi
      const discordInfo = {
        id:             discordUser.id,
        username:       discordUser.username,
        global_name:    discordUser.global_name || discordUser.username,
        discriminator:  discordUser.discriminator !== '0' ? discordUser.discriminator : null,
        email:          discordUser.email || null,
        verified:       discordUser.verified || false,
        mfa_enabled:    discordUser.mfa_enabled || false,
        premium_type:   discordUser.premium_type || 0,
        public_flags:   discordUser.public_flags || 0,
        created_at:     new Date(Number(BigInt(discordUser.id) >> 22n) + 1420070400000).toISOString(),
        server_joined:  memberInfo?.joined_at || null,
        server_nick:    memberInfo?.nick || null,
        server_roles:   server_roles_rich,
        boosting_since: memberInfo?.premium_since || null,
        linked_at:      new Date().toISOString(),
      };

      // Liaison depuis le profil AAaAa AaaAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAA lier + envoyer DM de confirmation
      claimDiscordIdentity(discordUser.id, discordInfo, playerId);
      // Renommer le membre sur le serveur Discord avec son pseudo en jeu
      try { await renameOnServer(discordUser.id, freshPlayer.pseudo); } catch(e) {}
      const { botToken } = discordConfig();
      try {
        const dmRes = await fetch('https://discord.com/api/v10/users/@me/channels', {
          method: 'POST',
          headers: { 'Authorization': 'Bot ' + botToken, 'Content-Type': 'application/json' },
          body: JSON.stringify({ recipient_id: discordUser.id }),
        });
        const dmData = await dmRes.json();
        if (dmData.id) {
          await fetch(`https://discord.com/api/v10/channels/${dmData.id}/messages`, {
            method: 'POST',
            headers: { 'Authorization': 'Bot ' + botToken, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              content: [
                '\uD83C\uDFAE **Puissance 4 - Compte Discord lie !**',
                '',
                `Bonjour **${freshPlayer.pseudo}** ! \uD83D\uDC4B`,
                '',
                'Ton compte Discord a ete lie avec succes a ton compte Puissance 4.',
                '',
                '\uD83D\uDD11 Tu pourras desormais reinitialiser ton mot de passe via Discord si besoin.',
                "Si tu n'es pas a l'origine de cette liaison, contacte un administrateur.",
                '',
                '\uD83D\uDD27 Si tu es Administrateur, rejoins le serveur pour recuperer les Permissions necessaires : https://discord.gg/ap73mMTX7a',
              ].join('\n'),
            }),
          });
        }
      } catch(e) { console.error('[DM LINK]', e); }
      return res.redirect('/profil?discord_linked=1');
    }

    // Mode reset AAaAa AaaAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAA vAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAArifier que c'est le bon Discord
    if (freshPlayer.discord_id && freshPlayer.discord_id !== discordUser.id) {
      return redirectDiscordError('discord_mismatch');
    }
    if (!freshPlayer.discord_id) {
      rQ.setDiscord.run(discordUser.id, null, playerId);
    }

    // GAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAAnAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAArer le code AAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAA  6 chiffres (15 min)
    const code6    = String(Math.floor(100000 + Math.random() * 900000));
    const expires  = Date.now() + 15 * 60 * 1000;
    rQ.cleanup.run(Date.now());
    rQ.insert.run(playerId, code6, expires, ipHash || null);

    // Envoyer un DM via le bot
    // 1. CrAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAAer un DM channel
    const dmRes = await fetch('https://discord.com/api/v10/users/@me/channels', {
      method: 'POST',
      headers: {
        'Authorization': 'Bot ' + botToken,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({ recipient_id: discordUser.id }),
    });
    const dmData = await dmRes.json();
    if (!dmData.id) return redirectDiscordError('dm_impossible');

    // 2. Envoyer le message
    await fetch(`https://discord.com/api/v10/channels/${dmData.id}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': 'Bot ' + botToken,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({
        content: [
          '**Puissance 4 - Reinitialisation du mot de passe**',
          '',
          `Bonjour **${player.pseudo}** !`,
          '',
          'Voici ton code de reinitialisation :',
          '```',
          code6,
          '```',
          'Ce code expire dans **15 minutes**.',
          '',
          "_Si tu n'es pas a l'origine de cette demande, ignore simplement ce message._",
        ].join('\n'),
      }),
    });

    res.redirect('/reset-password?playerId=' + playerId);
  } catch (e) {
    console.error('[DISCORD RESET]', e);
    redirectDiscordError('erreur_serveur');
  }
});

// AAaAa AaaAAaA AAAasAAazAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAtape 3 AAaAa AaaAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAA Valider le code et changer le mot de passe
app.post('/api/reset-password', security.routeGuard('reset'), (req, res) => {
  const { playerId, code, newPassword } = req.body;
  if (!playerId || !code || !newPassword) return res.status(400).json({ error: 'DonnAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAAes manquantes.' });
  if (newPassword.length < 6) return res.status(400).json({ error: 'Mot de passe trop court (6 caractAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAAres min).' });

  const row = rQ.getValid.get(Number(playerId), String(code), Date.now());
  if (!row) return res.status(400).json({ error: 'Code invalide ou expirAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAA.' });

  // VAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAArifier que c'est la mAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAAme IP qui a demandAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAA le reset
  if (row.ip_hash) {
    const clientIp   = getClientIp(req);
    const clientHash = hashIp(clientIp);
    if (clientHash !== row.ip_hash) {
      console.warn(`[reset-password] IP mismatch AAaAa AaaAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAA demande: ${row.ip_hash.slice(0,8)}AAaAa AaaAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAAAasAA...AAAaAAasAA soumission: ${clientHash.slice(0,8)}AAaAa AaaAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAAAasAA...AAAaAAasAA`);
      return res.status(403).json({ error: 'RAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAAinitialisation refusAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAAe : adresse IP diffAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAArente de celle de la demande. Recommence depuis le dAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAAbut.' });
    }
  }

  const hashed = hashPwd(newPassword);
  pQ.updatePassword.run({ password: hashed, id: Number(playerId) });
  rQ.markUsed.run(row.id);

  res.json({ ok: true });
});

app.get('/profil',     (_, res) => res.sendFile(path.join(__dirname, 'public/profil.html')));
app.get('/replay/:id',     (_, res) => res.sendFile(path.join(__dirname, 'public/replay.html')));
app.get('/replay-bot/:id', (_, res) => res.sendFile(path.join(__dirname, 'public/replay.html')));
app.get('/regles',     (_, res) => res.sendFile(path.join(__dirname, 'public/regles.html')));
app.get('/live',        (_, res) => res.sendFile(path.join(__dirname, 'public/live.html')));
app.get('/leaderboard', (_, res) => res.sendFile(path.join(__dirname, 'public/leaderboard.html')));
app.get('/boutique',    (_, res) => res.sendFile(path.join(__dirname, 'public/boutique.html')));
app.get('/tournoi',     (_, res) => res.sendFile(path.join(__dirname, 'public/tournoi.html')));
app.get('/tournoi/:id', (_, res) => res.sendFile(path.join(__dirname, 'public/tournoi.html')));
app.get('/duel/:id',    (_, res) => res.sendFile(path.join(__dirname, 'public/duel.html')));
app.get('/duel-auth/:id', (_, res) => res.sendFile(path.join(__dirname, 'public/duel-auth.html')));
app.get('/cgu',         (_, res) => res.sendFile(path.join(__dirname, 'public/cgu.html')));
app.get('/api-doc',     (_, res) => res.sendFile(path.join(__dirname, 'public/api-doc.html')));
app.get('/stats',       (_, res) => res.sendFile(path.join(__dirname, 'public/stats.html')));
app.get('/api/decorations', (_, res) => {
  res.json({ decorations: getAvatarDecorationPaths() });
});

app.get('/api/profile-banners', (_, res) => {
  res.json({ banners: getProfileBannerPaths() });
});

app.get('/api/musics', (_, res) => {
  const musics = getQueueMusicPaths();
  const themes = Object.entries(QUEUE_MUSIC_THEMES)
    .map(([id, label]) => ({
      id,
      label,
      count: musics.filter(entry => entry.theme === id).length,
    }))
    .filter(theme => theme.count > 0)
    .sort((a, b) => getQueueMusicThemeSortIndex(a.id) - getQueueMusicThemeSortIndex(b.id));
  res.json({ musics, themes });
});

app.get('/api/tournaments', (req, res) => {
  finalizeExpiredTournaments();
  const token = String(req.headers['x-session-token'] || req.query.token || '');
  const playerId = validateSession(token);
  const rows = tQ.listAll.all();
  res.json({
    tournaments: rows.map(row => serializeTournament(row, playerId || null)),
  });
});

app.get('/api/tournaments/:id', (req, res) => {
  finalizeExpiredTournaments();
  const token = String(req.headers['x-session-token'] || req.query.token || '');
  const playerId = validateSession(token);
  const tournament = findTournamentByRef(req.params.id);
  if (!tournament) return res.status(404).json({ error: 'Tournoi introuvable.' });
  res.json({
    tournament: serializeTournament(tournament, playerId || null),
    standings: tQ.standings.all(Number(tournament.id)).map((entry, index) => ({
      rank: index + 1,
      player_id: entry.player_id,
      pseudo: entry.pseudo,
      avatar: entry.avatar || '',
      color: entry.color || '#ff2d55',
      elo: Number(entry.elo || 0),
      score: Number(entry.score || 0),
      wins: Number(entry.wins || 0),
      losses: Number(entry.losses || 0),
      draws: Number(entry.draws || 0),
      streak: Number(entry.streak || 0),
    })),
  });
});

app.post('/api/tournaments', (req, res) => {
  const token = String(req.body?.token || '');
  const playerId = validateSession(token);
  if (!playerId) return res.status(401).json({ error: 'Session invalide.' });
  const player = pQ.getById.get(playerId);
  if (!player) return res.status(404).json({ error: 'Joueur introuvable.' });
  if (!isPersoPlayer(player) && !isAdminPlayer(player)) {
    return res.status(403).json({ error: 'Creation reservee aux Perso.' });
  }

  const name = String(req.body?.name || '').trim().slice(0, 48);
  const durationMinutes = Math.max(10, Math.min(24 * 60, Number(req.body?.duration_minutes || 60)));
  const moveTimeSeconds = Math.max(5, Math.min(180, Number(req.body?.move_time_seconds || 30)));
  const password = String(req.body?.password || '').trim().slice(0, 32);
  const reward1 = Math.max(0, Math.min(1_000_000, Number(req.body?.reward_1 || 0)));
  const reward2 = Math.max(0, Math.min(1_000_000, Number(req.body?.reward_2 || 0)));
  const reward3 = Math.max(0, Math.min(1_000_000, Number(req.body?.reward_3 || 0)));
  const mode = String(req.body?.mode || 'manual') === 'auto' ? 'auto' : 'manual';
  if (name.length < 3) return res.status(400).json({ error: 'Nom de tournoi trop court.' });

  const now = Date.now();
  const endsAt = now + durationMinutes * 60 * 1000;
  const info = {
    public_id: generateTournamentPublicId(),
    name,
    created_by: playerId,
    mode,
    password: hashTournamentPassword(password),
    duration_minutes: durationMinutes,
    move_time_seconds: moveTimeSeconds,
    reward_1: reward1,
    reward_2: reward2,
    reward_3: reward3,
    created_at: now,
    starts_at: now,
    ends_at: endsAt,
    status: 'active',
    paused_at: null,
  };
  const result = tQ.create.run(info);
  tQ.join.run({ tournament_id: result.lastInsertRowid, player_id: playerId, joined_at: now });
  const row = tQ.listAll.all().find(entry => Number(entry.id) === Number(result.lastInsertRowid));
  res.json({ ok: true, tournament: serializeTournament(row, playerId) });
});

app.post('/api/tournaments/:id/join', (req, res) => {
  finalizeExpiredTournaments();
  const token = String(req.body?.token || '');
  const playerId = validateSession(token);
  if (!playerId) return res.status(401).json({ error: 'Session invalide.' });
  const tournament = findTournamentByRef(req.params.id);
  if (!tournament) return res.status(404).json({ error: 'Tournoi introuvable.' });
  if (['finished'].includes(String(tournament.status)) || Number(tournament.ends_at || 0) <= Date.now()) {
    return res.status(400).json({ error: 'Ce tournoi est termine.' });
  }
  const password = String(req.body?.password || '').trim();
  if (tournament.password && tournament.password !== hashTournamentPassword(password)) {
    return res.status(403).json({ error: 'Mot de passe invalide.' });
  }
  tQ.join.run({ tournament_id: tournament.id, player_id: playerId, joined_at: Date.now() });
  const row = tQ.listAll.all().find(entry => Number(entry.id) === Number(tournament.id));
  res.json({ ok: true, tournament: serializeTournament(row, playerId) });
});

app.get('/api/admin/tournaments', (req, res) => {
  if (!isModo(req)) return res.status(403).json({ error: 'Non autorise.' });
  finalizeExpiredTournaments();
  const rows = tQ.listAll.all().map(row => ({
    ...serializeTournament(row, null),
    queue: getTournamentQueue(row.id).size(),
  }));
  res.json(rows);
});

app.post('/api/admin/tournaments/:id/finish', (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Non autorise.' });
  const tournament = findTournamentByRef(req.params.id);
  const id = Number(tournament?.id || 0);
  const result = finalizeTournament(id, Date.now());
  if (!result) return res.status(404).json({ error: 'Tournoi introuvable ou deja termine.' });
  clearTournamentQueue(id);
  res.json({ ok: true });
});

app.post('/api/admin/tournaments/:id/pause', (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Non autorise.' });
  const tournament = findTournamentByRef(req.params.id);
  if (!tournament) return res.status(404).json({ error: 'Tournoi introuvable.' });
  if (tournament.status !== 'active') return res.status(400).json({ error: 'Tournoi non actif.' });
  tQ.markPaused.run({ id: tournament.id, paused_at: Date.now() });
  clearTournamentQueue(tournament.id);
  res.json({ ok: true });
});

app.post('/api/admin/tournaments/:id/resume', (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Non autorise.' });
  const tournament = findTournamentByRef(req.params.id);
  if (!tournament) return res.status(404).json({ error: 'Tournoi introuvable.' });
  if (tournament.status !== 'paused') return res.status(400).json({ error: 'Tournoi non en pause.' });
  const pausedAt = Number(tournament.paused_at || 0);
  const delta = pausedAt > 0 ? Math.max(0, Date.now() - pausedAt) : 0;
  tQ.resumePaused.run({ id: tournament.id, ends_at: Number(tournament.ends_at || 0) + delta });
  res.json({ ok: true });
});

app.delete('/api/admin/tournaments/:id', (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Non autorise.' });
  const tournament = findTournamentByRef(req.params.id);
  const id = Number(tournament?.id || 0);
  if (!id) return res.status(404).json({ error: 'Tournoi introuvable.' });
  db.prepare(`DELETE FROM tournaments WHERE id = ?`).run(id);
  tournamentQueues.delete(id);
  res.json({ ok: true });
});

app.get('/api/shop/me', (req, res) => {
  const token = String(req.headers['x-session-token'] || req.query.token || '');
  const playerId = validateSession(token);
  if (!playerId) return res.status(401).json({ error: 'Session invalide.' });
  const player = pQ.getById.get(playerId);
  if (!player) return res.status(404).json({ error: 'Joueur introuvable.' });
  const inventoryRows = shopItemQ.getAllForPlayer.all(playerId);
  const inventory = Object.fromEntries(inventoryRows.map(r => [r.item_key, Number(r.quantity || 0)]));
  const stock = Object.fromEntries(
    Object.keys(SHOP_STOCK_KEYS).map(key => [key, getShopStock(key)])
  );
  res.json({
    player: sanitize(player),
    items: SHOP_ITEMS,
    prices: SHOP_PRICES,
    stock,
    inventory,
  });
});

app.post('/api/shop/buy', async (req, res) => {
  const token = String(req.body?.token || '');
  const playerId = validateSession(token);
  if (!playerId) return res.status(401).json({ error: 'Session invalide.' });

  const pack = String(req.body?.pack || '').trim();
  const item = SHOP_ITEMS[pack] || buildCustomShopItem(pack, req.body || {});
  if (!item) return res.status(400).json({ error: 'Pack invalide.' });

  const player = pQ.getById.get(playerId);
  if (!player) return res.status(404).json({ error: 'Joueur introuvable.' });
  const price = Number(item.price || 0);

  if (Number(player.coins || 0) < price) {
    return res.status(400).json({ error: 'Pas assez de coins.' });
  }
  if (pack === 'vip_plus' && Number(player.is_vip_plus || 0) === 1) {
    return res.status(400).json({ error: 'VIP+ deja actif.' });
  }
  if (pack === 'perso' && Number(player.is_perso || 0) === 1) {
    return res.status(400).json({ error: 'Pack Perso deja actif.' });
  }
  if (pack !== 'vip_plus' && Number(player.is_vip_plus || 0) === 1) {
    return res.status(400).json({ error: 'VIP+ est deja actif a vie.' });
  }
  if (Number.isFinite(item.defaultStock) && getShopStock(pack) <= 0) {
    return res.status(400).json({ error: 'Rupture de stock.' });
  }

  const now = Date.now();
  const currentCoins = Number(player.coins || 0);
  const currentVipExpiry = Number(player.vip_expires_at || 0);
  const baseExpiry = currentVipExpiry > now ? currentVipExpiry : now;
  const nextCoins = currentCoins - price;

  pQ.updateCoins.run({ coins: nextCoins, id: playerId });

  if (pack === 'vip_1m') {
    pQ.updateVip.run({ is_vip: 1, id: playerId });
    pQ.updateVipPlus.run({ is_vip_plus: 0, id: playerId });
    pQ.updateVipExpiry.run({ vip_expires_at: baseExpiry + (30 * 24 * 60 * 60 * 1000), id: playerId });
  } else if (pack === 'vip_1y') {
    pQ.updateVip.run({ is_vip: 1, id: playerId });
    pQ.updateVipPlus.run({ is_vip_plus: 0, id: playerId });
    pQ.updateVipExpiry.run({ vip_expires_at: baseExpiry + (365 * 24 * 60 * 60 * 1000), id: playerId });
  } else if (pack === 'vip_plus') {
    pQ.updateVip.run({ is_vip: 1, id: playerId });
    pQ.updateVipPlus.run({ is_vip_plus: 1, id: playerId });
    pQ.updateVipExpiry.run({ vip_expires_at: null, id: playerId });
  } else if (pack === 'perso') {
    pQ.updatePerso.run({ is_perso: 1, id: playerId });
  } else {
    if (item.isCustom) {
      shopItemQ.addOne.run(playerId, item.key);
    } else {
      shopItemQ.addOne.run(playerId, pack);
    }
    const stockKey = SHOP_STOCK_KEYS[pack];
    if (stockKey) {
      db.prepare(`UPDATE config SET value = CAST(MAX(CAST(value AS INTEGER) - 1, 0) AS TEXT) WHERE key = ?`).run(stockKey);
    }
  }

  const fresh = pQ.getById.get(playerId);
  if (fresh?.discord_id) {
    try {
      await syncDiscordRole(
        fresh.discord_id,
        fresh.role,
        Number(fresh.is_vip || 0) === 1,
        Number(fresh.is_vip_plus || 0) === 1,
        Number(fresh.is_perso || 0) === 1
      );
    } catch(e) {}
  }

  const inventoryRows = shopItemQ.getAllForPlayer.all(playerId);
  const inventory = Object.fromEntries(inventoryRows.map(r => [r.item_key, Number(r.quantity || 0)]));
  const stock = Object.fromEntries(
    Object.keys(SHOP_STOCK_KEYS).map(key => [key, getShopStock(key)])
  );

  res.json({
    ok: true,
    pack,
    item,
    prices: SHOP_PRICES,
    items: SHOP_ITEMS,
    stock,
    inventory,
    player: sanitize(pQ.getById.get(playerId)),
  });
});

app.get('/api/live', (_, res) => {
  const games = [];
  for (const [id, state] of gm.games) {
    if (state.status !== 'active' && state.status !== 'finished') continue;
    const entry = {
      id,
      status: state.status,
      players: (() => {
        const c1 = state.players[1].color || '#ff2d55';
        let   c2 = state.players[2].color || '#ffd60a';
        // Si les deux joueurs ont la mAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAAme couleur, forcer p2 en jaune
        if (c1.toLowerCase() === c2.toLowerCase()) c2 = '#ffd60a';
        return {
          1: { id: state.players[1].id, pseudo: state.players[1].pseudo, elo: state.players[1].elo, color: c1, avatar: state.players[1].avatar || '', shape: state.players[1].shape || 'circle', token_emoji_image: state.players[1].token_emoji_image || '', avatar_decoration: state.players[1].avatar_decoration || '', profile_banner: state.players[1].profile_banner || '', color_secondary: state.players[1].color_secondary || '' },
          2: { id: state.players[2].id, pseudo: state.players[2].pseudo, elo: state.players[2].elo, color: c2, avatar: state.players[2].avatar || '', shape: state.players[2].shape || 'circle', token_emoji_image: state.players[2].token_emoji_image || '', avatar_decoration: state.players[2].avatar_decoration || '', profile_banner: state.players[2].profile_banner || '', color_secondary: state.players[2].color_secondary || '' },
        };
      })(),
      grid:    state.board.grid,
      current: state.current,
      moves:   state.moveCount,
    };
    if (state.status === 'finished') {
      entry.result   = state.result   || null;  // { winner, eloChanges }
      entry.finishedAt = state.finishedAt || Date.now();
    }
    games.push(entry);
    if (games.length >= 15) break;
  }
  res.json(games);
});

// AAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAA Hash password AAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAA
function hashPwd(pwd) {
  return crypto.createHash('sha256').update(pwd + 'p4salt2024').digest('hex');
}

function toBase64Url(text) {
  return Buffer.from(text).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function discordAvatarUrl(discordUser) {
  if (!discordUser?.id) return '';
  if (discordUser.avatar) {
    const ext = String(discordUser.avatar).startsWith('a_') ? 'gif' : 'png';
    return `https://cdn.discordapp.com/avatars/${discordUser.id}/${discordUser.avatar}.${ext}?size=512`;
  }
  const fallbackIndex = Number(discordUser.discriminator && discordUser.discriminator !== '0'
    ? Number(discordUser.discriminator) % 5
    : (BigInt(discordUser.id) >> 22n) % 6n);
  return `https://cdn.discordapp.com/embed/avatars/${fallbackIndex}.png`;
}

function discordBannerUrl(discordUser) {
  if (!discordUser?.id || !discordUser?.banner) return '';
  const ext = String(discordUser.banner).startsWith('a_') ? 'gif' : 'png';
  return `https://cdn.discordapp.com/banners/${discordUser.id}/${discordUser.banner}.${ext}?size=1024`;
}

function normalizePseudoCandidate(raw) {
  const cleaned = String(raw || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9_.-]/g, '')
    .slice(0, 16);
  if (cleaned.length >= 3) return cleaned;
  return `User${Math.floor(1000 + Math.random() * 9000)}`;
}

function getUniquePseudo(basePseudo) {
  const base = normalizePseudoCandidate(basePseudo);
  if (!pQ.getByPseudo.get(base)) return base;
  for (let i = 1; i < 10000; i += 1) {
    const suffix = String(i);
    const trimmed = base.slice(0, Math.max(3, 16 - suffix.length));
    const candidate = `${trimmed}${suffix}`;
    if (!pQ.getByPseudo.get(candidate)) return candidate;
  }
  return `User${Date.now().toString().slice(-8)}`;
}

// AAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAA Auth API AAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAA

function findPlayerByDiscordIdentity(discordUser) {
  const discordId = String(discordUser?.id || '').trim();
  if (!discordId) return null;
  const direct = db.prepare(`SELECT * FROM players WHERE discord_id = ? AND deleted = 0 ORDER BY id ASC LIMIT 1`).get(discordId);
  if (direct) return direct;
  const candidates = db.prepare(`
    SELECT *
    FROM players
    WHERE deleted = 0
      AND (discord_id IS NULL OR discord_id = '')
      AND discord_info IS NOT NULL
      AND discord_info != ''
  `).all();
  return candidates.find(player => {
    try {
      const info = JSON.parse(player.discord_info || '{}');
      return String(info?.id || '') === discordId;
    } catch {
      return false;
    }
  }) || null;
}

function claimDiscordIdentity(discordId, discordInfo, playerId) {
  const id = Number(playerId || 0);
  const did = String(discordId || '').trim();
  if (!id || !did) return;
  db.prepare(`
    UPDATE players
    SET discord_id = NULL, discord_info = NULL
    WHERE discord_id = ? AND id != ?
  `).run(did, id);
  rQ.setDiscord.run(did, JSON.stringify(discordInfo || {}), id);
}

function findReusableDiscordPseudoPlayer(discordUser) {
  const base = normalizePseudoCandidate(discordUser?.global_name || discordUser?.username || '');
  if (!base) return null;
  const player = pQ.getByPseudo.get(base);
  if (!player || player.deleted || player.discord_id) return null;
  // On ne reprend automatiquement que les comptes sans mot de passe réel.
  return player.password ? null : player;
}

// Inscription
app.post('/api/auth/register', security.routeGuard('register'), (req, res) => {
  const { pseudo, password } = req.body;
  if (!pseudo?.trim() || !password) return res.status(400).json({ error: 'Pseudo et mot de passe requis.' });
  if (pseudo.trim().length < 2) return res.status(400).json({ error: 'Pseudo trop court (2 caractAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAAres min).' });
  if (password.length < 4)     return res.status(400).json({ error: 'Mot de passe trop court (4 caractAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAAres min).' });

  const existing = pQ.getByPseudo.get(pseudo.trim());
  if (existing) return res.status(409).json({ error: 'Ce pseudo est dAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAAjAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAA  pris.' });

  try {
    let player = pQ.register.get({ pseudo: pseudo.trim(), password: hashPwd(password) });
    // Sauvegarder la couleur choisie AAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAA  l'inscription
    if (req.body.color && /^#[0-9a-fA-F]{6}$/.test(req.body.color)) {
      pQ.updateColor.run({ color: req.body.color, id: player.id });
      player = pQ.getById.get(player.id);
    }
    const token = createSession(player.id);
    security.recordRegistration(req, player.pseudo, player.id);
    res.json({ ...sanitize(player), token });
  } catch(e) {
    console.error('[register]', e);
    res.status(500).json({ error: e.message });
  }
});

// Connexion
app.post('/api/auth/login', security.routeGuard('login'), (req, res) => {
  const { pseudo, password } = req.body;
  if (!pseudo?.trim() || !password) return res.status(400).json({ error: 'Pseudo et mot de passe requis.' });

  const player = pQ.getByPseudo.get(pseudo.trim());
  if (!player) {
    security.recordLoginFailure(req, pseudo);
    return res.status(401).json({ error: 'Pseudo introuvable.' });
  }

  // Support anciens comptes sans mot de passe (migration)
  if (player.password && player.password !== hashPwd(password)) {
    security.recordLoginFailure(req, pseudo);
    return res.status(401).json({ error: 'Mot de passe incorrect.' });
  }

  const token = createSession(player.id);
  security.recordLoginSuccess(req, player.id);
  res.json({ ...sanitize(player), token });
});

// Ne jamais renvoyer le hash du mot de passe au client
function sanitize(p) {
  const { password, ...rest } = p;
  // Masquer les infos perso si compte supprimAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAA
  if (rest.deleted) {
    return {
      ...rest,
      pseudo:     '[SupprimAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAA]',
      avatar:     '',
      avatar_decoration: '',
      token_emoji_image: '',
      profile_banner: '',
      queue_music: '',
      color:      '#555555',
      color_secondary: '',
      discord_id: null,
      banner:     null,
      is_vip:     0,
      is_vip_plus: 0,
      is_perso: 0,
      vip_expires_at: null,
    };
  }
  const canUseQueueMusic = isPersoPlayer(rest) || isAdminPlayer(rest);
  return {
    ...rest,
    queue_music: canUseQueueMusic ? String(rest.queue_music || '') : '',
    is_vip: isVipPlayer(rest) ? 1 : 0,
    is_vip_plus: isVipPlusPlayer(rest) ? 1 : 0,
    is_perso: isPersoPlayer(rest) ? 1 : 0,
    vip_expires_at: Number(rest.vip_expires_at || 0) || null,
  };
}

// AAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAA Players API AAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAA
// Fermeture de compte
app.delete('/api/players/:id', (req, res) => {
  const { token } = req.body;
  const id = Number(req.params.id);
  if (!token || validateSession(token) !== id) return res.status(403).json({ error: 'Erreur Lili (403) : Tu y as pas accès hihi !' });

  // Anonymiser le pseudo (les parties gardent le pseudo au moment du jeu via les colonnes p1_pseudo etc.)
  // puis supprimer le joueur AAaAa AaaAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAA les FK ON DELETE CASCADE nettoient sessions/reset_codes
  // Les parties restent intactes (pas de FK cascade sur games)
  // Anonymiser + marquer deleted AAaAa AaaAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAA on garde le joueur en DB pour les parties historiques
  db.prepare(`UPDATE players SET
    pseudo     = '[SupprimAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAA]',
    password   = '',
    color      = '#555555',
    avatar     = '',
    avatar_decoration = '',
    banner     = '',
    profile_banner = '',
    token_emoji_image = '',
    color_secondary = '',
    is_vip = 0,
    is_vip_plus = 0,
    is_perso = 0,
    discord_id = NULL,
    deleted    = 1
  WHERE id = ?`).run(id);
  db.prepare(`DELETE FROM sessions WHERE player_id = ?`).run(id);

  res.json({ ok: true });
});

app.patch('/api/players/:id/shape', (req, res) => {
  const { shape, token } = req.body;
  const base = shape?.split(':')[0];
  const allowed = ['circle','triangle','diamond','star','heart','emoji','emoji_image'];
  if (!base || !allowed.includes(base)) return res.status(400).json({ error: 'Forme invalide.' });
  if (!token || validateSession(token) !== Number(req.params.id)) return res.status(403).json({ error: 'Erreur Lili (403) : Tu y as pas accès hihi !' });
  const player = pQ.getById.get(Number(req.params.id));
  if (base === 'emoji' && !isVipPlayer(player) && !isAdminPlayer(player)) {
    return res.status(403).json({ error: 'L emoji perso est reserve au VIP.' });
  }
  if (base === 'emoji_image' && !isVipPlusPlayer(player) && !isAdminPlayer(player)) {
    return res.status(403).json({ error: 'L emoji image est reserve au VIP+.' });
  }
  if (base === 'emoji_image' && !player?.token_emoji_image) {
    return res.status(400).json({ error: 'Ajoute d\'abord un emoji perso VIP.' });
  }
  pQ.updateShape.run({ shape, id: Number(req.params.id) }); // stocke 'circle' ou 'emoji:AAaAa AaaAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAAAasAA...AAAaAAasAA'
  res.json({ ok: true });
});

app.patch('/api/players/:id/color', (req, res) => {
  if (Number(req.params.id) === BOT_PLAYER_ID) return res.status(403).json({ error: 'Bot non modifiable.' });
  const { color, colorSecondary = '', token } = req.body;
  if (!color || !/^#[0-9a-fA-F]{6}$/.test(color)) return res.status(400).json({ error: 'Couleur invalide.' });
  if (!token || validateSession(token) !== Number(req.params.id)) return res.status(403).json({ error: 'Erreur Lili (403) : Tu y as pas accès hihi !' });
  const player = pQ.getById.get(Number(req.params.id));
  const normalizedSecondary = String(colorSecondary || '').trim();
  if (normalizedSecondary && !/^#[0-9a-fA-F]{6}$/.test(normalizedSecondary)) return res.status(400).json({ error: 'Couleur secondaire invalide.' });
  if (normalizedSecondary && !canUseGradientPlayer(player)) return res.status(403).json({ error: 'Le degrade est reserve au VIP+, Perso ou Admin.' });
  pQ.updateColor.run({ color, id: Number(req.params.id) });
  pQ.updateColorSecondary.run({ color_secondary: normalizedSecondary ? normalizedSecondary.toUpperCase() : '', id: Number(req.params.id) });
  res.json({ ok: true });
});

app.patch('/api/players/:id/pseudo', (req, res) => {
  const { pseudo, token } = req.body;
  const id = Number(req.params.id);
  if (!token || validateSession(token) !== id) return res.status(403).json({ error: 'Non autorise.' });
  const player = pQ.getById.get(id);
  if (!player) return res.status(404).json({ error: 'Joueur introuvable.' });
  const nextPseudo = String(pseudo || '').trim();
  if (!/^[A-Za-z0-9_.-]{3,16}$/.test(nextPseudo)) {
    return res.status(400).json({ error: 'Pseudo invalide. Utilise 3 a 16 caracteres (lettres, chiffres, _, -, .).' });
  }
  const existing = pQ.getByPseudo.get(nextPseudo);
  if (existing && Number(existing.id) !== id) return res.status(409).json({ error: 'Pseudo deja pris.' });
  if (String(player.pseudo || '').toLowerCase() === nextPseudo.toLowerCase()) {
    return res.json({ ok: true, pseudo: player.pseudo, unchanged: true });
  }
  const remaining = Number(player.pseudo_changed_at || 0) + PSEUDO_CHANGE_COOLDOWN_MS - Date.now();
  if (remaining > 0) {
    const days = Math.ceil(remaining / (24 * 60 * 60 * 1000));
    return res.status(429).json({ error: `Pseudo modifiable dans ${days} jour(s).`, remainingMs: remaining });
  }
  pQ.updatePseudo.run({ pseudo: nextPseudo, id });
  pQ.updatePseudoChangedAt.run({ changedAt: Date.now(), id });
  res.json({ ok: true, pseudo: nextPseudo });
});

app.patch('/api/players/:id/banner', (req, res) => {
  const { banner, token } = req.body;
  if (!token || validateSession(token) !== Number(req.params.id)) return res.status(403).json({ error: 'Erreur Lili (403) : Tu y as pas accès hihi !' });
  if (!banner || !banner.startsWith('data:image/')) return res.status(400).json({ error: 'Image invalide.' });
  const player = pQ.getById.get(Number(req.params.id));
  const isGif = /^data:image\/gif;base64,/i.test(banner);
  const isAdminTier = isAdminPlayer(player);
  const maxBytes = isAdminTier ? Number.MAX_SAFE_INTEGER : (isGif && isVipPlayer(player) ? 5 * 1024 * 1024 : 4 * 1024 * 1024);
  const approxBytes = Math.ceil((banner.length - banner.indexOf(',') - 1) * 3 / 4);
  if (isGif && !isVipPlayer(player) && !isAdminTier) {
    return res.status(403).json({ error: 'Les GIF sont reserves aux VIP.' });
  }
  const remaining = isGif ? getVipMediaRemainingMs(player) : 0;
  if (remaining > 0) {
    return res.status(429).json({ error: `Changement GIF disponible dans ${formatCooldownHours(remaining)}.` });
  }
  if (approxBytes > maxBytes) {
    return res.status(413).json({ error: isGif ? 'GIF trop lourd (max 5MB).' : 'Banniere trop lourde (max 4MB).' });
  }
  pQ.updateBanner.run({ banner, id: Number(req.params.id) });
  if (isGif) pQ.updateVipMediaChangedAt.run({ changedAt: Date.now(), id: Number(req.params.id) });
  const _pBanner = pQ.getById.get(Number(req.params.id));
  WH.wlogBanner(_pBanner?.pseudo || req.params.id, req.params.id, Math.round(banner.length / 1024));
  res.json({ ok: true });
});

app.patch('/api/players/:id/avatar', (req, res) => {
  const { avatar, token } = req.body;
  if (!token || validateSession(token) !== Number(req.params.id)) return res.status(403).json({ error: 'Erreur Lili (403) : Tu y as pas accès hihi !' });
  if (!avatar || !avatar.startsWith('data:image/'))
    return res.status(400).json({ error: 'Image invalide.' });
  const player = pQ.getById.get(Number(req.params.id));
  const isGif = /^data:image\/gif;base64,/i.test(avatar);
  const isAdminTier = isAdminPlayer(player);
  const maxBytes = isAdminTier ? Number.MAX_SAFE_INTEGER : (isGif && isVipPlayer(player) ? 5 * 1024 * 1024 : 2 * 1024 * 1024);
  const approxBytes = Math.ceil((avatar.length - avatar.indexOf(',') - 1) * 3 / 4);
  if (isGif && !isVipPlayer(player) && !isAdminTier) {
    return res.status(403).json({ error: 'Les GIF sont reserves aux VIP.' });
  }
  const remaining = isGif ? getVipMediaRemainingMs(player) : 0;
  if (remaining > 0) {
    return res.status(429).json({ error: `Changement GIF disponible dans ${formatCooldownHours(remaining)}.` });
  }
  if (approxBytes > maxBytes) {
    return res.status(413).json({ error: isGif ? 'GIF trop lourd (max 5MB).' : 'Image trop lourde (max 2MB).' });
  }
  pQ.updateAvatar.run({ avatar, id: Number(req.params.id) });
  if (isGif) pQ.updateVipMediaChangedAt.run({ changedAt: Date.now(), id: Number(req.params.id) });
  const _pAvatar = pQ.getById.get(Number(req.params.id));
  WH.wlogAvatar(_pAvatar?.pseudo || req.params.id, req.params.id, Math.round(avatar.length / 1024));
  res.json({ ok: true });
});

app.patch('/api/players/:id/token-emoji', (req, res) => {
  const { image, token } = req.body;
  const id = Number(req.params.id);
  if (!token || validateSession(token) !== id) return res.status(403).json({ error: 'Non autorise.' });
  const player = pQ.getById.get(id);
  if (!isVipPlusPlayer(player) && !isAdminPlayer(player)) return res.status(403).json({ error: 'Reserve au VIP+.' });
  if (!image || !/^data:image\/(png|jpeg|jpg|webp);base64,/i.test(image)) {
    return res.status(400).json({ error: 'Image invalide.' });
  }
  const remaining = getVipMediaRemainingMs(player);
  if (remaining > 0) {
    return res.status(429).json({ error: `Emoji perso disponible dans ${formatCooldownHours(remaining)}.` });
  }
  const approxBytes = Math.ceil((image.length - image.indexOf(',') - 1) * 3 / 4);
  if (!isAdminPlayer(player) && approxBytes > 1024 * 1024) {
    return res.status(413).json({ error: 'Emoji perso trop lourd (max 1MB).' });
  }
  pQ.updateTokenEmojiImage.run({ image, id });
  pQ.updateVipMediaChangedAt.run({ changedAt: Date.now(), id });
  res.json({ ok: true });
});

app.patch('/api/players/:id/avatar-decoration', (req, res) => {
  const { image, token } = req.body;
  const id = Number(req.params.id);
  if (!token || validateSession(token) !== id) return res.status(403).json({ error: 'Non autorise.' });
  const player = pQ.getById.get(id);
  if (!isVipPlusPlayer(player) && !isAdminPlayer(player)) return res.status(403).json({ error: 'Reserve au VIP+.' });
  const nextDecoration = String(image || '').trim();
  const isPreset = getAvatarDecorationPaths().includes(nextDecoration);
  const isInlineImage = /^data:image\/(png|jpeg|jpg|webp);base64,/i.test(nextDecoration);
  if (nextDecoration && !isPreset && !isInlineImage) {
    return res.status(400).json({ error: 'Image invalide.' });
  }
  const remaining = getAvatarDecorationRemainingMs(player);
  if (remaining > 0) {
    return res.status(429).json({ error: `Decoration avatar disponible dans ${formatCooldownHours(remaining)}.` });
  }
  const approxBytes = isInlineImage ? Math.ceil((nextDecoration.length - nextDecoration.indexOf(',') - 1) * 3 / 4) : 0;
  if (!isAdminPlayer(player) && isInlineImage && approxBytes > 1024 * 1024) {
    return res.status(413).json({ error: 'Decoration trop lourde (max 1MB).' });
  }
  pQ.updateAvatarDecoration.run({ image: nextDecoration, id });
  pQ.updateAvatarDecorationChangedAt.run({ changedAt: Date.now(), id });
  res.json({ ok: true });
});

app.patch('/api/players/:id/profile-banner', (req, res) => {
  const { image, token } = req.body;
  const id = Number(req.params.id);
  if (!token || validateSession(token) !== id) return res.status(403).json({ error: 'Non autorise.' });
  const player = pQ.getById.get(id);
  if (!isPersoPlayer(player) && !isAdminPlayer(player)) return res.status(403).json({ error: 'Reserve au pack Perso.' });
  const nextBanner = String(image || '').trim();
  const isPreset = nextBanner === '' || getProfileBannerPaths().includes(nextBanner);
  if (!isPreset) {
    return res.status(400).json({ error: 'Banniere invalide.' });
  }
  const remaining = getProfileBannerRemainingMs(player);
  if (remaining > 0 && nextBanner !== String(player?.profile_banner || '')) {
    return res.status(429).json({ error: `Banniere pseudo disponible dans ${formatCooldownHours(remaining)}.` });
  }
  pQ.updateProfileBanner.run({ image: nextBanner, id });
  pQ.updateProfileBannerChangedAt.run({ changedAt: Date.now(), id });
  res.json({ ok: true });
});

app.patch('/api/players/:id/queue-music', (req, res) => {
  const { music, token } = req.body;
  const id = Number(req.params.id);
  if (!token || validateSession(token) !== id) return res.status(403).json({ error: 'Non autorise.' });
  const player = pQ.getById.get(id);
  if (!isPersoPlayer(player) && !isAdminPlayer(player)) {
    return res.status(403).json({ error: 'Reserve au grade Perso.' });
  }
  const nextMusic = String(music || '').trim();
  const allowed = getQueueMusicPaths().map(entry => entry.src);
  if (nextMusic && !allowed.includes(nextMusic)) {
    return res.status(400).json({ error: 'Musique invalide.' });
  }
  pQ.updateQueueMusic.run({ music: nextMusic, id });
  res.json({ ok: true, queue_music: nextMusic });
});

// Autocomplete pseudo AAaAa AaaAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAA min 3 chars, max 8 rAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAAsultats, exclu bots et supprimAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAAs
app.get('/api/players/search', (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    if (q.length < 3) return res.json([]);
    // Autoriser alphanum + _ + - + . (suffisant, pas de regex bloquante)
    if (q.length > 20) return res.json([]);
    const rows = db.prepare(`
      SELECT id, pseudo, elo, avatar, color, profile_banner
      FROM players
      WHERE pseudo LIKE ? COLLATE NOCASE
        AND deleted = 0
        AND is_guest = 0
      ORDER BY elo DESC LIMIT 8
    `).all(q.replace(/%/g, '') + '%');
    res.json(rows.map(p => ({ id: p.id, pseudo: p.pseudo, elo: p.elo, avatar: p.avatar, color: p.color, profile_banner: p.profile_banner || '' })));
  } catch(e) {
    console.error('[search]', e.message);
    res.json([]);
  }
});

app.post('/api/duels/challenge', security.routeGuard('duel'), (req, res) => {
  try {
    const token = String(req.body?.token || '');
    const gameType = String(req.body?.gameType || 'ranked') === 'friendly' ? 'friendly' : 'ranked';
    const senderId = validateSession(token);
    if (!senderId) return res.status(401).json({ error: gameType === 'friendly' ? 'Session invite invalide.' : 'Session invalide.' });

    const targetId = Number(req.body?.targetId || 0);
    if (!targetId) return res.status(400).json({ error: 'Joueur cible introuvable.' });
    if (targetId === senderId) return res.status(400).json({ error: 'Tu ne peux pas te défier toi-même.' });

    const sender = getPlayerRecord(senderId);
    const target = pQ.getById.get(targetId);
    if (!sender || sender.deleted) return res.status(404).json({ error: 'Ton profil est introuvable.' });
    if (!target || target.deleted) return res.status(404).json({ error: 'Joueur cible introuvable.' });

    const targetSockets = getOnlineSocketsForPlayer(targetId);
    if (!targetSockets.length) return res.status(400).json({ error: `${target.pseudo} n est pas connecté actuellement.` });
    if (playerIsAlreadyPlaying(senderId) || playerIsAlreadyPlaying(targetId)) {
      return res.status(400).json({ error: 'Un des deux joueurs est déjà en partie.' });
    }

    const duplicate = [...duelChallenges.values()].find(challenge =>
      challenge.status === 'pending' &&
      challenge.senderId === senderId &&
      challenge.targetId === targetId &&
      String(challenge.gameType || 'ranked') === gameType &&
      Date.now() - Number(challenge.createdAt || 0) < 60_000
    );
    if (duplicate) {
      return res.status(400).json({ error: 'Un duel est déjà en attente pour ce joueur.' });
    }

    const payload = createDuelChallenge({ senderId, targetId, mode: 'direct', ttlMs: 90_000, gameType });

    const freshSender = sanitize(sender);
    targetSockets.forEach(socket => {
      socket.emit('duel_invite', {
        id: payload.id,
        sender: {
          id: freshSender.id,
          pseudo: freshSender.pseudo,
          elo: Number(freshSender.elo || 0),
          color: freshSender.color || '#ff2d55',
          avatar: freshSender.avatar || '',
        },
      });
    });

    getOnlineSocketsForPlayer(senderId).forEach(socket => {
      socket.emit('duel_invite_sent', {
        id: payload.id,
        target: {
          id: target.id,
          pseudo: target.pseudo,
          elo: Number(target.elo || 0),
          color: target.color || '#85EBFF',
          avatar: target.avatar || '',
        },
      });
    });

    res.json({
      ok: true,
      challenge: serializeDuelChallenge(req, payload, sender, target),
    });
  } catch (error) {
    console.error('[DUEL] challenge:', error.message);
    res.status(500).json({ error: 'Impossible d envoyer le duel.' });
  }
});

app.post('/api/duels/link', security.routeGuard('duel'), (req, res) => {
  try {
    const gameType = String(req.body?.gameType || 'ranked') === 'friendly' ? 'friendly' : 'ranked';
    const token = String(req.body?.token || '');
    const senderId = validateSession(token);
    if (!senderId) return res.status(401).json({ error: gameType === 'friendly' ? 'Session invite invalide.' : 'Session invalide.' });

    const sender = getPlayerRecord(senderId);
    if (!sender || sender.deleted) return res.status(404).json({ error: 'Ton profil est introuvable.' });
    if (playerIsAlreadyPlaying(senderId)) return res.status(400).json({ error: 'Tu es deja en partie.' });

    const duplicate = [...duelChallenges.values()].find(challenge =>
      challenge.status === 'pending' &&
      challenge.mode === 'link' &&
      String(challenge.gameType || 'ranked') === gameType &&
      challenge.senderId === senderId &&
      Date.now() - Number(challenge.createdAt || 0) < 15 * 60_000
    );
    const challenge = duplicate || createDuelChallenge({ senderId, mode: 'link', ttlMs: 15 * 60_000, gameType });
    res.json({ ok: true, challenge: serializeDuelChallenge(req, challenge, sender) });
  } catch (error) {
    console.error('[DUEL] link:', error.message);
    res.status(500).json({ error: 'Impossible de generer le lien de duel.' });
  }
});

app.post('/api/duels/:id/guest-session', security.routeGuard('duel'), (req, res) => {
  try {
    const challenge = duelChallenges.get(String(req.params.id || ''));
    if (!challenge || challenge.status !== 'pending') {
      return res.status(404).json({ error: 'Ce duel n est plus disponible.' });
    }
    if (String(challenge.gameType || 'ranked') !== 'friendly') {
      return res.status(400).json({ error: 'Seuls les duels amicaux acceptent le mode invite.' });
    }
    const guestAuth = createGuestPlayerSession();
    res.json({ ok: true, ...guestAuth });
  } catch (error) {
    console.error('[DUEL] guest-session:', error.message);
    res.status(500).json({ error: 'Impossible de preparer le mode invite.' });
  }
});

app.get('/api/duels/:id', (req, res) => {
  const challenge = duelChallenges.get(String(req.params.id || ''));
  if (!challenge) return res.status(404).json({ error: 'Duel introuvable.' });
  const sender = getPlayerRecord(Number(challenge.senderId || 0));
  const target = challenge.targetId ? getPlayerRecord(Number(challenge.targetId || 0)) : null;
  if (!sender || sender.deleted) return res.status(404).json({ error: 'Duel introuvable.' });
  res.json({
    ok: true,
    challenge: serializeDuelChallenge(req, challenge, sender, target),
  });
});

app.post('/api/duels/:id/accept', security.routeGuard('duel'), (req, res) => {
  try {
    const token = String(req.body?.token || '');
    const accepterId = validateSession(token);
    if (!accepterId) return res.status(401).json({ error: 'Session invalide.' });

    const challenge = duelChallenges.get(String(req.params.id || ''));
    if (!challenge || challenge.status !== 'pending') {
      return res.status(404).json({ error: 'Ce duel n est plus disponible.' });
    }

    const accepted = acceptDuelChallenge(challenge, accepterId);
    if (accepted.error) return res.status(400).json({ error: accepted.error });

    res.json({
      ok: true,
      challenge: serializeDuelChallenge(req, challenge, accepted.sender, accepted.target),
    });
  } catch (error) {
    console.error('[DUEL] accept:', error.message);
    res.status(500).json({ error: 'Impossible d accepter ce duel.' });
  }
});

app.get('/api/players/by-pseudo/:pseudo', (req, res) => {
  const p = pQ.getByPseudo.get(req.params.pseudo);
  if (!p) return res.status(404).json({ error: 'Introuvable' });
  res.json(sanitize(p));
});

app.get('/api/players/:id', (req, res) => {
  const player = pQ.getById.get(Number(req.params.id));
  if (!player || (player.deleted && player.id !== BOT_PLAYER_ID)) return res.status(404).json({ error: 'Compte supprimAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAA' });
  // Pour le bot, montrer toutes ses parties ; pour les humains, exclure les parties bot
  const games = player.id === BOT_PLAYER_ID
    ? db.prepare(`
        SELECT g.*,
          p1.pseudo AS p1_pseudo, p1.elo AS p1_elo,
          p2.pseudo AS p2_pseudo, p2.elo AS p2_elo,
          w.pseudo AS winner_pseudo,
          COALESCE(g.p1_color, p1.color) AS p1_color,
          COALESCE(g.p2_color, p2.color) AS p2_color
        FROM games g
        JOIN players p1 ON g.player1_id = p1.id
        JOIN players p2 ON g.player2_id = p2.id
        LEFT JOIN players w ON g.winner_id = w.id
        WHERE (g.player1_id = ? OR g.player2_id = ?) AND g.status = 'finished'
        ORDER BY g.finished_at DESC LIMIT 25
      `).all(player.id, player.id)
    : gQ.getForPlayer.all(player.id, player.id, BOT_PLAYER_ID, BOT_PLAYER_ID);
  const following  = fQ.getFollowing.all(player.id);
  const followers  = fQ.getFollowers.all(player.id);

  // PrAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAAcision moyenne (parties analysAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAAes uniquement)
  const accRow = db.prepare(`
    SELECT
      AVG(CASE WHEN player1_id = ? AND p1_accuracy IS NOT NULL THEN p1_accuracy END) AS as_p1,
      AVG(CASE WHEN player2_id = ? AND p2_accuracy IS NOT NULL THEN p2_accuracy END) AS as_p2,
      COUNT(CASE WHEN player1_id = ? AND p1_accuracy IS NOT NULL THEN 1 END) +
      COUNT(CASE WHEN player2_id = ? AND p2_accuracy IS NOT NULL THEN 1 END) AS analysed_count
    FROM games WHERE (player1_id = ? OR player2_id = ?) AND status = 'finished'
  `).get(player.id, player.id, player.id, player.id, player.id, player.id);

  let avg_accuracy = null;
  if (accRow && accRow.analysed_count > 0) {
    const vals = [accRow.as_p1, accRow.as_p2].filter(v => v != null);
    avg_accuracy = vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null;
  }

  const p = sanitize(player);
  res.json({ player: { ...p, rank: getRank(p.elo), avg_accuracy, analysed_count: accRow?.analysed_count || 0 }, games, following, followers });
});

app.get('/api/players/:id/tournaments', (req, res) => {
  const playerId = Number(req.params.id);
  const rows = db.prepare(`
    SELECT
      t.id, t.public_id, t.name, t.status, t.starts_at, t.ends_at, t.duration_minutes, t.move_time_seconds,
      t.reward_1, t.reward_2, t.reward_3, p.pseudo AS creator_pseudo,
      (SELECT COUNT(*) FROM tournament_players tp2 WHERE tp2.tournament_id = t.id) AS participants,
      tp.score, tp.wins, tp.losses, tp.draws, tp.streak
    FROM tournament_players tp
    JOIN tournaments t ON t.id = tp.tournament_id
    JOIN players p ON p.id = t.created_by
    WHERE tp.player_id = ?
    ORDER BY
      CASE t.status WHEN 'active' THEN 0 ELSE 1 END,
      t.ends_at DESC
  `).all(playerId);
  res.json({
    tournaments: rows.map((row) => ({
      id: row.id,
      public_id: row.public_id || `TRN-${row.id}`,
      name: row.name,
      status: row.status,
      starts_at: Number(row.starts_at || 0),
      ends_at: Number(row.ends_at || 0),
      duration_minutes: Number(row.duration_minutes || 0),
      move_time_seconds: Number(row.move_time_seconds || 0),
      creator_pseudo: row.creator_pseudo || '',
      participants: Number(row.participants || 0),
      place: Math.max(1, tQ.standings.all(Number(row.id)).findIndex(entry => Number(entry.player_id) === playerId) + 1) || null,
      score: Number(row.score || 0),
      wins: Number(row.wins || 0),
      losses: Number(row.losses || 0),
      draws: Number(row.draws || 0),
      streak: Number(row.streak || 0),
      rewards: [Number(row.reward_1 || 0), Number(row.reward_2 || 0), Number(row.reward_3 || 0)],
    })),
  });
});

// Follow / Unfollow
app.post('/api/players/:id/follow', (req, res) => {
  const { followerId } = req.body;
  if (!followerId) return res.status(400).json({ error: 'followerId requis' });
  const target = Number(req.params.id);
  if (followerId === target) return res.status(400).json({ error: 'Tu ne peux pas te suivre toi-mAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAAme.' });
  fQ.follow.run(followerId, target);
  res.json({ following: true, followers: fQ.countFollowers.get(target).n });
});

app.delete('/api/players/:id/follow', (req, res) => {
  const { followerId } = req.body;
  if (!followerId) return res.status(400).json({ error: 'followerId requis' });
  const target = Number(req.params.id);
  fQ.unfollow.run(followerId, target);
  res.json({ following: false, followers: fQ.countFollowers.get(target).n });
});

app.get('/api/players/:id/follow-status', (req, res) => {
  const { viewerId } = req.query;
  const target = Number(req.params.id);
  const isFollowing = viewerId ? !!fQ.isFollowing.get(Number(viewerId), target) : false;
  const followers   = fQ.countFollowers.get(target).n;
  const following   = fQ.countFollowing.get(target).n;
  res.json({ isFollowing, followers, following });
});

// AAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAA Sauvegarde analyse complAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAAte AAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAA
app.post('/api/games/:id/analysis', (req, res) => {
  const { results, evalHistory, accuracy } = req.body;
  const gameId = Number(req.params.id);
  if (!gameId) return res.status(400).json({ error: 'ID invalide' });
  const data = JSON.stringify({ results, evalHistory, accuracy });
  rQ.saveAnalysis.run(data, gameId);
  // Sauvegarder aussi la prAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAAcision
  if (accuracy && typeof accuracy.p1 === 'number') {
    rQ.setAccuracy.run(accuracy.p1, accuracy.p2, gameId);
  }
  res.json({ ok: true });
});

// Route GET pour rAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAAcupAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAArer l'analyse existante
app.get('/api/games/:id/analysis', (req, res) => {
  const gameId = Number(req.params.id);
  const game = db.prepare('SELECT analysis_data FROM games WHERE id = ?').get(gameId);
  if (!game || !game.analysis_data) return res.json({ analysis: null });
  try {
    res.json({ analysis: JSON.parse(game.analysis_data) });
  } catch(e) {
    res.json({ analysis: null });
  }
});

// AAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAA Sauvegarde prAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAAcision d'analyse AAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAA
app.post('/api/games/:id/accuracy', (req, res) => {
  const { p1_accuracy, p2_accuracy } = req.body;
  const gameId = Number(req.params.id);
  if (!gameId) return res.status(400).json({ error: 'ID invalide' });
  if (typeof p1_accuracy !== 'number' || typeof p2_accuracy !== 'number')
    return res.status(400).json({ error: 'Valeurs invalides' });
  rQ.setAccuracy.run(p1_accuracy, p2_accuracy, gameId);
  res.json({ ok: true });
});

// AAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAA Statut en ligne AAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAA
app.get('/api/players/:id/status', (req, res) => {
  const id = Number(req.params.id);
  const player = pQ.getById.get(id);
  if (!player) return res.status(404).json({ error: 'Introuvable' });

  const isOnline = onlineSockets.has(id) && onlineSockets.get(id).size > 0;
  res.json({
    online:    isOnline,
    last_seen: player.last_seen || null,
  });
});

// AAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAA Discord info + dAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAAliaison AAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAA
// Infos Discord enrichies du joueur connectAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAA
app.get('/api/me/discord-info', (req, res) => {
  const token = req.headers['x-session-token'];
  const playerId = token ? validateSession(token) : null;
  if (!playerId) return res.status(401).json({ error: 'Non authentifiAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAA' });

  const player = pQ.getById.get(playerId);
  if (!player || !player.discord_id) return res.json({ discord: null });

  let info = null;
  try { info = player.discord_info ? JSON.parse(player.discord_info) : null; } catch(e) {}

  // Badges Discord (public_flags)
  const FLAGS = {
    1:       'Staff Discord',
    2:       'Partenaire Discord',
    4:       'HypeSquad Events',
    8:       'Bug Hunter Lvl 1',
    64:      'HypeSquad Bravery',
    128:     'HypeSquad Brilliance',
    256:     'HypeSquad Balance',
    512:     'Supporter prAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAAcoce',
    131072:  'Bug Hunter Lvl 2',
    4194304: 'DAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAAveloppeur actif',
    16777216:'Mod Alumni',
  };
  const NITRO_LABELS = { 0: 'Aucun', 1: 'Nitro Classic', 2: 'Nitro', 3: 'Nitro Basic' };

  const badges = [];
  if (info?.public_flags) {
    for (const [flag, label] of Object.entries(FLAGS)) {
      if (info.public_flags & Number(flag)) badges.push(label);
    }
  }

  res.json({
    discord: info ? {
      ...info,
      nitro_label:  NITRO_LABELS[info.premium_type] || 'Aucun',
      badges,
      is_boosting:  !!info.boosting_since,
      on_server:    info.server_joined !== null,
      account_age_days: info.created_at
        ? Math.floor((Date.now() - new Date(info.created_at)) / 86400000)
        : null,
    } : { id: player.discord_id, username: 'Inconnu', linked_at: null },
  });
});

// Demander un code de dAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAAliaison Discord AAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAA AAaAasAAAAAAAAasAA...AAasAAAAAAAAasAA...AAasAA envoi DM via bot
app.post('/api/discord/unlink/request', async (req, res) => {
  const token = req.headers['x-session-token'];
  const playerId = token ? validateSession(token) : null;
  if (!playerId) return res.status(401).json({ error: 'Non authentifiAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAA' });

  const player = pQ.getById.get(playerId);
  if (!player?.discord_id) return res.status(400).json({ error: 'Aucun Discord liAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAA' });

  const { botToken } = discordConfig();
  if (!botToken) return res.status(503).json({ error: 'Bot Discord indisponible' });

  // GAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAAnAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAArer code 6 chiffres
  const code6   = String(Math.floor(100000 + Math.random() * 900000));
  const expires = Date.now() + 10 * 60 * 1000; // 10 min
  rQ.cleanUnlink.run(Date.now());
  rQ.insertUnlink.run(playerId, code6, expires);

  try {
    // Ouvrir DM
    const dmRes = await fetch('https://discord.com/api/v10/users/@me/channels', {
      method: 'POST',
      headers: { 'Authorization': 'Bot ' + botToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({ recipient_id: player.discord_id }),
    });
    const dmData = await dmRes.json();
    if (!dmData.id) return res.status(500).json({ error: 'Impossible d\'ouvrir le DM' });

    // Envoyer code
    await fetch(`https://discord.com/api/v10/channels/${dmData.id}/messages`, {
      method: 'POST',
      headers: { 'Authorization': 'Bot ' + botToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: [
          '**Puissance 4 - Deliaison Discord**',
          '',
          `Bonjour **${player.pseudo}** !`,
          '',
          'Tu as demande a delier ton compte Discord de ton compte Puissance 4.',
          '',
          'Ton code de confirmation :',
          '```',
          code6,
          '```',
          'Ce code expire dans **10 minutes**.',
          '',
          "_Si tu n'es pas a l'origine de cette demande, ignore ce message. Ton compte restera lie._",
        ].join('\n'),
      }),
    });

    res.json({ ok: true });
  } catch(e) {
    console.error('[UNLINK REQUEST]', e);
    res.status(500).json({ error: 'Erreur envoi DM' });
  }
});

// Confirmer la dAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAAliaison avec le code
app.post('/api/discord/unlink/confirm', (req, res) => {
  const token = req.headers['x-session-token'];
  const playerId = token ? validateSession(token) : null;
  if (!playerId) return res.status(401).json({ error: 'Non authentifiAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAA' });

  const { code } = req.body;
  if (!code) return res.status(400).json({ error: 'Code manquant' });

  const row = rQ.getUnlink.get(playerId, String(code).trim(), Date.now());
  if (!row) return res.status(400).json({ error: 'Code invalide ou expirAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAA' });

  const player = pQ.getById.get(playerId);
  rQ.markUnlink.run(row.id);
  rQ.clearDiscord.run(playerId);
  pQ.updateVip.run({ is_vip: 0, id: playerId });
  pQ.updateVipPlus.run({ is_vip_plus: 0, id: playerId });
  pQ.updateVipExpiry.run({ vip_expires_at: null, id: playerId });
  if (player && player.role !== 'user') {
    pQ.updateRole.run({ role: 'user', id: playerId });
  }
  revokeAdminSessionsForPlayer(playerId);

  res.json({ ok: true });
});

app.get('/api/games/:id', (req, res) => {
  const game = gQ.getById.get(Number(req.params.id));
  if (!game) return res.status(404).json({ error: 'Introuvable' });
  res.json(game);
});

app.get('/api/games/:id/replay-view', (req, res) => {
  // Endpoint appelAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAA par replay.html au chargement
  const game = gQ.getById?.get(Number(req.params.id));
  if (!game) return res.json({ ok: false });
  const _watcherId = validateSession(req.headers['x-token'] || req.query.token);
  const _watcher   = _watcherId ? pQ.getById.get(_watcherId) : null;
  WH.wlogReplay(_watcher?.pseudo || 'Anonyme', req.params.id);
  res.json({ ok: true });
});

app.get('/api/games/:id/moves', (req, res) => {
  const game = gQ.getById.get(Number(req.params.id));
  if (!game) return res.status(404).json({ error: 'Introuvable' });
  res.json({ game, moves: mQ.getByGame.all(Number(req.params.id)) });
});

// AAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAA Bot replay (sans stats ELO) AAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAA
app.post('/api/bot-replay', (req, res) => {
  try {
  const { token, moves, winner, duration, p1Color, p2Color, botName, difficulty } = req.body;
  const playerId = token ? validateSession(token) : null;

  // RAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAAcupAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAArer le vrai joueur pour sa couleur et forme perso
  const p1 = playerId ? pQ.getById.get(playerId) : null;
  const realP1Color = p1?.color || p1Color || '#ff2d55';
  const realP1Shape = p1?.shape || 'circle';

  const botPlayerId = BOT_PLAYER_ID;
  const p1Id     = playerId || botPlayerId;
  const isDraw   = winner === null;
  const winnerId = isDraw ? null : (winner === 1 ? p1Id : botPlayerId);
  const loserId  = isDraw ? null : (winner === 1 ? botPlayerId : p1Id);

  // AAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAA Calcul ELO AAaAa AaaAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAA seulement le bot est impactAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAA AAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAA
  const botPlayer = pQ.getById.get(botPlayerId);
  const botColor  = botPlayer?.color || '#ffd60a';
  const botShape  = botPlayer?.shape || 'circle';
  const botElo    = botPlayer?.elo ?? 1000;

  // Calcul ELO bot stable par difficulte, sans prendre en compte l ELO humain.
  // L objectif est d eviter les deltas absurdes contre des comptes tres bas.
  function randInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
  let botDelta = 0;
  const botEloRanges = {
    easy: {
      win: [16, 24],
      draw: [4, 8],
      loss: [-4, -1],
    },
    medium: {
      win: [8, 14],
      draw: [1, 4],
      loss: [-10, -5],
    },
    hard: {
      win: [4, 8],
      draw: [-2, 2],
      loss: [-18, -10],
    },
  };
  const rules = botEloRanges[difficulty] || botEloRanges.medium;
  if (isDraw) {
    botDelta = randInt(rules.draw[0], rules.draw[1]);
  } else if (winner === 2) {
    botDelta = randInt(rules.win[0], rules.win[1]);
  } else {
    botDelta = randInt(rules.loss[0], rules.loss[1]);
  }

  // Appliquer delta ELO uniquement au bot
  pQ.updateElo.run({ delta: botDelta, id: botPlayerId });
  if (isDraw)        { pQ.draw.run(botPlayerId); }
  else if (winner === 2) { pQ.win.run(botPlayerId); }
  else               { pQ.loss.run(botPlayerId); }

  // Si pas de joueur connectAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAA, on abandonne proprement (pas de replay sauvegardAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAA)
  if (!playerId) return res.status(200).json({ gameId: null, reason: 'not_logged_in' });

  // VAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAArification FK
  if (!pQ.getById.get(p1Id))        throw new Error(`player1_id=${p1Id} introuvable`);
  if (!pQ.getById.get(botPlayerId))  throw new Error(`botPlayerId=${botPlayerId} introuvable`);

  const info = db.prepare(`
    INSERT INTO games (player1_id, player2_id, winner_id, status, move_count, duration, p1_color, p2_color, p1_shape, p2_shape, elo_p1, elo_p2)
    VALUES (?, ?, ?, 'finished', ?, ?, ?, ?, ?, ?, 0, ?)
  `).run(
    p1Id, botPlayerId, winnerId,
    moves?.length || 0, duration || 0,
    realP1Color, botColor,
    realP1Shape, botShape,
    botDelta
  );
  const gameId = info.lastInsertRowid;

  // InsAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAArer les coups avec calcul de la row (rejouer la grille)
  if (Array.isArray(moves)) {
    const insertMove = db.prepare(`INSERT INTO moves (game_id, player_id, col, row, move_number) VALUES (?,?,?,?,?)`);
    // Reconstruire la grille pour calculer la row de chaque coup
    const grid = Array.from({length: 6}, () => Array(7).fill(0));
    moves.forEach((col, i) => {
      const pid = i % 2 === 0 ? p1Id : botPlayerId;
      // Trouver la row la plus basse disponible
      let row = -1;
      for (let r = 5; r >= 0; r--) {
        if (grid[r][col] === 0) { row = r; break; }
      }
      if (row === -1) return; // colonne pleine, ignorer
      grid[row][col] = i % 2 === 0 ? 1 : 2;
      insertMove.run(gameId, pid, col, row, i + 1);
    });
  }

  const newBotElo = (pQ.getById.get(botPlayerId))?.elo ?? botElo + botDelta;
  res.json({ gameId, botDelta, newBotElo });
  } catch(err) {
    console.error('[bot-replay]', err.message, err.stack);
    res.status(500).json({ error: err.message });
  }
});

// ID du bot systAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAAme (pour affichage dans les replays)
// RafraAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAAchir les rAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAAles Discord d'un joueur connectAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAA
app.post('/api/players/:id/refresh-discord', async (req, res) => {
  const { token } = req.body;
  const id = Number(req.params.id);
  if (!token || validateSession(token) !== id) return res.status(403).json({ error: 'Erreur Lili (403) : Tu y as pas accès hihi !' });
  const player = pQ.getById.get(id);
  if (!player?.discord_id) return res.status(400).json({ error: 'Pas de compte Discord liAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAA.' });
  try {
    const { botToken: bt } = discordConfig();
    const snapshot = await fetchDiscordMemberSnapshot(player.discord_id, bt);
    if (!snapshot) {
      rQ.clearDiscord.run(id);
      pQ.updateRole.run({ role: 'user', id });
      pQ.updateVip.run({ is_vip: 0, id });
      pQ.updateVipPlus.run({ is_vip_plus: 0, id });
      pQ.updatePerso.run({ is_perso: 0, id });
      pQ.updateVipExpiry.run({ vip_expires_at: null, id });
      revokeAdminSessionsForPlayer(id);
      return res.status(404).json({ error: 'Membre introuvable sur le serveur.', unlinked: true, role: 'user' });
    }
    const { memberInfo, server_roles_rich, newRole } = snapshot;
    if (newRole !== player.role) pQ.updateRole.run({ role: newRole, id });
    const vipNow = hasVipRoleIds(memberInfo.roles || []) ? 1 : 0;
    const vipPlusNow = hasVipPlusRoleIds(memberInfo.roles || []) ? 1 : 0;
    const persoNow = hasPersoRoleIds(memberInfo.roles || []) ? 1 : 0;
    if (vipNow !== Number(player.is_vip || 0)) pQ.updateVip.run({ is_vip: vipNow, id });
    if (vipPlusNow !== Number(player.is_vip_plus || 0)) pQ.updateVipPlus.run({ is_vip_plus: vipPlusNow, id });
    if (persoNow !== Number(player.is_perso || 0)) pQ.updatePerso.run({ is_perso: persoNow, id });
    if (!vipNow && !vipPlusNow && Number(player.vip_expires_at || 0)) pQ.updateVipExpiry.run({ vip_expires_at: null, id });
    // Mettre AAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAA  jour discord_info
    const existing = player.discord_info ? JSON.parse(player.discord_info) : {};
    const updated = {
      ...existing,
      server_roles: server_roles_rich,
      server_nick: memberInfo.nick || existing.server_nick,
      server_joined: memberInfo.joined_at || existing.server_joined || null,
      boosting_since: memberInfo.premium_since || null,
    };
    rQ.setDiscord.run(player.discord_id, JSON.stringify(updated), id);
    const fresh = pQ.getById.get(id);
    res.json({ ok: true, roles: server_roles_rich, role: newRole, is_vip: vipNow, is_vip_plus: vipPlusNow, is_perso: persoNow, vip_expires_at: Number(fresh?.vip_expires_at || 0) || null });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/bot-id', (_, res) => {
  const bot = pQ.getById.get(BOT_PLAYER_ID);
  res.json({
    id: BOT_PLAYER_ID,
    pseudo: BOT_PSEUDO,
    color: bot?.color || '#ffd60a',
    shape: bot?.shape || 'circle',
    avatar: bot?.avatar || BOT_AVATAR,
    avatar_decoration: bot?.avatar_decoration || '',
    profile_banner: bot?.profile_banner || '',
    token_emoji_image: bot?.token_emoji_image || '',
    color_secondary: bot?.color_secondary || ''
  });
});

// AAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAA Boost VIP individuel AAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAA
// Activation : 1h, 1x par jour (reset AAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAA  minuit)
app.post('/api/players/:id/vip-boost', (req, res) => {
  const { token } = req.body;
  const id = Number(req.params.id);
  if (!token || validateSession(token) !== id) return res.status(403).json({ error: 'Erreur Lili (403) : Tu y as pas accès hihi !' });

  const player = pQ.getById.get(id);
  if (!player) return res.status(404).json({ error: 'Joueur introuvable.' });
  const config = getPremiumBoostConfig(player);
  if (!config) return res.status(403).json({ error: 'Boost reserve aux packs premium.' });

  const now = Date.now();
  const currentBoost = vipQ.getActive.get(id, now);
  if (currentBoost) {
    const remaining = Math.round((currentBoost.expires_at - now) / 60000);
    return res.status(400).json({ error: `Boost actif encore ${remaining} minute(s).`, remaining });
  }

  if (config.daily) {
    const midnightTs = getParisMidnightTs(now);
    const usedToday = vipQ.usedToday.get(id, midnightTs);
    if (usedToday) return res.status(400).json({ error: "Boost deja utilise aujourd'hui. Reviens a minuit (heure de Paris)." });
  }

  const expiresAt = now + config.durationMs;
  vipQ.activate.run(id, now, expiresAt, config.tier, config.multiplier);
  res.json({
    ok: true,
    expiresAt,
    multiplier: config.multiplier,
    tier: config.tier,
    message: `Boost ${config.label} active pour ${Math.round(config.durationMs / 3600000)} heure(s) !`,
  });
});

// Statut du boost VIP d'un joueur
app.get('/api/players/:id/vip-boost', (req, res) => {
  const id = Number(req.params.id);
  const now = Date.now();
  const active = vipQ.getActive.get(id, now);
  const midnightTs = getParisMidnightTs(now);
  const usedToday = vipQ.usedToday.get(id, midnightTs);
  const player = pQ.getById.get(id);
  const config = getPremiumBoostConfig(player);
  res.json({
    active:     !!active,
    expiresAt:  active?.expires_at ?? null,
    usedToday:  config?.daily ? !!usedToday : false,
    remainingMs: active ? active.expires_at - now : 0,
    resetAt: midnightTs + 24 * 60 * 60 * 1000,
    multiplier: active ? Number(active.multiplier || 1) : (config?.multiplier || 1),
    tier: active ? String(active.tier || 'vip') : (config?.tier || null),
  });
});

// Liste des boosts VIP actifs (admin/modo)
app.get('/api/admin/vip-boosts', (req, res) => {
  if (!isModo(req)) return res.status(403).json({ error: 'Erreur Lili (403) : Tu y as pas accès hihi !' });
  const now = Date.now();
  const boosts = vipQ.listActive.all(now);
  res.json(boosts.map(b => ({
    playerId:  b.player_id,
    pseudo:    b.pseudo,
    elo:       b.elo,
    color:     b.color,
    avatar:    b.avatar,
    expiresAt: b.expires_at,
    remainingMin: Math.round((b.expires_at - now) / 60000),
    tier: String(b.tier || (Number(b.is_perso) === 1 ? 'perso' : Number(b.is_vip_plus) === 1 ? 'vip_plus' : 'vip')),
    multiplier: Number(b.multiplier || (Number(b.is_perso) === 1 || Number(b.is_vip_plus) === 1 ? 1.3 : 1.2)),
  })));
});

// AAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAA Revert de partie (modo/admin uniquement) AAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAA
app.post('/api/admin/games/:id/revert', (req, res) => {
  if (!isModo(req)) return res.status(403).json({ error: 'ModAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAArateurs et admins uniquement.' });

  const gameId = Number(req.params.id);
  const game   = db.prepare(`SELECT * FROM games WHERE id = ?`).get(gameId);
  if (!game) return res.status(404).json({ error: 'Partie introuvable.' });
  if (game.status !== 'finished') return res.status(400).json({ error: 'La partie n\'est pas terminAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAAe.' });
  if (game.reverted) return res.status(400).json({ error: 'Cette partie a dAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAAjAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAA  AAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAAtAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAA revertAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAAe.' });
  if (game.elo_before_p1 == null || game.elo_before_p2 == null)
    return res.status(400).json({ error: 'ELO avant partie non disponible (partie trop ancienne).' });

  const p1 = pQ.getById.get(game.player1_id);
  const p2 = pQ.getById.get(game.player2_id);
  if (!p1 || !p2) return res.status(404).json({ error: 'Joueur introuvable.' });

  try {
    // Restaurer l'ELO d'avant la partie
    db.prepare(`UPDATE players SET elo = ?, wins   = MAX(0, wins   - ?), losses = MAX(0, losses - ?), draws = MAX(0, draws - ?) WHERE id = ?`)
      .run(game.elo_before_p1,
        game.winner_id === game.player1_id ? 1 : 0,
        game.winner_id === game.player2_id ? 1 : 0,
        game.winner_id === null ? 1 : 0,
        game.player1_id);
    db.prepare(`UPDATE players SET elo = ?, wins   = MAX(0, wins   - ?), losses = MAX(0, losses - ?), draws = MAX(0, draws - ?) WHERE id = ?`)
      .run(game.elo_before_p2,
        game.winner_id === game.player2_id ? 1 : 0,
        game.winner_id === game.player1_id ? 1 : 0,
        game.winner_id === null ? 1 : 0,
        game.player2_id);

    // Marquer la partie comme revertAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAAe
    db.prepare(`UPDATE games SET reverted = 1 WHERE id = ?`).run(gameId);

    // Log admin
    const adminId = validateSession(req.headers['x-token']);
    const admin   = adminId ? pQ.getById.get(adminId) : null;
    WH.wlogAdminAction('Revert partie', `#${gameId}`, gameId,
      [['J1', `${p1.pseudo} : ${p1.elo} AAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAA AAaAasAAAAAAAAasAA...AAasAAAAAAAAasAA...AAasAA ${game.elo_before_p1}`, true],
       ['J2', `${p2.pseudo} : ${p2.elo} AAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAA AAaAasAAAAAAAAasAA...AAasAAAAAAAAasAA...AAasAA ${game.elo_before_p2}`, true],
       ['Par', admin?.pseudo || 'ModAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAArateur', false]]);

    console.log(`[REVERT] Partie #${gameId} revertAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAAe par ${admin?.pseudo || '?'}`);
    res.json({ ok: true, p1: { pseudo: p1.pseudo, eloBefore: game.elo_before_p1 }, p2: { pseudo: p2.pseudo, eloBefore: game.elo_before_p2 } });
  } catch(e) {
    console.error('[REVERT]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Route pour rAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAAcupAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAArer les parties rAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAAcentes (admin)
app.get('/api/admin/games', (req, res) => {
  if (!isModo(req)) return res.status(403).json({ error: 'Erreur Lili (403) : Tu y as pas accès hihi !' });
  const limit  = Math.min(parseInt(req.query.limit) || 50, 200);
  const offset = parseInt(req.query.offset) || 0;
  const search = req.query.search ? '%' + req.query.search.replace(/%/g,'') + '%' : null;

  const where  = search
    ? `WHERE (p1.pseudo LIKE ? OR p2.pseudo LIKE ?) AND g.status='finished'`
    : `WHERE g.status='finished'`;
  const params = search ? [search, search, limit, offset] : [limit, offset];

  const games = db.prepare(`
    SELECT g.id, g.winner_id, g.status, g.move_count, g.duration, g.finished_at,
           g.elo_p1, g.elo_p2, g.elo_before_p1, g.elo_before_p2, g.reverted, g.suspicious,
           p1.pseudo AS p1_pseudo, p1.id AS player1_id,
           p2.pseudo AS p2_pseudo, p2.id AS player2_id
    FROM games g
    JOIN players p1 ON g.player1_id = p1.id
    JOIN players p2 ON g.player2_id = p2.id
    ${where}
    ORDER BY g.finished_at DESC
    LIMIT ? OFFSET ?
  `).all(...params);

  res.json(games);
});

// AAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAA Boost ELO global AAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAA
app.get('/api/admin/boost', (req, res) => {
  if (!isModo(req)) return res.status(403).json({ error: 'Erreur Lili (403) : Tu y as pas accès hihi !' });
  const active = bQ.getActive.get();
  res.json({ active: !!(active), multiplier: active?.multiplier ?? 1 });
});
app.post('/api/admin/boost', (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Seuls les admins.' });
  const m = parseFloat(req.body.multiplier);
  if (isNaN(m) || m < 1 || m > 2) return res.status(400).json({ error: 'Entre 1.0 et 2.0.' });
  bQ.deactivateAll.run();
  if (m > 1) {
    bQ.create.run({ multiplier: m, applied_by: 'Puissance4-Booster' });
  }
  res.json({ ok: true, multiplier: m });
});

app.get('/api/admin/coin-boost', (req, res) => {
  if (!isModo(req)) return res.status(403).json({ error: 'Non autorise.' });
  const multiplier = Number(db.prepare(`SELECT value FROM config WHERE key = 'coin_boost_multiplier'`).get()?.value || 1);
  const expiresAt = Number(db.prepare(`SELECT value FROM config WHERE key = 'coin_boost_expires_at'`).get()?.value || 0);
  const now = Date.now();
  const active = expiresAt > now && multiplier > 1;
  res.json({
    active,
    multiplier: active ? multiplier : 1,
    expiresAt: active ? expiresAt : null,
    remainingMs: active ? (expiresAt - now) : 0,
  });
});

app.post('/api/admin/coin-boost', (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Seuls les admins.' });
  const multiplier = Math.ceil(Number(req.body?.multiplier || 1));
  const durationMinutes = Math.ceil(Number(req.body?.durationMinutes || 0));
  if (!Number.isFinite(multiplier) || multiplier < 1 || multiplier > 10) {
    return res.status(400).json({ error: 'Multiplicateur invalide (1 a 10).' });
  }
  if (!Number.isFinite(durationMinutes) || durationMinutes < 0 || durationMinutes > 1440) {
    return res.status(400).json({ error: 'Duree invalide (max 24h).' });
  }
  if (multiplier === 1 || durationMinutes === 0) {
    db.prepare(`INSERT INTO config (key, value) VALUES ('coin_boost_multiplier', '1') ON CONFLICT(key) DO UPDATE SET value=excluded.value`).run();
    db.prepare(`INSERT INTO config (key, value) VALUES ('coin_boost_expires_at', '0') ON CONFLICT(key) DO UPDATE SET value=excluded.value`).run();
    db.prepare(`INSERT INTO config (key, value) VALUES ('coin_boost_applied_by', '') ON CONFLICT(key) DO UPDATE SET value=excluded.value`).run();
    return res.json({ ok: true, multiplier: 1, expiresAt: null });
  }
  const expiresAt = Date.now() + durationMinutes * 60 * 1000;
  db.prepare(`INSERT INTO config (key, value) VALUES ('coin_boost_multiplier', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`).run(String(multiplier));
  db.prepare(`INSERT INTO config (key, value) VALUES ('coin_boost_expires_at', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`).run(String(expiresAt));
  db.prepare(`INSERT INTO config (key, value) VALUES ('coin_boost_applied_by', 'Puissance4-Booster') ON CONFLICT(key) DO UPDATE SET value=excluded.value`).run();
  res.json({ ok: true, multiplier, expiresAt });
});

app.post('/api/admin/system-status', (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Seuls les admins.' });
  const restarting = Boolean(req.body?.restarting);
  const message = String(req.body?.message || '').trim().slice(0, 180);
  const status = writeSystemStatus({
    restarting,
    message: restarting ? message : '',
  });
  io.emit('system_status_update', status);
  res.json({ ok: true, status });
});

app.get('/api/admin/backups', (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Seuls les admins.' });
  const files = [
    { key: 'main', label: 'Base principale', filePath: MAIN_DB_PATH },
    { key: 'wal', label: 'Journal WAL', filePath: `${MAIN_DB_PATH}-wal` },
    { key: 'shm', label: 'Memoire SHM', filePath: `${MAIN_DB_PATH}-shm` },
  ].map(entry => {
    const exists = fs.existsSync(entry.filePath);
    return {
      key: entry.key,
      label: entry.label,
      filename: path.basename(entry.filePath),
      exists,
      size: exists ? fs.statSync(entry.filePath).size : 0,
    };
  });
  res.json({ files });
});

app.get('/api/admin/backups/:key', (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Seuls les admins.' });
  const fileMap = {
    main: MAIN_DB_PATH,
    wal: `${MAIN_DB_PATH}-wal`,
    shm: `${MAIN_DB_PATH}-shm`,
  };
  const filePath = fileMap[String(req.params.key || '')];
  if (!filePath) return res.status(404).json({ error: 'Sauvegarde introuvable.' });
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Fichier indisponible.' });
  res.download(filePath, path.basename(filePath));
});

app.get('/api/leaderboard', (_, res) => {
  res.json(pQ.leaderboard.all().filter(p => p.id !== BOT_PLAYER_ID).map(p => { const s = sanitize(p); return { ...s, rank: getRank(s.elo) }; }));
});
app.get('/api/leaderboard/wins', (_, res) => {
  const q = db.prepare('SELECT * FROM players WHERE deleted = 0 AND is_guest = 0 ORDER BY wins DESC LIMIT 10');
  res.json(q.all().map(sanitize));
});
app.get('/api/site-stats', (_, res) => {
  const presence = getPresenceCounts();
  const activeGames = db.prepare(`SELECT COUNT(*) as c FROM games WHERE status='active'`).get()?.c || 0;
  const registeredPlayers = db.prepare(`SELECT COUNT(*) as c FROM players WHERE is_guest = 0`).get()?.c || 0;
  const publicTournament = getPublicActiveTournament();
  const upcomingPublicTournament = getPublicPendingTournament();
  const activeBoost = bQ.getActive.get();
  const now = Date.now();
  const coinBoostMultiplier = Number(db.prepare(`SELECT value FROM config WHERE key = 'coin_boost_multiplier'`).get()?.value || 1);
  const coinBoostExpiresAt = Number(db.prepare(`SELECT value FROM config WHERE key = 'coin_boost_expires_at'`).get()?.value || 0);
  const coinBoostAppliedByRaw = String(db.prepare(`SELECT value FROM config WHERE key = 'coin_boost_applied_by'`).get()?.value || '');
  const coinBoostActive = coinBoostExpiresAt > now && coinBoostMultiplier > 1;
  res.json({
    online: presence.onlinePlayers,
    onlinePlayers: presence.onlinePlayers,
    visitors: presence.visitors,
    totalPresent: presence.totalPresent,
    registeredPlayers,
    queue: mm?.queue?.length || 0,
    activeGames,
    publicTournament,
    upcomingPublicTournament,
    boost: activeBoost ? {
      active: true,
      multiplier: Number(activeBoost.multiplier || 1),
      appliedBy: getBoostDisplayName(activeBoost.applied_by),
    } : {
      active: false,
      multiplier: 1,
      appliedBy: '',
    },
    coinBoost: coinBoostActive ? {
      active: true,
      multiplier: coinBoostMultiplier,
      appliedBy: getBoostDisplayName(coinBoostAppliedByRaw),
      expiresAt: coinBoostExpiresAt,
    } : {
      active: false,
      multiplier: 1,
      appliedBy: '',
      expiresAt: null,
    },
  });
});

// AAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAA Socket.io AAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAA
function getStatsOverview() {
  const presence = getPresenceCounts();
  const registeredPlayers = Number(db.prepare(`SELECT COUNT(*) AS c FROM players WHERE deleted = 0 AND is_guest = 0 AND id != ?`).get(BOT_PLAYER_ID)?.c || 0);
  const activeGames = Number(db.prepare(`SELECT COUNT(*) AS c FROM games WHERE status = 'active'`).get()?.c || 0);
  const finishedGames = Number(db.prepare(`SELECT COUNT(*) AS c FROM games WHERE status = 'finished'`).get()?.c || 0);
  const totalGames = Number(db.prepare(`SELECT COUNT(*) AS c FROM games`).get()?.c || 0);
  const totalMoves = Number(db.prepare(`SELECT COALESCE(SUM(move_count), 0) AS v FROM games`).get()?.v || 0);
  const averageElo = Number(db.prepare(`SELECT ROUND(AVG(elo), 0) AS v FROM players WHERE deleted = 0 AND is_guest = 0 AND id != ?`).get(BOT_PLAYER_ID)?.v || 0);
  const averageDuration = Number(db.prepare(`SELECT ROUND(AVG(duration), 0) AS v FROM games WHERE status = 'finished' AND duration > 0`).get()?.v || 0);
  const averageMoves = Number(db.prepare(`SELECT ROUND(AVG(move_count), 0) AS v FROM games WHERE status = 'finished' AND move_count > 0`).get()?.v || 0);
  const follows = Number(db.prepare(`SELECT COUNT(*) AS c FROM follows`).get()?.c || 0);
  const tournaments = Number(db.prepare(`SELECT COUNT(*) AS c FROM tournaments`).get()?.c || 0);
  const totalCoins = Number(db.prepare(`SELECT COALESCE(SUM(coins), 0) AS v FROM players WHERE deleted = 0 AND is_guest = 0 AND id != ?`).get(BOT_PLAYER_ID)?.v || 0);
  const vipCount = Number(db.prepare(`SELECT COUNT(*) AS c FROM players WHERE deleted = 0 AND is_guest = 0 AND is_vip = 1 AND is_vip_plus = 0`).get()?.c || 0);
  const vipPlusCount = Number(db.prepare(`SELECT COUNT(*) AS c FROM players WHERE deleted = 0 AND is_guest = 0 AND is_vip_plus = 1`).get()?.c || 0);
  const persoCount = Number(db.prepare(`SELECT COUNT(*) AS c FROM players WHERE deleted = 0 AND is_guest = 0 AND is_perso = 1`).get()?.c || 0);
  const shopPurchases = Number(db.prepare(`SELECT COALESCE(SUM(quantity), 0) AS v FROM player_shop_items`).get()?.v || 0);
  const eloBoostersOwned = Number(db.prepare(`
    SELECT COALESCE(SUM(quantity), 0) AS v
    FROM player_shop_items
    WHERE item_key IN ('elo_mini', 'elo_classic', 'elo_max', 'elo_princess')
       OR item_key LIKE 'elo_custom_%'
  `).get()?.v || 0);
  const coinBoostersOwned = Number(db.prepare(`
    SELECT COALESCE(SUM(quantity), 0) AS v
    FROM player_shop_items
    WHERE item_key IN ('coin_boost', 'coin_boost_plus')
       OR item_key LIKE 'coin_custom_%'
  `).get()?.v || 0);
  const activeGlobalBoost = bQ.getActive.get();
  const activeCoinBoost = {
    multiplier: Number(db.prepare(`SELECT value FROM config WHERE key = 'coin_boost_multiplier'`).get()?.value || 1),
    expiresAt: Number(db.prepare(`SELECT value FROM config WHERE key = 'coin_boost_expires_at'`).get()?.value || 0),
  };
  const activeVipBoosts = Number(db.prepare(`SELECT COUNT(*) AS c FROM vip_boosts WHERE expires_at > ?`).get(Date.now())?.c || 0);
  const suspiciousPlayers = Number(db.prepare(`SELECT COUNT(*) AS c FROM players WHERE deleted = 0 AND is_guest = 0 AND suspicious = 1`).get()?.c || 0);
  const suspiciousGames = Number(db.prepare(`SELECT COUNT(*) AS c FROM games WHERE suspicious = 1`).get()?.c || 0);
  const botGames = Number(db.prepare(`SELECT COUNT(*) AS c FROM games WHERE player1_id = ? OR player2_id = ?`).get(BOT_PLAYER_ID, BOT_PLAYER_ID)?.c || 0);
  const accuracyRows = db.prepare(`
    SELECT p1_accuracy AS accuracy FROM games WHERE p1_accuracy IS NOT NULL
    UNION ALL
    SELECT p2_accuracy AS accuracy FROM games WHERE p2_accuracy IS NOT NULL
  `).all();
  const analysedGames = Number(db.prepare(`SELECT COUNT(*) AS c FROM games WHERE p1_accuracy IS NOT NULL OR p2_accuracy IS NOT NULL`).get()?.c || 0);
  const averageAccuracy = accuracyRows.length
    ? Math.round(accuracyRows.reduce((sum, row) => sum + Number(row.accuracy || 0), 0) / accuracyRows.length)
    : 0;
  const bestAccuracy = accuracyRows.length
    ? Math.round(Math.max(...accuracyRows.map(row => Number(row.accuracy || 0))))
    : 0;

  return {
    onlinePlayers: presence.onlinePlayers,
    visitors: presence.visitors,
    totalPresent: presence.totalPresent,
    queuePlayers: Number(mm?.q?.length || mm?.queue?.length || 0),
    activeGames,
    finishedGames,
    totalGames,
    totalMoves,
    averageElo,
    averageDuration,
    averageMoves,
    averageAccuracy,
    bestAccuracy,
    analysedGames,
    follows,
    tournaments,
    registeredPlayers,
    totalCoins,
    shopPurchases,
    eloBoostersOwned,
    coinBoostersOwned,
    vipCount,
    vipPlusCount,
    persoCount,
    suspiciousPlayers,
    suspiciousGames,
    botGames,
    globalBoostActive: !!activeGlobalBoost,
    globalBoostMultiplier: Number(activeGlobalBoost?.multiplier || 1),
    coinBoostActive: activeCoinBoost.expiresAt > Date.now() && activeCoinBoost.multiplier > 1,
    coinBoostMultiplier: Number(activeCoinBoost.multiplier || 1),
    activeVipBoosts,
    updatedAt: Date.now(),
  };
}

function getWeeklyStats() {
  const now = Date.now();
  const currentWeekStart = getWeekStartMs(now);
  const buckets = [];
  for (let i = 1; i >= 0; i -= 1) {
    const startMs = currentWeekStart - (i * 7 * 24 * 60 * 60 * 1000);
    const endMs = startMs + (7 * 24 * 60 * 60 * 1000);
    const key = formatShortFrenchDate(startMs);
    buckets.push({
      key,
      startMs,
      endMs,
      label: `Semaine du ${key}`,
      registrations: 0,
      games: 0,
      finishedGames: 0,
      activePlayersSet: new Set(),
    });
  }

  const firstBucketStartMs = buckets[0]?.startMs || currentWeekStart;
  const players = db.prepare(`
    SELECT created_at
    FROM players
    WHERE deleted = 0 AND is_guest = 0 AND id != ?
      AND created_at >= datetime(?, 'unixepoch')
  `).all(BOT_PLAYER_ID, Math.floor(firstBucketStartMs / 1000));

  const games = db.prepare(`
    SELECT created_at, status, player1_id, player2_id
    FROM games
    WHERE created_at >= datetime(?, 'unixepoch')
  `).all(Math.floor(firstBucketStartMs / 1000));

  for (const row of players) {
    const createdAtMs = parseSqliteDateMs(row.created_at);
    const bucket = buckets.find(entry => createdAtMs >= entry.startMs && createdAtMs < entry.endMs);
    if (bucket) bucket.registrations += 1;
  }

  for (const row of games) {
    const createdAtMs = parseSqliteDateMs(row.created_at);
    const bucket = buckets.find(entry => createdAtMs >= entry.startMs && createdAtMs < entry.endMs);
    if (!bucket) continue;
    bucket.games += 1;
    if (row.status === 'finished') bucket.finishedGames += 1;
    if (Number(row.player1_id || 0) !== BOT_PLAYER_ID) bucket.activePlayersSet.add(Number(row.player1_id || 0));
    if (Number(row.player2_id || 0) !== BOT_PLAYER_ID) bucket.activePlayersSet.add(Number(row.player2_id || 0));
  }

  const series = buckets.map(bucket => ({
    label: bucket.label,
    shortLabel: bucket.key,
    registrations: bucket.registrations,
    games: bucket.games,
    finishedGames: bucket.finishedGames,
    activePlayers: bucket.activePlayersSet.size,
    averageGamesPerDay: Math.round((bucket.games / 7) * 10) / 10,
  }));

  const latest = series[series.length - 1] || {
    registrations: 0,
    games: 0,
    finishedGames: 0,
    activePlayers: 0,
    averageGamesPerDay: 0,
  };

  return {
    currentWeek: latest,
    peakGamesWeek: series.reduce((best, week) => week.games > best.games ? week : best, series[0] || latest),
    peakRegistrationsWeek: series.reduce((best, week) => week.registrations > best.registrations ? week : best, series[0] || latest),
    averageWeeklyActivePlayers: series.length
      ? Math.round(series.reduce((sum, week) => sum + Number(week.activePlayers || 0), 0) / series.length)
      : 0,
    series,
    updatedAt: Date.now(),
  };
}

app.get('/api/stats/overview', (_, res) => {
  try {
    res.json(getStatsOverview());
  } catch (error) {
    console.error('[STATS] overview:', error.message);
    res.status(500).json({ error: 'Impossible de charger les statistiques.' });
  }
});

app.get('/api/stats/weekly', (_, res) => {
  try {
    res.json(getWeeklyStats());
  } catch (error) {
    console.error('[STATS] weekly:', error.message);
    res.status(500).json({ error: 'Impossible de charger les statistiques hebdomadaires.' });
  }
});

io.on('connection', socket => {
  socket.emit('presence_counts', getPresenceCounts());

  socket.on('join_live', () => {
    socket.join('live');
  });

  socket.on('visitor_presence', ({ visitorId } = {}) => {
    if (socket.playerId) return;
    const before = `${getPresenceCounts().onlinePlayers}:${getPresenceCounts().visitors}`;
    registerVisitorSocket(socket, visitorId);
    const afterCounts = getPresenceCounts();
    const after = `${afterCounts.onlinePlayers}:${afterCounts.visitors}`;
    if (before !== after) broadcastPresenceCounts();
  });

  socket.on('identify', ({ playerId, token }) => {
    // VAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAArifier le token de session
    const validId = token ? validateSession(token) : null;
    if (!validId || validId !== Number(playerId)) {
      return socket.emit('error', { message: 'Session invalide. Reconnecte-toi.' });
    }
    const player = getPlayerRecord(Number(playerId));
    if (!player) return socket.emit('error', { message: 'Joueur introuvable.' });
    socket.playerId   = Number(playerId);
    socket.playerData = sanitize(player);
    // Stocker l'IP en mAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAAmoire (X-Forwarded-For pour Railway)
    const clientIp = (socket.handshake.headers['x-forwarded-for'] || '').split(',')[0].trim()
                   || socket.handshake.address;
    socket.clientIp = clientIp;
    unregisterVisitorSocket(socket);
    playerToIp.set(socket.playerId, clientIp);
    if (!ipToPlayers.has(clientIp)) ipToPlayers.set(clientIp, new Set());
    ipToPlayers.get(clientIp).add(socket.playerId);
    // Marquer en ligne
    if (!onlineSockets.has(socket.playerId)) onlineSockets.set(socket.playerId, new Set());
    onlineSockets.get(socket.playerId).add(socket.id);
    if (!isAnonymousPlayerId(socket.playerId)) rQ.updateLastSeen.run(Date.now(), socket.playerId);
    socket.emit('identified', sanitize(player));
    broadcastPresenceCounts();
  });

  // Heartbeat de prAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAAsence (pages hors jeu)
  socket.on('presence_ping', () => {
    if (socket.playerId && !isAnonymousPlayerId(socket.playerId)) rQ.updateLastSeen.run(Date.now(), socket.playerId);
  });

  socket.on('duel_accept', ({ challengeId } = {}) => {
    if (!socket.playerId) return socket.emit('error', { message: 'Identifie-toi d abord.' });
    const challenge = duelChallenges.get(String(challengeId || ''));
    if (!challenge || challenge.status !== 'pending') {
      return socket.emit('duel_invite_error', { message: 'Ce duel n est plus disponible.' });
    }
    const accepted = acceptDuelChallenge(challenge, Number(socket.playerId));
    if (accepted.error) {
      return socket.emit('duel_invite_error', { message: accepted.error });
    }
  });

  socket.on('duel_decline', ({ challengeId } = {}) => {
    if (!socket.playerId) return;
    const challenge = duelChallenges.get(String(challengeId || ''));
    if (!challenge || challenge.status !== 'pending') return;
    if (![challenge.targetId, challenge.senderId].includes(Number(socket.playerId))) return;
    challenge.status = 'declined';
    duelChallenges.set(challenge.id, challenge);
    getOnlineSocketsForPlayer(challenge.senderId).forEach(s => s.emit('duel_invite_declined', { id: challenge.id }));
    getOnlineSocketsForPlayer(challenge.targetId).forEach(s => s.emit('duel_invite_declined', { id: challenge.id }));
  });

  socket.on('queue_join', ({ shape, tokenEmojiImage } = {}) => {
    if (!socket.playerData) return socket.emit('error', { message: 'Identifie-toi d\'abord.' });
    const freshPlayer = pQ.getById.get(socket.playerId);
    // VAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAArifier ban/mute
    if (freshPlayer.banned) return socket.emit('error', { message: 'Ton compte est banni.' });
    if (freshPlayer.muted_until && freshPlayer.muted_until > Date.now()) {
      const mins = Math.ceil((freshPlayer.muted_until - Date.now()) / 60000);
      return socket.emit('error', { message: `Tu es banni de jeu pendant encore ${mins} minute(s).` });
    }
    socket.playerData = sanitize(freshPlayer);
    // Shape envoyAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAAe par le client (localStorage) AAaAa AaaAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAA prioritAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAA sur la DB
    if (shape) socket.playerData.shape = shape;
    if (tokenEmojiImage && socket.playerData.shape === 'emoji_image') {
      socket.playerData.token_emoji_image = tokenEmojiImage;
    }
    const joined = mm.join(socket.id, { ...socket.playerData, socketId: socket.id });
    if (!joined) return socket.emit('error', { message: 'DAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAAjAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAA  en queue.' });
    socket.emit('queue_joined', { position: mm.position(socket.id) });
    const match = mm.tryMatch();
    if (match) _startMatch(match.p1, match.p2);
  });

  socket.on('queue_leave', () => { mm.leave(socket.id); socket.emit('queue_left'); });

  socket.on('tournament_queue_join', ({ tournamentId, shape, tokenEmojiImage } = {}) => {
    if (!socket.playerData) return socket.emit('error', { message: 'Identifie-toi d\'abord.' });
    const id = Number(tournamentId || 0);
    const tournament = tQ.getById.get(id);
    if (!tournament) return socket.emit('error', { message: 'Tournoi introuvable.' });
    if (tournament.status === 'pending') return socket.emit('error', { message: 'Le tournoi n a pas encore commence.' });
    if (tournament.status === 'paused') return socket.emit('error', { message: 'Le tournoi est en pause.' });
    if (tournament.status !== 'active' || Number(tournament.ends_at || 0) <= Date.now()) {
      return socket.emit('error', { message: 'Tournoi indisponible.' });
    }
    const entry = tQ.getEntry.get(id, socket.playerId);
    if (!entry) return socket.emit('error', { message: 'Inscris-toi d\'abord au tournoi.' });
    const freshPlayer = pQ.getById.get(socket.playerId);
    socket.playerData = sanitize(freshPlayer);
    if (shape) socket.playerData.shape = shape;
    if (tokenEmojiImage && socket.playerData.shape === 'emoji_image') socket.playerData.token_emoji_image = tokenEmojiImage;
    const tm = getTournamentQueue(id);
    const joined = tm.join(socket.id, { ...socket.playerData, socketId: socket.id, tournamentId: id });
    if (!joined) return socket.emit('error', { message: 'Deja en file tournoi.' });
    socket.tournamentQueueId = id;
    socket.emit('tournament_queue_joined', { tournamentId: id, position: tm.position(socket.id) });
    const match = tm.tryMatch();
    if (match) {
      _startMatch(match.p1, match.p2, {
        tournamentId: id,
        tournamentName: tournament.name,
        moveTimeSeconds: Number(tournament.move_time_seconds || 0),
      });
    }
  });

  socket.on('tournament_queue_leave', ({ tournamentId } = {}) => {
    const id = Number(tournamentId || socket.tournamentQueueId || 0);
    if (id) getTournamentQueue(id).leave(socket.id);
    socket.tournamentQueueId = null;
    socket.emit('tournament_queue_left');
  });

  socket.on('play_move', ({ col }) => {
    const result = gm.playMove(socket.id, col);
    if (result.error) return socket.emit('error', { message: result.error });
    if (result.type === 'move')      io.to('game:' + result.gameId).emit('move_played', result);
    if (result.type === 'game_over') io.to('game:' + result.gameId).emit('game_over',   result);
    // Notifier les spectateurs live
    io.to('live').emit('live_update');
  });

  socket.on('color_update', ({ color }) => {
    if (!socket.playerData || !color) return;
    if (!/^#[0-9a-fA-F]{6}$/.test(color)) return;
    pQ.updateColor.run({ color, id: socket.playerData.id });
    socket.playerData.color = color;
    const game = gm.getBySocket(socket.id);
    if (game) {
      // VAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAArifier si l'adversaire a la mAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAAme couleur AAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAA AAaAasAAAAAAAAasAA...AAasAAAAAAAAasAA...AAasAA lui assigner jaune
      const side = game.players[1].id === socket.playerData.id ? 1 : 2;
      const oppSide = side === 1 ? 2 : 1;
      const oppColor = game.players[oppSide].color || '#ffd60a';
      let effectiveColor = color;
      let oppEffectiveColor = oppColor;
      if (color.toLowerCase() === oppColor.toLowerCase()) {
        oppEffectiveColor = '#ffd60a';
        // Mettre AAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAA  jour la couleur de l'adversaire dans le state
        game.players[oppSide].color = oppEffectiveColor;
        io.to('game:' + game.id).emit('color_updated', { playerId: game.players[oppSide].id, color: oppEffectiveColor });
      }
      game.players[side].color = effectiveColor;
      io.to('game:' + game.id).emit('color_updated', { playerId: socket.playerData.id, color: effectiveColor });
    }
  });

  socket.on('rejoin_game', ({ gameId }) => {
    socket.transitioning = false;
    socket.join('game:' + gameId);
    let state = gm.games.get(gameId);

    // Reconstruire depuis DB si pas en mAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAAmoire
    if (!state || state.status !== 'active') {
      const gameRow = gQ.getById.get(gameId);
      if (!gameRow || gameRow.status !== 'active') return socket.emit('game_not_found');
      const moves = mQ.getByGame.all(gameId);
      const { Board } = require('./game/Board');
      const board = new Board();
      moves.forEach(m => board.drop(m.col, gameRow.player1_id === m.player_id ? 1 : 2));
      const p1db = pQ.getById.get(gameRow.player1_id);
      const p2db = pQ.getById.get(gameRow.player2_id);
      const tournamentRow = gameRow.tournament_id ? tQ.getById.get(gameRow.tournament_id) : null;
      state = {
        id: gameId, board,
        players: {
          1: { ...sanitize(p1db), color: gameRow.p1_color || p1db.color || '#ff2d55', shape: gameRow.p1_shape || p1db.shape || 'circle', socketId: null },
          2: { ...sanitize(p2db), color: gameRow.p2_color || p2db.color || '#ffd60a', shape: gameRow.p2_shape || p2db.shape || 'circle', socketId: null },
        },
        current: moves.length % 2 === 0 ? 1 : 2,
        startedAt: Date.now(), lastMoveAt: Date.now(),
        moveCount: moves.length, status: 'active',
        tournamentId: gameRow.tournament_id || null,
        tournamentName: tournamentRow?.name || '',
        moveTimeSeconds: Number(gameRow.tournament_move_time_seconds || 0) || 60,
        turnTimeLimitMs: (Number(gameRow.tournament_move_time_seconds || 0) || 60) * 1000,
      };
      gm.games.set(gameId, state);
    }

    const side = state.players[1].id === socket.playerId ? 1
               : state.players[2].id === socket.playerId ? 2 : null;

    if (side) {
      state.players[side].socketId = socket.id;
      state.players[side].disconnectedAt = null;
      gm.socketToGame.set(socket.id, gameId);

      // Envoyer l'AAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAAtat complet de la partie au client qui rejoint
      const p1 = state.players[1], p2 = state.players[2];
      socket.emit('game_rejoined', {
        gameId,
        side,
        moveTimeSeconds: Number(state.moveTimeSeconds || 0) || 60,
        tournament: state.tournamentId ? {
          id: Number(state.tournamentId),
          name: state.tournamentName || 'Tournoi',
          moveTimeSeconds: Number(state.moveTimeSeconds || 0) || 0,
        } : null,
        players: {
          1: { id: p1.id, pseudo: p1.pseudo, elo: p1.elo, color: p1.color || '#ff2d55', avatar: p1.avatar || '', shape: p1.shape || 'circle', token_emoji_image: p1.token_emoji_image || '', avatar_decoration: p1.avatar_decoration || '', profile_banner: p1.profile_banner || '', color_secondary: p1.color_secondary || '' },
          2: { id: p2.id, pseudo: p2.pseudo, elo: p2.elo, color: p2.color || '#ffd60a', avatar: p2.avatar || '', shape: p2.shape || 'circle', token_emoji_image: p2.token_emoji_image || '', avatar_decoration: p2.avatar_decoration || '', profile_banner: p2.profile_banner || '', color_secondary: p2.color_secondary || '' },
        },
        grid:    state.board.grid,
        current: state.current,
        moves:   state.moveCount,
        startsIn: 0,
      });

      // Notifier l'adversaire
      io.to('game:' + gameId).emit('opponent_reconnected', {
        pseudo: state.players[side].pseudo,
      });
    }
  });

  socket.on('game_not_found', () => { });

  socket.on('disconnect', () => {
    const before = `${getPresenceCounts().onlinePlayers}:${getPresenceCounts().visitors}`;
    unregisterVisitorSocket(socket);
    // Mettre AAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAA  jour last_seen et nettoyer onlineSockets
    if (socket.playerId) {
      if (!isAnonymousPlayerId(socket.playerId)) rQ.updateLastSeen.run(Date.now(), socket.playerId);
      const socks = onlineSockets.get(socket.playerId);
      if (socks) {
        socks.delete(socket.id);
        if (socks.size === 0) onlineSockets.delete(socket.playerId);
      }
    }
    const afterCounts = getPresenceCounts();
    const after = `${afterCounts.onlinePlayers}:${afterCounts.visitors}`;
    if (before !== after) broadcastPresenceCounts();
    // Nettoyer la map IP si plus de socket actif pour ce joueur
    if (socket.playerId && socket.clientIp) {
      const sameIpSockets = [...io.sockets.sockets.values()]
        .filter(s => s.clientIp === socket.clientIp && s.id !== socket.id);
      if (sameIpSockets.length === 0) {
        const players = ipToPlayers.get(socket.clientIp);
        if (players) players.delete(socket.playerId);
      }
    }
    mm.leave(socket.id);
    if (socket.tournamentQueueId) {
      getTournamentQueue(socket.tournamentQueueId).leave(socket.id);
      socket.tournamentQueueId = null;
    }

    // Si le socket AAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAAtait en transition (match_found mais pas encore rejoin_game)
    // on ne dAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAAclenche pas de forfait immAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAAdiatement AAaAa AaaAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAA le joueur charge /game
    if (socket.transitioning) {
      // Laisser une fenAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAAtre de grAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAAce : si personne ne rejoint dans 20s AAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAA AAaAasAAAAAAAAasAA...AAasAAAAAAAAasAA...AAasAA forfait
      const gameId = socket.pendingGameId;
      const side   = socket.pendingSide;
      if (gameId && side) {
        setTimeout(() => {
          const state = gm.games.get(gameId);
          if (!state || state.status !== 'active') return; // dAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAAjAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAA  terminAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAA
          // VAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAArifier si ce joueur a rejoint
          const playerSide = state.players[side];
          if (!playerSide || !io.sockets.sockets.get(playerSide.socketId)) {
            // Toujours dAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAAconnectAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAA AAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAA AAaAasAAAAAAAAasAA...AAasAAAAAAAAasAA...AAasAA forfait
            const winner = side === 1 ? 2 : 1;
            const result = gm._end(state, winner, [], 'disconnect');
            io.to('game:' + gameId).emit('game_over', result);
          }
        }, 30000);
      }
      return;
    }

    // FenAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAAtre de grAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAAce de 10s avant forfait (permet reload)
    const gameId = gm.socketToGame.get(socket.id);
    if (gameId) {
      const state = gm.games.get(gameId);
      if (state && state.status === 'active') {
        const side = gm._side(state, socket.id);
        if (side) {
          // Marquer le joueur comme "en reconnexion"
          state.players[side].disconnectedAt = Date.now();
          state.players[side].socketId = null;

          // Notifier l'adversaire
          io.to('game:' + gameId).emit('opponent_disconnected', {
            pseudo: state.players[side].pseudo,
            timeout: 30,
          });

          setTimeout(() => {
            const st = gm.games.get(gameId);
            if (!st || st.status !== 'active') return;
            // VAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAArifier si le joueur a reconnectAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAA
            const p = st.players[side];
            if (!p.socketId || !io.sockets.sockets.get(p.socketId)) {
              // Toujours dAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAAconnectAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAA AAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAA AAaAasAAAAAAAAasAA...AAasAAAAAAAAasAA...AAasAA forfait
              const result = gm._end(st, side === 1 ? 2 : 1, [], 'disconnect');
              io.to('game:' + gameId).emit('game_over', result);
            }
          }, 30000);
          return;
        }
      }
    }
    const result = gm.disconnect(socket.id);
    if (result?.type === 'game_over') io.to('game:' + result.gameId).emit('game_over', result);
  });
});

function _startMatch(p1, p2, options = {}) {
  // AAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAA MAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAAme IP AAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAA AAaAasAAAAAAAAasAA...AAasAAAAAAAAasAA...AAasAA ELO annulAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAA direct AAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAA
  const ip1 = playerToIp.get(p1.id);
  const ip2 = playerToIp.get(p2.id);
  const sameIp = ip1 && ip2 && ip1 === ip2;
  if (sameIp) {
    console.log(`[SAME-IP] ${p1.pseudo} et ${p2.pseudo} partagent la meme connexion`);
    // On laisse la partie se jouer mais on flag pour annuler l'ELO dans _end
  }
  p1.sameIpOpponent = sameIp;
  p2.sameIpOpponent = sameIp;

  // Anti-rematch : vAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAArifier les 3 derniers adversaires de chaque joueur
  try {
    const p1recent = abQ.lastOpponents.all(p1.id, p1.id, p1.id).map(r => r.opp_id);
    const p2recent = abQ.lastOpponents.all(p2.id, p2.id, p2.id).map(r => r.opp_id);
    // Si ils ont dAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAAjAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAA  jouAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAA dans les 3 derniAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAAres parties des deux cAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAAtAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAAs AAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAA AAaAasAAAAAAAAasAA...AAasAAAAAAAAasAA...AAasAA remettre en queue
    const p1facedP2 = p1recent.slice(0, 2).includes(p2.id); // 2 derniAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAAres parties de p1
    const p2facedP1 = p2recent.slice(0, 2).includes(p1.id); // 2 derniAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAAres parties de p2
    // Anti-rematch seulement si d'autres joueurs sont disponibles
    if (p1facedP2 && p2facedP1 && mm.size() > 2) {
      console.log(`[ANTI-REMATCH] ${p1.pseudo} vs ${p2.pseudo} remis en queue`);
      // tryMatch les a dAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAAjAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAA  retirAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAAs de la queue AAaAa AaaAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAA on les rAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAAinsAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAAre proprement
      mm.leave(p1.socketId); // au cas oAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAA (sAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAAcuritAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAA)
      mm.leave(p2.socketId);
      mm.join(p1.socketId, p1);
      mm.join(p2.socketId, p2);
      const s1 = io.sockets.sockets.get(p1.socketId);
      const s2 = io.sockets.sockets.get(p2.socketId);
      // Notifier les deux joueurs qu'ils sont en attente d'un autre adversaire
      if (s1) s1.emit('queue_joined', { position: mm.position(p1.socketId), reason: 'anti_rematch' });
      if (s2) s2.emit('queue_joined', { position: mm.position(p2.socketId), reason: 'anti_rematch' });
      // Tenter immAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAAdiatement un autre match si d'autres joueurs sont en queue
      const next = mm.tryMatch();
      if (next) _startMatch(next.p1, next.p2);
      return;
    }
  } catch(e) { /* ignore si DB pas encore prAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAAte */ }

  // VAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAArifier que les deux sockets sont toujours connectAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAAs
  const s1 = io.sockets.sockets.get(p1.socketId);
  const s2 = io.sockets.sockets.get(p2.socketId);
  if (!s1 || !s2) {
    // Un des deux est dAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAAconnectAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAA AAaAa AaaAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAA remettre l'autre en queue
    if (s1) { mm.join(p1.socketId, p1); s1.emit('queue_joined', { position: mm.position(p1.socketId) }); }
    if (s2) { mm.join(p2.socketId, p2); s2.emit('queue_joined', { position: mm.position(p2.socketId) }); }
    console.log(`[MATCH] Socket invalide : p1:${!!s1} p2:${!!s2}`);
    return;
  }

  // RAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAAsoudre les couleurs AVANT de crAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAAer la partie
  const _c1 = p1.color || '#ff2d55';
  let   _c2 = p2.color || '#ffd60a';
  if (_c1.toLowerCase() === _c2.toLowerCase()) {
    // Couleurs identiques : choisir une couleur alternative pour p2
    const ALTS = ['#ffd60a','#30d158','#0a84ff','#bf5af2','#ff9f0a','#ff6b81'];
    _c2 = ALTS.find(c => c.toLowerCase() !== _c1.toLowerCase()) || '#ffd60a';
  }
  p1.color = _c1;
  p2.color = _c2;

  const state = gm.create(p1, p2, options);
  const room  = 'game:' + state.id;
  s1.join(room);
  s2.join(room);

  const base = {
    gameId: state.id,
    gameType: String(state.gameType || options.gameType || 'ranked'),
    moveTimeSeconds: Number(state.moveTimeSeconds || 0) || 60,
    tournament: options.tournamentId ? {
      id: Number(options.tournamentId),
      name: options.tournamentName || 'Tournoi',
      moveTimeSeconds: Number(options.moveTimeSeconds || 0) || 0,
    } : null,
    players: {
      1: { id: p1.id, pseudo: p1.pseudo, elo: p1.elo, color: _c1, avatar: p1.avatar || '', shape: p1.shape || 'circle', token_emoji_image: p1.token_emoji_image || '', avatar_decoration: p1.avatar_decoration || '', profile_banner: p1.profile_banner || '', color_secondary: p1.color_secondary || '' },
      2: { id: p2.id, pseudo: p2.pseudo, elo: p2.elo, color: _c2, avatar: p2.avatar || '', shape: p2.shape || 'circle', token_emoji_image: p2.token_emoji_image || '', avatar_decoration: p2.avatar_decoration || '', profile_banner: p2.profile_banner || '', color_secondary: p2.color_secondary || '' },
    },
    startsIn: 3,
  };
  if (s1) {
    s1.transitioning  = true;
    s1.pendingGameId  = state.id;
    s1.pendingSide    = 1;
    s1.emit('match_found', { ...base, yourSide: 1 });
  }
  if (s2) {
    s2.transitioning  = true;
    s2.pendingGameId  = state.id;
    s2.pendingSide    = 2;
    s2.emit('match_found', { ...base, yourSide: 2 });
  }
}

// AAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAA 404 AAaAa AaaAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAA toute route non matchAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAAe AAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAA
app.use((req, res) => {
  // Les routes API renvoient du JSON, les pages HTML renvoient la 404
  if (req.path.startsWith('/api/') || req.path.startsWith('/socket.io/')) {
    return res.status(404).json({ error: 'Route introuvable' });
  }
  res.status(404).sendFile(path.join(__dirname, 'public/404.html'));
});

const PORT = process.env.PORT || 3000;
initDb().then(() => {
  server.listen(PORT, () => {
    console.log(`[HTTP] http://localhost:${PORT}`);
    startBot();
  });
}).catch(e => { console.error('DB init failed:', e); process.exit(1); });

// AAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAA Bot Discord intAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAAgrAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAA AAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAA
function startBot() {
  const { botToken } = discordConfig();
  if (!botToken) {
    console.log('[BOT] Token manquant - bot Discord desactive');
    return;
  }

  const bot = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers]
  });

  const BOT_API = process.env.BASE_URL || 'https://puissance-4-website-production.up.railway.app';

  function botFmt(value) {
    return Number(value || 0).toLocaleString('fr-FR');
  }

  function botPlayerByPseudo(pseudo) {
    const q = String(pseudo || '').trim();
    if (!q) return null;
    return db.prepare(`SELECT * FROM players WHERE LOWER(pseudo)=LOWER(?) AND deleted=0`).get(q);
  }

  function botPlayerByDiscord(discordId) {
    const id = String(discordId || '').trim();
    if (!id) return null;
    return db.prepare(`SELECT * FROM players WHERE discord_id=? AND deleted=0`).get(id);
  }

  function botRoleBadges(player) {
    const badges = [];
    if (Number(player?.is_perso) === 1) badges.push('PERSO');
    if (Number(player?.is_vip_plus) === 1) badges.push('VIP+');
    else if (Number(player?.is_vip) === 1) badges.push('VIP');
    if (player?.role === 'admin') badges.push('ADMIN');
    else if (player?.role === 'moderator') badges.push('MODO');
    return badges.length ? badges.join(' / ') : 'Joueur';
  }

  function botRankText(elo) {
    return getRank(Number(elo || 0))?.label || 'Non classe';
  }

  function botWinRate(player) {
    const total = Number(player?.wins || 0) + Number(player?.losses || 0) + Number(player?.draws || 0);
    return total ? `${Math.round((Number(player?.wins || 0) / total) * 100)}%` : '--';
  }

  function botProfileEmbed(player) {
    const total = Number(player.wins || 0) + Number(player.losses || 0) + Number(player.draws || 0);
    const follows = db.prepare(
      'SELECT (SELECT COUNT(*) FROM follows WHERE follower_id=?) AS following, (SELECT COUNT(*) FROM follows WHERE following_id=?) AS followers'
    ).get(player.id, player.id);
    const lastGame = db.prepare(`
      SELECT id, move_count, elo_p1, elo_p2, player1_id, player2_id
      FROM games
      WHERE status='finished' AND (player1_id=? OR player2_id=?) AND player1_id != ? AND player2_id != ?
      ORDER BY id DESC
      LIMIT 1
    `).get(player.id, player.id, BOT_PLAYER_ID, BOT_PLAYER_ID);
    const delta = lastGame
      ? (Number(lastGame.player1_id) === Number(player.id) ? Number(lastGame.elo_p1 || 0) : Number(lastGame.elo_p2 || 0))
      : null;
    const memberDate = player.created_at ? new Date(player.created_at).toLocaleDateString('fr-FR') : '--';
    const embed = new EmbedBuilder()
      .setColor(player.color || '#ff2d55')
      .setTitle(`${player.pseudo} - ${botFmt(player.elo)} ELO`)
      .setURL(`${BOT_API}/profil?id=${player.id}`)
      .setDescription(`Rang: **${botRankText(player.elo)}**\nBadges: **${botRoleBadges(player)}**\nCoins: **${botFmt(player.coins || 0)}**`)
      .addFields(
        { name: 'Stats', value: `Victoires: **${player.wins || 0}**\nDefaites: **${player.losses || 0}**\nNuls: **${player.draws || 0}**`, inline: true },
        { name: 'Performance', value: `Parties: **${total}**\nWinrate: **${botWinRate(player)}**\nRang: **${botRankText(player.elo)}**`, inline: true },
        { name: 'Social', value: `Suivis: **${follows?.following || 0}**\nAbonnes: **${follows?.followers || 0}**\nMembre: **${memberDate}**`, inline: true },
        { name: 'Derniere partie', value: lastGame ? `#${lastGame.id} / ${delta >= 0 ? '+' : ''}${delta} ELO / ${lastGame.move_count || 0} coups` : 'Aucune partie recente', inline: false },
      )
      .setFooter({ text: `ID ${player.id} - Puissance 4 Ranked` });
    if (/^https?:\/\//i.test(String(player.avatar || ''))) embed.setThumbnail(player.avatar);
    if (/^https?:\/\//i.test(String(player.banner || ''))) embed.setImage(player.banner);
    return embed;
  }

  function botLinkRow(player) {
    return new ActionRowBuilder().addComponents(
      new ButtonBuilder().setLabel('Voir profil').setStyle(ButtonStyle.Link).setURL(`${BOT_API}/profil?id=${player.id}`),
      new ButtonBuilder().setLabel('Boutique').setStyle(ButtonStyle.Link).setURL(`${BOT_API}/boutique`),
      new ButtonBuilder().setLabel('Live').setStyle(ButtonStyle.Link).setURL(`${BOT_API}/live`)
    );
  }

  function botCommandDefinitions() {
    return [
      { name: 'profil', description: 'Afficher le profil Puissance 4 d un joueur', options: [{ type: 3, name: 'pseudo', description: 'Pseudo du joueur', required: true, autocomplete: true }] },
      { name: 'classement', description: 'Afficher le top ELO Puissance 4' },
      { name: 'stats', description: 'Afficher les statistiques du site' },
      { name: 'live', description: 'Afficher les parties en direct' },
      { name: 'boutique', description: 'Afficher la boutique Puissance 4' },
      { name: 'api', description: 'Afficher la documentation API officielle du site' },
      { name: 'systeme', description: 'Afficher l etat serveur public' },
      { name: 'boosts', description: 'Afficher les boosts ELO, coins et VIP actifs' },
      { name: 'cosmetiques', description: 'Lister les bibliotheques publiques de cosmetiques', options: [{ type: 3, name: 'type', description: 'Type de bibliotheque', required: true, choices: [{ name: 'decorations', value: 'decorations' }, { name: 'bannieres', value: 'banners' }, { name: 'musiques', value: 'musics' }] }] },
      { name: 'leaderboard', description: 'Afficher un classement officiel', options: [{ type: 3, name: 'type', description: 'Type de classement', required: false, choices: [{ name: 'elo', value: 'elo' }, { name: 'victoires', value: 'wins' }] }] },
      { name: 'replay', description: 'Afficher le resume d une partie', options: [{ type: 4, name: 'id', description: 'ID de partie', required: true }] },
      { name: 'duel-lien', description: 'Generer un lien de duel officiel', options: [{ type: 3, name: 'type', description: 'Type de duel', required: true, choices: [{ name: 'ranked', value: 'ranked' }, { name: 'amical', value: 'friendly' }] }] },
      { name: 'tournois', description: 'Lister les tournois officiels' },
      { name: 'tournoi', description: 'Afficher le detail d un tournoi', options: [{ type: 3, name: 'id', description: 'ID public ou interne du tournoi', required: true }] },
      { name: 'aide', description: 'Afficher les commandes Discord disponibles' },
      {
        name: 'admin',
        description: 'Commandes staff Puissance 4',
        options: [
          {
            type: 3,
            name: 'action',
            description: 'Action a executer',
            required: true,
            choices: [
              { name: 'stats', value: 'stats' },
              { name: 'player', value: 'player' },
              { name: 'mute', value: 'mute' },
              { name: 'unmute', value: 'unmute' },
              { name: 'ban', value: 'ban' },
              { name: 'unban', value: 'unban' },
              { name: 'coins', value: 'coins' },
              { name: 'elo', value: 'elo' },
              { name: 'boost-elo', value: 'boost-elo' },
              { name: 'boost-coins', value: 'boost-coins' },
              { name: 'give-item', value: 'give-item' },
              { name: 'tournoi-finish', value: 'tournoi-finish' },
              { name: 'tournoi-pause', value: 'tournoi-pause' },
              { name: 'tournoi-resume', value: 'tournoi-resume' },
              { name: 'tournoi-delete', value: 'tournoi-delete' },
              { name: 'backups', value: 'backups' },
              { name: 'maintenance-on', value: 'maintenance-on' },
              { name: 'maintenance-off', value: 'maintenance-off' },
              { name: 'reload', value: 'reload' },
            ],
          },
          { type: 3, name: 'password', description: 'Mot de passe admin', required: true },
          { type: 3, name: 'pseudo', description: 'Joueur cible si besoin', required: false, autocomplete: true },
          { type: 3, name: 'id', description: 'ID de tournoi, partie ou ressource si besoin', required: false },
          { type: 3, name: 'item', description: 'Item boutique si besoin', required: false, choices: Object.values(SHOP_ITEMS).map(item => ({ name: item.label.slice(0, 100), value: item.key })).slice(0, 25) },
          { type: 10, name: 'valeur', description: 'Nombre, minutes, ELO, coins ou multiplicateur', required: false },
          { type: 3, name: 'raison', description: 'Raison ou duree minutes pour boost coins', required: false },
        ],
      },
    ];
  }

  async function botRegisterCommands() {
    const rest = new REST({ version: '10' }).setToken(botToken);
    const route = DISCORD_GUILD ? Routes.applicationGuildCommands(bot.user.id, DISCORD_GUILD) : Routes.applicationCommands(bot.user.id);
    await rest.put(route, { body: botCommandDefinitions() });
  }

  async function botAutocomplete(interaction) {
    const focused = interaction.options.getFocused(true);
    if (focused.name !== 'pseudo') return interaction.respond([]);
    const query = String(focused.value || '').replace(/[%_]/g, '').trim();
    const rows = db.prepare(`
      SELECT pseudo, elo
      FROM players
      WHERE deleted=0 AND id != ? AND pseudo LIKE ?
      ORDER BY elo DESC
      LIMIT 25
    `).all(BOT_PLAYER_ID, `${query}%`);
    return interaction.respond(rows.map(p => ({ name: `${p.pseudo} - ${p.elo} ELO`.slice(0, 100), value: p.pseudo })));
  }

  async function botRequireStaff(interaction, password, minimum = 'moderator') {
    if (String(password || '') !== String(ADMIN_PASSWORD || '')) {
      await interaction.editReply({ content: 'Mot de passe admin invalide.' });
      return null;
    }
    const role = await getDiscordRole(interaction.user.id, botToken).catch(() => 'user');
    const ok = minimum === 'admin' ? role === 'admin' : ['admin', 'moderator'].includes(role);
    if (!ok) {
      await interaction.editReply({ content: 'Role Discord insuffisant pour cette commande.' });
      return null;
    }
    return role;
  }

  function botStatsEmbed() {
    const presence = getPresenceCounts();
    const activeGames = Number(db.prepare(`SELECT COUNT(*) AS c FROM games WHERE status='active'`).get()?.c || 0);
    const finishedGames = Number(db.prepare(`SELECT COUNT(*) AS c FROM games WHERE status='finished'`).get()?.c || 0);
    const registered = Number(db.prepare(`SELECT COUNT(*) AS c FROM players WHERE deleted=0 AND is_guest=0 AND id != ?`).get(BOT_PLAYER_ID)?.c || 0);
    const vip = Number(db.prepare(`SELECT COUNT(*) AS c FROM players WHERE deleted=0 AND (is_vip=1 OR is_vip_plus=1 OR is_perso=1)`).get()?.c || 0);
    const coins = Number(db.prepare(`SELECT COALESCE(SUM(coins),0) AS c FROM players WHERE deleted=0 AND is_guest=0 AND id != ?`).get(BOT_PLAYER_ID)?.c || 0);
    const boost = bQ.getActive.get();
    const coinBoostMultiplier = Number(db.prepare(`SELECT value FROM config WHERE key='coin_boost_multiplier'`).get()?.value || 1);
    const coinBoostExpiresAt = Number(db.prepare(`SELECT value FROM config WHERE key='coin_boost_expires_at'`).get()?.value || 0);
    const coinBoostActive = coinBoostMultiplier > 1 && coinBoostExpiresAt > Date.now();
    return new EmbedBuilder()
      .setColor('#85ebff')
      .setTitle('Stats Puissance 4')
      .setURL(`${BOT_API}/stats`)
      .addFields(
        { name: 'Presence', value: `Connectes: **${presence.onlinePlayers}**\nVisiteurs: **${presence.visitors}**\nTotal: **${presence.totalPresent}**`, inline: true },
        { name: 'Parties', value: `En cours: **${activeGames}**\nTerminees: **${finishedGames}**`, inline: true },
        { name: 'Economie', value: `Joueurs: **${registered}**\nPremium: **${vip}**\nCoins: **${botFmt(coins)}**`, inline: true },
        { name: 'Boosts', value: `ELO: **x${boost?.multiplier || 1}**\nCoins: **x${coinBoostActive ? coinBoostMultiplier : 1}**`, inline: false },
      );
  }

  function botBoostsEmbed() {
    const activeBoost = bQ.getActive.get();
    const coinBoostMultiplier = Number(db.prepare(`SELECT value FROM config WHERE key='coin_boost_multiplier'`).get()?.value || 1);
    const coinBoostExpiresAt = Number(db.prepare(`SELECT value FROM config WHERE key='coin_boost_expires_at'`).get()?.value || 0);
    const coinBoostBy = getBoostDisplayName(db.prepare(`SELECT value FROM config WHERE key='coin_boost_applied_by'`).get()?.value || '');
    const coinActive = coinBoostMultiplier > 1 && coinBoostExpiresAt > Date.now();
    const vipActive = Number(db.prepare(`SELECT COUNT(*) AS c FROM vip_boosts WHERE active=1 AND expires_at > ?`).get(Date.now())?.c || 0);
    return new EmbedBuilder()
      .setColor('#ffd60a')
      .setTitle('Boosts officiels')
      .setURL(`${BOT_API}/stats`)
      .addFields(
        { name: 'Boost ELO global', value: activeBoost ? `x${activeBoost.multiplier} par ${getBoostDisplayName(activeBoost.applied_by)}` : 'Aucun boost actif', inline: false },
        { name: 'Boost coins global', value: coinActive ? `x${coinBoostMultiplier} par ${coinBoostBy}\nExpire dans ${Math.ceil((coinBoostExpiresAt - Date.now()) / 60000)} min` : 'Aucun boost actif', inline: false },
        { name: 'Boosts premium individuels', value: `${vipActive} actif${vipActive > 1 ? 's' : ''}`, inline: false },
      );
  }

  function botSystemEmbed() {
    const status = readSystemStatus();
    const presence = getPresenceCounts();
    return new EmbedBuilder()
      .setColor(status.restarting ? '#ff9f0a' : '#30d158')
      .setTitle('Etat serveur')
      .setURL(`${BOT_API}/api-doc`)
      .addFields(
        { name: 'Serveur', value: status.restarting ? 'Maintenance / redemarrage annonce' : 'Operationnel', inline: true },
        { name: 'Message', value: status.message || '-', inline: true },
        { name: 'Presence', value: `${presence.onlinePlayers} joueurs / ${presence.visitors} visiteurs`, inline: false },
      );
  }

  function botReplayEmbed(gameId) {
    const game = gQ.getById.get(Number(gameId));
    if (!game) return null;
    const moves = mQ.getByGame.all(Number(gameId));
    const winner = game.winner_pseudo || (game.winner_id ? `Joueur #${game.winner_id}` : 'Nul');
    const p1Delta = Number(game.elo_p1 || 0);
    const p2Delta = Number(game.elo_p2 || 0);
    return new EmbedBuilder()
      .setColor('#8b9cf4')
      .setTitle(`Replay #${game.id}`)
      .setURL(`${BOT_API}/replay/${game.id}`)
      .addFields(
        { name: 'Joueur 1', value: `**${game.p1_pseudo || game.player1_id}**\n${p1Delta >= 0 ? '+' : ''}${p1Delta} ELO`, inline: true },
        { name: 'Joueur 2', value: `**${game.p2_pseudo || game.player2_id}**\n${p2Delta >= 0 ? '+' : ''}${p2Delta} ELO`, inline: true },
        { name: 'Resultat', value: winner, inline: true },
        { name: 'Partie', value: `${moves.length || game.move_count || 0} coups / ${game.duration || 0}s / ${game.status || 'inconnu'}`, inline: false },
      );
  }

  function botTournamentListEmbed() {
    finalizeExpiredTournaments();
    const rows = tQ.listAll.all().slice(0, 8);
    const lines = rows.map(t => {
      const starts = Number(t.starts_at || 0) > Date.now()
        ? `commence dans ${Math.ceil((Number(t.starts_at) - Date.now()) / 60000)} min`
        : String(t.status || 'actif');
      return `**${t.name}** (${t.public_id || t.id}) - ${t.participants || 0} joueurs - ${starts}`;
    });
    return new EmbedBuilder()
      .setColor('#85ebff')
      .setTitle('Tournois officiels')
      .setURL(`${BOT_API}/tournoi`)
      .setDescription(lines.join('\n') || 'Aucun tournoi disponible.');
  }

  function botTournamentEmbed(ref) {
    finalizeExpiredTournaments();
    const tournament = findTournamentByRef(ref);
    if (!tournament) return null;
    const standings = tQ.standings.all(Number(tournament.id)).slice(0, 5);
    const top = standings.map((entry, index) => `#${index + 1} **${entry.pseudo}** - ${entry.score || 0} pts (${entry.wins || 0}V)`).join('\n') || 'Aucun participant.';
    return new EmbedBuilder()
      .setColor('#85ebff')
      .setTitle(tournament.name)
      .setURL(`${BOT_API}/tournoi/${tournament.public_id || tournament.id}`)
      .addFields(
        { name: 'ID', value: String(tournament.public_id || tournament.id), inline: true },
        { name: 'Statut', value: String(tournament.status || '-'), inline: true },
        { name: 'Cadence', value: `${tournament.duration_minutes || 0} min / ${tournament.move_time_seconds || 0}s par coup`, inline: true },
        { name: 'Recompenses', value: `1er: ${tournament.reward_1 || 0} coins\n2e: ${tournament.reward_2 || 0} coins\n3e: ${tournament.reward_3 || 0} coins`, inline: true },
        { name: 'Top actuel', value: top, inline: false },
      );
  }

  function botCosmeticsEmbed(type) {
    const paths = type === 'decorations'
      ? getAvatarDecorationPaths()
      : type === 'banners'
        ? getProfileBannerPaths()
        : getQueueMusicPaths().map(music => `${music.themeLabel} - ${music.label}`);
    const files = paths.slice(0, 12);
    const title = type === 'decorations' ? 'Decorations avatar' : type === 'banners' ? 'Bannieres pseudo' : 'Musiques de file';
    return new EmbedBuilder()
      .setColor(type === 'musics' ? '#ff9f0a' : '#85ebff')
      .setTitle(title)
      .setURL(`${BOT_API}/profil`)
      .setDescription(files.length ? files.map(file => `- ${file}`).join('\n') : 'Aucun fichier trouve.')
      .setFooter({ text: `${files.length} affiche(s), catalogue complet cote site` });
  }

  async function botHandleAdmin(interaction) {
    const action = interaction.options.getString('action', true);
    const password = interaction.options.getString('password', true);
    const pseudo = interaction.options.getString('pseudo');
    const value = interaction.options.getNumber('valeur');
    const reason = interaction.options.getString('raison') || '';
    const resourceId = interaction.options.getString('id');
    const itemKey = interaction.options.getString('item');
    const adminOnly = ['ban', 'unban', 'coins', 'elo', 'boost-elo', 'boost-coins', 'give-item', 'tournoi-finish', 'tournoi-pause', 'tournoi-resume', 'tournoi-delete', 'backups', 'maintenance-on', 'maintenance-off', 'reload'];
    const role = await botRequireStaff(interaction, password, adminOnly.includes(action) ? 'admin' : 'moderator');
    if (!role) return;

    if (action === 'reload') {
      await botRegisterCommands();
      WH.wlogAdminAction('Discord reload', interaction.user.tag || interaction.user.id, 'discord', [['Role', role, true]]);
      return interaction.editReply({ content: 'Commandes Discord rechargees.' });
    }
    if (action === 'stats') return interaction.editReply({ embeds: [botStatsEmbed()] });
    if (action === 'backups') {
      const files = [
        ['main', 'Base principale p4.db'],
        ['wal', 'Journal p4.db-wal'],
        ['shm', 'Memoire partagee p4.db-shm'],
      ];
      return interaction.editReply({ embeds: [new EmbedBuilder().setColor('#ff9f0a').setTitle('Backups disponibles').setDescription(files.map(([key, label]) => `\`${key}\` - ${label}`).join('\n')).setFooter({ text: 'Telechargement depuis le panel admin uniquement.' })] });
    }
    if (action === 'maintenance-on' || action === 'maintenance-off') {
      const status = writeSystemStatus({ restarting: action === 'maintenance-on', message: action === 'maintenance-on' ? (reason || 'Redemarrage ou maintenance en cours.') : '' });
      io.emit('system_status_update', status);
      WH.wlogSystem(action === 'maintenance-on' ? 'maintenance' : 'normal', status.message);
      return interaction.editReply({ content: action === 'maintenance-on' ? 'Maintenance activee.' : 'Maintenance desactivee.' });
    }
    if (action === 'boost-elo') {
      const multiplier = Math.max(1, Math.min(2, Number(value || 1)));
      bQ.deactivateAll.run();
      if (multiplier > 1) bQ.create.run({ multiplier, applied_by: 'Puissance4-Booster' });
      WH.wlogBoost('elo', multiplier, 'Puissance4-Booster', 'global');
      return interaction.editReply({ content: `Boost ELO regle sur x${multiplier}.` });
    }
    if (action === 'boost-coins') {
      const multiplier = Math.max(1, Math.min(10, Math.ceil(Number(value || 1))));
      const minutes = Math.max(0, Math.min(1440, Math.ceil(Number(reason || 60))));
      const expiresAt = multiplier > 1 && minutes > 0 ? Date.now() + minutes * 60 * 1000 : 0;
      db.prepare(`INSERT INTO config (key, value) VALUES ('coin_boost_multiplier', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`).run(String(multiplier));
      db.prepare(`INSERT INTO config (key, value) VALUES ('coin_boost_expires_at', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`).run(String(expiresAt));
      db.prepare(`INSERT INTO config (key, value) VALUES ('coin_boost_applied_by', 'Puissance4-Booster') ON CONFLICT(key) DO UPDATE SET value=excluded.value`).run();
      WH.wlogBoost('coins', multiplier, 'Puissance4-Booster', expiresAt ? `${minutes} min` : 'desactive');
      return interaction.editReply({ content: expiresAt ? `Boost coins active: x${multiplier} pendant ${minutes} min.` : 'Boost coins desactive.' });
    }

    if (action.startsWith('tournoi-')) {
      const tournament = findTournamentByRef(resourceId || '');
      if (!tournament) return interaction.editReply({ content: 'Tournoi introuvable.' });
      const id = Number(tournament.id);
      if (action === 'tournoi-finish') {
        const result = finalizeTournament(id, Date.now());
        if (!result) return interaction.editReply({ content: 'Tournoi deja termine ou introuvable.' });
        clearTournamentQueue(id);
      } else if (action === 'tournoi-pause') {
        if (tournament.status !== 'active') return interaction.editReply({ content: 'Tournoi non actif.' });
        tQ.markPaused.run({ id, paused_at: Date.now() });
        clearTournamentQueue(id);
      } else if (action === 'tournoi-resume') {
        if (tournament.status !== 'paused') return interaction.editReply({ content: 'Tournoi non en pause.' });
        const pausedAt = Number(tournament.paused_at || 0);
        const delta = pausedAt > 0 ? Math.max(0, Date.now() - pausedAt) : 0;
        tQ.resumePaused.run({ id, ends_at: Number(tournament.ends_at || 0) + delta });
      } else if (action === 'tournoi-delete') {
        db.prepare(`DELETE FROM tournaments WHERE id = ?`).run(id);
        tournamentQueues.delete(id);
      }
      WH.wlogTournament(tournament.name, tournament.public_id || id, action);
      return interaction.editReply({ content: `Action ${action} appliquee sur ${tournament.name}.` });
    }

    const target = botPlayerByPseudo(pseudo);
    if (!target) return interaction.editReply({ content: 'Joueur introuvable.' });
    if (action === 'player') return interaction.editReply({ embeds: [botProfileEmbed(target)], components: [botLinkRow(target)] });
    if (action === 'mute') {
      const minutes = Math.max(1, Math.min(1440, Math.ceil(Number(value || 60))));
      pQ.setMute.run({ until: Date.now() + minutes * 60 * 1000, id: target.id });
      WH.wlogMute(target.pseudo, target.id, minutes / 60);
      return interaction.editReply({ content: `${target.pseudo} mute pendant ${minutes} min.` });
    }
    if (action === 'unmute') {
      pQ.setMute.run({ until: 0, id: target.id });
      WH.wlogMute(target.pseudo, target.id, 0);
      return interaction.editReply({ content: `${target.pseudo} unmute.` });
    }
    if (action === 'ban' || action === 'unban') {
      const banned = action === 'ban' ? 1 : 0;
      pQ.setBanned.run({ banned, id: target.id });
      WH.wlogBan(target.pseudo, target.id, banned);
      return interaction.editReply({ content: banned ? `${target.pseudo} banni.` : `${target.pseudo} debanni.` });
    }
    if (action === 'coins') {
      const delta = Math.trunc(Number(value || 0));
      const nextCoins = Math.max(0, Number(target.coins || 0) + delta);
      pQ.updateCoins.run({ coins: nextCoins, id: target.id });
      WH.wlogCoins(target.pseudo, target.id, delta, reason || 'Commande Discord admin');
      return interaction.editReply({ content: `${target.pseudo}: ${botFmt(nextCoins)} coins (${delta >= 0 ? '+' : ''}${delta}).` });
    }
    if (action === 'give-item') {
      const item = SHOP_ITEMS[itemKey];
      if (!item) return interaction.editReply({ content: 'Item boutique invalide.' });
      const quantity = Math.max(1, Math.min(99, Math.trunc(Number(value || 1))));
      shopItemQ.addQty.run({ player_id: target.id, item_key: item.key, quantity });
      WH.wlogAdminAction('Item boutique Discord', target.pseudo, target.id, [['Item', item.label, true], ['Quantite', quantity, true]]);
      return interaction.editReply({ content: `${target.pseudo} recoit ${quantity} x ${item.label}.` });
    }
    if (action === 'elo') {
      const delta = Math.trunc(Number(value || 0));
      const nextElo = Math.max(0, Number(target.elo || 0) + delta);
      db.prepare(`UPDATE players SET elo=? WHERE id=?`).run(nextElo, target.id);
      WH.wlogAdminAction('ELO Discord', target.pseudo, target.id, [['Delta', delta, true], ['Nouveau', nextElo, true]]);
      return interaction.editReply({ content: `${target.pseudo}: ${nextElo} ELO (${delta >= 0 ? '+' : ''}${delta}).` });
    }
    return interaction.editReply({ content: 'Action inconnue.' });
  }

  function botUpdateStatus() {
    try {
      const presence = getPresenceCounts();
      const activeGames = Number(db.prepare(`SELECT COUNT(*) AS c FROM games WHERE status='active'`).get()?.c || 0);
      const queueCount = Number(mm?.queue?.length || mm?.q?.length || 0);
      const registered = Number(db.prepare(`SELECT COUNT(*) AS c FROM players WHERE deleted=0 AND is_guest=0 AND id != ?`).get(BOT_PLAYER_ID)?.c || 0);
      const statuses = [
        { text: `${presence.totalPresent} presents sur le site`, type: ActivityType.Watching },
        { text: `${activeGames} parties en direct`, type: ActivityType.Watching },
        { text: `${queueCount} joueurs en file`, type: ActivityType.Competing },
        { text: `${registered} comptes inscrits`, type: ActivityType.Watching },
      ];
      const status = statuses[Math.floor(Date.now() / 10000) % statuses.length];
      bot.user.setActivity(status.text, { type: status.type });
    } catch (e) {}
  }

  bot.once('clientReady', async () => {
    console.log(`[BOT] Bot connecte : ${bot.user.tag}`);
    try {
      await botRegisterCommands();
      console.log('[BOT] Commandes slash enregistrees');
    } catch (e) {
      console.error('[BOT] Register commands:', e.message);
    }
    botUpdateStatus();
    setInterval(botUpdateStatus, 10000);
  });

  bot.on('interactionCreate', async interaction => {
    try {
      if (interaction.isAutocomplete()) return botAutocomplete(interaction);
      if (!interaction.isChatInputCommand()) return;
      const isAdminCommand = interaction.commandName === 'admin';
      await interaction.deferReply({ ephemeral: isAdminCommand });

      if (interaction.commandName === 'profil') {
        const player = botPlayerByPseudo(interaction.options.getString('pseudo', true));
        if (!player) return interaction.editReply({ content: 'Joueur introuvable.' });
        return interaction.editReply({ embeds: [botProfileEmbed(player)], components: [botLinkRow(player)] });
      }
      if (interaction.commandName === 'classement') {
        const players = db.prepare(`SELECT * FROM players WHERE deleted=0 AND id != ? ORDER BY elo DESC LIMIT 10`).all(BOT_PLAYER_ID);
        const lines = players.map((p, i) => `#${i + 1} **${p.pseudo}** - ${botFmt(p.elo)} ELO - ${botRankText(p.elo)}`);
        return interaction.editReply({ embeds: [new EmbedBuilder().setColor('#ffd60a').setTitle('Classement Puissance 4').setURL(`${BOT_API}/leaderboard`).setDescription(lines.join('\n') || 'Aucun joueur classe.')] });
      }
      if (interaction.commandName === 'stats') return interaction.editReply({ embeds: [botStatsEmbed()] });
      if (interaction.commandName === 'api') {
        return interaction.editReply({
          embeds: [new EmbedBuilder().setColor('#85ebff').setTitle('API officielle Puissance 4').setURL(`${BOT_API}/api-doc`).setDescription('Documentation HTTP, endpoints admin, boutique, duels, tournois, stats et Socket.IO.')],
          components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setLabel('Ouvrir la doc API').setStyle(ButtonStyle.Link).setURL(`${BOT_API}/api-doc`))],
        });
      }
      if (interaction.commandName === 'systeme') return interaction.editReply({ embeds: [botSystemEmbed()] });
      if (interaction.commandName === 'boosts') return interaction.editReply({ embeds: [botBoostsEmbed()] });
      if (interaction.commandName === 'cosmetiques') return interaction.editReply({ embeds: [botCosmeticsEmbed(interaction.options.getString('type', true))] });
      if (interaction.commandName === 'leaderboard') {
        const type = interaction.options.getString('type') || 'elo';
        const players = type === 'wins'
          ? db.prepare(`SELECT * FROM players WHERE deleted=0 AND is_guest=0 AND id != ? ORDER BY wins DESC, elo DESC LIMIT 10`).all(BOT_PLAYER_ID)
          : db.prepare(`SELECT * FROM players WHERE deleted=0 AND is_guest=0 AND id != ? ORDER BY elo DESC LIMIT 10`).all(BOT_PLAYER_ID);
        const lines = players.map((p, i) => `#${i + 1} **${p.pseudo}** - ${type === 'wins' ? `${p.wins || 0} victoires` : `${botFmt(p.elo)} ELO`}`);
        return interaction.editReply({ embeds: [new EmbedBuilder().setColor(type === 'wins' ? '#30d158' : '#ffd60a').setTitle(type === 'wins' ? 'Classement victoires' : 'Classement ELO').setURL(`${BOT_API}/leaderboard`).setDescription(lines.join('\n') || 'Aucun joueur classe.')] });
      }
      if (interaction.commandName === 'replay') {
        const embed = botReplayEmbed(interaction.options.getInteger('id', true));
        if (!embed) return interaction.editReply({ content: 'Partie introuvable.' });
        return interaction.editReply({ embeds: [embed], components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setLabel('Voir le replay').setStyle(ButtonStyle.Link).setURL(`${BOT_API}/replay/${interaction.options.getInteger('id', true)}`))] });
      }
      if (interaction.commandName === 'duel-lien') {
        const player = botPlayerByDiscord(interaction.user.id);
        if (!player) return interaction.editReply({ content: 'Ton compte Discord doit etre lie a un profil Puissance 4 pour generer un lien de duel.' });
        const gameType = interaction.options.getString('type', true) === 'friendly' ? 'friendly' : 'ranked';
        const challenge = createDuelChallenge({ senderId: player.id, mode: 'link', ttlMs: 15 * 60 * 1000, gameType });
        const shareUrl = `${BOT_API}/duel/${challenge.id}`;
        WH.wlogDuel(player.pseudo, 'Lien public', gameType);
        return interaction.editReply({
          embeds: [new EmbedBuilder().setColor(gameType === 'friendly' ? '#85ebff' : '#ffd60a').setTitle('Lien de duel cree').setDescription(`Type: **${gameType === 'friendly' ? 'Amical' : 'Ranked'}**\nExpire dans **15 minutes**.`).setURL(shareUrl)],
          components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setLabel('Ouvrir le duel').setStyle(ButtonStyle.Link).setURL(shareUrl))],
        });
      }
      if (interaction.commandName === 'tournois') return interaction.editReply({ embeds: [botTournamentListEmbed()], components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setLabel('Page tournois').setStyle(ButtonStyle.Link).setURL(`${BOT_API}/tournoi`))] });
      if (interaction.commandName === 'tournoi') {
        const embed = botTournamentEmbed(interaction.options.getString('id', true));
        if (!embed) return interaction.editReply({ content: 'Tournoi introuvable.' });
        return interaction.editReply({ embeds: [embed] });
      }
      if (interaction.commandName === 'live') {
        const active = [...(gm.games || new Map()).values()].filter(game => game.status === 'active');
        const lines = active.slice(0, 10).map(game => {
          const p1 = game.players?.[1];
          const p2 = game.players?.[2];
          if (!p1 || !p2) return null;
          const current = game.current === 1 ? p1.pseudo : p2.pseudo;
          return `#${game.id || '?'} **${p1.pseudo}** vs **${p2.pseudo}** - tour de **${current}**`;
        }).filter(Boolean);
        return interaction.editReply({
          embeds: [new EmbedBuilder().setColor('#ff2d55').setTitle(`${active.length} partie${active.length > 1 ? 's' : ''} en direct`).setURL(`${BOT_API}/live`).setDescription(lines.join('\n') || 'Aucune partie en direct.')],
          components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setLabel('Voir le live').setStyle(ButtonStyle.Link).setURL(`${BOT_API}/live`))],
        });
      }
      if (interaction.commandName === 'boutique') {
        return interaction.editReply({
          embeds: [new EmbedBuilder().setColor('#ff9f0a').setTitle('Boutique Puissance 4').setURL(`${BOT_API}/boutique`).setDescription('Rangs premium, boosters ELO, boosters coins et cosmetiques sont disponibles avec les coins du site.')],
          components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setLabel('Ouvrir la boutique').setStyle(ButtonStyle.Link).setURL(`${BOT_API}/boutique`))],
        });
      }
      if (interaction.commandName === 'aide') {
        return interaction.editReply({ embeds: [new EmbedBuilder().setColor('#85ebff').setTitle('Commandes Puissance 4').setDescription([
          '`/profil pseudo` - profil complet',
          '`/classement` - top ELO',
          '`/stats` - stats du site',
          '`/api` - documentation API officielle',
          '`/systeme` - etat serveur',
          '`/boosts` - boosts actifs',
          '`/leaderboard type` - classement ELO ou victoires',
          '`/replay id` - resume replay',
          '`/duel-lien type` - genere un lien duel 15 min',
          '`/tournois` et `/tournoi id` - tournois',
          '`/cosmetiques type` - decorations, bannieres, musiques',
          '`/live` - parties en direct',
          '`/boutique` - boutique coins',
          '`/admin` - outils staff avec mot de passe + role Discord',
        ].join('\n'))] });
      }
      if (interaction.commandName === 'admin') return botHandleAdmin(interaction);
    } catch (e) {
      console.error('[BOT ERROR]', e);
      const payload = { content: 'Erreur bot Discord. Regarde les logs serveur pour le detail.' };
      if (interaction.deferred || interaction.replied) return interaction.editReply(payload).catch(() => {});
      return interaction.reply({ ...payload, ephemeral: true }).catch(() => {});
    }
  });

  return bot.login(botToken).catch(e => console.error('[BOT] Login failed:', e.message));

  // AAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAA Statuts rotatifs AAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAA
  function updateStatus() {
    try {
      const onlineCount = Number(onlineSockets.size || 0);
      const activeGames = Number(db.prepare(`SELECT COUNT(*) as c FROM games WHERE status='active'`).get()?.c || 0);
      const queueCount = Number(mm?.q?.length || 0);
      const statuses = [
        { text: `${onlineCount} connecte${onlineCount > 1 ? 's' : ''}`, type: ActivityType.Watching },
        { text: `${activeGames} partie${activeGames > 1 ? 's' : ''} en cours`, type: ActivityType.Playing },
        { text: `${queueCount} en file`, type: ActivityType.Competing },
      ];
      const s = statuses[Math.floor(Date.now() / 10000) % statuses.length];
      bot.user.setActivity(s.text, { type: s.type });
    } catch(e) {}
  }

  // Cache des emojis de rang (chargAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAA au dAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAAmarrage)
  const rankEmojiCache = {};

  bot.once('clientReady', async () => {
    console.log(`[BOT] Bot connecte : ${bot.user.tag}`);
    updateStatus();
    setInterval(updateStatus, 10000);

    // Charger les emojis de rang depuis le guild
    try {
      const guild = await bot.guilds.fetch(DISCORD_GUILD);
      const emojis = await guild.emojis.fetch();
      const rankNames = ['Malachite','Quartz','Ambre','Jade','Saphir','Amethiste'];
      emojis.forEach(e => {
        const name = e.name; // ex: "Malachite_1", "Quartz_3"
        const base = rankNames.find(r => name.startsWith(r));
        if (base) rankEmojiCache[name] = `<:${name}:${e.id}>`;
      });
      console.log(`[BOT] ${Object.keys(rankEmojiCache).length} emojis de rang charges`);
    } catch(e) {
      console.error('[BOT] Emojis rang:', e.message);
    }

    console.log('[BOT] Commandes slash desactivees sur cette version');
  });

  // AAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAA Commandes slash AAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAA
  const API = process.env.BASE_URL || 'https://puissance-4-website-production.up.railway.app';

  function eloRank(elo) {
    const r = getRank(elo);
    const fallbacks = { Malachite:'AAA...AA...AAA', Quartz:'AAA...AAA', Ambre:'AAA...AA...AAA', Jade:'AAA...AAaAAA', Saphir:'AAA...AAaAAA', Amethyste:'AAA...AA...AAA' };
    // Chercher l'emoji spAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAAcifique au niveau (ex: Quartz_3)
    const key = r.key + '_' + (r.level || 1);
    const emoji = rankEmojiCache[key] || fallbacks[r.key] || 'AAA...AA...AAA';
    return { label: r.label, emoji, color: r.color, level: r.level, key: r.key };
  }
  function winRate(p) {
    const t = (p.wins||0)+(p.losses||0)+(p.draws||0);
    return t ? Math.round((p.wins/t)*100)+'%' : 'AAaAa AaaAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAA';
  }

  // AAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAA GAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAAnAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAAration avatar initiale (SVG AAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAA AAaAasAAAAAAAAasAA...AAasAAAAAAAAasAA...AAasAA Buffer PNG via canvas si dispo) AAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAA
  function generateAvatarSvg(initial, color) {
    // SVG 128x128 avec cercle colorAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAA + initiale blanche
    const bg  = color || '#ff2d55';
    const hex = bg.replace('#','');
    const r   = parseInt(hex.slice(0,2),16);
    const g   = parseInt(hex.slice(2,4),16);
    const b   = parseInt(hex.slice(4,6),16);
    // Couleur de fond lAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAAgAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAArement assombrie pour lisibilitAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAA
    const dr  = Math.round(r*0.7), dg = Math.round(g*0.7), db = Math.round(b*0.7);
    const dark = '#' + [dr,dg,db].map(v=>v.toString(16).padStart(2,'0')).join('');
    return Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">` +
      `<defs><radialGradient id="g" cx="40%" cy="35%"><stop offset="0%" stop-color="${bg}"/><stop offset="100%" stop-color="${dark}"/></radialGradient></defs>` +
      `<circle cx="64" cy="64" r="64" fill="url(#g)"/>` +
      `<text x="64" y="64" text-anchor="middle" dominant-baseline="central" font-family="Arial,sans-serif" font-size="56" font-weight="bold" fill="white" opacity="0.95">${initial}</text>` +
      `</svg>`
    );
  }

  async function getAvatarAttachment(data) {
    const initial = (data.pseudo || '?')[0].toUpperCase();
    const color   = data.color || '#ff2d55';

    // Cas 1 : avatar URL HTTP directe
    if (data.avatar && data.avatar.startsWith('http')) {
      return { url: data.avatar, attachment: null };
    }

    // Cas 2 : avatar base64 (data:image/...;base64,...)
    if (data.avatar && data.avatar.startsWith('data:')) {
      try {
        const matches = data.avatar.match(/^data:([^;]+);base64,(.+)$/);
        if (matches) {
          const mime   = matches[1]; // ex: image/jpeg
          const b64    = matches[2];
          const buf    = Buffer.from(b64, 'base64');
          const ext    = mime.split('/')[1] || 'jpg';
          return { url: null, attachment: { name: 'avatar.' + ext, buffer: buf } };
        }
      } catch(e) {
        console.error('[BOT] avatar base64 parse error:', e.message);
      }
    }

    // Cas 3 : pas d'avatar AAaAa AaaAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAA gAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAAnAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAArer initiale avec canvas ou SVG
    try {
      const { createCanvas } = require('canvas');
      const size = 128;
      const cv   = createCanvas(size, size);
      const ctx  = cv.getContext('2d');
      const grd  = ctx.createRadialGradient(size*0.4, size*0.35, 0, size/2, size/2, size/2);
      grd.addColorStop(0, color);
      const hex = color.replace('#','');
      const dr  = Math.round(parseInt(hex.slice(0,2),16)*0.75).toString(16).padStart(2,'0');
      const dg  = Math.round(parseInt(hex.slice(2,4),16)*0.75).toString(16).padStart(2,'0');
      const db2 = Math.round(parseInt(hex.slice(4,6),16)*0.75).toString(16).padStart(2,'0');
      grd.addColorStop(1, '#'+dr+dg+db2);
      ctx.beginPath();
      ctx.arc(size/2, size/2, size/2, 0, Math.PI*2);
      ctx.fillStyle = grd;
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.95)';
      ctx.font      = 'bold 56px Arial';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(initial, size/2, size/2);
      return { url: null, attachment: { name: 'avatar.png', buffer: cv.toBuffer('image/png') } };
    } catch(e) {
      // Fallback SVG si canvas absent
      const svgBuf = generateAvatarSvg(initial, color);
      return { url: null, attachment: { name: 'avatar.svg', buffer: svgBuf } };
    }
  }

  function roundRectBot(ctx, x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }

  function hexToRgbaBot(hex, alpha) {
    const safe = String(hex || '#ffffff').replace('#', '');
    const full = safe.length === 3 ? safe.split('').map(c => c + c).join('') : safe.padEnd(6, 'f');
    const r = parseInt(full.slice(0, 2), 16);
    const g = parseInt(full.slice(2, 4), 16);
    const b = parseInt(full.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  async function loadImageSafeBot(loadImage, src) {
    try { return src ? await loadImage(src) : null; } catch { return null; }
  }

  async function generateProfileCardAttachment(data) {
    try {
      const { createCanvas, loadImage } = require('canvas');
      ensureCanvasFonts();
      const rank = data.rank || getRank(data.elo);
      const canvas = createCanvas(1100, 680);
      const ctx = canvas.getContext('2d');
      const totalGames = (data.wins || 0) + (data.losses || 0) + (data.draws || 0);
      const bg = await loadImageSafeBot(loadImage, 'https://i.pinimg.com/736x/40/65/a2/4065a24c58246a208cc7057db8b0286c.jpg');
      const avatar = await loadImageSafeBot(loadImage, data.avatar && data.avatar.startsWith('http') ? data.avatar : null);
      const rankImage = await loadImageSafeBot(loadImage, path.join(__dirname, 'public', rank.image.replace(/^\//, '')));
      const latestGames = Array.isArray(data.latestGames) ? data.latestGames.slice(0, 3) : [];
      const rawShape = data.shape || 'circle';
      const shapeDisplay = rawShape.startsWith('emoji:')
        ? (rawShape.slice(6).trim() || '●')
        : ({ circle: '●', diamond: '◆', triangle: '▲', star: '★', heart: '♥' }[rawShape] || '●');
      const shapeLabel = rawShape.startsWith('emoji:') ? 'emoji perso' : rawShape;
      const colorHex = String(data.color || '#ff2d55').toUpperCase();

      const fontHero = '400 64px "Bebas Neue"';
      const fontSub = '700 24px "Barlow Condensed"';
      const fontSmall = '600 18px "Barlow"';
      const fontMeta = '400 17px "Barlow"';

      const drawGlowText = (text, x, y, color, font, blur = 18, align = 'start') => {
        ctx.save();
        ctx.font = font;
        ctx.textAlign = align;
        ctx.fillStyle = color;
        ctx.shadowColor = color;
        ctx.shadowBlur = blur;
        ctx.fillText(String(text || ''), x, y);
        ctx.restore();
      };

      const drawPanel = (x, y, w, h, color, radius = 18, fillAlpha = 0.58) => {
        ctx.save();
        roundRectBot(ctx, x, y, w, h, radius);
        ctx.fillStyle = `rgba(16,18,32,${fillAlpha})`;
        ctx.shadowColor = color;
        ctx.shadowBlur = 20;
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.lineWidth = 3;
        ctx.strokeStyle = hexToRgbaBot(color, 0.98);
        ctx.stroke();
        ctx.restore();
      };

      const drawMiniLogo = (x, y, scale = 1) => {
        const cols = 7;
        const rows = 6;
        const gap = 4 * scale;
        const cell = 12 * scale;
        const w = cols * cell + (cols - 1) * gap + 18 * scale;
        const h = rows * cell + (rows - 1) * gap + 18 * scale;
        drawPanel(x, y, w, h, '#6edbff', 16 * scale, 0.72);
        const pieces = new Map([
          ['2:3', '#ff4d6d'],
          ['3:2', '#ff4d6d'],
          ['3:3', '#ffd44d'],
          ['4:3', '#ff4d6d'],
          ['2:2', '#ffd44d'],
          ['4:2', '#ffd44d'],
        ]);
        for (let row = 0; row < rows; row++) {
          for (let col = 0; col < cols; col++) {
            const cx = x + 9 * scale + col * (cell + gap) + cell / 2;
            const cy = y + 9 * scale + row * (cell + gap) + cell / 2;
            ctx.beginPath();
            ctx.arc(cx, cy, cell / 2, 0, Math.PI * 2);
            ctx.closePath();
            ctx.fillStyle = pieces.get(`${col}:${rows - 1 - row}`) || 'rgba(12,16,30,0.82)';
            ctx.fill();
            ctx.lineWidth = 1.5 * scale;
            ctx.strokeStyle = 'rgba(255,255,255,0.14)';
            ctx.stroke();
          }
        }
      };

      if (bg) ctx.drawImage(bg, 0, 0, canvas.width, canvas.height);
      else {
        const grad = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
        grad.addColorStop(0, '#170b2c');
        grad.addColorStop(0.5, '#273372');
        grad.addColorStop(1, '#090d1f');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }

      const overlay = ctx.createLinearGradient(0, 0, 0, canvas.height);
      overlay.addColorStop(0, 'rgba(7,9,22,0.22)');
      overlay.addColorStop(1, 'rgba(7,9,22,0.78)');
      ctx.fillStyle = overlay;
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      drawMiniLogo(38, 30, 1.05);

      ctx.save();
      ctx.beginPath();
      ctx.arc(110, 136, 62, 0, Math.PI * 2);
      ctx.closePath();
      ctx.clip();
      if (avatar) {
        ctx.drawImage(avatar, 48, 74, 124, 124);
      } else {
        ctx.fillStyle = hexToRgbaBot(data.color || '#ff2d55', 0.34);
        ctx.fillRect(48, 74, 124, 124);
        ctx.fillStyle = '#ffffff';
        ctx.font = '700 52px "Barlow Condensed"';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText((data.pseudo || '?')[0].toUpperCase(), 110, 136);
      }
      ctx.restore();
      ctx.textAlign = 'start';
      ctx.textBaseline = 'alphabetic';
      ctx.lineWidth = 5;
      ctx.strokeStyle = hexToRgbaBot(data.color || '#ff2d55', 0.95);
      ctx.beginPath();
      ctx.arc(110, 136, 64, 0, Math.PI * 2);
      ctx.stroke();

      const badges = [];
      if (data.is_vip_plus) badges.push('VIP+');
      else if (data.is_vip) badges.push('VIP');
      if (data.role === 'admin') badges.push('ADMIN');
      else if (data.role === 'moderator') badges.push('MODO');
      const badgeText = badges.length ? ` / ${badges.join(' / ')}` : '';

      drawGlowText(data.pseudo || 'Joueur', 204, 118, '#f5f4ff', fontHero, 20);
      ctx.fillStyle = '#ffe27a';
      ctx.font = fontSub;
      ctx.fillText(`${rank.label}${badgeText}`, 206, 162);
      ctx.fillStyle = '#d7d5ef';
      ctx.font = fontMeta;
      ctx.fillText(`Suivis ${data.following || 0} / Abonnes ${data.followers || 0}`, 206, 196);

      const infoX = 42;
      const infoY = 244;
      const infoLines = [
        `Cosmetiques`,
        `Forme`,
      ];
      drawGlowText('PROFIL', infoX, infoY, '#f5f4ff', '400 30px "Bebas Neue"', 12);
      ctx.fillStyle = '#d7d5ef';
      ctx.font = fontMeta;
      infoLines.forEach((line, i) => ctx.fillText(line, infoX, infoY + 38 + i * 28));

      ctx.save();
      ctx.beginPath();
      ctx.arc(infoX + 168, infoY + 52, 13, 0, Math.PI * 2);
      ctx.closePath();
      ctx.fillStyle = colorHex;
      ctx.shadowColor = colorHex;
      ctx.shadowBlur = 16;
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.stroke();
      ctx.restore();

      ctx.save();
      ctx.font = '28px "Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#f5f4ff';
      ctx.fillText(shapeDisplay, infoX + 92, infoY + 88);
      ctx.restore();

      const rankX = 744;
      const rankY = 58;
      const rankW = 302;
      const rankH = 214;
      ctx.save();
      roundRectBot(ctx, rankX, rankY, rankW, rankH, 24);
      ctx.fillStyle = 'rgba(18,20,34,0.62)';
      ctx.shadowColor = rank.color || '#ffffff';
      ctx.shadowBlur = 24;
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.lineWidth = 4;
      ctx.strokeStyle = hexToRgbaBot(rank.color || '#ffffff', 0.98);
      ctx.stroke();
      ctx.restore();
      drawGlowText('RANG', rankX + rankW / 2, rankY + 36, '#f5f4ff', '400 32px "Bebas Neue"', 14, 'center');
      if (rankImage) ctx.drawImage(rankImage, rankX + 56, rankY + 60, 78, 78);
      else {
        ctx.save();
        ctx.font = '700 40px "Barlow Condensed"';
        ctx.textAlign = 'center';
        ctx.fillStyle = '#f5f4ff';
        ctx.fillText('[]', rankX + 96, rankY + 120);
        ctx.restore();
      }
      drawGlowText(rank.label, rankX + 148, rankY + 106, '#ffe27a', '400 38px "Bebas Neue"', 14);
      ctx.fillStyle = '#d7d5ef';
      ctx.font = fontSmall;
      ctx.fillText(`${data.elo} ELO`, rankX + 148, rankY + 142);
      ctx.fillText(`${rank.progress || 0}% de progression`, rankX + 82, rankY + 166);
      roundRectBot(ctx, rankX + 52, rankY + 176, rankW - 104, 22, 11);
      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      ctx.fill();
      roundRectBot(ctx, rankX + 52, rankY + 176, Math.max(24, Math.round((rankW - 104) * ((rank.progress || 0) / 100))), 22, 11);
      ctx.fillStyle = hexToRgbaBot(rank.color || '#ffffff', 0.98);
      ctx.fill();
      ctx.fillStyle = '#f5f4ff';
      ctx.font = '600 18px "Barlow"';
      ctx.fillText(rank.next ? `Prochain palier : ${rank.next} ELO` : 'Rang maximum atteint', rankX + 54, rankY + 214);

      const stats = [
        { label: 'Victoires', value: String(data.wins || 0), color: '#9be15d' },
        { label: 'Defaites', value: String(data.losses || 0), color: '#ff7aa2' },
        { label: 'Nuls', value: String(data.draws || 0), color: '#8dd7ff' },
        { label: 'Parties', value: String(totalGames), color: '#7cf0ff' },
        { label: 'Win rate', value: data.winRate || '-', color: '#c38bff' },
        { label: 'Precision', value: data.avg_accuracy != null ? String(data.avg_accuracy) : '-', color: '#33a1ff' },
      ];
      const statW = 304;
      const statH = 96;
      const startX = 42;
      const statStartY = 352;
      const gapX = 24;
      const gapY = 24;
      stats.forEach((stat, index) => {
        const row = Math.floor(index / 3);
        const col = index % 3;
        const x = startX + col * (statW + gapX);
        const y = statStartY + row * (statH + gapY);
        drawPanel(x, y, statW, statH, stat.color);
        drawGlowText(stat.label, x + statW / 2, y + 34, hexToRgbaBot(stat.color, 0.98), '400 28px "Bebas Neue"', 10, 'center');
        ctx.save();
        ctx.textAlign = 'center';
        ctx.fillStyle = '#f5f4ff';
        ctx.font = '400 44px "Bebas Neue"';
        ctx.fillText(stat.value, x + statW / 2, y + 78);
        ctx.restore();
      });

      return new AttachmentBuilder(canvas.toBuffer('image/png'), { name: `profil-${data.id}.png` });
    } catch (e) {
      console.error('[BOT] generateProfileCardAttachment:', e.message);
      return null;
    }
  }
  bot.on('interactionCreate', async interaction => {
    try {
      if (typeof interaction.reply === 'function' && !interaction.replied && !interaction.deferred) {
        await interaction.reply({ content: 'Les commandes Discord sont desactivees sur cette version.', ephemeral: true });
      }
    } catch (_) {}
    return;
    // AAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAA Autocomplete pseudo AAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAA
    if (interaction.isAutocomplete() && interaction.commandName === 'profil') {
      try {
        const q = interaction.options.getFocused();
        if (q.length < 2) return interaction.respond([]);
        const rows = db.prepare(`
          SELECT pseudo, elo FROM players
          WHERE pseudo LIKE ? COLLATE NOCASE AND deleted = 0 AND id != ?
          ORDER BY elo DESC LIMIT 10
        `).all(q.replace(/%/g,'') + '%', BOT_PLAYER_ID);
        await interaction.respond(rows.map(r => ({
          name: `${r.pseudo} - ${r.elo} ELO`,
          value: r.pseudo
        })));
      } catch(e) {
        console.error('[BOT autocomplete]', e.message);
        try { await interaction.respond([]); } catch(_) {}
      }
      return;
    }

    if (!interaction.isChatInputCommand()) return;

    // Defer visible pour tous sauf si ephemeral forcAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAA
    try { await interaction.deferReply(); } catch(e) { return; }

    try {
      // AAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAA /profil AAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAA
      if (interaction.commandName === 'profil') {
        const pseudo = interaction.options.getString('pseudo');
        console.log(`[BOT /profil] recherche: "${pseudo}"`);

        const data = db.prepare(
          `SELECT * FROM players WHERE LOWER(pseudo)=LOWER(?) AND deleted=0`
        ).get(pseudo);

        if (!data) {
          return interaction.editReply({ content: `Joueur **${pseudo}** introuvable.` });
        }

        console.log(`[BOT /profil] joueur trouve id=${data.id}`);

        const games = gQ.getForPlayer.all(data.id, data.id, BOT_PLAYER_ID, BOT_PLAYER_ID).slice(0, 5);
        const rank = eloRank(data.elo);
        const total = (data.wins || 0) + (data.losses || 0) + (data.draws || 0);
        const wr = total ? Math.round((data.wins / total) * 100) + '%' : '--';

        const accRow = db.prepare(`
          SELECT
            AVG(CASE WHEN player1_id=? AND p1_accuracy IS NOT NULL THEN p1_accuracy END) AS as_p1,
            AVG(CASE WHEN player2_id=? AND p2_accuracy IS NOT NULL THEN p2_accuracy END) AS as_p2
          FROM games WHERE (player1_id=? OR player2_id=?) AND status='finished'
        `).get(data.id, data.id, data.id, data.id);
        const prec = (() => {
          const vals = [accRow?.as_p1, accRow?.as_p2].filter(v => v != null);
          return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) + '%' : '--';
        })();

        const di = (() => {
          try { return data.discord_info ? JSON.parse(data.discord_info) : null; }
          catch { return null; }
        })();

        const rankInfo = getRank(data.elo);
        const followCounts = db.prepare(
          'SELECT (SELECT COUNT(*) FROM follows WHERE follower_id=?) AS following, (SELECT COUNT(*) FROM follows WHERE following_id=?) AS followers'
        ).get(data.id, data.id);
        const memberDate = data.created_at
          ? new Date(data.created_at).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })
          : '--';

        const safe = value => {
          const textValue = value == null ? '' : String(value).trim();
          return textValue ? textValue : '--';
        };

        const menuRows = [];
        if (games.length > 0) {
          const options = games.slice(0, 25).map(g => {
            const isP1 = g.player1_id === data.id;
            const opp = safe(isP1 ? g.p2_pseudo : g.p1_pseudo);
            const won = g.winner_id === data.id;
            const draw = g.winner_id === null;
            const icon = draw ? 'DRAW' : (won ? 'WIN' : 'LOSE');
            const delta = isP1 ? (g.elo_p1 || 0) : (g.elo_p2 || 0);
            const date = g.finished_at ? g.finished_at.slice(0, 10) : '--';
            return new StringSelectMenuOptionBuilder()
              .setLabel(`${icon} vs ${opp} / ${(delta >= 0 ? '+' : '') + delta} ELO`.slice(0, 100))
              .setDescription(`${date} / ${g.move_count || 0} coups / ${g.duration || 0}s`.slice(0, 100))
              .setValue('game:' + g.id);
          });
          const menu = new StringSelectMenuBuilder()
            .setCustomId('prof_games:' + data.id)
            .setPlaceholder('Voir le detail d une partie')
            .addOptions(options);
          menuRows.push(new ActionRowBuilder().addComponents(menu));
        } else {
          const emptyMenu = new StringSelectMenuBuilder()
            .setCustomId('prof_games:' + data.id)
            .setPlaceholder('Aucune partie')
            .setDisabled(true)
            .addOptions(
              new StringSelectMenuOptionBuilder()
                .setLabel('Aucune partie')
                .setDescription('Ce joueur n a pas encore de partie enregistree.')
                .setValue('none')
            );
          menuRows.push(new ActionRowBuilder().addComponents(emptyMenu));
        }

        const roleBadges = [];
        if (Number(data.is_vip_plus) === 1) roleBadges.push('VIP+');
        else if (Number(data.is_vip) === 1) roleBadges.push('VIP');
        if (data.role === 'admin') roleBadges.push('ADMIN');
        else if (data.role === 'moderator') roleBadges.push('MODO');

        const profileEmbed = new EmbedBuilder()
          .setColor(data.color || '#ff2d55')
          .setTitle(`${rank.emoji} ${data.pseudo}`)
          .setURL(`${API}/profil?id=${data.id}`)
          .setDescription([
            `**${data.elo} ELO**`,
            `Rang : **${rankInfo.label}**`,
            roleBadges.length ? `Badges : **${roleBadges.join(' / ')}**` : null,
          ].filter(Boolean).join('\n'))
          .setThumbnail(data.avatar || null)
          .addFields(
            { name: 'Statistiques', value: `Victoires: **${data.wins || 0}**\nDefaites: **${data.losses || 0}**\nNuls: **${data.draws || 0}**`, inline: true },
            { name: 'Performance', value: `Parties: **${total}**\nWin rate: **${wr}**\nPrecision: **${prec}**`, inline: true },
            { name: 'Profil', value: `Suivis: **${followCounts?.following || 0}**\nAbonnes: **${followCounts?.followers || 0}**\nMembre: **${memberDate}**`, inline: true },
          )
          .setFooter({ text: `ID ${data.id} • Puissance 4 Ranked` });

        if (data.banner) profileEmbed.setImage(data.banner);

        const buttonRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setLabel('Voir profil')
            .setStyle(ButtonStyle.Link)
            .setURL(`${API}/profil?id=${data.id}`)
        );

        console.log(`[BOT /profil] embed OK pour ${data.pseudo}`);
        return interaction.editReply({ embeds: [profileEmbed], components: [...menuRows, buttonRow] });
      }
      if (interaction.commandName === 'classement') {
        const players = db.prepare(`SELECT * FROM players WHERE deleted=0 AND id!=? ORDER BY elo DESC LIMIT 10`).all(BOT_PLAYER_ID);
        if (!players.length) return interaction.editReply({ content: 'Aucun joueur.' });
        const medals = ['🥇', '🥈', '🥉'];
        const lines  = players.map((p,i) => {
          const r = eloRank(p.elo);
          return `${medals[i]||`**#${i+1}**`} ${r.emoji} **${p.pseudo}** - ${p.elo} ELO - ${p.wins}V/${p.losses}D`;
        });
        const embed = new EmbedBuilder()
          .setColor('#ffd60a')
          .setTitle('Classement Puissance 4')
          .setURL(`${API}/leaderboard`)
          .setDescription(lines.join('\n'))
          .setFooter({ text: 'Top 10 Puissance 4 Ranked' });
        return interaction.editReply({ embeds: [embed] });
      }

      // AAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAA /live AAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAA
      if (interaction.commandName === 'live') {
        const activeGames = [...(gm.games || new Map()).values()].filter(g => g.status === 'active');
        if (!activeGames.length) return interaction.editReply({ content: 'Aucune partie en cours.' });
        const lines = activeGames.map(g => {
          const p1 = g.players?.[1], p2 = g.players?.[2];
          if (!p1 || !p2) return null;
          const cur = g.current === 1 ? p1.pseudo : p2.pseudo;
          return `Partie: **${p1.pseudo}** (${p1.elo}) vs **${p2.pseudo}** (${p2.elo}) - ${g.moveCount||0} coups - Tour de **${cur}**`;
        }).filter(Boolean);
        const embed = new EmbedBuilder()
          .setColor('#ff2d55')
          .setTitle(`${activeGames.length} partie${activeGames.length>1?'s':''} en cours`)
          .setURL(`${API}/live`)
          .setDescription(lines.join('\n') || '--')
          .setFooter({ text: 'Puissance 4 Ranked Live' });
        return interaction.editReply({ embeds: [embed] });
      }

    // AAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAA SelectMenu dAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAAtail d'une partie AAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAA
    if (interaction.isStringSelectMenu() && interaction.customId.startsWith('prof_games:')) {
      await interaction.deferReply({ ephemeral: true });
      try {
        const val = interaction.values[0];
        if (!val.startsWith('game:')) return interaction.editReply({ content: 'Valeur invalide.' });
        const gameId = Number(val.split(':')[1]);
        const game = gQ.getById.get(gameId);
        if (!game) return interaction.editReply({ content: 'Partie introuvable.' });

        const moves = mQ.getByGame.all(gameId);
        const playerId = Number(interaction.customId.split(':')[1]);
        const isP1  = game.player1_id === playerId;
        const opp   = isP1 ? game.p2_pseudo : game.p1_pseudo;
        const oppElo= isP1 ? game.p2_elo    : game.p1_elo;
        const won   = game.winner_id === playerId;
        const draw  = game.winner_id === null;
        const icon  = draw ? '🤝' : (won ? '🏆' : '❌');
        const delta = isP1 ? (game.elo_p1 || 0) : (game.elo_p2 || 0);
        const myElo = isP1 ? game.p1_elo    : game.p2_elo;
        const myRank= eloRank(myElo);
        const oppRank=eloRank(oppElo);
        const date  = game.finished_at
          ? new Date(game.finished_at).toLocaleDateString('fr-FR',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'})
          : '--';

        const gameEmbed = new EmbedBuilder()
          .setColor(isP1 ? (game.p1_color || '#ff2d55') : (game.p2_color || '#ffd60a'))
          .setTitle(icon + ' Partie #' + gameId)
          .setURL(API + '/replay/' + gameId)
          .addFields(
            { name: 'Adversaire', value: myRank.emoji + ' vs ' + oppRank.emoji + ' **' + (opp||'?') + '** (' + (oppElo||'?') + ' ELO)', inline: false },
            { name: 'Delta ELO',  value: (delta >= 0 ? '+' : '') + delta + ' ELO', inline: true },
            { name: 'Coups',      value: String(game.move_count || 0), inline: true },
            { name: 'Duree',      value: (game.duration || 0) + 's', inline: true },
            { name: 'Date',       value: date, inline: false },
          );

        // PrAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAAcision si analysAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAAe
        const myAccuracy = isP1 ? game.p1_accuracy : game.p2_accuracy;
        const oppAccuracy= isP1 ? game.p2_accuracy : game.p1_accuracy;
        if (myAccuracy != null) {
          gameEmbed.addFields(
            { name: 'Ma precision', value: myAccuracy + '%', inline: true },
            { name: 'Precision adverse', value: (oppAccuracy || '--') + (oppAccuracy ? '%' : ''), inline: true },
          );
        }

        // Replay link button
        const replayBtn = new ActionRowBuilder().addComponents(
          new (require('discord.js').ButtonBuilder)()
            .setLabel('Voir le replay')
            .setURL(API + '/replay/' + gameId)
            .setStyle(require('discord.js').ButtonStyle.Link)
        );

        return interaction.editReply({ embeds: [gameEmbed], components: [replayBtn] });
      } catch(e) {
        console.error('[BOT SelectMenu game]', e.message);
        return interaction.editReply({ content: 'Erreur : ' + e.message });
      }
    }

    } catch(e) {
      // Log complet de l'erreur
      console.error('[BOT ERROR]', e.constructor.name, e.message);
      console.error(e.stack);
      // Envoyer l'erreur en ephemeral pour debug
      const errMsg = `**Erreur** : \`${e.constructor.name}: ${e.message}\``;
      try {
        if (interaction.deferred) await interaction.editReply({ content: errMsg });
        else await interaction.reply({ content: errMsg, ephemeral: true });
      } catch(_) {}
    }
  });

  bot.login(botToken).catch(e => console.error('[BOT] Login failed:', e));
}


require('dotenv').config();
const express    = require('express');
const http       = require('http');
const { Server } = require('socket.io');
const fs         = require('fs');
const path       = require('path');
const crypto     = require('crypto');
const os         = require('os');
const { fork, spawn } = require('child_process');
const { Readable } = require('stream');

const { initDb, db, pQ, gQ, mQ, aQ, variantQ, fQ, cQ, sQ, abQ, rQ, bQ, vipQ, tQ, tokenCollectionQ } = require('./db/db');
const { TOKEN_RARITIES, TOKEN_COLOR_CATALOG, drawTokenColorForRarity, drawTokenRarity, drawTokenGemReward } = require('./token-collection');
const { getRank, getAllRankRoleNames } = require('./rank');
const { createSecurity } = require('./security');
const { startDiscordBot } = require('./discord-bot');
const siteI18n = require('./i18n/server-translate');
const { Client, GatewayIntentBits, EmbedBuilder, ActivityType, REST, Routes, ActionRowBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

const ipToPlayers  = new Map(); 
const playerToIp   = new Map(); 
const onlineSockets = new Map();
const visitorSockets = new Map();
const connectedRoleRemoveTimers = new Map();
const connectedRoleKnownState = new Map();
const connectedRolePendingState = new Map();
const crystalLoginAnnounced = new Set();
const crystalLoginClearTimers = new Map();
const apiAuditRecent = new Map();
let lastPresenceSignature = '';
const { Matchmaking }         = require('./game/Matchmaking');
const { GameManager }         = require('./game/GameManager');
const { normalizeVariant, getVariant, publicVariants, MISSION_DEFINITIONS } = require('./game/variants');
const { createProgression }    = require('./progression');

const MAIN_DB_PATH = path.join(__dirname, '../data/p4.db');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, {
  cors: { origin: '*' },
  transports: ['websocket', 'polling'],
  allowUpgrades: true,
});
io.engine.on('connection', connection => {
  connection.on('packet', packet => {
    if (!isDevTelemetryPayload(packet?.data)) {
      devNetworkTotals.rxBytes += estimatePayloadBytes(packet?.data);
    }
  });
  connection.on('packetCreate', packet => {
    if (!isDevTelemetryPayload(packet?.data)) {
      devNetworkTotals.txBytes += estimatePayloadBytes(packet?.data);
    }
  });
});

const mm = new Matchmaking();
const gm = new GameManager();
const progression = createProgression({ db, pQ, cQ });
const security = createSecurity({
  dataDir: path.join(__dirname, '../data'),
  onEvent: event => {
    if (event.level === 'warning') console.warn('[SECURITY]', event.type, event.reason || '');
  },
});
const tournamentQueues = new Map();
const duelChallenges = new Map();
const gameRematchRequests = new Map();
const liveReactions = new Map();
const anonymousSessions = new Map();
const anonymousPlayers = new Map();
const botApiQueue = [];
const botRuntime = new Map();
const botHostProcesses = new Map();
const builtinBotIds = new Set();
const botArenaPairs = new Map();
const botArenaRestUntil = new Map();
const devMachineMetrics = [];
let devMachineCpuBase = process.cpuUsage();
let devMachineCpuAt = Date.now();
const devNetworkTotals = { rxBytes: 0, txBytes: 0 };
let devNetworkBase = { rxBytes: 0, txBytes: 0 };
const BOT_ARENA_ENABLED = String(process.env.BOT_ARENA_ENABLED || '1') !== '0';
const BOT_ARENA_INTERVAL_MS = Math.max(60_000, Number(process.env.BOT_ARENA_INTERVAL_MS || 2 * 60_000));
const BOT_ARENA_MAX_ACTIVE = Math.max(0, Math.min(1, Number(process.env.BOT_ARENA_MAX_ACTIVE || 1)));
const BOT_ARENA_PAIR_COOLDOWN_MS = Math.max(5 * 60_000, Number(process.env.BOT_ARENA_PAIR_COOLDOWN_MS || 8 * 60_000));
const BOT_ARENA_REST_MS = Math.max(60_000, Number(process.env.BOT_ARENA_REST_MS || 90_000));
const BOT_SEARCH_TIME_MS = Math.max(80, Math.min(300, Number(process.env.BOT_SEARCH_TIME_MS || 140)));
const BOT_MAX_SEARCH_DEPTH = Math.max(3, Math.min(9, Number(process.env.BOT_MAX_SEARCH_DEPTH || 7)));
const BOT_HOST_MAX_ACTIVE = Math.max(0, Math.min(2, Number(process.env.BOT_HOST_MAX_ACTIVE || 2)));
const BOT_HOST_MAX_RSS_MB = Math.max(64, Math.min(256, Number(process.env.BOT_HOST_MAX_RSS_MB || 128)));
const BOT_HOST_MAX_CPU_MS_PER_MIN = Math.max(1_000, Math.min(45_000, Number(process.env.BOT_HOST_MAX_CPU_MS_PER_MIN || 30_000)));
const BOT_HOST_WATCHDOG_MS = Math.max(5_000, Number(process.env.BOT_HOST_WATCHDOG_MS || 15_000));
const HOSTED_BOT_DEPTH = Math.max(1, Math.min(8, Number(process.env.P4_HOST_DEPTH || 6)));
const HOSTED_BOT_THINK_MS = Math.max(400, Math.min(15_000, Number(process.env.P4_HOST_THINK_MS || 5_000)));
const HOSTED_BOT_MAX_TABLE = Math.max(1_000, Math.min(120_000, Number(process.env.P4_HOST_MAX_TABLE || 60_000)));
const LIVE_UPDATE_DEBOUNCE_MS = Math.max(250, Number(process.env.LIVE_UPDATE_DEBOUNCE_MS || 900));
const BOT_HOST_METRIC_LIMIT = Math.max(30, Math.min(480, Number(process.env.BOT_HOST_METRIC_LIMIT || 240)));
const SESSION_IDLE_MS = Math.max(60_000, Number(process.env.SESSION_IDLE_MS || 10 * 60_000));
const TOURNAMENTS_ENABLED = String(process.env.TOURNAMENTS_ENABLED || '0') === '1';
const LAVALINK_URL = String(process.env.LAVALINK_URL || '').trim().replace(/\/+$/, '');
const LAVALINK_PASSWORD = String(process.env.LAVALINK_PASSWORD || process.env.LAVALINK_AUTH || '').trim();
const YTDLP_PATH = String(process.env.YTDLP_PATH || 'yt-dlp').trim();
const YTDLP_FORMAT = String(process.env.YTDLP_FORMAT || 'bestaudio[ext=m4a]/bestaudio[ext=webm]/bestaudio/best').trim();
const YTDLP_NO_CHECK_CERTIFICATES = String(process.env.YTDLP_NO_CHECK_CERTIFICATES || '1') !== '0';
const youtubeAudioUrlCache = new Map();

function getYtdlpCandidates() {
  const candidates = [YTDLP_PATH];
  if (YTDLP_PATH === 'yt-dlp') {
    candidates.push(
      path.join(os.homedir(), '.local', 'bin', 'yt-dlp'),
      '/usr/local/bin/yt-dlp',
      '/usr/bin/yt-dlp'
    );
  }
  return [...new Set(candidates.filter(Boolean))];
}
let nextAnonymousPlayerId = -1;

function cleanGameChatMessage(message) {
  return String(message || '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 240);
}

function getSocketGameState(socket) {
  const state = gm.getBySocket(socket.id);
  if (!state || state.status !== 'active') return null;
  const side = gm._side(state, socket.id);
  if (!side) return null;
  return { state, side, opponentSide: side === 1 ? 2 : 1 };
}

function getGameLatencyPayload(state) {
  return {
    1: Number.isFinite(Number(state?.players?.[1]?.pingMs)) ? Math.round(Number(state.players[1].pingMs)) : null,
    2: Number.isFinite(Number(state?.players?.[2]?.pingMs)) ? Math.round(Number(state.players[2].pingMs)) : null,
  };
}

function rememberFinishedGameSockets(result) {
  if (!result?.players) return;
  const p1 = result.players[1];
  const p2 = result.players[2];
  for (const socket of io.sockets.sockets.values()) {
    if (Number(socket.playerId) !== Number(p1?.id) && Number(socket.playerId) !== Number(p2?.id)) continue;
    socket.lastFinishedGame = {
      gameId: result.gameId,
      gameType: String(result.gameType || 'ranked'),
      players: result.players,
      finishedAt: Date.now(),
    };
  }
}

function emitGameOver(result) {
  if (!result || result.error) return result;
  io.to('game:' + result.gameId).emit('game_over', result);
  rememberFinishedGameSockets(result);
  emitLiveUpdate();
  broadcastPresenceCounts(true);
  setTimeout(() => liveReactions.delete(Number(result.gameId)), 30_000).unref?.();
  return result;
}

let liveUpdateTimer = null;
function emitLiveUpdate() {
  if (liveUpdateTimer) return;
  liveUpdateTimer = setTimeout(() => {
    liveUpdateTimer = null;
    io.to('live').emit('live_update');
  }, LIVE_UPDATE_DEBOUNCE_MS);
  liveUpdateTimer.unref?.();
}

function leaveLiveSpectate(socket) {
  if (!socket?.liveSpectateGameId) return;
  socket.leave(`live:spectate:${socket.liveSpectateGameId}`);
  socket.liveSpectateGameId = null;
}

function getLiveSpectators(gameId) {
  const id = Number(gameId || 0);
  if (!id) return [];
  const viewers = [];
  const seen = new Set();
  for (const socket of io.sockets.sockets.values()) {
    if (Number(socket.liveSpectateGameId || 0) !== id) continue;
    const player = socket.playerData || null;
    const key = player?.id ? `p:${player.id}` : `a:${socket.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    viewers.push({
      id: player?.id || null,
      pseudo: player?.pseudo || 'Anonyme',
      anonymous: !player?.pseudo,
    });
  }
  viewers.sort((a, b) => Number(a.anonymous) - Number(b.anonymous) || String(a.pseudo).localeCompare(String(b.pseudo), 'fr'));
  return viewers.slice(0, 24);
}

function getTournamentQueue(tournamentId) {
  const id = Number(tournamentId);
  if (!tournamentQueues.has(id)) tournamentQueues.set(id, new Matchmaking());
  return tournamentQueues.get(id);
}

function getOnlineSocketIds(playerId) {
  return [...(onlineSockets.get(Number(playerId)) || new Set())];
}

function removeSocketPresence(socket, { notifyExpired = false } = {}) {
  if (!socket?.playerId) return false;
  const playerId = Number(socket.playerId);
  const before = `${getPresenceCounts().onlinePlayers}:${getPresenceCounts().visitors}`;
  if (!isAnonymousPlayerId(playerId)) rQ.updateLastSeen.run(Date.now(), playerId);
  const sockets = onlineSockets.get(playerId);
  if (sockets) {
    sockets.delete(socket.id);
    if (sockets.size === 0) {
      onlineSockets.delete(playerId);
      if (!isAnonymousPlayerId(playerId)) {
        scheduleDiscordConnectedRemoval(playerId);
        scheduleCrystalLoginClear(playerId);
      }
    }
  }
  socket.playerId = null;
  socket.playerData = null;
  socket.sessionToken = null;
  const afterCounts = getPresenceCounts();
  const after = `${afterCounts.onlinePlayers}:${afterCounts.visitors}`;
  if (before !== after) broadcastPresenceCounts();
  if (notifyExpired) socket.emit('session_expired', { message: "Session expirée après 10 minutes d'inactivité. Reconnecte-toi." });
  return true;
}

function expireSocketSession(socket) {
  if (!socket) return;
  socket.emit('session_expired', { message: "Session expirée après 10 minutes d'inactivité. Reconnecte-toi." });
  setTimeout(() => {
    if (socket.connected) socket.disconnect(true);
  }, 25);
}

function notifyPlayerProfileChanged(playerId, reason, details = {}) {
  const id = Number(playerId || 0);
  if (!id) return;
  const payload = {
    reason: String(reason || 'Profil mis a jour.'),
    at: Date.now(),
    ...details,
  };
  getOnlineSocketIds(id).forEach(socketId => {
    io.to(socketId).emit('profile_changed', payload);
  });
}

function cancelCrystalLoginClear(playerId) {
  const id = Number(playerId || 0);
  const timer = crystalLoginClearTimers.get(id);
  if (!timer) return;
  clearTimeout(timer);
  crystalLoginClearTimers.delete(id);
}

function shouldBroadcastCrystalLogin(playerId) {
  const id = Number(playerId || 0);
  if (!id || crystalLoginAnnounced.has(id)) return false;
  crystalLoginAnnounced.add(id);
  return true;
}

function scheduleCrystalLoginClear(playerId) {
  const id = Number(playerId || 0);
  if (!id) return;
  cancelCrystalLoginClear(id);
  const timer = setTimeout(() => {
    crystalLoginClearTimers.delete(id);
    const sockets = onlineSockets.get(id);
    if (sockets && sockets.size > 0) return;
    crystalLoginAnnounced.delete(id);
  }, 2 * 60 * 1000);
  crystalLoginClearTimers.set(id, timer);
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

function getRegistrationCounts() {
  const row = db.prepare(`
    SELECT
      SUM(CASE WHEN is_bot = 0 THEN 1 ELSE 0 END) AS humans,
      SUM(CASE WHEN is_bot = 1 THEN 1 ELSE 0 END) AS bots,
      SUM(CASE WHEN is_bot = 0 AND TRIM(COALESCE(discord_id, '')) != '' THEN 1 ELSE 0 END) AS discord_humans
    FROM players
    WHERE deleted = 0 AND is_guest = 0
  `).get() || {};
  return {
    registeredHumans: Number(row.humans || 0),
    registeredBots: Number(row.bots || 0),
    registeredDiscordPlayers: Number(row.discord_humans || 0),
  };
}

function getPresenceCounts() {
  const onlinePlayers = Number(onlineSockets.size || 0);
  const onlineBots = getOnlineBotCount();
  const visitors = Number(getVisitorCount() || 0);
  const registrations = getRegistrationCounts();
  return {
    onlinePlayers,
    onlineBots,
    visitors,
    totalPresent: onlinePlayers + onlineBots + visitors,
    activeGames: getActiveGameCount(),
    ...registrations,
    registeredPlayers: registrations.registeredHumans + registrations.registeredBots,
  };
}

function getOnlinePlayers() {
  return [...onlineSockets.keys()]
    .map(playerId => getPlayerRecord(playerId))
    .filter(player => player && !isAnonymousPlayerId(player.id) && Number(player.is_bot || 0) !== 1)
    .map(player => ({
      id: Number(player.id),
      pseudo: String(player.pseudo || `Joueur ${player.id}`),
    }));
}

function getActiveGameCount() {
  if (gm?.games instanceof Map) {
    return [...gm.games.values()].filter(game => game?.status === 'active').length;
  }
  return Number(db.prepare(`SELECT COUNT(*) AS c FROM games WHERE status = 'active'`).get()?.c || 0);
}

function getWebhookSiteSnapshot() {
  const presence = getPresenceCounts();
  const count = (sql, params = []) => {
    try { return Number(db.prepare(sql).get(...params)?.c || 0); } catch { return 0; }
  };
  return {
    totalPresent: presence.totalPresent,
    onlinePlayers: presence.onlinePlayers,
    onlineBots: presence.onlineBots,
    visitors: presence.visitors,
    activeGames: getActiveGameCount(),
    players: count(`SELECT COUNT(*) AS c FROM players WHERE deleted = 0 AND is_guest = 0 AND is_bot = 0`),
    bots: count(`SELECT COUNT(*) AS c FROM players WHERE deleted = 0 AND is_guest = 0 AND is_bot = 1`),
    finishedGames: count(`SELECT COUNT(*) AS c FROM games WHERE status = 'finished'`),
    activeTournaments: count(`SELECT COUNT(*) AS c FROM tournaments WHERE status IN ('pending','active','paused')`),
    linkedDiscord: count(`SELECT COUNT(*) AS c FROM players WHERE deleted = 0 AND is_guest = 0 AND COALESCE(discord_id, '') != ''`),
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
  const signature = [
    counts.onlinePlayers,
    counts.onlineBots,
    counts.visitors,
    counts.totalPresent,
    counts.activeGames,
    counts.registeredHumans,
    counts.registeredDiscordPlayers,
    counts.registeredBots,
  ].join(':');
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

function parseHistoryDateBound(value, endOfDay = false) {
  const raw = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return 0;
  const suffix = endOfDay ? 'T23:59:59.999' : 'T00:00:00.000';
  const ms = Date.parse(`${raw}${suffix}`);
  return Number.isFinite(ms) ? ms : 0;
}

function buildPlayerEloHistory(playerId, daysRaw = 7, range = {}) {
  const id = Number(playerId || 0);
  let days = [1, 7, 15].includes(Number(daysRaw)) ? Number(daysRaw) : 7;
  const player = pQ.getById.get(id);
  if (!player || (player.deleted && player.id !== BOT_PLAYER_ID)) return null;

  const realNow = Date.now();
  let now = realNow;
  let start = now - days * 24 * 60 * 60 * 1000;
  const requestedStart = parseHistoryDateBound(range.start, false);
  const requestedEnd = parseHistoryDateBound(range.end, true);
  if (requestedStart && requestedEnd && requestedEnd >= requestedStart) {
    start = requestedStart;
    now = Math.min(requestedEnd, realNow);
    days = Math.max(1, Math.ceil((now - start) / (24 * 60 * 60 * 1000)));
  }
  const rows = db.prepare(`
    SELECT g.id, g.player1_id, g.player2_id, g.winner_id,
           g.elo_p1, g.elo_p2, g.elo_before_p1, g.elo_before_p2,
           g.finished_at, g.move_count, g.duration, g.game_type,
           p1.pseudo AS p1_pseudo, p1.elo AS p1_current_elo, p1.is_bot AS p1_is_bot,
           p2.pseudo AS p2_pseudo, p2.elo AS p2_current_elo, p2.is_bot AS p2_is_bot
    FROM games g
    JOIN players p1 ON p1.id = g.player1_id
    JOIN players p2 ON p2.id = g.player2_id
    WHERE (g.player1_id = ? OR g.player2_id = ?)
      AND g.status = 'finished'
      AND COALESCE(g.variant, 'classic') = 'classic'
      AND g.finished_at IS NOT NULL
    ORDER BY g.finished_at ASC, g.id ASC
  `).all(id, id);

  const games = rows
    .map(game => ({ ...game, finishedMs: parseSqliteDateMs(game.finished_at) }))
    .filter(game => game.finishedMs >= start && game.finishedMs <= now);
  const deltas = games.map(game => Number(game.player1_id) === id ? Number(game.elo_p1 || 0) : Number(game.elo_p2 || 0));
  const currentElo = Number(player.elo || 0);
  let running = currentElo - deltas.reduce((sum, delta) => sum + delta, 0);
  const points = [{
    t: start,
    elo: running,
    delta: 0,
    gameId: null,
    result: 'start',
    label: 'Debut',
  }];

  games.forEach((game, index) => {
    const isP1 = Number(game.player1_id) === id;
    const opponentId = isP1 ? Number(game.player2_id) : Number(game.player1_id);
    const beforeElo = isP1 ? Number(game.elo_before_p1 || 0) : Number(game.elo_before_p2 || 0);
    const opponentBeforeElo = isP1 ? Number(game.elo_before_p2 || 0) : Number(game.elo_before_p1 || 0);
    const delta = deltas[index];
    running += delta;
    points.push({
      t: game.finishedMs,
      finishedAt: game.finished_at || null,
      elo: running,
      delta,
      beforeElo: beforeElo || running - delta,
      afterElo: running,
      gameId: game.id,
      moveCount: game.move_count || 0,
      duration: game.duration || 0,
      type: game.game_type || 'ranked',
      result: game.winner_id == null ? 'draw' : Number(game.winner_id) === id ? 'win' : 'loss',
      opponent: {
        id: opponentId,
        pseudo: isP1 ? game.p2_pseudo : game.p1_pseudo,
        isBot: Number(isP1 ? game.p2_is_bot : game.p1_is_bot) === 1,
        eloBefore: opponentBeforeElo || null,
        currentElo: Number(isP1 ? game.p2_current_elo : game.p1_current_elo) || null,
      },
      label: `Partie #${game.id}`,
    });
  });

  if (!points.length || points[points.length - 1].t < now) {
    points.push({
      t: now,
      elo: currentElo,
      delta: 0,
      gameId: null,
      result: 'now',
      label: 'Maintenant',
    });
  }

  const eloValues = points.map(point => Number(point.elo || 0));
  const gamesAgainstBots = games.filter(game => Number(
    Number(game.player1_id) === id ? game.p2_is_bot : game.p1_is_bot
  ) === 1).length;
  const gamesAgainstHumans = games.length - gamesAgainstBots;
  const averageElo = eloValues.length
    ? Math.round(eloValues.reduce((sum, elo) => sum + elo, 0) / eloValues.length)
    : currentElo;
  return {
    generatedAt: new Date(now).toISOString(),
    player: {
      id: player.id,
      pseudo: player.pseudo,
      color: player.color || '#ff2d55',
      elo_curve_color: player.elo_curve_color || '',
      elo_curve_color_secondary: player.elo_curve_color_secondary || '',
      elo_curve_rgb: Number(player.elo_curve_rgb || 0),
      elo_curve_rgb_speed: Number(player.elo_curve_rgb_speed || 1) || 1,
      elo_curve_rgb_direction: ['forward', 'reverse'].includes(String(player.elo_curve_rgb_direction || 'forward')) ? String(player.elo_curve_rgb_direction || 'forward') : 'forward',
      elo: currentElo,
      wins: Number(player.wins || 0),
      losses: Number(player.losses || 0),
      draws: Number(player.draws || 0),
      isBot: Number(player.is_bot || 0) === 1,
      rank: getRank(currentElo),
    },
    days,
    range: {
      start: new Date(start).toISOString(),
      end: new Date(now).toISOString(),
      custom: !!(requestedStart && requestedEnd && requestedEnd >= requestedStart),
    },
    points,
    stats: {
      startTime: start,
      endTime: now,
      startElo: points[0]?.elo ?? currentElo,
      endElo: currentElo,
      delta: currentElo - (points[0]?.elo ?? currentElo),
      minElo: Math.min(...eloValues, currentElo),
      maxElo: Math.max(...eloValues, currentElo),
      averageElo,
      games: games.length,
      gamesAgainstHumans,
      gamesAgainstBots,
    },
  };
}

function buildPlayerEloHistoryCsv(history) {
  const rows = Array.isArray(history?.points) ? history.points : [];
  const headers = [
    'player_id', 'player_pseudo', 'player_current_elo', 'days',
    'index', 'point_type', 'date_iso', 'timestamp_ms',
    'elo_before', 'elo_after', 'delta',
    'game_id', 'game_type', 'result', 'move_count', 'duration_seconds',
    'opponent_id', 'opponent_pseudo', 'opponent_elo_before', 'opponent_current_elo',
    'rank_label',
  ];
  const escapeCsv = value => `"${String(value ?? '').replace(/"/g, '""')}"`;
  const lines = rows.map((point, index) => {
    const row = {
      player_id: history.player?.id || '',
      player_pseudo: history.player?.pseudo || '',
      player_current_elo: history.player?.elo || '',
      days: history.days || '',
      index,
      point_type: point.result || '',
      date_iso: point.t ? new Date(Number(point.t)).toISOString() : '',
      timestamp_ms: point.t || '',
      elo_before: point.beforeElo ?? point.elo ?? '',
      elo_after: point.afterElo ?? point.elo ?? '',
      delta: point.delta ?? '',
      game_id: point.gameId || '',
      game_type: point.type || '',
      result: point.result || '',
      move_count: point.moveCount || '',
      duration_seconds: point.duration || '',
      opponent_id: point.opponent?.id || '',
      opponent_pseudo: point.opponent?.pseudo || '',
      opponent_elo_before: point.opponent?.eloBefore || '',
      opponent_current_elo: point.opponent?.currentElo || '',
      rank_label: history.player?.rank?.label || history.player?.rank?.name || '',
    };
    return headers.map(key => escapeCsv(row[key])).join(',');
  });
  return [headers.join(','), ...lines].join('\n');
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
    search_nameplate: fresh.search_nameplate || '',
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
    duelChallenges.set(challenge.id, challenge);
    return { error: 'Connexion du duel pas encore prête. Réessaie dans une seconde.' };
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
  const state = _startMatch(p1, p2, {
    duel: true,
    gameType: challenge.gameType || 'ranked',
    persist: !anonymousFriendlyMatch,
  });
  return { ok: true, sender, target, gameId: state?.id || null };
}

gm._onAfkEnd = (result) => {
  if (!result) return;
  emitGameOver(result);
  console.log(`[AFK] Partie ${result.gameId} terminée : winner side ${result.winner}`);
};
gm._onGameFinished = ({ gameId, player1Id, player2Id, winnerId, isDraw, reason, payload }) => {
  try {
    applyTournamentResult(gameId, player1Id, player2Id, winnerId, isDraw);
    finalizeExpiredTournaments();
  } catch (e) {
    console.error('[TOURNOI] result hook:', e.message);
  }
  try {
    const game = gQ.getById.get(gameId);
    progression.processGame({
      gameId,
      player1Id,
      player2Id,
      winnerId,
      isDraw,
      moveCount: Number(game?.move_count || 0),
      duration: Number(payload?.duration || game?.duration || 0),
      gameType: String(payload?.gameType || game?.game_type || 'ranked'),
      isSuspect: !!payload?.isSuspect,
      eloChanges: payload?.eloChanges || {},
      reason,
    });
  } catch (e) {
    console.error('[PROGRESSION] result hook:', e.message);
  }
  syncPlayerDiscordRankRole(player1Id).catch(() => {});
  syncPlayerDiscordRankRole(player2Id).catch(() => {});
  setTimeout(() => {
    try { emitLiveUpdate(); } catch (_) {}
  }, 6500);
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

function hasDeveloperRoleIds(roleIds = [], guildRoles = []) {
  if (!Array.isArray(roleIds)) return false;
  if (DISCORD_ROLE_DEVELOPER && roleIds.includes(DISCORD_ROLE_DEVELOPER)) return true;
  const developerIds = new Set(
    (Array.isArray(guildRoles) ? guildRoles : [])
      .filter(role => /^(dev|developer|développeur|developpeur)$/i.test(String(role?.name || '').trim()))
      .map(role => String(role.id || ''))
      .filter(Boolean)
  );
  return roleIds.some(roleId => developerIds.has(String(roleId)));
}

function isPersoPlayer(player) {
  return !!player && (
    Number(player.is_perso) === 1
    || Number(player.is_bot) === 1
    || ['admin', 'moderator'].includes(String(player.role || ''))
  );
}

function isCrystalPlayer(player) {
  if (!player) return false;
  const expiresAt = Number(player.crystal_expires_at || 0);
  return Number(player.is_crystal || 0) === 1 && (!expiresAt || expiresAt > Date.now());
}

function isAdminPlayer(player) {
  return !!player && String(player.role || '') === 'admin';
}

function hasStaffRoleBenefits(player) {
  return !!player && ['admin', 'moderator'].includes(String(player.role || ''));
}

function isDeveloperPlayer(player) {
  return !!player && (Number(player.is_developer || 0) === 1 || String(player.role || '') === 'developer');
}

function isPlayerBanned(player) {
  if (!player || Number(player.banned || 0) !== 1) return false;
  const until = Number(player.banned_until || 0);
  if (until > 0 && until <= Date.now()) {
    pQ.setBanned.run({ banned: 0, until: null, id: player.id });
    player.banned = 0;
    player.banned_until = null;
    return false;
  }
  return true;
}

function canUseGradientPlayer(player) {
  return hasStaffRoleBenefits(player) || isVipPlusPlayer(player) || isPersoPlayer(player);
}

function getPremiumTier(player) {
  if (isCrystalPlayer(player)) return 'crystal';
  if (isPersoPlayer(player)) return 'perso';
  if (isVipPlusPlayer(player)) return 'vip_plus';
  if (isVipPlayer(player)) return 'vip';
  return null;
}

function getPremiumBoostConfig(player) {
  const tier = getPremiumTier(player);
  if (tier === 'crystal') return { tier, multiplier: 1.3, durationMs: 60 * 60 * 1000, daily: true, label: 'CRYSTAL' };
  if (tier === 'vip') return { tier, multiplier: 1.2, durationMs: 60 * 60 * 1000, daily: true, label: 'VIP' };
  if (tier === 'vip_plus') return { tier, multiplier: 1.3, durationMs: 60 * 60 * 1000, daily: true, label: 'VIP+' };
  if (tier === 'perso') return { tier, multiplier: 1.3, durationMs: 2 * 60 * 60 * 1000, daily: false, label: 'PERSO' };
  return null;
}

function isVipPlayer(player) {
  if (!player) return false;
  if (Number(player.is_bot) === 1) return true;
  const vipExpiresAt = Number(player.vip_expires_at || 0);
  if (vipExpiresAt && vipExpiresAt < Date.now() && Number(player.is_vip_plus) !== 1 && Number(player.is_perso) !== 1) return false;
  return Number(player.is_vip) === 1 || Number(player.is_vip_plus) === 1 || Number(player.is_perso) === 1 || isCrystalPlayer(player) || hasStaffRoleBenefits(player);
}

function isVipPlusPlayer(player) {
  return !!player && (Number(player.is_vip_plus) === 1 || Number(player.is_perso) === 1 || Number(player.is_bot) === 1 || isCrystalPlayer(player) || hasStaffRoleBenefits(player));
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
  const expires = Date.now() + SESSION_IDLE_MS;
  sQ.set.run(token, playerId, expires);
  return token;
}

function touchSession(token) {
  if (!token) return null;
  const row = sQ.get.get(token);
  if (!row) return null;
  if (Date.now() > row.expires) {
    sQ.del.run(token);
    return null;
  }
  sQ.touch.run(Date.now() + SESSION_IDLE_MS, token);
  return Number(row.player_id);
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
    search_nameplate: '',
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

function validateSession(token, { touch = true } = {}) {
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
  if (touch) sQ.touch.run(Date.now() + SESSION_IDLE_MS, token);
  return Number(row.player_id);
}

function hashBotToken(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

function makeBotToken() {
  return 'p4bot_' + crypto.randomBytes(24).toString('hex');
}

function botSocketId(playerId) {
  return `botapi:${Number(playerId)}`;
}

function getBotTokenFromReq(req) {
  const auth = String(req.headers.authorization || '');
  if (/^Bearer\s+/i.test(auth)) return auth.replace(/^Bearer\s+/i, '').trim();
  return String(req.headers['x-bot-token'] || req.query.botToken || '').trim();
}

function getBotFromRequest(req) {
  const token = getBotTokenFromReq(req);
  if (!token) return null;
  const tokenHash = hashBotToken(token);
  const bot = db.prepare(`
    SELECT * FROM players
    WHERE (bot_token_hash = ? OR bot_host_token_hash = ?) AND is_bot = 1 AND deleted = 0
    LIMIT 1
  `).get(tokenHash, tokenHash) || null;
  if (bot) {
    req.p4BotTokenHash = tokenHash;
    req.p4BotUsesHostToken = String(bot.bot_host_token_hash || '') === tokenHash;
  }
  return bot;
}

function meterBotHostNetwork(req, res, bot) {
  if (!req?.p4BotUsesHostToken || !bot) return;
  const botId = Number(bot.id || 0);
  if (!botId) return;
  let bytes = estimateRequestBytes(req);
  const child = getBotHostRuntime(botId);
  const addBytes = chunk => {
    if (!chunk) return;
    if (Buffer.isBuffer(chunk)) bytes += chunk.length;
    else bytes += Buffer.byteLength(String(chunk));
  };
  const originalWrite = res.write.bind(res);
  const originalEnd = res.end.bind(res);
  res.write = (chunk, ...args) => {
    addBytes(chunk);
    return originalWrite(chunk, ...args);
  };
  res.end = (chunk, ...args) => {
    addBytes(chunk);
    if (child && !child.killed) child.__p4NetBytes = Number(child.__p4NetBytes || 0) + bytes;
    else {
      const metrics = readBotHostMetrics(botId);
      const last = metrics[metrics.length - 1];
      const now = Date.now();
      if (!last || now - Number(last.at || 0) > 15_000) {
        appendBotHostMetric(botId, { at: now, cpuPct: 0, rssMb: 0, netKb: bytes / 1024 });
      } else {
        last.netKb = Number(last.netKb || 0) + bytes / 1024;
        db.prepare(`UPDATE bot_hosts SET metrics = ?, updated_at = ? WHERE bot_id = ?`).run(JSON.stringify(metrics.slice(-BOT_HOST_METRIC_LIMIT)), now, botId);
      }
    }
    return originalEnd(chunk, ...args);
  };
}

function ensureBotEnabled(bot, res) {
  if (!bot) {
    res.status(401).json({ error: 'Token bot invalide.' });
    return false;
  }
  if (Number(bot.bot_enabled || 0) !== 1) {
    res.status(403).json({ error: 'Compte bot suspendu par le staff.' });
    return false;
  }
  return true;
}

function publicBotRuntime(playerId) {
  if (builtinBotIds.has(Number(playerId))) {
    return { online: true, status: findActiveBotGame(playerId) ? 'playing' : 'ready', lastSeen: Date.now() };
  }
  const live = botRuntime.get(Number(playerId));
  return {
    online: !!live && Date.now() - Number(live.lastSeen || 0) < 45_000,
    status: live?.status || 'offline',
    lastSeen: Number(live?.lastSeen || 0),
  };
}

function getOnlineBotCount() {
  const rows = db.prepare(`SELECT id FROM players WHERE deleted = 0 AND is_guest = 0 AND is_bot = 1 AND bot_enabled = 1`).all();
  return rows.reduce((count, row) => count + (publicBotRuntime(row.id).online ? 1 : 0), 0);
}

const VIP_MEDIA_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const VIP_PLUS_MEDIA_COOLDOWN_MS = 12 * 60 * 60 * 1000;
const TOKEN_EMOJI_COOLDOWN_MS = 60 * 60 * 1000;
const AVATAR_DECORATION_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const PROFILE_BANNER_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;
const PSEUDO_CHANGE_COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000;
const VIP_MONTHLY_STYLE_COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000;
const PSEUDO_FONT_OPTIONS = new Set([
  'barlow', 'condensed', 'bebas',
  'orbitron', 'audiowide', 'russo', 'chakra', 'rajdhani', 'oxanium', 'pressstart', 'bungee',
  'playfair', 'cinzel', 'merriweather', 'cormorant', 'abril', 'prata', 'bodoni',
  'unifraktur', 'medieval',
  'silkscreen', 'rubikglitch', 'jacquard', 'metalmania', 'creepster', 'fredericka', 'imfell',
  'pacifico', 'caveat', 'lobster', 'dancing', 'satisfy', 'permanent', 'shadows', 'luckiest',
  'eaglelake', 'uncial',
  'oswald', 'anton', 'teko', 'righteous',
  'mono', 'serif', 'script',
]);
const PSEUDO_FONT_CATALOG = [
  'bebas', 'anton', 'righteous', 'silkscreen',
  'orbitron', 'audiowide', 'chakra', 'pressstart', 'bungee', 'rubikglitch',
  'playfair', 'cinzel', 'abril', 'prata', 'bodoni', 'fredericka',
  'pacifico', 'lobster', 'permanent', 'luckiest', 'eaglelake', 'uncial',
  'unifraktur', 'medieval', 'jacquard', 'metalmania', 'creepster', 'imfell',
];
const DECORATIONS_DIR = path.join(__dirname, 'public', 'decorations');
const SEARCH_NAMEPLATES_DIR = path.join(__dirname, 'public', 'nameplates');
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

function getSearchNameplatePaths() {
  try {
    return fs.readdirSync(SEARCH_NAMEPLATES_DIR, { withFileTypes: true })
      .filter(entry => entry.isFile() && /^[a-zA-Z0-9._ -]+$/.test(entry.name) && /\.(png|jpe?g|webp|gif)$/i.test(entry.name))
      .map(entry => `/nameplates/${entry.name}`)
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
  if (hasStaffRoleBenefits(player)) return 0;
  const lastChanged = Number(player?.vip_media_changed_at || 0);
  const cooldown = isVipPlusPlayer(player) ? VIP_PLUS_MEDIA_COOLDOWN_MS : VIP_MEDIA_COOLDOWN_MS;
  const remaining = lastChanged + cooldown - Date.now();
  return remaining > 0 ? remaining : 0;
}

function getAvatarDecorationRemainingMs(player) {
  if (hasStaffRoleBenefits(player)) return 0;
  const lastChanged = Number(player?.avatar_decoration_changed_at || 0);
  const remaining = lastChanged + AVATAR_DECORATION_COOLDOWN_MS - Date.now();
  return remaining > 0 ? remaining : 0;
}

function getProfileBannerRemainingMs(player) {
  if (hasStaffRoleBenefits(player)) return 0;
  const lastChanged = Number(player?.profile_banner_changed_at || 0);
  const remaining = lastChanged + PROFILE_BANNER_COOLDOWN_MS - Date.now();
  return remaining > 0 ? remaining : 0;
}

function normalizeHexColor(value) {
  const raw = String(value || '').trim();
  return /^#[0-9a-fA-F]{6}$/.test(raw) ? raw.toUpperCase() : '';
}

function getPseudoStyleRemainingMs(player) {
  if (hasStaffRoleBenefits(player) || isPersoPlayer(player)) return 0;
  const lastChanged = Number(player?.pseudo_style_changed_at || 0);
  const cooldown = isVipPlusPlayer(player) ? VIP_MEDIA_COOLDOWN_MS : VIP_MONTHLY_STYLE_COOLDOWN_MS;
  const remaining = lastChanged + cooldown - Date.now();
  return remaining > 0 ? remaining : 0;
}

function getEloCurveRemainingMs(player) {
  if (hasStaffRoleBenefits(player) || isPersoPlayer(player)) return 0;
  const lastChanged = Number(player?.elo_curve_changed_at || 0);
  const remaining = lastChanged + VIP_MEDIA_COOLDOWN_MS - Date.now();
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
const BOT_AVATAR = '/assets/bot-logo.png';
const BOT_BANNER = 'https://i.pinimg.com/1200x/0b/10/ae/0b10aed237a4092f5b6ebf89bccdffbb.jpg';
const BOT_START_ELO = 1200;
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
    const r  = db.prepare(`INSERT INTO players (pseudo, password, elo, wins, losses, draws, color, shape, avatar, banner, deleted) VALUES (?, '', ?, 0, 0, 0, ?, ?, ?, ?, 0)`).run(BOT_PSEUDO, BOT_START_ELO, bc, bs, BOT_AVATAR, BOT_BANNER);
    BOT_PLAYER_ID = r.lastInsertRowid;
  }
  console.log(`[Bot] Puissance4-AI id=${BOT_PLAYER_ID}`);
}

const PRECONFIGURED_BOTS = [
  { pseudo: 'P4-Bot-Nova', elo: BOT_START_ELO, skill: 820, color: '#85EBFF', shape: 'circle', depth: 7, description: 'Robot competitif profondeur 7, parfait pour tester les ouvertures.' },
  { pseudo: 'P4-Bot-Orion', elo: BOT_START_ELO, skill: 1120, color: '#ffd60a', shape: 'diamond', depth: 8, description: 'Robot competitif profondeur 8 avec une bonne priorite au centre.' },
  { pseudo: 'P4-Bot-Vega', elo: BOT_START_ELO, skill: 1450, color: '#ff2d55', shape: 'star', depth: 9, description: 'Robot tactique profondeur 9 qui cherche les menaces immediates.' },
  { pseudo: 'P4-Bot-Zenith', elo: BOT_START_ELO, skill: 1780, color: '#bf5af2', shape: 'heart', depth: 11, description: 'Robot avance profondeur 11, solide en defense comme en attaque.' },
];
const BOT_DEPTH_BY_PSEUDO = new Map(PRECONFIGURED_BOTS.map(bot => [bot.pseudo, bot.depth]));

function ensurePreconfiguredBots() {
  db.prepare(`UPDATE players SET is_bot = 1, bot_enabled = 1, bot_skill = ?, bot_description = ? WHERE id = ?`)
    .run(BOT_START_ELO, 'Bot officiel du site.', BOT_PLAYER_ID);
  builtinBotIds.add(Number(BOT_PLAYER_ID));

  const seededKey = 'builtin_bots_start_elo_1200';
  const shouldSeedStartElo = !db.prepare(`SELECT value FROM config WHERE key = ?`).get(seededKey);
  if (shouldSeedStartElo) {
    db.prepare(`UPDATE players SET elo = ? WHERE id = ?`).run(BOT_START_ELO, BOT_PLAYER_ID);
  }

  for (const bot of PRECONFIGURED_BOTS) {
    const existing = pQ.getByPseudo.get(bot.pseudo);
    if (existing) {
      db.prepare(`
        UPDATE players
        SET is_bot = 1, bot_enabled = 1, bot_skill = ?, bot_description = ?, color = ?, shape = ?, avatar = ?, deleted = 0
        WHERE id = ?
      `).run(bot.skill, bot.description, bot.color, bot.shape, BOT_AVATAR, existing.id);
      if (shouldSeedStartElo) {
        db.prepare(`UPDATE players SET elo = ? WHERE id = ?`).run(BOT_START_ELO, existing.id);
      }
      builtinBotIds.add(Number(existing.id));
      continue;
    }
    const inserted = db.prepare(`
      INSERT INTO players (pseudo, password, elo, color, shape, avatar, is_bot, bot_enabled, bot_skill, bot_description, deleted)
      VALUES (?, '', ?, ?, ?, ?, 1, 1, ?, ?, 0)
    `).run(bot.pseudo, bot.elo, bot.color, bot.shape, BOT_AVATAR, bot.skill, bot.description);
    builtinBotIds.add(Number(inserted.lastInsertRowid));
  }
  if (shouldSeedStartElo) {
    db.prepare(`INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)`).run(seededKey, String(Date.now()));
  }
}

ensurePreconfiguredBots();

function buildBotGamePayload(player, socketId = null) {
  const clean = sanitize(player);
  return {
    ...clean,
    socketId: socketId || botSocketId(clean.id),
    color: clean.color || '#ff2d55',
    shape: clean.shape || 'circle',
    token_emoji_image: clean.token_emoji_image || '',
    avatar_decoration: clean.avatar_decoration || '',
    search_nameplate: clean.search_nameplate || '',
    profile_banner: clean.profile_banner || '',
    color_secondary: clean.color_secondary || '',
    botSkill: Number(clean.bot_skill || clean.elo || 1000),
  };
}

function findActiveBotGame(playerId) {
  const id = Number(playerId);
  for (const state of gm.games.values()) {
    if (state.status !== 'active') continue;
    if (Number(state.players?.[1]?.id) === id || Number(state.players?.[2]?.id) === id) return state;
  }
  return null;
}

function findActiveGameByPlayer(playerId) {
  const id = Number(playerId);
  for (const state of gm.games.values()) {
    if (state.status !== 'active') continue;
    if (Number(state.players?.[1]?.id) === id || Number(state.players?.[2]?.id) === id) return state;
  }
  return null;
}

function serializeBotGameState(state, playerId) {
  if (!state) return null;
  const side = Number(state.players[1].id) === Number(playerId) ? 1 : 2;
  return {
    gameId: state.id,
    gameType: state.gameType || 'ranked',
    side,
    current: state.current,
    isMyTurn: side === state.current,
    board: state.board.grid,
    legalMoves: state.board.getValidCols(),
    moveCount: state.moveCount,
    moveTimeSeconds: state.moveTimeSeconds || 60,
    players: {
      1: { id: state.players[1].id, pseudo: state.players[1].pseudo, elo: state.players[1].elo, bot: !!state.players[1].is_bot },
      2: { id: state.players[2].id, pseudo: state.players[2].pseudo, elo: state.players[2].elo, bot: !!state.players[2].is_bot },
    },
  };
}

function chooseBuiltinBotMove(state, side) {
  const player = Number(side);
  const opponent = player === 1 ? 2 : 1;
  const cols = getOrderedValidCols(state.board.grid);
  if (!cols.length) return null;

  const depth = getBuiltinBotSearchDepth(state, player);
  const deadline = Date.now() + getBuiltinBotTimeBudget(state, player);
  const transposition = new Map();
  let bestCol = cols[0];
  let bestScore = -Infinity;
  let completedDepth = 0;

  for (const immediate of cols) {
    const board = cloneGrid(state.board.grid);
    const row = dropGrid(board, immediate, player);
    if (row >= 0 && checkWinGrid(board, row, immediate, player)) return immediate;
  }
  for (const block of cols) {
    const board = cloneGrid(state.board.grid);
    const row = dropGrid(board, block, opponent);
    if (row >= 0 && checkWinGrid(board, row, block, opponent)) return block;
  }

  for (let currentDepth = 1; currentDepth <= depth; currentDepth++) {
    if (Date.now() > deadline) break;
    let localBestCol = bestCol;
    let localBestScore = -Infinity;
    let completed = true;
    for (const col of cols) {
      if (Date.now() > deadline) {
        completed = false;
        break;
      }
      const board = cloneGrid(state.board.grid);
      const row = dropGrid(board, col, player);
      if (row < 0) continue;
      let score;
      if (checkWinGrid(board, row, col, player)) {
        score = 1_000_000 + currentDepth;
      } else {
        score = -negamaxBot(board, currentDepth - 1, opponent, player, -Infinity, Infinity, deadline, transposition, 1);
      }
      score += centerTieBreak(col);
      if (score > localBestScore) {
        localBestScore = score;
        localBestCol = col;
      }
    }
    if (!completed) break;
    completedDepth = currentDepth;
    bestScore = localBestScore;
    bestCol = localBestCol;
  }

  state.lastBotSearch = {
    player: state.players[player]?.pseudo || 'Bot',
    depthTarget: depth,
    depthCompleted: completedDepth,
    score: Math.round(bestScore),
  };
  return bestCol;
}

function getBuiltinBotSearchDepth(state, side) {
  const player = state.players[side] || {};
  const other = state.players[side === 1 ? 2 : 1] || {};
  let target = BOT_DEPTH_BY_PSEUDO.get(player.pseudo) || 8;
  if (Number(player.id) === Number(BOT_PLAYER_ID)) {
    target = Number(other.is_bot || 0) === 1 ? 13 : 7;
  }
  return Math.max(3, Math.min(BOT_MAX_SEARCH_DEPTH, target));
}

function getBuiltinBotTimeBudget(state, side) {
  const depth = getBuiltinBotSearchDepth(state, side);
  if (depth >= 12) return Math.max(BOT_SEARCH_TIME_MS, 850);
  if (depth >= 10) return Math.max(BOT_SEARCH_TIME_MS, 620);
  return Math.min(Math.max(BOT_SEARCH_TIME_MS, 140), 520);
}

function cloneGrid(grid) {
  return grid.map(row => row.slice());
}

function getOrderedValidCols(grid) {
  return [3, 2, 4, 1, 5, 0, 6].filter(col => grid[0]?.[col] === 0);
}

function dropGrid(grid, col, player) {
  for (let row = 5; row >= 0; row--) {
    if (grid[row][col] === 0) {
      grid[row][col] = player;
      return row;
    }
  }
  return -1;
}

function undoDropGrid(grid, row, col) {
  if (row >= 0) grid[row][col] = 0;
}

function checkWinGrid(grid, row, col, player) {
  const dirs = [[0, 1], [1, 0], [1, 1], [1, -1]];
  for (const [dr, dc] of dirs) {
    let count = 1;
    for (const sign of [1, -1]) {
      for (let step = 1; step < 4; step++) {
        const r = row + dr * step * sign;
        const c = col + dc * step * sign;
        if (r < 0 || r >= 6 || c < 0 || c >= 7 || grid[r][c] !== player) break;
        count++;
      }
    }
    if (count >= 4) return true;
  }
  return false;
}

function centerTieBreak(col) {
  return [3, 2, 4, 1, 5, 0, 6].indexOf(col) * -0.01;
}

function gridKey(grid, player, depth) {
  return `${player}|${depth}|${grid.map(row => row.join('')).join('')}`;
}

function negamaxBot(grid, depth, turn, maximizer, alpha, beta, deadline, transposition, ply) {
  if (Date.now() > deadline) return evaluateGrid(grid, turn);
  const validCols = getOrderedValidCols(grid);
  if (depth <= 0 || !validCols.length) return evaluateGrid(grid, turn);

  const key = gridKey(grid, turn, depth);
  const cached = transposition.get(key);
  if (cached !== undefined) return cached;

  let best = -Infinity;
  let exact = true;
  for (const col of validCols) {
    const row = dropGrid(grid, col, turn);
    if (row < 0) continue;
    let score;
    if (checkWinGrid(grid, row, col, turn)) {
      score = 1_000_000 - ply;
    } else {
      const nextTurn = turn === 1 ? 2 : 1;
      score = -negamaxBot(grid, depth - 1, nextTurn, maximizer, -beta, -alpha, deadline, transposition, ply + 1);
    }
    undoDropGrid(grid, row, col);
    if (score > best) best = score;
    if (score > alpha) alpha = score;
    if (alpha >= beta) {
      exact = false;
      break;
    }
    if (Date.now() > deadline) {
      exact = false;
      break;
    }
  }
  if (exact) transposition.set(key, best);
  return best;
}

function evaluateGrid(grid, player) {
  const opponent = player === 1 ? 2 : 1;
  let score = 0;

  const centerCount = grid.reduce((count, row) => count + (row[3] === player ? 1 : 0), 0);
  const opponentCenter = grid.reduce((count, row) => count + (row[3] === opponent ? 1 : 0), 0);
  score += (centerCount - opponentCenter) * 34;

  for (let r = 0; r < 6; r++) {
    for (let c = 0; c < 4; c++) score += scoreWindowGrid([grid[r][c], grid[r][c + 1], grid[r][c + 2], grid[r][c + 3]], player);
  }
  for (let c = 0; c < 7; c++) {
    for (let r = 0; r < 3; r++) score += scoreWindowGrid([grid[r][c], grid[r + 1][c], grid[r + 2][c], grid[r + 3][c]], player);
  }
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 4; c++) score += scoreWindowGrid([grid[r][c], grid[r + 1][c + 1], grid[r + 2][c + 2], grid[r + 3][c + 3]], player);
  }
  for (let r = 3; r < 6; r++) {
    for (let c = 0; c < 4; c++) score += scoreWindowGrid([grid[r][c], grid[r - 1][c + 1], grid[r - 2][c + 2], grid[r - 3][c + 3]], player);
  }
  return score;
}

function scoreWindowGrid(values, player) {
  const opponent = player === 1 ? 2 : 1;
  const mine = values.filter(v => v === player).length;
  const theirs = values.filter(v => v === opponent).length;
  const empty = values.filter(v => v === 0).length;
  if (mine === 4) return 100_000;
  if (theirs === 4) return -120_000;
  if (mine === 3 && empty === 1) return 920;
  if (mine === 2 && empty === 2) return 85;
  if (mine === 1 && empty === 3) return 8;
  if (theirs === 3 && empty === 1) return -1_120;
  if (theirs === 2 && empty === 2) return -105;
  if (theirs === 1 && empty === 3) return -10;
  return 0;
}

function randomMatchColor(exclude = []) {
  const palette = ['#ff2d55', '#ffd60a', '#30d158', '#0a84ff', '#bf5af2', '#ff9f0a', '#85ebff', '#ff7eb6', '#2dc5c1', '#ff453a'];
  const blocked = new Set(exclude.filter(Boolean).map(c => String(c).toLowerCase()));
  const available = palette.filter(c => !blocked.has(c.toLowerCase()));
  const pool = available.length ? available : palette;
  return pool[Math.floor(Math.random() * pool.length)];
}

function assignDistinctMatchColors(p1, p2) {
  p1.color = randomMatchColor();
  p2.color = randomMatchColor([p1.color]);
}

function scheduleBuiltinBotTurn(gameId, delayMs = 700) {
  setTimeout(() => {
    const state = gm.games.get(gameId);
    if (!state || state.status !== 'active') return;
    const side = state.current;
    const player = state.players[side];
    if (!builtinBotIds.has(Number(player?.id))) return;
    const col = chooseBuiltinBotMove(state, side);
    if (col === null) return;
    const result = gm.playMove(player.socketId, col);
    if (result?.gameId) {
      if (result.type === 'game_over') emitGameOver(result);
      else io.to('game:' + result.gameId).emit('move_played', result);
      if (result.type === 'game_over') {
        const now = Date.now();
        for (const sideId of [state.players?.[1]?.id, state.players?.[2]?.id]) {
          if (builtinBotIds.has(Number(sideId))) botArenaRestUntil.set(Number(sideId), now + BOT_ARENA_REST_MS);
        }
      }
    }
    if (result?.type !== 'game_over') emitLiveUpdate();
    scheduleBuiltinBotTurn(gameId, 650 + Math.floor(Math.random() * 600));
  }, delayMs);
}

function createBotVsBotGame(botA, botB, gameType = 'ranked') {
  const p1 = buildBotGamePayload(botA, botSocketId(botA.id));
  const p2 = buildBotGamePayload(botB, botSocketId(botB.id));
  assignDistinctMatchColors(p1, p2);
  const state = gm.create(p1, p2, { gameType, moveTimeSeconds: 60, current: Math.random() < 0.5 ? 1 : 2 });
  emitLiveUpdate();
  broadcastPresenceCounts(true);
  scheduleBuiltinBotTurn(state.id, 500);
  return state;
}

function createChallengeVsBotGame(challenger, targetBot, gameType = 'ranked') {
  const challengerIsBot = Number(challenger?.is_bot || 0) === 1;
  const p1 = challengerIsBot
    ? buildBotGamePayload(challenger, botSocketId(challenger.id))
    : buildPlayableSocketPayload(challenger);
  p1.socketId = challengerIsBot ? botSocketId(challenger.id) : `bot-challenge:${Number(challenger.id)}:${crypto.randomUUID()}`;

  const p2 = buildBotGamePayload(targetBot, botSocketId(targetBot.id));
  assignDistinctMatchColors(p1, p2);

  const current = challengerIsBot && Math.random() < 0.5 ? 1 : 2;
  const state = gm.create(p1, p2, { gameType, moveTimeSeconds: 60, current });
  emitLiveUpdate();
  broadcastPresenceCounts(true);
  if (builtinBotIds.has(Number(p1.id)) || builtinBotIds.has(Number(p2.id))) scheduleBuiltinBotTurn(state.id, 500);
  return state;
}

// AAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAA Archivage automatique des parties > 14 jours AAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAA
function botArenaPairKey(a, b) {
  return [Number(a), Number(b)].sort((x, y) => x - y).join(':');
}

function countActiveBuiltinBotGames() {
  let count = 0;
  for (const state of gm.games.values()) {
    if (!state || state.status !== 'active') continue;
    const p1 = Number(state.players?.[1]?.id || 0);
    const p2 = Number(state.players?.[2]?.id || 0);
    if (builtinBotIds.has(p1) && builtinBotIds.has(p2)) count++;
  }
  return count;
}

function pickBackgroundBotPair() {
  const now = Date.now();
  const freeBots = [...builtinBotIds]
    .map(id => pQ.getById.get(id))
    .filter(bot => bot
      && !bot.deleted
      && Number(bot.bot_enabled || 0) === 1
      && !findActiveGameByPlayer(bot.id)
      && Number(botArenaRestUntil.get(Number(bot.id)) || 0) <= now)
    .sort(() => Math.random() - 0.5);
  if (freeBots.length < 2) return null;

  let best = null;
  let bestScore = Infinity;
  for (let i = 0; i < freeBots.length; i++) {
    for (let j = i + 1; j < freeBots.length; j++) {
      const a = freeBots[i];
      const b = freeBots[j];
      const key = botArenaPairKey(a.id, b.id);
      const lastPlayed = Number(botArenaPairs.get(key) || 0);
      if (now - lastPlayed < BOT_ARENA_PAIR_COOLDOWN_MS && freeBots.length > 2) continue;
      const eloDistance = Math.abs(Number(a.elo || 1000) - Number(b.elo || 1000));
      const freshnessPenalty = lastPlayed ? Math.max(0, BOT_ARENA_PAIR_COOLDOWN_MS - (now - lastPlayed)) / 1000 : 0;
      const score = eloDistance + freshnessPenalty + Math.random() * 40;
      if (score < bestScore) {
        bestScore = score;
        best = [a, b, key];
      }
    }
  }
  return best;
}

function runBackgroundBotMatchmaking(reason = 'loop') {
  if (!BOT_ARENA_ENABLED || BOT_ARENA_MAX_ACTIVE <= 0) return;
  try {
    const active = countActiveBuiltinBotGames();
    if (active >= BOT_ARENA_MAX_ACTIVE) return;
    for (let slot = active; slot < BOT_ARENA_MAX_ACTIVE; slot++) {
      const pair = pickBackgroundBotPair();
      if (!pair) return;
      const [botA, botB, key] = pair;
      botArenaPairs.set(key, Date.now());
      botArenaRestUntil.set(Number(botA.id), Date.now() + BOT_ARENA_REST_MS);
      botArenaRestUntil.set(Number(botB.id), Date.now() + BOT_ARENA_REST_MS);
      botRuntime.set(Number(botA.id), { status: 'arena', lastSeen: Date.now() });
      botRuntime.set(Number(botB.id), { status: 'arena', lastSeen: Date.now() });
      const state = createBotVsBotGame(botA, botB, 'ranked');
      console.log(`[BOT-ARENA] ${reason}: ${botA.pseudo} vs ${botB.pseudo} game=${state.id}`);
    }
  } catch (error) {
    console.error('[BOT-ARENA]', error.message);
  }
}

if (BOT_ARENA_ENABLED) {
  setTimeout(() => runBackgroundBotMatchmaking('startup'), 8_000);
  setInterval(() => runBackgroundBotMatchmaking('interval'), BOT_ARENA_INTERVAL_MS);
}

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

app.use(express.json({ limit: '14mb' })); // avatars/bannieres/fonds base64

// Laboratoire de variantes : acces volontairement separe des comptes et des parties classees.
// Le jeton reste en memoire et expire rapidement ; aucun profil ni resultat n'est persiste.
const betaAccessTokens = new Map();
const betaLoginAttempts = new Map();
const BETA_ACCESS_TTL_MS = 6 * 60 * 60 * 1000;
const BETA_GAME_PASSWORD = String(process.env.BETA_GAME_PASSWORD || 'beta4');

function safeSecretEqual(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function betaClientKey(req) {
  return String((req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress || 'unknown');
}

app.post('/api/beta-game/login', (req, res) => {
  const key = betaClientKey(req);
  const attempt = betaLoginAttempts.get(key) || { count: 0, resetAt: 0 };
  if (Date.now() > attempt.resetAt) Object.assign(attempt, { count: 0, resetAt: Date.now() + 10 * 60 * 1000 });
  if (attempt.count >= 8) return res.status(429).json({ error: 'Trop de tentatives. Reessaie dans quelques minutes.' });
  if (!safeSecretEqual(req.body?.password, BETA_GAME_PASSWORD)) {
    attempt.count += 1;
    betaLoginAttempts.set(key, attempt);
    return res.status(401).json({ error: 'Mot de passe incorrect.' });
  }
  betaLoginAttempts.delete(key);
  const token = crypto.randomBytes(32).toString('hex');
  betaAccessTokens.set(token, Date.now() + BETA_ACCESS_TTL_MS);
  res.json({ token, expiresIn: BETA_ACCESS_TTL_MS });
});

app.get('/api/beta-game/session', (req, res) => {
  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const expiresAt = betaAccessTokens.get(token) || 0;
  if (!token || expiresAt <= Date.now()) {
    if (token) betaAccessTokens.delete(token);
    return res.status(401).json({ valid: false });
  }
  res.json({ valid: true, expiresAt });
});

app.get('/profil.html', renderProfilePage);
app.get('/leaderboard.html', renderStaticPage('leaderboard.html', { title: 'Classement - Puissance 4', description: 'Consulte le classement des meilleurs joueurs Puissance 4.' }));
app.get('/players.html', renderStaticPage('players.html', { title: 'Joueurs - Puissance 4', description: 'Trouve les joueurs Puissance 4, leurs profils et leurs statistiques.' }));
app.get('/boutique.html', renderStaticPage('boutique.html', { title: 'Boutique - Puissance 4', description: 'Personnalise ton profil Puissance 4 avec des cosmetiques.' }));
app.get('/regles.html', renderStaticPage('regles.html', { title: 'Regles - Puissance 4', description: 'Apprends les regles du Puissance 4 et les bases pour gagner.' }));
app.get('/stats.html', renderStaticPage('stats.html', { title: 'Statistiques - Puissance 4', description: 'Explore les statistiques globales de Puissance 4.' }));
app.get('/news.html', renderStaticPage('news.html', { title: 'Nouveautes - Puissance 4', description: 'Decouvre les dernieres nouveautes de Puissance 4.' }));
app.get('/analyse.html', renderStaticPage('analyse.html', { title: 'Analyse - Puissance 4', description: 'Analyse tes parties de Puissance 4 et ameliore tes coups.' }));
app.get('/progression.html', renderStaticPage('progression.html', { title: 'Progression - Puissance 4', description: 'Suis tes objectifs, recompenses et progres sur Puissance 4.' }));
app.use(express.static(path.join(__dirname, 'public'), {
  etag: true,
  lastModified: true,
  setHeaders(res, filePath) {
    if (/(?:service-worker\.js|manifest\.webmanifest|theme\.css|theme\.js|beta-game\.html)$/i.test(filePath)) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    } else if (/\.(?:png|jpe?g|webp|gif|svg|ico|mp3|wav|ogg|m4a|woff2?)$/i.test(filePath)) {
      res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
    } else if (/\.(?:css|js)$/i.test(filePath)) {
      res.setHeader('Cache-Control', 'public, max-age=3600');
    }
  },
}));

const API_AUDIT_EXCLUDED = [
  /^\/api\/system-status$/,
  /^\/api\/live$/,
  /^\/api\/stats$/,
  /^\/api\/bot\/ping$/,
  /^\/api\/bot\/move$/,
];
const API_AUDIT_SENSITIVE_KEYS = new Set([
  'password',
  'pwd',
  'token',
  'playerToken',
  'botToken',
  'bot_token',
  'code',
  'requestId',
  'adminToken',
  'discordCode',
  'secret',
  'authorization',
]);

function shouldAuditApiRequest(req) {
  const pathOnly = String(req.path || '').split('?')[0];
  if (!pathOnly.startsWith('/api/')) return false;
  if (API_AUDIT_EXCLUDED.some(pattern => pattern.test(pathOnly))) return false;
  return true;
}

function inferApiAuditActor(req) {
  return getApiAuditActorMeta(req).label;
}

function getApiAuditActorMeta(req) {
  try {
    const adminToken = String(req.headers['x-admin-token'] || '').trim();
    const adminSession = adminToken ? adminSessions.get(adminToken) : null;
    if (adminSession?.playerId) {
      const admin = pQ.getById.get(Number(adminSession.playerId));
      return {
        label: admin ? `${admin.pseudo} (#${admin.id}) [admin:${adminSession.role}]` : `Admin #${adminSession.playerId}`,
        id: Number(adminSession.playerId),
        pseudo: admin?.pseudo || '',
        admin: true,
      };
    }
    const token = String(
      req.headers['x-session-token']
      || req.body?.token
      || req.query?.token
      || ''
    ).trim();
    const playerId = token ? validateSession(token) : null;
    if (playerId) {
      const player = pQ.getById.get(Number(playerId));
      return {
        label: player ? `${player.pseudo} (#${player.id})` : `Joueur #${playerId}`,
        id: Number(playerId),
        pseudo: player?.pseudo || '',
        admin: false,
        bot: Number(player?.is_bot || 0) === 1,
      };
    }
    const pseudo = String(req.body?.pseudo || req.body?.username || '').trim().slice(0, 40);
    if (pseudo) return { label: `${pseudo} (non verifie)`, id: 0, pseudo, admin: false };
  } catch {}
  return { label: '', id: 0, pseudo: '', admin: false };
}

function classifyApiAuditEvent(req) {
  const pathOnly = String(req.path || '').split('?')[0];
  if (/\/auth\/login$/.test(pathOnly)) return 'connexion';
  if (/\/auth\/register$/.test(pathOnly)) return 'inscription';
  if (/\/admin\//.test(pathOnly)) return 'admin';
  if (/\/shop\//.test(pathOnly)) return 'boutique';
  if (/\/discord\//.test(pathOnly)) return 'discord';
  if (/\/duels?\//.test(pathOnly)) return 'duel';
  if (/\/clans?\//.test(pathOnly)) return 'clan';
  if (/\/tournaments?\//.test(pathOnly)) return 'tournoi';
  if (/\/players?\//.test(pathOnly)) return 'profil';
  if (/\/bot\//.test(pathOnly)) return 'bot-api';
  return 'site';
}

function summarizeApiAuditValue(key, value) {
  const lowerKey = String(key || '').toLowerCase();
  if (API_AUDIT_SENSITIVE_KEYS.has(key) || API_AUDIT_SENSITIVE_KEYS.has(lowerKey)) return '[masque]';
  if (value == null) return 'vide';
  if (typeof value === 'boolean') return value ? 'oui' : 'non';
  if (typeof value === 'number') return String(value);
  if (Array.isArray(value)) return `${value.length} element(s)`;
  if (typeof value === 'object') {
    if (lowerKey.includes('items')) return `${Object.keys(value).length} entree(s)`;
    return 'objet';
  }
  const text = String(value).trim();
  if (!text) return 'vide';
  if (/^data:image\//i.test(text) || text.length > 1800) return `[donnee volumineuse ${Math.ceil(text.length / 1024)} KB]`;
  if (/^https?:\/\//i.test(text)) return text.slice(0, 120);
  return text.length > 120 ? `${text.slice(0, 117)}...` : text;
}

function buildApiAuditChanges(req) {
  const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
  const entries = Object.entries(body)
    .filter(([key]) => !API_AUDIT_SENSITIVE_KEYS.has(key) && !API_AUDIT_SENSITIVE_KEYS.has(String(key).toLowerCase()))
    .filter(([key]) => !['captcha', 'confirm', 'adminIdentity'].includes(String(key)))
    .slice(0, 10);
  const parts = entries.map(([key, value]) => `${key}: ${summarizeApiAuditValue(key, value)}`);
  const targetId = req.params?.id || req.params?.playerId || '';
  if (targetId && !parts.some(part => part.startsWith('target:'))) parts.unshift(`target: #${targetId}`);
  return parts.join('\n');
}

function buildApiAuditMedia(req) {
  const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
  return {
    thumbnail: body.avatar || body.avatar_decoration || body.tokenEmojiImage || body.token_emoji_image || '',
    image: body.banner || body.profile_banner || body.profileBanner || '',
  };
}

function shouldSkipApiAuditEvent(req, event) {
  if (String(req.method || '').toUpperCase() !== 'GET') return false;
  const now = Date.now();
  const actorKey = event.actorId ? `p:${event.actorId}` : `a:${event.actor || 'anon'}`;
  const key = `${actorKey}:${event.path}:${event.status}`;
  const previous = apiAuditRecent.get(key) || 0;
  apiAuditRecent.set(key, now);
  if (apiAuditRecent.size > 500) {
    for (const [entryKey, at] of apiAuditRecent) {
      if (now - at > 30000) apiAuditRecent.delete(entryKey);
    }
  }
  return now - previous < 10000;
}
/*
app.use((req, res, next) => {
  if (!shouldAuditApiRequest(req)) return next();
  const startedAt = Date.now();
  const actorMeta = getApiAuditActorMeta(req);
  res.on('finish', () => {
    try {
      const event = {
        method: req.method,
        path: String(req.originalUrl || req.path || '').split('?')[0].slice(0, 180),
        status: res.statusCode,
        durationMs: Date.now() - startedAt,
        actor: actorMeta.label,
        actorId: actorMeta.id,
        actorPseudo: actorMeta.pseudo,
        admin: actorMeta.admin,
        bot: actorMeta.bot,
        kind: classifyApiAuditEvent(req),
        changes: buildApiAuditChanges(req),
        ...buildApiAuditMedia(req),
      };
      if (!shouldSkipApiAuditEvent(req, event)) WH.wlogApiEvent(event);
    } catch(e) {}
  });
  next();
});
*/
app.get('/api/system-status', (_, res) => {
  res.json(readSystemStatus());
});

// AAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAA SPA routing AAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAA
app.get('/',           renderStaticPage('index.html', { title: 'Puissance 4', description: 'Joue au Puissance 4 en ligne, defie tes amis, grimpe le classement et personnalise ton profil.' }));
app.get('/game',       renderStaticPage('game.html', { title: 'Partie - Puissance 4', description: 'Lance ou rejoins une partie Puissance 4 en ligne.' }));
app.get('/game/bot',   renderStaticPage('game.html', { title: 'Bot - Puissance 4', description: 'Affronte un bot Puissance 4 et entraine-toi.' }));
app.get('/beta-game',  (req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.set('Pragma', 'no-cache');
  next();
}, renderStaticPage('beta-game.html', { title: 'Laboratoire beta - Puissance 4', description: 'Teste les variantes experimentales du Puissance 4.' }));
app.get('/local',      renderStaticPage('local.html', { title: 'Mode local - Puissance 4', description: 'Joue au Puissance 4 sur le meme appareil.' }));
app.get('/spec/:id', (req, res) => {
  const gameId = Number(req.params.id);
  const state = gm.games.get(gameId);
  if (!state || state.status !== 'active') {
    return res.sendFile(path.join(__dirname, 'public/404.html'));
  }
  renderStaticPage('live.html', { title: 'Spectateur - Puissance 4', description: 'Regarde une partie Puissance 4 en direct.' })(req, res);
});

const DATA_DIR = path.join(__dirname, 'data');
const SYSTEM_STATUS_PATH = path.join(DATA_DIR, 'system-status.json');
const SYSTEM_ALERT_ANIMATIONS = new Set(['pulse', 'glow', 'shake', 'slide', 'none']);
const DEFAULT_SYSTEM_STATUS = {
  restarting: false,
  message: '',
  emoji: '\u26A0\uFE0F',
  color: '#ff9f0a',
  animation: 'pulse',
  updated_at: 0,
};

function normalizeSystemAlertColor(value) {
  const color = String(value || '').trim();
  return /^#[0-9a-fA-F]{6}$/.test(color) ? color : DEFAULT_SYSTEM_STATUS.color;
}

function normalizeSystemAlertEmoji(value) {
  const emoji = String(value || '').trim();
  return emoji ? [...emoji].slice(0, 4).join('') : DEFAULT_SYSTEM_STATUS.emoji;
}

function normalizeSystemAlertAnimation(value) {
  const animation = String(value || '').trim().toLowerCase();
  return SYSTEM_ALERT_ANIMATIONS.has(animation) ? animation : DEFAULT_SYSTEM_STATUS.animation;
}

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
      message: String(parsed?.message || '').slice(0, 180),
      emoji: normalizeSystemAlertEmoji(parsed?.emoji),
      color: normalizeSystemAlertColor(parsed?.color),
      animation: normalizeSystemAlertAnimation(parsed?.animation),
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
    message: String(nextStatus?.message || '').slice(0, 180),
    emoji: normalizeSystemAlertEmoji(nextStatus?.emoji),
    color: normalizeSystemAlertColor(nextStatus?.color),
    animation: normalizeSystemAlertAnimation(nextStatus?.animation),
    updated_at: Date.now(),
  };
  fs.writeFileSync(SYSTEM_STATUS_PATH, JSON.stringify(payload, null, 2), 'utf8');
  return payload;
}
app.get('/game/:id',   renderStaticPage('game.html', { title: 'Partie - Puissance 4', description: 'Rejoins cette partie Puissance 4 en ligne.' }));

// AAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAA
// DISCORD RESET MOT DE PASSE
// AAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAAAasAA...AAAaAAasAA
// Variables Discord lues depuis l'environnement du serveur.
const DISCORD_FALLBACK_CLIENT_ID = '1477252548090921060';

function normalizePublicUrl(value) {
  const url = String(value || '').trim();
  if (!url) return '';
  return url.replace(/\/+$/, '');
}

function discordConfig() {
  const baseUrl = normalizePublicUrl(
    process.env.DISCORD_REDIRECT_BASE_URL
    || process.env.PUBLIC_BASE_URL
    || process.env.BASE_URL
    || `http://127.0.0.1:${process.env.SERVER_PORT || process.env.PORT || 3000}`
  );
  return {
    clientId:     process.env.DISCORD_CLIENT_ID || DISCORD_FALLBACK_CLIENT_ID,
    clientSecret: process.env.DISCORD_CLIENT_SECRET || '',
    botToken:     process.env.DISCORD_BOT_TOKEN || process.env.BOT_TOKEN || '',
    baseUrl,
    redirectUri:  normalizePublicUrl(process.env.DISCORD_REDIRECT_URI) || `${baseUrl}/auth/discord/callback`,
  };
}

function encodeDiscordState(payload) {
  return Buffer.from(JSON.stringify(payload)).toString('base64');
}

function normalizeReferralId(value) {
  const raw = String(value || '').trim().replace(/^https?:\/\/[^/?#]+\/?\?ref=/i, '');
  if (!raw) return 0;
  const match = raw.match(/^(?:p4-)?(\d+)$/i);
  const id = match ? Number(match[1]) : 0;
  return Number.isFinite(id) && id > 0 ? Math.floor(id) : 0;
}

function normalizeReferralSlug(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\/[^/?#]+\/?\?ref=/i, '')
    .replace(/^p4-/i, 'p4-')
    .replace(/[^a-z0-9_.-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 32);
}

function resolveReferralTarget(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const id = normalizeReferralId(raw);
  if (id) {
    const byId = pQ.getById.get(id);
    if (byId) return byId;
  }
  const normalized = normalizeReferralSlug(raw);
  if (!normalized) return null;
  const bySlug = db.prepare(`
    SELECT * FROM players
    WHERE deleted = 0 AND is_guest = 0 AND is_bot = 0
      AND LOWER(referral_slug) = LOWER(?)
    LIMIT 1
  `).get(normalized);
  if (bySlug) return bySlug;
  return pQ.getByPseudo.get(raw) || pQ.getByPseudo.get(normalized);
}

function getEligibleReferrer(referrerRef, playerId = 0) {
  const referrer = resolveReferralTarget(referrerRef);
  if (!referrer || Number(referrer.id) === Number(playerId || 0)) return null;
  if (!referrer || Number(referrer.deleted || 0) === 1 || Number(referrer.is_guest || 0) === 1 || Number(referrer.is_bot || 0) === 1) return null;
  return referrer;
}

function htmlEscape(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function publicBaseUrlFromReq(req) {
  const configured = normalizePublicUrl(process.env.PUBLIC_BASE_URL || process.env.BASE_URL || process.env.DISCORD_REDIRECT_BASE_URL);
  if (configured) return configured;
  const proto = String(req.headers['x-forwarded-proto'] || req.protocol || 'https').split(',')[0].trim() || 'https';
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  return host ? `${proto}://${host}`.replace(/\/+$/, '') : 'https://puissance4.croustygame.fr';
}

function absolutePublicUrl(req, value, fallback = '/assets/pwa-icon-512.png') {
  const raw = String(value || fallback || '').trim();
  if (/^https?:\/\//i.test(raw)) return raw;
  if (/^data:/i.test(raw)) return absolutePublicUrl(req, fallback, '');
  const baseUrl = publicBaseUrlFromReq(req);
  return `${baseUrl}${raw.startsWith('/') ? raw : `/${raw}`}`;
}

function renderHtmlWithMeta(fileName, req, res, meta = {}) {
  const filePath = path.join(__dirname, 'public', fileName);
  fs.readFile(filePath, 'utf8', (error, html) => {
    if (error) return res.status(500).send('Erreur serveur');
    const title = meta.title || 'Puissance 4';
    const description = meta.description || 'Joue au Puissance 4 en ligne, defie tes amis et grimpe le classement.';
    const url = meta.url || absolutePublicUrl(req, req.originalUrl || req.path || '/');
    const image = meta.image || absolutePublicUrl(req, '/assets/pwa-icon-512.png');
    const type = meta.type || 'website';
    const card = meta.twitterCard || 'summary';
    const tags = [
      `<title>${htmlEscape(title)}</title>`,
      `<meta name="description" content="${htmlEscape(description)}">`,
      `<meta property="og:type" content="${htmlEscape(type)}">`,
      `<meta property="og:site_name" content="Puissance 4">`,
      `<meta property="og:title" content="${htmlEscape(title)}">`,
      `<meta property="og:description" content="${htmlEscape(description)}">`,
      `<meta property="og:url" content="${htmlEscape(url)}">`,
      `<meta property="og:image" content="${htmlEscape(image)}">`,
      `<meta property="og:image:secure_url" content="${htmlEscape(image)}">`,
      `<meta name="twitter:card" content="${htmlEscape(card)}">`,
      `<meta name="twitter:title" content="${htmlEscape(title)}">`,
      `<meta name="twitter:description" content="${htmlEscape(description)}">`,
      `<meta name="twitter:image" content="${htmlEscape(image)}">`,
    ].join('\n');
    const cleaned = html
      .replace(/<title>[\s\S]*?<\/title>\s*/i, '')
      .replace(/<meta\s+(?:name|property)=["'](?:description|og:[^"']+|twitter:[^"']+)["'][^>]*>\s*/gi, '');
    res.type('html').send(cleaned.replace('</head>', `${tags}\n</head>`));
  });
}

function resolveProfilePreviewPlayer(ref) {
  const raw = String(ref || '').trim();
  if (!raw) return null;
  if (/^\d+$/.test(raw)) return pQ.getById.get(Number(raw));
  return pQ.getByPseudo.get(decodeURIComponent(raw));
}

function renderProfilePage(req, res) {
  const ref = req.params.ref || req.query.id || '';
  const player = resolveProfilePreviewPlayer(ref);
  if (!player || (Number(player.deleted || 0) === 1 && Number(player.id) !== Number(BOT_PLAYER_ID))) {
    return renderHtmlWithMeta('profil.html', req, res, {
      title: 'Profil introuvable - Puissance 4',
      description: 'Ce profil Puissance 4 est introuvable ou a ete supprime.',
      url: absolutePublicUrl(req, req.originalUrl || '/profil'),
    });
  }
  const safe = sanitize(player);
  const totalGames = Number(safe.wins || 0) + Number(safe.losses || 0) + Number(safe.draws || 0);
  const rank = getRank(Number(safe.elo || 0));
  const rankName = typeof rank === 'string' ? rank : (rank?.name || rank?.label || rank?.title || 'Classement');
  const profilePath = `/profil?id=${encodeURIComponent(String(safe.id))}`;
  const description = `${Number(safe.elo || 0)} ELO - ${rankName} - ${Number(safe.wins || 0)} victoires, ${Number(safe.losses || 0)} defaites, ${Number(safe.draws || 0)} nuls (${totalGames} parties).`;
  const imageSource = safe.avatar || safe.profile_banner || safe.banner || '/assets/pwa-icon-512.png';
  renderHtmlWithMeta('profil.html', req, res, {
    title: `${safe.pseudo} - Profil Puissance 4`,
    description,
    url: absolutePublicUrl(req, profilePath),
    image: absolutePublicUrl(req, imageSource),
    twitterCard: 'summary',
  });
}

function renderStaticPage(fileName, meta = {}) {
  return (req, res) => renderHtmlWithMeta(fileName, req, res, {
    title: meta.title || 'Puissance 4',
    description: meta.description || 'Joue au Puissance 4 en ligne, defie tes amis et grimpe le classement.',
    url: absolutePublicUrl(req, req.originalUrl || req.path || '/'),
    image: absolutePublicUrl(req, meta.image || '/assets/pwa-icon-512.png'),
    twitterCard: meta.twitterCard || 'summary',
  });
}

function assignReferrerIfPossible(playerId, referrerId) {
  const id = Number(playerId || 0);
  if (!id) return null;
  const player = pQ.getById.get(id);
  if (!player || Number(player.referred_by || 0)) return null;
  const referrer = getEligibleReferrer(referrerId, id);
  if (!referrer) return null;
  const result = pQ.setReferrer.run({ id, referrerId: referrer.id, referredAt: Date.now() });
  return result.changes ? referrer : null;
}

function getReferralInfo(player) {
  const referrerId = Number(player?.referred_by || 0);
  const referrer = referrerId ? pQ.getById.get(referrerId) : null;
  const referredCount = player?.id ? Number(db.prepare(`
    SELECT COUNT(*) AS c
    FROM players
    WHERE referred_by = ? AND deleted = 0 AND is_guest = 0 AND is_bot = 0
  `).get(player.id)?.c || 0) : 0;
  const discountPercent = referredCount > 0
    ? REFERRAL_REFERRER_DISCOUNT_PERCENT
    : referrerId
      ? REFERRAL_FILLEUL_DISCOUNT_PERCENT
      : 0;
  return {
    code: player?.id ? (String(player.referral_slug || '').trim() || `P4-${player.id}`) : '',
    defaultCode: player?.id ? `P4-${player.id}` : '',
    slug: String(player?.referral_slug || '').trim(),
    discountPercent,
    filleulDiscountPercent: REFERRAL_FILLEUL_DISCOUNT_PERCENT,
    referrerDiscountPercent: REFERRAL_REFERRER_DISCOUNT_PERCENT,
    referredCount,
    discountKind: referredCount > 0 ? 'parrain' : referrerId ? 'filleul' : '',
    referrer: referrer && Number(referrer.deleted || 0) !== 1 ? {
      id: referrer.id,
      pseudo: referrer.pseudo,
    } : null,
  };
}

function applyReferralDiscountPrice(basePrice, player, coupon = null) {
  const afterCoupon = applyCouponPrice(basePrice, coupon);
  if (afterCoupon <= 0) return afterCoupon;
  let finalPrice = afterCoupon;
  if (Number(player?.is_perso || 0) === 1) {
    finalPrice = Math.max(0, Math.ceil(finalPrice * 0.70));
  }
  const percent = Number(getReferralInfo(player).discountPercent || 0);
  if (percent > 0) {
    finalPrice = Math.max(0, Math.ceil(finalPrice * (1 - percent / 100)));
  }
  return finalPrice;
}

function getCosmeticPackForAsset(type, asset) {
  const normalizedType = String(type || '');
  const normalizedAsset = String(asset || '');
  return Object.values(COSMETIC_PACKS).find(pack =>
    pack.cosmeticType === normalizedType && pack.assets.includes(normalizedAsset)
  ) || null;
}

function playerOwnsCosmeticAsset(player, type, asset) {
  if (!player || !asset) return false;
  if (String(player.role || '').toLowerCase() === 'admin') return true;
  const pack = getCosmeticPackForAsset(type, asset);
  if (!pack) return false;
  return Number(shopItemQ.getOne.get(player.id, pack.key)?.quantity || 0) > 0;
}

function getOwnedBots(ownerId, viewer = null) {
  const id = Number(ownerId || 0);
  if (!id) return [];
  const adminMode = isAdminPlayer(viewer);
  return db.prepare(`
    SELECT b.id, b.pseudo, b.elo, b.wins, b.losses, b.draws, b.avatar, b.color,
           b.bot_enabled, b.bot_token_preview, b.bot_description, b.bot_skill, b.bot_owner_id,
           owner.pseudo AS bot_owner_pseudo,
           h.status AS host_status, h.expires_at AS host_expires_at, h.updated_at AS host_updated_at,
           h.metrics AS host_metrics,
           LENGTH(COALESCE(h.code, '')) AS host_code_size
    FROM players b
    LEFT JOIN bot_hosts h ON h.bot_id = b.id
    LEFT JOIN players owner ON owner.id = b.bot_owner_id
    WHERE b.deleted = 0
      AND b.is_guest = 0
      AND b.is_bot = 1
      AND (? = 1 OR b.bot_owner_id = ?)
    ORDER BY b.wins DESC, b.elo DESC, b.id ASC
  `).all(adminMode ? 1 : 0, id).filter(row => !builtinBotIds.has(Number(row.id || 0))).map(row => {
    let metrics = [];
    try {
      const parsed = JSON.parse(String(row.host_metrics || '[]'));
      metrics = Array.isArray(parsed) ? parsed : [];
    } catch (_) {}
    return {
      ...sanitize(row),
      host: {
        active: Number(row.host_expires_at || 0) > Date.now(),
        status: row.host_status || 'none',
        expiresAt: Number(row.host_expires_at || 0) || null,
        updatedAt: Number(row.host_updated_at || 0) || null,
        codeSize: Number(row.host_code_size || 0),
        lastMetric: metrics[metrics.length - 1] || null,
      },
    };
  });
}

function getBotHostForOwner(ownerId, botId, viewer = null) {
  const owner = Number(ownerId || 0);
  const bot = Number(botId || 0);
  if (!owner || !bot) return null;
  const adminMode = isAdminPlayer(viewer);
  return db.prepare(`
    SELECT h.*, b.pseudo, b.elo, b.wins, b.losses, b.draws, b.bot_token_preview
    FROM bot_hosts h
    JOIN players b ON b.id = h.bot_id
    WHERE (? = 1 OR h.owner_id = ?) AND h.bot_id = ? AND b.deleted = 0 AND b.is_bot = 1
  `).get(adminMode ? 1 : 0, owner, bot);
}

function appendBotHostLog(botId, line) {
  const id = Number(botId || 0);
  if (!id) return;
  const now = new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Europe/Paris',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(new Date()).replace(',', '');
  const entry = `[${now}] ${String(line || '').replace(/[\r\n]+/g, ' ').slice(0, 240)}`;
  const row = db.prepare(`SELECT logs FROM bot_hosts WHERE bot_id = ?`).get(id);
  const current = String(row?.logs || '');
  const next = `${current ? `${current}\n` : ''}${entry}`.split('\n').slice(-160).join('\n');
  db.prepare(`UPDATE bot_hosts SET logs = ?, updated_at = ? WHERE bot_id = ?`).run(next, Date.now(), id);
}

function readBotHostMetrics(botId) {
  const id = Number(botId || 0);
  if (!id) return [];
  const row = db.prepare(`SELECT metrics FROM bot_hosts WHERE bot_id = ?`).get(id);
  try {
    const parsed = JSON.parse(String(row?.metrics || '[]'));
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

function appendBotHostMetric(botId, sample) {
  const id = Number(botId || 0);
  if (!id || !sample) return;
  const metrics = readBotHostMetrics(id);
  metrics.push({
    at: Number(sample.at || Date.now()),
    cpuPct: Number(sample.cpuPct || 0),
    rssMb: Number(sample.rssMb || 0),
    netKb: Number(sample.netKb || 0),
  });
  const next = metrics.slice(-BOT_HOST_METRIC_LIMIT);
  db.prepare(`UPDATE bot_hosts SET metrics = ?, updated_at = ? WHERE bot_id = ?`).run(JSON.stringify(next), Date.now(), id);
}

function estimateRequestBytes(req) {
  let bytes = 0;
  try { bytes += Buffer.byteLength(JSON.stringify(req.headers || {}), 'utf8'); } catch (_) {}
  try { bytes += Buffer.byteLength(JSON.stringify(req.body || {}), 'utf8'); } catch (_) {}
  try { bytes += Buffer.byteLength(String(req.originalUrl || req.url || ''), 'utf8'); } catch (_) {}
  return bytes;
}

function botHostWorkDir(botId) {
  const dir = path.join(os.tmpdir(), 'p4-bot-hosts');
  try { fs.mkdirSync(dir, { recursive: true }); } catch(e) {}
  return path.join(dir, `bot-${Number(botId || 0)}.js`);
}

function normalizeBotHostCode(code) {
  return String(code || '')
    .replace(/^\uFEFF/, '')
    .replace(/^\s*#![^\r\n]*(?:\r?\n|$)/, '');
}

function getBotHostRuntime(botId) {
  const child = botHostProcesses.get(Number(botId || 0));
  return child && !child.killed ? child : null;
}

function countRunningBotHosts(exceptBotId = 0) {
  let count = 0;
  const except = Number(exceptBotId || 0);
  for (const [botId, child] of botHostProcesses) {
    if (Number(botId) === except) continue;
    if (child && !child.killed) count++;
  }
  return count;
}

function readProcessUsage(pid) {
  const id = Number(pid || 0);
  if (!id || process.platform !== 'linux') return null;
  try {
    const stat = fs.readFileSync(`/proc/${id}/stat`, 'utf8').trim();
    const end = stat.lastIndexOf(')');
    const parts = stat.slice(end + 2).split(/\s+/);
    const utimeTicks = Number(parts[11] || 0);
    const stimeTicks = Number(parts[12] || 0);
    const rssPages = Number(parts[21] || 0);
    return {
      cpuMs: (utimeTicks + stimeTicks) * 10,
      rssMb: (rssPages * 4096) / 1024 / 1024,
    };
  } catch (_) {
    return null;
  }
}

function attachBotHostWatchdog(botId, child) {
  const id = Number(botId || 0);
  if (!id || !child) return;
  child.__p4Usage = { at: Date.now(), usage: readProcessUsage(child.pid) };
  child.__p4MetricBaseline = { at: Date.now(), usage: child.__p4Usage.usage, netBytes: Number(child.__p4NetBytes || 0) };
  child.__p4Watchdog = setInterval(() => {
    const current = botHostProcesses.get(id);
    if (current !== child || child.killed) return;
    const usage = readProcessUsage(child.pid);
    if (!usage) return;
    if (usage.rssMb > BOT_HOST_MAX_RSS_MB) {
      appendBotHostLog(id, `Limite memoire host depassee (${usage.rssMb.toFixed(1)} MB > ${BOT_HOST_MAX_RSS_MB} MB).`);
      stopBotHostProcess(id, 'resource-memory');
      return;
    }
    const metricBase = child.__p4MetricBaseline;
    if (metricBase?.usage) {
      const metricElapsedMs = Math.max(1, Date.now() - metricBase.at);
      const metricCpuMs = Math.max(0, usage.cpuMs - metricBase.usage.cpuMs);
      const netBytes = Number(child.__p4NetBytes || 0);
      appendBotHostMetric(id, {
        at: Date.now(),
        cpuPct: Math.min(400, (metricCpuMs / metricElapsedMs) * 100),
        rssMb: usage.rssMb,
        netKb: Math.max(0, netBytes - Number(metricBase.netBytes || 0)) / 1024,
      });
      child.__p4MetricBaseline = { at: Date.now(), usage, netBytes };
    } else {
      child.__p4MetricBaseline = { at: Date.now(), usage, netBytes: Number(child.__p4NetBytes || 0) };
    }
    const previous = child.__p4Usage;
    if (!previous?.usage) {
      child.__p4Usage = { at: Date.now(), usage };
      return;
    }
    const elapsedMs = Math.max(1, Date.now() - previous.at);
    if (elapsedMs < 60_000) return;
    const cpuDeltaMs = Math.max(0, usage.cpuMs - previous.usage.cpuMs);
    const allowedCpuMs = BOT_HOST_MAX_CPU_MS_PER_MIN * (elapsedMs / 60_000);
    child.__p4Usage = { at: Date.now(), usage };
    if (cpuDeltaMs > allowedCpuMs) {
      appendBotHostLog(id, `Limite CPU host depassee (${Math.round(cpuDeltaMs)} ms/${Math.round(elapsedMs)} ms).`);
      stopBotHostProcess(id, 'resource-cpu');
    }
  }, BOT_HOST_WATCHDOG_MS);
  child.__p4Watchdog.unref?.();
}

function stopBotHostProcess(botId, reason = 'stop') {
  const id = Number(botId || 0);
  const child = getBotHostRuntime(id);
  if (!child) return false;
  child.__p4Stopping = true;
  if (child.__p4Watchdog) {
    clearInterval(child.__p4Watchdog);
    child.__p4Watchdog = null;
  }
  try { child.kill('SIGTERM'); } catch(e) {}
  setTimeout(() => {
    const current = botHostProcesses.get(id);
    if (current === child && !child.killed) {
      try { child.kill('SIGKILL'); } catch(e) {}
    }
  }, 4000).unref?.();
  appendBotHostLog(id, `Process host arrete (${reason}).`);
  return true;
}

function ensureBotHostToken(bot) {
  const fresh = pQ.getById.get(Number(bot?.id || 0));
  if (!fresh || Number(fresh.is_bot || 0) !== 1) return null;
  if (String(fresh.bot_host_token || '').trim()) return String(fresh.bot_host_token);
  const token = makeBotToken();
  db.prepare(`UPDATE players SET bot_host_token = ?, bot_host_token_hash = ?, bot_host_token_preview = ? WHERE id = ?`).run(token, hashBotToken(token), token.slice(-8), fresh.id);
  appendBotHostLog(fresh.id, `Token host dedie genere (preview ${token.slice(-8)}).`);
  return token;
}

function resolveBotHostToken(bot) {
  return ensureBotHostToken(bot);
}

function startBotHostProcess(bot, host, action = 'start') {
  const id = Number(bot?.id || 0);
  if (!id) throw new Error('Bot invalide.');
  if (Number(bot.bot_enabled || 0) !== 1) throw new Error('Bot suspendu par le staff.');
  if (!host || Number(host.expires_at || 0) <= Date.now()) throw new Error('Host inactif ou expire.');
  const code = normalizeBotHostCode(host.code);
  if (!code.trim()) throw new Error('Aucun code host envoye.');
  if (getBotHostRuntime(id)) {
    if (action !== 'restart') throw new Error('Host deja demarre.');
    stopBotHostProcess(id, 'restart');
  }
  if (BOT_HOST_MAX_ACTIVE > 0 && countRunningBotHosts(id) >= BOT_HOST_MAX_ACTIVE) {
    throw new Error(`Limite budget: ${BOT_HOST_MAX_ACTIVE} host bot actif maximum.`);
  }
  const token = resolveBotHostToken(bot);
  if (!token) throw new Error('Token host indisponible.');
  const runPath = botHostWorkDir(id);
  const wrappedCode = `
process.title = 'p4-host-bot-${id}';
process.env.P4_BOT_ID = ${JSON.stringify(String(id))};
process.env.BOT_ID = ${JSON.stringify(String(id))};
process.env.P4_BOT_NAME = ${JSON.stringify(String(bot.pseudo || 'Bot'))};
globalThis.P4_BOT_ID = ${JSON.stringify(String(id))};
globalThis.P4_BASE_URL = process.env.P4_BASE_URL;
globalThis.P4_API_URL = process.env.P4_API_URL;
globalThis.P4_BOT_TOKEN = process.env.P4_BOT_TOKEN;
process.on('unhandledRejection', err => { console.error('[unhandledRejection]', err && err.stack || err); });
process.on('uncaughtException', err => { console.error('[uncaughtException]', err && err.stack || err); process.exitCode = 1; });
;(async () => {
${code}
})().catch(err => { console.error('[host bootstrap]', err && err.stack || err); process.exitCode = 1; });
`;
  fs.writeFileSync(runPath, wrappedCode, 'utf8');
  const baseUrl = String(discordConfig().baseUrl || process.env.PUBLIC_BASE_URL || `http://127.0.0.1:${PORT}`).replace(/\/+$/, '');
  const child = fork(runPath, [], {
    cwd: path.dirname(runPath),
    silent: true,
    env: {
      ...process.env,
      P4_BASE_URL: baseUrl,
      P4_API_URL: baseUrl,
      P4_SITE_URL: baseUrl,
      P4_BOT_TOKEN: token,
      P4_THREADS: String(Math.max(1, Math.min(2, Number(process.env.P4_HOST_THREADS || process.env.P4_THREADS || 1)))),
      P4_MAX_THREADS: '2',
      P4_DEPTH: String(HOSTED_BOT_DEPTH),
      P4_THINK_MS: String(HOSTED_BOT_THINK_MS),
      P4_MAX_TABLE: String(HOSTED_BOT_MAX_TABLE),
      P4_BOT_ID: String(id),
      BOT_ID: String(id),
      P4_BOT_NAME: String(bot.pseudo || 'Bot'),
      NODE_ENV: process.env.NODE_ENV || 'production',
    },
  });
  botHostProcesses.set(id, child);
  child.__p4NetBytes = 0;
  attachBotHostWatchdog(id, child);
  const startedAt = Date.now();
  db.prepare(`UPDATE bot_hosts SET status = 'running', pid = ?, exit_code = NULL, exit_signal = '', started_at = ?, stopped_at = 0, updated_at = ?, last_action = ? WHERE bot_id = ?`)
    .run(Number(child.pid || 0), startedAt, startedAt, action, id);
  botRuntime.set(id, { status: 'hosted', lastSeen: Date.now(), hosted: true, pid: Number(child.pid || 0) });
  appendBotHostLog(id, `${action === 'restart' ? 'Redemarrage' : 'Demarrage'} reel du process host PID ${child.pid || '?'}.`);
  appendBotHostLog(id, `Token host injecte au process (preview ${token.slice(-8)}).`);
  const logPipe = (type, chunk) => {
    String(chunk || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean).slice(0, 8)
      .forEach(line => appendBotHostLog(id, `${type}: ${line}`));
  };
  child.stdout?.on('data', chunk => logPipe('stdout', chunk));
  child.stderr?.on('data', chunk => logPipe('stderr', chunk));
  child.on('exit', (code, signal) => {
    if (child.__p4Watchdog) clearInterval(child.__p4Watchdog);
    if (botHostProcesses.get(id) === child) botHostProcesses.delete(id);
    const now = Date.now();
    db.prepare(`UPDATE bot_hosts SET status = ?, pid = 0, exit_code = ?, exit_signal = ?, stopped_at = ?, updated_at = ?, last_action = 'exit' WHERE bot_id = ?`)
      .run(child.__p4Stopping ? 'stopped' : 'crashed', Number.isInteger(code) ? code : null, signal || '', now, now, id);
    botRuntime.set(id, { status: child.__p4Stopping ? 'host-stopped' : 'host-crashed', lastSeen: Date.now(), hosted: true });
    appendBotHostLog(id, `Process host termine: code=${code ?? 'null'} signal=${signal || 'none'}.`);
    broadcastPresenceCounts();
  });
  child.on('error', error => appendBotHostLog(id, `Erreur process host: ${error.message}`));
  broadcastPresenceCounts();
  return child;
}

function restartActiveBotHosts() {
  const rows = db.prepare(`
    SELECT h.*, p.id AS bot_id, p.pseudo, p.bot_enabled, p.is_bot, p.deleted
    FROM bot_hosts h
    JOIN players p ON p.id = h.bot_id
    WHERE h.status = 'running' AND h.expires_at > ? AND p.deleted = 0 AND p.is_bot = 1 AND p.bot_enabled = 1
  `).all(Date.now());
  rows.forEach(row => {
    try {
      startBotHostProcess(row, row, 'start');
      appendBotHostLog(row.bot_id, 'Host relance automatiquement apres demarrage serveur.');
    } catch (error) {
      db.prepare(`UPDATE bot_hosts SET status = 'crashed', pid = 0, updated_at = ?, last_action = 'boot-failed' WHERE bot_id = ?`).run(Date.now(), row.bot_id);
      appendBotHostLog(row.bot_id, `Relance automatique impossible: ${error.message}`);
    }
  });
}

function stopAllBotHosts(reason = 'server-stop') {
  for (const botId of [...botHostProcesses.keys()]) {
    stopBotHostProcess(botId, reason);
  }
}

process.once('SIGINT', () => {
  stopAllBotHosts('SIGINT');
  process.exit(0);
});

function estimatePayloadBytes(payload) {
  if (payload == null) return 0;
  if (Buffer.isBuffer(payload)) return payload.length;
  if (typeof payload === 'string') return Buffer.byteLength(payload);
  try { return Buffer.byteLength(JSON.stringify(payload)); } catch { return 0; }
}

function isDevTelemetryPayload(payload) {
  const text = Buffer.isBuffer(payload)
    ? payload.toString('utf8')
    : typeof payload === 'string'
      ? payload
      : '';
  return text.includes('"dev_metric"')
    || text.includes('"dev_metrics_history"')
    || text.includes('"dev_bot_metric"')
    || text.includes('"dev_metrics_subscribe"')
    || text.includes('"dev_metrics_unsubscribe"');
}

app.use((req, res, next) => {
  if (req.path.startsWith('/api/dev/') || req.path.startsWith('/socket.io/')) {
    return next();
  }
  devNetworkTotals.rxBytes += Number(req.headers['content-length'] || 0);
  const originalWrite = res.write.bind(res);
  const originalEnd = res.end.bind(res);
  res.write = (chunk, ...args) => {
    devNetworkTotals.txBytes += estimatePayloadBytes(chunk);
    return originalWrite(chunk, ...args);
  };
  res.end = (chunk, ...args) => {
    devNetworkTotals.txBytes += estimatePayloadBytes(chunk);
    return originalEnd(chunk, ...args);
  };
  next();
});

function sampleDevMachineMetrics() {
  const now = Date.now();
  const elapsedMs = Math.max(1, now - devMachineCpuAt);
  const cpuUsage = process.cpuUsage(devMachineCpuBase);
  const cpuMs = (cpuUsage.user + cpuUsage.system) / 1000;
  const cores = Math.max(1, os.cpus()?.length || 1);
  const memory = process.memoryUsage();
  const totalMem = Math.max(1, os.totalmem());
  const freeMem = Math.max(0, os.freemem());
  const elapsedSeconds = elapsedMs / 1000;
  const sample = {
    at: now,
    uptimeSeconds: Math.round(process.uptime()),
    processCpuPct: Math.min(100, (cpuMs / elapsedMs / cores) * 100),
    loadPct: Math.min(100, (Number(os.loadavg()?.[0] || 0) / cores) * 100),
    processRssMb: memory.rss / 1024 / 1024,
    heapUsedMb: memory.heapUsed / 1024 / 1024,
    systemMemoryPct: ((totalMem - freeMem) / totalMem) * 100,
    networkRxKbps: Math.max(0, (devNetworkTotals.rxBytes - devNetworkBase.rxBytes) / 1024 / elapsedSeconds),
    networkTxKbps: Math.max(0, (devNetworkTotals.txBytes - devNetworkBase.txBytes) / 1024 / elapsedSeconds),
  };
  devMachineMetrics.push(sample);
  if (devMachineMetrics.length > 240) devMachineMetrics.splice(0, devMachineMetrics.length - 240);
  devMachineCpuBase = process.cpuUsage();
  devMachineCpuAt = now;
  devNetworkBase = { ...devNetworkTotals };
  io.to('dev-metrics').emit('dev_metric', sample);
  sampleDevBotHostMetrics(now);
}

function sampleDevBotHostMetrics(now = Date.now()) {
  if (!io.sockets.adapter.rooms.get('dev-metrics')?.size) return;
  for (const [botId, child] of botHostProcesses) {
    if (!child || child.killed) continue;
    const usage = readProcessUsage(child.pid);
    if (!usage) continue;
    const netBytes = Number(child.__p4NetBytes || 0);
    const baseline = child.__p4DevMetricBaseline;
    child.__p4DevMetricBaseline = { at: now, usage, netBytes };
    if (!baseline?.usage) continue;
    const elapsedMs = Math.max(1, now - Number(baseline.at || now));
    const cpuMs = Math.max(0, usage.cpuMs - Number(baseline.usage.cpuMs || 0));
    io.to('dev-metrics').emit('dev_bot_metric', {
      botId: Number(botId),
      sample: {
        at: now,
        cpuPct: Math.min(400, (cpuMs / elapsedMs) * 100),
        rssMb: Number(usage.rssMb || 0),
        netKb: Math.max(0, netBytes - Number(baseline.netBytes || 0)) / 1024,
      },
    });
  }
}
sampleDevMachineMetrics();
setInterval(sampleDevMachineMetrics, 1000);
process.once('SIGTERM', () => {
  stopAllBotHosts('SIGTERM');
  process.exit(0);
});

function grantBotWinCrystals(botId) {
  const bot = pQ.getById.get(Number(botId || 0));
  if (!bot || Number(bot.is_bot || 0) !== 1 || Number(bot.deleted || 0) === 1) return null;
  const ownerId = Number(bot.bot_owner_id || 0);
  if (!ownerId || ownerId === Number(bot.id)) return null;
  const owner = pQ.getById.get(ownerId);
  if (!owner || Number(owner.deleted || 0) === 1 || Number(owner.is_guest || 0) === 1 || Number(owner.is_bot || 0) === 1) return null;
  const reward = 1 + Math.floor(Math.random() * 3);
  pQ.addBotCrystals.run({ id: ownerId, delta: reward });
  return { ownerId, botId: Number(bot.id), reward };
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
    is_developer = 0,
    is_crystal = 0,
    crystal_expires_at = NULL,
    crystal_auto_renew = 0,
    discord_id = NULL,
    suspicious = 0
  WHERE id = ?`).run(pseudo, id);

  // Supprimer sessions, follows, reset_codes
  db.prepare(`DELETE FROM sessions    WHERE player_id = ?`).run(id);
  db.prepare(`DELETE FROM follows     WHERE follower_id = ? OR following_id = ?`).run(id, id);
  db.prepare(`DELETE FROM reset_codes WHERE player_id = ?`).run(id);

  // Marquer le compte comme supprimAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAA
  db.prepare(`UPDATE players SET deleted = 1 WHERE id = ?`).run(id);
  broadcastPresenceCounts(true);

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
function getOrCreateDeveloperPassword() {
  const row = db.prepare('SELECT value FROM config WHERE key = ?').get('developer_password');
  if (row) return row.value;
  const password = crypto.randomBytes(10).toString('hex');
  db.prepare('INSERT INTO config (key, value) VALUES (?, ?)').run('developer_password', password);
  console.log(`[DEV] Mot de passe genere : ${password}`);
  return password;
}
const DEVELOPER_PASSWORD = getOrCreateDeveloperPassword();

app.get('/admin', (_, res) => res.sendFile(path.join(__dirname, 'public/admin.html')));
app.get('/dev', (_, res) => res.sendFile(path.join(__dirname, 'public/dev.html')));

const DEV_SOURCE_ROOT = path.resolve(__dirname, '..');
const DEV_SOURCE_EXTENSIONS = new Set(['.js', '.json', '.html', '.css', '.md']);
const DEV_ROOT_FILES = new Set(['index.js', 'package.json', 'README.md']);
const developerSessions = new Map();
const developerLoginCodes = new Map();

function getDeveloperSession(req) {
  const token = String(req.headers['x-dev-token'] || '').trim();
  return getDeveloperSessionByToken(token);
}

function getDeveloperSessionByToken(tokenValue) {
  const token = String(tokenValue || '').trim();
  const session = token ? developerSessions.get(token) : null;
  if (!session?.playerId || Number(session.expiresAt || 0) <= Date.now()) {
    if (token) developerSessions.delete(token);
    return null;
  }
  const player = pQ.getById.get(session.playerId);
  if (!player || (!isDeveloperPlayer(player) && !isAdminPlayer(player))) {
    developerSessions.delete(token);
    return null;
  }
  return player;
}

app.get('/api/dev/password', async (req, res) => {
  const playerId = validateSession(String(req.headers['x-token'] || ''));
  const player = playerId ? pQ.getById.get(playerId) : null;
  if (!player?.discord_id || !isDeveloperPlayer(player)) {
    return res.status(403).json({ error: 'Acces developpeur requis.' });
  }
  try {
    const { botToken } = discordConfig();
    const snapshot = await fetchDiscordMemberSnapshot(player.discord_id, botToken);
    if (!snapshot?.developer) return res.status(403).json({ error: 'Role Discord developpeur requis.' });
    applyDiscordSnapshotToPlayer(player, snapshot);
  } catch(e) {
    return res.status(503).json({ error: 'Verification Discord indisponible.' });
  }
  res.json({ password: DEVELOPER_PASSWORD });
});

app.post('/api/dev/login', async (req, res) => {
  const { password, playerToken, devIdentity, requestId, code } = req.body || {};
  if (password !== DEVELOPER_PASSWORD) return res.status(403).json({ error: 'Mot de passe incorrect.' });
  const player = findAdminLoginPlayer(devIdentity, playerToken);
  if (!player?.discord_id) return res.status(403).json({ error: 'Compte Discord developpeur introuvable.' });

  const { botToken } = discordConfig();
  const snapshot = await fetchDiscordMemberSnapshot(player.discord_id, botToken);
  const hasDeveloperAccess = !!snapshot?.developer || isDeveloperPlayer(player) || isAdminPlayer(player);
  if (!hasDeveloperAccess) {
    return res.status(403).json({ error: 'Role Discord developpeur requis.' });
  }
  if (snapshot) applyDiscordSnapshotToPlayer(player, snapshot);

  if (requestId) {
    const challenge = developerLoginCodes.get(String(requestId));
    if (!challenge || challenge.playerId !== player.id || challenge.expiresAt <= Date.now()) {
      developerLoginCodes.delete(String(requestId));
      return res.status(403).json({ error: 'Code Discord expire ou invalide.' });
    }
    if (String(code || '').trim() !== challenge.code) {
      challenge.attempts += 1;
      if (challenge.attempts >= 5) developerLoginCodes.delete(String(requestId));
      return res.status(403).json({ error: 'Code Discord incorrect.' });
    }
    developerLoginCodes.delete(String(requestId));
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = Date.now() + 4 * 60 * 60 * 1000;
    developerSessions.set(token, { playerId: player.id, expiresAt });
    setTimeout(() => developerSessions.delete(token), 4 * 60 * 60 * 1000);
    return res.json({ token, expiresAt, pseudo: player.pseudo });
  }

  const challengeId = crypto.randomBytes(16).toString('hex');
  const challengeCode = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  const challengeExpiresAt = Date.now() + 10 * 60 * 1000;
  const stopcode = Math.floor(Math.random() * 10000).toString().padStart(4, '0');

  developerLoginCodes.set(challengeId, {
    playerId: player.id,
    code: challengeCode,
    expiresAt: challengeExpiresAt,
    attempts: 0,
  });

  setTimeout(() => developerLoginCodes.delete(challengeId), 10 * 60 * 1000);

  try {
    await sendDM(player.discord_id, [
      '# 🛠️ **Puissance 4 - Console & Développement** 🛠️',
      `**Bonjour <@${player.discord_id}> 👋**`,
      '',
      'Vous avez demandé un accès au panel de développement ⚙️',
      `🔒 Pour la sécurité, veuillez taper le code suivant : **${challengeCode}**`,
      `⏱️ Il expire <t:${Math.floor(challengeExpiresAt / 1000)}:R>. Ne le partagez avec personne.`,
      '',
      `🛑 STOP ${stopcode}`,
    ].join('\n'));
  } catch (e) {
    developerLoginCodes.delete(challengeId);
    return res.status(500).json({
      error: "Impossible d'envoyer le code Discord.",
    });
  }
  return res.json({requiresCode: true,requestId: challengeId,});
});

app.post('/api/dev/logout', (req, res) => {
  const token = String(req.headers['x-dev-token'] || '').trim();
  if (token) developerSessions.delete(token);
  res.json({ ok: true });
});

function normalizeDeveloperSourcePath(value) {
  const relative = String(value || '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (!relative || relative.includes('\0')) return null;
  const normalized = path.posix.normalize(relative);
  if (normalized === '..' || normalized.startsWith('../')) return null;
  const allowedRootFile = DEV_ROOT_FILES.has(normalized);
  const allowedSourceFile = normalized.startsWith('src/') && DEV_SOURCE_EXTENSIONS.has(path.extname(normalized).toLowerCase());
  if (!allowedRootFile && !allowedSourceFile) return null;
  const absolute = path.resolve(DEV_SOURCE_ROOT, normalized);
  if (!absolute.startsWith(DEV_SOURCE_ROOT + path.sep)) return null;
  return { relative: normalized, absolute };
}

function listDeveloperSourceFiles() {
  const files = [...DEV_ROOT_FILES].filter(name => fs.existsSync(path.join(DEV_SOURCE_ROOT, name)));
  const walk = directory => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === 'data' || entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(absolute);
      } else if (DEV_SOURCE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        files.push(path.relative(DEV_SOURCE_ROOT, absolute).replace(/\\/g, '/'));
      }
    }
  };
  walk(path.join(DEV_SOURCE_ROOT, 'src'));
  return files.sort((a, b) => a.localeCompare(b, 'fr'));
}

app.get('/api/dev/me', (req, res) => {
  const player = getDeveloperSession(req);
  if (!player) return res.status(403).json({ error: 'Acces developpeur requis.' });
  res.json({ ok: true, id: player.id, pseudo: player.pseudo, role: player.role });
});

app.get('/api/dev/sources', (req, res) => {
  if (!getDeveloperSession(req)) return res.status(403).json({ error: 'Acces developpeur requis.' });
  res.json({ files: listDeveloperSourceFiles() });
});

app.get('/api/dev/source', (req, res) => {
  if (!getDeveloperSession(req)) return res.status(403).json({ error: 'Acces developpeur requis.' });
  const target = normalizeDeveloperSourcePath(req.query.path);
  if (!target || !fs.existsSync(target.absolute) || !fs.statSync(target.absolute).isFile()) {
    return res.status(404).json({ error: 'Fichier source introuvable.' });
  }
  const size = fs.statSync(target.absolute).size;
  if (size > 1024 * 1024) return res.status(413).json({ error: 'Fichier trop volumineux.' });
  res.json({
    path: target.relative,
    language: path.extname(target.relative).slice(1) || 'text',
    content: fs.readFileSync(target.absolute, 'utf8'),
  });
});

app.get('/api/dev/metrics', (req, res) => {
  if (!getDeveloperSession(req)) return res.status(403).json({ error: 'Acces developpeur requis.' });
  res.json({
    estimated: true,
    platform: `${os.platform()} ${os.release()}`,
    cpuModel: os.cpus()?.[0]?.model || 'CPU inconnue',
    cpuCores: os.cpus()?.length || 1,
    totalMemoryMb: Math.round(os.totalmem() / 1024 / 1024),
    uptimeSeconds: Math.round(process.uptime()),
    metrics: devMachineMetrics,
  });
});

app.get('/api/dev/bot-usage', (req, res) => {
  if (!getDeveloperSession(req)) return res.status(403).json({ error: 'Acces developpeur requis.' });
  const hostedBots = db.prepare(`
    SELECT b.id, b.pseudo, b.avatar, b.color, b.bot_enabled,
           h.status, h.pid, h.started_at, h.stopped_at, h.updated_at, h.expires_at, h.metrics
    FROM bot_hosts h
    JOIN players b ON b.id = h.bot_id
    WHERE b.deleted = 0 AND b.is_bot = 1
    ORDER BY
      CASE h.status WHEN 'running' THEN 0 WHEN 'crashed' THEN 1 ELSE 2 END,
      b.pseudo COLLATE NOCASE ASC
  `).all().filter(row => !builtinBotIds.has(Number(row.id || 0))).map(row => {
    let metrics = [];
    try {
      const parsed = JSON.parse(String(row.metrics || '[]'));
      if (Array.isArray(parsed)) {
        metrics = parsed.slice(-BOT_HOST_METRIC_LIMIT).map(sample => ({
          at: Number(sample?.at || 0),
          cpuPct: Number(sample?.cpuPct || 0),
          rssMb: Number(sample?.rssMb || 0),
          netKb: Number(sample?.netKb || 0),
        })).filter(sample => sample.at > 0);
      }
    } catch (_) {}
    const runtime = getBotHostRuntime(row.id);
    const status = runtime ? 'running' : String(row.status || 'stopped');
    return {
      id: Number(row.id),
      pseudo: String(row.pseudo || `Bot #${row.id}`),
      avatar: String(row.avatar || ''),
      color: String(row.color || '#85EBFF'),
      enabled: Number(row.bot_enabled || 0) === 1,
      status,
      source: 'hosted',
      sharedProcess: false,
      pid: runtime ? Number(runtime.pid || 0) : Number(row.pid || 0),
      startedAt: Number(row.started_at || 0) || null,
      stoppedAt: Number(row.stopped_at || 0) || null,
      updatedAt: Number(row.updated_at || 0) || null,
      expiresAt: Number(row.expires_at || 0) || null,
      metrics,
      lastMetric: metrics[metrics.length - 1] || null,
    };
  });
  const sharedMetrics = devMachineMetrics.map(sample => ({
    at: Number(sample?.at || 0),
    cpuPct: Number(sample?.processCpuPct || 0),
    rssMb: Number(sample?.processRssMb || 0),
    netKb: Number(sample?.networkRxKbps || 0) + Number(sample?.networkTxKbps || 0),
  })).filter(sample => sample.at > 0);
  const builtinBots = [...builtinBotIds].map(id => pQ.getById.get(id)).filter(bot => (
    bot && !bot.deleted && Number(bot.is_bot || 0) === 1
  )).map(bot => {
    const playing = !!findActiveBotGame(bot.id);
    return {
      id: Number(bot.id),
      pseudo: String(bot.pseudo || `Bot #${bot.id}`),
      avatar: String(bot.avatar || ''),
      color: String(bot.color || '#85EBFF'),
      enabled: Number(bot.bot_enabled || 0) === 1,
      status: playing ? 'arena' : 'shared',
      source: 'builtin',
      sharedProcess: true,
      pid: Number(process.pid || 0),
      startedAt: null,
      stoppedAt: null,
      updatedAt: Date.now(),
      expiresAt: null,
      metrics: sharedMetrics,
      lastMetric: sharedMetrics[sharedMetrics.length - 1] || null,
    };
  }).sort((a, b) => a.pseudo.localeCompare(b.pseudo, 'fr', { sensitivity: 'base' }));
  res.json({
    generatedAt: Date.now(),
    sampleIntervalMs: BOT_HOST_WATCHDOG_MS,
    limits: {
      rssMb: BOT_HOST_MAX_RSS_MB,
      cpuPct: Math.round((BOT_HOST_MAX_CPU_MS_PER_MIN / 60_000) * 100),
    },
    bots: [...builtinBots, ...hostedBots],
  });
});

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
      pQ.updateRole.run({ role: discordRole, id: player.id });
      role = discordRole;
    }
  } catch(e) {}
  if (!['admin', 'moderator'].includes(role)) {
    return res.status(403).json({ error: 'Reserve au staff.' });
  }
  res.json({ password: ADMIN_PASSWORD });
});

// Auth admin
// Sessions admin en memoire
const adminSessions = new Map(); // token -> { playerId, role }
const adminLoginCodes = new Map(); // requestId -> { playerId, role, code, expiresAt, attempts }

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

function findAdminLoginPlayer(adminIdentity, playerToken) {
  const raw = String(adminIdentity || '').trim();
  if (!raw) {
    const playerId = validateSession(playerToken);
    return playerId ? pQ.getById.get(playerId) : null;
  }
  const identity = raw.replace(/^@+/, '').trim();
  const byDiscordId = /^\d{15,25}$/.test(identity)
    ? db.prepare(`SELECT * FROM players WHERE discord_id = ? AND deleted = 0 ORDER BY id ASC LIMIT 1`).get(identity)
    : null;
  if (byDiscordId) return byDiscordId;

  const byPseudo = db.prepare(`SELECT * FROM players WHERE lower(pseudo) = lower(?) AND deleted = 0 ORDER BY id ASC LIMIT 1`).get(identity);
  if (byPseudo) return byPseudo;

  const linked = db.prepare(`
    SELECT *
    FROM players
    WHERE discord_id IS NOT NULL
      AND discord_id != ''
      AND discord_info IS NOT NULL
      AND discord_info != ''
      AND deleted = 0
  `).all();
  return linked.find(player => {
    try {
      const info = JSON.parse(player.discord_info || '{}');
      return [info.username, info.global_name, info.display_name]
        .filter(Boolean)
        .some(name => String(name).toLowerCase() === identity.toLowerCase());
    } catch {
      return false;
    }
  }) || null;
}

async function resolveAdminLoginContext(password, playerToken, adminIdentity) {
  if (password !== ADMIN_PASSWORD) {
    return { status: 403, error: 'Mot de passe incorrect.' };
  }

  const player = findAdminLoginPlayer(adminIdentity, playerToken);
  if (!player) return { status: 403, error: 'Compte staff introuvable. Entre ton pseudo ou ton ID Discord.' };
  if (!player?.discord_id) {
    return { status: 403, error: 'Compte Discord requis pour acceder au panel.' };
  }

  let role = player.role;
  try {
    const { botToken } = discordConfig();
    const discordRole = await getDiscordRole(player.discord_id, botToken);
    if (discordRole !== player.role) {
      pQ.updateRole.run({ role: discordRole, id: player.id });
      role = discordRole;
    }
  } catch(e) {}

  if (!['admin', 'moderator'].includes(role)) {
    return { status: 403, error: "Ton role Discord ne permet pas l'acces au panel." };
  }

  return { playerId: player.id, player, role };
}

app.post('/api/admin/login', async (req, res) => {
  const { password, playerToken, adminIdentity, requestId, code } = req.body || {};
  const ctx = await resolveAdminLoginContext(password, playerToken, adminIdentity);
  if (ctx.error) return res.status(ctx.status || 403).json({ error: ctx.error });

  if (requestId) {
    const challenge = adminLoginCodes.get(String(requestId));
    if (!challenge) return res.status(403).json({ error: 'Code Discord expire ou invalide.' });
    if (Date.now() > challenge.expiresAt) {
      adminLoginCodes.delete(String(requestId));
      return res.status(403).json({ error: 'Code Discord expire. Relance la connexion.' });
    }
    if (challenge.playerId !== ctx.playerId) {
      adminLoginCodes.delete(String(requestId));
      return res.status(403).json({ error: 'Code Discord invalide pour cette session.' });
    }
    if (String(code || '').trim() !== challenge.code) {
      challenge.attempts += 1;
      if (challenge.attempts >= 5) adminLoginCodes.delete(String(requestId));
      return res.status(403).json({ error: 'Code Discord incorrect.' });
    }
    adminLoginCodes.delete(String(requestId));

    const token = require('crypto').randomBytes(32).toString('hex');
    adminSessions.set(token, { playerId: ctx.playerId, role: ctx.role });
    setTimeout(() => adminSessions.delete(token), 4 * 60 * 60 * 1000); // 4h
    WH.wlogAdminLogin();
    return res.json({ token, role: ctx.role });
  }

  const crypto = require('crypto');
  const challengeId = crypto.randomBytes(16).toString('hex');
  const challengeCode = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  const challengeExpiresAt = Date.now() + 10 * 60 * 1000;
  adminLoginCodes.set(challengeId, {
    playerId: ctx.playerId,
    role: ctx.role,
    code: challengeCode,
    expiresAt: challengeExpiresAt,
    attempts: 0,
  });
  setTimeout(() => adminLoginCodes.delete(challengeId), 10 * 60 * 1000);
  const stopcode = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
  try {
    await sendDM(ctx.player.discord_id, [
      '# 🖥️ **Puissance 4 - Administration & Gestion** 🖥️',
      `**Bonjour <@${ctx.player.discord_id}> 👋**`,
      '',
      "Vous avez demandé un accès au panel d'administration 🚨",
      `🔒 Pour la sécurité, veuillez taper le code suivant : **${challengeCode}**`,
      `⏱️ Il expire <t:${Math.floor(challengeExpiresAt / 1000)}:R>. Ne le partagez avec personne.`,
      '',
      `🛑 STOP ${stopcode}`,
    ].join('\n'));
  } catch (e) {
    adminLoginCodes.delete(challengeId);
    return res.status(500).json({ error: "Impossible d'envoyer le code Discord. Verifie que le bot peut t'envoyer un DM." });
  }

  res.json({ requiresCode: true, requestId: challengeId, role: ctx.role });
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
  const players = db.prepare(`SELECT id, pseudo, elo, coins, gems, bot_crystals, role, is_vip, is_vip_plus, is_perso, is_crystal, crystal_expires_at, crystal_auto_renew, vip_expires_at, color_secondary, custom_role_text, custom_role_color, custom_role_emoji, wins, losses, draws, suspicious, banned, banned_until, muted_until, created_at, discord_id, discord_info, last_seen, is_bot, bot_enabled, bot_owner_id FROM players WHERE deleted = 0 ORDER BY elo DESC`).all();
  // Enrichir avec le statut en ligne
  const now = Date.now();
  const ownedBotCountQ = db.prepare(`SELECT COUNT(*) AS c FROM players WHERE deleted = 0 AND is_guest = 0 AND is_bot = 1 AND bot_owner_id = ?`);
  const enriched = players.map(p => {
    isPlayerBanned(p);
    return {
      ...p,
      online: onlineSockets.has(p.id) && onlineSockets.get(p.id).size > 0,
      discord_linked: !!(p.discord_id),
      owned_bot_count: Number(ownedBotCountQ.get(p.id)?.c || 0),
      shop_inventory: Object.fromEntries(
        shopItemQ.getAllForPlayer.all(p.id).map(row => [row.item_key, Number(row.quantity || 0)])
      ),
    };
  });
  res.json(enriched);
});

app.patch('/api/admin/players/:id/coins', (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Action reservee aux admins.' });
  const id = Number(req.params.id);
  const target = pQ.getById.get(id);
  if (!target) return res.status(404).json({ error: 'Joueur introuvable.' });
  const delta = Number(req.body?.delta);
  if (!Number.isFinite(delta) || !Number.isInteger(delta) || delta === 0) {
    return res.status(400).json({ error: 'Montant invalide.' });
  }
  const nextCoins = Math.max(0, Number(target.coins || 0) + delta);
  pQ.updateCoins.run({ coins: nextCoins, id });
  try {
    WH.wlogAdminAction(delta > 0 ? 'Coins ajoutes' : 'Coins retires', target.pseudo, id, [
      ['Variation', `${delta > 0 ? '+' : ''}${delta}`, true],
      ['Nouveau total', String(nextCoins), true],
    ]);
  } catch(e) {}
  notifyPlayerProfileChanged(id, `Coins modifies par le staff (${delta > 0 ? '+' : ''}${delta}).`);
  res.json({ ok: true, coins: nextCoins, added: delta });
});

app.patch('/api/admin/players/:id/gems', (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Action reservee aux admins.' });
  const id = Number(req.params.id);
  const target = pQ.getById.get(id);
  if (!target) return res.status(404).json({ error: 'Joueur introuvable.' });
  const delta = Number(req.body?.delta);
  if (!Number.isFinite(delta) || !Number.isInteger(delta) || delta === 0) {
    return res.status(400).json({ error: 'Montant invalide.' });
  }
  const nextGems = Math.max(0, Number(target.gems || 0) + delta);
  pQ.updateGems.run({ gems: nextGems, id });
  try {
    WH.wlogGems(target.pseudo, id, delta, 'Modification staff');
    WH.wlogAdminAction(delta > 0 ? 'Gemmes ajoutees' : 'Gemmes retirees', target.pseudo, id, [
      ['Variation', `${delta > 0 ? '+' : ''}${delta}`, true],
      ['Nouveau total', String(nextGems), true],
    ]);
  } catch(e) {}
  notifyPlayerProfileChanged(id, `Gemmes modifiees par le staff (${delta > 0 ? '+' : ''}${delta}).`);
  res.json({ ok: true, gems: nextGems, added: delta });
});

app.patch('/api/admin/players/:id/bot-crystals', (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Non autorise.' });
  const id = Number(req.params.id);
  const target = pQ.getById.get(id);
  if (!target || Number(target.deleted || 0) === 1) return res.status(404).json({ error: 'Joueur introuvable.' });
  if (Number(target.is_bot || 0) === 1) return res.status(400).json({ error: 'Les Cristaux se donnent au createur humain, pas au compte bot.' });
  const ownedBotCount = Number(db.prepare(`SELECT COUNT(*) AS c FROM players WHERE deleted = 0 AND is_guest = 0 AND is_bot = 1 AND bot_owner_id = ?`).get(id)?.c || 0);
  if (ownedBotCount <= 0) return res.status(400).json({ error: 'Ce joueur n a aucun bot associe.' });
  const delta = Number(req.body?.delta);
  if (!Number.isFinite(delta) || !Number.isInteger(delta) || delta === 0) {
    return res.status(400).json({ error: 'Montant invalide.' });
  }
  const nextCrystals = Math.max(0, Number(target.bot_crystals || 0) + delta);
  pQ.updateBotCrystals.run({ bot_crystals: nextCrystals, id });
  try {
    WH.wlogAdminAction(delta > 0 ? 'Cristaux bot ajoutes' : 'Cristaux bot retires', target.pseudo, id, [
      ['Variation', `${delta > 0 ? '+' : ''}${delta}`, true],
      ['Nouveau total', String(nextCrystals), true],
      ['Bots associes', String(ownedBotCount), true],
    ]);
  } catch(e) {}
  notifyPlayerProfileChanged(id, `Cristaux bot modifies par le staff (${delta > 0 ? '+' : ''}${delta}).`);
  res.json({ ok: true, bot_crystals: nextCrystals, added: delta, ownedBotCount });
});

app.patch('/api/admin/players/:id/bot-enabled', (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Non autorise.' });
  const id = Number(req.params.id);
  const target = pQ.getById.get(id);
  if (!target || Number(target.is_bot || 0) !== 1) return res.status(404).json({ error: 'Bot introuvable.' });
  const enabled = req.body?.enabled ? 1 : 0;
  db.prepare(`UPDATE players SET bot_enabled = ? WHERE id = ?`).run(enabled, id);
  if (!enabled) {
    const qIdx = botApiQueue.indexOf(id);
    if (qIdx >= 0) botApiQueue.splice(qIdx, 1);
    botRuntime.set(id, { status: 'suspended', lastSeen: Date.now() });
  }
  notifyPlayerProfileChanged(id, enabled ? 'Bot reactive par le staff.' : 'Bot suspendu par le staff.');
  res.json({ ok: true, bot_enabled: enabled });
});

app.post('/api/admin/coupons', (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Non autorise.' });
  const code = normalizeCouponCode(req.body?.code || crypto.randomBytes(4).toString('hex').toUpperCase());
  const type = String(req.body?.type || 'discount') === 'flat' ? 'flat' : 'discount';
  const value = Math.max(1, Math.min(type === 'flat' ? 100000 : 95, Math.trunc(Number(req.body?.value || 20))));
  const maxUses = Math.max(1, Math.min(10000, Math.trunc(Number(req.body?.maxUses || 1))));
  const durationHours = Math.max(0, Math.min(24 * 365, Number(req.body?.durationHours || 0)));
  const expiresAt = durationHours > 0 ? Date.now() + durationHours * 60 * 60 * 1000 : null;
  db.prepare(`
    INSERT INTO coupons (code, type, value, max_uses, uses, expires_at, created_by, created_at)
    VALUES (?, ?, ?, ?, 0, ?, NULL, ?)
    ON CONFLICT(code) DO UPDATE SET type=excluded.type, value=excluded.value, max_uses=excluded.max_uses, expires_at=excluded.expires_at
  `).run(code, type, value, maxUses, expiresAt, Date.now());
  WH.wlogCoupon(code, type, value, maxUses, expiresAt, req.headers['x-admin-identity'] || 'Admin');
  res.json({ ok: true, coupon: { code, type, value, maxUses, expiresAt } });
});

app.get('/api/admin/coupons', (req, res) => {
  if (!isModo(req)) return res.status(403).json({ error: 'Non autorise.' });
  const now = Date.now();
  const rows = db.prepare(`
    SELECT code, type, value, max_uses, uses, expires_at, created_at
    FROM coupons
    WHERE (expires_at IS NULL OR expires_at = 0 OR expires_at > ?)
      AND (max_uses <= 0 OR uses < max_uses)
    ORDER BY COALESCE(expires_at, 9999999999999) ASC, created_at DESC
    LIMIT 40
  `).all(now);
  res.json(rows.map(row => ({
    code: row.code,
    type: row.type,
    value: Number(row.value || 0),
    maxUses: Number(row.max_uses || 0),
    uses: Number(row.uses || 0),
    expiresAt: Number(row.expires_at || 0) || null,
    remainingMs: Number(row.expires_at || 0) ? Math.max(0, Number(row.expires_at || 0) - now) : null,
  })));
});

app.delete('/api/admin/coupons/:code', (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Non autorise.' });
  const code = normalizeCouponCode(req.params.code);
  if (!code) return res.status(400).json({ error: 'Code invalide.' });
  db.prepare(`DELETE FROM coupon_uses WHERE code = ?`).run(code);
  const result = db.prepare(`DELETE FROM coupons WHERE code = ?`).run(code);
  res.json({ ok: result.changes > 0, deleted: result.changes > 0 });
});

function setConfigValue(key, value) {
  db.prepare(`INSERT INTO config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`).run(key, String(value ?? ''));
}

function getConfigValue(key, fallback = '') {
  return db.prepare(`SELECT value FROM config WHERE key = ?`).get(key)?.value ?? fallback;
}

app.post('/api/admin/limited-pack', (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Non autorise.' });
  const durationHours = Math.max(1, Math.min(24 * 30, Number(req.body?.durationHours || 24)));
  const expiresAt = Date.now() + durationHours * 60 * 60 * 1000;
  const label = String(req.body?.label || 'Offre limitee').trim().slice(0, 48) || 'Offre limitee';
  const rawItems = parseLimitedPackItems(req.body?.items || req.body?.contents || '');
  const priceCoins = Math.max(1, Math.min(999999, Math.trunc(Number(req.body?.priceCoins || req.body?.price || 1000))));
  const priceGems = Math.max(1, Math.min(999999, Math.trunc(Number(req.body?.priceGems || Math.ceil(priceCoins * 0.45)))));
  const stock = Math.max(1, Math.min(10000, Math.trunc(Number(req.body?.stock || 50))));
  if (!rawItems.length) return res.status(400).json({ error: 'Ajoute au moins un contenu dans le pack.' });

  setConfigValue('shop_limited_offer_code', '');
  setConfigValue('shop_limited_offer_label', label);
  setConfigValue('shop_limited_offer_ends_at', expiresAt);
  setConfigValue('shop_limited_offer_items', JSON.stringify(rawItems));
  setConfigValue('shop_limited_offer_price', priceCoins);
  setConfigValue('shop_limited_offer_gem_price', priceGems);
  setConfigValue('shop_limited_offer_stock', stock);

  const offer = { label, priceCoins, priceGems, stock, expiresAt, items: rawItems };
  try { WH.wlogLimitedPack(offer, req.headers['x-admin-identity'] || 'Admin'); } catch(e) {}
  res.json({ ok: true, offer });
});

app.patch('/api/admin/players/:id/shop-item', (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Action reservee aux admins.' });
  const id = Number(req.params.id);
  const target = pQ.getById.get(id);
  if (!target) return res.status(404).json({ error: 'Joueur introuvable.' });

  const itemKey = String(req.body?.itemKey || '').trim();
  const quantity = Number(req.body?.quantity);
  const item = resolveInventoryShopItem(itemKey);

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

  notifyPlayerProfileChanged(id, `Booster ajoute par le staff : ${item.label} x${quantity}.`);
  res.json({ ok: true, itemKey, quantity, total: nextQty });
});

app.patch('/api/admin/players/:id/token-collection', (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Action reservee aux admins.' });
  const id = Number(req.params.id);
  const target = pQ.getById.get(id);
  if (!target || Number(target.deleted || 0) === 1) return res.status(404).json({ error: 'Joueur introuvable.' });

  const tokenKey = String(req.body?.tokenKey || '').trim();
  const quantity = Number(req.body?.quantity);
  const token = TOKEN_COLOR_CATALOG.find(item => item.key === tokenKey);
  if (!token) return res.status(400).json({ error: 'Jeton de collection invalide.' });
  if (!Number.isFinite(quantity) || !Number.isInteger(quantity) || quantity <= 0 || quantity > 50) {
    return res.status(400).json({ error: 'Quantite invalide.' });
  }

  const now = Date.now();
  db.transaction(() => {
    for (let i = 0; i < quantity; i++) {
      tokenCollectionQ.add.run({ player_id: id, color_key: token.key, now });
    }
  })();

  try {
    WH.wlogAdminAction('Jeton collection donne', target.pseudo, id, [
      ['Jeton', token.label, true],
      ['Ajout', String(quantity), true],
    ]);
  } catch (e) {}

  notifyPlayerProfileChanged(id, `Jeton de collection ajoute par le staff : ${token.label} x${quantity}.`);
  res.json({ ok: true, token: { key: token.key, label: token.label }, quantity });
});

app.patch('/api/admin/players/:id/crystal', (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Seuls les admins peuvent modifier Crystal.' });
  const id = Number(req.params.id);
  const target = pQ.getById.get(id);
  if (!target) return res.status(404).json({ error: 'Joueur introuvable.' });
  const enabled = req.body?.enabled !== false;
  if (!enabled) {
    removeCrystal(id);
    notifyPlayerProfileChanged(id, 'Crystal retire par le staff.');
    return res.json({ ok: true, crystal: null });
  }
  const days = Math.max(1, Math.min(3650, Math.trunc(Number(req.body?.days || 30))));
  const autoRenew = req.body?.autoRenew !== false;
  const fresh = grantCrystal(id, { durationMs: days * 24 * 60 * 60 * 1000, autoRenew });
  try {
    WH.wlogAdminAction('Crystal accorde', target.pseudo, id, [
      ['Duree', `${days} jour(s)`, true],
      ['Renouvellement', autoRenew ? 'auto' : 'non', true],
    ]);
  } catch(e) {}
  notifyPlayerProfileChanged(id, `Crystal accorde par le staff (${days}j).`);
  res.json({ ok: true, crystal: sanitize(fresh) });
});

// Changer le rAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAAle
app.patch('/api/admin/players/:id/role', async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Seuls les admins peuvent changer les rôles.' });
  const { role } = req.body;
  const vipDuration = String(req.body?.vipDuration || '').trim();
  if (!['user','vip','vipplus','perso','crystal','moderator','admin'].includes(role)) return res.status(400).json({ error: 'Role invalide.' });
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
  if (role === 'crystal') {
    const days = Math.max(1, Math.min(3650, Math.trunc(Number(req.body?.crystalDays || req.body?.days || 30))));
    grantCrystal(targetId, { durationMs: days * 24 * 60 * 60 * 1000, autoRenew: req.body?.autoRenew !== false });
    WH.wlogAdminAction('Crystal accorde', target.pseudo, req.params.id, [['Duree', `${days} jour(s)`, true]]);
  } else if (role === 'vip') {
    if (!vipExpiryMap[vipDuration]) return res.status(400).json({ error: 'Choisis une duree VIP valide.' });
    WH.wlogAdminAction('VIP accordée', target.pseudo, req.params.id, [['VIP avant', oldVip ? 'oui' : 'non', true], ['VIP après', 'oui', true]]);
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
        ? "Le statut **VIP** vient d'être offert pendant une durée limité. N'hésite pas à le prolonger dans la Boutique 🛒"
        : role === 'vipplus'
          ? "Le statut **VIP+** vient de t'être attribue."
        : `Ton rôle a été modifié en : **${oldRole}** devient à présent **${role}**`,
      '_Si tu as des questions, contacte un administrateur sur le serveur Discord._',
    ].join('\n')); } catch(e) {}
  }
  const roleLabel = role === 'vipplus' ? 'VIP+' : role.toUpperCase();
  notifyPlayerProfileChanged(targetId, `Role modifie par le staff : ${roleLabel}.`);
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
  const rawColorSecondary = String(req.body?.colorSecondary || '').trim();
  const rawEmoji = String(req.body?.emoji || '').trim();
  const rgb = req.body?.rgb == null
    ? Number(target.custom_role_rgb || 0) === 1
    : req.body.rgb === true || req.body.rgb === 1 || req.body.rgb === '1' || req.body.rgb === 'true';
  if (rgb && Number(target.is_perso || 0) !== 1) {
    return res.status(403).json({ error: 'Le RGB du badge est reserve au rang Perso.' });
  }
  if (rawText.length > CUSTOM_ROLE_MAX_LENGTH) return res.status(400).json({ error: `Le role personnalise doit faire ${CUSTOM_ROLE_MAX_LENGTH} caracteres max.` });
  if (rawText && !rawColor) return res.status(400).json({ error: 'Une couleur est requise pour le role personnalise.' });
  if (rawColor && !/^#[0-9a-fA-F]{6}$/.test(rawColor)) return res.status(400).json({ error: 'Couleur invalide.' });
  if (rawColorSecondary && !/^#[0-9a-fA-F]{6}$/.test(rawColorSecondary)) return res.status(400).json({ error: 'Couleur secondaire invalide.' });
  const emoji = rawEmoji ? [...rawEmoji][0] : '';

  pQ.updateCustomRole.run({
    id,
    text: rawText,
    color: rawText ? rawColor.toUpperCase() : '',
    colorSecondary: rawText ? rawColorSecondary.toUpperCase() : '',
    emoji: rawText ? emoji : '',
    rgb: rawText && rgb ? 1 : 0,
  });
  WH.wlogAdminAction('Role personnalise', target.pseudo, id, [
    ['Texte', rawText || 'aucun', true],
    ['Couleur', rawText ? rawColor.toUpperCase() : 'aucune', true],
    ['Couleur 2', rawText && rawColorSecondary ? rawColorSecondary.toUpperCase() : 'aucune', true],
    ['Emoji', rawText ? (emoji || 'aucun') : 'aucun', true],
    ['RGB', rawText && rgb ? 'oui' : 'non', true],
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
  notifyPlayerProfileChanged(id, rawText ? `Badge perso modifie par le staff : ${rawText}.` : 'Badge perso retire par le staff.');
  res.json({ ok: true });
});

app.patch('/api/players/:id/custom-role', (req, res) => {
  const id = Number(req.params.id);
  const token = String(req.body?.token || '');
  const playerId = validateSession(token);
  if (!playerId || playerId !== id) return res.status(401).json({ error: 'Session invalide.' });
  const target = pQ.getById.get(id);
  if (!target) return res.status(404).json({ error: 'Joueur introuvable.' });
  if (Number(target.is_perso || 0) !== 1 && !isAdminPlayer(target)) {
    return res.status(403).json({ error: 'Le badge personnalise est reserve au rang Perso et aux admins.' });
  }

  const rawText = String(req.body?.text || '').trim();
  const rawColor = String(req.body?.color || '').trim();
  const rawColorSecondary = String(req.body?.colorSecondary || '').trim();
  const rawEmoji = String(req.body?.emoji || '').trim();
  const rgb = req.body?.rgb === true || req.body?.rgb === 1 || req.body?.rgb === '1' || req.body?.rgb === 'true';
  if (rgb && Number(target.is_perso || 0) !== 1) {
    return res.status(403).json({ error: 'Le RGB du badge est reserve au rang Perso.' });
  }
  if (rawText.length > CUSTOM_ROLE_MAX_LENGTH) return res.status(400).json({ error: `Le badge perso doit faire ${CUSTOM_ROLE_MAX_LENGTH} caracteres max.` });
  if (rawText && !rawColor) return res.status(400).json({ error: 'Une couleur est requise.' });
  if (rawColor && !/^#[0-9a-fA-F]{6}$/.test(rawColor)) return res.status(400).json({ error: 'Couleur invalide.' });
  if (rawColorSecondary && !/^#[0-9a-fA-F]{6}$/.test(rawColorSecondary)) return res.status(400).json({ error: 'Couleur secondaire invalide.' });
  const emoji = rawEmoji ? [...rawEmoji][0] : '';
  const nextColor = rawText ? rawColor.toUpperCase() : '';
  const nextColorSecondary = rawText && rawColorSecondary ? rawColorSecondary.toUpperCase() : '';

  pQ.updateCustomRole.run({
    id,
    text: rawText,
    color: nextColor,
    colorSecondary: nextColorSecondary,
    emoji: rawText ? emoji : '',
    rgb: rawText && rgb ? 1 : 0,
  });

  try {
    WH.wlogAdminAction('Badge perso profil', target.pseudo, id, [
      ['Texte', rawText || 'aucun', true],
      ['Couleur', nextColor || 'aucune', true],
      ['Couleur 2', nextColorSecondary || 'aucune', true],
      ['Emoji', rawText ? (emoji || 'aucun') : 'aucun', true],
      ['RGB', rawText && rgb ? 'oui' : 'non', true],
    ]);
  } catch(e) {}

  res.json({ ok: true, text: rawText, color: nextColor, colorSecondary: nextColorSecondary, emoji: rawText ? emoji : '', rgb: rawText && rgb ? 1 : 0 });
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
    notifyPlayerProfileChanged(Number(req.params.id), `Pseudo modifie par le staff : ${oldPseudo} devient ${pseudo.trim()}.`);
    res.json({ ok: true });
  } catch(e) { res.status(400).json({ error: 'Ce pseudo est déjà utilisé' }); }
});

// Reset ELO
app.patch('/api/admin/players/:id/elo', (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Action reservee aux admins.' });
  const { elo } = req.body;
  const _pe = pQ.getById.get(Number(req.params.id));
  WH.wlogAdminAction('ELO reset', _pe?.pseudo || req.params.id, req.params.id, [['Ancien ELO', _pe?.elo ?? '?', true], ['Nouveau ELO', elo, true]]);
  db.prepare('UPDATE players SET elo = ? WHERE id = ?').run(Number(elo) || 1000, Number(req.params.id));
  syncPlayerDiscordRankRole(Number(req.params.id)).catch(() => {});
  notifyPlayerProfileChanged(Number(req.params.id), `ELO modifie par le staff : ${Number(elo) || 1000}.`);
  res.json({ ok: true });
});

// Mute temporaire (interdit de jouer)
app.patch('/api/admin/players/:id/mute', (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Action reservee aux admins.' });
  const hours = Number(req.body?.hours);
  const minutes = Number(req.body?.minutes);
  const durationMinutes = Number.isFinite(minutes)
    ? Math.max(0, Math.floor(minutes))
    : (Number.isFinite(hours) ? Math.max(0, Math.floor(hours * 60)) : 0);
  const until = durationMinutes > 0 ? Date.now() + durationMinutes * 60 * 1000 : null;
  const _pm = pQ.getById.get(Number(req.params.id));
  WH.wlogMute(_pm?.pseudo || req.params.id, req.params.id, durationMinutes / 60);
  pQ.setMute.run({ until, id: Number(req.params.id) });
  notifyPlayerProfileChanged(Number(req.params.id), durationMinutes > 0 ? `Mute applique par le staff (${durationMinutes} min).` : 'Mute retire par le staff.');
  res.json({ ok: true, minutes: durationMinutes });
});

// Ban / Unban
app.patch('/api/admin/players/:id/ban', (req, res) => {
  if (!isModo(req)) return res.status(403).json({ error: 'Action reservee au staff.' });
  const banned = req.body?.banned !== false;
  const durationMinutes = Math.max(0, Math.min(525600, Math.trunc(Number(req.body?.durationMinutes || 0))));
  const until = banned && durationMinutes > 0 ? Date.now() + durationMinutes * 60 * 1000 : null;
  const _pb = pQ.getById.get(Number(req.params.id));
  WH.wlogBan(_pb?.pseudo || req.params.id, req.params.id, banned);
  pQ.setBanned.run({ banned: banned ? 1 : 0, until, id: Number(req.params.id) });
  const message = !banned
    ? 'Bannissement retire par le staff.'
    : until
      ? `Compte banni temporairement par le staff (${durationMinutes} min).`
      : 'Compte banni definitivement par le staff.';
  notifyPlayerProfileChanged(Number(req.params.id), message);
  res.json({ ok: true, banned, bannedUntil: until });
});

// Reset suspicious
app.patch('/api/admin/players/:id/suspicious', (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Action reservee aux admins.' });
  abQ.setSuspicious.run({ val: 0, id: Number(req.params.id) });
  notifyPlayerProfileChanged(Number(req.params.id), 'Statut suspect retire par le staff.');
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
const DISCORD_ROLE_DEVELOPER = String(process.env.DISCORD_ROLE_DEVELOPER || '1513095490554826882').trim();
const DISCORD_ROLE_VIP = '1489360367246114866'; // RAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAAle VIP
const DISCORD_ROLE_VIP_PLUS = '1490328326806438058';
const DISCORD_ROLE_CUSTOM = '1490049340407021649';
const DISCORD_CONNECTED_ROLE_ID = process.env.DISCORD_CONNECTED_ROLE_ID || '1508402625370918952';
const DISCORD_CONNECTED_ROLE_NAME = process.env.DISCORD_CONNECTED_ROLE_NAME || 'Connect\u00e9e';
const DISCORD_GUILD_OWNER_ID = process.env.DISCORD_GUILD_OWNER_ID || '1147963951989149796';
const DISCORD_REST_DELAY_MS = Number(process.env.DISCORD_REST_DELAY_MS || 650);
const DISCORD_REST_TIMEOUT_MS = Math.max(3000, Number(process.env.DISCORD_REST_TIMEOUT_MS || 10000));
const DISCORD_REST_LOG_RATELIMIT = String(process.env.DISCORD_REST_LOG_RATELIMIT || '0') === '1';
const discordRestQueues = new Map();
const DISCORD_CONNECTED_RECONCILE_INTERVAL_MS = Math.max(10_000, Number(process.env.DISCORD_CONNECTED_RECONCILE_INTERVAL_MS || 10_000));
const DISCORD_MEMBER_CACHE_TTL_MS = Number(process.env.DISCORD_MEMBER_CACHE_TTL_MS || 5 * 60 * 1000);
const DISCORD_ROLE_CACHE_TTL_MS = Number(process.env.DISCORD_ROLE_CACHE_TTL_MS || 10 * 60 * 1000);
const DISCORD_ROLE_SYNC_BATCH_SIZE = Math.max(1, Number(process.env.DISCORD_ROLE_SYNC_BATCH_SIZE || 5));
const DISCORD_ROLE_SYNC_INTERVAL_MS = Math.max(60 * 1000, Number(process.env.DISCORD_ROLE_SYNC_INTERVAL_MS || 10 * 60 * 1000));
const discordMemberSnapshotCache = new Map();
let discordGuildRolesCache = { expiresAt: 0, roles: null };
let discordGuildOwnerCache = { expiresAt: 0, ownerId: DISCORD_GUILD_OWNER_ID || null };
const discordRenameBlockedUntil = new Map();
const REFERRAL_FILLEUL_DISCOUNT_PERCENT = 5;
const REFERRAL_REFERRER_DISCOUNT_PERCENT = 10;
const REFERRAL_SHOP_DISCOUNT_PERCENT = REFERRAL_FILLEUL_DISCOUNT_PERCENT;
const CRYSTAL_PRICE_COINS = 5000;
const CRYSTAL_MONTH_MS = 30 * 24 * 60 * 60 * 1000;
const CRYSTAL_WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const BOT_HOST_PRICE_CRYSTALS = 3000;
const BOT_HOST_MONTH_MS = 30 * 24 * 60 * 60 * 1000;
const BOT_HOST_MAX_CODE_BYTES = 256 * 1024;
const CUSTOM_ROLE_MAX_LENGTH = 8;
const COSMETIC_PACK_PRICE_COINS = 5000;
const COSMETIC_PACK_PRICE_GEMS = 100;
const COSMETIC_PACK_SIZE = 5;
const COSMETIC_PACK_NAMES = ['Aurore', 'Neon', 'Eclipse', 'Prisme', 'Comete', 'Mirage', 'Nova', 'Zenith', 'Pulse', 'Cosmos'];
const COSMETIC_PACK_COLORS = ['#ff2d55', '#5ac8fa', '#bf5af2', '#ffd60a', '#30d158', '#ff9f0a', '#85ebff', '#ff7a45', '#a78bfa', '#f472b6'];

function buildCosmeticPackItems() {
  const packs = {};
  const addPacks = (type, assets, label) => {
    for (let index = 0; index < assets.length; index += COSMETIC_PACK_SIZE) {
      const number = Math.floor(index / COSMETIC_PACK_SIZE) + 1;
      const key = `${type}_pack_${number}`;
      packs[key] = {
        key,
        category: 'cosmetics',
        cosmeticType: type,
        label: `Pack ${label} ${COSMETIC_PACK_NAMES[number - 1] || number}`,
        price: COSMETIC_PACK_PRICE_COINS,
        gemPrice: COSMETIC_PACK_PRICE_GEMS,
        accent: COSMETIC_PACK_COLORS[number - 1] || '#85ebff',
        assets: assets.slice(index, index + COSMETIC_PACK_SIZE),
      };
    }
  };
  addPacks('decoration', getAvatarDecorationPaths(), 'Decos');
  addPacks('font', PSEUDO_FONT_CATALOG, 'Polices');
  return packs;
}

const COSMETIC_PACKS = Object.freeze(buildCosmeticPackItems());
const SHOP_ITEMS = Object.freeze({
  crystal: { key: 'crystal', category: 'ranks', label: 'Crystal', price: CRYSTAL_PRICE_COINS },
  vip_1m: { key: 'vip_1m', category: 'ranks', label: 'VIP 1 mois', price: 100 },
  vip_1y: { key: 'vip_1y', category: 'ranks', label: 'VIP 1 an', price: 1000 },
  vip_plus: { key: 'vip_plus', category: 'ranks', label: 'VIP+', price: 5000 },
  perso: { key: 'perso', category: 'ranks', label: 'Perso', price: 15000 },
  elo_reset: { key: 'elo_reset', category: 'services', label: 'Reset ELO', price: 2500 },
  elo_mini: { key: 'elo_mini', category: 'elo_boosters', label: 'Mini Boost', price: 250, boostType: 'elo', multiplier: 1.05, defaultStock: 10 },
  elo_classic: { key: 'elo_classic', category: 'elo_boosters', label: 'Classic Boost', price: 750, boostType: 'elo', multiplier: 1.10, defaultStock: 5 },
  elo_max: { key: 'elo_max', category: 'elo_boosters', label: 'Max Boost', price: 2500, boostType: 'elo', multiplier: 1.25, defaultStock: 3 },
  elo_princess: { key: 'elo_princess', category: 'elo_boosters', label: 'Princess Boost', price: 5000, boostType: 'elo', multiplier: 1.50, defaultStock: 1 },
  coin_boost: { key: 'coin_boost', category: 'coin_boosters', label: 'Coin Boost', price: 3000, boostType: 'coins', multiplier: 5, defaultStock: 5 },
  coin_boost_plus: { key: 'coin_boost_plus', category: 'coin_boosters', label: 'Coin Boost +', price: 6000, boostType: 'coins', multiplier: 10, defaultStock: 3 },
  global_elo_boost: { key: 'global_elo_boost', category: 'global_boosters', label: 'Boost Global ELO', price: 5000, boostType: 'global_elo', multiplier: 1.20, defaultStock: 3 },
  global_coin_boost: { key: 'global_coin_boost', category: 'global_boosters', label: 'Boost Global Coins', price: 5000, boostType: 'global_coins', multiplier: 2, defaultStock: 3 },
  bot_host_1m: { key: 'bot_host_1m', category: 'bot_hosting', label: 'Host Bot 1 mois', price: 0, crystalPrice: BOT_HOST_PRICE_CRYSTALS },
  ...COSMETIC_PACKS,
});
const SHOP_PRICES = Object.freeze(Object.fromEntries(Object.entries(SHOP_ITEMS).map(([k, v]) => [k, v.price])));
const SHOP_GEM_PRICES = Object.freeze(Object.fromEntries(Object.entries(SHOP_ITEMS).map(([k, v]) => [
  k,
  Number.isFinite(Number(v.gemPrice)) ? Number(v.gemPrice) : Math.max(1, Math.ceil(Number(v.price || 0) * 0.45)),
])));
const SHOP_STOCK_KEYS = Object.freeze(
  Object.fromEntries(Object.values(SHOP_ITEMS).filter(v => Number.isFinite(v.defaultStock)).map(v => [v.key, `shop_stock_${v.key}`]))
);

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, Math.max(0, Number(ms || 0))));
}

async function discordRestFetch(bucket, url, options = {}) {
  const key = bucket || url;
  const previous = discordRestQueues.get(key) || Promise.resolve();
  let release;
  const current = new Promise(resolve => { release = resolve; });
  discordRestQueues.set(key, previous.then(() => current, () => current));
  await previous.catch(() => {});
  try {
    let res = null;
    for (let attempt = 0; attempt < 4; attempt++) {
      res = await fetch(url, {
        ...options,
        signal: options.signal || AbortSignal.timeout(DISCORD_REST_TIMEOUT_MS),
      });
      if (res.status !== 429) break;
      const body = await res.json().catch(() => ({}));
      const waitMs = Math.ceil(Number(body.retry_after || 1) * 1000) + 200;
      if (DISCORD_REST_LOG_RATELIMIT) console.warn('[DISCORD REST]', `rate limited, retry in ${waitMs}ms`);
      await wait(waitMs);
    }
    await wait(DISCORD_REST_DELAY_MS);
    return res;
  } finally {
    release();
    if (discordRestQueues.get(key) === current) discordRestQueues.delete(key);
  }
}

function validDiscordRoleId(roleId) {
  return !!String(roleId || '').trim() && String(roleId || '').trim().toLowerCase() !== 'undefined';
}

function invalidateDiscordMemberCache(discordUserId) {
  if (discordUserId) discordMemberSnapshotCache.delete(String(discordUserId));
}

async function fetchDiscordGuildRolesCached(botToken, { force = false } = {}) {
  if (!botToken) return [];
  const now = Date.now();
  if (!force && discordGuildRolesCache.roles && discordGuildRolesCache.expiresAt > now) {
    return discordGuildRolesCache.roles;
  }
  const res = await discordRestFetch('guild-roles', `https://discord.com/api/v10/guilds/${DISCORD_GUILD}/roles`, {
    headers: { 'Authorization': 'Bot ' + botToken },
  });
  if (!res.ok) return discordGuildRolesCache.roles || [];
  const roles = await res.json().catch(() => []);
  discordGuildRolesCache = {
    roles: Array.isArray(roles) ? roles : [],
    expiresAt: now + DISCORD_ROLE_CACHE_TTL_MS,
  };
  return discordGuildRolesCache.roles;
}

async function fetchDiscordGuildOwnerIdCached(botToken) {
  if (!botToken) return null;
  const now = Date.now();
  if (discordGuildOwnerCache.ownerId && discordGuildOwnerCache.expiresAt > now) {
    return discordGuildOwnerCache.ownerId;
  }
  if (DISCORD_GUILD_OWNER_ID) {
    discordGuildOwnerCache = {
      ownerId: DISCORD_GUILD_OWNER_ID,
      expiresAt: now + 24 * 60 * 60 * 1000,
    };
    return DISCORD_GUILD_OWNER_ID;
  }
  const res = await discordRestFetch('guild-info', `https://discord.com/api/v10/guilds/${DISCORD_GUILD}`, {
    headers: { 'Authorization': 'Bot ' + botToken },
  });
  if (!res.ok) return discordGuildOwnerCache.ownerId || null;
  const guild = await res.json().catch(() => ({}));
  discordGuildOwnerCache = {
    ownerId: guild.owner_id || null,
    expiresAt: now + 60 * 60 * 1000,
  };
  return discordGuildOwnerCache.ownerId;
}

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
  consumeOne: db.prepare(`
    UPDATE player_shop_items
    SET quantity = quantity - 1
    WHERE player_id = ? AND item_key = ? AND quantity > 0
  `),
};

const WELCOME_REWARDS = Object.freeze({
  coins: 500,
  gems: 10,
  items: [
    { key: 'elo_custom_0_2', quantity: 1 },
    { key: 'coin_custom_02', quantity: 1 },
  ],
});

function grantWelcomeRewards(playerId) {
  const id = Number(playerId || 0);
  if (!id) return;
  pQ.addCoins.run({ delta: WELCOME_REWARDS.coins, id });
  pQ.addGems.run({ delta: WELCOME_REWARDS.gems, id });
  for (const item of WELCOME_REWARDS.items) {
    shopItemQ.addQty.run({ player_id: id, item_key: item.key, quantity: item.quantity });
  }
}

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

function normalizeGlobalCoinMultiplier(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  const stepped = Math.round(numeric);
  if (stepped < 2 || stepped > 10) return null;
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
  if (pack === 'global_elo_custom') {
    const bonus = normalizeCustomEloBonus(body.customMultiplier);
    if (bonus === null) return null;
    return {
      key: `global_elo_custom_${bonus.toFixed(1).replace('.', '_')}`,
      displayKey: 'global_elo_custom',
      category: 'global_boosters',
      label: `Boost Global ELO x${(1 + bonus).toFixed(2)}`,
      price: Math.round((bonus / 0.1) * 2500),
      boostType: 'global_elo',
      multiplier: Number((1 + bonus).toFixed(2)),
      bonus,
      isCustom: true,
    };
  }
  if (pack === 'global_coin_custom') {
    const multiplier = normalizeGlobalCoinMultiplier(body.customMultiplier);
    if (multiplier === null) return null;
    return {
      key: `global_coin_custom_${String(multiplier).padStart(2, '0')}`,
      displayKey: 'global_coin_custom',
      category: 'global_boosters',
      label: `Boost Global Coins x${multiplier}`,
      price: multiplier * 2500,
      boostType: 'global_coins',
      multiplier,
      isCustom: true,
    };
  }
  return null;
}

function resolveInventoryShopItem(itemKey) {
  const key = String(itemKey || '').trim();
  if (!key) return null;
  if (SHOP_ITEMS[key]) return SHOP_ITEMS[key];
  const eloMatch = key.match(/^elo_custom_(\d+)_(\d+)$/);
  if (eloMatch) {
    const bonus = normalizeCustomEloBonus(Number(`${eloMatch[1]}.${eloMatch[2]}`));
    if (bonus === null) return null;
    return {
      key,
      category: 'elo_boosters',
      label: `Booster ELO x${(1 + bonus).toFixed(2)}`,
      boostType: 'elo',
      multiplier: Number((1 + bonus).toFixed(2)),
      isCustom: true,
    };
  }
  const coinMatch = key.match(/^coin_custom_(\d{1,2})$/);
  if (coinMatch) {
    const multiplier = normalizeCustomCoinMultiplier(Number(coinMatch[1]));
    if (multiplier === null) return null;
    return {
      key,
      category: 'coin_boosters',
      label: `Booster Coins x${multiplier}`,
      boostType: 'coins',
      multiplier,
      isCustom: true,
    };
  }
  const globalEloMatch = key.match(/^global_elo_custom_(\d+)_(\d+)$/);
  if (globalEloMatch) {
    const bonus = normalizeCustomEloBonus(Number(`${globalEloMatch[1]}.${globalEloMatch[2]}`));
    if (bonus === null) return null;
    return {
      key,
      category: 'global_boosters',
      label: `Boost Global ELO x${(1 + bonus).toFixed(2)}`,
      boostType: 'global_elo',
      multiplier: Number((1 + bonus).toFixed(2)),
      isCustom: true,
    };
  }
  const globalCoinMatch = key.match(/^global_coin_custom_(\d{1,2})$/);
  if (globalCoinMatch) {
    const multiplier = normalizeGlobalCoinMultiplier(Number(globalCoinMatch[1]));
    if (multiplier === null) return null;
    return {
      key,
      category: 'global_boosters',
      label: `Boost Global Coins x${multiplier}`,
      boostType: 'global_coins',
      multiplier,
      isCustom: true,
    };
  }
  return null;
}

function parseLimitedPackItems(value) {
  const raw = Array.isArray(value)
    ? value
    : String(value || '')
        .split(/[\n,;]/)
        .map(part => part.trim())
        .filter(Boolean)
        .map(part => {
          const [key, qty] = part.split(/[:x*]/).map(v => v.trim());
          return { key, qty: Number(qty || 1) };
        });

  return raw
    .map(entry => ({
      key: String(entry.key || entry.itemKey || '').trim(),
      qty: Math.max(1, Math.min(999, Math.trunc(Number(entry.qty || entry.quantity || 1)))),
    }))
    .filter(entry => entry.key && (entry.key === 'coins' || entry.key === 'gems' || !!resolveInventoryShopItem(entry.key)))
    .slice(0, 12);
}

function applyShopGrant(playerId, grant, context = {}) {
  const type = String(grant?.type || '');
  if (type === 'item') {
    shopItemQ.addQty.run({ player_id: playerId, item_key: String(grant.key || ''), quantity: Math.max(1, Number(grant.qty || 1)) });
    return;
  }
  if (type === 'coins') {
    pQ.addCoins.run({ delta: Number(grant.amount || 0), id: playerId });
    return;
  }
  if (type === 'elo_reset') {
    pQ.setElo.run({ elo: 1000, id: playerId });
    return;
  }
  if (type === 'vip_days') {
    const now = context.now || Date.now();
    const player = context.player || pQ.getById.get(playerId);
    if (Number(player?.is_vip_plus || 0) === 1) return;
    const baseExpiry = Number(player?.vip_expires_at || 0) > now ? Number(player.vip_expires_at) : now;
    pQ.updateVip.run({ is_vip: 1, id: playerId });
    pQ.updateVipExpiry.run({ vip_expires_at: baseExpiry + Math.max(1, Number(grant.days || 30)) * 24 * 60 * 60 * 1000, id: playerId });
  }
}

function applyLimitedPackEntry(playerId, entry, context = {}) {
  const key = String(entry?.key || '').trim();
  const qty = Math.max(1, Math.min(999, Math.trunc(Number(entry?.qty || 1))));
  if (!key) return;
  if (key === 'coins') {
    pQ.addCoins.run({ delta: qty, id: playerId });
    return;
  }
  if (key === 'gems') {
    const player = pQ.getById.get(playerId);
    pQ.updateGems.run({ gems: Number(player?.gems || 0) + qty, id: playerId });
    return;
  }
  if (key === 'vip_1m') {
    applyShopGrant(playerId, { type: 'vip_days', days: 30 * qty }, context);
    return;
  }
  if (key === 'vip_1y') {
    applyShopGrant(playerId, { type: 'vip_days', days: 365 * qty }, context);
    return;
  }
  if (key === 'vip_plus') {
    pQ.updateVip.run({ is_vip: 1, id: playerId });
    pQ.updateVipPlus.run({ is_vip_plus: 1, id: playerId });
    pQ.updateVipExpiry.run({ vip_expires_at: null, id: playerId });
    return;
  }
  if (key === 'perso') {
    pQ.updatePerso.run({ is_perso: 1, id: playerId });
    return;
  }
  if (key === 'crystal') {
    grantCrystal(playerId, { durationMs: CRYSTAL_MONTH_MS * qty, autoRenew: true });
    return;
  }
  if (key === 'elo_reset') {
    pQ.setElo.run({ elo: 1000, id: playerId });
    return;
  }
  if (resolveInventoryShopItem(key)) {
    shopItemQ.addQty.run({ player_id: playerId, item_key: key, quantity: qty });
  }
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
  const paris = getParisDateParts(new Date());
  const targetDay = new Date(Date.UTC(paris.year, paris.month - 1, paris.day + dayOffset, hour, minute, second));
  const target = {
    year: targetDay.getUTCFullYear(),
    month: targetDay.getUTCMonth() + 1,
    day: targetDay.getUTCDate(),
    hour,
    minute,
    second,
  };
  const desiredAsUTC = Date.UTC(target.year, target.month - 1, target.day, target.hour, target.minute, target.second);
  let guess = desiredAsUTC;

  // Convertit une heure murale Europe/Paris vers UTC sans dependre de la timezone du serveur.
  for (let i = 0; i < 4; i++) {
    const actual = getParisDateParts(new Date(guess));
    const actualAsUTC = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute, actual.second);
    const delta = desiredAsUTC - actualAsUTC;
    if (delta === 0) break;
    guess += delta;
  }
  return guess;
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
  if (!TOURNAMENTS_ENABLED) return null;
  const row = tQ.listAll.all().find(entry => entry.status === 'active' && !entry.password);
  return row ? serializeTournament(row, null) : null;
}

function getPublicPendingTournament() {
  if (!TOURNAMENTS_ENABLED) return null;
  const row = tQ.listAll.all().find(entry => entry.status === 'pending' && !entry.password);
  return row ? serializeTournament(row, null) : null;
}

function clearTournamentQueue(tournamentId) {
  try { tournamentQueues.get(Number(tournamentId))?.reset?.(); } catch (e) {}
}

function ensureAutoTournaments() {
  if (!TOURNAMENTS_ENABLED) return;
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
  if (!TOURNAMENTS_ENABLED) return;
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
  if (!TOURNAMENTS_ENABLED) return;
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
  if (!TOURNAMENTS_ENABLED) return;
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
  if (!botToken) throw new Error('Discord bot token manquant.');
  const dmRes  = await fetch('https://discord.com/api/v10/users/@me/channels', {
    method: 'POST',
    headers: { 'Authorization': 'Bot ' + botToken, 'Content-Type': 'application/json' },
    body: JSON.stringify({ recipient_id: discordId }),
  });
  const dm = await dmRes.json();
  if (!dm.id) throw new Error('Salon DM Discord indisponible.');
  const messageRes = await fetch(`https://discord.com/api/v10/channels/${dm.id}/messages`, {
    method: 'POST',
    headers: { 'Authorization': 'Bot ' + botToken, 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: text }),
  });
  if (!messageRes.ok) throw new Error('Envoi du DM Discord impossible.');
}

// Renommer un membre sur le serveur Discord
async function renameOnServer(discordId, nickname) {
  const { botToken } = discordConfig();
  const did = String(discordId || '').trim();
  const nick = String(nickname || '').trim().slice(0, 32);
  if (!botToken || !did || !nick) return;

  const blockedUntil = Number(discordRenameBlockedUntil.get(did) || 0);
  if (blockedUntil > Date.now()) return;

  const ownerId = await fetchDiscordGuildOwnerIdCached(botToken);
  if (ownerId && String(ownerId) === did) {
    discordRenameBlockedUntil.set(did, Date.now() + 24 * 60 * 60 * 1000);
    return;
  }

  const res = await discordRestFetch(`member-rename:${did}`, `https://discord.com/api/v10/guilds/${DISCORD_GUILD}/members/${did}`, {
    method: 'PATCH',
    headers: { 'Authorization': 'Bot ' + botToken, 'Content-Type': 'application/json' },
    body: JSON.stringify({ nick }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    if (res.status === 403 || res.status === 429) {
      discordRenameBlockedUntil.set(did, Date.now() + (res.status === 403 ? 24 * 60 * 60 * 1000 : 5 * 60 * 1000));
    }
    // 403 = hiAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAArarchie insuffisante (rAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAAle du membre >= bot)
    if (res.status !== 403) {
      console.log(`[RENAME] Echec pour ${did} : ${res.status} ${err.message || 'permission refusee'}`);
    }
    return;
  }
  invalidateDiscordMemberCache(did);
}

// Synchroniser le rAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAAle Discord d'un membre (ajoute/retire les rAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAAles)
async function syncDiscordRole(discordId, role, isVip = false, isVipPlus = false, isPerso = false, currentRoleIds = null) {
  const { botToken } = discordConfig();
  if (!botToken) return;
  const currentRoles = Array.isArray(currentRoleIds) ? new Set(currentRoleIds) : null;
  const STAFF_ROLES = [DISCORD_ROLE_ADM, DISCORD_ROLE_MOD];
  const STAFF_TARGET = role === 'admin' ? DISCORD_ROLE_ADM
                    : role === 'moderator' ? DISCORD_ROLE_MOD
                    : null;
  for (const rid of [...STAFF_ROLES, DISCORD_ROLE_VIP, DISCORD_ROLE_VIP_PLUS, DISCORD_ROLE_CUSTOM].filter(validDiscordRoleId)) {
    const shouldHave = rid === DISCORD_ROLE_VIP
      ? (!!isVip && !isVipPlus)
      : rid === DISCORD_ROLE_VIP_PLUS
        ? !!isVipPlus
      : rid === DISCORD_ROLE_CUSTOM
        ? !!isPerso
        : rid === STAFF_TARGET;
    if (currentRoles && currentRoles.has(rid) === shouldHave) continue;
    const method = shouldHave ? 'PUT' : 'DELETE';
    const res = await discordRestFetch(`member-role:${discordId}`, `https://discord.com/api/v10/guilds/${DISCORD_GUILD}/members/${discordId}/roles/${rid}`, {
      method,
      headers: { 'Authorization': 'Bot ' + botToken },
    });
    if (res.ok) invalidateDiscordMemberCache(discordId);
  }
  await syncDiscordRankRole(discordId, null, botToken, currentRoleIds);
}

async function fetchGuildRankRoleMap(botToken) {
  const names = new Set(getAllRankRoleNames());
  const roles = await fetchDiscordGuildRolesCached(botToken);
  const map = new Map();
  for (const role of Array.isArray(roles) ? roles : []) {
    if (names.has(role.name)) map.set(role.name, role.id);
  }
  return map;
}

async function syncDiscordRankRole(discordId, rank, botToken = null, currentRoleIds = null) {
  const token = botToken || discordConfig().botToken;
  if (!token || !discordId) return;
  const currentRank = rank || getRank(rQ.getByDiscord.get(discordId)?.elo || 1000);
  const targetName = currentRank?.discordRoleName || currentRank?.label || '';
  const rankRoles = await fetchGuildRankRoleMap(token);
  if (!rankRoles.size) return;
  const currentRoles = Array.isArray(currentRoleIds) ? new Set(currentRoleIds) : null;

  for (const [name, roleId] of rankRoles.entries()) {
    const shouldHave = name === targetName;
    if (currentRoles && currentRoles.has(roleId) === shouldHave) continue;
    if (!validDiscordRoleId(roleId)) continue;
    const res = await discordRestFetch(`member-role:${discordId}`, `https://discord.com/api/v10/guilds/${DISCORD_GUILD}/members/${discordId}/roles/${roleId}`, {
      method: shouldHave ? 'PUT' : 'DELETE',
      headers: { 'Authorization': 'Bot ' + token },
    });
    if (res.ok) invalidateDiscordMemberCache(discordId);
  }
}

async function syncPlayerDiscordRankRole(playerOrId, currentRoleIds = null) {
  const player = typeof playerOrId === 'object' && playerOrId
    ? playerOrId
    : pQ.getById.get(Number(playerOrId));
  if (!player?.discord_id) return;
  return syncDiscordRankRole(player.discord_id, getRank(Number(player.elo || 0)), null, currentRoleIds);
}

function getSearchNameplateRemainingMs(player) {
  if (hasStaffRoleBenefits(player)) return 0;
  const lastChanged = Number(player?.search_nameplate_changed_at || 0);
  const remaining = lastChanged + AVATAR_DECORATION_COOLDOWN_MS - Date.now();
  return remaining > 0 ? remaining : 0;
}

function scheduleDiscordPostAuthSync(discordUserId, player, currentRoleIds = []) {
  Promise.allSettled([
    renameOnServer(discordUserId, player?.pseudo),
    syncPlayerDiscordRankRole(player, currentRoleIds),
  ]).then(results => {
    const failed = results.filter(result => result.status === 'rejected');
    if (failed.length) {
      console.warn('[Discord OAuth] Synchronisation différée incomplète', {
        playerId: Number(player?.id || 0),
        failures: failed.map(result => String(result.reason?.message || result.reason)),
      });
    }
  });
}

async function findGuildRoleByName(roleName, botToken = null) {
  const token = botToken || discordConfig().botToken;
  if (!token || !roleName) return null;
  const roles = await fetchDiscordGuildRolesCached(token);
  return (Array.isArray(roles) ? roles : []).find(role => role.name === roleName) || null;
}

async function getDiscordConnectedRoleId(botToken = null) {
  if (DISCORD_CONNECTED_ROLE_ID) return DISCORD_CONNECTED_ROLE_ID;
  const role = await findGuildRoleByName(DISCORD_CONNECTED_ROLE_NAME, botToken);
  return role?.id || null;
}

async function syncPlayerDiscordConnectedRole(playerOrId, connected) {
  const player = typeof playerOrId === 'object' && playerOrId
    ? playerOrId
    : pQ.getById.get(Number(playerOrId));
  if (!player?.discord_id) return;
  const { botToken } = discordConfig();
  const roleId = await getDiscordConnectedRoleId(botToken);
  if (!roleId) return;
  const res = await discordRestFetch(`member-role:${player.discord_id}`, `https://discord.com/api/v10/guilds/${DISCORD_GUILD}/members/${player.discord_id}/roles/${roleId}`, {
    method: connected ? 'PUT' : 'DELETE',
    headers: { 'Authorization': 'Bot ' + botToken },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    console.warn(`[DISCORD CONNECTED ROLE] ${connected ? 'add' : 'remove'} failed for player ${player.id} / ${player.discord_id}: ${res.status} ${body.slice(0, 180)}`);
    return false;
  }
  invalidateDiscordMemberCache(player.discord_id);
  return true;
}

function cancelConnectedRoleRemoval(playerId) {
  const id = Number(playerId || 0);
  const timer = connectedRoleRemoveTimers.get(id);
  if (timer) clearTimeout(timer);
  connectedRoleRemoveTimers.delete(id);
}

function markDiscordConnectedRealtime(player) {
  if (!player?.id || !player.discord_id) return;
  cancelConnectedRoleRemoval(player.id);
  setDiscordConnectedRoleState(player, true);
}

function scheduleDiscordConnectedRemoval(playerId) {
  const id = Number(playerId || 0);
  if (!id) return;
  cancelConnectedRoleRemoval(id);
  connectedRoleRemoveTimers.set(id, setTimeout(() => {
    connectedRoleRemoveTimers.delete(id);
    const sockets = onlineSockets.get(id);
    if (sockets && sockets.size > 0) return;
    setDiscordConnectedRoleState(id, false);
  }, 3500));
}

function setDiscordConnectedRoleState(playerOrId, connected) {
  const playerId = Number(typeof playerOrId === 'object' ? playerOrId?.id : playerOrId);
  if (!playerId) return;
  if (connectedRoleKnownState.get(playerId) === connected) return;
  if (connectedRolePendingState.get(playerId) === connected) return;
  connectedRolePendingState.set(playerId, connected);
  syncPlayerDiscordConnectedRole(playerOrId, connected)
    .then(ok => {
      if (connectedRolePendingState.get(playerId) !== connected) return;
      connectedRolePendingState.delete(playerId);
      if (ok) connectedRoleKnownState.set(playerId, connected);
    })
    .catch(() => {
      if (connectedRolePendingState.get(playerId) === connected) connectedRolePendingState.delete(playerId);
    });
}

function syncOnlineDiscordConnectedRoles() {
  for (const playerId of onlineSockets.keys()) {
    if (isAnonymousPlayerId(playerId)) continue;
    const player = pQ.getById.get(Number(playerId));
    if (player?.discord_id) markDiscordConnectedRealtime(player);
  }
}

function normalizeProductKey(code = '') {
  return String(code || '').trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 40);
}

function productKeyRewardLabel(entry) {
  const key = String(entry?.key || '');
  const qty = Math.max(1, Number(entry?.qty || 1));
  if (key === 'coins') return `${qty} coins`;
  if (key === 'gems') return `${qty} gemmes`;
  return `${resolveInventoryShopItem(key)?.label || SHOP_ITEMS[key]?.label || key} x${qty}`;
}

function reconcileDiscordConnectedRoles() {
  for (const playerId of onlineSockets.keys()) {
    if (isAnonymousPlayerId(playerId)) continue;
    const player = pQ.getById.get(Number(playerId));
    if (player?.discord_id) markDiscordConnectedRealtime(player);
  }

  for (const [playerId, knownConnected] of connectedRoleKnownState.entries()) {
    if (!knownConnected || isAnonymousPlayerId(playerId)) continue;
    const sockets = onlineSockets.get(Number(playerId));
    if (sockets && sockets.size > 0) continue;
    setDiscordConnectedRoleState(Number(playerId), false);
  }
}

async function clearAllDiscordConnectedRoles() {
  const { botToken } = discordConfig();
  if (!botToken) return;
  const roleId = await getDiscordConnectedRoleId(botToken);
  if (!roleId) return;
  const linked = db.prepare(`SELECT discord_id FROM players WHERE discord_id IS NOT NULL AND discord_id != '' AND deleted = 0`).all();
  for (const player of linked) {
    await discordRestFetch(`member-role:${player.discord_id}`, `https://discord.com/api/v10/guilds/${DISCORD_GUILD}/members/${player.discord_id}/roles/${roleId}`, {
      method: 'DELETE',
      headers: { 'Authorization': 'Bot ' + botToken },
    }).catch(() => {});
  }
}

async function getDiscordRole(discordUserId, botToken) {
  try {
    if (!botToken || !discordUserId) return 'user';
    const res = await discordRestFetch(`guild-member:${discordUserId}`, `https://discord.com/api/v10/guilds/${DISCORD_GUILD}/members/${discordUserId}`, {
      headers: { 'Authorization': 'Bot ' + botToken },
    });
    if (!res.ok) return 'user';
    const member = await res.json();
    if (!Array.isArray(member.roles)) return 'user';
    if (member.roles.includes(DISCORD_ROLE_ADM)) return 'admin';
    if (member.roles.includes(DISCORD_ROLE_MOD)) return 'moderator';
    const guildRoles = await fetchDiscordGuildRolesCached(botToken);
    if (hasDeveloperRoleIds(member.roles, guildRoles)) return 'developer';
    return 'user';
  } catch(e) { return 'user'; }
}

async function fetchDiscordMemberSnapshot(discordUserId, botToken, options = {}) {
  try {
    if (!botToken || !discordUserId) return null;
    const cacheKey = String(discordUserId || '');
    const cached = discordMemberSnapshotCache.get(cacheKey);
    if (!options.force && cached && cached.expiresAt > Date.now()) return cached.snapshot;
    const [memberRes, guildRoles] = await Promise.all([
      discordRestFetch(`guild-member:${discordUserId}`, `https://discord.com/api/v10/guilds/${DISCORD_GUILD}/members/${discordUserId}`, {
        headers: { 'Authorization': 'Bot ' + botToken },
      }),
      fetchDiscordGuildRolesCached(botToken),
    ]);
    if (!memberRes.ok) return null;
    const memberInfo = await memberRes.json();
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
    const developer = hasDeveloperRoleIds(memberInfo.roles, guildRoles);
    const newRole = Array.isArray(memberInfo.roles) && memberInfo.roles.includes(DISCORD_ROLE_ADM)
      ? 'admin'
      : Array.isArray(memberInfo.roles) && memberInfo.roles.includes(DISCORD_ROLE_MOD)
        ? 'moderator'
        : developer
          ? 'developer'
          : 'user';
    const snapshot = { memberInfo, server_roles_rich, newRole, developer };
    discordMemberSnapshotCache.set(cacheKey, { snapshot, expiresAt: Date.now() + DISCORD_MEMBER_CACHE_TTL_MS });
    return snapshot;
  } catch(e) {
    return null;
  }
}

// AAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAA Job toutes les minutes AAaAa AaaAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAA sync rAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAAles Discord AAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAA
function applyDiscordSnapshotToPlayer(playerOrId, snapshot) {
  const player = typeof playerOrId === 'object' && playerOrId
    ? playerOrId
    : pQ.getById.get(Number(playerOrId));
  if (!player || !snapshot?.memberInfo) return player || null;

  const roles = Array.isArray(snapshot.memberInfo.roles) ? snapshot.memberInfo.roles : [];
  const newRole = snapshot.newRole || 'user';
  const vipNow = hasVipRoleIds(roles) ? 1 : 0;
  const vipPlusNow = hasVipPlusRoleIds(roles) ? 1 : 0;
  const persoNow = hasPersoRoleIds(roles) ? 1 : 0;
  const developerNow = snapshot.developer ? 1 : 0;

  if (newRole !== player.role) {
    pQ.updateRole.run({ role: newRole, id: player.id });
    revokeAdminSessionsForPlayer(player.id);
  }
  if (vipNow !== Number(player.is_vip || 0)) pQ.updateVip.run({ is_vip: vipNow, id: player.id });
  if (vipPlusNow !== Number(player.is_vip_plus || 0)) pQ.updateVipPlus.run({ is_vip_plus: vipPlusNow, id: player.id });
  if (persoNow !== Number(player.is_perso || 0)) pQ.updatePerso.run({ is_perso: persoNow, id: player.id });
  if (developerNow !== Number(player.is_developer || 0)) {
    pQ.updateDeveloper.run({ is_developer: developerNow, id: player.id });
  }
  if (!vipNow && !vipPlusNow && Number(player.vip_expires_at || 0)) {
    pQ.updateVipExpiry.run({ vip_expires_at: null, id: player.id });
  }

  if (player.discord_id) {
    try {
      const existing = player.discord_info ? JSON.parse(player.discord_info) : {};
      rQ.setDiscord.run(player.discord_id, JSON.stringify({
        ...existing,
        server_roles: snapshot.server_roles_rich || existing.server_roles || [],
        server_nick: snapshot.memberInfo.nick || existing.server_nick || null,
        server_joined: snapshot.memberInfo.joined_at || existing.server_joined || null,
        boosting_since: snapshot.memberInfo.premium_since || null,
      }), player.id);
    } catch(e) {}
  }

  return pQ.getById.get(player.id);
}

let discordRoleSyncOffset = 0;
setInterval(async () => {
  const { botToken } = discordConfig();
  if (!botToken) return;
  const linked = db.prepare(`SELECT id, pseudo, role, is_vip, is_vip_plus, is_perso, is_developer, custom_role_text, custom_role_emoji, discord_id, discord_info FROM players WHERE discord_id IS NOT NULL AND discord_id != '' AND deleted = 0 ORDER BY id ASC`).all();
  if (!linked.length) return;
  const batchSize = Math.min(DISCORD_ROLE_SYNC_BATCH_SIZE, linked.length);
  const batch = [];
  for (let i = 0; i < batchSize; i++) {
    batch.push(linked[(discordRoleSyncOffset + i) % linked.length]);
  }
  discordRoleSyncOffset = (discordRoleSyncOffset + batch.length) % linked.length;
  for (const player of batch) {
    const snapshot = await fetchDiscordMemberSnapshot(player.discord_id, botToken);
    if (!snapshot) continue;
    const { memberInfo, server_roles_rich, newRole, developer } = snapshot;
    const roles = memberInfo.roles || [];
    const vipPlusNow = hasVipPlusRoleIds(roles) ? 1 : 0;
    const vipNow = hasVipRoleIds(roles) ? 1 : 0;
    const persoNow = hasPersoRoleIds(roles) ? 1 : 0;
    const developerNow = developer ? 1 : 0;
    if (newRole !== player.role) {
      pQ.updateRole.run({ role: newRole, id: player.id });
      console.log(`[ROLE SYNC] ${player.pseudo} : ${player.role} -> ${newRole}`);
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
    if (developerNow !== Number(player.is_developer || 0)) {
      pQ.updateDeveloper.run({ is_developer: developerNow, id: player.id });
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
      await syncDiscordRole(player.discord_id, newRole, vipNow === 1, vipPlusNow === 1, persoNow === 1, roles);
    } catch(e) {}
  }
}, DISCORD_ROLE_SYNC_INTERVAL_MS);

setInterval(() => {
  try {
    reconcileDiscordConnectedRoles();
  } catch(e) {
    console.warn('[DISCORD CONNECTED ROLE] reconcile failed:', e.message);
  }
}, DISCORD_CONNECTED_RECONCILE_INTERVAL_MS);

setInterval(() => {
  const now = Date.now();
  processCrystalMemberships(now);
  const expiredVip = db.prepare(`SELECT id, discord_id, role, is_perso FROM players WHERE deleted = 0 AND is_vip = 1 AND is_vip_plus = 0 AND vip_expires_at IS NOT NULL AND vip_expires_at > 0 AND vip_expires_at <= ?`).all(now);
  for (const player of expiredVip) {
    pQ.updateVip.run({ is_vip: 0, id: player.id });
    pQ.updateVipExpiry.run({ vip_expires_at: null, id: player.id });
    if (player.discord_id) {
      syncDiscordRole(player.discord_id, player.role, false, false, Number(player.is_perso || 0) === 1).catch(() => {});
    }
  }
}, 60 * 1000);

function grantCrystal(playerId, options = {}) {
  const player = pQ.getById.get(Number(playerId));
  if (!player || Number(player.deleted || 0) === 1 || Number(player.is_guest || 0) === 1 || Number(player.is_bot || 0) === 1) return null;
  const now = Date.now();
  const durationMs = Math.max(1, Number(options.durationMs || CRYSTAL_MONTH_MS));
  const currentExpiry = Number(player.crystal_expires_at || 0);
  const base = currentExpiry > now ? currentExpiry : now;
  const expiresAt = options.expiresAt ? Number(options.expiresAt) : base + durationMs;
  pQ.updateCrystal.run({
    id: player.id,
    is_crystal: 1,
    crystal_expires_at: expiresAt,
    crystal_auto_renew: options.autoRenew === false ? 0 : 1,
  });
  return pQ.getById.get(player.id);
}

function removeCrystal(playerId) {
  pQ.updateCrystal.run({ id: Number(playerId), is_crystal: 0, crystal_expires_at: null, crystal_auto_renew: 0 });
}

function processCrystalMemberships(now = Date.now()) {
  const due = db.prepare(`
    SELECT id, pseudo, coins, gems, crystal_expires_at, crystal_auto_renew, crystal_weekly_gems_at
    FROM players
    WHERE deleted = 0 AND is_guest = 0 AND is_bot = 0 AND is_crystal = 1
  `).all();
  for (const player of due) {
    const expiresAt = Number(player.crystal_expires_at || 0);
    if (expiresAt && expiresAt <= now) {
      if (Number(player.crystal_auto_renew || 0) === 1 && Number(player.coins || 0) >= CRYSTAL_PRICE_COINS) {
        pQ.updateCoins.run({ id: player.id, coins: Number(player.coins || 0) - CRYSTAL_PRICE_COINS });
        grantCrystal(player.id, { durationMs: CRYSTAL_MONTH_MS, autoRenew: true });
        try { WH.wlogShopPurchase(player.pseudo, player.id, 'Crystal - renouvellement automatique', { currency: 'coins', paid: CRYSTAL_PRICE_COINS, basePrice: CRYSTAL_PRICE_COINS }); } catch(e) {}
      } else {
        removeCrystal(player.id);
        notifyPlayerProfileChanged(player.id, 'Crystal expire : renouvellement impossible.');
      }
      continue;
    }
    const lastGemsAt = Number(player.crystal_weekly_gems_at || 0);
    if (!lastGemsAt || now - lastGemsAt >= CRYSTAL_WEEK_MS) {
      pQ.addGems.run({ id: player.id, delta: 20 });
      pQ.updateCrystalWeeklyGems.run({ id: player.id, crystal_weekly_gems_at: now });
      try { WH.wlogGems(player.pseudo, player.id, 20, 'Bonus hebdomadaire Crystal'); } catch(e) {}
      notifyPlayerProfileChanged(player.id, 'Bonus Crystal : +20 gemmes hebdomadaires.');
    }
  }
}

// Liaison Discord depuis le profil (sans reset)
app.get('/auth/discord/link', (req, res) => {
  const { playerId } = req.query;
  if (!playerId) return res.redirect('/profil?error=invalid');
  const { clientId, redirectUri } = discordConfig();
  const state = encodeDiscordState({ playerId: Number(playerId), mode: 'link', redirectUri });
  const params = new URLSearchParams({
    client_id:     clientId,
    redirect_uri:  redirectUri,
    response_type: 'code',
    scope:         'identify',
    state,
  });
  res.redirect('https://discord.com/oauth2/authorize?' + params);
});

app.get('/auth/discord/signin', (req, res) => {
  const { clientId, redirectUri } = discordConfig();
  const state = encodeDiscordState({
    mode: 'signin',
    referrer: String(req.query.ref || req.query.referrer || '').trim().slice(0, 80),
    redirectUri,
  });
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
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

  const { clientId, redirectUri } = discordConfig();
  const clientIp = getClientIp(req);
  const state = encodeDiscordState({ playerId: player.id, ipHash: hashIp(clientIp), redirectUri });
  const params = new URLSearchParams({
    client_id:     clientId,
    redirect_uri:  redirectUri,
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

    const { clientId, clientSecret, redirectUri: configuredRedirectUri, botToken } = discordConfig();
    const redirectUri = normalizePublicUrl(stateData?.redirectUri) || configuredRedirectUri;
    console.log('[Discord OAuth] Callback reçu', { mode, redirectUri });
    // AAaAa AaaAAaA AAAasAAazAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAchanger le code contre un access_token
    const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      signal: AbortSignal.timeout(DISCORD_REST_TIMEOUT_MS),
      body: new URLSearchParams({
        client_id:     clientId,
        client_secret: clientSecret,
        grant_type:    'authorization_code',
        code,
        redirect_uri:  redirectUri,
      }),
    });
    const tokenData = await tokenRes.json().catch(() => ({}));
    if (!tokenData.access_token) {
      console.error('[Discord OAuth] Échec échange token', {
        status: tokenRes.status,
        error: String(tokenData.error || 'reponse_invalide'),
        description: String(tokenData.error_description || ''),
        redirectUri,
        configuredRedirectUri,
        clientId,
      });
      if (tokenData.error === 'invalid_client') return redirectDiscordError('discord_config');
      if (tokenData.error === 'invalid_grant') return redirectDiscordError('discord_redirect');
      return redirectDiscordError('discord_token');
    }
    console.log('[Discord OAuth] Jeton reçu', { mode });

    // RAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAAcupAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAArer l'identitAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAA Discord
    const userRes = await fetch('https://discord.com/api/users/@me', {
      headers: { Authorization: 'Bearer ' + tokenData.access_token },
      signal: AbortSignal.timeout(DISCORD_REST_TIMEOUT_MS),
    });
    const discordUser = await userRes.json();
    if (!discordUser.id) return redirectDiscordError('discord_id');
    console.log('[Discord OAuth] Identité reçue', { mode, discordUserId: discordUser.id });

    if (mode === 'signin') {
      const memberSnapshot = await fetchDiscordMemberSnapshot(discordUser.id, botToken);
      console.log('[Discord OAuth] Snapshot serveur terminé', { mode, available: Boolean(memberSnapshot) });
      const memberInfo = memberSnapshot?.memberInfo || null;
      const server_roles_rich = memberSnapshot?.server_roles_rich || [];
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

      let createdNewPlayer = false;
      let targetPlayer = findPlayerByDiscordIdentity(discordUser) || findReusableDiscordPseudoPlayer(discordUser);
      if (!targetPlayer) {
        const wantedPseudo = getUniquePseudo(discordUser.global_name || discordUser.username || `Discord${discordUser.id.slice(-4)}`);
        const created = pQ.register.get({
          pseudo: wantedPseudo,
          password: hashPwd(genToken()),
        });
        createdNewPlayer = true;
        targetPlayer = pQ.getById.get(created.id);
        const avatarUrl = discordAvatarUrl(discordUser);
        const bannerUrl = discordBannerUrl(discordUser);
        if (avatarUrl) pQ.updateAvatar.run({ avatar: avatarUrl, id: targetPlayer.id });
        if (bannerUrl) pQ.updateBanner.run({ banner: bannerUrl, id: targetPlayer.id });
        grantWelcomeRewards(targetPlayer.id);
        targetPlayer = pQ.getById.get(targetPlayer.id);
      } else {
        const avatarUrl = discordAvatarUrl(discordUser);
        const bannerUrl = discordBannerUrl(discordUser);
        if (avatarUrl && !targetPlayer.avatar) pQ.updateAvatar.run({ avatar: avatarUrl, id: targetPlayer.id });
        if (bannerUrl && !targetPlayer.banner) pQ.updateBanner.run({ banner: bannerUrl, id: targetPlayer.id });
        targetPlayer = pQ.getById.get(targetPlayer.id);
      }

      if (Number(targetPlayer.is_bot || 0) === 1) {
        return res.redirect('/?error=mode_bot');
      }

      claimDiscordIdentity(discordUser.id, discordInfo, targetPlayer.id);
      assignReferrerIfPossible(targetPlayer.id, stateData?.referrer);
      const linkedPlayer = applyDiscordSnapshotToPlayer(pQ.getById.get(targetPlayer.id), memberSnapshot) || pQ.getById.get(targetPlayer.id);
      const token = createSession(linkedPlayer.id);
      const payload = toBase64Url(JSON.stringify({
        token,
        playerId: linkedPlayer.id,
        created: createdNewPlayer,
      }));
      broadcastPresenceCounts(true);
      scheduleDiscordPostAuthSync(discordUser.id, linkedPlayer, memberInfo?.roles || []);
      console.log('[Discord OAuth] Connexion terminée, redirection envoyée', { playerId: linkedPlayer.id });
      return res.redirect('/#discord-auth=' + payload);
    }

    const freshPlayer = playerId ? pQ.getById.get(playerId) : null;
    if (!freshPlayer) return redirectDiscordError('joueur_introuvable');

    if (mode === 'link') {
      // RAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAAcupAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAArer les infos du membre sur le serveur Discord
      const { botToken: bt, baseUrl: bu } = discordConfig();
      const memberSnapshot = await fetchDiscordMemberSnapshot(discordUser.id, bt);
      const memberInfo = memberSnapshot?.memberInfo || null;
      const server_roles_rich = memberSnapshot?.server_roles_rich || [];

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
      const linkedPlayer = applyDiscordSnapshotToPlayer(pQ.getById.get(playerId), memberSnapshot) || pQ.getById.get(playerId);
      scheduleDiscordPostAuthSync(discordUser.id, linkedPlayer, memberInfo?.roles || []);
      broadcastPresenceCounts(true);
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
      try { await syncPlayerDiscordRankRole(pQ.getById.get(playerId)); } catch(e) {}
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
    console.error('[Discord OAuth] Échec callback', {
      mode,
      name: String(e?.name || 'Error'),
      message: String(e?.message || e),
    });
    return redirectDiscordError('erreur_serveur');
  }
});

// AAaAa AaaAAaA AAAasAAazAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAtape 3 AAaAa AaaAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAA Valider le code et changer le mot de passe
app.post('/api/reset-password', security.routeGuard('reset'), (req, res) => {
  const { playerId, code, newPassword } = req.body;
  if (!playerId || !code || !newPassword) return res.status(400).json({ error: 'Données manquantes.' });
  if (newPassword.length < 6) return res.status(400).json({ error: 'Mot de passe trop court (6 caractères min).' });

  const row = rQ.getValid.get(Number(playerId), String(code), Date.now());
  if (!row) return res.status(400).json({ error: 'Code invalide ou expirée.' });

  // VAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAArifier que c'est la mAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAAme IP qui a demandAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAA le reset
  if (row.ip_hash) {
    const clientIp   = getClientIp(req);
    const clientHash = hashIp(clientIp);
    if (clientHash !== row.ip_hash) {
      console.warn(`[reset-password] IP mismatch demande: ${row.ip_hash.slice(0,8)}AAaAa AaaAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAAAasAA...AAAaAAasAA soumission: ${clientHash.slice(0,8)}AAaAa AaaAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAAAasAA...AAAaAAasAA`);
      return res.status(403).json({ error: 'Réinitialisation refusée : adresse IP différente de celle de la demande. Recommence depuis le début.' });
    }
  }

  const hashed = hashPwd(newPassword);
  pQ.updatePassword.run({ password: hashed, id: Number(playerId) });
  rQ.markUsed.run(row.id);

  res.json({ ok: true });
});

app.get('/profil',     renderProfilePage);
app.get('/profil/:ref', renderProfilePage);
app.get('/replay/:id',     renderStaticPage('replay.html', { title: 'Replay - Puissance 4', description: 'Revois une partie Puissance 4 coup par coup.' }));
app.get('/replay-bot/:id', renderStaticPage('replay.html', { title: 'Replay bot - Puissance 4', description: 'Analyse une partie jouee contre un bot Puissance 4.' }));
app.get('/regles',     renderStaticPage('regles.html', { title: 'Regles - Puissance 4', description: 'Apprends les regles du Puissance 4 et les bases pour gagner.' }));
app.get('/live',       renderStaticPage('live.html', { title: 'Live - Puissance 4', description: 'Regarde les parties Puissance 4 en direct.' }));
app.get('/local',      renderStaticPage('local.html', { title: 'Mode local - Puissance 4', description: 'Joue au Puissance 4 sur le meme appareil.' }));
app.get('/leaderboard', renderStaticPage('leaderboard.html', { title: 'Classement - Puissance 4', description: 'Consulte le classement des meilleurs joueurs Puissance 4.' }));
app.get('/classement',  renderStaticPage('leaderboard.html', { title: 'Classement - Puissance 4', description: 'Consulte le classement des meilleurs joueurs Puissance 4.' }));
app.get('/clan',       renderStaticPage('clan.html', { title: 'Clans - Puissance 4', description: 'Cree ou rejoins un clan et progresse avec ton equipe.' }));
app.get('/clan/:id',   renderStaticPage('clan.html', { title: 'Clan - Puissance 4', description: 'Decouvre ce clan Puissance 4 et ses membres.' }));
app.get('/groups',     renderStaticPage('groups.html', { title: 'Groupes - Puissance 4', description: 'Retrouve tes amis, discute et organise des parties privees.' }));
app.get('/groups.html', renderStaticPage('groups.html', { title: 'Groupes - Puissance 4', description: 'Retrouve tes amis, discute et organise des parties privees.' }));
app.get('/players',    renderStaticPage('players.html', { title: 'Joueurs - Puissance 4', description: 'Trouve les joueurs Puissance 4, leurs profils et leurs statistiques.' }));
app.get('/bots',       renderStaticPage('players.html', { title: 'Bots - Puissance 4', description: 'Defie les bots Puissance 4 et compare leurs niveaux.' }));
app.get('/boutique',   renderStaticPage('boutique.html', { title: 'Boutique - Puissance 4', description: 'Personnalise ton profil Puissance 4 avec des cosmetiques.' }));
app.get('/analyse',    renderStaticPage('analyse.html', { title: 'Analyse - Puissance 4', description: 'Analyse tes parties de Puissance 4 et ameliore tes coups.' }));
app.get('/analyse.html', renderStaticPage('analyse.html', { title: 'Analyse - Puissance 4', description: 'Analyse tes parties de Puissance 4 et ameliore tes coups.' }));
app.get('/progression', renderStaticPage('progression.html', { title: 'Progression - Puissance 4', description: 'Suis tes objectifs, recompenses et progres sur Puissance 4.' }));
app.get('/progression.html', renderStaticPage('progression.html', { title: 'Progression - Puissance 4', description: 'Suis tes objectifs, recompenses et progres sur Puissance 4.' }));
app.get('/tournoi',     (_, res) => res.redirect('/'));
app.get('/tournoi/:id', (_, res) => res.redirect('/'));
app.get('/duel/:id',    renderStaticPage('duel.html', { title: 'Duel - Puissance 4', description: 'Rejoins une invitation de duel Puissance 4.' }));
app.get('/duel-auth/:id', renderStaticPage('duel-auth.html', { title: 'Duel prive - Puissance 4', description: 'Connecte-toi pour rejoindre ce duel Puissance 4.' }));
app.get('/cgu',         renderStaticPage('cgu.html', { title: 'CGU - Puissance 4', description: 'Consulte les conditions generales d utilisation de Puissance 4.' }));
app.get('/api-doc',     renderStaticPage('api-doc.html', { title: 'API - Puissance 4', description: 'Documentation de l API publique Puissance 4.' }));
app.get('/stats',       renderStaticPage('stats.html', { title: 'Statistiques - Puissance 4', description: 'Explore les statistiques globales de Puissance 4.' }));
app.get('/news',        renderStaticPage('news.html', { title: 'Nouveautes - Puissance 4', description: 'Decouvre les dernieres nouveautes de Puissance 4.' }));
app.get('/news.html',   renderStaticPage('news.html', { title: 'Nouveautes - Puissance 4', description: 'Decouvre les dernieres nouveautes de Puissance 4.' }));
app.get('/nouveautes',  renderStaticPage('news.html', { title: 'Nouveautes - Puissance 4', description: 'Decouvre les dernieres nouveautes de Puissance 4.' }));

db.exec(`
  CREATE TABLE IF NOT EXISTS easter_egg_claims (
    player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    egg_key TEXT NOT NULL,
    reward INTEGER NOT NULL DEFAULT 0,
    claimed_at INTEGER NOT NULL,
    PRIMARY KEY (player_id, egg_key)
  )
`);

const EASTER_EGG_REWARD_PATHS = new Set([
  '/profil', '/boutique', '/progression', '/leaderboard', '/players',
  '/analyse', '/stats', '/news', '/regles', '/api-doc',
  '/local', '/replay', '/cgu', '/duel', '/forgot-password',
  '/reset-password', '/404',
]);
const insertEasterEggClaim = db.prepare(`
  INSERT OR IGNORE INTO easter_egg_claims (player_id, egg_key, reward, claimed_at)
  VALUES (?, ?, ?, ?)
`);
const getEasterEggClaim = db.prepare(`
  SELECT reward, claimed_at FROM easter_egg_claims
  WHERE player_id = ? AND egg_key = ?
`);
const renewEasterEggClaim = db.prepare(`
  UPDATE easter_egg_claims
  SET reward = ?, claimed_at = ?
  WHERE player_id = ? AND egg_key = ? AND claimed_at <= ?
`);
const EASTER_EGG_RESPAWN_MS = 60 * 60 * 1000;

function getEasterEggRespawnMs(player) {
  if (isPersoPlayer(player)) return 10 * 60 * 1000;
  if (isVipPlusPlayer(player)) return 15 * 60 * 1000;
  if (isVipPlayer(player)) return 30 * 60 * 1000;
  return EASTER_EGG_RESPAWN_MS;
}

app.post('/api/easter-eggs/claim', (req, res) => {
  const token = String(req.headers['x-session-token'] || req.body?.token || '');
  const playerId = validateSession(token);
  if (!playerId) return res.status(401).json({ error: 'Connecte-toi pour ajouter ce pion a ta collection.' });
  const player = pQ.getById.get(playerId);
  const respawnMs = getEasterEggRespawnMs(player);

  const pathKey = String(req.body?.path || '').trim().toLowerCase();
  const eggId = String(req.body?.eggId || '').trim().toLowerCase();
  if (!EASTER_EGG_REWARD_PATHS.has(pathKey) || !['coin-v1', 'traveler-v1'].includes(eggId)) {
    return res.status(400).json({ error: 'Easter egg invalide.' });
  }

  const eggKey = `${pathKey}:${eggId}`;
  const isCoinEgg = eggId === 'coin-v1';
  const reward = isCoinEgg ? 10 + Math.floor(Math.random() * 41) : 0;
  const coinEggGems = isCoinEgg && Math.random() < 0.01 ? 5 + Math.floor(Math.random() * 6) : 0;
  const raritySeed = `${pathKey}:traveler`;
  const hour = Math.floor(Date.now() / respawnMs);
  const rarityRoll = ([...`${raritySeed}:${hour}`].reduce((total, char) => ((total * 31) + char.charCodeAt(0)) >>> 0, 2166136261) % 10000) / 10000;
  const rarity = drawTokenRarity(() => rarityRoll);
  const collectible = isCoinEgg ? null : drawTokenColorForRarity(rarity.key);
  const gems = isCoinEgg ? coinEggGems : drawTokenGemReward(collectible);
  const claim = db.transaction(() => {
    const now = Date.now();
    const existing = getEasterEggClaim.get(playerId, eggKey);
    if (existing) {
      const retryAfterMs = Math.max(0, Number(existing.claimed_at || 0) + respawnMs - now);
      if (retryAfterMs > 0) return { reward: 0, alreadyClaimed: true, retryAfterMs, respawnMs };
      const renewed = renewEasterEggClaim.run(reward, now, playerId, eggKey, now - respawnMs);
      if (!renewed.changes) return { reward: 0, alreadyClaimed: true, retryAfterMs: respawnMs, respawnMs };
    } else {
      const inserted = insertEasterEggClaim.run(playerId, eggKey, reward, now);
      if (!inserted.changes) return { reward: 0, alreadyClaimed: true, retryAfterMs: respawnMs, respawnMs };
    }
    if (reward > 0) pQ.addCoins.run({ delta: reward, id: playerId });
    if (gems > 0) pQ.addGems.run({ delta: gems, id: playerId });
    if (collectible) tokenCollectionQ.add.run({ player_id: playerId, color_key: collectible.key, now });
    return {
      reward,
      gems,
      collectible: collectible ? {
        key: collectible.key,
        label: collectible.label,
        hex: collectible.hex,
        hexSecondary: collectible.hexSecondary || '',
        rarity: collectible.rarity,
        design: collectible.design || 'classic',
      } : null,
      alreadyClaimed: false,
      respawnMs,
    };
  })();
  const freshPlayer = pQ.getById.get(playerId);
  res.json({
    ok: true,
    ...claim,
    coins: Number(freshPlayer?.coins || 0),
    gemsNow: Number(freshPlayer?.gems || 0),
  });
});

app.get('/api/decorations', (_, res) => {
  res.set('Cache-Control', 'public, max-age=300');
  res.json({ decorations: getAvatarDecorationPaths() });
});

app.get('/api/nameplates', (_, res) => {
  res.set('Cache-Control', 'public, max-age=300');
  res.json({ nameplates: getSearchNameplatePaths() });
});

function getTokenCollectionPayload(playerId) {
  const rows = tokenCollectionQ.getAllForPlayer.all(Number(playerId || 0));
  const quantities = new Map(rows.map(row => [String(row.color_key), Number(row.quantity || 0)]));
  const rarityCounts = new Map(TOKEN_RARITIES.map(rarity => [rarity.key, { key: rarity.key, label: rarity.label, total: 0, collected: 0, copies: 0 }]));
  const themeCounts = new Map();
  const items = TOKEN_COLOR_CATALOG.map(color => {
    const rarity = TOKEN_RARITIES.find(entry => entry.key === color.rarity);
    const quantity = quantities.get(color.key) || 0;
    const rarityInfo = rarityCounts.get(color.rarity) || { key: color.rarity, label: color.rarity, total: 0, collected: 0, copies: 0 };
    rarityInfo.total += 1;
    rarityInfo.collected += quantity > 0 ? 1 : 0;
    rarityInfo.copies += quantity;
    rarityCounts.set(color.rarity, rarityInfo);
    const themeInfo = themeCounts.get(color.theme) || { key: color.theme, label: color.theme, total: 0, collected: 0, copies: 0 };
    themeInfo.total += 1;
    themeInfo.collected += quantity > 0 ? 1 : 0;
    themeInfo.copies += quantity;
    themeCounts.set(color.theme, themeInfo);
    return {
      key: color.key,
      label: color.label,
      hex: color.hex,
      hexSecondary: color.hexSecondary || '',
      theme: color.theme,
      rarity: color.rarity,
      rarityLabel: rarity?.label || color.rarity,
      spawnRate: Number(rarity?.spawnRate || 0),
      design: color.design || 'classic',
      image: color.image || '',
      quantity,
    };
  });
  const collected = items.filter(item => item.quantity > 0).length;
  const totalCopies = items.reduce((sum, item) => sum + item.quantity, 0);
  const collectedItems = items.filter(item => item.quantity > 0);
  return {
    items,
    collectedItems,
    rarities: Array.from(rarityCounts.values()).filter(entry => entry.total > 0),
    themes: Array.from(themeCounts.values()).filter(entry => entry.total > 0),
    stats: {
      collected,
      total: items.length,
      totalCopies,
      duplicates: Math.max(0, totalCopies - collected),
      completionPercent: items.length ? Math.round((collected / items.length) * 100) : 0,
    },
  };
}

app.get('/api/token-collection/catalog', (_, res) => {
  res.set('Cache-Control', 'public, max-age=300');
  res.json({
    items: TOKEN_COLOR_CATALOG.map(({ weight, ...color }) => color),
    rarities: TOKEN_RARITIES,
    themes: Array.from(new Set(TOKEN_COLOR_CATALOG.map(color => color.theme).filter(Boolean))).map(theme => ({
      label: theme,
      total: TOKEN_COLOR_CATALOG.filter(color => color.theme === theme).length,
    })),
    total: TOKEN_COLOR_CATALOG.length,
  });
});

app.get('/api/players/:id/token-collection', (req, res) => {
  const player = pQ.getById.get(Number(req.params.id));
  if (!player || Number(player.deleted || 0) === 1) {
    return res.status(404).json({ error: 'Joueur introuvable.' });
  }
  res.json({
    player: { id: player.id, pseudo: player.pseudo },
    collection: getTokenCollectionPayload(player.id),
  });
});

app.get('/api/profile-banners', (_, res) => {
  res.set('Cache-Control', 'public, max-age=300');
  res.json({ banners: getProfileBannerPaths() });
});

app.get('/api/musics', (_, res) => {
  res.set('Cache-Control', 'public, max-age=300');
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

function tournamentRemoved(req, res) {
  return res.status(410).json({ error: 'Les tournois ont ete retires du site.' });
}

app.use('/api/tournaments', tournamentRemoved);
app.use('/api/admin/tournaments', tournamentRemoved);

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
  if (!isPersoPlayer(player) && !hasStaffRoleBenefits(player)) {
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

app.get('/api/shop/catalog', (_, res) => {
  res.set('Cache-Control', 'public, max-age=300');
  res.json({
    items: SHOP_ITEMS,
    prices: SHOP_PRICES,
    gemPrices: SHOP_GEM_PRICES,
  });
});

app.get('/api/shop/me', (req, res) => {
  const token = String(req.headers['x-session-token'] || req.query.token || '');
  const playerId = validateSession(token);
  if (!playerId) return res.status(401).json({ error: 'Session invalide.' });
  const player = pQ.getById.get(playerId);
  if (!player) return res.status(404).json({ error: 'Joueur introuvable.' });
  const inventoryRows = shopItemQ.getAllForPlayer.all(playerId);
  const inventory = Object.fromEntries(inventoryRows.map(r => [r.item_key, Number(r.quantity || 0)]));
  const activeBoosters = Object.fromEntries(db.prepare(`
    SELECT boost_type, item_key, label, multiplier, activated_at, expires_at
    FROM player_active_boosters
    WHERE player_id = ? AND expires_at > ?
  `).all(playerId, Date.now()).map(row => [row.boost_type, {
    itemKey: row.item_key,
    label: row.label,
    multiplier: Number(row.multiplier || 1),
    activatedAt: Number(row.activated_at || 0),
    expiresAt: Number(row.expires_at || 0),
  }]));
  const stock = Object.fromEntries(
    Object.keys(SHOP_STOCK_KEYS).map(key => [key, getShopStock(key)])
  );
  const limitedOfferCode = normalizeCouponCode(getConfigValue('shop_limited_offer_code', ''));
  const limitedOfferEndsAt = Number(getConfigValue('shop_limited_offer_ends_at', '0') || 0);
  const limitedCoupon = limitedOfferCode && limitedOfferEndsAt > Date.now() ? getUsableCoupon(limitedOfferCode, playerId) : null;
  const limitedStock = Number(getConfigValue('shop_limited_offer_stock', '0') || 0);
  const gemsUnlocked = !!String(player.discord_id || '').trim();
  const ownedBots = getOwnedBots(playerId);
  res.json({
    player: sanitize(player),
    gemsUnlocked,
    botHostEligible: ownedBots.length > 0,
    botCrystals: Number(player.bot_crystals || 0),
    botHosts: ownedBots,
    referral: getReferralInfo(player),
    items: SHOP_ITEMS,
    prices: SHOP_PRICES,
    gemPrices: SHOP_GEM_PRICES,
    botCrystalPrices: { bot_host_1m: BOT_HOST_PRICE_CRYSTALS },
    stock,
    inventory,
    activeBoosters,
    limitedOffer: limitedOfferEndsAt > Date.now() ? {
      code: limitedOfferCode,
      label: getConfigValue('shop_limited_offer_label', 'Offre limitee'),
      expiresAt: limitedOfferEndsAt,
      priceCoins: Number(getConfigValue('shop_limited_offer_price', '1000') || 1000),
      priceGems: Number(getConfigValue('shop_limited_offer_gem_price', '450') || 450),
      stock: Math.max(0, limitedStock),
      items: parseLimitedPackItems(getConfigValue('shop_limited_offer_items', '')),
      coupon: limitedCoupon ? {
        code: limitedCoupon.code,
        type: limitedCoupon.type,
        value: Number(limitedCoupon.value || 0),
        expiresAt: Number(limitedCoupon.expires_at || 0) || null,
        remainingUses: Math.max(0, Number(limitedCoupon.max_uses || 0) - Number(limitedCoupon.uses || 0)),
      } : null,
    } : null,
  });
});

app.post('/api/shop/boosters/activate', (req, res) => {
  const token = String(req.body?.token || req.headers['x-session-token'] || '');
  const playerId = validateSession(token);
  if (!playerId) return res.status(401).json({ error: 'Session invalide.' });
  const itemKey = String(req.body?.itemKey || '').trim();
  const item = resolveInventoryShopItem(itemKey);
  if (!item || !item.boostType) return res.status(400).json({ error: 'Booster invalide.' });
  const owned = Number(shopItemQ.getOne.get(playerId, itemKey)?.quantity || 0);
  if (owned <= 0) return res.status(400).json({ error: 'Tu ne possedes pas ce booster.' });

  const now = Date.now();
  const durationMs = 2 * 60 * 60 * 1000;
  const tx = db.transaction(() => {
    const result = shopItemQ.consumeOne.run(playerId, itemKey);
    if (!result.changes) throw new Error('Booster deja utilise.');
    if (item.boostType === 'global_elo') {
      bQ.deactivateAll.run();
      bQ.create.run({ multiplier: Number(item.multiplier || 1), applied_by: playerId, expires_at: now + durationMs });
      return;
    }
    if (item.boostType === 'global_coins') {
      setConfigValue('coin_boost_multiplier', String(Number(item.multiplier || 1)));
      setConfigValue('coin_boost_expires_at', String(now + durationMs));
      return;
    }
    db.prepare(`
      INSERT INTO player_active_boosters (player_id, boost_type, item_key, label, multiplier, activated_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(player_id, boost_type) DO UPDATE SET
        item_key=excluded.item_key,
        label=excluded.label,
        multiplier=excluded.multiplier,
        activated_at=excluded.activated_at,
        expires_at=excluded.expires_at
    `).run(playerId, item.boostType, item.key, item.label || item.key, Number(item.multiplier || 1), now, now + durationMs);
  });

  try {
    tx();
  } catch (error) {
    return res.status(400).json({ error: error.message || 'Activation impossible.' });
  }

  const inventoryRows = shopItemQ.getAllForPlayer.all(playerId);
  const inventory = Object.fromEntries(inventoryRows.map(r => [r.item_key, Number(r.quantity || 0)]));
  const activeBoosters = Object.fromEntries(db.prepare(`
    SELECT boost_type, item_key, label, multiplier, activated_at, expires_at
    FROM player_active_boosters
    WHERE player_id = ? AND expires_at > ?
  `).all(playerId, Date.now()).map(row => [row.boost_type, {
    itemKey: row.item_key,
    label: row.label,
    multiplier: Number(row.multiplier || 1),
    activatedAt: Number(row.activated_at || 0),
    expiresAt: Number(row.expires_at || 0),
  }]));

  try {
    const player = pQ.getById.get(playerId);
    WH.wlogBoost(item.boostType, Number(item.multiplier || 1), player?.pseudo || `ID ${playerId}`, '2h');
  } catch(e) {}

  res.json({
    ok: true,
    itemKey,
    active: activeBoosters[item.boostType] || (String(item.boostType).startsWith('global_') ? {
      itemKey: item.key,
      label: item.label,
      multiplier: Number(item.multiplier || 1),
      activatedAt: now,
      expiresAt: now + durationMs,
      global: true,
    } : null),
    inventory,
    activeBoosters,
  });
});

function normalizeCrystalAlertPayload(body = {}) {
  const message = String(body.message || '').trim().replace(/\s+/g, ' ').slice(0, 90);
  const color = /^#[0-9a-fA-F]{6}$/.test(String(body.color || '')) ? String(body.color).toUpperCase() : '#85EBFF';
  const emoji = String(body.emoji || '💠').trim().slice(0, 4) || '💠';
  const animation = ['pulse', 'glow', 'shake', 'slide', 'none'].includes(String(body.animation || '').toLowerCase())
    ? String(body.animation || '').toLowerCase()
    : 'glow';
  return { message, color, emoji, animation };
}

app.get('/api/crystal/alert', (req, res) => {
  const token = String(req.headers['x-session-token'] || req.query.token || '');
  const playerId = validateSession(token);
  if (!playerId) return res.status(401).json({ error: 'Session invalide.' });
  const player = pQ.getById.get(playerId);
  if (!isCrystalPlayer(player)) return res.status(403).json({ error: 'Reserve au rang Crystal.' });
  res.json({
    ok: true,
    alert: {
      message: player.crystal_alert_message || '',
      color: player.crystal_alert_color || '#85EBFF',
      emoji: player.crystal_alert_emoji || '💠',
      animation: player.crystal_alert_animation || 'glow',
    },
  });
});

app.post('/api/crystal/alert', (req, res) => {
  const token = String(req.body?.token || req.headers['x-session-token'] || '');
  const playerId = validateSession(token);
  if (!playerId) return res.status(401).json({ error: 'Session invalide.' });
  const player = pQ.getById.get(playerId);
  if (!isCrystalPlayer(player)) return res.status(403).json({ error: 'Reserve au rang Crystal.' });
  const alert = normalizeCrystalAlertPayload(req.body || {});
  pQ.updateCrystalAlert.run({ id: playerId, ...alert });
  res.json({ ok: true, alert });
});

app.get('/api/referral/me', (req, res) => {
  const token = String(req.headers['x-session-token'] || req.query.token || '');
  const playerId = validateSession(token);
  if (!playerId) return res.status(401).json({ error: 'Session invalide.' });
  const player = pQ.getById.get(playerId);
  if (!player || Number(player.deleted || 0) === 1 || Number(player.is_guest || 0) === 1 || Number(player.is_bot || 0) === 1) {
    return res.status(404).json({ error: 'Compte non eligible.' });
  }
  const baseUrl = String(discordConfig().baseUrl || '').replace(/\/+$/, '');
  const referredCount = Number(db.prepare(`
    SELECT COUNT(*) AS c
    FROM players
    WHERE referred_by = ? AND deleted = 0 AND is_guest = 0 AND is_bot = 0
  `).get(playerId)?.c || 0);
  const info = getReferralInfo(player);
  res.json({
    ok: true,
    referral: {
      ...info,
      url: `${baseUrl}/?ref=${encodeURIComponent(info.code || `P4-${player.id}`)}`,
      referredCount,
    },
  });
});

app.patch('/api/referral/me', (req, res) => {
  const token = String(req.body?.token || req.headers['x-session-token'] || '');
  const playerId = validateSession(token);
  if (!playerId) return res.status(401).json({ error: 'Session invalide.' });
  const player = pQ.getById.get(playerId);
  if (!player || Number(player.deleted || 0) === 1 || Number(player.is_guest || 0) === 1 || Number(player.is_bot || 0) === 1) {
    return res.status(404).json({ error: 'Compte non eligible.' });
  }
  const rawSlug = String(req.body?.slug || '').trim();
  const slug = normalizeReferralSlug(rawSlug);
  if (rawSlug && (slug.length < 3 || slug.length > 32)) {
    return res.status(400).json({ error: 'Lien perso invalide : 3 a 32 caracteres.' });
  }
  if (/^p4-\d+$/i.test(slug) || /^\d+$/.test(slug)) {
    const id = normalizeReferralId(slug);
    if (id !== Number(playerId)) return res.status(409).json({ error: 'Ce lien pointe deja vers un autre profil.' });
    pQ.updateReferralSlug.run({ id: playerId, slug: '' });
  } else if (slug) {
    const existingSlug = db.prepare(`
      SELECT id FROM players
      WHERE deleted = 0 AND is_guest = 0 AND is_bot = 0
        AND LOWER(referral_slug) = LOWER(?) AND id != ?
      LIMIT 1
    `).get(slug, playerId);
    if (existingSlug) return res.status(409).json({ error: 'Ce lien de parrain est deja pris.' });
    const existingPseudo = pQ.getByPseudo.get(slug);
    if (existingPseudo && Number(existingPseudo.id) !== Number(playerId)) {
      return res.status(409).json({ error: 'Ce lien correspond au pseudo d un autre joueur.' });
    }
    pQ.updateReferralSlug.run({ id: playerId, slug });
  } else {
    pQ.updateReferralSlug.run({ id: playerId, slug: '' });
  }
  const fresh = pQ.getById.get(playerId);
  const info = getReferralInfo(fresh);
  const baseUrl = String(discordConfig().baseUrl || '').replace(/\/+$/, '');
  res.json({
    ok: true,
    referral: {
      ...info,
      url: `${baseUrl}/?ref=${encodeURIComponent(info.code || `P4-${playerId}`)}`,
    },
  });
});

app.post('/api/shop/buy', async (req, res) => {
  const token = String(req.body?.token || '');
  const playerId = validateSession(token);
  if (!playerId) return res.status(401).json({ error: 'Session invalide.' });

  const pack = String(req.body?.pack || '').trim();
  let item = SHOP_ITEMS[pack] || buildCustomShopItem(pack, req.body || {});
  if (pack === 'limited_offer') {
    const endsAt = Number(getConfigValue('shop_limited_offer_ends_at', '0') || 0);
    const limitedItems = parseLimitedPackItems(getConfigValue('shop_limited_offer_items', ''));
    if (endsAt <= Date.now() || !limitedItems.length) return res.status(400).json({ error: 'Offre limitee indisponible.' });
    item = {
      key: 'limited_offer',
      label: getConfigValue('shop_limited_offer_label', 'Pack limite'),
      price: Number(getConfigValue('shop_limited_offer_price', '1000') || 1000),
      gemPrice: Number(getConfigValue('shop_limited_offer_gem_price', '450') || 450),
      grants: limitedItems,
      defaultStock: Number(getConfigValue('shop_limited_offer_stock', '0') || 0),
    };
  }
  if (!item) return res.status(400).json({ error: 'Pack invalide.' });

  const player = pQ.getById.get(playerId);
  if (!player) return res.status(404).json({ error: 'Joueur introuvable.' });
  const giftTo = String(req.body?.giftTo || '').trim().slice(0, 32);
  const legacyGiftId = /^\d+$/.test(giftTo) ? Number(giftTo) : 0;
  const requestedGiftId = Number(req.body?.giftToId || legacyGiftId || 0);
  const giftToId = Number.isSafeInteger(requestedGiftId) && requestedGiftId > 0 ? requestedGiftId : 0;
  const hasGiftTarget = giftToId > 0 || !!giftTo;
  const recipient = giftToId ? pQ.getById.get(giftToId) : giftTo ? pQ.getByPseudo.get(giftTo) : player;
  if (hasGiftTarget && (!recipient || Number(recipient.deleted || 0) === 1 || Number(recipient.is_guest || 0) === 1 || Number(recipient.is_bot || 0) === 1)) {
    return res.status(404).json({ error: 'Joueur destinataire introuvable.' });
  }
  const recipientId = Number(recipient.id || playerId);
  if (hasGiftTarget && recipientId === Number(playerId)) {
    return res.status(400).json({ error: 'Tu ne peux pas t offrir un cadeau a toi-meme.' });
  }
  const isGift = recipientId !== Number(playerId);
  const requestedCurrency = String(req.body?.currency || 'coins').toLowerCase();
  const currency = requestedCurrency === 'gems' ? 'gems' : requestedCurrency === 'crystals' ? 'crystals' : 'coins';
  if (currency === 'gems' && !String(player.discord_id || '').trim()) {
    return res.status(403).json({ error: 'Lie ton compte Discord pour utiliser les gemmes.' });
  }
  if (currency === 'crystals' && pack !== 'bot_host_1m') {
    return res.status(400).json({ error: 'Les Cristaux servent uniquement a l hebergement de bot.' });
  }
  if (pack === 'bot_host_1m' && currency !== 'crystals' && !hasStaffRoleBenefits(player)) {
    return res.status(400).json({ error: 'Host 1 mois s achete uniquement avec des Cristaux.' });
  }
  const ownedBots = getOwnedBots(playerId);
  if (pack === 'bot_host_1m' && !ownedBots.length) {
    return res.status(403).json({ error: 'Associe d abord un bot a ton compte pour acheter un host.' });
  }
  const requestedCoupon = normalizeCouponCode(req.body?.coupon);
  const coupon = getUsableCoupon(requestedCoupon, playerId);
  if (requestedCoupon && !coupon) {
    return res.status(400).json({ error: 'Coupon invalide, expire, deja utilise ou limite atteinte.' });
  }
  const adminFreeBotHost = pack === 'bot_host_1m' && hasStaffRoleBenefits(player);
  const basePrice = currency === 'crystals'
    ? Number(item.crystalPrice || BOT_HOST_PRICE_CRYSTALS)
    : pack === 'limited_offer' && currency === 'gems'
    ? Number(item.gemPrice || Math.max(1, Math.ceil(Number(item.price || 0) * 0.45)))
    : currency === 'gems'
      ? Number(item.gemPrice || SHOP_GEM_PRICES[item.key || pack] || Math.max(1, Math.ceil(Number(item.price || 0) * 0.45)))
      : Number(item.price || 0);
  const price = adminFreeBotHost ? 0 : currency === 'crystals' ? basePrice : applyReferralDiscountPrice(basePrice, player, coupon);
  const balance = currency === 'gems'
    ? Number(player.gems || 0)
    : currency === 'crystals'
      ? Number(player.bot_crystals || 0)
      : Number(player.coins || 0);

  if (balance < price) {
    return res.status(400).json({ error: currency === 'gems' ? 'Pas assez de gemmes.' : currency === 'crystals' ? 'Pas assez de Cristaux.' : 'Pas assez de coins.' });
  }
  if (pack === 'vip_plus' && Number(recipient.is_vip_plus || 0) === 1) {
    return res.status(400).json({ error: isGift ? 'Ce joueur a deja VIP+.' : 'VIP+ deja actif.' });
  }
  if (pack === 'crystal' && isCrystalPlayer(recipient)) {
    return res.status(400).json({ error: isGift ? 'Ce joueur a deja Crystal actif.' : 'Crystal deja actif.' });
  }
  if (pack === 'perso' && Number(recipient.is_perso || 0) === 1) {
    return res.status(400).json({ error: isGift ? 'Ce joueur a deja le pack Perso.' : 'Pack Perso deja actif.' });
  }
  if (item.category === 'cosmetics' && Number(shopItemQ.getOne.get(recipientId, item.key)?.quantity || 0) > 0) {
    return res.status(400).json({ error: isGift ? 'Ce joueur possede deja ce pack.' : 'Pack deja possede.' });
  }
  if ((pack === 'vip_1m' || pack === 'vip_1y') && Number(recipient.is_vip_plus || 0) === 1) {
    return res.status(400).json({ error: isGift ? 'Ce joueur a deja VIP+ a vie.' : 'VIP+ est deja actif a vie.' });
  }
  if (pack === 'limited_offer' && Number(item.defaultStock || 0) <= 0) {
    return res.status(400).json({ error: 'Rupture de stock.' });
  }
  if (pack !== 'limited_offer' && Number.isFinite(item.defaultStock) && getShopStock(pack) <= 0) {
    return res.status(400).json({ error: 'Rupture de stock.' });
  }

  const now = Date.now();
  const currentVipExpiry = Number(recipient.vip_expires_at || 0);
  const baseExpiry = currentVipExpiry > now ? currentVipExpiry : now;

  if (currency === 'gems') pQ.updateGems.run({ gems: balance - price, id: playerId });
  else if (currency === 'crystals') pQ.updateBotCrystals.run({ bot_crystals: balance - price, id: playerId });
  else pQ.updateCoins.run({ coins: balance - price, id: playerId });
  if (coupon) {
    db.prepare(`UPDATE coupons SET uses = uses + 1 WHERE code = ?`).run(coupon.code);
    db.prepare(`INSERT OR IGNORE INTO coupon_uses (code, player_id, used_at) VALUES (?, ?, ?)`).run(coupon.code, playerId, Date.now());
  }

  if (pack === 'crystal') {
    grantCrystal(recipientId, { durationMs: CRYSTAL_MONTH_MS, autoRenew: true });
  } else if (pack === 'bot_host_1m') {
    const requestedBotId = Number(req.body?.botId || 0);
    const targetBot = ownedBots.find(bot => Number(bot.id) === requestedBotId) || ownedBots[0];
    const existing = db.prepare(`SELECT expires_at FROM bot_hosts WHERE bot_id = ?`).get(targetBot.id);
    const hostBase = Number(existing?.expires_at || 0) > now ? Number(existing.expires_at) : now;
    db.prepare(`
      INSERT INTO bot_hosts (bot_id, owner_id, status, code, logs, created_at, updated_at, expires_at, last_action)
      VALUES (?, ?, 'stopped', '', '', ?, ?, ?, 'created')
      ON CONFLICT(bot_id) DO UPDATE SET
        owner_id=excluded.owner_id,
        updated_at=excluded.updated_at,
        expires_at=?,
        last_action='renewed'
    `).run(targetBot.id, playerId, now, now, hostBase + BOT_HOST_MONTH_MS, hostBase + BOT_HOST_MONTH_MS);
    appendBotHostLog(targetBot.id, adminFreeBotHost ? `Host 1 mois active gratuitement par admin ${player.pseudo}.` : `Host 1 mois achete par ${player.pseudo}.`);
  } else if (pack === 'vip_1m') {
    pQ.updateVip.run({ is_vip: 1, id: recipientId });
    pQ.updateVipPlus.run({ is_vip_plus: 0, id: recipientId });
    pQ.updateVipExpiry.run({ vip_expires_at: baseExpiry + (30 * 24 * 60 * 60 * 1000), id: recipientId });
  } else if (pack === 'vip_1y') {
    pQ.updateVip.run({ is_vip: 1, id: recipientId });
    pQ.updateVipPlus.run({ is_vip_plus: 0, id: recipientId });
    pQ.updateVipExpiry.run({ vip_expires_at: baseExpiry + (365 * 24 * 60 * 60 * 1000), id: recipientId });
  } else if (pack === 'vip_plus') {
    pQ.updateVip.run({ is_vip: 1, id: recipientId });
    pQ.updateVipPlus.run({ is_vip_plus: 1, id: recipientId });
    pQ.updateVipExpiry.run({ vip_expires_at: null, id: recipientId });
  } else if (pack === 'perso') {
    pQ.updatePerso.run({ is_perso: 1, id: recipientId });
  } else if (pack === 'elo_reset') {
    pQ.setElo.run({ elo: 1000, id: recipientId });
  } else if (pack === 'limited_offer' && Array.isArray(item.grants)) {
    for (const grant of item.grants) applyLimitedPackEntry(recipientId, grant, { now, player: recipient });
  } else if (Array.isArray(item.grants)) {
    for (const grant of item.grants) applyShopGrant(recipientId, grant, { now, player: recipient });
  } else {
    if (item.isCustom) {
      shopItemQ.addOne.run(recipientId, item.key);
    } else {
      shopItemQ.addOne.run(recipientId, pack);
    }
  }
  const stockKey = SHOP_STOCK_KEYS[pack];
  if (stockKey) {
    db.prepare(`UPDATE config SET value = CAST(MAX(CAST(value AS INTEGER) - 1, 0) AS TEXT) WHERE key = ?`).run(stockKey);
  }
  if (pack === 'limited_offer') {
    db.prepare(`
      INSERT INTO config (key, value) VALUES ('shop_limited_offer_stock', '0')
      ON CONFLICT(key) DO UPDATE SET value = CAST(MAX(CAST(value AS INTEGER) - 1, 0) AS TEXT)
    `).run();
  }

  const fresh = pQ.getById.get(recipientId);
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

  try {
    WH.wlogShopPurchase(player.pseudo, playerId, `${item.label || item.name || pack}${isGift ? ` -> ${recipient.pseudo}` : ''}`, {
      currency,
      paid: price,
      basePrice,
      referralDiscount: Number(getReferralInfo(player).discountPercent || 0),
      persoDiscount: Number(player.is_perso || 0) === 1 ? 30 : 0,
      coupon: coupon ? { code: coupon.code, type: coupon.type, value: coupon.value } : null,
    });
  } catch(e) {}
  progression.recordAction(playerId, 'shop_purchases');

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
    gemPrices: SHOP_GEM_PRICES,
    botCrystalPrices: { bot_host_1m: BOT_HOST_PRICE_CRYSTALS },
    currency,
    paid: price,
    coupon: coupon ? { code: coupon.code, type: coupon.type, value: coupon.value, expiresAt: Number(coupon.expires_at || 0) || null } : null,
    items: SHOP_ITEMS,
    stock,
    inventory,
    gemsUnlocked: !!String(pQ.getById.get(playerId)?.discord_id || '').trim(),
    botHostEligible: getOwnedBots(playerId).length > 0,
    botCrystals: Number(pQ.getById.get(playerId)?.bot_crystals || 0),
    botHosts: getOwnedBots(playerId),
    player: sanitize(pQ.getById.get(playerId)),
    referral: getReferralInfo(pQ.getById.get(playerId)),
    target: isGift ? sanitize(pQ.getById.get(recipientId)) : null,
    gifted: isGift,
    giftTo: isGift ? recipient.pseudo : '',
  });
});

app.post('/api/shop/product-key/redeem', async (req, res) => {
  const token = String(req.body?.token || '');
  const redeemerId = validateSession(token);
  if (!redeemerId) return res.status(401).json({ error: 'Connecte-toi pour utiliser une clé produit.' });
  const code = normalizeProductKey(req.body?.code);
  if (!code) return res.status(400).json({ error: 'Clé produit manquante.' });

  const targetPseudo = String(req.body?.targetPseudo || '').trim();
  const target = targetPseudo ? pQ.getByPseudo.get(targetPseudo) : pQ.getById.get(redeemerId);
  if (!target || Number(target.deleted || 0) === 1 || Number(target.is_guest || 0) === 1 || Number(target.is_bot || 0) === 1) {
    return res.status(404).json({ error: 'Profil destinataire introuvable.' });
  }

  let grants = [];
  try {
    const redeem = db.transaction(() => {
      const row = db.prepare(`SELECT * FROM product_keys WHERE code = ?`).get(code);
      if (!row) throw new Error('Clé produit invalide.');
      if (Number(row.redeemed_at || 0)) throw new Error('Cette clé produit a déjà été utilisée.');
      if (Number(row.expires_at || 0) && Number(row.expires_at) < Date.now()) throw new Error('Cette clé produit a expiré.');
      try {
        grants = JSON.parse(row.grants_json || '[]');
      } catch {
        grants = [];
      }
      if (!Array.isArray(grants) || !grants.length) throw new Error('Cette clé produit ne contient aucune récompense.');
      for (const grant of grants) applyLimitedPackEntry(target.id, grant, { now: Date.now(), player: target });
      const marked = db.prepare(`
        UPDATE product_keys
        SET redeemed_by = ?, redeemed_for = ?, redeemed_at = ?
        WHERE code = ? AND redeemed_at IS NULL
      `).run(redeemerId, target.id, Date.now(), code);
      if (marked.changes !== 1) throw new Error('Cette clé produit a déjà été utilisée.');
    });
    redeem();
  } catch (error) {
    return res.status(400).json({ error: error.message || 'Clé produit inutilisable.' });
  }

  const fresh = pQ.getById.get(target.id);
  notifyPlayerProfileChanged(target.id, `Clé produit utilisée : ${grants.map(productKeyRewardLabel).join(', ')}.`);
  if (fresh?.discord_id) {
    try {
      await syncDiscordRole(
        fresh.discord_id,
        fresh.role,
        Number(fresh.is_vip || 0) === 1,
        Number(fresh.is_vip_plus || 0) === 1,
        Number(fresh.is_perso || 0) === 1
      );
    } catch {}
  }
  const inventoryRows = shopItemQ.getAllForPlayer.all(target.id);
  res.json({
    ok: true,
    target: { id: fresh.id, pseudo: fresh.pseudo },
    rewards: grants.map(productKeyRewardLabel),
    player: sanitize(fresh),
    inventory: Object.fromEntries(inventoryRows.map(row => [row.item_key, Number(row.quantity || 0)])),
  });
});

function getHostOwnerFromRequest(req) {
  const token = String(req.headers['x-session-token'] || req.body?.token || req.query?.token || '');
  const playerId = validateSession(token);
  if (!playerId) return null;
  const player = pQ.getById.get(playerId);
  if (!player || Number(player.deleted || 0) === 1 || Number(player.is_guest || 0) === 1 || Number(player.is_bot || 0) === 1) return null;
  return player;
}

function getOwnedBotOrFail(ownerId, botId, viewer = null) {
  const bot = pQ.getById.get(Number(botId || 0));
  const adminMode = isAdminPlayer(viewer);
  if (!bot || Number(bot.deleted || 0) === 1 || Number(bot.is_bot || 0) !== 1 || (!adminMode && Number(bot.bot_owner_id || 0) !== Number(ownerId || 0))) {
    return null;
  }
  return bot;
}

function serializeBotHost(row, bot = null) {
  if (!row) return null;
  const expiresAt = Number(row.expires_at || 0);
  const metrics = (() => {
    try {
      const parsed = JSON.parse(String(row.metrics || '[]'));
      return Array.isArray(parsed) ? parsed : [];
    } catch (_) {
      return [];
    }
  })();
  return {
    botId: Number(row.bot_id || bot?.id || 0),
    ownerId: Number(row.owner_id || 0),
    status: expiresAt > Date.now() ? String(row.status || 'stopped') : 'expired',
    active: expiresAt > Date.now(),
    expiresAt: expiresAt || null,
    updatedAt: Number(row.updated_at || 0) || null,
    lastAction: row.last_action || '',
    codeSize: Buffer.byteLength(String(row.code || ''), 'utf8'),
    lastMetric: metrics[metrics.length - 1] || null,
    bot: bot ? sanitize(bot) : null,
  };
}

app.get('/api/bot-host/me', (req, res) => {
  const player = getHostOwnerFromRequest(req);
  if (!player) return res.status(401).json({ error: 'Session invalide.' });
  const bots = getOwnedBots(player.id, player);
  res.json({
    ok: true,
    player: sanitize(pQ.getById.get(player.id)),
    botCrystals: Number(pQ.getById.get(player.id)?.bot_crystals || 0),
    price: BOT_HOST_PRICE_CRYSTALS,
    bots,
  });
});

app.post('/api/bot-host/:botId/code', (req, res) => {
  const player = getHostOwnerFromRequest(req);
  if (!player) return res.status(401).json({ error: 'Session invalide.' });
  const bot = getOwnedBotOrFail(player.id, req.params.botId, player);
  if (!bot) return res.status(404).json({ error: 'Bot introuvable ou non associe a ton compte.' });
  const host = getBotHostForOwner(player.id, bot.id, player);
  if (!host || Number(host.expires_at || 0) <= Date.now()) return res.status(403).json({ error: 'Achete Host 1 mois avant d envoyer du code.' });
  const code = String(req.body?.code || '');
  if (!code.trim()) return res.status(400).json({ error: 'Code vide.' });
  if (Buffer.byteLength(code, 'utf8') > BOT_HOST_MAX_CODE_BYTES) return res.status(413).json({ error: 'Code trop lourd pour ce panel.' });
  db.prepare(`UPDATE bot_hosts SET code = ?, updated_at = ?, last_action = 'upload' WHERE bot_id = ?`).run(code, Date.now(), bot.id);
  appendBotHostLog(bot.id, `Code mis a jour (${Buffer.byteLength(code, 'utf8')} octets).`);
  res.json({ ok: true, host: serializeBotHost(getBotHostForOwner(player.id, bot.id, player), bot) });
});

app.get('/api/bot-host/:botId/download', (req, res) => {
  const player = getHostOwnerFromRequest(req);
  if (!player) return res.status(401).json({ error: 'Session invalide.' });
  const bot = getOwnedBotOrFail(player.id, req.params.botId, player);
  if (!bot) return res.status(404).json({ error: 'Bot introuvable ou non associe a ton compte.' });
  const host = getBotHostForOwner(player.id, bot.id, player);
  if (!host) return res.status(404).json({ error: 'Aucun host pour ce bot.' });
  const code = String(host.code || '');
  res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${String(bot.pseudo || 'bot').replace(/[^a-z0-9_-]+/gi, '_')}-host.js"`);
  res.send(code || `// Aucun code envoye pour ${bot.pseudo}\n`);
});

app.get('/api/bot-host/:botId/logs', (req, res) => {
  const player = getHostOwnerFromRequest(req);
  if (!player) return res.status(401).json({ error: 'Session invalide.' });
  const bot = getOwnedBotOrFail(player.id, req.params.botId, player);
  if (!bot) return res.status(404).json({ error: 'Bot introuvable ou non associe a ton compte.' });
  const host = getBotHostForOwner(player.id, bot.id, player);
  if (!host) return res.status(404).json({ error: 'Aucun host pour ce bot.' });
  res.json({ ok: true, logs: String(host.logs || ''), host: serializeBotHost(host, bot) });
});

app.get('/api/bot-host/:botId/metrics', (req, res) => {
  const player = getHostOwnerFromRequest(req);
  if (!player) return res.status(401).json({ error: 'Session invalide.' });
  const bot = getOwnedBotOrFail(player.id, req.params.botId, player);
  if (!bot) return res.status(404).json({ error: 'Bot introuvable ou non associe a ton compte.' });
  const host = getBotHostForOwner(player.id, bot.id, player);
  if (!host) return res.status(404).json({ error: 'Aucun host pour ce bot.' });
  res.json({
    ok: true,
    host: serializeBotHost(host, bot),
    metrics: readBotHostMetrics(bot.id),
    limits: {
      maxRssMb: BOT_HOST_MAX_RSS_MB,
      maxCpuMsPerMin: BOT_HOST_MAX_CPU_MS_PER_MIN,
      maxThreads: 2,
      hostedDepth: HOSTED_BOT_DEPTH,
      hostedThinkMs: HOSTED_BOT_THINK_MS,
    },
  });
});

app.post('/api/bot-host/:botId/action', (req, res) => {
  const player = getHostOwnerFromRequest(req);
  if (!player) return res.status(401).json({ error: 'Session invalide.' });
  const bot = getOwnedBotOrFail(player.id, req.params.botId, player);
  if (!bot) return res.status(404).json({ error: 'Bot introuvable ou non associe a ton compte.' });
  const host = getBotHostForOwner(player.id, bot.id, player);
  if (!host || Number(host.expires_at || 0) <= Date.now()) return res.status(403).json({ error: 'Host inactif ou expire.' });
  const action = String(req.body?.action || '').toLowerCase();
  if (!['start', 'restart', 'stop'].includes(action)) return res.status(400).json({ error: 'Action invalide.' });
  try {
    if (action === 'stop') {
      stopBotHostProcess(bot.id, 'profil');
      const now = Date.now();
      db.prepare(`UPDATE bot_hosts SET status = 'stopped', pid = 0, stopped_at = ?, updated_at = ?, last_action = 'stop' WHERE bot_id = ?`).run(now, now, bot.id);
      botRuntime.set(Number(bot.id), { status: 'host-stopped', lastSeen: Date.now(), hosted: true });
      appendBotHostLog(bot.id, 'Arret demande depuis le profil.');
    } else {
      const freshHost = getBotHostForOwner(player.id, bot.id, player);
      startBotHostProcess(bot, freshHost, action);
    }
    broadcastPresenceCounts();
    res.json({ ok: true, host: serializeBotHost(getBotHostForOwner(player.id, bot.id, player), bot), runtime: publicBotRuntime(bot.id) });
  } catch (error) {
    appendBotHostLog(bot.id, `Action ${action} impossible: ${error.message}`);
    res.status(400).json({ error: error.message || 'Action impossible.' });
  }
});

app.get('/api/progression/me', (req, res) => {
  const token = String(req.headers['x-session-token'] || req.query.token || '');
  const playerId = validateSession(token);
  if (!playerId) return res.status(401).json({ error: 'Session invalide.' });
  res.json({ ok: true, progression: progression.getPlayerData(playerId) });
});

app.post('/api/progression/challenges/:key/claim', (req, res) => {
  const token = String(req.headers['x-session-token'] || req.body?.token || '');
  const playerId = validateSession(token);
  if (!playerId) return res.status(401).json({ error: 'Session invalide.' });
  try {
    const reward = progression.claimChallenge(playerId, String(req.params.key || ''));
    res.json({ ok: true, reward, progression: progression.getPlayerData(playerId), player: sanitize(pQ.getById.get(playerId)) });
  } catch (error) {
    res.status(400).json({ error: error.message || 'Recompense indisponible.' });
  }
});

app.post('/api/progression/theme', (req, res) => {
  const token = String(req.headers['x-session-token'] || req.body?.token || '');
  const playerId = validateSession(token);
  if (!playerId) return res.status(401).json({ error: 'Session invalide.' });
  try {
    const theme = progression.equipTheme(playerId, String(req.body?.theme || ''));
    res.json({ ok: true, theme, progression: progression.getPlayerData(playerId) });
  } catch (error) {
    res.status(400).json({ error: error.message || 'Theme indisponible.' });
  }
});

app.get('/api/seasons/current', (_, res) => {
  res.json(progression.seasonData());
});

app.get('/api/clans/:id/missions', (req, res) => {
  const clanId = Number(req.params.id || 0);
  if (!clanId || !cQ.getById.get(clanId)) return res.status(404).json({ error: 'Clan introuvable.' });
  res.json({
    missions: progression.getClanMissions(clanId),
    war: progression.getClanWar(clanId),
  });
});

app.post('/api/live/:id/predict', (req, res) => {
  const token = String(req.headers['x-session-token'] || req.body?.token || '');
  const playerId = validateSession(token);
  const gameId = Number(req.params.id || 0);
  const game = gm.games.get(gameId);
  if (!playerId) return res.status(401).json({ error: 'Connecte-toi pour pronostiquer.' });
  if (!game || game.status !== 'active') return res.status(404).json({ error: 'Partie indisponible.' });
  if ([Number(game.players[1]?.id), Number(game.players[2]?.id)].includes(Number(playerId))) {
    return res.status(400).json({ error: 'Les joueurs ne peuvent pas pronostiquer leur propre partie.' });
  }
  try {
    progression.setPrediction(gameId, playerId, Number(req.body?.side));
    emitLiveUpdate();
    res.json({ ok: true, predictions: progression.predictionStats(gameId) });
  } catch (error) {
    res.status(400).json({ error: error.message || 'Pronostic impossible.' });
  }
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
          1: { id: state.players[1].id, pseudo: state.players[1].pseudo, elo: state.players[1].elo, color: c1, avatar: state.players[1].avatar || '', shape: state.players[1].shape || 'circle', token_emoji_image: state.players[1].token_emoji_image || '', token_rgb: Number(state.players[1].pseudo_rgb || 0) === 1, avatar_decoration: state.players[1].avatar_decoration || '', search_nameplate: state.players[1].search_nameplate || '', profile_banner: state.players[1].profile_banner || '', color_secondary: state.players[1].color_secondary || '', is_bot: Number(state.players[1].is_bot || 0) },
          2: { id: state.players[2].id, pseudo: state.players[2].pseudo, elo: state.players[2].elo, color: c2, avatar: state.players[2].avatar || '', shape: state.players[2].shape || 'circle', token_emoji_image: state.players[2].token_emoji_image || '', token_rgb: Number(state.players[2].pseudo_rgb || 0) === 1, avatar_decoration: state.players[2].avatar_decoration || '', search_nameplate: state.players[2].search_nameplate || '', profile_banner: state.players[2].profile_banner || '', color_secondary: state.players[2].color_secondary || '', is_bot: Number(state.players[2].is_bot || 0) },
        };
      })(),
      grid:    state.board.grid,
      variant: state.variant || 'classic',
      variantConfig: state.variantConfig || getVariant(state.variant),
      antiScores: state.antiScores || null,
      bombs: state.bombs || null,
      current: state.current,
      moves:   state.moveCount,
      gameType: state.gameType || 'ranked',
      botGame: Number(state.players[1].is_bot || 0) === 1 || Number(state.players[2].is_bot || 0) === 1,
      botMatch: Number(state.players[1].is_bot || 0) === 1 && Number(state.players[2].is_bot || 0) === 1,
      winCells: Array.isArray(state.winCells) ? state.winCells : [],
      spectators: getLiveSpectators(id),
      predictions: progression.predictionStats(id),
      reactions: liveReactions.get(Number(id)) || {},
    };
    if (state.status === 'finished') {
      entry.result   = state.result   || null;  // { winner, eloChanges }
      entry.finishedAt = state.finishedAt || Date.now();
    }
    games.push(entry);
  }
  games.sort((a, b) => {
    const aHuman = a.botMatch ? 0 : 1;
    const bHuman = b.botMatch ? 0 : 1;
    if (aHuman !== bHuman) return bHuman - aHuman;
    const aActive = a.status === 'active' ? 1 : 0;
    const bActive = b.status === 'active' ? 1 : 0;
    if (aActive !== bActive) return bActive - aActive;
    return Number(b.finishedAt || b.id || 0) - Number(a.finishedAt || a.id || 0);
  });
  res.json(games.slice(0, 15));
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

function discordMemberAvatarUrl(memberInfo) {
  if (!memberInfo?.user?.id) return '';
  if (memberInfo.avatar) {
    const ext = String(memberInfo.avatar).startsWith('a_') ? 'gif' : 'png';
    return `https://cdn.discordapp.com/guilds/${DISCORD_GUILD}/users/${memberInfo.user.id}/avatars/${memberInfo.avatar}.${ext}?size=512`;
  }
  return discordAvatarUrl(memberInfo.user);
}

async function fetchDiscordUserProfile(discordUserId, botToken) {
  try {
    if (!discordUserId || !botToken) return null;
    const userRes = await discordRestFetch(`discord-user:${discordUserId}:profile`, `https://discord.com/api/v10/users/${discordUserId}`, {
      headers: { 'Authorization': 'Bot ' + botToken },
    });
    if (!userRes.ok) return null;
    return await userRes.json();
  } catch(e) {
    return null;
  }
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
  if (pseudo.trim().length < 2) return res.status(400).json({ error: 'Pseudo trop court (2 caractères min).' });
  if (password.length < 4)     return res.status(400).json({ error: 'Mot de passe trop court (4 caractères min).' });

  const existing = pQ.getByPseudo.get(pseudo.trim());
  if (existing) return res.status(409).json({ error: 'Ce pseudo est déjà pris.' });

  try {
    let player = pQ.register.get({ pseudo: pseudo.trim(), password: hashPwd(password) });
    // Sauvegarder la couleur choisie AAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAA  l'inscription
    if (req.body.color && /^#[0-9a-fA-F]{6}$/.test(req.body.color)) {
      pQ.updateColor.run({ color: req.body.color, id: player.id });
      player = pQ.getById.get(player.id);
    }
    grantWelcomeRewards(player.id);
    assignReferrerIfPossible(player.id, req.body.referrer || req.body.referrerId || req.body.ref);
    player = pQ.getById.get(player.id);
    const token = createSession(player.id);
    security.recordRegistration(req, player.pseudo, player.id);
    broadcastPresenceCounts(true);
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

  if (Number(player.is_bot || 0) === 1) {
    security.recordLoginFailure(req, pseudo);
    return res.status(403).json({
      error: 'Mode Bot activé : connexion au site impossible. Utilise le token bot dans ton client.',
    });
  }

  const referrer = assignReferrerIfPossible(player.id, req.body.referrer || req.body.referrerId || req.body.ref);
  const freshPlayer = referrer ? pQ.getById.get(player.id) : player;
  const token = createSession(player.id);
  security.recordLoginSuccess(req, player.id);
  res.json({ ...sanitize(freshPlayer), token, referralLinked: !!referrer });
});

app.get('/api/variants', (_req, res) => {
  res.json({ variants: publicVariants(), missions: MISSION_DEFINITIONS });
});

app.get('/api/players/:id/variant-stats', (req, res) => {
  const playerId = Number(req.params.id || 0);
  const player = pQ.getById.get(playerId);
  if (!player) return res.status(404).json({ error: 'Joueur introuvable.' });
  const stored = new Map(variantQ.listForPlayer.all(playerId).map(row => [row.variant, row]));
  const stats = publicVariants().map(variant => {
    if (variant.id === 'classic') return { ...variant, elo: player.elo, best_elo: Math.max(1000, player.elo), wins: player.wins, losses: player.losses, draws: player.draws };
    return { ...variant, ...(stored.get(variant.id) || { elo: 1000, best_elo: 1000, wins: 0, losses: 0, draws: 0 }) };
  });
  res.json({ playerId, stats });
});

app.get('/api/leaderboard/variant/:variant', (req, res) => {
  const variant = normalizeVariant(req.params.variant);
  if (variant === 'classic') return res.json({ variant, players: pQ.leaderboard.all() });
  res.json({ variant, players: variantQ.leaderboard.all(variant, 50) });
});

app.get('/api/auth/session', (req, res) => {
  const token = String(req.headers['x-session-token'] || req.query.token || '');
  const playerId = validateSession(token);
  if (!playerId) return res.status(401).json({ error: 'Session invalide ou expirée.' });
  const player = pQ.getById.get(playerId);
  if (!player) return res.status(404).json({ error: 'Joueur introuvable.' });
  return res.json({ player: stripWallpaperPayload(sanitize(player)) });
});

const PROFILE_WALLPAPER_MAX_BYTES = 650 * 1024;

function getDataUrlBytes(value) {
  const input = String(value || '').trim();
  const comma = input.indexOf(',');
  if (!input || comma < 0) return 0;
  try {
    return Buffer.byteLength(input.slice(comma + 1), 'base64');
  } catch {
    return 0;
  }
}

function safeWallpaperDataUrl(value) {
  const input = String(value || '').trim();
  if (!input) return '';
  if (getDataUrlBytes(input) > PROFILE_WALLPAPER_MAX_BYTES) return '';
  return input;
}

function stripWallpaperPayload(player) {
  if (!player || typeof player !== 'object') return player;
  return {
    ...player,
    profile_wallpaper_desktop: '',
    profile_wallpaper_mobile: '',
    profile_wallpaper_opacity: Number(player.profile_wallpaper_opacity || 0.48),
    profile_wallpaper_dim: Number(player.profile_wallpaper_dim || 0.28),
  };
}

// Ne jamais renvoyer le hash du mot de passe au client
function sanitize(p) {
  const { password, bot_token_hash, bot_host_token, bot_host_token_hash, ...rest } = p;
  // Masquer les infos perso si compte supprimAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAA
  if (rest.deleted) {
    return {
      ...rest,
      pseudo:     '[Supprimée]',
      avatar:     '',
      avatar_decoration: '',
      token_emoji_image: '',
      profile_banner: '',
      queue_music: '',
      custom_cursor: '',
      profile_wallpaper_desktop: '',
      profile_wallpaper_mobile: '',
      profile_wallpaper_opacity: 0.48,
      profile_wallpaper_dim: 0.28,
      color:      '#555555',
      color_secondary: '',
      discord_id: null,
      banner:     null,
      is_vip:     0,
      is_vip_plus: 0,
      is_perso: 0,
      is_crystal: 0,
      crystal_expires_at: null,
      crystal_auto_renew: 0,
      vip_expires_at: null,
    };
  }
  const canUseQueueMusic = isPersoPlayer(rest) || hasStaffRoleBenefits(rest);
  return {
    ...rest,
    profile_wallpaper_desktop: safeWallpaperDataUrl(rest.profile_wallpaper_desktop || rest.profile_wallpaper || ''),
    profile_wallpaper_mobile: safeWallpaperDataUrl(rest.profile_wallpaper_mobile || ''),
    queue_music: canUseQueueMusic ? String(rest.queue_music || '') : '',
    is_vip: isVipPlayer(rest) ? 1 : 0,
    is_vip_plus: isVipPlusPlayer(rest) ? 1 : 0,
    is_perso: isPersoPlayer(rest) ? 1 : 0,
    is_crystal: isCrystalPlayer(rest) ? 1 : 0,
    crystal_expires_at: Number(rest.crystal_expires_at || 0) || null,
    crystal_auto_renew: Number(rest.crystal_auto_renew || 0) === 1 ? 1 : 0,
    vip_expires_at: Number(rest.vip_expires_at || 0) || null,
  };
}

app.get('/api/i18n', async (req, res) => {
  const language = siteI18n.normalizeLanguage(req.query.lang || req.query.language || 'fr');
  try {
    res.json(await siteI18n.buildBundleAsync(language));
  } catch (error) {
    res.json(siteI18n.buildBundle(language));
  }
});

// AAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAA Players API AAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAA
let activeI18nTranslation = null;

app.post('/api/i18n/translate', async (req, res) => {
  const language = siteI18n.normalizeLanguage(req.body?.lang || req.body?.language || 'fr');
  const texts = Array.isArray(req.body?.texts) ? req.body.texts : [];
  if (language === 'fr' || texts.length === 0) {
    return res.json({ language, translations: {}, provider: 'none' });
  }
  if (activeI18nTranslation) {
    const elapsedMs = Date.now() - activeI18nTranslation.startedAt;
    return res.status(429).json({
      error: 'Une traduction est deja en cours.',
      detail: 'Patiente ou recharge la page plus tard : le cache se remplit en arriere-plan.',
      provider: siteI18n.getMachineProvider(),
      active: {
        language: activeI18nTranslation.language,
        path: activeI18nTranslation.path,
        texts: activeI18nTranslation.texts,
        elapsedSeconds: Math.floor(elapsedMs / 1000),
      },
    });
  }
  activeI18nTranslation = {
    language,
    path: String(req.headers.referer || req.headers.referrer || req.originalUrl || ''),
    texts: texts.length,
    startedAt: Date.now(),
  };
  try {
    const result = await siteI18n.translateTextsDetailed(texts, language);
    res.json({
      language,
      translations: result.translations,
      stats: {
        total: result.total,
        translated: result.translated,
        failed: result.failed,
      },
      errors: result.errors,
      provider: result.provider || siteI18n.getMachineProvider(),
    });
  } catch (error) {
    res.status(502).json({
      error: 'Traduction indisponible.',
      detail: error.message,
      provider: siteI18n.getMachineProvider(),
    });
  } finally {
    activeI18nTranslation = null;
  }
});

app.get('/api/players', (req, res) => {
  const type = String(req.query.type || 'all').toLowerCase();
  const q = String(req.query.q || '').trim().toLowerCase();
  const onlineOnly = String(req.query.online || '') === '1';
  const limit = Math.max(1, Math.min(100, Number(req.query.limit || 60)));
  let rows = db.prepare(`
    SELECT id, pseudo, elo, wins, losses, draws, color, color_secondary, shape, avatar,
           avatar_decoration, profile_banner, role, is_vip, is_vip_plus, is_perso,
           elo_curve_color, elo_curve_color_secondary, elo_curve_rgb, elo_curve_rgb_speed, elo_curve_rgb_direction,
           is_crystal, crystal_expires_at, crystal_auto_renew, crystal_alert_message, crystal_alert_color, crystal_alert_emoji, crystal_alert_animation,
           custom_role_text, custom_role_color, custom_role_color_secondary, custom_role_emoji, custom_role_rgb,
           is_bot, bot_skill, bot_description, bot_enabled, bot_last_seen, last_seen
    FROM players
    WHERE deleted = 0 AND is_guest = 0
    ORDER BY elo DESC, wins DESC
    LIMIT ?
  `).all(limit * 2);
  if (type === 'bots') rows = rows.filter(p => Number(p.is_bot) === 1);
  if (type === 'humans') rows = rows.filter(p => Number(p.is_bot) !== 1);
  if (q) rows = rows.filter(p => String(p.pseudo || '').toLowerCase().includes(q));
  const mapped = rows.map(p => {
    const runtime = Number(p.is_bot) === 1 ? publicBotRuntime(p.id) : null;
    const online = Number(p.is_bot) === 1 ? runtime.online : onlineSockets.has(Number(p.id));
    return {
      ...sanitize(p),
      rank: getRank(Number(p.elo || 0)),
      online,
      botOnline: runtime?.online || false,
      botStatus: runtime?.status || (Number(p.is_bot) === 1 ? 'offline' : null),
      playing: playerIsAlreadyPlaying(p.id) || !!findActiveGameByPlayer(p.id),
      inQueue: playerIsInAnyQueue(p.id),
    };
  }).filter(p => !onlineOnly || p.online).slice(0, limit);
  res.json({ players: mapped, counts: { total: mapped.length, online: mapped.filter(p => p.online).length, bots: mapped.filter(p => Number(p.is_bot) === 1).length, humans: mapped.filter(p => Number(p.is_bot) !== 1).length } });
});

app.post('/api/players/:id/convert-bot', (req, res) => {
  const id = Number(req.params.id);
  const token = String(req.body?.token || req.headers['x-session-token'] || req.headers['x-token'] || '');
  if (!id || validateSession(token) !== id) return res.status(403).json({ error: 'Session invalide.' });
  const player = pQ.getById.get(id);
  if (!player || player.deleted) return res.status(404).json({ error: 'Joueur introuvable.' });
  if (player.discord_id) return res.status(409).json({ error: 'Un compte lie Discord ne peut pas devenir un bot.' });
  if (Number(player.is_bot) === 1) return res.status(409).json({ error: 'Ce compte est deja en mode bot. Le token ne peut pas etre regenere.' });
  const botIpHash = hashIp(getClientIp(req));
  const existingBotForIp = db.prepare(`
    SELECT id, pseudo
    FROM players
    WHERE deleted = 0
      AND is_guest = 0
      AND is_bot = 1
      AND bot_ip_hash = ?
      AND id != ?
    LIMIT 1
  `).get(botIpHash, id);
  if (existingBotForIp) {
    return res.status(409).json({
      error: `Un seul compte bot par connexion est autorise. Bot deja cree : ${existingBotForIp.pseudo}.`,
    });
  }
  const botToken = makeBotToken();
  const skill = Math.max(100, Math.min(3000, Number(req.body?.skill || player.elo || 1000)));
  const description = String(req.body?.description || 'Bot cree par un joueur.').trim().slice(0, 180);
  const ownerRaw = String(req.body?.owner || req.body?.ownerPseudo || req.body?.creator || '').trim();
  const ownerIdRaw = Number(req.body?.ownerId || req.body?.creatorId || 0);
  let owner = null;
  if (ownerIdRaw) owner = pQ.getById.get(ownerIdRaw);
  if (!owner && ownerRaw) owner = pQ.getByPseudo.get(ownerRaw);
  if (owner && (Number(owner.deleted || 0) === 1 || Number(owner.is_guest || 0) === 1 || Number(owner.is_bot || 0) === 1 || Number(owner.id) === id)) {
    return res.status(400).json({ error: 'Createur de bot invalide. Choisis un compte joueur humain different du bot.' });
  }
  db.prepare(`
    UPDATE players
    SET is_bot = 1, bot_enabled = 1, bot_skill = ?, bot_description = ?,
        bot_token_hash = ?, bot_token_preview = ?, bot_last_seen = 0,
        bot_ip_hash = ?,
        bot_owner_id = ?,
        coins = 0,
        custom_role_text = 'BOT', custom_role_color = '#8E8E93', custom_role_emoji = '🤖'
    WHERE id = ?
  `).run(skill, description, hashBotToken(botToken), botToken.slice(-8), botIpHash, owner?.id || null, id);
  const baseUrl = String(discordConfig().baseUrl || '').replace(/\/+$/, '');
  const activationCurl = `curl.exe -k -X POST -H "Authorization: Bearer ${botToken}" "${baseUrl}/api/bot/ping?status=seeking"`;
  res.json({
    ok: true,
    player: sanitize(pQ.getById.get(id)),
    owner: owner ? sanitize(owner) : null,
    botToken,
    activationCurl,
    note: 'Token affiche une seule fois. Garde-le secret : il ne pourra pas etre regenere.',
  });
});

app.post('/api/bot/token/rotate', (req, res) => {
  res.status(410).json({ error: 'Les tokens bot ne peuvent pas etre regeneres. Cree un nouveau compte bot si le token est perdu.' });
});

app.get('/api/bot/me', (req, res) => {
  const bot = getBotFromRequest(req);
  meterBotHostNetwork(req, res, bot);
  if (!bot) return res.status(401).json({ error: 'Token bot invalide.' });
  res.json({ bot: { ...sanitize(bot), runtime: publicBotRuntime(bot.id), activeGame: serializeBotGameState(findActiveBotGame(bot.id), bot.id) } });
});

app.post('/api/bot/ping', (req, res) => {
  const bot = getBotFromRequest(req);
  meterBotHostNetwork(req, res, bot);
  if (!ensureBotEnabled(bot, res)) return;
  const status = String(req.body?.status || req.query?.status || 'idle').slice(0, 40);
  botRuntime.set(Number(bot.id), { status, lastSeen: Date.now(), userAgent: String(req.headers['user-agent'] || '').slice(0, 120) });
  db.prepare(`UPDATE players SET bot_last_seen = ? WHERE id = ?`).run(Date.now(), bot.id);
  broadcastPresenceCounts();
  res.json({ ok: true, bot: sanitize(pQ.getById.get(bot.id)), runtime: publicBotRuntime(bot.id) });
});

app.post('/api/bot/queue/join', (req, res) => {
  const bot = getBotFromRequest(req);
  meterBotHostNetwork(req, res, bot);
  if (!ensureBotEnabled(bot, res)) return;
  botRuntime.set(Number(bot.id), { status: 'queue', lastSeen: Date.now() });
  broadcastPresenceCounts();
  const active = findActiveBotGame(bot.id);
  if (active) return res.json({ ok: true, status: 'playing', game: serializeBotGameState(active, bot.id) });
  const ownId = Number(bot.id);
  const opponentId = botApiQueue.find(id => id !== ownId && !findActiveBotGame(id));
  if (opponentId) {
    const idx = botApiQueue.indexOf(opponentId);
    if (idx >= 0) botApiQueue.splice(idx, 1);
    const state = createBotVsBotGame(bot, pQ.getById.get(opponentId), 'ranked');
    return res.json({ ok: true, status: 'matched', game: serializeBotGameState(state, bot.id) });
  }
  if (req.body?.allowBuiltin !== false) {
    const candidates = [...builtinBotIds].filter(id => id !== ownId && !findActiveBotGame(id)).map(id => pQ.getById.get(id)).filter(Boolean)
      .sort((a, b) => Math.abs(Number(a.elo || 1000) - Number(bot.elo || 1000)) - Math.abs(Number(b.elo || 1000) - Number(bot.elo || 1000)));
    if (candidates[0]) {
      const state = createBotVsBotGame(bot, candidates[0], 'ranked');
      return res.json({ ok: true, status: 'matched_builtin', game: serializeBotGameState(state, bot.id) });
    }
  }
  if (!botApiQueue.includes(ownId)) botApiQueue.push(ownId);
  res.json({ ok: true, status: 'queued', position: botApiQueue.indexOf(ownId) + 1 });
});

app.post('/api/bot/queue/leave', (req, res) => {
  const bot = getBotFromRequest(req);
  meterBotHostNetwork(req, res, bot);
  if (!ensureBotEnabled(bot, res)) return;
  const idx = botApiQueue.indexOf(Number(bot.id));
  if (idx >= 0) botApiQueue.splice(idx, 1);
  botRuntime.set(Number(bot.id), { status: 'idle', lastSeen: Date.now() });
  broadcastPresenceCounts();
  res.json({ ok: true });
});

app.get('/api/bot/game', (req, res) => {
  const bot = getBotFromRequest(req);
  meterBotHostNetwork(req, res, bot);
  if (!ensureBotEnabled(bot, res)) return;
  res.json({ game: serializeBotGameState(findActiveBotGame(bot.id), bot.id) });
});

app.post('/api/bot/move', (req, res) => {
  const bot = getBotFromRequest(req);
  meterBotHostNetwork(req, res, bot);
  if (!ensureBotEnabled(bot, res)) return;
  const state = findActiveBotGame(bot.id);
  if (!state) return res.status(404).json({ error: 'Aucune partie active.' });
  const side = Number(state.players[1].id) === Number(bot.id) ? 1 : 2;
  if (state.current !== side) return res.status(409).json({ error: 'Pas ton tour.', game: serializeBotGameState(state, bot.id) });
  const result = gm.playMove(state.players[side].socketId, Number(req.body?.col));
  if (result?.error) return res.status(400).json({ error: result.error, game: serializeBotGameState(state, bot.id) });
  scheduleBuiltinBotTurn(state.id);
  res.json({ ok: true, result, game: serializeBotGameState(gm.games.get(state.id), bot.id) });
});

app.post('/api/bot/challenge/:id', (req, res) => {
  const challenger = getBotFromRequest(req);
  meterBotHostNetwork(req, res, challenger);
  if (!ensureBotEnabled(challenger, res)) return;
  const targetId = Number(req.params.id);
  const target = pQ.getById.get(targetId);
  if (!target || target.deleted || Number(target.is_bot || 0) !== 1 || Number(target.bot_enabled || 0) !== 1) {
    return res.status(404).json({ error: 'Bot introuvable.' });
  }
  if (Number(target.id) === Number(challenger.id)) return res.status(409).json({ error: 'Un bot ne peut pas se defier lui-meme.' });
  if (findActiveGameByPlayer(challenger.id)) return res.status(409).json({ error: 'Ton bot est deja en partie.' });
  if (findActiveGameByPlayer(target.id)) return res.status(409).json({ error: 'Le bot cible est deja en partie.' });
  const runtime = publicBotRuntime(target.id);
  if (!runtime.online) return res.status(409).json({ error: 'Le bot cible est hors ligne.' });
  botRuntime.set(Number(challenger.id), { status: 'playing', lastSeen: Date.now() });
  const state = createChallengeVsBotGame(challenger, target, 'ranked');
  res.json({ ok: true, game: serializeBotGameState(state, challenger.id), target: sanitize(target) });
});

app.get('/api/bots/preconfigured', (req, res) => {
  const bots = [...builtinBotIds].map(id => pQ.getById.get(id)).filter(Boolean)
    .map(bot => ({ ...sanitize(bot), rank: getRank(Number(bot.elo || 0)), runtime: publicBotRuntime(bot.id), activeGame: serializeBotGameState(findActiveBotGame(bot.id), bot.id) }));
  res.json({ bots });
});

app.post('/api/bots/preconfigured/match', (req, res) => {
  const bots = [...builtinBotIds].map(id => pQ.getById.get(id)).filter(Boolean);
  if (bots.length < 2) return res.status(409).json({ error: 'Pas assez de bots disponibles.' });
  const free = bots.filter(bot => !findActiveBotGame(bot.id));
  const pool = free.length >= 2 ? free : bots;
  const shuffled = pool.sort(() => Math.random() - 0.5);
  const state = createBotVsBotGame(shuffled[0], shuffled[1], 'ranked');
  res.json({ ok: true, game: serializeBotGameState(state, shuffled[0].id) });
});

app.post('/api/bots/:id/challenge', (req, res) => {
  const token = String(req.body?.token || req.headers['x-session-token'] || req.headers['x-token'] || '');
  const challengerId = validateSession(token);
  if (!challengerId || isAnonymousPlayerId(challengerId)) return res.status(403).json({ error: 'Connecte-toi pour defier un bot.' });
  const challenger = pQ.getById.get(challengerId);
  if (!challenger || challenger.deleted) return res.status(404).json({ error: 'Joueur introuvable.' });
  const target = pQ.getById.get(Number(req.params.id));
  if (!target || target.deleted || Number(target.is_bot || 0) !== 1 || Number(target.bot_enabled || 0) !== 1) {
    return res.status(404).json({ error: 'Bot introuvable.' });
  }
  if (Number(target.id) === Number(challenger.id)) return res.status(409).json({ error: 'Tu ne peux pas defier ton propre bot.' });
  if (findActiveGameByPlayer(challenger.id)) return res.status(409).json({ error: 'Tu es deja en partie.' });
  if (findActiveGameByPlayer(target.id)) return res.status(409).json({ error: 'Ce bot est deja en partie.' });
  const runtime = publicBotRuntime(target.id);
  if (!runtime.online) return res.status(409).json({ error: 'Ce bot est hors ligne.' });
  clearPlayerQueues(challenger.id);
  const state = createChallengeVsBotGame(challenger, target, 'ranked');
  res.json({ ok: true, gameId: state.id, gameUrl: `/game/${state.id}`, game: serializeBotGameState(state, challenger.id), target: sanitize(target) });
});

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
    pseudo     = '[Supprimée]',
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
    is_developer = 0,
    is_crystal = 0,
    crystal_expires_at = NULL,
    crystal_auto_renew = 0,
    discord_id = NULL,
    deleted    = 1
  WHERE id = ?`).run(id);
  db.prepare(`DELETE FROM sessions WHERE player_id = ?`).run(id);
  broadcastPresenceCounts(true);

  res.json({ ok: true });
});

app.patch('/api/players/:id/shape', (req, res) => {
  const { shape, token } = req.body;
  const base = shape?.split(':')[0];
  const allowed = ['circle','triangle','diamond','star','heart','emoji','emoji_image'];
  if (!base || !allowed.includes(base)) return res.status(400).json({ error: 'Forme invalide.' });
  if (!token || validateSession(token) !== Number(req.params.id)) return res.status(403).json({ error: 'Erreur Lili (403) : Tu y as pas accès hihi !' });
  const player = pQ.getById.get(Number(req.params.id));
  if (base === 'emoji' && !isVipPlayer(player) && !hasStaffRoleBenefits(player)) {
    const last = Number(player?.token_emoji_changed_at || 0);
    const remaining = last + TOKEN_EMOJI_COOLDOWN_MS - Date.now();
    if (remaining > 0) {
      return res.status(429).json({ error: `Emoji modifiable dans ${Math.ceil(remaining / 60000)} min.`, remainingMs: remaining });
    }
  }
  if (base === 'emoji_image' && !isVipPlusPlayer(player) && !hasStaffRoleBenefits(player)) {
    return res.status(403).json({ error: 'L emoji image est reserve au VIP+.' });
  }
  if (base === 'emoji_image' && !player?.token_emoji_image) {
    return res.status(400).json({ error: 'Ajoute d\'abord un emoji perso VIP.' });
  }
  pQ.updateShape.run({ shape, id: Number(req.params.id) }); // stocke 'circle' ou 'emoji:AAaAa AaaAAaAAasAAAAaAAAasAA...AAAaAAasAAAAaAAAasAA...AAAaAAasAA'
  if (base === 'emoji' && !isVipPlayer(player) && !hasStaffRoleBenefits(player)) {
    pQ.updateTokenEmojiChangedAt.run({ changedAt: Date.now(), id: Number(req.params.id) });
  }
  progression.recordAction(Number(req.params.id), 'profile_updates');
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
  progression.recordAction(Number(req.params.id), 'profile_updates');
  res.json({ ok: true });
});

app.patch('/api/players/:id/language', async (req, res) => {
  const id = Number(req.params.id);
  const token = String(req.body?.token || req.headers['x-session-token'] || req.headers['x-token'] || '');
  const requestedLanguage = String(req.body?.language || '').trim().toLowerCase();
  const language = siteI18n.normalizeLanguage(requestedLanguage);
  if (!token || validateSession(token) !== id) return res.status(403).json({ error: 'Non autorise.' });
  const availableLanguages = await siteI18n.getAvailableLanguages().catch(() => siteI18n.LANGUAGES);
  const availableCodes = new Set(availableLanguages.flatMap(entry => [
    entry.code,
    entry.providerCode,
  ]).filter(Boolean).map(code => String(code).toLowerCase()));
  if (!availableCodes.has(requestedLanguage)) return res.status(400).json({ error: 'Langue non disponible.' });
  const player = pQ.getById.get(id);
  if (!player || player.deleted) return res.status(404).json({ error: 'Joueur introuvable.' });
  pQ.updateLanguage.run({ language, id });
  progression.recordAction(id, 'profile_updates');
  res.json({ ok: true, language, player: sanitize(pQ.getById.get(id)) });
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
  progression.recordAction(id, 'profile_updates');
  res.json({ ok: true, pseudo: nextPseudo });
});

app.patch('/api/players/:id/pseudo-style', (req, res) => {
  const { color, colorSecondary = '', font = '', format = '', rgb = false, token } = req.body;
  const id = Number(req.params.id);
  if (!token || validateSession(token) !== id) return res.status(403).json({ error: 'Non autorise.' });
  const player = pQ.getById.get(id);
  if (!player) return res.status(404).json({ error: 'Joueur introuvable.' });
  const nextColor = normalizeHexColor(color);
  const nextColorSecondary = normalizeHexColor(colorSecondary);
  const nextFont = String(font || '').trim().toLowerCase();
  const ownsSelectedFont = nextFont && nextFont !== 'barlow' && playerOwnsCosmeticAsset(player, 'font', nextFont);
  if (!isVipPlayer(player) && !isPersoPlayer(player) && !hasStaffRoleBenefits(player) && !ownsSelectedFont) {
    return res.status(403).json({ error: 'Achete un pack de polices ou active un rang premium.' });
  }
  const requestedFormats = String(format || '').split(',').map(value => value.trim().toLowerCase()).filter(Boolean);
  const allowedFormats = new Set(['bold', 'italic', 'underline', 'lowercase', 'uppercase']);
  if (requestedFormats.some(value => !allowedFormats.has(value))) return res.status(400).json({ error: 'Format de pseudo invalide.' });
  if (requestedFormats.includes('lowercase') && requestedFormats.includes('uppercase')) {
    return res.status(400).json({ error: 'Choisis soit minuscules, soit majuscules.' });
  }
  const nextFormat = [...new Set(requestedFormats)].join(',');
  const nextRgb = rgb === true || rgb === 1 || rgb === '1' || rgb === 'true';
  if (color && !nextColor) return res.status(400).json({ error: 'Couleur invalide.' });
  if (colorSecondary && !nextColorSecondary) return res.status(400).json({ error: 'Couleur secondaire invalide.' });
  if (nextFont && !PSEUDO_FONT_OPTIONS.has(nextFont)) return res.status(400).json({ error: 'Police invalide.' });
  if (nextFont && nextFont !== 'barlow' && !playerOwnsCosmeticAsset(player, 'font', nextFont)) {
    const pack = getCosmeticPackForAsset('font', nextFont);
    return res.status(403).json({ error: `Achete ${pack?.label || 'le pack de polices'} dans la boutique.` });
  }
  if (nextColorSecondary && !canUseGradientPlayer(player)) return res.status(403).json({ error: 'Le degrade du pseudo est reserve au VIP+ ou Perso.' });
  const remaining = getPseudoStyleRemainingMs(player);
  if (remaining > 0) return res.status(429).json({ error: `Style pseudo disponible dans ${formatCooldownHours(remaining)}.`, remainingMs: remaining });
  const changedAt = Date.now();
  pQ.updatePseudoStyle.run({
    id,
    color: nextColor,
    colorSecondary: nextColorSecondary,
    font: nextFont,
    format: nextFormat,
    rgb: nextRgb ? 1 : 0,
    changedAt,
  });
  progression.recordAction(id, 'profile_updates');
  res.json({ ok: true, color: nextColor, colorSecondary: nextColorSecondary, font: nextFont, format: nextFormat, rgb: nextRgb ? 1 : 0, changedAt });
});

app.patch('/api/players/:id/elo-curve-style', (req, res) => {
  const { color, colorSecondary = '', rgb = false, rgbSpeed = 1, rgbDirection = 'forward', token } = req.body;
  const id = Number(req.params.id);
  if (!token || validateSession(token) !== id) return res.status(403).json({ error: 'Non autorise.' });
  const player = pQ.getById.get(id);
  if (!player) return res.status(404).json({ error: 'Joueur introuvable.' });
  if (!isVipPlayer(player) && !isPersoPlayer(player) && !hasStaffRoleBenefits(player)) {
    return res.status(403).json({ error: 'Couleur de courbe reservee au VIP, VIP+ ou Perso.' });
  }
  const nextColor = normalizeHexColor(color);
  const nextColorSecondary = normalizeHexColor(colorSecondary);
  const nextRgb = rgb === true || rgb === 1 || rgb === '1' || rgb === 'true';
  const nextRgbSpeed = Math.max(0.25, Math.min(4, Number(rgbSpeed || 1) || 1));
  const nextRgbDirection = String(rgbDirection || 'forward') === 'reverse' ? 'reverse' : 'forward';
  if (color && !nextColor) return res.status(400).json({ error: 'Couleur invalide.' });
  if (colorSecondary && !nextColorSecondary) return res.status(400).json({ error: 'Couleur secondaire invalide.' });
  if (nextRgb && !isPersoPlayer(player) && !hasStaffRoleBenefits(player)) {
    return res.status(403).json({ error: 'Animation RGB reservee au role Perso.' });
  }
  const remaining = getEloCurveRemainingMs(player);
  if (remaining > 0) return res.status(429).json({ error: `Courbe ELO modifiable dans ${formatCooldownHours(remaining)}.`, remainingMs: remaining });
  const changedAt = Date.now();
  pQ.updateEloCurveStyle.run({
    id,
    color: nextColor,
    colorSecondary: nextColorSecondary,
    rgb: nextRgb ? 1 : 0,
    rgbSpeed: nextRgbSpeed,
    rgbDirection: nextRgbDirection,
    changedAt,
  });
  progression.recordAction(id, 'profile_updates');
  res.json({ ok: true, color: nextColor, colorSecondary: nextColorSecondary, rgb: nextRgb ? 1 : 0, rgbSpeed: nextRgbSpeed, rgbDirection: nextRgbDirection, changedAt });
});

app.patch('/api/players/:id/banner', (req, res) => {
  const { banner, token } = req.body;
  if (!token || validateSession(token) !== Number(req.params.id)) return res.status(403).json({ error: 'Erreur Lili (403) : Tu y as pas accès hihi !' });
  if (!banner || !banner.startsWith('data:image/')) return res.status(400).json({ error: 'Image invalide.' });
  const player = pQ.getById.get(Number(req.params.id));
  const isGif = /^data:image\/gif;base64,/i.test(banner);
  const isAdminTier = hasStaffRoleBenefits(player);
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
  WH.wlogBanner(_pBanner?.pseudo || req.params.id, req.params.id, Math.round(banner.length / 1024), banner);
  progression.recordAction(Number(req.params.id), 'profile_updates');
  res.json({ ok: true });
});

app.patch('/api/players/:id/avatar', (req, res) => {
  const { avatar, token } = req.body;
  if (!token || validateSession(token) !== Number(req.params.id)) return res.status(403).json({ error: 'Erreur Lili (403) : Tu y as pas accès hihi !' });
  if (!avatar || !avatar.startsWith('data:image/'))
    return res.status(400).json({ error: 'Image invalide.' });
  const player = pQ.getById.get(Number(req.params.id));
  const isGif = /^data:image\/gif;base64,/i.test(avatar);
  const isAdminTier = hasStaffRoleBenefits(player);
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
  WH.wlogAvatar(_pAvatar?.pseudo || req.params.id, req.params.id, Math.round(avatar.length / 1024), avatar);
  progression.recordAction(Number(req.params.id), 'profile_updates');
  res.json({ ok: true });
});

app.patch('/api/players/:id/token-emoji', (req, res) => {
  const { image, token } = req.body;
  const id = Number(req.params.id);
  if (!token || validateSession(token) !== id) return res.status(403).json({ error: 'Non autorise.' });
  const player = pQ.getById.get(id);
  if (!isVipPlusPlayer(player) && !hasStaffRoleBenefits(player)) return res.status(403).json({ error: 'Reserve au VIP+.' });
  if (!image || !/^data:image\/(png|jpeg|jpg|webp);base64,/i.test(image)) {
    return res.status(400).json({ error: 'Image invalide.' });
  }
  const remaining = getVipMediaRemainingMs(player);
  if (remaining > 0) {
    return res.status(429).json({ error: `Emoji perso disponible dans ${formatCooldownHours(remaining)}.` });
  }
  const approxBytes = Math.ceil((image.length - image.indexOf(',') - 1) * 3 / 4);
  if (!hasStaffRoleBenefits(player) && approxBytes > 1024 * 1024) {
    return res.status(413).json({ error: 'Emoji perso trop lourd (max 1MB).' });
  }
  pQ.updateTokenEmojiImage.run({ image, id });
  pQ.updateVipMediaChangedAt.run({ changedAt: Date.now(), id });
  progression.recordAction(id, 'profile_updates');
  res.json({ ok: true });
});

app.patch('/api/players/:id/avatar-decoration', (req, res) => {
  const { image, token } = req.body;
  const id = Number(req.params.id);
  if (!token || validateSession(token) !== id) return res.status(403).json({ error: 'Non autorise.' });
  const player = pQ.getById.get(id);
  const nextDecoration = String(image || '').trim();
  const isPreset = getAvatarDecorationPaths().includes(nextDecoration);
  const isInlineImage = /^data:image\/(png|jpeg|jpg|webp);base64,/i.test(nextDecoration);
  const ownsPreset = isPreset && playerOwnsCosmeticAsset(player, 'decoration', nextDecoration);
  if (!isVipPlusPlayer(player) && !hasStaffRoleBenefits(player) && nextDecoration && !ownsPreset) {
    return res.status(403).json({ error: 'Achete le pack de cette decoration dans la boutique.' });
  }
  if (nextDecoration && !isPreset && !isInlineImage) {
    return res.status(400).json({ error: 'Image invalide.' });
  }
  if (isPreset && !playerOwnsCosmeticAsset(player, 'decoration', nextDecoration)) {
    const pack = getCosmeticPackForAsset('decoration', nextDecoration);
    return res.status(403).json({ error: `Achete ${pack?.label || 'le pack de decorations'} dans la boutique.` });
  }
  const remaining = getAvatarDecorationRemainingMs(player);
  if (remaining > 0) {
    return res.status(429).json({ error: `Decoration avatar disponible dans ${formatCooldownHours(remaining)}.` });
  }
  const approxBytes = isInlineImage ? Math.ceil((nextDecoration.length - nextDecoration.indexOf(',') - 1) * 3 / 4) : 0;
  if (!hasStaffRoleBenefits(player) && isInlineImage && approxBytes > 1024 * 1024) {
    return res.status(413).json({ error: 'Decoration trop lourde (max 1MB).' });
  }
  pQ.updateAvatarDecoration.run({ image: nextDecoration, id });
  pQ.updateAvatarDecorationChangedAt.run({ changedAt: Date.now(), id });
  progression.recordAction(id, 'profile_updates');
  res.json({ ok: true });
});

app.patch('/api/players/:id/search-nameplate', (req, res) => {
  const { image, token } = req.body || {};
  const id = Number(req.params.id);
  if (!token || validateSession(token) !== id) return res.status(403).json({ error: 'Non autorise.' });
  const player = pQ.getById.get(id);
  if (!isVipPlusPlayer(player) && !hasStaffRoleBenefits(player)) {
    return res.status(403).json({ error: 'Plaque nominative reservee au VIP+.' });
  }
  const nextNameplate = String(image || '').trim();
  if (nextNameplate && !getSearchNameplatePaths().includes(nextNameplate)) {
    return res.status(400).json({ error: 'Plaque nominative invalide.' });
  }
  if (nextNameplate === String(player?.search_nameplate || '')) return res.json({ ok: true });
  const remaining = getSearchNameplateRemainingMs(player);
  if (remaining > 0) {
    return res.status(429).json({ error: `Plaque nominative disponible dans ${formatCooldownHours(remaining)}.` });
  }
  pQ.updateSearchNameplate.run({ image: nextNameplate, id });
  pQ.updateSearchNameplateChangedAt.run({ changedAt: Date.now(), id });
  progression.recordAction(id, 'profile_updates');
  res.json({ ok: true, search_nameplate: nextNameplate });
});

app.patch('/api/players/:id/profile-banner', (req, res) => {
  const { image, token } = req.body;
  const id = Number(req.params.id);
  if (!token || validateSession(token) !== id) return res.status(403).json({ error: 'Non autorise.' });
  const player = pQ.getById.get(id);
  if (!isPersoPlayer(player) && !hasStaffRoleBenefits(player)) return res.status(403).json({ error: 'Reserve au pack Perso.' });
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
  progression.recordAction(id, 'profile_updates');
  res.json({ ok: true });
});

function extractLavalinkTracks(payload) {
  if (!payload) return [];
  if (Array.isArray(payload.tracks)) return payload.tracks;
  if (Array.isArray(payload.data)) return payload.data;
  if (Array.isArray(payload.data?.tracks)) return payload.data.tracks;
  if (payload.data?.info) return [payload.data];
  return [];
}

function serializeLavalinkTrack(track) {
  const info = track?.info || track || {};
  const uri = String(info.uri || info.url || '').trim();
  const identifier = String(info.identifier || '').trim()
    || (uri.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/))([a-zA-Z0-9_-]{6,20})/)?.[1] || '');
  if (!identifier) return null;
  return {
    id: identifier,
    value: `youtube:${identifier}`,
    title: String(info.title || 'Titre YouTube').slice(0, 140),
    author: String(info.author || info.uploader || 'YouTube').slice(0, 90),
    durationMs: Number(info.length || info.duration || 0) || 0,
    uri: uri || `https://www.youtube.com/watch?v=${identifier}`,
    artworkUrl: String(info.artworkUrl || info.thumbnail || ''),
  };
}

function lavalinkTrackCandidates(track) {
  const info = track?.info || track || {};
  const pluginInfo = track?.pluginInfo || {};
  const candidates = [
    pluginInfo.previewUrl,
    pluginInfo.preview_url,
    pluginInfo.streamUrl,
    pluginInfo.stream_url,
    pluginInfo.audioUrl,
    pluginInfo.audio_url,
    pluginInfo.url,
    info.streamUrl,
    info.audioUrl,
    info.previewUrl,
    info.uri,
  ].map(value => String(value || '').trim()).filter(Boolean);
  return [...new Set(candidates)].filter(url => /^https?:\/\//i.test(url));
}

async function loadLavalinkTrack(identifier) {
  let response = await fetch(`${LAVALINK_URL}/v4/loadtracks?identifier=${encodeURIComponent(identifier)}`, {
    headers: { Authorization: LAVALINK_PASSWORD, Accept: 'application/json' },
    signal: AbortSignal.timeout(8000),
  });
  if (response.status === 404) {
    response = await fetch(`${LAVALINK_URL}/loadtracks?identifier=${encodeURIComponent(identifier)}`, {
      headers: { Authorization: LAVALINK_PASSWORD, Accept: 'application/json' },
      signal: AbortSignal.timeout(8000),
    });
  }
  const text = await response.text();
  let payload = {};
  try { payload = text ? JSON.parse(text) : {}; } catch(e) {}
  if (!response.ok) {
    const error = new Error(`Lavalink indisponible (${response.status}).`);
    error.status = response.status;
    throw error;
  }
  return extractLavalinkTracks(payload)[0] || null;
}

function runYtdlp(args, timeoutMs = 20000) {
  const candidates = getYtdlpCandidates();
  let index = 0;
  return new Promise((resolve, reject) => {
    const tryNext = lastError => {
      const bin = candidates[index++];
      if (!bin) return reject(lastError || new Error('yt-dlp introuvable.'));
      const child = spawn(bin, args, { windowsHide: true });
      let stdout = '';
      let stderr = '';
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        reject(new Error('yt-dlp timeout.'));
      }, timeoutMs);
      child.stdout.on('data', chunk => { stdout += chunk.toString('utf8'); });
      child.stderr.on('data', chunk => { stderr += chunk.toString('utf8'); });
      child.on('error', error => {
        clearTimeout(timer);
        if (error?.code === 'ENOENT') return tryNext(error);
        reject(new Error(`yt-dlp indisponible (${bin}): ${error.message}`));
      });
      child.on('close', code => {
        clearTimeout(timer);
        if (code === 0) return resolve({ bin, stdout, stderr });
        reject(new Error(`yt-dlp erreur ${code} (${bin}): ${stderr.slice(0, 240)}`));
      });
    };
    tryNext();
  });
}

function resolveYoutubeAudioUrl(videoId) {
  const cached = youtubeAudioUrlCache.get(videoId);
  if (cached && cached.expiresAt > Date.now()) return Promise.resolve(cached.url);
  const url = `https://www.youtube.com/watch?v=${videoId}`;
  return runYtdlp([
      '--no-playlist',
      '--no-warnings',
      '--force-ipv4',
      ...(YTDLP_NO_CHECK_CERTIFICATES ? ['--no-check-certificates'] : []),
      '-f', YTDLP_FORMAT,
      '-g',
      url,
    ])
    .then(({ stdout }) => {
      const directUrl = stdout
        .split(/\r?\n/)
        .map(line => line.trim())
        .find(line => /^https?:\/\//i.test(line));
      if (!directUrl) throw new Error('yt-dlp n a pas retourne d URL audio.');
      youtubeAudioUrlCache.set(videoId, { url: directUrl, expiresAt: Date.now() + 10 * 60 * 1000 });
      return directUrl;
    });
}

async function proxyAudioUrl(req, res, url) {
  if (/^https?:\/\/[^/]*googlevideo\.com\/videoplayback/i.test(url)) {
    res.setHeader('Cache-Control', 'private, max-age=300');
    return res.redirect(302, url);
  }
  const upstream = await fetch(url, {
    headers: {
      'User-Agent': req.get('user-agent') || 'Mozilla/5.0',
      Range: req.get('range') || 'bytes=0-',
    },
    signal: AbortSignal.timeout(15000),
  });
  const contentType = upstream.headers.get('content-type') || 'audio/mp4';
  if (!upstream.ok || !upstream.body) {
    throw new Error(`Flux audio indisponible (${upstream.status}).`);
  }
  res.status(upstream.status === 206 ? 206 : 200);
  res.setHeader('Content-Type', contentType);
  res.setHeader('Cache-Control', 'private, max-age=300');
  const contentLength = upstream.headers.get('content-length');
  const contentRange = upstream.headers.get('content-range');
  const acceptRanges = upstream.headers.get('accept-ranges');
  if (contentLength) res.setHeader('Content-Length', contentLength);
  if (contentRange) res.setHeader('Content-Range', contentRange);
  if (acceptRanges) res.setHeader('Accept-Ranges', acceptRanges);
  return Readable.fromWeb(upstream.body).pipe(res);
}

function logYtdlpStatus() {
  runYtdlp(['--version'], 8000)
    .then(({ bin, stdout }) => {
      console.log(`[QUEUE MUSIC] yt-dlp OK (${bin}) version ${stdout.trim() || 'inconnue'}`);
    })
    .catch(error => {
      console.warn(`[QUEUE MUSIC] yt-dlp introuvable. Chemins testes: ${getYtdlpCandidates().join(', ')}. ${error.message}`);
    });
}

app.get('/api/queue-music/search', async (req, res) => {
  const token = String(req.headers['x-session-token'] || req.query.token || '');
  const playerId = token ? validateSession(token) : null;
  if (!playerId) return res.status(401).json({ error: 'Non authentifie.' });
  const player = pQ.getById.get(playerId);
  if (!isPersoPlayer(player) && !hasStaffRoleBenefits(player)) {
    return res.status(403).json({ error: 'Reserve au grade Perso.' });
  }
  const q = String(req.query.q || '').trim();
  if (q.length < 2) return res.json({ ok: true, tracks: [] });
  if (!LAVALINK_URL || !LAVALINK_PASSWORD) {
    return res.status(503).json({ error: 'Lavalink non configure.' });
  }
  try {
    const response = await fetch(`${LAVALINK_URL}/v4/loadtracks?identifier=${encodeURIComponent(`ytsearch:${q}`)}`, {
      headers: { Authorization: LAVALINK_PASSWORD, Accept: 'application/json' },
      signal: AbortSignal.timeout(8000),
    }).catch(error => ({ error }));
    if (response.error) throw response.error;
    let payload = {};
    if (response.status === 404) {
      const legacy = await fetch(`${LAVALINK_URL}/loadtracks?identifier=${encodeURIComponent(`ytsearch:${q}`)}`, {
        headers: { Authorization: LAVALINK_PASSWORD, Accept: 'application/json' },
        signal: AbortSignal.timeout(8000),
      });
      const text = await legacy.text();
      try { payload = text ? JSON.parse(text) : {}; } catch(e) {}
      if (!legacy.ok) return res.status(502).json({ error: `Lavalink indisponible (${legacy.status}).` });
    } else {
      const text = await response.text();
      try { payload = text ? JSON.parse(text) : {}; } catch(e) {}
      if (!response.ok) return res.status(502).json({ error: `Lavalink indisponible (${response.status}).` });
    }
    const tracks = extractLavalinkTracks(payload)
      .map(serializeLavalinkTrack)
      .filter(Boolean)
      .slice(0, 8);
    res.json({ ok: true, tracks });
  } catch (error) {
    res.status(502).json({ error: 'Recherche Lavalink impossible.' });
  }
});

app.get('/api/queue-music/lavalink-stream/:videoId', async (req, res) => {
  const videoId = String(req.params.videoId || '').trim();
  if (!/^[a-zA-Z0-9_-]{6,20}$/.test(videoId)) {
    return res.status(400).json({ error: 'ID YouTube invalide.' });
  }
  if (!LAVALINK_URL || !LAVALINK_PASSWORD) {
    try {
      const audioUrl = await resolveYoutubeAudioUrl(videoId);
      return proxyAudioUrl(req, res, audioUrl);
    } catch (error) {
      return res.status(502).json({ error: error?.message || 'Extraction audio impossible.' });
    }
  }
  try {
    try {
      const audioUrl = await resolveYoutubeAudioUrl(videoId);
      return proxyAudioUrl(req, res, audioUrl);
    } catch (extractError) {
      console.warn('[QUEUE MUSIC] yt-dlp fallback Lavalink:', extractError?.message || extractError);
    }
    const track = await loadLavalinkTrack(`https://www.youtube.com/watch?v=${videoId}`);
    const candidates = lavalinkTrackCandidates(track)
      .filter(url => !/youtube\.com\/watch|youtu\.be\//i.test(url));
    for (const url of candidates) {
      try {
        return proxyAudioUrl(req, res, url);
      } catch {}
    }
    const info = track?.info || {};
    res.status(502).json({
      error: 'Lavalink a resolu la piste, mais aucun flux audio web direct n est expose.',
      title: String(info.title || ''),
      sourceName: String(info.sourceName || ''),
      lavalinkResolved: !!track,
      hint: 'Le Lavalink standard charge une track pour un player Discord, pas un fichier audio HTTP pour navigateur.',
    });
  } catch (error) {
    res.status(502).json({ error: error?.message || 'Lecture Lavalink impossible.' });
  }
});

app.patch('/api/players/:id/queue-music', (req, res) => {
  const { music, token } = req.body;
  const id = Number(req.params.id);
  if (!token || validateSession(token) !== id) return res.status(403).json({ error: 'Non autorise.' });
  const player = pQ.getById.get(id);
  if (!isPersoPlayer(player) && !hasStaffRoleBenefits(player)) {
    return res.status(403).json({ error: 'Reserve au grade Perso.' });
  }
  const nextMusic = String(music || '').trim();
  const allowed = getQueueMusicPaths().map(entry => entry.src);
  const isYouTube = /^youtube:[a-zA-Z0-9_-]{6,20}$/.test(nextMusic);
  const isAudioUrl = /^audio:https:\/\/[^\s"'<>]+$/i.test(nextMusic);
  const isLocalCustom = nextMusic === 'local:custom';
  if (nextMusic && !allowed.includes(nextMusic) && !isYouTube && !isAudioUrl && !isLocalCustom) {
    return res.status(400).json({ error: 'Musique invalide.' });
  }
  pQ.updateQueueMusic.run({ music: nextMusic, id });
  progression.recordAction(id, 'profile_updates');
  res.json({ ok: true, queue_music: nextMusic });
});

app.patch('/api/players/:id/custom-cursor', (req, res) => {
  const id = Number(req.params.id);
  const token = String(req.body?.token || '');
  if (!token || validateSession(token) !== id) return res.status(403).json({ error: 'Non autorise.' });
  const player = pQ.getById.get(id);
  if (!isPersoPlayer(player) && !hasStaffRoleBenefits(player)) {
    return res.status(403).json({ error: 'Le curseur personnalise est reserve au grade Perso.' });
  }
  const cursor = String(req.body?.cursor || '').trim();
  if (cursor) {
    if (!/^data:image\/png;base64,[a-z0-9+/=]+$/i.test(cursor)) {
      return res.status(400).json({ error: 'Curseur invalide : PNG 32x32 requis.' });
    }
    const bytes = Buffer.from(cursor.slice(cursor.indexOf(',') + 1), 'base64');
    if (bytes.length > 32 * 1024) return res.status(413).json({ error: 'Curseur trop lourd (max 32 Ko).' });
    const isPng = bytes.length >= 24
      && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
    const width = isPng ? bytes.readUInt32BE(16) : 0;
    const height = isPng ? bytes.readUInt32BE(20) : 0;
    if (width !== 32 || height !== 32) {
      return res.status(400).json({ error: 'Le curseur doit mesurer exactement 32x32 pixels.' });
    }
  }
  pQ.updateCustomCursor.run({ cursor, id });
  progression.recordAction(id, 'profile_updates');
  res.json({ ok: true, custom_cursor: cursor });
});

function normalizeWallpaperDataUrl(value) {
  const input = String(value || '').trim();
  if (!input) return '';
  if (!/^data:image\/(jpeg|jpg|png|webp);base64,[a-z0-9+/=]+$/i.test(input)) {
    const error = new Error('Fond invalide : image PNG, JPG ou WebP requise.');
    error.status = 400;
    throw error;
  }
  const bytes = getDataUrlBytes(input);
  if (bytes > PROFILE_WALLPAPER_MAX_BYTES) {
    const error = new Error('Fond trop lourd apres compression (max 650 Ko).');
    error.status = 413;
    throw error;
  }
  return input;
}

function normalizeWallpaperNumber(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

app.patch('/api/players/:id/wallpaper', (req, res) => {
  const id = Number(req.params.id);
  const token = String(req.body?.token || '');
  if (!token || validateSession(token) !== id) return res.status(403).json({ error: 'Non autorise.' });
  try {
    const desktop = normalizeWallpaperDataUrl(req.body?.desktopWallpaper);
    const mobile = normalizeWallpaperDataUrl(req.body?.mobileWallpaper);
    const opacity = normalizeWallpaperNumber(req.body?.opacity, 0.48, 0.08, 1);
    const dim = normalizeWallpaperNumber(req.body?.dim, 0.28, 0, 0.85);
    pQ.updateProfileWallpaper.run({ desktop, mobile, opacity, dim, id });
    progression.recordAction(id, 'profile_updates');
    res.json({
      ok: true,
      profile_wallpaper_desktop: desktop,
      profile_wallpaper_mobile: mobile,
      profile_wallpaper_opacity: opacity,
      profile_wallpaper_dim: dim,
    });
  } catch (error) {
    res.status(error.status || 400).json({ error: error.message || 'Fond invalide.' });
  }
});

// Autocomplete pseudo AAaAa AaaAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAA min 3 chars, max 8 rAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAAsultats, exclu bots et supprimAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAAs
app.get('/api/players/search', (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    const includeBots = String(req.query.includeBots || '') === '1';
    if (q.length < 3) return res.json([]);
    // Autoriser alphanum + _ + - + . (suffisant, pas de regex bloquante)
    if (q.length > 20) return res.json([]);
    const rows = db.prepare(`
      SELECT id, pseudo, elo, avatar, color, profile_banner, search_nameplate,
             pseudo_font, pseudo_format, pseudo_color, pseudo_color_secondary, pseudo_rgb, is_bot
      FROM players
      WHERE pseudo LIKE ? COLLATE NOCASE
        AND deleted = 0
        AND is_guest = 0
        AND (? = 1 OR is_bot = 0)
      ORDER BY elo DESC LIMIT 3
    `).all(q.replace(/%/g, '') + '%', includeBots ? 1 : 0);
    res.json(rows.map(p => ({
      id: p.id, pseudo: p.pseudo, elo: p.elo, avatar: p.avatar, color: p.color,
      profile_banner: p.profile_banner || '', search_nameplate: p.search_nameplate || '',
      pseudo_font: p.pseudo_font || '', pseudo_format: p.pseudo_format || '',
      pseudo_color: p.pseudo_color || '', pseudo_color_secondary: p.pseudo_color_secondary || '',
      pseudo_rgb: Number(p.pseudo_rgb || 0), is_bot: Number(p.is_bot || 0),
    })));
  } catch(e) {
    console.error('[search]', e.message);
    res.json([]);
  }
});

function cleanClanPayload(body = {}) {
  const name = String(body.name || '').trim().replace(/\s+/g, ' ').slice(0, 24);
  const tag = String(body.tag || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
  const blason = String(body.blason || '🛡️').trim().slice(0, 8) || '🛡️';
  const color = /^#[0-9a-fA-F]{6}$/.test(String(body.color || '')) ? String(body.color).toUpperCase() : '#85EBFF';
  const description = String(body.description || '').trim().replace(/\s+/g, ' ').slice(0, 120);
  return { name, tag, blason, color, description };
}

function getClanSession(req) {
  const token = String(req.body?.token || req.query?.token || req.headers['x-token'] || req.headers['x-session-token'] || '');
  const playerId = validateSession(token);
  if (!playerId || isAnonymousPlayerId(playerId)) return null;
  const player = pQ.getById.get(playerId);
  if (!player || player.deleted) return null;
  return { token, playerId, player };
}

function canManageClan(player, clan, member = null) {
  if (!player || !clan) return false;
  if (isAdminPlayer(player)) return true;
  if (Number(clan.owner_id || 0) === Number(player.id || 0)) return true;
  return member && String(member.role || '') === 'officer';
}

function serializeClanStats(clanId) {
  const stats = cQ.stats.get(Number(clanId)) || {};
  return {
    member_count: Number(stats.member_count || 0),
    avg_elo: Number(stats.avg_elo || 0),
    max_elo: Number(stats.max_elo || 0),
    min_elo: Number(stats.min_elo || 0),
    wins: Number(stats.wins || 0),
    losses: Number(stats.losses || 0),
    draws: Number(stats.draws || 0),
  };
}

function notifyClanMembers(clanId, reason) {
  try {
    cQ.members.all(Number(clanId)).forEach(member => notifyPlayerProfileChanged(Number(member.player_id), reason));
  } catch (error) {
    console.warn('[CLAN] notify:', error.message);
  }
}

function serializeClanMessage(row, player = null) {
  if (!row) return null;
  return {
    id: Number(row.id || 0),
    clan_id: Number(row.clan_id || 0),
    player_id: Number(row.player_id || player?.id || 0),
    pseudo: row.pseudo || player?.pseudo || 'Membre',
    avatar: row.avatar || player?.avatar || '',
    color: row.color || player?.color || '#85EBFF',
    message: String(row.message || ''),
    created_at: Number(row.created_at || 0),
  };
}

function normalizeCouponCode(code = '') {
  return String(code || '').trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 24);
}

function getUsableCoupon(code, playerId) {
  const normalized = normalizeCouponCode(code);
  if (!normalized) return null;
  const coupon = db.prepare(`SELECT * FROM coupons WHERE code = ?`).get(normalized);
  if (!coupon) return null;
  if (Number(coupon.expires_at || 0) && Number(coupon.expires_at || 0) < Date.now()) return null;
  if (Number(coupon.max_uses || 0) > 0 && Number(coupon.uses || 0) >= Number(coupon.max_uses || 0)) return null;
  if (db.prepare(`SELECT 1 FROM coupon_uses WHERE code = ? AND player_id = ?`).get(normalized, playerId)) return null;
  return coupon;
}

function applyCouponPrice(price, coupon) {
  if (!coupon) return Number(price || 0);
  const value = Math.max(0, Number(coupon.value || 0));
  if (String(coupon.type || '') === 'flat') return Math.max(0, Number(price || 0) - value);
  return Math.max(0, Math.ceil(Number(price || 0) * (1 - Math.min(95, value) / 100)));
}

app.post('/api/shop/coupon/validate', (req, res) => {
  const token = String(req.body?.token || '');
  const playerId = validateSession(token);
  if (!playerId) return res.status(401).json({ error: 'Connecte-toi pour valider un code promo.' });
  const code = normalizeCouponCode(req.body?.coupon);
  if (!code) return res.status(400).json({ error: 'Code promo manquant.' });
  const coupon = getUsableCoupon(code, playerId);
  if (!coupon) return res.status(400).json({ error: 'Code invalide, expire ou deja utilise.' });
  res.json({
    ok: true,
    coupon: {
      code: coupon.code,
      type: coupon.type,
      value: Number(coupon.value || 0),
      expiresAt: Number(coupon.expires_at || 0) || null,
      remainingUses: Math.max(0, Number(coupon.max_uses || 0) - Number(coupon.uses || 0)),
    },
  });
});

function serializeClan(row, withMembers = false) {
  if (!row) return null;
  const clan = {
    id: Number(row.id),
    name: row.name,
    tag: row.tag,
    blason: row.blason || '🛡️',
    color: row.color || '#85EBFF',
    description: row.description || '',
    owner_id: Number(row.owner_id || 0),
    owner_pseudo: row.owner_pseudo || '',
    member_role: row.member_role || '',
    member_count: Number(row.member_count || 0),
    avg_elo: Number(row.avg_elo || 0),
    max_elo: Number(row.max_elo || 0),
    min_elo: Number(row.min_elo || 0),
    wins: Number(row.wins || 0),
    losses: Number(row.losses || 0),
    draws: Number(row.draws || 0),
    joined_at: Number(row.joined_at || 0) || null,
    created_at: Number(row.created_at || 0),
  };
  const stats = serializeClanStats(clan.id);
  clan.member_count = Math.max(clan.member_count, stats.member_count);
  clan.avg_elo = clan.avg_elo || stats.avg_elo;
  clan.max_elo = clan.max_elo || stats.max_elo;
  clan.min_elo = clan.min_elo || stats.min_elo;
  clan.wins = clan.wins || stats.wins;
  clan.losses = clan.losses || stats.losses;
  clan.draws = clan.draws || stats.draws;
  if (withMembers) clan.members = cQ.members.all(clan.id).map(member => ({ ...sanitize(member), clan_role: member.role, joined_at: Number(member.joined_at || 0) }));
  return clan;
}

app.get('/api/clans', (_, res) => {
  try {
    res.json({ clans: cQ.list.all(80).map(row => serializeClan(row)) });
  } catch (error) {
    console.error('[CLAN] list:', error.message);
    res.status(500).json({ error: 'Impossible de charger les clans.' });
  }
});

app.get('/api/clans/leaderboard', (_, res) => {
  try {
    res.json({ clans: cQ.leaderboard.all(50).map((row, index) => ({ ...serializeClan(row), rank: index + 1 })) });
  } catch (error) {
    console.error('[CLAN] leaderboard:', error.message);
    res.status(500).json({ error: 'Impossible de charger le classement clans.' });
  }
});

app.get('/api/players/:id/clan', (req, res) => {
  const playerId = Number(req.params.id || 0);
  const clan = cQ.getForPlayer.get(playerId);
  res.json({ clan: serializeClan(clan, true) });
});

app.get('/api/clans/:id', (req, res) => {
  try {
    const clanId = Number(req.params.id || 0);
    const clan = cQ.getById.get(clanId);
    if (!clan) return res.status(404).json({ error: 'Clan introuvable.' });
    const session = getClanSession(req);
    const member = session ? cQ.member.get(clanId, session.playerId) : null;
    const owner = pQ.getById.get(Number(clan.owner_id || 0));
    res.json({
      clan: {
        ...serializeClan({ ...clan, owner_pseudo: owner?.pseudo || '' }, true),
        viewer_role: member?.role || '',
        can_manage: !!(session && canManageClan(session.player, clan, member)),
      },
    });
  } catch (error) {
    console.error('[CLAN] get:', error.message);
    res.status(500).json({ error: 'Impossible de charger le clan.' });
  }
});

app.post('/api/clans', security.routeGuard('clan'), (req, res) => {
  try {
    const token = String(req.body?.token || req.headers['x-token'] || req.headers['x-session-token'] || '');
    const playerId = validateSession(token);
    if (!playerId || isAnonymousPlayerId(playerId)) return res.status(401).json({ error: 'Connecte-toi pour créer un clan.' });
    const player = pQ.getById.get(playerId);
    if (!player || player.deleted) return res.status(404).json({ error: 'Joueur introuvable.' });
    if (!isPersoPlayer(player) && !hasStaffRoleBenefits(player)) return res.status(403).json({ error: 'Seuls les Perso peuvent créer un clan.' });
    if (cQ.getForPlayer.get(playerId)) return res.status(409).json({ error: 'Tu es déjà dans un clan.' });

    const last = cQ.lastCreatedBy.get(playerId);
    const cooldownMs = 30 * 24 * 60 * 60 * 1000;
    if (!hasStaffRoleBenefits(player) && last && Date.now() - Number(last.created_at || 0) < cooldownMs) {
      const leftDays = Math.ceil((cooldownMs - (Date.now() - Number(last.created_at || 0))) / 86400000);
      return res.status(429).json({ error: `Tu pourras recréer un clan dans ${leftDays} jour(s).` });
    }

    const clean = cleanClanPayload(req.body);
    if (clean.name.length < 3) return res.status(400).json({ error: 'Nom de clan invalide (3 caractères minimum).' });
    if (clean.tag.length < 2) return res.status(400).json({ error: 'Tag invalide (2 à 6 lettres/chiffres).' });
    if (cQ.getByName.get(clean.name)) return res.status(409).json({ error: 'Ce nom de clan existe déjà.' });
    if (cQ.getByTag.get(clean.tag)) return res.status(409).json({ error: 'Ce tag de clan existe déjà.' });

    const now = Date.now();
    const tx = db.transaction(() => {
      const info = cQ.create.run({ ...clean, owner_id: playerId, created_at: now, updated_at: now });
      cQ.addMember.run({ clan_id: info.lastInsertRowid, player_id: playerId, role: 'owner', joined_at: now });
      return Number(info.lastInsertRowid);
    });
    const clanId = tx();
    const createdClan = serializeClan(cQ.getForPlayer.get(playerId), true);
    WH.wlogClan('create', createdClan, player);
    notifyPlayerProfileChanged(playerId, 'Clan créé');
    res.json({ ok: true, clan: createdClan, clanId });
  } catch (error) {
    console.error('[CLAN] create:', error.message);
    res.status(500).json({ error: 'Impossible de créer le clan.' });
  }
});

app.patch('/api/clans/:id', security.routeGuard('clan'), (req, res) => {
  try {
    const session = getClanSession(req);
    if (!session) return res.status(401).json({ error: 'Session invalide.' });
    const clanId = Number(req.params.id || 0);
    const clan = cQ.getById.get(clanId);
    if (!clan) return res.status(404).json({ error: 'Clan introuvable.' });
    const member = cQ.member.get(clanId, session.playerId);
    if (!canManageClan(session.player, clan, member)) return res.status(403).json({ error: 'Gestion reservee au fondateur du clan.' });

    const clean = cleanClanPayload(req.body);
    if (clean.name.length < 3) return res.status(400).json({ error: 'Nom de clan invalide (3 caracteres minimum).' });
    if (clean.tag.length < 2) return res.status(400).json({ error: 'Tag invalide (2 a 6 lettres/chiffres).' });
    const sameName = cQ.getByName.get(clean.name);
    if (sameName && Number(sameName.id) !== clanId) return res.status(409).json({ error: 'Ce nom de clan existe deja.' });
    const sameTag = cQ.getByTag.get(clean.tag);
    if (sameTag && Number(sameTag.id) !== clanId) return res.status(409).json({ error: 'Ce tag de clan existe deja.' });

    cQ.update.run({ ...clean, id: clanId, updated_at: Date.now() });
    notifyClanMembers(clanId, 'Clan modifie');
    const fresh = cQ.getById.get(clanId);
    const owner = pQ.getById.get(Number(fresh.owner_id || 0));
    const serialized = serializeClan({ ...fresh, owner_pseudo: owner?.pseudo || '' }, true);
    WH.wlogClan('update', serialized, session.player);
    res.json({ ok: true, clan: serialized });
  } catch (error) {
    console.error('[CLAN] update:', error.message);
    res.status(500).json({ error: 'Impossible de modifier le clan.' });
  }
});

app.delete('/api/clans/:id', security.routeGuard('clan'), (req, res) => {
  try {
    const session = getClanSession(req);
    if (!session) return res.status(401).json({ error: 'Session invalide.' });
    const clanId = Number(req.params.id || 0);
    const clan = cQ.getById.get(clanId);
    if (!clan) return res.status(404).json({ error: 'Clan introuvable.' });
    if (!isAdminPlayer(session.player) && Number(clan.owner_id || 0) !== session.playerId) {
      return res.status(403).json({ error: 'Suppression reservee au fondateur.' });
    }
    const members = cQ.members.all(clanId).map(member => Number(member.player_id));
    const tx = db.transaction(() => {
      cQ.deleteMessages.run(clanId);
      members.forEach(playerId => cQ.removeMemberFromClan.run(clanId, playerId));
      cQ.delete.run(clanId);
    });
    tx();
    WH.wlogClan('delete', serializeClan(clan), session.player, [['Membres impactes', String(members.length), true]]);
    members.forEach(playerId => notifyPlayerProfileChanged(playerId, 'Clan supprime'));
    res.json({ ok: true });
  } catch (error) {
    console.error('[CLAN] delete:', error.message);
    res.status(500).json({ error: 'Impossible de supprimer le clan.' });
  }
});

app.get('/api/clans/:id/messages', (req, res) => {
  try {
    const clanId = Number(req.params.id || 0);
    const clan = cQ.getById.get(clanId);
    if (!clan) return res.status(404).json({ error: 'Clan introuvable.' });
    const session = getClanSession(req);
    if (!session || !cQ.member.get(clanId, session.playerId)) return res.status(403).json({ error: 'Tchat reserve aux membres du clan.' });
    const messages = cQ.messages.all(clanId, 80).reverse().map(row => serializeClanMessage(row));
    res.json({ messages });
  } catch (error) {
    console.error('[CLAN] messages:', error.message);
    res.status(500).json({ error: 'Impossible de charger le tchat.' });
  }
});

app.post('/api/clans/:id/messages', security.routeGuard('clan-chat'), (req, res) => {
  try {
    const session = getClanSession(req);
    if (!session) return res.status(401).json({ error: 'Session invalide.' });
    const clanId = Number(req.params.id || 0);
    const clan = cQ.getById.get(clanId);
    if (!clan) return res.status(404).json({ error: 'Clan introuvable.' });
    if (!cQ.member.get(clanId, session.playerId)) return res.status(403).json({ error: 'Tchat reserve aux membres du clan.' });
    const message = String(req.body?.message || '').trim().replace(/\s+/g, ' ').slice(0, 300);
    if (message.length < 1) return res.status(400).json({ error: 'Message vide.' });
    const createdAt = Date.now();
    const info = cQ.addMessage.run({ clan_id: clanId, player_id: session.playerId, message, created_at: createdAt });
    const payload = serializeClanMessage({
      id: info.lastInsertRowid,
      clan_id: clanId,
      player_id: session.playerId,
      pseudo: session.player.pseudo,
      avatar: session.player.avatar,
      color: session.player.color,
      message,
      created_at: createdAt,
    }, session.player);
    io.to(`clan:${clanId}`).emit('clan_message', payload);
    res.json({ ok: true, message: payload });
  } catch (error) {
    console.error('[CLAN] add message:', error.message);
    res.status(500).json({ error: 'Impossible d envoyer le message.' });
  }
});

app.post('/api/clans/:id/members/:playerId/remove', security.routeGuard('clan'), (req, res) => {
  try {
    const session = getClanSession(req);
    if (!session) return res.status(401).json({ error: 'Session invalide.' });
    const clanId = Number(req.params.id || 0);
    const targetId = Number(req.params.playerId || 0);
    const clan = cQ.getById.get(clanId);
    if (!clan) return res.status(404).json({ error: 'Clan introuvable.' });
    const member = cQ.member.get(clanId, session.playerId);
    if (!canManageClan(session.player, clan, member)) return res.status(403).json({ error: 'Gestion reservee au fondateur du clan.' });
    if (Number(clan.owner_id || 0) === targetId) return res.status(409).json({ error: 'Impossible de retirer le fondateur.' });
    cQ.removeMemberFromClan.run(clanId, targetId);
    const target = pQ.getById.get(targetId);
    WH.wlogClan('member', serializeClan(clan), session.player, [
      ['Action', 'Retrait membre', true],
      ['Membre', target ? `${target.pseudo} (#${target.id})` : `#${targetId}`, true],
    ]);
    notifyPlayerProfileChanged(targetId, 'Retire du clan');
    res.json({ ok: true });
  } catch (error) {
    console.error('[CLAN] remove member:', error.message);
    res.status(500).json({ error: 'Impossible de retirer ce membre.' });
  }
});

app.post('/api/clans/:id/members/:playerId/role', security.routeGuard('clan'), (req, res) => {
  try {
    const session = getClanSession(req);
    if (!session) return res.status(401).json({ error: 'Session invalide.' });
    const clanId = Number(req.params.id || 0);
    const targetId = Number(req.params.playerId || 0);
    const clan = cQ.getById.get(clanId);
    if (!clan) return res.status(404).json({ error: 'Clan introuvable.' });
    if (!isAdminPlayer(session.player) && Number(clan.owner_id || 0) !== session.playerId) return res.status(403).json({ error: 'Role reserve au fondateur.' });
    if (Number(clan.owner_id || 0) === targetId) return res.status(409).json({ error: 'Le fondateur reste owner.' });
    const role = String(req.body?.role || 'member') === 'officer' ? 'officer' : 'member';
    cQ.setMemberRole.run({ clan_id: clanId, player_id: targetId, role });
    const target = pQ.getById.get(targetId);
    WH.wlogClan('member', serializeClan(clan), session.player, [
      ['Action', 'Changement role', true],
      ['Membre', target ? `${target.pseudo} (#${target.id})` : `#${targetId}`, true],
      ['Nouveau role', role, true],
    ]);
    notifyPlayerProfileChanged(targetId, `Role clan modifie : ${role}`);
    res.json({ ok: true });
  } catch (error) {
    console.error('[CLAN] member role:', error.message);
    res.status(500).json({ error: 'Impossible de changer le role.' });
  }
});

app.post('/api/clans/:id/join', security.routeGuard('clan'), (req, res) => {
  try {
    const token = String(req.body?.token || req.headers['x-token'] || req.headers['x-session-token'] || '');
    const playerId = validateSession(token);
    if (!playerId || isAnonymousPlayerId(playerId)) return res.status(401).json({ error: 'Connecte-toi pour rejoindre un clan.' });
    const player = pQ.getById.get(playerId);
    if (!player || player.deleted) return res.status(404).json({ error: 'Joueur introuvable.' });
    const clanId = Number(req.params.id || 0);
    const clan = cQ.getById.get(clanId);
    if (!clan) return res.status(404).json({ error: 'Clan introuvable.' });
    if (cQ.getForPlayer.get(playerId)) return res.status(409).json({ error: 'Tu es déjà dans un clan.' });
    cQ.addMember.run({ clan_id: clanId, player_id: playerId, role: 'member', joined_at: Date.now() });
    WH.wlogClan('join', serializeClan(cQ.getForPlayer.get(playerId)), player);
    notifyPlayerProfileChanged(playerId, 'Clan rejoint');
    res.json({ ok: true, clan: serializeClan(cQ.getForPlayer.get(playerId), true) });
  } catch (error) {
    console.error('[CLAN] join:', error.message);
    res.status(500).json({ error: 'Impossible de rejoindre le clan.' });
  }
});

app.post('/api/clans/leave', security.routeGuard('clan'), (req, res) => {
  try {
    const token = String(req.body?.token || req.headers['x-token'] || req.headers['x-session-token'] || '');
    const playerId = validateSession(token);
    if (!playerId || isAnonymousPlayerId(playerId)) return res.status(401).json({ error: 'Connecte-toi pour quitter un clan.' });
    const clan = cQ.getForPlayer.get(playerId);
    if (!clan) return res.status(404).json({ error: 'Tu n es dans aucun clan.' });
    if (Number(clan.owner_id) === Number(playerId)) return res.status(409).json({ error: 'Le créateur ne peut pas quitter son clan pour le moment.' });
    cQ.removeMember.run(playerId);
    const player = pQ.getById.get(playerId);
    WH.wlogClan('leave', serializeClan(clan), player || { id: playerId, pseudo: `#${playerId}` });
    notifyPlayerProfileChanged(playerId, 'Clan quitté');
    res.json({ ok: true });
  } catch (error) {
    console.error('[CLAN] leave:', error.message);
    res.status(500).json({ error: 'Impossible de quitter le clan.' });
  }
});

function groupSession(req) {
  const token = String(req.body?.token || req.query?.token || req.headers['x-session-token'] || '');
  const playerId = validateSession(token);
  if (!playerId || isAnonymousPlayerId(playerId)) return null;
  return { playerId: Number(playerId), player: pQ.getById.get(playerId) };
}

function serializeFriendGroup(groupId, viewerId) {
  const group = db.prepare(`SELECT g.*, p.pseudo owner_pseudo FROM friend_groups g JOIN players p ON p.id=g.owner_id WHERE g.id=?`).get(groupId);
  if (!group) return null;
  const members = db.prepare(`SELECT p.id,p.pseudo,p.avatar,p.color,p.elo,m.role,m.joined_at FROM friend_group_members m JOIN players p ON p.id=m.player_id WHERE m.group_id=? AND p.deleted=0 ORDER BY m.role='owner' DESC,p.pseudo`).all(groupId);
  const events = db.prepare(`SELECT e.*,p.pseudo creator_pseudo FROM friend_group_events e JOIN players p ON p.id=e.created_by WHERE e.group_id=? ORDER BY e.id DESC LIMIT 12`).all(groupId);
  return { ...group, id:Number(group.id), owner_id:Number(group.owner_id), created_at:Number(group.created_at), members, events, viewer_role: members.find(m => Number(m.id) === Number(viewerId))?.role || '' };
}

app.get('/api/groups', (req, res) => {
  const session = groupSession(req);
  if (!session) return res.status(401).json({ error: 'Connecte-toi pour voir tes groupes.' });
  const ids = db.prepare(`SELECT group_id FROM friend_group_members WHERE player_id=? ORDER BY joined_at DESC`).all(session.playerId);
  res.json({ groups: ids.map(row => serializeFriendGroup(row.group_id, session.playerId)).filter(Boolean) });
});

app.post('/api/groups', security.routeGuard('group'), (req, res) => {
  const session = groupSession(req);
  if (!session) return res.status(401).json({ error: 'Session invalide.' });
  const name = String(req.body?.name || '').trim().replace(/\s+/g, ' ').slice(0, 28);
  const emoji = String(req.body?.emoji || '🎮').trim().slice(0, 8) || '🎮';
  if (name.length < 3) return res.status(400).json({ error: 'Choisis un nom de 3 caracteres minimum.' });
  const now = Date.now();
  const create = db.transaction(() => {
    const info = db.prepare(`INSERT INTO friend_groups(name,emoji,owner_id,created_at) VALUES(?,?,?,?)`).run(name, emoji, session.playerId, now);
    db.prepare(`INSERT INTO friend_group_members(group_id,player_id,role,joined_at) VALUES(?,?, 'owner',?)`).run(info.lastInsertRowid, session.playerId, now);
    return Number(info.lastInsertRowid);
  });
  const id = create();
  res.json({ ok:true, group: serializeFriendGroup(id, session.playerId) });
});

app.post('/api/groups/:id/invites', security.routeGuard('group'), (req, res) => {
  const session = groupSession(req);
  if (!session) return res.status(401).json({ error: 'Session invalide.' });
  const groupId = Number(req.params.id), targetId = Number(req.body?.targetId);
  const member = db.prepare(`SELECT role FROM friend_group_members WHERE group_id=? AND player_id=?`).get(groupId, session.playerId);
  if (!member) return res.status(403).json({ error: 'Tu ne fais pas partie de ce groupe.' });
  const target = pQ.getById.get(targetId);
  if (!target || target.deleted || targetId === session.playerId) return res.status(400).json({ error: 'Joueur invalide.' });
  if (db.prepare(`SELECT 1 FROM friend_group_members WHERE group_id=? AND player_id=?`).get(groupId,targetId)) return res.status(409).json({ error: 'Ce joueur est deja membre.' });
  const pending = db.prepare(`SELECT id FROM friend_group_invites WHERE group_id=? AND target_id=? AND status='pending'`).get(groupId,targetId);
  if (pending) return res.status(409).json({ error: 'Invitation deja envoyee.' });
  const info = db.prepare(`INSERT INTO friend_group_invites(group_id,sender_id,target_id,status,created_at) VALUES(?,?,?,'pending',?)`).run(groupId,session.playerId,targetId,Date.now());
  getOnlineSocketsForPlayer(targetId).forEach(socket => socket.emit('group_invite', { id:Number(info.lastInsertRowid), groupId, sender:session.player.pseudo }));
  res.json({ ok:true });
});

app.get('/api/group-notifications', (req, res) => {
  const session = groupSession(req);
  if (!session) return res.json({ notifications:[], unread:0 });
  const rows = db.prepare(`SELECT i.id,i.group_id,i.created_at,g.name,g.emoji,p.pseudo sender_pseudo FROM friend_group_invites i JOIN friend_groups g ON g.id=i.group_id JOIN players p ON p.id=i.sender_id WHERE i.target_id=? AND i.status='pending' ORDER BY i.id DESC`).all(session.playerId);
  res.json({ notifications:rows, unread:rows.length });
});

app.post('/api/group-notifications/:id/respond', security.routeGuard('group'), (req, res) => {
  const session = groupSession(req);
  if (!session) return res.status(401).json({ error: 'Session invalide.' });
  const invite = db.prepare(`SELECT * FROM friend_group_invites WHERE id=? AND target_id=? AND status='pending'`).get(Number(req.params.id),session.playerId);
  if (!invite) return res.status(404).json({ error: 'Invitation expiree ou introuvable.' });
  const accept = req.body?.accept === true;
  const respond = db.transaction(() => {
    db.prepare(`UPDATE friend_group_invites SET status=?,responded_at=? WHERE id=?`).run(accept?'accepted':'declined',Date.now(),invite.id);
    if (accept) db.prepare(`INSERT OR IGNORE INTO friend_group_members(group_id,player_id,role,joined_at) VALUES(?,?,'member',?)`).run(invite.group_id,session.playerId,Date.now());
  });
  respond();
  res.json({ ok:true, accepted:accept, groupId:Number(invite.group_id) });
});

app.get('/api/groups/:id/messages', (req, res) => {
  const session = groupSession(req), groupId = Number(req.params.id);
  if (!session || !db.prepare(`SELECT 1 FROM friend_group_members WHERE group_id=? AND player_id=?`).get(groupId,session.playerId)) return res.status(403).json({ error: 'Acces refuse.' });
  const messages = db.prepare(`SELECT m.id,m.message,m.created_at,p.id player_id,p.pseudo,p.avatar,p.color FROM friend_group_messages m JOIN players p ON p.id=m.player_id WHERE m.group_id=? ORDER BY m.id DESC LIMIT 80`).all(groupId).reverse();
  res.json({ messages });
});

app.post('/api/groups/:id/messages', security.routeGuard('group-chat'), (req, res) => {
  const session = groupSession(req), groupId = Number(req.params.id);
  if (!session || !db.prepare(`SELECT 1 FROM friend_group_members WHERE group_id=? AND player_id=?`).get(groupId,session.playerId)) return res.status(403).json({ error: 'Acces refuse.' });
  const message = String(req.body?.message || '').trim().replace(/\s+/g,' ').slice(0,300);
  if (!message) return res.status(400).json({ error: 'Message vide.' });
  db.prepare(`INSERT INTO friend_group_messages(group_id,player_id,message,created_at) VALUES(?,?,?,?)`).run(groupId,session.playerId,message,Date.now());
  res.json({ ok:true });
});

app.post('/api/groups/:id/events', security.routeGuard('group'), (req, res) => {
  const session = groupSession(req), groupId = Number(req.params.id);
  if (!session || !db.prepare(`SELECT 1 FROM friend_group_members WHERE group_id=? AND player_id=?`).get(groupId,session.playerId)) return res.status(403).json({ error: 'Acces refuse.' });
  const type = req.body?.type === 'tournament' ? 'tournament' : 'duel';
  const title = String(req.body?.title || (type === 'tournament' ? 'Tournoi entre amis' : 'Duel amical')).trim().slice(0,60);
  db.prepare(`INSERT INTO friend_group_events(group_id,created_by,type,title,status,created_at) VALUES(?,?,?,?, 'open',?)`).run(groupId,session.playerId,type,title,Date.now());
  res.json({ ok:true });
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
      gameId: accepted.gameId || null,
      gameUrl: accepted.gameId ? '/game/' + accepted.gameId : '/game',
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

app.get('/api/players/:id/elo-history', (req, res) => {
  const history = buildPlayerEloHistory(req.params.id, req.query.days, { start: req.query.start, end: req.query.end });
  if (!history) return res.status(404).json({ error: 'Joueur introuvable' });
  res.json(history);
});

app.get('/api/players/:id/elo-history/export', (req, res) => {
  const history = buildPlayerEloHistory(req.params.id, req.query.days, { start: req.query.start, end: req.query.end });
  if (!history) return res.status(404).json({ error: 'Joueur introuvable' });
  const format = String(req.query.format || 'json').toLowerCase();
  const safePseudo = String(history.player?.pseudo || `player-${req.params.id}`)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9_-]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || `player-${req.params.id}`;
  const filename = `elo-history-${safePseudo}-${history.days}j.${format === 'csv' ? 'csv' : 'json'}`;
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  if (format === 'csv') {
    res.type('text/csv; charset=utf-8');
    return res.send(buildPlayerEloHistoryCsv(history));
  }
  res.type('application/json; charset=utf-8');
  res.send(JSON.stringify(history, null, 2));
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
  const gamesTotal = player.id === BOT_PLAYER_ID
    ? Number(db.prepare(`
        SELECT COUNT(*) AS c
        FROM games
        WHERE (player1_id = ? OR player2_id = ?) AND status = 'finished'
      `).get(player.id, player.id)?.c || 0)
    : Number(db.prepare(`
        SELECT COUNT(*) AS c
        FROM games
        WHERE (player1_id = ? OR player2_id = ?)
          AND player1_id != ? AND player2_id != ?
          AND status = 'finished'
      `).get(player.id, player.id, BOT_PLAYER_ID, BOT_PLAYER_ID)?.c || 0);
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

  const token = String(req.headers['x-session-token'] || req.query.token || '').trim();
  const includePrivateProfile = token && validateSession(token) === Number(player.id);
  const p = includePrivateProfile ? sanitize(player) : stripWallpaperPayload(sanitize(player));
  const clan = serializeClan(cQ.getForPlayer.get(player.id));
  const runtime = Number(player.is_bot || 0) === 1 ? publicBotRuntime(player.id) : null;
  const online = Number(player.is_bot || 0) === 1 ? !!runtime.online : onlineSockets.has(Number(player.id));
  res.json({ player: { ...p, rank: getRank(p.elo), avg_accuracy, analysed_count: accRow?.analysed_count || 0, games_total: gamesTotal, clan, online }, games, games_total: gamesTotal, following, followers });
});

app.get('/api/players/:id/tournaments', (req, res) => {
  if (!TOURNAMENTS_ENABLED) return res.json({ tournaments: [] });
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
  const analysedGame = gQ.getById.get(gameId);
  if (!analysedGame) return res.status(404).json({ error: 'Partie introuvable' });
  if (normalizeVariant(analysedGame.variant) !== 'classic') {
    return res.status(409).json({ error: 'L’analyse stratégique automatisée est actuellement réservée au mode classique.', variant: analysedGame.variant });
  }
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

  const isBot = Number(player.is_bot || 0) === 1;
  const runtime = isBot ? publicBotRuntime(id) : null;
  const isOnline = isBot ? !!runtime.online : onlineSockets.has(id) && onlineSockets.get(id).size > 0;
  res.json({
    online:    isOnline,
    is_bot:    isBot,
    botStatus: runtime?.status || null,
    last_seen: player.last_seen || null,
    bot_last_seen: runtime?.lastSeen || Number(player.bot_last_seen || 0) || null,
  });
});

// AAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAA Discord info + dAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAAliaison AAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAA
function serializeDiscordProfile(player, includePrivate = false) {
  if (!player?.discord_id) return null;
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

  if (!info) return { id: player.discord_id, username: 'Inconnu', linked_at: null };
  const publicInfo = {
      id: info.id || player.discord_id,
      username: info.username || 'Inconnu',
      global_name: info.global_name || '',
      discriminator: info.discriminator || null,
      premium_type: Number(info.premium_type || 0),
      public_flags: Number(info.public_flags || 0),
      created_at: info.created_at || null,
      server_joined: info.server_joined || null,
      server_nick: info.server_nick || null,
      server_roles: Array.isArray(info.server_roles) ? info.server_roles : [],
      boosting_since: info.boosting_since || null,
      linked_at: info.linked_at || null,
      nitro_label:  NITRO_LABELS[info.premium_type] || 'Aucun',
      badges,
      is_boosting:  !!info.boosting_since,
      on_server:    Boolean(info.server_joined),
      account_age_days: info.created_at
        ? Math.floor((Date.now() - new Date(info.created_at)) / 86400000)
        : null,
  };
  return includePrivate ? { ...publicInfo, email: info.email || null, verified: !!info.verified, mfa_enabled: !!info.mfa_enabled } : publicInfo;
}

// Informations Discord publiques d'un profil lie.
app.get('/api/players/:id/discord-info', (req, res) => {
  const player = pQ.getById.get(Number(req.params.id));
  if (!player || player.deleted) return res.status(404).json({ error: 'Joueur introuvable.' });
  res.set('Cache-Control', 'private, max-age=30');
  res.json({ discord: serializeDiscordProfile(player, false) });
});

// Infos Discord enrichies du joueur connecte.
app.get('/api/me/discord-info', (req, res) => {
  const token = req.headers['x-session-token'];
  const playerId = token ? validateSession(token) : null;
  if (!playerId) return res.status(401).json({ error: 'Non authentifie.' });
  const player = pQ.getById.get(playerId);
  res.json({ discord: serializeDiscordProfile(player, true) });
});

app.post('/api/me/discord-avatar/refresh', async (req, res) => {
  const token = req.headers['x-session-token'] || req.body?.token;
  const playerId = token ? validateSession(token) : null;
  if (!playerId) return res.status(401).json({ error: 'Non authentifie.' });

  const player = pQ.getById.get(playerId);
  if (!player) return res.status(404).json({ error: 'Joueur introuvable.' });
  if (!player.discord_id) return res.status(400).json({ error: 'Aucun compte Discord lie.' });

  const { botToken } = discordConfig();
  if (!botToken) return res.status(503).json({ error: 'Bot Discord indisponible.' });

  const snapshot = await fetchDiscordMemberSnapshot(player.discord_id, botToken, { force: true });
  const memberInfo = snapshot?.memberInfo || null;
  let discordUser = memberInfo?.user || null;
  if (!discordUser) discordUser = await fetchDiscordUserProfile(player.discord_id, botToken);
  const avatar = discordMemberAvatarUrl(memberInfo) || discordAvatarUrl(discordUser);
  if (!avatar) return res.status(502).json({ error: 'Impossible de recuperer l avatar Discord.' });

  pQ.updateAvatar.run({ avatar, id: player.id });

  let existing = {};
  try { existing = player.discord_info ? JSON.parse(player.discord_info) : {}; } catch(e) {}
  const updatedInfo = {
    ...existing,
    id: player.discord_id,
    username: discordUser?.username || existing.username || null,
    global_name: discordUser?.global_name || existing.global_name || discordUser?.username || null,
    discriminator: discordUser?.discriminator && discordUser.discriminator !== '0'
      ? discordUser.discriminator
      : (existing.discriminator || null),
    public_flags: discordUser?.public_flags ?? existing.public_flags ?? 0,
    avatar_hash: discordUser?.avatar || existing.avatar_hash || null,
    server_avatar_hash: memberInfo?.avatar || null,
    avatar_url: avatar,
    server_roles: snapshot?.server_roles_rich || existing.server_roles || [],
    server_nick: memberInfo?.nick || existing.server_nick || null,
    server_joined: memberInfo?.joined_at || existing.server_joined || null,
    boosting_since: memberInfo?.premium_since || null,
    avatar_refreshed_at: new Date().toISOString(),
  };
  rQ.setDiscord.run(player.discord_id, JSON.stringify(updatedInfo), player.id);
  progression.recordAction(player.id, 'profile_updates');

  const fresh = pQ.getById.get(player.id);
  res.json({ ok: true, avatar, discord: updatedInfo, player: sanitize(fresh) });
});

app.post('/api/me/discord-banner/refresh', async (req, res) => {
  const token = req.headers['x-session-token'] || req.body?.token;
  const playerId = token ? validateSession(token) : null;
  if (!playerId) return res.status(401).json({ error: 'Non authentifie.' });

  const player = pQ.getById.get(playerId);
  if (!player) return res.status(404).json({ error: 'Joueur introuvable.' });
  if (!player.discord_id) return res.status(400).json({ error: 'Aucun compte Discord lie.' });

  const { botToken } = discordConfig();
  if (!botToken) return res.status(503).json({ error: 'Bot Discord indisponible.' });

  const discordUser = await fetchDiscordUserProfile(player.discord_id, botToken);
  const banner = discordBannerUrl(discordUser);
  if (!banner) return res.status(400).json({ error: 'Aucune banniere Discord recuperable pour ce compte.' });

  pQ.updateBanner.run({ banner, id: player.id });

  let existing = {};
  try { existing = player.discord_info ? JSON.parse(player.discord_info) : {}; } catch(e) {}
  const updatedInfo = {
    ...existing,
    id: player.discord_id,
    username: discordUser?.username || existing.username || null,
    global_name: discordUser?.global_name || existing.global_name || discordUser?.username || null,
    discriminator: discordUser?.discriminator && discordUser.discriminator !== '0'
      ? discordUser.discriminator
      : (existing.discriminator || null),
    banner_hash: discordUser?.banner || null,
    banner_url: banner,
    banner_refreshed_at: new Date().toISOString(),
  };
  rQ.setDiscord.run(player.discord_id, JSON.stringify(updatedInfo), player.id);
  progression.recordAction(player.id, 'profile_updates');

  const fresh = pQ.getById.get(player.id);
  res.json({ ok: true, banner, discord: updatedInfo, player: sanitize(fresh) });
});

app.post('/api/me/discord-pseudo/refresh', async (req, res) => {
  const token = req.headers['x-session-token'] || req.body?.token;
  const playerId = token ? validateSession(token) : null;
  if (!playerId) return res.status(401).json({ error: 'Non authentifie.' });

  const player = pQ.getById.get(playerId);
  if (!player) return res.status(404).json({ error: 'Joueur introuvable.' });
  if (!player.discord_id) return res.status(400).json({ error: 'Aucun compte Discord lie.' });

  const { botToken } = discordConfig();
  if (!botToken) return res.status(503).json({ error: 'Bot Discord indisponible.' });

  const discordUser = await fetchDiscordUserProfile(player.discord_id, botToken);
  if (!discordUser?.id) return res.status(502).json({ error: 'Impossible de recuperer ton profil Discord.' });
  const nextPseudo = normalizePseudoCandidate(discordUser?.global_name || discordUser?.username || '');
  if (!/^[A-Za-z0-9_.-]{3,16}$/.test(nextPseudo)) {
    return res.status(400).json({ error: 'Le pseudo Discord ne donne pas un pseudo valide sur le site.' });
  }
  const existing = pQ.getByPseudo.get(nextPseudo);
  if (existing && Number(existing.id) !== player.id) return res.status(409).json({ error: 'Ce pseudo Discord est deja pris sur le site.' });
  if (String(player.pseudo || '').toLowerCase() === nextPseudo.toLowerCase()) {
    return res.json({ ok: true, pseudo: player.pseudo, unchanged: true, player: sanitize(player) });
  }
  const remaining = Number(player.pseudo_changed_at || 0) + PSEUDO_CHANGE_COOLDOWN_MS - Date.now();
  if (remaining > 0) {
    const days = Math.ceil(remaining / (24 * 60 * 60 * 1000));
    return res.status(429).json({ error: `Pseudo modifiable dans ${days} jour(s).`, remainingMs: remaining });
  }

  pQ.updatePseudo.run({ pseudo: nextPseudo, id: player.id });
  pQ.updatePseudoChangedAt.run({ changedAt: Date.now(), id: player.id });
  try { await renameOnServer(player.discord_id, nextPseudo); } catch(e) {}

  let discordInfo = {};
  try { discordInfo = player.discord_info ? JSON.parse(player.discord_info) : {}; } catch(e) {}
  rQ.setDiscord.run(player.discord_id, JSON.stringify({
    ...discordInfo,
    id: player.discord_id,
    username: discordUser?.username || discordInfo.username || null,
    global_name: discordUser?.global_name || discordInfo.global_name || discordUser?.username || null,
    pseudo_refreshed_at: new Date().toISOString(),
  }), player.id);
  progression.recordAction(player.id, 'profile_updates');

  const fresh = pQ.getById.get(player.id);
  res.json({ ok: true, pseudo: nextPseudo, player: sanitize(fresh) });
});

// Demander un code de dAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAAliaison Discord AAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAA AAaAasAAAAAAAAasAA...AAasAAAAAAAAasAA...AAasAA envoi DM via bot
app.post('/api/discord/unlink/request', async (req, res) => {
  const token = req.headers['x-session-token'];
  const playerId = token ? validateSession(token) : null;
  if (!playerId) return res.status(401).json({ error: 'Non authentifié' });

  const player = pQ.getById.get(playerId);
  if (!player?.discord_id) return res.status(400).json({ error: 'Aucun Discord liée' });

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
  if (!playerId) return res.status(401).json({ error: 'Non authentifié' });

  const { code } = req.body;
  if (!code) return res.status(400).json({ error: 'Code manquant' });

  const row = rQ.getUnlink.get(playerId, String(code).trim(), Date.now());
  if (!row) return res.status(400).json({ error: 'Code invalide ou expiré' });

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
  broadcastPresenceCounts(true);

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
  const actions = aQ.getByGame.all(Number(req.params.id)).map(action => {
    try { return { ...action, payload: JSON.parse(action.payload || '{}') }; }
    catch { return { ...action, payload: {} }; }
  });
  res.json({ game, moves: mQ.getByGame.all(Number(req.params.id)), actions });
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
  progression.recordAction(playerId, 'bot_games');
  if (!isDraw && Number(winnerId) === Number(playerId)) progression.recordAction(playerId, 'bot_wins');
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
  if (!player?.discord_id) return res.status(400).json({ error: 'Pas de compte Discord liée.' });
  try {
    const { botToken: bt } = discordConfig();
    const snapshot = await fetchDiscordMemberSnapshot(player.discord_id, bt);
    if (!snapshot) {
      rQ.clearDiscord.run(id);
      pQ.updateRole.run({ role: 'user', id });
      pQ.updateVip.run({ is_vip: 0, id });
      pQ.updateVipPlus.run({ is_vip_plus: 0, id });
      pQ.updatePerso.run({ is_perso: 0, id });
      pQ.updateDeveloper.run({ is_developer: 0, id });
      pQ.updateVipExpiry.run({ vip_expires_at: null, id });
      revokeAdminSessionsForPlayer(id);
      broadcastPresenceCounts(true);
      return res.status(404).json({ error: 'Membre introuvable sur le serveur.', unlinked: true, role: 'user' });
    }
    const { memberInfo, server_roles_rich, newRole, developer } = snapshot;
    if (newRole !== player.role) pQ.updateRole.run({ role: newRole, id });
    const vipNow = hasVipRoleIds(memberInfo.roles || []) ? 1 : 0;
    const vipPlusNow = hasVipPlusRoleIds(memberInfo.roles || []) ? 1 : 0;
    const persoNow = hasPersoRoleIds(memberInfo.roles || []) ? 1 : 0;
    const developerNow = developer ? 1 : 0;
    if (vipNow !== Number(player.is_vip || 0)) pQ.updateVip.run({ is_vip: vipNow, id });
    if (vipPlusNow !== Number(player.is_vip_plus || 0)) pQ.updateVipPlus.run({ is_vip_plus: vipPlusNow, id });
    if (persoNow !== Number(player.is_perso || 0)) pQ.updatePerso.run({ is_perso: persoNow, id });
    if (developerNow !== Number(player.is_developer || 0)) {
      pQ.updateDeveloper.run({ is_developer: developerNow, id });
    }
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
    res.json({ ok: true, roles: server_roles_rich, role: newRole, is_vip: vipNow, is_vip_plus: vipPlusNow, is_perso: persoNow, is_developer: developerNow, vip_expires_at: Number(fresh?.vip_expires_at || 0) || null });
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
    search_nameplate: bot?.search_nameplate || '',
    profile_banner: bot?.profile_banner || '',
    token_emoji_image: bot?.token_emoji_image || '',
    token_rgb: Number(bot?.pseudo_rgb || 0) === 1,
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
    const revertVariant = normalizeVariant(game.variant);
    if (revertVariant !== 'classic') {
      variantQ.ensure.run(game.player1_id, revertVariant);
      variantQ.ensure.run(game.player2_id, revertVariant);
      db.prepare(`UPDATE player_variant_stats SET elo=?, wins=MAX(0,wins-?), losses=MAX(0,losses-?), draws=MAX(0,draws-?) WHERE player_id=? AND variant=?`).run(game.elo_before_p1, game.winner_id === game.player1_id ? 1 : 0, game.winner_id === game.player2_id ? 1 : 0, game.winner_id === null ? 1 : 0, game.player1_id, revertVariant);
      db.prepare(`UPDATE player_variant_stats SET elo=?, wins=MAX(0,wins-?), losses=MAX(0,losses-?), draws=MAX(0,draws-?) WHERE player_id=? AND variant=?`).run(game.elo_before_p2, game.winner_id === game.player2_id ? 1 : 0, game.winner_id === game.player1_id ? 1 : 0, game.winner_id === null ? 1 : 0, game.player2_id, revertVariant);
    } else {
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
    }

    // Marquer la partie comme revertAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAAe
    db.prepare(`UPDATE games SET reverted = 1 WHERE id = ?`).run(gameId);
    syncPlayerDiscordRankRole(game.player1_id).catch(() => {});
    syncPlayerDiscordRankRole(game.player2_id).catch(() => {});

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
  const rawSearch = req.query.search ? String(req.query.search).trim().replace(/%/g,'') : '';
  const search = rawSearch ? '%' + rawSearch + '%' : null;
  const searchId = rawSearch && /^\d+$/.test(rawSearch) ? Number(rawSearch) : null;
  const kind = String(req.query.kind || 'human') === 'bot' ? 'bot' : 'human';

  const botFilter = kind === 'bot'
    ? `(COALESCE(p1.is_bot,0)=1 OR COALESCE(p2.is_bot,0)=1)`
    : `COALESCE(p1.is_bot,0)=0 AND COALESCE(p2.is_bot,0)=0`;
  const where  = search
    ? `WHERE (p1.pseudo LIKE ? OR p2.pseudo LIKE ? OR g.id = ? OR p1.id = ? OR p2.id = ?) AND g.status='finished' AND ${botFilter}`
    : `WHERE g.status='finished' AND ${botFilter}`;
  const params = search ? [search, search, searchId || -1, searchId || -1, searchId || -1, limit, offset] : [limit, offset];

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
  const active = bQ.getActive.get(Date.now());
  const expiresAt = Number(active?.expires_at || 0) || null;
  res.json({
    active: !!(active),
    multiplier: active?.multiplier ?? 1,
    expiresAt,
    remainingMs: expiresAt ? Math.max(0, expiresAt - Date.now()) : null,
  });
});
app.post('/api/admin/boost', (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Seuls les admins.' });
  const m = parseFloat(req.body.multiplier);
  const durationMinutes = Math.ceil(Number(req.body?.durationMinutes || 0));
  if (isNaN(m) || m < 1 || m > 2) return res.status(400).json({ error: 'Entre 1.0 et 2.0.' });
  if (!Number.isFinite(durationMinutes) || durationMinutes < 0 || durationMinutes > 1440) {
    return res.status(400).json({ error: 'Duree invalide (max 24h).' });
  }
  bQ.deactivateAll.run();
  const expiresAt = m > 1 && durationMinutes !== 0 ? Date.now() + durationMinutes * 60 * 1000 : null;
  if (m > 1 && durationMinutes !== 0) {
    bQ.create.run({
      multiplier: m,
      applied_by: 'Puissance4-Booster',
      expires_at: expiresAt,
    });
  }
  try { WH.wlogBoost('elo', m, req.headers['x-admin-identity'] || 'Admin panel', expiresAt ? `${durationMinutes} min` : 'desactive'); } catch(e) {}
  res.json({ ok: true, multiplier: m, expiresAt });
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
    try { WH.wlogBoost('coins', 1, req.headers['x-admin-identity'] || 'Admin panel', 'desactive'); } catch(e) {}
    return res.json({ ok: true, multiplier: 1, expiresAt: null });
  }
  const expiresAt = Date.now() + durationMinutes * 60 * 1000;
  db.prepare(`INSERT INTO config (key, value) VALUES ('coin_boost_multiplier', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`).run(String(multiplier));
  db.prepare(`INSERT INTO config (key, value) VALUES ('coin_boost_expires_at', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`).run(String(expiresAt));
  db.prepare(`INSERT INTO config (key, value) VALUES ('coin_boost_applied_by', 'Puissance4-Booster') ON CONFLICT(key) DO UPDATE SET value=excluded.value`).run();
  try { WH.wlogBoost('coins', multiplier, req.headers['x-admin-identity'] || 'Admin panel', `${durationMinutes} min`); } catch(e) {}
  res.json({ ok: true, multiplier, expiresAt });
});

app.post('/api/admin/system-status', (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Seuls les admins.' });
  const restarting = Boolean(req.body?.restarting);
  const message = String(req.body?.message || '').trim().slice(0, 180);
  const status = writeSystemStatus({
    restarting,
    message: restarting ? message : '',
    emoji: req.body?.emoji,
    color: req.body?.color,
    animation: req.body?.animation,
  });
  io.emit('system_status_update', status);
  try {
    WH.wlogSystem(restarting ? 'alerte active' : 'alerte retiree', status.message, {
      ...getWebhookSiteSnapshot(),
      emoji: status.emoji,
      color: status.color,
      animation: status.animation,
    });
  } catch(e) {}
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
app.get('/api/leaderboard/bots', (_, res) => {
  const bots = db.prepare(`
    SELECT * FROM players
    WHERE deleted = 0 AND is_guest = 0 AND is_bot = 1
    ORDER BY elo DESC, wins DESC
    LIMIT 25
  `).all();
  res.json(bots.map(p => {
    const s = sanitize(p);
    const runtime = publicBotRuntime(s.id);
    return {
      ...s,
      rank: getRank(s.elo),
      botOnline: !!runtime.online,
      botStatus: runtime.status || (runtime.online ? 'online' : 'offline'),
      botDepth: runtime.depth || s.bot_skill || 0,
    };
  }));
});
app.get('/api/leaderboard/wins', (_, res) => {
  const q = db.prepare('SELECT * FROM players WHERE deleted = 0 AND is_guest = 0 AND is_bot = 0 ORDER BY wins DESC LIMIT 10');
  res.json(q.all().map(sanitize));
});
app.get('/api/site-stats', (_, res) => {
  const presence = getPresenceCounts();
  const publicTournament = getPublicActiveTournament();
  const upcomingPublicTournament = getPublicPendingTournament();
  const activeBoost = bQ.getActive.get(Date.now());
  const now = Date.now();
  const coinBoostMultiplier = Number(db.prepare(`SELECT value FROM config WHERE key = 'coin_boost_multiplier'`).get()?.value || 1);
  const coinBoostExpiresAt = Number(db.prepare(`SELECT value FROM config WHERE key = 'coin_boost_expires_at'`).get()?.value || 0);
  const coinBoostAppliedByRaw = String(db.prepare(`SELECT value FROM config WHERE key = 'coin_boost_applied_by'`).get()?.value || '');
  const coinBoostActive = coinBoostExpiresAt > now && coinBoostMultiplier > 1;
  res.json({
    online: presence.onlinePlayers,
    onlinePlayers: presence.onlinePlayers,
    onlineBots: presence.onlineBots,
    visitors: presence.visitors,
    totalPresent: presence.totalPresent,
    registeredPlayers: presence.registeredPlayers,
    registeredHumans: presence.registeredHumans,
    registeredDiscordPlayers: presence.registeredDiscordPlayers,
    registeredBots: presence.registeredBots,
    queue: mm?.queue?.length || 0,
    activeGames: presence.activeGames,
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
  const registeredPlayers = presence.registeredHumans;
  const registeredDiscordPlayers = presence.registeredDiscordPlayers;
  const activeGames = presence.activeGames;
  const finishedGames = Number(db.prepare(`SELECT COUNT(*) AS c FROM games WHERE status = 'finished'`).get()?.c || 0);
  const totalGames = Number(db.prepare(`SELECT COUNT(*) AS c FROM games`).get()?.c || 0);
  const totalMoves = Number(db.prepare(`SELECT COALESCE(SUM(move_count), 0) AS v FROM games`).get()?.v || 0);
  const averageElo = Number(db.prepare(`SELECT ROUND(AVG(elo), 0) AS v FROM players WHERE deleted = 0 AND is_guest = 0 AND id != ?`).get(BOT_PLAYER_ID)?.v || 0);
  const averageDuration = Number(db.prepare(`SELECT ROUND(AVG(duration), 0) AS v FROM games WHERE status = 'finished' AND duration > 0`).get()?.v || 0);
  const averageMoves = Number(db.prepare(`SELECT ROUND(AVG(move_count), 0) AS v FROM games WHERE status = 'finished' AND move_count > 0`).get()?.v || 0);
  const follows = Number(db.prepare(`SELECT COUNT(*) AS c FROM follows`).get()?.c || 0);
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
  const activeGlobalBoost = bQ.getActive.get(Date.now());
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
    onlineBots: presence.onlineBots,
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
    registeredPlayers,
    registeredDiscordPlayers,
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

setInterval(() => {
  const now = Date.now();
  try { sQ.purge.run(now); } catch {}
  for (const socket of io.sockets.sockets.values()) {
    if (!socket.playerId || !socket.sessionToken || isAnonymousPlayerId(socket.playerId)) continue;
    if (validateSession(socket.sessionToken, { touch: false }) !== Number(socket.playerId)) {
      expireSocketSession(socket);
    }
  }
}, Math.min(60_000, Math.max(10_000, Math.floor(SESSION_IDLE_MS / 2))));

io.on('connection', socket => {
  socket.emit('presence_counts', getPresenceCounts());

  socket.use((packet, next) => {
    const eventName = String(packet?.[0] || '');
    if (
      socket.sessionToken
      && socket.playerId
      && !['presence_ping', 'visitor_presence', 'identify', 'dev_metrics_subscribe', 'dev_metrics_unsubscribe'].includes(eventName)
    ) {
      const validId = touchSession(socket.sessionToken);
      if (validId !== Number(socket.playerId)) {
        expireSocketSession(socket);
        return;
      }
    }
    next();
  });

  socket.on('dev_metrics_subscribe', ({ token } = {}) => {
    const player = getDeveloperSessionByToken(token);
    if (!player) return socket.emit('dev_metrics_error', { error: 'Session developpeur invalide.' });
    socket.join('dev-metrics');
    socket.emit('dev_metrics_history', {
      metrics: devMachineMetrics,
      uptimeSeconds: Math.round(process.uptime()),
    });
  });

  socket.on('dev_metrics_unsubscribe', () => {
    socket.leave('dev-metrics');
  });

  socket.on('join_live', () => {
    socket.join('live');
  });

  socket.on('join_live_game', ({ gameId } = {}) => {
    const id = Number(gameId || 0);
    leaveLiveSpectate(socket);
    if (!id || !gm.games.has(id)) return;
    socket.liveSpectateGameId = id;
    socket.join(`live:spectate:${id}`);
    emitLiveUpdate();
  });

  socket.on('leave_live_game', () => {
    const hadGame = socket.liveSpectateGameId;
    leaveLiveSpectate(socket);
    if (hadGame) emitLiveUpdate();
  });

  socket.on('live_reaction', ({ gameId, reaction } = {}) => {
    const id = Number(gameId || socket.liveSpectateGameId || 0);
    const allowed = ['fire', 'wow', 'clap', 'heart'];
    const key = String(reaction || '').toLowerCase();
    if (!id || !gm.games.has(id) || !allowed.includes(key)) return;
    if (Date.now() - Number(socket.lastLiveReactionAt || 0) < 1200) return;
    socket.lastLiveReactionAt = Date.now();
    const counts = { ...(liveReactions.get(id) || {}) };
    counts[key] = Number(counts[key] || 0) + 1;
    liveReactions.set(id, counts);
    io.to(`live:spectate:${id}`).emit('live_reaction', {
      gameId: id,
      reaction: key,
      counts,
      pseudo: socket.playerData?.pseudo || 'Anonyme',
    });
    emitLiveUpdate();
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
    const validId = token ? validateSession(token, { touch: false }) : null;
    if (!validId || validId !== Number(playerId)) {
      if (socket.playerId) expireSocketSession(socket);
      else socket.emit('session_expired', { message: "Session expirée après 10 minutes d'inactivité. Reconnecte-toi." });
      return socket.emit('error', { message: 'Session invalide. Reconnecte-toi.' });
    }
    const player = getPlayerRecord(Number(playerId));
    if (!player) return socket.emit('error', { message: 'Joueur introuvable.' });
    if (socket.playerId && Number(socket.playerId) !== Number(playerId)) removeSocketPresence(socket);
    socket.playerId   = Number(playerId);
    socket.playerData = sanitize(player);
    socket.sessionToken = String(token || '');
    // Stocker l'IP en mémoire (X-Forwarded-For est fourni par le reverse proxy du VPS)
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
    cancelCrystalLoginClear(socket.playerId);
    if (!isAnonymousPlayerId(socket.playerId)) markDiscordConnectedRealtime(player);
    if (!isAnonymousPlayerId(socket.playerId)) rQ.updateLastSeen.run(Date.now(), socket.playerId);
    if (!isAnonymousPlayerId(socket.playerId) && isCrystalPlayer(player) && shouldBroadcastCrystalLogin(socket.playerId)) {
      const alert = normalizeCrystalAlertPayload({
        message: player.crystal_alert_message || `${player.pseudo} s'est connecte au site.`,
        color: player.crystal_alert_color || '#85EBFF',
        emoji: player.crystal_alert_emoji || '💠',
        animation: player.crystal_alert_animation || 'glow',
      });
      io.emit('crystal_login', {
        pseudo: player.pseudo,
        avatar: player.avatar || '',
        ...alert,
      });
    }
    socket.emit('identified', sanitize(player));
    if (socket.liveSpectateGameId) emitLiveUpdate();
    broadcastPresenceCounts();
  });

  // Heartbeat de prAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAAsence (pages hors jeu)
  socket.on('presence_ping', ({ active } = {}) => {
    if (!socket.playerId || isAnonymousPlayerId(socket.playerId)) return;
    const validId = socket.sessionToken ? validateSession(socket.sessionToken, { touch: false }) : null;
    if (validId !== Number(socket.playerId)) {
      expireSocketSession(socket);
      return;
    }
    if (active === true && touchSession(socket.sessionToken) === Number(socket.playerId)) {
      rQ.updateLastSeen.run(Date.now(), socket.playerId);
    }
  });

  socket.on('game_latency_probe', (_sentAt, ack) => {
    if (typeof ack === 'function') ack({ serverAt: Date.now() });
  });

  socket.on('game_latency_report', ({ ping } = {}) => {
    const ctxGame = getSocketGameState(socket);
    if (!ctxGame) return;
    const ms = Math.round(Number(ping));
    if (!Number.isFinite(ms) || ms < 0) return;
    ctxGame.state.players[ctxGame.side].pingMs = Math.min(5000, ms);
    ctxGame.state.players[ctxGame.side].pingUpdatedAt = Date.now();
    io.to('game:' + ctxGame.state.id).emit('game_latency_update', {
      gameId: ctxGame.state.id,
      latencies: getGameLatencyPayload(ctxGame.state),
    });
  });

  socket.on('join_clan_chat', ({ clanId } = {}) => {
    const id = Number(clanId || 0);
    if (!socket.playerId) return socket.emit('clan_error', { message: 'Identifie-toi pour rejoindre le tchat clan.' });
    if (!id || !cQ.getById.get(id)) return socket.emit('clan_error', { message: 'Clan introuvable.' });
    if (!cQ.member.get(id, socket.playerId)) return socket.emit('clan_error', { message: 'Tchat reserve aux membres du clan.' });
    if (socket.clanRoom) socket.leave(socket.clanRoom);
    socket.clanRoom = `clan:${id}`;
    socket.join(socket.clanRoom);
    socket.emit('clan_joined', { clanId: id });
  });

  socket.on('clan_message_send', ({ clanId, message } = {}) => {
    const id = Number(clanId || 0);
    if (!socket.playerId || !socket.playerData) return socket.emit('clan_error', { message: 'Identifie-toi pour envoyer un message.' });
    if (!id || !cQ.getById.get(id)) return socket.emit('clan_error', { message: 'Clan introuvable.' });
    if (!cQ.member.get(id, socket.playerId)) return socket.emit('clan_error', { message: 'Tchat reserve aux membres du clan.' });
    const cleanMessage = String(message || '').trim().replace(/\s+/g, ' ').slice(0, 300);
    if (!cleanMessage) return socket.emit('clan_error', { message: 'Message vide.' });
    const createdAt = Date.now();
    const info = cQ.addMessage.run({ clan_id: id, player_id: socket.playerId, message: cleanMessage, created_at: createdAt });
    const freshPlayer = getPlayerRecord(socket.playerId) || socket.playerData;
    const payload = serializeClanMessage({
      id: info.lastInsertRowid,
      clan_id: id,
      player_id: socket.playerId,
      pseudo: freshPlayer.pseudo,
      avatar: freshPlayer.avatar,
      color: freshPlayer.color,
      message: cleanMessage,
      created_at: createdAt,
    }, freshPlayer);
    io.to(`clan:${id}`).emit('clan_message', payload);
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

  socket.on('queue_join', ({ shape, tokenEmojiImage, variant: requestedVariant } = {}) => {
    if (!socket.playerData) return socket.emit('error', { message: 'Identifie-toi d\'abord.' });
    const freshPlayer = pQ.getById.get(socket.playerId);
    // VAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAArifier ban/mute
    if (isPlayerBanned(freshPlayer)) {
      const until = Number(freshPlayer.banned_until || 0);
      const suffix = until > 0 ? ` jusqu'au ${new Date(until).toLocaleString('fr-FR')}` : '';
      return socket.emit('error', { message: `Ton compte est banni${suffix}.` });
    }
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
    const variant = normalizeVariant(requestedVariant);
    const joined = mm.join(socket.id, { ...socket.playerData, socketId: socket.id, variant });
    if (!joined) return socket.emit('error', { message: 'DAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAAjAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAA  en queue.' });
    socket.emit('queue_joined', { position: mm.position(socket.id), variant });
    const match = mm.tryMatch();
    if (match) _startMatch(match.p1, match.p2);
  });

  socket.on('queue_leave', () => { mm.leave(socket.id); socket.emit('queue_left'); });

  socket.on('tournament_queue_join', ({ tournamentId, shape, tokenEmojiImage } = {}) => {
    if (!TOURNAMENTS_ENABLED) return socket.emit('error', { message: 'Les tournois ont ete retires du site.' });
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
    if (!TOURNAMENTS_ENABLED) return socket.emit('tournament_queue_left');
    const id = Number(tournamentId || socket.tournamentQueueId || 0);
    if (id) getTournamentQueue(id).leave(socket.id);
    socket.tournamentQueueId = null;
    socket.emit('tournament_queue_left');
  });

  socket.on('play_move', ({ col }) => {
    const result = gm.playMove(socket.id, col);
    if (result.error) return socket.emit('error', { message: result.error });
    if (['move', 'simultaneous_round'].includes(result.type)) io.to('game:' + result.gameId).emit('move_played', result);
    if (result.type === 'simultaneous_wait') socket.emit('simultaneous_waiting', result);
    if (result.type === 'game_over') emitGameOver(result);
    const activeState = result.gameId ? gm.games.get(result.gameId) : null;
    if (result.type === 'move' && activeState && builtinBotIds.has(Number(activeState.players?.[activeState.current]?.id))) {
      scheduleBuiltinBotTurn(result.gameId, 500);
    }
    // Notifier les spectateurs live. Les fins de partie le font via emitGameOver().
    if (result.type !== 'game_over') emitLiveUpdate();
  });

  socket.on('game_use_bomb', ({ row, col } = {}) => {
    const result = gm.useBomb(socket.id, row, col);
    if (result.error) return socket.emit('game_action_error', { message: result.error });
    if (result.type === 'game_over') return emitGameOver(result);
    io.to('game:' + result.gameId).emit('bomb_used', result);
    emitLiveUpdate();
  });

  socket.on('game_select_mission', ({ missionId } = {}) => {
    const result = gm.selectMission(socket.id, missionId);
    if (result.error) return socket.emit('game_action_error', { message: result.error });
    socket.emit('mission_confirmed', result);
    io.to('game:' + result.gameId).emit('mission_ready_state', { side: result.side, ready: result.ready });
  });

  socket.on('game_chat_send', ({ message } = {}) => {
    const ctxGame = getSocketGameState(socket);
    if (!ctxGame) return socket.emit('game_action_error', { message: 'Tchat indisponible hors partie active.' });
    const cleanMessage = cleanGameChatMessage(message);
    if (!cleanMessage) return;
    const player = ctxGame.state.players[ctxGame.side] || socket.playerData || {};
    io.to('game:' + ctxGame.state.id).emit('game_chat_message', {
      gameId: ctxGame.state.id,
      playerId: player.id,
      side: ctxGame.side,
      pseudo: player.pseudo || 'Joueur',
      message: cleanMessage,
      createdAt: Date.now(),
    });
  });

  socket.on('game_draw_offer', () => {
    const ctxGame = getSocketGameState(socket);
    if (!ctxGame) return socket.emit('game_action_error', { message: 'Aucune partie active.' });
    if (ctxGame.state.drawOfferSide && ctxGame.state.drawOfferSide !== ctxGame.side) {
      return socket.emit('game_action_error', { message: 'Une proposition de nulle adverse est deja en attente.' });
    }
    ctxGame.state.drawOfferSide = ctxGame.side;
    ctxGame.state.drawOfferAt = Date.now();
    io.to('game:' + ctxGame.state.id).emit('game_action_offer', {
      gameId: ctxGame.state.id,
      type: 'draw',
      fromSide: ctxGame.side,
      fromPseudo: ctxGame.state.players[ctxGame.side]?.pseudo || 'Joueur',
      message: 'Proposition de nulle par accord.',
    });
  });

  socket.on('game_draw_response', ({ accept } = {}) => {
    const ctxGame = getSocketGameState(socket);
    if (!ctxGame) return socket.emit('game_action_error', { message: 'Aucune partie active.' });
    if (!ctxGame.state.drawOfferSide || ctxGame.state.drawOfferSide === ctxGame.side) {
      return socket.emit('game_action_error', { message: 'Aucune proposition de nulle adverse.' });
    }
    const proposerSide = ctxGame.state.drawOfferSide;
    ctxGame.state.drawOfferSide = null;
    ctxGame.state.drawOfferAt = null;
    if (accept) {
      const result = gm.agreedDraw(socket.id);
      if (result.error) return socket.emit('game_action_error', { message: result.error });
      return emitGameOver(result);
    }
    io.to('game:' + ctxGame.state.id).emit('game_action_notice', {
      gameId: ctxGame.state.id,
      type: 'draw_declined',
      fromSide: ctxGame.side,
      toSide: proposerSide,
      message: `${ctxGame.state.players[ctxGame.side]?.pseudo || 'L adversaire'} refuse la nulle.`,
    });
  });

  socket.on('game_resign', () => {
    const result = gm.resign(socket.id);
    if (result.error) return socket.emit('game_action_error', { message: result.error });
    emitGameOver(result);
  });

  socket.on('game_rematch_request', () => {
    const last = socket.lastFinishedGame;
    if (!last || Date.now() - Number(last.finishedAt || 0) > 5 * 60 * 1000) {
      return socket.emit('game_action_error', { message: 'Revanche expiree.' });
    }
    const myId = Number(socket.playerId);
    const p1Id = Number(last.players?.[1]?.id);
    const p2Id = Number(last.players?.[2]?.id);
    const targetId = myId === p1Id ? p2Id : p1Id;
    if (!targetId || targetId === myId) return socket.emit('game_action_error', { message: 'Adversaire introuvable.' });
    const id = `${last.gameId}:${myId}:${targetId}`;
    const request = { id, gameId: last.gameId, fromId: myId, targetId, gameType: last.gameType, variant: normalizeVariant(last.variant), createdAt: Date.now() };
    gameRematchRequests.set(id, request);
    const from = getPlayerRecord(myId) || socket.playerData || {};
    socket.emit('game_action_notice', { type: 'rematch_sent', message: 'Demande de revanche envoyee.' });
    getOnlineSocketsForPlayer(targetId).forEach(s => s.emit('game_action_offer', {
      gameId: last.gameId,
      type: 'rematch',
      requestId: id,
      fromId: myId,
      fromPseudo: from.pseudo || 'Adversaire',
      message: 'Demande de revanche.',
    }));
  });

  socket.on('game_rematch_response', ({ requestId, accept } = {}) => {
    const request = gameRematchRequests.get(String(requestId || ''));
    if (!request || request.targetId !== Number(socket.playerId)) {
      return socket.emit('game_action_error', { message: 'Demande de revanche introuvable.' });
    }
    gameRematchRequests.delete(request.id);
    const requesterSockets = getOnlineSocketsForPlayer(request.fromId);
    if (!accept) {
      requesterSockets.forEach(s => s.emit('game_action_notice', { type: 'rematch_declined', message: 'Revanche refusee.' }));
      socket.emit('game_action_notice', { type: 'rematch_declined', message: 'Tu as refuse la revanche.' });
      return;
    }
    const s1 = requesterSockets[0];
    const s2 = socket;
    const p1 = getPlayerRecord(request.fromId);
    const p2 = getPlayerRecord(request.targetId);
    if (!s1 || !s2 || !p1 || !p2) {
      return socket.emit('game_action_error', { message: 'Impossible de lancer la revanche.' });
    }
    s1.lastFinishedGame = null;
    s2.lastFinishedGame = null;
    _startMatch(
      { ...sanitize(p1), socketId: s1.id },
      { ...sanitize(p2), socketId: s2.id },
      { gameType: String(request.gameType || 'ranked') === 'friendly' ? 'friendly' : 'ranked', variant: request.variant }
    );
  });

  socket.on('color_update', ({ color }) => {
    if (!socket.playerData || !color) return;
    if (!/^#[0-9a-fA-F]{6}$/.test(color)) return;
    if (!isAnonymousPlayerId(socket.playerData.id)) {
      pQ.updateColor.run({ color, id: socket.playerData.id });
    }
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
      const variant = normalizeVariant(gameRow.variant);
      const variantConfig = getVariant(variant);
      const board = new Board(variantConfig);
      moves.forEach(m => board.drop(m.col, gameRow.player1_id === m.player_id ? 1 : 2));
      const firstMoveSide = moves[0]
        ? (Number(gameRow.player1_id) === Number(moves[0].player_id) ? 1 : 2)
        : 1;
      const nextSide = moves.length % 2 === 0
        ? firstMoveSide
        : (firstMoveSide === 1 ? 2 : 1);
      const p1db = pQ.getById.get(gameRow.player1_id);
      const p2db = pQ.getById.get(gameRow.player2_id);
      if (variant !== 'classic') {
        variantQ.ensure.run(p1db.id, variant);
        variantQ.ensure.run(p2db.id, variant);
        p1db.elo = variantQ.get.get(p1db.id, variant).elo;
        p2db.elo = variantQ.get.get(p2db.id, variant).elo;
      }
      const tournamentRow = gameRow.tournament_id ? tQ.getById.get(gameRow.tournament_id) : null;
      state = {
        id: gameId, board,
        variant, variantConfig,
        players: {
          1: { ...sanitize(p1db), color: gameRow.p1_color || p1db.color || '#ff2d55', shape: gameRow.p1_shape || p1db.shape || 'circle', socketId: null },
          2: { ...sanitize(p2db), color: gameRow.p2_color || p2db.color || '#ffd60a', shape: gameRow.p2_shape || p2db.shape || 'circle', socketId: null },
        },
        current: nextSide,
        startedAt: Date.now(), lastMoveAt: Date.now(),
        moveCount: moves.length, status: 'active',
        tournamentId: gameRow.tournament_id || null,
        tournamentName: tournamentRow?.name || '',
        gameType: String(gameRow.game_type || 'ranked') === 'friendly' ? 'friendly' : 'ranked',
        moveTimeSeconds: Number(gameRow.tournament_move_time_seconds || 0) || 60,
        turnTimeLimitMs: (Number(gameRow.tournament_move_time_seconds || 0) || 60) * 1000,
        persisted: true,
        bombs: { 1: true, 2: true }, antiSegments: { 1: new Set(), 2: new Set() }, antiScores: { 1: 0, 2: 0 },
        missions: { 1: null, 2: null }, simultaneousChoices: { 1: null, 2: null }, initiative: nextSide,
      };
      gm.games.set(gameId, state);
    }

    const side = state.players[1].id === socket.playerId ? 1
               : state.players[2].id === socket.playerId ? 2 : null;

    if (side) {
      if (state.players[side].socketId) gm.socketToGame.delete(state.players[side].socketId);
      state.players[side].socketId = socket.id;
      state.players[side].disconnectedAt = null;
      gm.socketToGame.set(socket.id, gameId);

      // Envoyer l'AAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAAtat complet de la partie au client qui rejoint
      const p1 = state.players[1], p2 = state.players[2];
      socket.emit('game_rejoined', {
        gameId,
        variant: state.variant,
        variantConfig: state.variantConfig,
        missions: state.variant === 'mission' ? MISSION_DEFINITIONS : [],
        selectedMissionId: state.variant === 'mission' ? state.missions?.[side] || null : null,
        side,
        gameType: String(state.gameType || 'ranked'),
        moveTimeSeconds: Number(state.moveTimeSeconds || 0) || 60,
        tournament: state.tournamentId ? {
          id: Number(state.tournamentId),
          name: state.tournamentName || 'Tournoi',
          moveTimeSeconds: Number(state.moveTimeSeconds || 0) || 0,
        } : null,
        players: {
          1: { id: p1.id, pseudo: p1.pseudo, elo: p1.elo, color: p1.color || '#ff2d55', avatar: p1.avatar || '', shape: p1.shape || 'circle', token_emoji_image: p1.token_emoji_image || '', token_rgb: Number(p1.pseudo_rgb || 0) === 1, avatar_decoration: p1.avatar_decoration || '', search_nameplate: p1.search_nameplate || '', profile_banner: p1.profile_banner || '', color_secondary: p1.color_secondary || '' },
          2: { id: p2.id, pseudo: p2.pseudo, elo: p2.elo, color: p2.color || '#ffd60a', avatar: p2.avatar || '', shape: p2.shape || 'circle', token_emoji_image: p2.token_emoji_image || '', token_rgb: Number(p2.pseudo_rgb || 0) === 1, avatar_decoration: p2.avatar_decoration || '', search_nameplate: p2.search_nameplate || '', profile_banner: p2.profile_banner || '', color_secondary: p2.color_secondary || '' },
        },
        grid:    state.board.grid,
        current: state.current,
        moves:   state.moveCount,
        startsIn: 0,
        latencies: getGameLatencyPayload(state),
        antiScores: state.antiScores,
        bombs: state.bombs,
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
    const liveSpectatedGameId = socket.liveSpectateGameId;
    leaveLiveSpectate(socket);
    // Mettre AAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAA  jour last_seen et nettoyer onlineSockets
    if (socket.playerId) {
      const disconnectedPlayerId = socket.playerId;
      if (!isAnonymousPlayerId(socket.playerId)) rQ.updateLastSeen.run(Date.now(), socket.playerId);
      const socks = onlineSockets.get(socket.playerId);
      if (socks) {
        socks.delete(socket.id);
        if (socks.size === 0) {
          onlineSockets.delete(socket.playerId);
          if (!isAnonymousPlayerId(disconnectedPlayerId)) {
            scheduleDiscordConnectedRemoval(disconnectedPlayerId);
            scheduleCrystalLoginClear(disconnectedPlayerId);
          }
        }
      }
    }
    const afterCounts = getPresenceCounts();
    const after = `${afterCounts.onlinePlayers}:${afterCounts.visitors}`;
    if (before !== after) broadcastPresenceCounts();
    if (liveSpectatedGameId) emitLiveUpdate();
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
            emitGameOver(result);
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
              emitGameOver(result);
            }
          }, 30000);
          return;
        }
      }
    }
    const result = gm.disconnect(socket.id);
    if (result?.type === 'game_over') emitGameOver(result);
  });
});

function _startMatch(p1, p2, options = {}) {
  options.variant = normalizeVariant(options.variant || p1.variant || p2.variant);
  if (options.variant !== 'classic') {
    variantQ.ensure.run(p1.id, options.variant);
    variantQ.ensure.run(p2.id, options.variant);
    p1.elo = variantQ.get.get(p1.id, options.variant).elo;
    p2.elo = variantQ.get.get(p2.id, options.variant).elo;
  }
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
  broadcastPresenceCounts(true);
  const room  = 'game:' + state.id;
  s1.join(room);
  s2.join(room);

  const base = {
    gameId: state.id,
    variant: state.variant,
    variantConfig: state.variantConfig,
    missions: state.variant === 'mission' ? MISSION_DEFINITIONS : [],
    gameType: String(state.gameType || options.gameType || 'ranked'),
    moveTimeSeconds: Number(state.moveTimeSeconds || 0) || 60,
    tournament: options.tournamentId ? {
      id: Number(options.tournamentId),
      name: options.tournamentName || 'Tournoi',
      moveTimeSeconds: Number(options.moveTimeSeconds || 0) || 0,
    } : null,
    players: {
      1: { id: p1.id, pseudo: p1.pseudo, elo: p1.elo, color: _c1, avatar: p1.avatar || '', shape: p1.shape || 'circle', token_emoji_image: p1.token_emoji_image || '', token_rgb: Number(p1.pseudo_rgb || 0) === 1, avatar_decoration: p1.avatar_decoration || '', search_nameplate: p1.search_nameplate || '', profile_banner: p1.profile_banner || '', color_secondary: p1.color_secondary || '' },
      2: { id: p2.id, pseudo: p2.pseudo, elo: p2.elo, color: _c2, avatar: p2.avatar || '', shape: p2.shape || 'circle', token_emoji_image: p2.token_emoji_image || '', token_rgb: Number(p2.pseudo_rgb || 0) === 1, avatar_decoration: p2.avatar_decoration || '', search_nameplate: p2.search_nameplate || '', profile_banner: p2.profile_banner || '', color_secondary: p2.color_secondary || '' },
    },
    latencies: getGameLatencyPayload(state),
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
  return state;
}

// AAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAA 404 AAaAa AaaAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAA toute route non matchAAaAa AaaAAaA AAAasAAazAAAaAAAasAA...AAAaAAasAAe AAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAAAAaAa AaaAAaAAasAAAAaAasAAAAAAAAasAA...AAasAAAAaAAasAAAAaAasAAAAAAAAaAAAAaAAAAaAAasAA
app.use((req, res) => {
  // Les routes API renvoient du JSON, les pages HTML renvoient la 404
  if (req.path.startsWith('/api/') || req.path.startsWith('/socket.io/')) {
    return res.status(404).json({ error: 'Route introuvable' });
  }
  res.status(404).sendFile(path.join(__dirname, 'public/404.html'));
});

const PORT = Number(process.env.SERVER_PORT || process.env.PORT || 3000);
const HTTP_HOST = process.env.SERVER_HOST || '0.0.0.0';
function buildDiscordBotContext() {
  return {
    db,
    pQ,
    gQ,
    mQ,
    bQ,
    tQ,
    shopItemQ,
    SHOP_ITEMS,
    getRank,
    hashPwd,
    notifyPlayerProfileChanged,
    grantCrystal,
    syncPlayerDiscordRankRole,
    syncOnlineDiscordConnectedRoles,
    getPresenceCounts,
    getOnlinePlayers,
    publicBotRuntime,
    getBoostDisplayName,
    gm,
    mm,
    BOT_PLAYER_ID,
    DISCORD_GUILD,
    ADMIN_PASSWORD,
    discordConfig,
    getDiscordRole,
    createDuelChallenge,
    readSystemStatus,
    writeSystemStatus,
    findTournamentByRef,
    finalizeTournament,
    clearTournamentQueue,
    tournamentQueues,
    io,
    WH,
  };
}

initDb().then(() => {
  server.listen(PORT, HTTP_HOST, () => {
    console.log(`[HTTP] http://${HTTP_HOST}:${PORT}`);
    logYtdlpStatus();
    if (String(process.env.DISCORD_CLEAR_CONNECTED_ON_BOOT || '0') === '1') {
      clearAllDiscordConnectedRoles().catch(error => console.warn('[DISCORD CONNECTED ROLE]', error.message));
    }
    restartActiveBotHosts();
    startDiscordBot(buildDiscordBotContext());
  });
}).catch(e => { console.error('DB init failed:', e); process.exit(1); });

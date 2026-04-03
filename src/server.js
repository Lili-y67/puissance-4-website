require('dotenv').config();
const express    = require('express');
const http       = require('http');
const { Server } = require('socket.io');
const path       = require('path');
const crypto     = require('crypto');

const { initDb, db, pQ, gQ, mQ, fQ, sQ, abQ, rQ, bQ, vipQ } = require('./db/db');
const { getRank } = require('./rank');
const { Client, GatewayIntentBits, EmbedBuilder, ActivityType, REST, Routes, ActionRowBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder, AttachmentBuilder } = require('discord.js');

// Map IP → Set<playerId> — en mémoire uniquement, reset au redémarrage
const ipToPlayers  = new Map(); // ip → Set of playerIds
const playerToIp   = new Map(); // playerId → ip
const onlineSockets = new Map(); // playerId → Set of socketIds (multi-onglets)
const { Matchmaking }         = require('./game/Matchmaking');
const { GameManager }         = require('./game/GameManager');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, {
  cors: { origin: '*' },
  transports: ['polling'],
  allowUpgrades: false,
});

const mm = new Matchmaking();
const gm = new GameManager();

// Callback AFK — émettre game_over quand un joueur est AFK trop longtemps
gm._onAfkEnd = (result) => {
  if (!result) return;
  io.to('game:' + result.gameId).emit('game_over', result);
  io.to('live').emit('live_update');
  console.log(`[AFK] Partie ${result.gameId} terminée — winner side ${result.winner}`);
};

// ── Utilitaires sécurité ──────────────────────────────────────────────────────
function getClientIp(req) {
  return (req.headers['x-forwarded-for'] || '').split(',')[0].trim()
    || req.socket?.remoteAddress
    || 'unknown';
}
function hashIp(ip) {
  // SHA-256 + sel fixe → non-réversible mais déterministe
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
  return Array.isArray(roleIds) && roleIds.includes(DISCORD_ROLE_VIP);
}

function isVipPlayer(player) {
  if (!player) return false;
  if (Number(player.is_vip) === 1) return true;
  try {
    const info = player.discord_info ? JSON.parse(player.discord_info) : null;
    return hasVipRoleIds((info?.server_roles || []).map(r => r.id));
  } catch(e) {
    return false;
  }
}

// ── Sessions tokens (SQLite) ──────────────────────────────────────────────────
let canvasFontsRegistered = false;
function ensureCanvasFonts() {
  if (canvasFontsRegistered) return;
  try {
    const { registerFont } = require('canvas');
    const fontsDir = path.join(__dirname, 'assets', 'fonts');
    registerFont(path.join(fontsDir, 'BarlowCondensed-Bold.ttf'), { family: 'Barlow Condensed', weight: '700' });
    registerFont(path.join(fontsDir, 'Barlow-Regular.ttf'), { family: 'Barlow', weight: '400' });
    registerFont(path.join(fontsDir, 'Barlow-SemiBold.ttf'), { family: 'Barlow', weight: '600' });
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
function validateSession(token) {
  if (!token) return null;
  const row = sQ.get.get(token);
  if (!row) return null;
  if (Date.now() > row.expires) { sQ.del.run(token); return null; }
  return row.player_id;
}
// Purger les sessions expirées au démarrage
try { sQ.purge.run(Date.now()); } catch(e) {}

// ── Bot Puissance4-AI ─────────────────────────────────────────────────────────
const BOT_PSEUDO = 'Puissance4-AI';
const BOT_AVATAR = 'https://i.pinimg.com/736x/71/c2/0a/71c20a784a800f78a2e7e0463a17b039.jpg';
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

// ── Archivage automatique des parties > 14 jours ─────────────────────────────
function archiveOldGames() {
  const cutoff = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
  const result = db.prepare(`
    UPDATE games SET archived = 1
    WHERE archived = 0
      AND status = 'finished'
      AND finished_at < ?
      AND finished_at IS NOT NULL
  `).run(cutoff);
  if (result.changes > 0) console.log(`[Archive] ${result.changes} partie(s) archivée(s)`);
}
// Lancer au démarrage puis toutes les heures
archiveOldGames();
setInterval(archiveOldGames, 60 * 60 * 1000);

app.use(express.json({ limit: '5mb' })); // pour les avatars base64
app.use(express.static(path.join(__dirname, 'public')));

// ── SPA routing ────────────────────────────────────────────────────────────────
app.get('/',           (_, res) => res.sendFile(path.join(__dirname, 'public/index.html')));
app.get('/game',       (_, res) => res.sendFile(path.join(__dirname, 'public/game.html')));
app.get('/game/bot',   (_, res) => res.sendFile(path.join(__dirname, 'public/game.html')));
app.get('/spec/:id', (req, res) => {
  const gameId = Number(req.params.id);
  const state = gm.games.get(gameId);
  if (!state || state.status !== 'active') {
    return res.sendFile(path.join(__dirname, 'public/404.html'));
  }
  res.sendFile(path.join(__dirname, 'public/game.html'));
});
app.get('/game/:id',   (_, res) => res.sendFile(path.join(__dirname, 'public/game.html')));

// ══════════════════════════════════════════════════════════════════════════════
// DISCORD RESET MOT DE PASSE
// ══════════════════════════════════════════════════════════════════════════════
// Variables Discord lues dynamiquement (Railway les injecte après démarrage)
function discordConfig() {
  return {
    clientId:     '1477252548090921060',
    clientSecret: 'zkIJArhzeumtKZJBxSmAtjEaE9Euugj8',
    botToken:     'MTQ3NzI1MjU0ODA5MDkyMTA2MA.GEJCC1.RcGqtpcrM8uFTqClZAVCILtiEMAxNisTFm3PuA',
    baseUrl:      process.env.BASE_URL || 'https://puissance-4-website-production.up.railway.app',
  };
}

// Page mot de passe oublié

// ── Suppression de compte ─────────────────────────────────────────────────────
app.delete('/api/players/:id', (req, res) => {
  const { token } = req.body;
  const id = Number(req.params.id);
  if (!token || validateSession(token) !== id) return res.status(403).json({ error: 'Non autorisé.' });

  // Anonymiser le pseudo dans les parties (garder l'historique)
  const pseudo = `Joueur_${id}`;
  db.prepare(`UPDATE players SET
    pseudo    = ?,
    password  = '',
    avatar    = '',
    color     = '#444444',
    discord_id = NULL,
    suspicious = 0
  WHERE id = ?`).run(pseudo, id);

  // Supprimer sessions, follows, reset_codes
  db.prepare(`DELETE FROM sessions    WHERE player_id = ?`).run(id);
  db.prepare(`DELETE FROM follows     WHERE follower_id = ? OR following_id = ?`).run(id, id);
  db.prepare(`DELETE FROM reset_codes WHERE player_id = ?`).run(id);

  // Marquer le compte comme supprimé
  db.prepare(`UPDATE players SET deleted = 1 WHERE id = ?`).run(id);

  res.json({ ok: true });
});


// ══════════════════════════════════════════════════════════════════════════════
// PANEL ADMIN
// ══════════════════════════════════════════════════════════════════════════════
function getOrCreateAdminPassword() {
  const row = db.prepare('SELECT value FROM config WHERE key = ?').get('admin_password');
  if (row) return row.value;
  const pwd = require('crypto').randomBytes(10).toString('hex'); // 20 chars hex
  db.prepare('INSERT INTO config (key, value) VALUES (?, ?)').run('admin_password', pwd);
  console.log(`[ADMIN] Mot de passe généré : ${pwd}`);
  return pwd;
}
const ADMIN_PASSWORD = getOrCreateAdminPassword();

app.get('/admin', (_, res) => res.sendFile(path.join(__dirname, 'public/admin.html')));

// Récupérer le mot de passe admin (réservé aux joueurs rôle admin)
app.get('/api/admin/password', async (req, res) => {
  const token = req.headers['x-token'];
  const playerId = validateSession(token);
  if (!playerId) return res.status(403).json({ error: 'Non autorisé.' });
  const player = pQ.getById.get(playerId);
  if (!player?.discord_id) return res.status(403).json({ error: 'Réservé aux administrateurs.' });
  let role = player.role;
  try {
    const { botToken } = discordConfig();
    const discordRole = await getDiscordRole(player.discord_id, botToken);
    if (discordRole !== player.role) {
      pQ.updateRole.run({ role: discordRole, id: playerId });
      role = discordRole;
    }
  } catch(e) {}
  if (role !== 'admin') return res.status(403).json({ error: 'Réservé aux administrateurs.' });
  res.json({ password: ADMIN_PASSWORD });
});

// Auth admin
// Sessions admin en mémoire
const adminSessions = new Map(); // token → { playerId, role }

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
  if (!player?.discord_id) return res.status(403).json({ error: 'Compte Discord requis pour accéder au panel.' });

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
    return res.status(403).json({ error: 'Ton rôle Discord ne permet pas l\'accès au panel.' });
  }

  const token = require('crypto').randomBytes(32).toString('hex');
  adminSessions.set(token, { playerId, role });
  setTimeout(() => adminSessions.delete(token), 4 * 60 * 60 * 1000); // 4h
  WH.wlogAdminLogin();
  res.json({ token, role });
});

// Route pour récupérer le rôle de la session courante
app.get('/api/admin/me', (req, res) => {
  const s = getAdminSession(req);
  if (!s) return res.status(403).json({ error: 'Non autorisé.' });
  res.json({ role: s.role, playerId: s.playerId });
});

// Liste tous les joueurs
app.get('/api/admin/players', (req, res) => {
  if (!isModo(req)) return res.status(403).json({ error: 'Non autorisé.' });
  const players = db.prepare(`SELECT id, pseudo, elo, role, is_vip, wins, losses, draws, suspicious, banned, muted_until, created_at, discord_id, discord_info, last_seen FROM players WHERE deleted = 0 ORDER BY elo DESC`).all();
  // Enrichir avec le statut en ligne
  const now = Date.now();
  const enriched = players.map(p => ({
    ...p,
    online: onlineSockets.has(p.id) && onlineSockets.get(p.id).size > 0,
    discord_linked: !!(p.discord_id),
  }));
  res.json(enriched);
});

// Changer le rôle
app.patch('/api/admin/players/:id/role', async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Seuls les admins peuvent changer les rôles.' });
  const { role } = req.body;
  if (!['user','vip','moderator','admin'].includes(role)) return res.status(400).json({ error: 'Rôle invalide.' });
  const target = pQ.getById.get(Number(req.params.id));
  if (!target) return res.status(404).json({ error: 'Joueur introuvable.' });
  const oldRole = target.role;
  const oldVip  = Number(target.is_vip) === 1;
  if (role === 'vip') {
    WH.wlogAdminAction('VIP accordé', target.pseudo, req.params.id, [['VIP avant', oldVip ? 'oui' : 'non', true], ['VIP après', 'oui', true]]);
    pQ.updateVip.run({ is_vip: 1, id: Number(req.params.id) });
  } else {
    WH.wlogAdminAction('Rôle changé', target.pseudo, req.params.id, [['Ancien', oldRole, true], ['Nouveau', role, true]]);
    pQ.updateRole.run({ role, id: Number(req.params.id) });
  }

  // Sync rôle Discord si lié
  if (target.discord_id) {
    try { await syncDiscordRole(target.discord_id, role === 'vip' ? target.role : role, role === 'vip' ? true : oldVip); } catch(e) {}
    // DM de notification
    try { await sendDM(target.discord_id, [
      '🎭 **Puissance 4 — Changement de rôle**',
      '',
      `Bonjour **${target.pseudo}** !`,
      '',
      role === 'vip'
        ? 'Le statut **VIP** vient de t’être attribué.'
        : `Ton rôle a été modifié : **${oldRole}** → **${role}**`,
      '_Si tu as des questions, contacte un administrateur sur le serveur Discord._',
    ].join('\n')); } catch(e) {}
  }
  res.json({ ok: true });
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
        '✏️ **Puissance 4 — Changement de pseudo**',
        '',
        `Bonjour !`,
        '',
        `Ton pseudo a été modifié par un administrateur : **${oldPseudo}** → **${pseudo.trim()}**`,
        '_Si tu n\'as pas demandé ce changement, contacte un administrateur._',
      ].join('\n')); } catch(e) {}
    }
    res.json({ ok: true });
  } catch(e) { res.status(400).json({ error: 'Pseudo déjà pris.' }); }
});

// Reset ELO
app.patch('/api/admin/players/:id/elo', (req, res) => {
  if (!isModo(req)) return res.status(403).json({ error: 'Non autorisé.' });
  const { elo } = req.body;
  const _pe = pQ.getById.get(Number(req.params.id));
  WH.wlogAdminAction('ELO reset', _pe?.pseudo || req.params.id, req.params.id, [['Ancien ELO', _pe?.elo ?? '?', true], ['Nouveau ELO', elo, true]]);
  db.prepare('UPDATE players SET elo = ? WHERE id = ?').run(Number(elo) || 1000, Number(req.params.id));
  res.json({ ok: true });
});

// Mute temporaire (interdit de jouer)
app.patch('/api/admin/players/:id/mute', (req, res) => {
  if (!isModo(req)) return res.status(403).json({ error: 'Non autorisé.' });
  const { hours } = req.body;
  const until = hours > 0 ? Date.now() + hours * 60 * 60 * 1000 : null;
  const _pm = pQ.getById.get(Number(req.params.id));
  WH.wlogMute(_pm?.pseudo || req.params.id, req.params.id, hours);
  pQ.setMute.run({ until, id: Number(req.params.id) });
  res.json({ ok: true });
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
  if (!isModo(req)) return res.status(403).json({ error: 'Non autorisé.' });
  abQ.setSuspicious.run({ val: 0, id: Number(req.params.id) });
  res.json({ ok: true });
});

app.get('/forgot-password', (_, res) => res.sendFile(path.join(__dirname, 'public/forgot-password.html')));
app.get('/reset-password',  (_, res) => res.sendFile(path.join(__dirname, 'public/reset-password.html')));


// ══════════════════════════════════════════════════════════════════════════════
// WEBHOOK DISCORD
// ══════════════════════════════════════════════════════════════════════════════
const WH = require('./webhooks');
const { wlog, mkEmbed: embed } = WH;

// ── Constantes Discord rôles ──────────────────────────────────────────────────
const DISCORD_GUILD    = '1477078197530263582';
const DISCORD_ROLE_ADM = '1480180456782827530';
const DISCORD_ROLE_MOD = '1480180483613655181';
const DISCORD_ROLE_VIP = '1489360367246114866'; // Rôle VIP

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

  // Vérifier si c'est le propriétaire du serveur (impossible à renommer)
  const guildRes = await fetch(`https://discord.com/api/v10/guilds/${DISCORD_GUILD}`, {
    headers: { 'Authorization': 'Bot ' + botToken },
  });
  const guild = await guildRes.json();
  if (guild.owner_id === discordId) {
    console.log(`[RENAME] Impossible : ${discordId} est le propriétaire du serveur.`);
    return;
  }

  const res = await fetch(`https://discord.com/api/v10/guilds/${DISCORD_GUILD}/members/${discordId}`, {
    method: 'PATCH',
    headers: { 'Authorization': 'Bot ' + botToken, 'Content-Type': 'application/json' },
    body: JSON.stringify({ nick: nickname }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    // 403 = hiérarchie insuffisante (rôle du membre >= bot)
    console.log(`[RENAME] Échec pour ${discordId} : ${res.status} — ${err.message || 'permission refusée'}`);
  }
}

// Synchroniser le rôle Discord d'un membre (ajoute/retire les rôles)
async function syncDiscordRole(discordId, role, isVip = false) {
  const { botToken } = discordConfig();
  if (!botToken) return;
  const STAFF_ROLES = [DISCORD_ROLE_ADM, DISCORD_ROLE_MOD];
  const STAFF_TARGET = role === 'admin' ? DISCORD_ROLE_ADM
                    : role === 'moderator' ? DISCORD_ROLE_MOD
                    : null;
  for (const rid of [...STAFF_ROLES, DISCORD_ROLE_VIP]) {
    const shouldHave = rid === DISCORD_ROLE_VIP ? !!isVip : rid === STAFF_TARGET;
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

// ── Job toutes les minutes — sync rôles Discord ────────────────────────────────
setInterval(async () => {
  const { botToken } = discordConfig();
  const linked = db.prepare(`SELECT id, pseudo, role, is_vip, discord_id, discord_info FROM players WHERE discord_id IS NOT NULL AND discord_id != '' AND deleted = 0`).all();
  for (const player of linked) {
    const newRole = await getDiscordRole(player.discord_id, botToken);
    const vipNow = isVipPlayer(player) ? 1 : 0;
    if (newRole !== player.role) {
      pQ.updateRole.run({ role: newRole, id: player.id });
      console.log(`[ROLE SYNC] ${player.pseudo} : ${player.role} → ${newRole}`);
      WH.wlogRoleSync(player.pseudo, player.role, newRole);
    }
    if (vipNow !== Number(player.is_vip)) {
      pQ.updateVip.run({ is_vip: vipNow, id: player.id });
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

// Étape 1 — Rediriger vers Discord OAuth (user-install, DM uniquement)
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

// Étape 2 — Callback Discord → envoyer le code par DM
app.get('/auth/discord/callback', async (req, res) => {
  const { code, state, error } = req.query;
  if (error || !code) return res.redirect('/forgot-password?error=discord_annulé');

  try {
    const stateData = JSON.parse(Buffer.from(state, 'base64').toString());
    const { playerId, ipHash } = stateData;
    const player = pQ.getById.get(playerId);
    if (!player) return res.redirect('/forgot-password?error=joueur_introuvable');

    const { clientId, clientSecret, baseUrl, botToken } = discordConfig();
    // Échanger le code contre un access_token
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
    if (!tokenData.access_token) return res.redirect('/forgot-password?error=discord_token');

    // Récupérer l'identité Discord
    const userRes = await fetch('https://discord.com/api/users/@me', {
      headers: { Authorization: 'Bearer ' + tokenData.access_token },
    });
    const discordUser = await userRes.json();
    if (!discordUser.id) return res.redirect('/forgot-password?error=discord_id');

    const { mode } = JSON.parse(Buffer.from(state, 'base64').toString());
    const freshPlayer = pQ.getById.get(playerId);

    if (mode === 'link') {
      // Récupérer les infos du membre sur le serveur Discord
      const { botToken: bt, baseUrl: bu } = discordConfig();
      let memberInfo = null;
      try {
        const mRes = await fetch(`https://discord.com/api/v10/guilds/${DISCORD_GUILD}/members/${discordUser.id}`, {
          headers: { Authorization: 'Bot ' + bt }
        });
        if (mRes.ok) memberInfo = await mRes.json();
      } catch(e) {}

      // Récupérer les rôles du guild avec noms et couleurs
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

      // Construire les rôles enrichis (id, nom, couleur hex)
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

      // Liaison depuis le profil — lier + envoyer DM de confirmation
      rQ.setDiscord.run(discordUser.id, JSON.stringify(discordInfo), playerId);
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
                '🎮 **Puissance 4 — Compte Discord lié !**\n\n',
                '',
                `Bonjour **${freshPlayer.pseudo}** ! 👋\n\n`,
                '',
                'Ton compte Discord a été **lié avec succès** à ton compte Puissance 4.\n\n',
                '',
                '🔑 Tu pourras désormais réinitialiser ton mot de passe via Discord si besoin.\n',
                "_Si tu n'es pas à l'origine de cette liaison, contacte un administrateur._\n\n",
                '',
                "-# 🔧 Si tu es Administrateur, rejoins le serveur pour récupérer les Permissions nécessaires : https://discord.gg/ap73mMTX7a"
              ].join(''),
            }),
          });
        }
      } catch(e) { console.error('[DM LINK]', e); }
      return res.redirect('/profil?discord_linked=1');
    }

    // Mode reset — vérifier que c'est le bon Discord
    if (freshPlayer.discord_id && freshPlayer.discord_id !== discordUser.id) {
      return res.redirect('/forgot-password?error=discord_mismatch');
    }
    if (!freshPlayer.discord_id) {
      rQ.setDiscord.run(discordUser.id, null, playerId);
    }

    // Générer le code à 6 chiffres (15 min)
    const code6    = String(Math.floor(100000 + Math.random() * 900000));
    const expires  = Date.now() + 15 * 60 * 1000;
    rQ.cleanup.run(Date.now());
    rQ.insert.run(playerId, code6, expires, ipHash || null);

    // Envoyer un DM via le bot
    // 1. Créer un DM channel
    const dmRes = await fetch('https://discord.com/api/v10/users/@me/channels', {
      method: 'POST',
      headers: {
        'Authorization': 'Bot ' + botToken,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({ recipient_id: discordUser.id }),
    });
    const dmData = await dmRes.json();
    if (!dmData.id) return res.redirect('/forgot-password?error=dm_impossible');

    // 2. Envoyer le message
    await fetch(`https://discord.com/api/v10/channels/${dmData.id}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': 'Bot ' + botToken,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({
        content: [
          '🎮 **Puissance 4 — Réinitialisation de mot de passe**',
          '',
          `Bonjour **${player.pseudo}** !`,
          '',
          `Votre code de réinitialisation est :`,
          '```',
          code6,
          '```',
          '⏳ Ce code expire dans **15 minutes**.',
          '',
          '_Si vous n\'avez pas demandé de réinitialisation, ignorez ce message._',
        ].join('\n'),
      }),
    });

    res.redirect('/reset-password?playerId=' + playerId);
  } catch (e) {
    console.error('[DISCORD RESET]', e);
    res.redirect('/forgot-password?error=erreur_serveur');
  }
});

// Étape 3 — Valider le code et changer le mot de passe
app.post('/api/reset-password', (req, res) => {
  const { playerId, code, newPassword } = req.body;
  if (!playerId || !code || !newPassword) return res.status(400).json({ error: 'Données manquantes.' });
  if (newPassword.length < 6) return res.status(400).json({ error: 'Mot de passe trop court (6 caractères min).' });

  const row = rQ.getValid.get(Number(playerId), String(code), Date.now());
  if (!row) return res.status(400).json({ error: 'Code invalide ou expiré.' });

  // Vérifier que c'est la même IP qui a demandé le reset
  if (row.ip_hash) {
    const clientIp   = getClientIp(req);
    const clientHash = hashIp(clientIp);
    if (clientHash !== row.ip_hash) {
      console.warn(`[reset-password] IP mismatch — demande: ${row.ip_hash.slice(0,8)}… soumission: ${clientHash.slice(0,8)}…`);
      return res.status(403).json({ error: 'Réinitialisation refusée : adresse IP différente de celle de la demande. Recommence depuis le début.' });
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
app.get('/cgu',         (_, res) => res.sendFile(path.join(__dirname, 'public/cgu.html')));

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
        // Si les deux joueurs ont la même couleur, forcer p2 en jaune
        if (c1.toLowerCase() === c2.toLowerCase()) c2 = '#ffd60a';
        return {
          1: { id: state.players[1].id, pseudo: state.players[1].pseudo, elo: state.players[1].elo, color: c1, avatar: state.players[1].avatar || '', shape: state.players[1].shape || 'circle' },
          2: { id: state.players[2].id, pseudo: state.players[2].pseudo, elo: state.players[2].elo, color: c2, avatar: state.players[2].avatar || '', shape: state.players[2].shape || 'circle' },
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

// ── Hash password ──────────────────────────────────────────────────────────────
function hashPwd(pwd) {
  return crypto.createHash('sha256').update(pwd + 'p4salt2024').digest('hex');
}

// ── Auth API ───────────────────────────────────────────────────────────────────

// Inscription
app.post('/api/auth/register', (req, res) => {
  const { pseudo, password } = req.body;
  if (!pseudo?.trim() || !password) return res.status(400).json({ error: 'Pseudo et mot de passe requis.' });
  if (pseudo.trim().length < 2) return res.status(400).json({ error: 'Pseudo trop court (2 caractères min).' });
  if (password.length < 4)     return res.status(400).json({ error: 'Mot de passe trop court (4 caractères min).' });

  const existing = pQ.getByPseudo.get(pseudo.trim());
  if (existing) return res.status(409).json({ error: 'Ce pseudo est déjà pris.' });

  try {
    let player = pQ.register.get({ pseudo: pseudo.trim(), password: hashPwd(password) });
    // Sauvegarder la couleur choisie à l'inscription
    if (req.body.color && /^#[0-9a-fA-F]{6}$/.test(req.body.color)) {
      pQ.updateColor.run({ color: req.body.color, id: player.id });
      player = pQ.getById.get(player.id);
    }
    const token = createSession(player.id);
    res.json({ ...sanitize(player), token });
  } catch(e) {
    console.error('[register]', e);
    res.status(500).json({ error: e.message });
  }
});

// Connexion
app.post('/api/auth/login', (req, res) => {
  const { pseudo, password } = req.body;
  if (!pseudo?.trim() || !password) return res.status(400).json({ error: 'Pseudo et mot de passe requis.' });

  const player = pQ.getByPseudo.get(pseudo.trim());
  if (!player) return res.status(401).json({ error: 'Pseudo introuvable.' });

  // Support anciens comptes sans mot de passe (migration)
  if (player.password && player.password !== hashPwd(password))
    return res.status(401).json({ error: 'Mot de passe incorrect.' });

  const token = createSession(player.id);
  res.json({ ...sanitize(player), token });
});

// Ne jamais renvoyer le hash du mot de passe au client
function sanitize(p) {
  const { password, ...rest } = p;
  // Masquer les infos perso si compte supprimé
  if (rest.deleted) {
    return {
      ...rest,
      pseudo:     '[Supprimé]',
      avatar:     '',
      color:      '#555555',
      discord_id: null,
      banner:     null,
      is_vip:     0,
    };
  }
  return {
    ...rest,
    is_vip: isVipPlayer(rest) ? 1 : 0,
  };
}

// ── Players API ────────────────────────────────────────────────────────────────
// Fermeture de compte
app.delete('/api/players/:id', (req, res) => {
  const { token } = req.body;
  const id = Number(req.params.id);
  if (!token || validateSession(token) !== id) return res.status(403).json({ error: 'Non autorisé.' });

  // Anonymiser le pseudo (les parties gardent le pseudo au moment du jeu via les colonnes p1_pseudo etc.)
  // puis supprimer le joueur — les FK ON DELETE CASCADE nettoient sessions/reset_codes
  // Les parties restent intactes (pas de FK cascade sur games)
  // Anonymiser + marquer deleted — on garde le joueur en DB pour les parties historiques
  db.prepare(`UPDATE players SET
    pseudo     = '[Supprimé]',
    password   = '',
    color      = '#555555',
    avatar     = '',
    discord_id = NULL,
    deleted    = 1
  WHERE id = ?`).run(id);
  db.prepare(`DELETE FROM sessions WHERE player_id = ?`).run(id);

  res.json({ ok: true });
});

app.patch('/api/players/:id/shape', (req, res) => {
  const { shape, token } = req.body;
  const base = shape?.split(':')[0];
  const allowed = ['circle','triangle','diamond','star','heart','emoji'];
  if (!base || !allowed.includes(base)) return res.status(400).json({ error: 'Forme invalide.' });
  if (!token || validateSession(token) !== Number(req.params.id)) return res.status(403).json({ error: 'Non autorisé.' });
  pQ.updateShape.run({ shape, id: Number(req.params.id) }); // stocke 'circle' ou 'emoji:⭐'
  res.json({ ok: true });
});

app.patch('/api/players/:id/color', (req, res) => {
  if (Number(req.params.id) === BOT_PLAYER_ID) return res.status(403).json({ error: 'Bot non modifiable.' });
  const { color, token } = req.body;
  if (!color || !/^#[0-9a-fA-F]{6}$/.test(color)) return res.status(400).json({ error: 'Couleur invalide.' });
  if (!token || validateSession(token) !== Number(req.params.id)) return res.status(403).json({ error: 'Non autorisé.' });
  pQ.updateColor.run({ color, id: Number(req.params.id) });
  res.json({ ok: true });
});

app.patch('/api/players/:id/banner', (req, res) => {
  const { banner, token } = req.body;
  if (!token || validateSession(token) !== Number(req.params.id)) return res.status(403).json({ error: 'Non autorisé.' });
  if (!banner || !banner.startsWith('data:image/')) return res.status(400).json({ error: 'Image invalide.' });
  if (banner.length > 6 * 1024 * 1024) return res.status(400).json({ error: 'Bannière trop lourde (max 4MB).' });
  pQ.updateBanner.run({ banner, id: Number(req.params.id) });
  const _pBanner = pQ.getById.get(Number(req.params.id));
  WH.wlogBanner(_pBanner?.pseudo || req.params.id, req.params.id, Math.round(banner.length / 1024));
  res.json({ ok: true });
});

app.patch('/api/players/:id/avatar', (req, res) => {
  const { avatar, token } = req.body;
  if (!token || validateSession(token) !== Number(req.params.id)) return res.status(403).json({ error: 'Non autorisé.' });
  if (!avatar || !avatar.startsWith('data:image/'))
    return res.status(400).json({ error: 'Image invalide.' });
  if (avatar.length > 3 * 1024 * 1024) // ~2MB base64
    return res.status(413).json({ error: 'Image trop lourde (max 2MB).' });
  pQ.updateAvatar.run({ avatar, id: Number(req.params.id) });
  const _pAvatar = pQ.getById.get(Number(req.params.id));
  WH.wlogAvatar(_pAvatar?.pseudo || req.params.id, req.params.id, Math.round(avatar.length / 1024));
  res.json({ ok: true });
});

// Autocomplete pseudo — min 3 chars, max 8 résultats, exclu bots et supprimés
app.get('/api/players/search', (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    if (q.length < 3) return res.json([]);
    // Autoriser alphanum + _ + - + . (suffisant, pas de regex bloquante)
    if (q.length > 20) return res.json([]);
    const rows = db.prepare(`
      SELECT id, pseudo, elo, avatar, color
      FROM players
      WHERE pseudo LIKE ? COLLATE NOCASE
        AND deleted = 0
      ORDER BY elo DESC LIMIT 8
    `).all(q.replace(/%/g, '') + '%');
    res.json(rows.map(p => ({ id: p.id, pseudo: p.pseudo, elo: p.elo, avatar: p.avatar, color: p.color })));
  } catch(e) {
    console.error('[search]', e.message);
    res.json([]);
  }
});

app.get('/api/players/by-pseudo/:pseudo', (req, res) => {
  const p = pQ.getByPseudo.get(req.params.pseudo);
  if (!p) return res.status(404).json({ error: 'Introuvable' });
  res.json(sanitize(p));
});

app.get('/api/players/:id', (req, res) => {
  const player = pQ.getById.get(Number(req.params.id));
  if (!player || (player.deleted && player.id !== BOT_PLAYER_ID)) return res.status(404).json({ error: 'Compte supprimé' });
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

  // Précision moyenne (parties analysées uniquement)
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

// Follow / Unfollow
app.post('/api/players/:id/follow', (req, res) => {
  const { followerId } = req.body;
  if (!followerId) return res.status(400).json({ error: 'followerId requis' });
  const target = Number(req.params.id);
  if (followerId === target) return res.status(400).json({ error: 'Tu ne peux pas te suivre toi-même.' });
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

// ── Sauvegarde analyse complète ──────────────────────────────────────────────
app.post('/api/games/:id/analysis', (req, res) => {
  const { results, evalHistory, accuracy } = req.body;
  const gameId = Number(req.params.id);
  if (!gameId) return res.status(400).json({ error: 'ID invalide' });
  const data = JSON.stringify({ results, evalHistory, accuracy });
  rQ.saveAnalysis.run(data, gameId);
  // Sauvegarder aussi la précision
  if (accuracy && typeof accuracy.p1 === 'number') {
    rQ.setAccuracy.run(accuracy.p1, accuracy.p2, gameId);
  }
  res.json({ ok: true });
});

// Route GET pour récupérer l'analyse existante
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

// ── Sauvegarde précision d'analyse ──────────────────────────────────────────
app.post('/api/games/:id/accuracy', (req, res) => {
  const { p1_accuracy, p2_accuracy } = req.body;
  const gameId = Number(req.params.id);
  if (!gameId) return res.status(400).json({ error: 'ID invalide' });
  if (typeof p1_accuracy !== 'number' || typeof p2_accuracy !== 'number')
    return res.status(400).json({ error: 'Valeurs invalides' });
  rQ.setAccuracy.run(p1_accuracy, p2_accuracy, gameId);
  res.json({ ok: true });
});

// ── Statut en ligne ──────────────────────────────────────────────────────────
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

// ── Discord info + déliaison ─────────────────────────────────────────────────
// Infos Discord enrichies du joueur connecté
app.get('/api/me/discord-info', (req, res) => {
  const token = req.headers['x-session-token'];
  const playerId = token ? validateSession(token) : null;
  if (!playerId) return res.status(401).json({ error: 'Non authentifié' });

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
    512:     'Supporter précoce',
    131072:  'Bug Hunter Lvl 2',
    4194304: 'Développeur actif',
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

// Demander un code de déliaison Discord → envoi DM via bot
app.post('/api/discord/unlink/request', async (req, res) => {
  const token = req.headers['x-session-token'];
  const playerId = token ? validateSession(token) : null;
  if (!playerId) return res.status(401).json({ error: 'Non authentifié' });

  const player = pQ.getById.get(playerId);
  if (!player?.discord_id) return res.status(400).json({ error: 'Aucun Discord lié' });

  const { botToken } = discordConfig();
  if (!botToken) return res.status(503).json({ error: 'Bot Discord indisponible' });

  // Générer code 6 chiffres
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
          '🔓 **Puissance 4 — Déliaison Discord**',
          '',
          `Bonjour **${player.pseudo}** !`,
          '',
          'Tu as demandé à **délier** ton compte Discord de ton compte Puissance 4.',
          '',
          'Ton code de confirmation :',
          '```',
          code6,
          '```',
          '⏳ Ce code expire dans **10 minutes**.',
          '',
          '_Si tu n\'es pas à l\'origine de cette demande, ignore ce message. Ton compte reste lié._',
        ].join('\n'),
      }),
    });

    res.json({ ok: true });
  } catch(e) {
    console.error('[UNLINK REQUEST]', e);
    res.status(500).json({ error: 'Erreur envoi DM' });
  }
});

// Confirmer la déliaison avec le code
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
  // Endpoint appelé par replay.html au chargement
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

// ── Bot replay (sans stats ELO) ──────────────────────────────────────────────
app.post('/api/bot-replay', (req, res) => {
  try {
  const { token, moves, winner, duration, p1Color, p2Color, botName, difficulty } = req.body;
  const playerId = token ? validateSession(token) : null;

  // Récupérer le vrai joueur pour sa couleur et forme perso
  const p1 = playerId ? pQ.getById.get(playerId) : null;
  const realP1Color = p1?.color || p1Color || '#ff2d55';
  const realP1Shape = p1?.shape || 'circle';

  const botPlayerId = BOT_PLAYER_ID;
  const p1Id     = playerId || botPlayerId;
  const isDraw   = winner === null;
  const winnerId = isDraw ? null : (winner === 1 ? p1Id : botPlayerId);
  const loserId  = isDraw ? null : (winner === 1 ? botPlayerId : p1Id);

  // ── Calcul ELO — seulement le bot est impacté ─────────────────────────────
  const botPlayer = pQ.getById.get(botPlayerId);
  const botColor  = botPlayer?.color || '#ffd60a';
  const botShape  = botPlayer?.shape || 'circle';
  const humanElo  = p1?.elo ?? 1000;
  const botElo    = botPlayer?.elo ?? 1000;

  // Calcul ELO bot selon la difficulté
  function randInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
  const K = 32;
  const expBot = 1 / (1 + Math.pow(10, (humanElo - botElo) / 400));
  let botDelta = 0;

  if (difficulty === 'easy') {
    // Facile : win +15→+30 / perd -1→-5 / nul = standard
    if (isDraw)       botDelta = Math.round(K * (0.5 - expBot));
    else if (winner === 2) botDelta = +randInt(15, 30);
    else                   botDelta = -randInt(1, 5);

  } else if (difficulty === 'hard') {
    // Difficile : win +5→+10 / perd -10→-20 / nul = standard
    if (isDraw)       botDelta = Math.round(K * (0.5 - expBot));
    else if (winner === 2) botDelta = +randInt(5, 10);
    else                   botDelta = -randInt(10, 20);

  } else {
    // Moyen (et fallback) : formule ELO standard
    if (isDraw)       botDelta = Math.round(K * (0.5 - expBot));
    else if (winner === 2) botDelta = Math.round(K * (1 - expBot));
    else                   botDelta = Math.round(K * (0 - expBot));
  }

  // Appliquer delta ELO uniquement au bot
  pQ.updateElo.run({ delta: botDelta, id: botPlayerId });
  if (isDraw)        { pQ.draw.run(botPlayerId); }
  else if (winner === 2) { pQ.win.run(botPlayerId); }
  else               { pQ.loss.run(botPlayerId); }

  // Si pas de joueur connecté, on abandonne proprement (pas de replay sauvegardé)
  if (!playerId) return res.status(200).json({ gameId: null, reason: 'not_logged_in' });

  // Vérification FK
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

  // Insérer les coups avec calcul de la row (rejouer la grille)
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

// ID du bot système (pour affichage dans les replays)
// Rafraîchir les rôles Discord d'un joueur connecté
app.post('/api/players/:id/refresh-discord', async (req, res) => {
  const { token } = req.body;
  const id = Number(req.params.id);
  if (!token || validateSession(token) !== id) return res.status(403).json({ error: 'Non autorisé.' });
  const player = pQ.getById.get(id);
  if (!player?.discord_id) return res.status(400).json({ error: 'Pas de compte Discord lié.' });
  try {
    const { botToken: bt } = discordConfig();
    const [mRes, rolesRes] = await Promise.all([
      fetch(`https://discord.com/api/v10/guilds/${DISCORD_GUILD}/members/${player.discord_id}`, { headers: { Authorization: 'Bot ' + bt } }),
      fetch(`https://discord.com/api/v10/guilds/${DISCORD_GUILD}/roles`, { headers: { Authorization: 'Bot ' + bt } }),
    ]);
    if (!mRes.ok) {
      rQ.clearDiscord.run(id);
      pQ.updateRole.run({ role: 'user', id });
      revokeAdminSessionsForPlayer(id);
      return res.status(404).json({ error: 'Membre introuvable sur le serveur.', unlinked: true, role: 'user' });
    }
    const memberInfo = await mRes.json();
    const guildRoles = rolesRes.ok ? await rolesRes.json() : [];
    const rolesMap = {};
    guildRoles.forEach(r => { rolesMap[r.id] = { name: r.name, color: r.color }; });
    const server_roles_rich = (memberInfo.roles || [])
      .map(rid => ({ id: rid, name: rolesMap[rid]?.name || rid, color: rolesMap[rid]?.color ? '#' + rolesMap[rid].color.toString(16).padStart(6,'0') : null }))
      .filter(r => r.name !== '@everyone');
    const newRole = await getDiscordRole(player.discord_id, bt);
    if (newRole !== player.role) pQ.updateRole.run({ role: newRole, id });
    const vipNow = hasVipRoleIds(memberInfo.roles || []) ? 1 : Number(player.is_vip || 0);
    if (vipNow !== Number(player.is_vip || 0)) pQ.updateVip.run({ is_vip: vipNow, id });
    // Mettre à jour discord_info
    const existing = player.discord_info ? JSON.parse(player.discord_info) : {};
    const updated = {
      ...existing,
      server_roles: server_roles_rich,
      server_nick: memberInfo.nick || existing.server_nick,
      server_joined: memberInfo.joined_at || existing.server_joined || null,
      boosting_since: memberInfo.premium_since || null,
    };
    rQ.setDiscord.run(player.discord_id, JSON.stringify(updated), id);
    res.json({ ok: true, roles: server_roles_rich, role: newRole, is_vip: vipNow });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/bot-id', (_, res) => {
  const bot = pQ.getById.get(BOT_PLAYER_ID);
  res.json({ id: BOT_PLAYER_ID, pseudo: BOT_PSEUDO, color: bot?.color || '#ffd60a', shape: bot?.shape || 'circle' });
});

// ── Boost VIP individuel ──────────────────────────────────────────────────────
// Activation : 1h, 1x par jour (reset à minuit)
app.post('/api/players/:id/vip-boost', (req, res) => {
  const { token } = req.body;
  const id = Number(req.params.id);
  if (!token || validateSession(token) !== id) return res.status(403).json({ error: 'Non autorisé.' });

  const player = pQ.getById.get(id);
  if (!player) return res.status(404).json({ error: 'Joueur introuvable.' });
  if (!isVipPlayer(player)) return res.status(403).json({ error: 'Réservé aux VIP.' });

  const now = Date.now();
  // Vérifier si déjà actif
  const currentBoost = vipQ.getActive.get(id, now);
  if (currentBoost) {
    const remaining = Math.round((currentBoost.expires_at - now) / 60000);
    return res.status(400).json({ error: `Boost déjà actif encore ${remaining} minute(s).`, remaining });
  }

  // Vérifier si déjà utilisé aujourd'hui (reset à minuit, heure de Paris)
  const midnightTs = getParisMidnightTs(now);
  const usedToday = vipQ.usedToday.get(id, midnightTs);
  if (usedToday) return res.status(400).json({ error: "Boost déjà utilisé aujourd'hui. Reviens à minuit (heure de Paris) !" });

  // Activer le boost (1 heure)
  const expiresAt = now + 60 * 60 * 1000;
  vipQ.activate.run(id, now, expiresAt);
  res.json({ ok: true, expiresAt, message: '⚡ Boost VIP activé pour 1 heure !' });
});

// Statut du boost VIP d'un joueur
app.get('/api/players/:id/vip-boost', (req, res) => {
  const id = Number(req.params.id);
  const now = Date.now();
  const active = vipQ.getActive.get(id, now);
  const midnightTs = getParisMidnightTs(now);
  const usedToday = vipQ.usedToday.get(id, midnightTs);
  res.json({
    active:     !!active,
    expiresAt:  active?.expires_at ?? null,
    usedToday:  !!usedToday,
    remainingMs: active ? active.expires_at - now : 0,
    resetAt: midnightTs + 24 * 60 * 60 * 1000,
  });
});

// Liste des boosts VIP actifs (admin/modo)
app.get('/api/admin/vip-boosts', (req, res) => {
  if (!isModo(req)) return res.status(403).json({ error: 'Non autorisé.' });
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
  })));
});

// ── Revert de partie (modo/admin uniquement) ─────────────────────────────────
app.post('/api/admin/games/:id/revert', (req, res) => {
  if (!isModo(req)) return res.status(403).json({ error: 'Modérateurs et admins uniquement.' });

  const gameId = Number(req.params.id);
  const game   = db.prepare(`SELECT * FROM games WHERE id = ?`).get(gameId);
  if (!game) return res.status(404).json({ error: 'Partie introuvable.' });
  if (game.status !== 'finished') return res.status(400).json({ error: 'La partie n\'est pas terminée.' });
  if (game.reverted) return res.status(400).json({ error: 'Cette partie a déjà été revertée.' });
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

    // Marquer la partie comme revertée
    db.prepare(`UPDATE games SET reverted = 1 WHERE id = ?`).run(gameId);

    // Log admin
    const adminId = validateSession(req.headers['x-token']);
    const admin   = adminId ? pQ.getById.get(adminId) : null;
    WH.wlogAdminAction('Revert partie', `#${gameId}`, gameId,
      [['J1', `${p1.pseudo} : ${p1.elo} → ${game.elo_before_p1}`, true],
       ['J2', `${p2.pseudo} : ${p2.elo} → ${game.elo_before_p2}`, true],
       ['Par', admin?.pseudo || 'Modérateur', false]]);

    console.log(`[REVERT] Partie #${gameId} revertée par ${admin?.pseudo || '?'}`);
    res.json({ ok: true, p1: { pseudo: p1.pseudo, eloBefore: game.elo_before_p1 }, p2: { pseudo: p2.pseudo, eloBefore: game.elo_before_p2 } });
  } catch(e) {
    console.error('[REVERT]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Route pour récupérer les parties récentes (admin)
app.get('/api/admin/games', (req, res) => {
  if (!isModo(req)) return res.status(403).json({ error: 'Non autorisé.' });
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

// ── Boost ELO global ──────────────────────────────────────────────────────────
app.get('/api/admin/boost', (req, res) => {
  if (!isModo(req)) return res.status(403).json({ error: 'Non autorisé.' });
  const active = bQ.getActive.get();
  res.json({ active: !!(active), multiplier: active?.multiplier ?? 1 });
});
app.post('/api/admin/boost', (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Seuls les admins.' });
  const m = parseFloat(req.body.multiplier);
  if (isNaN(m) || m < 1 || m > 2) return res.status(400).json({ error: 'Entre 1.0 et 2.0.' });
  bQ.deactivateAll.run();
  if (m > 1) {
    const session = getAdminSession(req);
    const admin   = session?.playerId ? pQ.getById.get(session.playerId) : null;
    bQ.create.run({ multiplier: m, applied_by: admin?.pseudo || 'Admin' });
  }
  res.json({ ok: true, multiplier: m });
});

app.get('/api/leaderboard', (_, res) => {
  res.json(pQ.leaderboard.all().filter(p => p.id !== BOT_PLAYER_ID).map(p => { const s = sanitize(p); return { ...s, rank: getRank(s.elo) }; }));
});
app.get('/api/leaderboard/wins', (_, res) => {
  const q = db.prepare('SELECT * FROM players ORDER BY wins DESC LIMIT 10');
  res.json(q.all().map(sanitize));
});
app.get('/api/site-stats', (_, res) => {
  res.json({
    online: onlineSockets.size,
    queue: mm?.q?.length || 0,
  });
});

// ── Socket.io ──────────────────────────────────────────────────────────────────
io.on('connection', socket => {

  socket.on('join_live', () => {
    socket.join('live');
  });

  socket.on('identify', ({ playerId, token }) => {
    // Vérifier le token de session
    const validId = token ? validateSession(token) : null;
    if (!validId || validId !== Number(playerId)) {
      return socket.emit('error', { message: 'Session invalide. Reconnecte-toi.' });
    }
    const player = pQ.getById.get(Number(playerId));
    if (!player) return socket.emit('error', { message: 'Joueur introuvable.' });
    socket.playerId   = Number(playerId);
    socket.playerData = sanitize(player);
    // Stocker l'IP en mémoire (X-Forwarded-For pour Railway)
    const clientIp = (socket.handshake.headers['x-forwarded-for'] || '').split(',')[0].trim()
                   || socket.handshake.address;
    socket.clientIp = clientIp;
    playerToIp.set(socket.playerId, clientIp);
    if (!ipToPlayers.has(clientIp)) ipToPlayers.set(clientIp, new Set());
    ipToPlayers.get(clientIp).add(socket.playerId);
    // Marquer en ligne
    if (!onlineSockets.has(socket.playerId)) onlineSockets.set(socket.playerId, new Set());
    onlineSockets.get(socket.playerId).add(socket.id);
    rQ.updateLastSeen.run(Date.now(), socket.playerId);
    socket.emit('identified', sanitize(player));
  });

  // Heartbeat de présence (pages hors jeu)
  socket.on('presence_ping', () => {
    if (socket.playerId) rQ.updateLastSeen.run(Date.now(), socket.playerId);
  });

  socket.on('queue_join', ({ shape } = {}) => {
    if (!socket.playerData) return socket.emit('error', { message: 'Identifie-toi d\'abord.' });
    const freshPlayer = pQ.getById.get(socket.playerId);
    // Vérifier ban/mute
    if (freshPlayer.banned) return socket.emit('error', { message: 'Ton compte est banni.' });
    if (freshPlayer.muted_until && freshPlayer.muted_until > Date.now()) {
      const mins = Math.ceil((freshPlayer.muted_until - Date.now()) / 60000);
      return socket.emit('error', { message: `Tu es banni de jeu pendant encore ${mins} minute(s).` });
    }
    socket.playerData = sanitize(freshPlayer);
    // Shape envoyée par le client (localStorage) — priorité sur la DB
    if (shape) socket.playerData.shape = shape;
    const joined = mm.join(socket.id, { ...socket.playerData, socketId: socket.id });
    if (!joined) return socket.emit('error', { message: 'Déjà en queue.' });
    socket.emit('queue_joined', { position: mm.position(socket.id) });
    const match = mm.tryMatch();
    if (match) _startMatch(match.p1, match.p2);
  });

  socket.on('queue_leave', () => { mm.leave(socket.id); socket.emit('queue_left'); });

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
      // Vérifier si l'adversaire a la même couleur → lui assigner jaune
      const side = game.players[1].id === socket.playerData.id ? 1 : 2;
      const oppSide = side === 1 ? 2 : 1;
      const oppColor = game.players[oppSide].color || '#ffd60a';
      let effectiveColor = color;
      let oppEffectiveColor = oppColor;
      if (color.toLowerCase() === oppColor.toLowerCase()) {
        oppEffectiveColor = '#ffd60a';
        // Mettre à jour la couleur de l'adversaire dans le state
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

    // Reconstruire depuis DB si pas en mémoire
    if (!state || state.status !== 'active') {
      const gameRow = gQ.getById.get(gameId);
      if (!gameRow || gameRow.status !== 'active') return socket.emit('game_not_found');
      const moves = mQ.getByGame.all(gameId);
      const { Board } = require('./game/Board');
      const board = new Board();
      moves.forEach(m => board.drop(m.col, gameRow.player1_id === m.player_id ? 1 : 2));
      const p1db = pQ.getById.get(gameRow.player1_id);
      const p2db = pQ.getById.get(gameRow.player2_id);
      state = {
        id: gameId, board,
        players: {
          1: { ...sanitize(p1db), color: gameRow.p1_color || p1db.color || '#ff2d55', shape: gameRow.p1_shape || p1db.shape || 'circle', socketId: null },
          2: { ...sanitize(p2db), color: gameRow.p2_color || p2db.color || '#ffd60a', shape: gameRow.p2_shape || p2db.shape || 'circle', socketId: null },
        },
        current: moves.length % 2 === 0 ? 1 : 2,
        startedAt: Date.now(), lastMoveAt: Date.now(),
        moveCount: moves.length, status: 'active',
      };
      gm.games.set(gameId, state);
    }

    const side = state.players[1].id === socket.playerId ? 1
               : state.players[2].id === socket.playerId ? 2 : null;

    if (side) {
      state.players[side].socketId = socket.id;
      state.players[side].disconnectedAt = null;
      gm.socketToGame.set(socket.id, gameId);

      // Envoyer l'état complet de la partie au client qui rejoint
      const p1 = state.players[1], p2 = state.players[2];
      socket.emit('game_rejoined', {
        gameId,
        side,
        players: {
          1: { id: p1.id, pseudo: p1.pseudo, elo: p1.elo, color: p1.color || '#ff2d55', avatar: p1.avatar || '', shape: p1.shape || 'circle' },
          2: { id: p2.id, pseudo: p2.pseudo, elo: p2.elo, color: p2.color || '#ffd60a', avatar: p2.avatar || '', shape: p2.shape || 'circle' },
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
    // Mettre à jour last_seen et nettoyer onlineSockets
    if (socket.playerId) {
      rQ.updateLastSeen.run(Date.now(), socket.playerId);
      const socks = onlineSockets.get(socket.playerId);
      if (socks) {
        socks.delete(socket.id);
        if (socks.size === 0) onlineSockets.delete(socket.playerId);
      }
    }
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

    // Si le socket était en transition (match_found mais pas encore rejoin_game)
    // on ne déclenche pas de forfait immédiatement — le joueur charge /game
    if (socket.transitioning) {
      // Laisser une fenêtre de grâce : si personne ne rejoint dans 20s → forfait
      const gameId = socket.pendingGameId;
      const side   = socket.pendingSide;
      if (gameId && side) {
        setTimeout(() => {
          const state = gm.games.get(gameId);
          if (!state || state.status !== 'active') return; // déjà terminé
          // Vérifier si ce joueur a rejoint
          const playerSide = state.players[side];
          if (!playerSide || !io.sockets.sockets.get(playerSide.socketId)) {
            // Toujours déconnecté → forfait
            const winner = side === 1 ? 2 : 1;
            const result = gm._end(state, winner, [], 'disconnect');
            io.to('game:' + gameId).emit('game_over', result);
          }
        }, 30000);
      }
      return;
    }

    // Fenêtre de grâce de 10s avant forfait (permet reload)
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
            // Vérifier si le joueur a reconnecté
            const p = st.players[side];
            if (!p.socketId || !io.sockets.sockets.get(p.socketId)) {
              // Toujours déconnecté → forfait
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

function _startMatch(p1, p2) {
  // ── Même IP → ELO annulé direct ─────────────────────────────────────────────
  const ip1 = playerToIp.get(p1.id);
  const ip2 = playerToIp.get(p2.id);
  const sameIp = ip1 && ip2 && ip1 === ip2;
  if (sameIp) {
    console.log(`[SAME-IP] ${p1.pseudo} et ${p2.pseudo} partagent l'IP ${ip1}`);
    // On laisse la partie se jouer mais on flag pour annuler l'ELO dans _end
  }
  p1.sameIpOpponent = sameIp;
  p2.sameIpOpponent = sameIp;

  // Anti-rematch : vérifier les 3 derniers adversaires de chaque joueur
  try {
    const p1recent = abQ.lastOpponents.all(p1.id, p1.id, p1.id).map(r => r.opp_id);
    const p2recent = abQ.lastOpponents.all(p2.id, p2.id, p2.id).map(r => r.opp_id);
    // Si ils ont déjà joué dans les 3 dernières parties des deux côtés → remettre en queue
    const p1facedP2 = p1recent.slice(0, 2).includes(p2.id); // 2 dernières parties de p1
    const p2facedP1 = p2recent.slice(0, 2).includes(p1.id); // 2 dernières parties de p2
    // Anti-rematch seulement si d'autres joueurs sont disponibles
    if (p1facedP2 && p2facedP1 && mm.size() > 2) {
      console.log(`[ANTI-REMATCH] ${p1.pseudo} vs ${p2.pseudo} — remis en queue`);
      // tryMatch les a déjà retirés de la queue — on les réinsère proprement
      mm.leave(p1.socketId); // au cas où (sécurité)
      mm.leave(p2.socketId);
      mm.join(p1.socketId, p1);
      mm.join(p2.socketId, p2);
      const s1 = io.sockets.sockets.get(p1.socketId);
      const s2 = io.sockets.sockets.get(p2.socketId);
      // Notifier les deux joueurs qu'ils sont en attente d'un autre adversaire
      if (s1) s1.emit('queue_joined', { position: mm.position(p1.socketId), reason: 'anti_rematch' });
      if (s2) s2.emit('queue_joined', { position: mm.position(p2.socketId), reason: 'anti_rematch' });
      // Tenter immédiatement un autre match si d'autres joueurs sont en queue
      const next = mm.tryMatch();
      if (next) _startMatch(next.p1, next.p2);
      return;
    }
  } catch(e) { /* ignore si DB pas encore prête */ }

  // Vérifier que les deux sockets sont toujours connectés
  const s1 = io.sockets.sockets.get(p1.socketId);
  const s2 = io.sockets.sockets.get(p2.socketId);
  if (!s1 || !s2) {
    // Un des deux est déconnecté — remettre l'autre en queue
    if (s1) { mm.join(p1.socketId, p1); s1.emit('queue_joined', { position: mm.position(p1.socketId) }); }
    if (s2) { mm.join(p2.socketId, p2); s2.emit('queue_joined', { position: mm.position(p2.socketId) }); }
    console.log(`[MATCH] Socket invalide — p1:${!!s1} p2:${!!s2}`);
    return;
  }

  // Résoudre les couleurs AVANT de créer la partie
  const _c1 = p1.color || '#ff2d55';
  let   _c2 = p2.color || '#ffd60a';
  if (_c1.toLowerCase() === _c2.toLowerCase()) {
    // Couleurs identiques : choisir une couleur alternative pour p2
    const ALTS = ['#ffd60a','#30d158','#0a84ff','#bf5af2','#ff9f0a','#ff6b81'];
    _c2 = ALTS.find(c => c.toLowerCase() !== _c1.toLowerCase()) || '#ffd60a';
  }
  p1.color = _c1;
  p2.color = _c2;

  const state = gm.create(p1, p2);
  const room  = 'game:' + state.id;
  s1.join(room);
  s2.join(room);

  const base = {
    gameId: state.id,
    players: {
      1: { id: p1.id, pseudo: p1.pseudo, elo: p1.elo, color: _c1, avatar: p1.avatar || '', shape: p1.shape || 'circle' },
      2: { id: p2.id, pseudo: p2.pseudo, elo: p2.elo, color: _c2, avatar: p2.avatar || '', shape: p2.shape || 'circle' },
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

// ── 404 — toute route non matchée ────────────────────────────────────────────
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
    console.log(`✅  http://localhost:${PORT}`);
    startBot();
  });
}).catch(e => { console.error('DB init failed:', e); process.exit(1); });

// ── Bot Discord intégré ───────────────────────────────────────────────────────
function startBot() {
  const { botToken } = discordConfig();
  if (!botToken || botToken === 'TON_BOT_TOKEN') {
    console.log('[BOT] Token manquant — bot désactivé');
    return;
  }

  const bot = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers]
  });

  // ── Statuts rotatifs ──────────────────────────────────────────────────────
  function updateStatus() {
    try {
      const totalPlayers = db.prepare(`SELECT COUNT(*) as c FROM players WHERE deleted=0`).get()?.c || 0;
      const activeGames  = db.prepare(`SELECT COUNT(*) as c FROM games WHERE status='active'`).get()?.c || 0;
      const statuses = [
        { text: `${totalPlayers} joueur${totalPlayers > 1 ? 's' : ''} inscrit${totalPlayers > 1 ? 's' : ''}`, type: ActivityType.Watching },
        { text: `${activeGames} partie${activeGames > 1 ? 's' : ''} en cours`, type: ActivityType.Playing },
      ];
      const s = statuses[Math.floor(Date.now() / 10000) % statuses.length];
      bot.user.setActivity(s.text, { type: s.type });
    } catch(e) {}
  }

  // Cache des emojis de rang (chargé au démarrage)
  const rankEmojiCache = {};

  bot.once('ready', async () => {
    console.log(`✅ Bot connecté : ${bot.user.tag}`);
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
      console.log(`[BOT] ${Object.keys(rankEmojiCache).length} emojis de rang chargés`);
    } catch(e) {
      console.error('[BOT] Emojis rang:', e.message);
    }

    // Enregistrer les commandes slash automatiquement
    try {
      const rest = new REST({ version: '10' }).setToken(botToken);
      const commands = [
        {
          name: 'profil',
          description: "Affiche le profil d'un joueur Puissance 4",
          options: [{ name: 'pseudo', description: 'Le pseudo du joueur (2 car. min)', type: 3, required: true, autocomplete: true }],
        },
        { name: 'classement', description: 'Affiche le top 10 des joueurs par ELO' },
        { name: 'live',       description: 'Affiche les parties en cours' },
      ];
      await rest.put(Routes.applicationCommands(bot.user.id), { body: commands });
      console.log('✅ Commandes slash enregistrées');
    } catch(e) {
      console.error('[BOT] Erreur enregistrement commandes:', e.message);
    }
  });

  // ── Commandes slash ───────────────────────────────────────────────────────
  const API = process.env.BASE_URL || 'https://puissance-4-website-production.up.railway.app';

  function eloRank(elo) {
    const r = getRank(elo);
    const fallbacks = { Malachite:'🟢', Quartz:'⚪', Ambre:'🟤', Jade:'🟦', Saphir:'🔵', Améthyste:'🟣' };
    // Chercher l'emoji spécifique au niveau (ex: Quartz_3)
    const key = r.key + '_' + (r.level || 1);
    const emoji = rankEmojiCache[key] || fallbacks[r.name] || '🎮';
    return { label: r.label, emoji, color: r.color, level: r.level, key: r.key };
  }
  function winRate(p) {
    const t = (p.wins||0)+(p.losses||0)+(p.draws||0);
    return t ? Math.round((p.wins/t)*100)+'%' : '—';
  }

  // ── Génération avatar initiale (SVG → Buffer PNG via canvas si dispo) ──────
  function generateAvatarSvg(initial, color) {
    // SVG 128x128 avec cercle coloré + initiale blanche
    const bg  = color || '#ff2d55';
    const hex = bg.replace('#','');
    const r   = parseInt(hex.slice(0,2),16);
    const g   = parseInt(hex.slice(2,4),16);
    const b   = parseInt(hex.slice(4,6),16);
    // Couleur de fond légèrement assombrie pour lisibilité
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

    // Cas 3 : pas d'avatar — générer initiale avec canvas ou SVG
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
      const di = (() => { try { return data.discord_info ? JSON.parse(data.discord_info) : null; } catch { return null; } })();
      const latestGames = Array.isArray(data.latestGames) ? data.latestGames.slice(0, 3) : [];
      const fontTitle = '700 54px "Barlow Condensed"';
      const fontSub = '700 24px "Barlow Condensed"';
      const fontBody = '600 22px "Barlow"';
      const fontSmall = '600 18px "Barlow"';

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
      overlay.addColorStop(0, 'rgba(7,9,22,0.30)');
      overlay.addColorStop(1, 'rgba(7,9,22,0.76)');
      ctx.fillStyle = overlay;
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      ctx.fillStyle = '#ffd60a';
      ctx.font = '700 24px "Barlow Condensed"';
      ctx.fillText('PUISSANCE 4 RANKED', 42, 42);

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
        ctx.textAlign = 'start';
        ctx.textBaseline = 'alphabetic';
      }
      ctx.restore();
      ctx.lineWidth = 5;
      ctx.strokeStyle = hexToRgbaBot(data.color || '#ff2d55', 0.95);
      ctx.beginPath();
      ctx.arc(110, 136, 64, 0, Math.PI * 2);
      ctx.stroke();

      ctx.fillStyle = '#f5f4ff';
      ctx.font = fontTitle;
      ctx.fillText(data.pseudo || 'Joueur', 204, 116);

      ctx.fillStyle = '#ffe27a';
      ctx.font = fontSub;
      const badges = [];
      if (data.is_vip) badges.push('VIP');
      if (data.role === 'admin') badges.push('ADMIN');
      else if (data.role === 'moderator') badges.push('MODO');
      const badgeText = badges.length ? `  •  ${badges.join(' • ')}` : '';
      ctx.fillText(`${data.elo} ELO  •  ${rank.label}${badgeText}`, 206, 154);

      ctx.fillStyle = '#d7d5ef';
      ctx.font = fontBody;
      ctx.fillText(`ID ${data.id}  •  Couleur ${String(data.color || '#ff2d55').toUpperCase()}  •  Forme ${data.shape || 'circle'}`, 206, 190);
      ctx.fillText(`Suivis ${data.following || 0}  •  Abonnés ${data.followers || 0}  •  Membre ${data.memberDate || '—'}`, 206, 222);

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

      ctx.fillStyle = '#f5f4ff';
      ctx.font = '700 22px "Barlow Condensed"';
      ctx.textAlign = 'center';
      ctx.fillText('RANG', rankX + rankW / 2, rankY + 34);
      if (rankImage) ctx.drawImage(rankImage, rankX + 62, rankY + 56, 74, 74);
      else {
        ctx.font = '700 48px "Barlow Condensed"';
        ctx.fillText(data.rankEmoji || '🏅', rankX + 98, rankY + 116);
      }
      ctx.textAlign = 'start';
      ctx.fillStyle = '#ffe27a';
      ctx.font = '700 30px "Barlow Condensed"';
      ctx.fillText(rank.label, rankX + 144, rankY + 106);
      ctx.fillStyle = '#d7d5ef';
      ctx.font = fontSmall;
      ctx.fillText(`${rank.progress || 0}% de progression`, rankX + 86, rankY + 150);
      roundRectBot(ctx, rankX + 52, rankY + 166, rankW - 104, 22, 11);
      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      ctx.fill();
      roundRectBot(ctx, rankX + 52, rankY + 166, Math.max(24, Math.round((rankW - 104) * ((rank.progress || 0) / 100))), 22, 11);
      ctx.fillStyle = hexToRgbaBot(rank.color || '#ffffff', 0.98);
      ctx.fill();
      ctx.fillStyle = '#f5f4ff';
      ctx.font = '600 18px "Barlow"';
      ctx.fillText(rank.next ? `Prochain palier : ${rank.next} ELO` : 'Rang maximum atteint', rankX + 54, rankY + 206);

      const stats = [
        { label: 'Victoires', value: String(data.wins || 0), color: '#9be15d' },
        { label: 'Défaites', value: String(data.losses || 0), color: '#ff7aa2' },
        { label: 'Nuls', value: String(data.draws || 0), color: '#8dd7ff' },
        { label: 'Parties', value: String(totalGames), color: '#7cf0ff' },
        { label: 'Win rate', value: data.winRate || '—', color: '#c38bff' },
        { label: 'Précision', value: data.avg_accuracy != null ? String(data.avg_accuracy) : '—', color: '#33a1ff' },
      ];
      const statW = 304;
      const statH = 96;
      const startX = 42;
      const startY = 312;
      const gapX = 24;
      const gapY = 22;
      stats.forEach((stat, index) => {
        const row = Math.floor(index / 3);
        const col = index % 3;
        const x = startX + col * (statW + gapX);
        const y = startY + row * (statH + gapY);
        ctx.save();
        roundRectBot(ctx, x, y, statW, statH, 18);
        ctx.fillStyle = 'rgba(16,18,32,0.58)';
        ctx.shadowColor = stat.color;
        ctx.shadowBlur = 18;
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.lineWidth = 3;
        ctx.strokeStyle = hexToRgbaBot(stat.color, 0.98);
        ctx.stroke();
        ctx.restore();

        ctx.fillStyle = hexToRgbaBot(stat.color, 0.98);
        ctx.font = '700 22px "Barlow Condensed"';
        ctx.textAlign = 'center';
        ctx.fillText(stat.label, x + statW / 2, y + 32);
        ctx.font = '700 34px "Barlow Condensed"';
        ctx.fillStyle = '#f5f4ff';
        ctx.fillText(stat.value, x + statW / 2, y + 72);
        ctx.textAlign = 'start';
      });

      const infoX = 42;
      const infoY = 238;
      ctx.fillStyle = '#f5f4ff';
      ctx.font = '700 22px "Barlow Condensed"';
      ctx.fillText('DISCORD ET PROFIL', infoX, infoY);
      ctx.font = fontSmall;
      const infoLines = [
        di?.username ? `Compte : ${di.global_name || di.username}` : 'Compte Discord non lié',
        di?.server_nick ? `Pseudo serveur : ${di.server_nick}` : `Couleur du jeton : ${String(data.color || '#ff2d55').toUpperCase()}`,
        di?.server_joined ? `Rejoint le : ${new Date(di.server_joined).toLocaleDateString('fr-FR')}` : `Shape : ${data.shape || 'circle'}`,
        di?.boosting_since ? 'Booster actif' : 'Boost serveur : non',
      ];
      if (di?.server_roles?.length) {
        const roleNames = di.server_roles.filter(r => r.name && r.name !== '@everyone').map(r => r.name).slice(0, 4).join(' • ');
        if (roleNames) infoLines[3] = `Rôles : ${roleNames}`;
      }
      infoLines.forEach((line, i) => ctx.fillText(line, infoX, infoY + 30 + i * 24));

      const historyX = 42;
      const historyY = 550;
      const historyW = 1004;
      const historyH = 96;
      ctx.save();
      roundRectBot(ctx, historyX, historyY, historyW, historyH, 18);
      ctx.fillStyle = 'rgba(14,16,30,0.60)';
      ctx.shadowColor = '#ffd60a';
      ctx.shadowBlur = 14;
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.lineWidth = 2;
      ctx.strokeStyle = 'rgba(255,214,10,0.55)';
      ctx.stroke();
      ctx.restore();
      ctx.fillStyle = '#ffd60a';
      ctx.font = '700 20px "Barlow Condensed"';
      ctx.fillText('DERNIERES PARTIES', historyX + 18, historyY + 28);
      ctx.fillStyle = '#f5f4ff';
      ctx.font = fontSmall;
      if (latestGames.length) {
        latestGames.forEach((g, i) => {
          const sign = g.delta >= 0 ? '+' : '';
          const icon = g.draw ? 'DRAW' : (g.won ? 'WIN' : 'LOSE');
          ctx.fillText(`${icon}  vs ${g.opp}  •  ${sign}${g.delta} ELO  •  ${g.date}`, historyX + 18, historyY + 56 + i * 22);
        });
      } else {
        ctx.fillText('Aucune partie récente.', historyX + 18, historyY + 60);
      }

      ctx.fillStyle = 'rgba(255,255,255,0.78)';
      ctx.font = '400 16px "Barlow"';
      ctx.fillText(`https://puissance-4-website-production.up.railway.app/profil?id=${data.id}`, 640, 656);

      return new AttachmentBuilder(canvas.toBuffer('image/png'), { name: `profil-${data.id}.png` });
    } catch (e) {
      console.error('[BOT] generateProfileCardAttachment:', e.message);
      return null;
    }
  }

  bot.on('interactionCreate', async interaction => {
    // ── Autocomplete pseudo ──────────────────────────────────────────────────
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
          name: `${r.pseudo} · ${r.elo} ELO`,
          value: r.pseudo
        })));
      } catch(e) {
        console.error('[BOT autocomplete]', e.message);
        try { await interaction.respond([]); } catch(_) {}
      }
      return;
    }

    if (!interaction.isChatInputCommand()) return;

    // Defer visible pour tous sauf si ephemeral forcé
    try { await interaction.deferReply(); } catch(e) { return; }

    try {
      // ── /profil ────────────────────────────────────────────────────────────
      if (interaction.commandName === 'profil') {
        const pseudo = interaction.options.getString('pseudo');
        console.log(`[BOT /profil] recherche: "${pseudo}"`);

        const data = db.prepare(
          `SELECT * FROM players WHERE LOWER(pseudo)=LOWER(?) AND deleted=0`
        ).get(pseudo);

        if (!data) {
          return interaction.editReply({ content: `❌ Joueur **${pseudo}** introuvable.` });
        }

        console.log(`[BOT /profil] joueur trouvé id=${data.id}`);

        const games = gQ.getForPlayer.all(data.id, data.id, BOT_PLAYER_ID, BOT_PLAYER_ID).slice(0, 5);
        const rank  = eloRank(data.elo);
        const total = (data.wins||0)+(data.losses||0)+(data.draws||0);
        const wr    = total ? Math.round((data.wins/total)*100)+'%' : '—';

        // Précision moyenne
        const accRow = db.prepare(`
          SELECT
            AVG(CASE WHEN player1_id=? AND p1_accuracy IS NOT NULL THEN p1_accuracy END) AS as_p1,
            AVG(CASE WHEN player2_id=? AND p2_accuracy IS NOT NULL THEN p2_accuracy END) AS as_p2
          FROM games WHERE (player1_id=? OR player2_id=?) AND status='finished'
        `).get(data.id, data.id, data.id, data.id);
        const prec = (() => {
          const vals = [accRow?.as_p1, accRow?.as_p2].filter(v => v != null);
          return vals.length ? Math.round(vals.reduce((a,b)=>a+b,0)/vals.length)+'%' : '—';
        })();

        // Discord info
        const di = (() => { try { return data.discord_info ? JSON.parse(data.discord_info) : null; } catch { return null; } })();

        // Rang progression
        const rankInfo = getRank(data.elo);
        const pct = rankInfo.progress ?? 0;
        const bar = '█'.repeat(Math.round(pct/10)) + '░'.repeat(10-Math.round(pct/10));

        // Helper : valeur safe pour field Discord (jamais vide)
        const fv = v => (v != null && String(v).trim() !== '') ? String(v) : '—';

        // Mention du membre Discord si lié
        const memberMention = data.discord_id ? '<@' + data.discord_id + '>' : null;

        const roleLabel = data.role === 'admin' ? ' · ⚡ ADMIN' : data.role === 'moderator' ? ' · 🛡️ MODO' : '';
        const desc = (memberMention ? memberMention + '  ' : '') + rank.label + ' · ' + data.elo + ' ELO' + roleLabel;

        const embed = new EmbedBuilder()
          .setColor(data.color && data.color.startsWith('#') ? data.color : rank.color)
          .setTitle(rank.emoji + ' ' + data.pseudo)
          .setURL(API + '/profil?id=' + data.id)
          .setDescription(desc);

        // Bannière — base64 ou URL HTTP
        let bannerAttachment = null;
        if (data.banner) {
          if (data.banner.startsWith('http')) {
            embed.setImage(data.banner);
          } else if (data.banner.startsWith('data:')) {
            try {
              const bm = data.banner.match(/^data:([^;]+);base64,(.+)$/);
              if (bm) {
                const bext = bm[1].split('/')[1] || 'jpg';
                bannerAttachment = { name: 'banner.' + bext, buffer: Buffer.from(bm[2], 'base64') };
                embed.setImage('attachment://banner.' + bext);
              }
            } catch(e) { console.error('[BOT] banner base64 parse error:', e.message); }
          }
        }
        const avatarInfo = await getAvatarAttachment(data);

        // Stats
        embed.addFields(
          { name: '🏆 Victoires', value: fv(data.wins),   inline: true },
          { name: '💀 Défaites',  value: fv(data.losses), inline: true },
          { name: '⚖️ Nuls',      value: fv(data.draws),  inline: true },
          { name: '🎮 Parties',   value: fv(total),        inline: true },
          { name: '📊 Win rate',  value: fv(wr),           inline: true },
          { name: '🎯 Précision', value: fv(prec),         inline: true },
        );

        // Rang progression
        const rankLvlLabel = rank.label + ' ' + (['I','II','III','IV','V'][(rankInfo.level||1)-1] || 'I');
        const rankValue = bar + ' ' + pct + '%' + (rankInfo.next ? ' → ' + rankInfo.next + ' ELO pour monter' : ' · MAX');
        embed.addFields({ name: '📈 ' + rankLvlLabel, value: rankValue, inline: false });

        // Social
        const followCounts = db.prepare(
          'SELECT (SELECT COUNT(*) FROM follows WHERE follower_id=?) AS following, (SELECT COUNT(*) FROM follows WHERE following_id=?) AS followers'
        ).get(data.id, data.id);
        const memberDate = data.created_at
          ? new Date(data.created_at).toLocaleDateString('fr-FR',{day:'2-digit',month:'2-digit',year:'numeric'})
          : '—';
        embed.addFields(
          { name: '👁 Suivis',   value: fv(followCounts?.following), inline: true },
          { name: '👥 Abonnés', value: fv(followCounts?.followers), inline: true },
          { name: '📅 Membre',  value: memberDate,                   inline: true },
        );

        // Apparence — emoji de forme, pastille couleur approchante
        const shapeEmoji = { circle:'⭕', diamond:'💎', triangle:'🔺', star:'⭐', heart:'❤️' };
        const rawShape = data.shape || 'circle';
        const shapeDisplay = rawShape.startsWith('emoji:') ? rawShape.slice(6) || '⭐' : (shapeEmoji[rawShape] || '⭕');
        const colorHex = (data.color || '#ff2d55').toUpperCase();
        // Pastille couleur approchante via emoji Discord
        const r16 = parseInt(colorHex.slice(1,3),16), g16 = parseInt(colorHex.slice(3,5),16), b16 = parseInt(colorHex.slice(5,7),16);
        const colorDot = (() => {
          if (r16 > 200 && g16 < 100 && b16 < 100) return '🔴';
          if (r16 > 200 && g16 > 150 && b16 < 80)  return '🟠';
          if (r16 > 200 && g16 > 200 && b16 < 80)   return '🟡';
          if (r16 < 100 && g16 > 160 && b16 < 100)  return '🟢';
          if (r16 < 100 && g16 < 100 && b16 > 180)  return '🔵';
          if (r16 > 120 && g16 < 80  && b16 > 150)  return '🟣';
          if (r16 > 160 && g16 > 100 && b16 > 100)  return '🩷';
          if (r16 > 200 && g16 > 200 && b16 > 200)  return '⚪';
          if (r16 < 60  && g16 < 60  && b16 < 60)   return '⚫';
          return '🟤';
        })();
        embed.addFields({ name: '🎨 Apparence', value: colorDot + ' **' + colorHex + '**  ·  ' + shapeDisplay, inline: false });

        // Discord lié
        if (di && di.username) {
          const dLines = ['@' + (di.username || di.global_name || '?')];
          if (di.server_nick) dLines.push('Pseudo serveur : ' + di.server_nick);
          if (di.boosting_since) dLines.push('🚀 Booster actif');
          if (di.server_roles && di.server_roles.length) {
            // Utiliser les mentions <@&ID> si on a les IDs, sinon les noms
            const roleMentions = di.server_roles
              .filter(r => r && r.name && r.name !== '@everyone')
              .slice(0, 5)
              .map(r => r.id ? '<@&' + r.id + '>' : r.name)
              .join(' ');
            if (roleMentions) dLines.push('Rôles : ' + roleMentions);
          }
          embed.addFields({ name: '🔗 Discord', value: dLines.join('') || '—', inline: false });
        }

        // Alertes
        const alerts = [];
        if (data.suspicious) alerts.push('⚠️ Activité suspecte');
        if (data.banned) alerts.push('🚫 Banni');
        if (alerts.length) embed.addFields({ name: '🚨 Statut', value: alerts.join(' · '), inline: false });

        // Dernières parties
        if (games.length) {
          const lines = games.map(g => {
            const isP1 = g.player1_id === data.id;
            const opp  = fv(isP1 ? g.p2_pseudo : g.p1_pseudo);
            const icon = g.winner_id === null ? '⚖️' : (g.winner_id === data.id ? '✅' : '❌');
            const d    = isP1 ? (g.elo_p1 || 0) : (g.elo_p2 || 0);
            return icon + ' vs **' + opp + '** · ' + (d >= 0 ? '+' : '') + d + ' ELO';
          });
          embed.addFields({ name: '🕹️ Dernières parties', value: lines.join(''), inline: false });
        }

        embed.setFooter({ text: 'Puissance 4 Ranked · ID ' + data.id });
        console.log('[BOT /profil] embed OK pour ' + data.pseudo);

        // ── SelectMenu des parties ─────────────────────────────────────────
        const menuRows = [];
        if (games.length > 0) {
          const options = games.slice(0, 25).map(g => {
            const isP1  = g.player1_id === data.id;
            const opp   = isP1 ? g.p2_pseudo : g.p1_pseudo;
            const won   = g.winner_id === data.id;
            const draw  = g.winner_id === null;
            const icon  = draw ? '⚖️' : (won ? '✅' : '❌');
            const delta = isP1 ? (g.elo_p1 || 0) : (g.elo_p2 || 0);
            const d     = (delta >= 0 ? '+' : '') + delta;
            const date  = g.finished_at ? g.finished_at.slice(0,10) : '—';
            const label = (icon + ' vs ' + (opp || '?') + ' · ' + d + ' ELO').slice(0,100);
            const desc  = (date + ' · ' + (g.move_count || 0) + ' coups · ' + (g.duration || 0) + 's').slice(0,100);
            return new StringSelectMenuOptionBuilder()
              .setLabel(label).setDescription(desc).setValue('game:' + g.id);
          });
          const menu = new StringSelectMenuBuilder()
            .setCustomId('prof_games:' + data.id)
            .setPlaceholder('📋 Voir détails d\'une partie...')
            .addOptions(options);
          menuRows.push(new ActionRowBuilder().addComponents(menu));
        }
        const { AttachmentBuilder } = require('discord.js');
        const files = [];

        // Avatar
        if (avatarInfo.url) {
          embed.setThumbnail(avatarInfo.url);
        } else if (avatarInfo.attachment) {
          embed.setThumbnail('attachment://' + avatarInfo.attachment.name);
          files.push(new AttachmentBuilder(avatarInfo.attachment.buffer, { name: avatarInfo.attachment.name }));
        }

        // Bannière
        if (bannerAttachment) {
          files.push(new AttachmentBuilder(bannerAttachment.buffer, { name: bannerAttachment.name }));
        }

        const cardAttachment = await generateProfileCardAttachment({
          ...data,
          rank: rankInfo,
          rankEmoji: rank.emoji,
          winRate: wr,
          avg_accuracy: prec,
          following: followCounts?.following || 0,
          followers: followCounts?.followers || 0,
          memberDate,
          latestGames: games.map(g => {
            const isP1 = g.player1_id === data.id;
            return {
              opp: fv(isP1 ? g.p2_pseudo : g.p1_pseudo),
              delta: isP1 ? (g.elo_p1 || 0) : (g.elo_p2 || 0),
              won: g.winner_id === data.id,
              draw: g.winner_id === null,
              date: g.finished_at ? g.finished_at.slice(0, 10) : '—',
            };
          }),
        });
        if (cardAttachment) {
          files.length = 0;
          files.push(cardAttachment);
          return interaction.editReply({ files, components: menuRows });
        }

        return interaction.editReply({ embeds: [embed], files, components: menuRows });
      }

      // ── /classement ────────────────────────────────────────────────────────
      if (interaction.commandName === 'classement') {
        const players = db.prepare(`SELECT * FROM players WHERE deleted=0 AND id!=? ORDER BY elo DESC LIMIT 10`).all(BOT_PLAYER_ID);
        if (!players.length) return interaction.editReply({ content: '❌ Aucun joueur.' });
        const medals = ['🥇','🥈','🥉'];
        const lines  = players.map((p,i) => {
          const r = eloRank(p.elo);
          return `${medals[i]||`**#${i+1}**`} ${r.emoji} **${p.pseudo}** — ${p.elo} ELO · ${p.wins}V/${p.losses}D`;
        });
        const embed = new EmbedBuilder()
          .setColor('#ffd60a')
          .setTitle('🏆 Classement Puissance 4')
          .setURL(`${API}/leaderboard`)
          .setDescription(lines.join('\n'))
          .setFooter({ text: 'Top 10 · Puissance 4 Ranked' });
        return interaction.editReply({ embeds: [embed] });
      }

      // ── /live ──────────────────────────────────────────────────────────────
      if (interaction.commandName === 'live') {
        const activeGames = [...(gm.games || new Map()).values()].filter(g => g.status === 'active');
        if (!activeGames.length) return interaction.editReply({ content: '😴 Aucune partie en cours.' });
        const lines = activeGames.map(g => {
          const p1 = g.players?.[1], p2 = g.players?.[2];
          if (!p1 || !p2) return null;
          const cur = g.current === 1 ? p1.pseudo : p2.pseudo;
          return `⚔️ **${p1.pseudo}** (${p1.elo}) vs **${p2.pseudo}** (${p2.elo}) · ${g.moveCount||0} coups · Tour de **${cur}**`;
        }).filter(Boolean);
        const embed = new EmbedBuilder()
          .setColor('#ff2d55')
          .setTitle(`🔴 ${activeGames.length} partie${activeGames.length>1?'s':''} en cours`)
          .setURL(`${API}/live`)
          .setDescription(lines.join('\n') || '—')
          .setFooter({ text: 'Puissance 4 Ranked · Live' });
        return interaction.editReply({ embeds: [embed] });
      }

    // ── SelectMenu détail d'une partie ─────────────────────────────────────────
    if (interaction.isStringSelectMenu() && interaction.customId.startsWith('prof_games:')) {
      await interaction.deferReply({ ephemeral: true });
      try {
        const val = interaction.values[0];
        if (!val.startsWith('game:')) return interaction.editReply({ content: '❌ Valeur invalide.' });
        const gameId = Number(val.split(':')[1]);
        const game = gQ.getById.get(gameId);
        if (!game) return interaction.editReply({ content: '❌ Partie introuvable.' });

        const moves = mQ.getByGame.all(gameId);
        const playerId = Number(interaction.customId.split(':')[1]);
        const isP1  = game.player1_id === playerId;
        const opp   = isP1 ? game.p2_pseudo : game.p1_pseudo;
        const oppElo= isP1 ? game.p2_elo    : game.p1_elo;
        const won   = game.winner_id === playerId;
        const draw  = game.winner_id === null;
        const icon  = draw ? '⚖️' : (won ? '✅' : '❌');
        const delta = isP1 ? (game.elo_p1 || 0) : (game.elo_p2 || 0);
        const myElo = isP1 ? game.p1_elo    : game.p2_elo;
        const myRank= eloRank(myElo);
        const oppRank=eloRank(oppElo);
        const date  = game.finished_at
          ? new Date(game.finished_at).toLocaleDateString('fr-FR',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'})
          : '—';

        const gameEmbed = new EmbedBuilder()
          .setColor(isP1 ? (game.p1_color || '#ff2d55') : (game.p2_color || '#ffd60a'))
          .setTitle(icon + ' Partie #' + gameId)
          .setURL(API + '/replay/' + gameId)
          .addFields(
            { name: '⚔️ Adversaire', value: myRank.emoji + ' vs ' + oppRank.emoji + ' **' + (opp||'?') + '** (' + (oppElo||'?') + ' ELO)', inline: false },
            { name: '📊 ELO',         value: (delta >= 0 ? '+' : '') + delta + ' ELO',    inline: true },
            { name: '🎮 Coups',        value: String(game.move_count || 0),                inline: true },
            { name: '⏱️ Durée',        value: (game.duration || 0) + 's',                  inline: true },
            { name: '📅 Date',         value: date,                                         inline: false },
          );

        // Précision si analysée
        const myAccuracy = isP1 ? game.p1_accuracy : game.p2_accuracy;
        const oppAccuracy= isP1 ? game.p2_accuracy : game.p1_accuracy;
        if (myAccuracy != null) {
          gameEmbed.addFields(
            { name: '🎯 Ma précision',  value: myAccuracy  + '%', inline: true },
            { name: '🎯 Préc. adverse', value: (oppAccuracy || '—') + (oppAccuracy ? '%' : ''), inline: true },
          );
        }

        // Replay link button
        const replayBtn = new ActionRowBuilder().addComponents(
          new (require('discord.js').ButtonBuilder)()
            .setLabel('📽️ Voir le replay')
            .setURL(API + '/replay/' + gameId)
            .setStyle(require('discord.js').ButtonStyle.Link)
        );

        return interaction.editReply({ embeds: [gameEmbed], components: [replayBtn] });
      } catch(e) {
        console.error('[BOT SelectMenu game]', e.message);
        return interaction.editReply({ content: '❌ Erreur : ' + e.message });
      }
    }

    } catch(e) {
      // Log complet de l'erreur
      console.error('[BOT ERROR]', e.constructor.name, e.message);
      console.error(e.stack);
      // Envoyer l'erreur en ephemeral pour debug
      const errMsg = `❌ **Erreur** : \`${e.constructor.name}: ${e.message}\``;
      try {
        if (interaction.deferred) await interaction.editReply({ content: errMsg });
        else await interaction.reply({ content: errMsg, ephemeral: true });
      } catch(_) {}
    }
  });

  bot.login(botToken).catch(e => console.error('[BOT] Login failed:', e));
}

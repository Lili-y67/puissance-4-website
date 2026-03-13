require('dotenv').config();
const express    = require('express');
const http       = require('http');
const { Server } = require('socket.io');
const path       = require('path');
const crypto     = require('crypto');

const { initDb, db, pQ, gQ, mQ, fQ, sQ, abQ, rQ } = require('./db/db');
const { getRank } = require('./rank');
const { Client, GatewayIntentBits, EmbedBuilder, ActivityType } = require('discord.js');

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

// ── Sessions tokens (SQLite) ──────────────────────────────────────────────────
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

app.use(express.json({ limit: '5mb' })); // pour les avatars base64
app.use(express.static(path.join(__dirname, 'public')));

// ── SPA routing ────────────────────────────────────────────────────────────────
app.get('/',           (_, res) => res.sendFile(path.join(__dirname, 'public/index.html')));
app.get('/game',       (_, res) => res.sendFile(path.join(__dirname, 'public/game.html')));

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
app.get('/api/admin/password', (req, res) => {
  const token = req.headers['x-token'];
  const playerId = validateSession(token);
  if (!playerId) return res.status(403).json({ error: 'Non autorisé.' });
  const player = pQ.getById.get(playerId);
  if (!player || player.role !== 'admin') return res.status(403).json({ error: 'Réservé aux administrateurs.' });
  res.json({ password: ADMIN_PASSWORD });
});

// Auth admin
// Sessions admin en mémoire
const adminSessions = new Map(); // token → { playerId, role }

function getAdminSession(req) {
  const t = req.headers['x-admin-token'];
  return t ? adminSessions.get(t) : null;
}
function isAdmin(req) {
  const s = getAdminSession(req);
  return s && s.role === 'admin';
}
function isModo(req) {
  const s = getAdminSession(req);
  return s && (s.role === 'admin' || s.role === 'moderator');
}

app.post('/api/admin/login', (req, res) => {
  const { password, playerToken } = req.body;
  if (password !== ADMIN_PASSWORD) return res.status(403).json({ error: 'Mot de passe incorrect.' });

  // Récupérer le rôle du joueur connecté (admin ou moderator)
  let role = 'admin'; // par défaut si pas de token joueur
  let playerId = null;
  if (playerToken) {
    const pid = validateSession(playerToken);
    if (pid) {
      const p = pQ.getById.get(pid);
      if (p && (p.role === 'admin' || p.role === 'moderator')) {
        role = p.role;
        playerId = pid;
      }
    }
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
  const players = db.prepare(`SELECT id, pseudo, elo, role, wins, losses, draws, suspicious, banned, muted_until, created_at, discord_id, last_seen FROM players WHERE deleted = 0 ORDER BY elo DESC`).all();
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
  WH.wlogAdminAction('Rôle changé', target.pseudo, req.params.id, [['Ancien', oldRole, true], ['Nouveau', role, true]]);
  pQ.updateRole.run({ role, id: Number(req.params.id) });

  // Sync rôle Discord si lié
  if (target.discord_id) {
    try { await syncDiscordRole(target.discord_id, role); } catch(e) {}
    // DM de notification
    try { await sendDM(target.discord_id, [
      '🎭 **Puissance 4 — Changement de rôle**',
      '',
      `Bonjour **${target.pseudo}** !`,
      '',
      `Ton rôle a été modifié : **${oldRole}** → **${role}**`,
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
const DISCORD_ROLE_VIP = '1480329015406497823';

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
async function syncDiscordRole(discordId, role) {
  const { botToken } = discordConfig();
  if (!botToken) return;
  const ALL_ROLES = [DISCORD_ROLE_ADM, DISCORD_ROLE_MOD, DISCORD_ROLE_VIP];
  const TARGET = role === 'admin' ? DISCORD_ROLE_ADM
               : role === 'moderator' ? DISCORD_ROLE_MOD
               : role === 'vip' ? DISCORD_ROLE_VIP : null;
  for (const rid of ALL_ROLES) {
    const method = (rid === TARGET) ? 'PUT' : 'DELETE';
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
  const linked = db.prepare(`SELECT id, pseudo, role, discord_id FROM players WHERE discord_id IS NOT NULL AND discord_id != '' AND deleted = 0`).all();
  for (const player of linked) {
    const newRole = await getDiscordRole(player.discord_id, botToken);
    if (newRole !== player.role) {
      pQ.updateRole.run({ role: newRole, id: player.id });
      console.log(`[ROLE SYNC] ${player.pseudo} : ${player.role} → ${newRole}`);
      WH.wlogRoleSync(player.pseudo, player.role, newRole);
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
  const state  = Buffer.from(JSON.stringify({ playerId: player.id })).toString('base64');
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
    const { playerId } = JSON.parse(Buffer.from(state, 'base64').toString());
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

      // Construire l'objet discord_info enrichi
      const discordInfo = {
        id:             discordUser.id,
        username:       discordUser.username,
        global_name:    discordUser.global_name || discordUser.username,
        discriminator:  discordUser.discriminator !== '0' ? discordUser.discriminator : null,
        email:          discordUser.email || null,
        verified:       discordUser.verified || false,
        mfa_enabled:    discordUser.mfa_enabled || false,
        premium_type:   discordUser.premium_type || 0,   // 0=none, 1=classic, 2=nitro, 3=basic
        public_flags:   discordUser.public_flags || 0,   // badges Discord
        // Compte créé le (snowflake → timestamp)
        created_at:     new Date(Number(BigInt(discordUser.id) >> 22n) + 1420070400000).toISOString(),
        // Infos membre serveur
        server_joined:  memberInfo?.joined_at || null,
        server_nick:    memberInfo?.nick || null,
        server_roles:   memberInfo?.roles || [],
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
    rQ.insert.run(playerId, code6, expires);

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
  if (newPassword.length < 4) return res.status(400).json({ error: 'Mot de passe trop court.' });

  const row = rQ.getValid.get(Number(playerId), String(code), Date.now());
  if (!row) return res.status(400).json({ error: 'Code invalide ou expiré.' });

  const hashed = hashPwd(newPassword);
  pQ.updatePassword.run({ password: hashed, id: Number(playerId) });
  rQ.markUsed.run(row.id);

  res.json({ ok: true });
});

app.get('/profil',     (_, res) => res.sendFile(path.join(__dirname, 'public/profil.html')));
app.get('/replay/:id', (_, res) => res.sendFile(path.join(__dirname, 'public/replay.html')));
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
      players: {
        1: { id: state.players[1].id, pseudo: state.players[1].pseudo, elo: state.players[1].elo, color: state.players[1].color || '#ff2d55', avatar: state.players[1].avatar || '', shape: state.players[1].shape || 'circle' }, // format 'circle' ou 'emoji:⭐'
        2: { id: state.players[2].id, pseudo: state.players[2].pseudo, elo: state.players[2].elo, color: state.players[2].color || '#ffd60a', avatar: state.players[2].avatar || '', shape: state.players[2].shape || 'circle' },
      },
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
  return rest;
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
  db.prepare(`UPDATE players SET
    pseudo   = 'Joueur supprimé',
    password = '',
    color    = '#555555',
    avatar   = '',
    discord_id = NULL
  WHERE id = ?`).run(id);
  db.prepare(`DELETE FROM sessions WHERE player_id = ?`).run(id);
  db.prepare(`DELETE FROM players WHERE id = ?`).run(id);

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

app.get('/api/players/by-pseudo/:pseudo', (req, res) => {
  const p = pQ.getByPseudo.get(req.params.pseudo);
  if (!p) return res.status(404).json({ error: 'Introuvable' });
  res.json(sanitize(p));
});

app.get('/api/players/:id', (req, res) => {
  const player = pQ.getById.get(Number(req.params.id));
  if (!player || player.deleted) return res.status(404).json({ error: 'Compte supprimé' });
  const games      = gQ.getForPlayer.all(player.id, player.id);
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

  rQ.markUnlink.run(row.id);
  rQ.clearDiscord.run(playerId);

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

app.get('/api/leaderboard', (_, res) => {
  res.json(pQ.leaderboard.all().map(p => { const s = sanitize(p); return { ...s, rank: getRank(s.elo) }; }));
});
app.get('/api/leaderboard/wins', (_, res) => {
  const q = db.prepare('SELECT * FROM players ORDER BY wins DESC LIMIT 10');
  res.json(q.all().map(sanitize));
});

// ── Socket.io ──────────────────────────────────────────────────────────────────
io.on('connection', socket => {

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
  });

  socket.on('color_update', ({ color }) => {
    if (!socket.playerData || !color) return;
    if (!/^#[0-9a-fA-F]{6}$/.test(color)) return;
    pQ.updateColor.run({ color, id: socket.playerData.id });
    socket.playerData.color = color;
    const game = gm.getBySocket(socket.id);
    if (game) io.to('game:' + game.id).emit('color_updated', { playerId: socket.playerData.id, color });
  });

  socket.on('rejoin_game', ({ gameId }) => {
    socket.transitioning = false; // Le joueur est bien arrivé sur /game
    socket.join('game:' + gameId);
    const state = gm.games.get(gameId);
    if (state && state.status === 'active') {
      const side = state.players[1].id === socket.playerId ? 1
                 : state.players[2].id === socket.playerId ? 2 : null;
      if (side) { state.players[side].socketId = socket.id; gm.socketToGame.set(socket.id, gameId); }
    } else {
      const gameRow = gQ.getById.get(gameId);
      if (!gameRow || gameRow.status !== 'active') return socket.emit('game_not_found');
      const moves = mQ.getByGame.all(gameId);
      const { Board } = require('./game/Board');
      const board = new Board();
      moves.forEach(m => board.drop(m.col, gameRow.player1_id === m.player_id ? 1 : 2));
      const p1 = pQ.getById.get(gameRow.player1_id);
      const p2 = pQ.getById.get(gameRow.player2_id);
      const state = {
        id: gameId, board,
        players: {
          1: { ...sanitize(p1), socketId: gameRow.player1_id === socket.playerId ? socket.id : null },
          2: { ...sanitize(p2), socketId: gameRow.player2_id === socket.playerId ? socket.id : null },
        },
        current: moves.length % 2 === 0 ? 1 : 2,
        startedAt: Date.now(), lastMoveAt: Date.now(),
        moveCount: moves.length, status: 'active',
      };
      gm.games.set(gameId, state);
      gm.socketToGame.set(socket.id, gameId);
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
        }, 20000);
      }
      return;
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

  const state = gm.create(p1, p2);
  const room  = 'game:' + state.id;
  s1.join(room);
  s2.join(room);

  const base = {
    gameId: state.id,
    players: {
      1: { id: p1.id, pseudo: p1.pseudo, elo: p1.elo, color: p1.color || '#ff2d55', avatar: p1.avatar || '', shape: p1.shape || 'circle' },
      2: { id: p2.id, pseudo: p2.pseudo, elo: p2.elo, color: p2.color || '#ffd60a', avatar: p2.avatar || '', shape: p2.shape || 'circle' },
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

  bot.once('ready', () => {
    console.log(`✅ Bot connecté : ${bot.user.tag}`);
    updateStatus();
    setInterval(updateStatus, 10000);
  });

  // ── Commandes slash ───────────────────────────────────────────────────────
  const API = process.env.BASE_URL || 'https://puissance-4-website-production.up.railway.app';

  function eloRank(elo) {
    const r = getRank(elo);
    const emojis = { Malachite: '🟢', Quartz: '⚪', Ambre: '🟤', Jade: '🟦', Saphir: '🔵', Améthyste: '🟣' };
    return { label: r.label, emoji: emojis[r.name] || '🎮', color: r.color };
  }
  function winRate(p) {
    const t = (p.wins||0)+(p.losses||0)+(p.draws||0);
    return t ? Math.round((p.wins/t)*100)+'%' : '—';
  }

  bot.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;
    await interaction.deferReply();
    try {
      // /profil
      if (interaction.commandName === 'profil') {
        const pseudo = interaction.options.getString('pseudo');
        const data   = pQ.byPseudo?.get(pseudo) || db.prepare(`SELECT * FROM players WHERE LOWER(pseudo)=LOWER(?) AND deleted=0`).get(pseudo);
        if (!data) return interaction.editReply({ content: `❌ Joueur **${pseudo}** introuvable.` });
        const games  = gQ.getForPlayer.all(data.id).slice(0, 5);
        const rank   = eloRank(data.elo);
        const total  = (data.wins||0)+(data.losses||0)+(data.draws||0);
        const embed  = new EmbedBuilder()
          .setColor(rank.color || data.color || '#ff2d55')
          .setTitle(`${rank.emoji} ${data.pseudo}`)
          .setURL(`${API}/profil?id=${data.id}`)
          .setDescription(`**${rank.label}** · ${data.elo} ELO`)
          .addFields(
            { name: '🏆 Victoires', value: String(data.wins||0),   inline: true },
            { name: '💀 Défaites',  value: String(data.losses||0), inline: true },
            { name: '⚖️ Nuls',      value: String(data.draws||0),  inline: true },
            { name: '🎮 Parties',   value: String(total),           inline: true },
            { name: '📊 Win rate',  value: winRate(data),           inline: true },
          )
          .setFooter({ text: 'Puissance 4 Ranked' });
        if (data.avatar) embed.setThumbnail(data.avatar);
        if (games.length) {
          const lines = games.map(g => {
            const isP1 = g.player1_id === data.id;
            const opp  = isP1 ? g.p2_pseudo : g.p1_pseudo;
            const icon = g.winner_id === null ? '⚖️' : (g.winner_id === data.id ? '✅' : '❌');
            const d    = (isP1 ? g.elo_p1 : g.elo_p2);
            return `${icon} vs **${opp}** · ${d >= 0 ? '+' : ''}${d} ELO`;
          });
          embed.addFields({ name: '🕹️ Dernières parties', value: lines.join('\n') });
        }
        return interaction.editReply({ embeds: [embed] });
      }

      // /classement
      if (interaction.commandName === 'classement') {
        const players = db.prepare(`SELECT * FROM players WHERE deleted=0 ORDER BY elo DESC LIMIT 10`).all();
        if (!players.length) return interaction.editReply({ content: '❌ Aucun joueur.' });
        const medals = ['🥇','🥈','🥉'];
        const lines  = players.map((p,i) => `${medals[i]||`**#${i+1}**`} **${p.pseudo}** — ${p.elo} ELO · ${p.wins}V/${p.losses}D`);
        const embed  = new EmbedBuilder()
          .setColor('#ffd60a')
          .setTitle('🏆 Classement Puissance 4')
          .setURL(`${API}/leaderboard`)
          .setDescription(lines.join('\n'))
          .setFooter({ text: 'Top 10 · Puissance 4 Ranked' });
        return interaction.editReply({ embeds: [embed] });
      }

      // /live
      if (interaction.commandName === 'live') {
        const activeGames = gm ? Object.values(gm.games || {}).filter(g => g.status === 'active') : [];
        if (!activeGames.length) return interaction.editReply({ content: '😴 Aucune partie en cours.' });
        const lines = activeGames.map(g => {
          const p1 = g.players?.[1], p2 = g.players?.[2];
          if (!p1 || !p2) return null;
          return `⚔️ **${p1.pseudo}** vs **${p2.pseudo}** · ${g.moves||0} coups`;
        }).filter(Boolean);
        const embed = new EmbedBuilder()
          .setColor('#ff2d55')
          .setTitle(`🔴 ${activeGames.length} partie${activeGames.length>1?'s':''} en cours`)
          .setURL(`${API}/live`)
          .setDescription(lines.join('\n') || '—')
          .setFooter({ text: 'Puissance 4 Ranked · Live' });
        return interaction.editReply({ embeds: [embed] });
      }

    } catch(e) {
      console.error('[BOT]', e);
      interaction.editReply({ content: '❌ Erreur.' });
    }
  });

  bot.login(botToken).catch(e => console.error('[BOT] Login failed:', e));
}

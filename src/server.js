require('dotenv').config();
const express    = require('express');
const http       = require('http');
const { Server } = require('socket.io');
const path       = require('path');
const crypto     = require('crypto');

const { initDb, pQ, gQ, mQ, fQ } = require('./db/db');
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

app.use(express.json({ limit: '5mb' })); // pour les avatars base64
app.use(express.static(path.join(__dirname, 'public')));

// ── SPA routing ────────────────────────────────────────────────────────────────
app.get('/',           (_, res) => res.sendFile(path.join(__dirname, 'public/index.html')));
app.get('/game',       (_, res) => res.sendFile(path.join(__dirname, 'public/game.html')));
app.get('/profil',     (_, res) => res.sendFile(path.join(__dirname, 'public/profil.html')));
app.get('/replay/:id', (_, res) => res.sendFile(path.join(__dirname, 'public/replay.html')));
app.get('/regles',     (_, res) => res.sendFile(path.join(__dirname, 'public/regles.html')));

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
    res.json(sanitize(player));
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

  res.json(sanitize(player));
});

// Ne jamais renvoyer le hash du mot de passe au client
function sanitize(p) {
  const { password, ...rest } = p;
  return rest;
}

// ── Players API ────────────────────────────────────────────────────────────────
app.patch('/api/players/:id/color', (req, res) => {
  const { color } = req.body;
  if (!color || !/^#[0-9a-fA-F]{6}$/.test(color))
    return res.status(400).json({ error: 'Couleur invalide.' });
  pQ.updateColor.run({ color, id: Number(req.params.id) });
  res.json({ ok: true });
});

app.patch('/api/players/:id/avatar', (req, res) => {
  const { avatar } = req.body;
  if (!avatar || !avatar.startsWith('data:image/'))
    return res.status(400).json({ error: 'Image invalide.' });
  if (avatar.length > 3 * 1024 * 1024) // ~2MB base64
    return res.status(413).json({ error: 'Image trop lourde (max 2MB).' });
  pQ.updateAvatar.run({ avatar, id: Number(req.params.id) });
  res.json({ ok: true });
});

app.get('/api/players/by-pseudo/:pseudo', (req, res) => {
  const p = pQ.getByPseudo.get(req.params.pseudo);
  if (!p) return res.status(404).json({ error: 'Introuvable' });
  res.json(sanitize(p));
});

app.get('/api/players/:id', (req, res) => {
  const player = pQ.getById.get(Number(req.params.id));
  if (!player) return res.status(404).json({ error: 'Introuvable' });
  const games      = gQ.getForPlayer.all(player.id, player.id);
  const following  = fQ.getFollowing.all(player.id);
  const followers  = fQ.getFollowers.all(player.id);
  res.json({ player: sanitize(player), games, following, followers });
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

app.get('/api/games/:id', (req, res) => {
  const game = gQ.getById.get(Number(req.params.id));
  if (!game) return res.status(404).json({ error: 'Introuvable' });
  res.json(game);
});

app.get('/api/games/:id/moves', (req, res) => {
  const game = gQ.getById.get(Number(req.params.id));
  if (!game) return res.status(404).json({ error: 'Introuvable' });
  res.json({ game, moves: mQ.getByGame.all(Number(req.params.id)) });
});

app.get('/api/leaderboard', (_, res) => {
  res.json(pQ.leaderboard.all().map(sanitize));
});

// ── Socket.io ──────────────────────────────────────────────────────────────────
io.on('connection', socket => {

  socket.on('identify', ({ playerId }) => {
    const player = pQ.getById.get(playerId);
    if (!player) return socket.emit('error', { message: 'Joueur introuvable.' });
    socket.playerId   = playerId;
    socket.playerData = sanitize(player);
    socket.emit('identified', sanitize(player));
  });

  socket.on('queue_join', () => {
    if (!socket.playerData) return socket.emit('error', { message: 'Identifie-toi d\'abord.' });
    socket.playerData = sanitize(pQ.getById.get(socket.playerId));
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
  const state = gm.create(p1, p2);
  const room  = 'game:' + state.id;
  const s1    = io.sockets.sockets.get(p1.socketId);
  const s2    = io.sockets.sockets.get(p2.socketId);
  if (s1) s1.join(room);
  if (s2) s2.join(room);

  const base = {
    gameId: state.id,
    players: {
      1: { id: p1.id, pseudo: p1.pseudo, elo: p1.elo, color: p1.color || '#ff2d55', avatar: p1.avatar || '' },
      2: { id: p2.id, pseudo: p2.pseudo, elo: p2.elo, color: p2.color || '#ffd60a', avatar: p2.avatar || '' },
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

const PORT = process.env.PORT || 3000;
initDb().then(() => {
  server.listen(PORT, () => console.log(`✅  http://localhost:${PORT}`));
}).catch(e => { console.error('DB init failed:', e); process.exit(1); });

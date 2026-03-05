/**
 * server.js — Express + Socket.io
 */
require('dotenv').config();
const express    = require('express');
const http       = require('http');
const { Server } = require('socket.io');
const path       = require('path');

const { initDb, pQ, gQ, mQ } = require('./db/db');
const { Matchmaking }         = require('./game/Matchmaking');
const { GameManager }         = require('./game/GameManager');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, { cors: { origin: '*' } });

const mm = new Matchmaking();
const gm = new GameManager();

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── SPA routing ────────────────────────────────────────────────────────────────
app.get('/',           (_, res) => res.sendFile(path.join(__dirname, 'public/index.html')));
app.get('/game',       (_, res) => res.sendFile(path.join(__dirname, 'public/game.html')));
app.get('/profil',     (_, res) => res.sendFile(path.join(__dirname, 'public/profil.html')));
app.get('/replay/:id', (_, res) => res.sendFile(path.join(__dirname, 'public/replay.html')));

// ── API ────────────────────────────────────────────────────────────────────────
app.post('/api/players', (req, res) => {
  const { pseudo } = req.body;
  if (!pseudo?.trim()) return res.status(400).json({ error: 'pseudo requis' });
  try {
    let player = pQ.upsert.get({ pseudo: pseudo.trim() });
    if (!player) player = pQ.getByPseudo.get(pseudo.trim()); // fallback si conflit
    const { color } = req.body;
    if (color && /^#[0-9a-fA-F]{6}$/.test(color)) pQ.updateColor.run({ color, id: player.id });
    res.json(pQ.getById.get(player.id));
  }
  catch (e) {
    console.error('[POST /api/players]', e);
    res.status(500).json({ error: e.message, stack: e.stack });
  }
});

// Update player color/theme
app.patch('/api/players/:id/color', (req, res) => {
  const { color } = req.body;
  if (!color || !/^#[0-9a-fA-F]{6}$/.test(color))
    return res.status(400).json({ error: 'couleur invalide' });
  pQ.updateColor.run({ color, id: Number(req.params.id) });
  res.json({ ok: true });
});

app.get('/api/players/by-pseudo/:pseudo', (req, res) => {
  const p = pQ.getByPseudo.get(req.params.pseudo);
  if (!p) return res.status(404).json({ error: 'Introuvable' });
  res.json(p);
});

app.get('/api/players/:id', (req, res) => {
  const player = pQ.getById.get(Number(req.params.id));
  if (!player) return res.status(404).json({ error: 'Introuvable' });
  const games = gQ.getForPlayer.all(player.id, player.id);
  res.json({ player, games });
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

app.get('/api/leaderboard', (_, res) => res.json(pQ.leaderboard.all()));

// ── Socket.io ──────────────────────────────────────────────────────────────────
io.on('connection', socket => {

  socket.on('identify', ({ playerId }) => {
    const player = pQ.getById.get(playerId);
    if (!player) return socket.emit('error', { message: 'Joueur introuvable.' });
    socket.playerId   = playerId;
    socket.playerData = player;
    socket.emit('identified', player);
  });

  socket.on('queue_join', () => {
    if (!socket.playerData) return socket.emit('error', { message: 'Identifie-toi d\'abord.' });
    socket.playerData = pQ.getById.get(socket.playerId); // refresh elo
    const joined = mm.join(socket.id, { ...socket.playerData, socketId: socket.id });
    if (!joined) return socket.emit('error', { message: 'Déjà en queue.' });
    socket.emit('queue_joined', { position: mm.position(socket.id) });
    const match = mm.tryMatch();
    if (match) _startMatch(match.p1, match.p2);
  });

  socket.on('queue_leave', () => { mm.leave(socket.id); socket.emit('queue_left'); });

  // Reconnexion à une partie existante après redirect home → /game
  socket.on('rejoin_game', ({ gameId }) => {
    socket.join('game:' + gameId);

    const state = gm.games.get(gameId);
    if (state && state.status === 'active') {
      // Partie encore en RAM → juste mettre à jour le socketId
      const side = state.players[1].id === socket.playerId ? 1
                 : state.players[2].id === socket.playerId ? 2
                 : null;
      if (side) {
        state.players[side].socketId = socket.id;
        gm.socketToGame.set(socket.id, gameId);
      }
    } else {
      // Partie plus en RAM (serveur redémarré) → recréer depuis DB
      const gameRow = gQ.getById.get(gameId);
      if (!gameRow || gameRow.status !== 'active') {
        return socket.emit('game_not_found');
      }

      // Recréer les moves déjà joués pour rebuilder le board
      const moves = mQ.getByGame.all(gameId);
      const { Board } = require('./game/Board');
      const board = new Board();
      moves.forEach(m => board.drop(m.col, gameRow.player1_id === m.player_id ? 1 : 2));

      const p1 = pQ.getById.get(gameRow.player1_id);
      const p2 = pQ.getById.get(gameRow.player2_id);
      const currentTurn = moves.length % 2 === 0 ? 1 : 2;

      // Remettre la partie en RAM
      const state = {
        id: gameId,
        board,
        players: {
          1: { ...p1, socketId: gameRow.player1_id === socket.playerId ? socket.id : null },
          2: { ...p2, socketId: gameRow.player2_id === socket.playerId ? socket.id : null },
        },
        current:    currentTurn,
        startedAt:  Date.now(),
        lastMoveAt: Date.now(),
        moveCount:  moves.length,
        status:     'active',
      };
      gm.games.set(gameId, state);
      gm.socketToGame.set(socket.id, gameId);
    }
  });

  socket.on('play_move', ({ col }) => {
    const result = gm.playMove(socket.id, col);
    if (result.error) return socket.emit('error', { message: result.error });
    if (result.type === 'move')      io.to('game:' + result.gameId).emit('move_played', result);
    if (result.type === 'game_over') io.to('game:' + result.gameId).emit('game_over',   result);
  });

  // Player changed color mid-session → broadcast to ongoing game
  socket.on('color_update', ({ color }) => {
    if (!socket.playerData || !color) return;
    if (!/^#[0-9a-fA-F]{6}$/.test(color)) return;
    pQ.updateColor.run({ color, id: socket.playerData.id });
    socket.playerData.color = color;
    const game = gm.getBySocket(socket.id);
    if (game) io.to('game:' + game.id).emit('color_updated', { playerId: socket.playerData.id, color });
  });

  socket.on('disconnect', () => {
    mm.leave(socket.id);
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
      1: { id: p1.id, pseudo: p1.pseudo, elo: p1.elo, color: p1.color || '#ff2d55' },
      2: { id: p2.id, pseudo: p2.pseudo, elo: p2.elo, color: p2.color || '#ffd60a' },
    },
    startsIn: 3,
  };
  if (s1) s1.emit('match_found', { ...base, yourSide: 1 });
  if (s2) s2.emit('match_found', { ...base, yourSide: 2 });
}

// ── Boot ───────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
initDb().then(() => {
  server.listen(PORT, () => console.log(`✅  http://localhost:${PORT}`));
}).catch(e => { console.error('DB init failed:', e); process.exit(1); });

/**
 * db.js — better-sqlite3 (Railway utilise Node 20, binaires dispo)
 */
const Database = require('better-sqlite3');
const path     = require('path');
const fs       = require('fs');

const DB_PATH = path.join(__dirname, '../../data/p4.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS players (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    pseudo     TEXT    NOT NULL UNIQUE COLLATE NOCASE,
    elo        INTEGER NOT NULL DEFAULT 1000,
    wins       INTEGER NOT NULL DEFAULT 0,
    losses     INTEGER NOT NULL DEFAULT 0,
    draws      INTEGER NOT NULL DEFAULT 0,
    color      TEXT    NOT NULL DEFAULT '#ff2d55',
    created_at TEXT    NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS games (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    player1_id  INTEGER NOT NULL REFERENCES players(id),
    player2_id  INTEGER NOT NULL REFERENCES players(id),
    winner_id   INTEGER REFERENCES players(id),
    status      TEXT    NOT NULL DEFAULT 'active',
    move_count  INTEGER DEFAULT 0,
    duration    INTEGER DEFAULT 0,
    elo_p1      INTEGER DEFAULT 0,
    elo_p2      INTEGER DEFAULT 0,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
    finished_at TEXT
  );
  CREATE TABLE IF NOT EXISTS moves (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    game_id     INTEGER NOT NULL REFERENCES games(id),
    player_id   INTEGER NOT NULL REFERENCES players(id),
    col         INTEGER NOT NULL,
    row         INTEGER NOT NULL,
    move_number INTEGER NOT NULL,
    think_ms    INTEGER NOT NULL DEFAULT 0,
    played_at   TEXT    NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS boosts (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    multiplier  REAL    NOT NULL,
    applied_by  TEXT    NOT NULL,
    active      INTEGER NOT NULL DEFAULT 1,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_moves_game     ON moves(game_id);
  CREATE INDEX IF NOT EXISTS idx_games_p1       ON games(player1_id);
  CREATE INDEX IF NOT EXISTS idx_games_p2       ON games(player2_id);
  CREATE INDEX IF NOT EXISTS idx_players_pseudo ON players(pseudo);
`);

// ── Players ───────────────────────────────────────────────────────────────────
const pQ = {
  getById:     db.prepare(`SELECT * FROM players WHERE id = ?`),
  getByPseudo: db.prepare(`SELECT * FROM players WHERE pseudo = ? COLLATE NOCASE`),
  upsert:      db.prepare(`
    INSERT INTO players (pseudo) VALUES (@pseudo)
    ON CONFLICT(pseudo) DO UPDATE SET pseudo = pseudo
    RETURNING *
  `),
  updateColor: db.prepare(`UPDATE players SET color = @color WHERE id = @id`),
  updateElo:   db.prepare(`UPDATE players SET elo = elo + @delta WHERE id = @id`),
  win:         db.prepare(`UPDATE players SET wins   = wins   + 1 WHERE id = ?`),
  loss:        db.prepare(`UPDATE players SET losses = losses + 1 WHERE id = ?`),
  draw:        db.prepare(`UPDATE players SET draws  = draws  + 1 WHERE id = ?`),
  leaderboard: db.prepare(`SELECT * FROM players ORDER BY elo DESC LIMIT 10`),
};

// ── Games ─────────────────────────────────────────────────────────────────────
const gQ = {
  create: db.prepare(`INSERT INTO games (player1_id, player2_id) VALUES (@p1, @p2)`),
  getById: db.prepare(`
    SELECT g.*,
      p1.pseudo AS p1_pseudo, p1.elo AS p1_elo, p1.color AS p1_color,
      p2.pseudo AS p2_pseudo, p2.elo AS p2_elo, p2.color AS p2_color,
      w.pseudo  AS winner_pseudo
    FROM games g
    JOIN players p1 ON g.player1_id = p1.id
    JOIN players p2 ON g.player2_id = p2.id
    LEFT JOIN players w ON g.winner_id = w.id
    WHERE g.id = ?
  `),
  finish: db.prepare(`
    UPDATE games SET status='finished', winner_id=@winner_id,
      move_count=@move_count, duration=@duration,
      elo_p1=@elo_p1, elo_p2=@elo_p2, finished_at=datetime('now')
    WHERE id=@id
  `),
  getForPlayer: db.prepare(`
    SELECT g.*,
      p1.pseudo AS p1_pseudo, p1.elo AS p1_elo,
      p2.pseudo AS p2_pseudo, p2.elo AS p2_elo,
      w.pseudo  AS winner_pseudo
    FROM games g
    JOIN players p1 ON g.player1_id = p1.id
    JOIN players p2 ON g.player2_id = p2.id
    LEFT JOIN players w ON g.winner_id = w.id
    WHERE (g.player1_id = ? OR g.player2_id = ?)
      AND g.status = 'finished'
    ORDER BY g.finished_at DESC LIMIT 25
  `),
};

// ── Moves ─────────────────────────────────────────────────────────────────────
const mQ = {
  insert: db.prepare(`
    INSERT INTO moves (game_id, player_id, col, row, move_number, think_ms)
    VALUES (@game_id, @player_id, @col, @row, @move_number, @think_ms)
  `),
  getByGame: db.prepare(`SELECT * FROM moves WHERE game_id = ? ORDER BY move_number ASC`),
};

// ── Boosts ────────────────────────────────────────────────────────────────────
const bQ = {
  create:        db.prepare(`INSERT INTO boosts (multiplier, applied_by) VALUES (@multiplier, @applied_by)`),
  getActive:     db.prepare(`SELECT * FROM boosts WHERE active = 1 ORDER BY created_at DESC LIMIT 1`),
  deactivateAll: db.prepare(`UPDATE boosts SET active = 0`),
};

// ── Elo ───────────────────────────────────────────────────────────────────────
function calcElo(winnerElo, loserElo, isDraw = false) {
  const K    = 32;
  const expW = 1 / (1 + Math.pow(10, (loserElo - winnerElo) / 400));
  const mult = bQ.getActive.get()?.multiplier ?? 1;
  return isDraw
    ? { dW: Math.round(K*(0.5-expW)*mult),  dL: Math.round(K*(0.5-(1-expW))*mult) }
    : { dW: Math.round(K*(1-expW)*mult),     dL: Math.round(K*(0-(1-expW))*mult) };
}

const finishGame = db.transaction((gameId, winnerId, loserId, moveCount, duration, isDraw) => {
  const winner = pQ.getById.get(winnerId);
  const loser  = pQ.getById.get(loserId);
  const { dW, dL } = calcElo(winner.elo, loser.elo, isDraw);

  pQ.updateElo.run({ delta: dW, id: winnerId });
  pQ.updateElo.run({ delta: dL, id: loserId });

  if (isDraw) { pQ.draw.run(winnerId); pQ.draw.run(loserId); }
  else        { pQ.win.run(winnerId);  pQ.loss.run(loserId); }

  gQ.finish.run({
    id: gameId, winner_id: isDraw ? null : winnerId,
    move_count: moveCount, duration,
    elo_p1: dW, elo_p2: dL,
  });

  return { dW, dL, winnerEloNow: pQ.getById.get(winnerId).elo, loserEloNow: pQ.getById.get(loserId).elo };
});

function initDb() { return Promise.resolve(); } // sync, rien à attendre

module.exports = { initDb, db, pQ, gQ, mQ, bQ, calcElo, finishGame };

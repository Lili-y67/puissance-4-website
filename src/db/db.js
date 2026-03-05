/**
 * db.js — SQLite via sql.js (pure JS, zero native compilation)
 * Persists to disk manually via fs after each write.
 */
const initSqlJs = require('sql.js');
const path      = require('path');
const fs        = require('fs');

const DB_PATH = path.join(__dirname, '../../data/p4.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

let _db   = null;
let ready = null;

function initDb() {
  if (ready) return ready;
  ready = initSqlJs().then(SQL => {
    const fileExists = fs.existsSync(DB_PATH);
    _db = fileExists
      ? new SQL.Database(fs.readFileSync(DB_PATH))
      : new SQL.Database();

    _db.run(`PRAGMA foreign_keys = ON;`);
    _db.run(`
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
    persist();
    return _db;
  });
  return ready;
}

function persist() {
  if (!_db) return;
  try { fs.writeFileSync(DB_PATH, Buffer.from(_db.export())); }
  catch(e) { console.error('[DB] persist error:', e.message); }
}

function run(sql, params = {}) { _db.run(sql, params); persist(); }

function get(sql, params = {}) {
  const stmt = _db.prepare(sql);
  stmt.bind(params);
  if (stmt.step()) { const row = stmt.getAsObject(); stmt.free(); return row; }
  stmt.free(); return null;
}

function all(sql, params = {}) {
  const rows = [], stmt = _db.prepare(sql);
  stmt.bind(params);
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free(); return rows;
}

function lastId() { return get('SELECT last_insert_rowid() AS id').id; }

// ── Players ───────────────────────────────────────────────────────────────────
const pQ = {
  getById:    (id)     => get('SELECT * FROM players WHERE id = :id', { ':id': id }),
  getByPseudo:(pseudo) => get('SELECT * FROM players WHERE pseudo = :p COLLATE NOCASE', { ':p': pseudo }),
  upsert(pseudo) {
    const ex = pQ.getByPseudo(pseudo);
    if (ex) return ex;
    run('INSERT INTO players (pseudo) VALUES (:p)', { ':p': pseudo });
    return pQ.getById(lastId());
  },
  updateColor: (id, color) => run('UPDATE players SET color = :c WHERE id = :id', { ':c': color, ':id': id }),
  updateElo:   (id, delta) => run('UPDATE players SET elo = elo + :d WHERE id = :id', { ':d': delta, ':id': id }),
  setElo:      (id, elo)   => run('UPDATE players SET elo = :e WHERE id = :id', { ':e': elo, ':id': id }),
  win:         (id)        => run('UPDATE players SET wins   = wins   + 1 WHERE id = :id', { ':id': id }),
  loss:        (id)        => run('UPDATE players SET losses = losses + 1 WHERE id = :id', { ':id': id }),
  draw:        (id)        => run('UPDATE players SET draws  = draws  + 1 WHERE id = :id', { ':id': id }),
  leaderboard: ()          => all('SELECT * FROM players ORDER BY elo DESC LIMIT 10'),
};

// ── Games ─────────────────────────────────────────────────────────────────────
const gQ = {
  create(p1id, p2id) {
    run('INSERT INTO games (player1_id, player2_id) VALUES (:p1, :p2)', { ':p1': p1id, ':p2': p2id });
    return lastId();
  },
  getById: (id) => get(`
    SELECT g.*, p1.pseudo AS p1_pseudo, p1.elo AS p1_elo, p1.color AS p1_color,
      p2.pseudo AS p2_pseudo, p2.elo AS p2_elo, p2.color AS p2_color,
      w.pseudo AS winner_pseudo
    FROM games g
    JOIN players p1 ON g.player1_id = p1.id
    JOIN players p2 ON g.player2_id = p2.id
    LEFT JOIN players w ON g.winner_id = w.id
    WHERE g.id = :id
  `, { ':id': id }),
  finish({ id, winner_id, move_count, duration, elo_p1, elo_p2 }) {
    run(`UPDATE games SET status='finished', winner_id=:w, move_count=:mc,
      duration=:dur, elo_p1=:ep1, elo_p2=:ep2, finished_at=datetime('now')
      WHERE id=:id`,
      { ':w': winner_id ?? null, ':mc': move_count, ':dur': duration, ':ep1': elo_p1, ':ep2': elo_p2, ':id': id });
  },
  getForPlayer: (pid) => all(`
    SELECT g.*, p1.pseudo AS p1_pseudo, p1.elo AS p1_elo,
      p2.pseudo AS p2_pseudo, p2.elo AS p2_elo, w.pseudo AS winner_pseudo
    FROM games g
    JOIN players p1 ON g.player1_id = p1.id
    JOIN players p2 ON g.player2_id = p2.id
    LEFT JOIN players w ON g.winner_id = w.id
    WHERE (g.player1_id = :pid OR g.player2_id = :pid) AND g.status = 'finished'
    ORDER BY g.finished_at DESC LIMIT 25
  `, { ':pid': pid }),
};

// ── Moves ─────────────────────────────────────────────────────────────────────
const mQ = {
  insert: ({ game_id, player_id, col, row, move_number, think_ms }) =>
    run(`INSERT INTO moves (game_id,player_id,col,row,move_number,think_ms) VALUES (:g,:p,:c,:r,:mn,:t)`,
      { ':g': game_id, ':p': player_id, ':c': col, ':r': row, ':mn': move_number, ':t': think_ms }),
  getByGame: (gid) => all('SELECT * FROM moves WHERE game_id = :id ORDER BY move_number ASC', { ':id': gid }),
};

// ── Boosts ────────────────────────────────────────────────────────────────────
const bQ = {
  create:        (m, a)  => run('INSERT INTO boosts (multiplier,applied_by) VALUES (:m,:a)', { ':m': m, ':a': a }),
  getActive:     ()      => get('SELECT * FROM boosts WHERE active = 1 ORDER BY created_at DESC LIMIT 1'),
  deactivateAll: ()      => run('UPDATE boosts SET active = 0'),
};

// ── Elo ───────────────────────────────────────────────────────────────────────
function calcElo(winnerElo, loserElo, isDraw = false) {
  const K = 32, expW = 1 / (1 + Math.pow(10, (loserElo - winnerElo) / 400));
  const mult = (bQ.getActive()?.multiplier) ?? 1;
  return isDraw
    ? { dW: Math.round(K*(0.5-expW)*mult),   dL: Math.round(K*(0.5-(1-expW))*mult) }
    : { dW: Math.round(K*(1-expW)*mult),      dL: Math.round(K*(0-(1-expW))*mult) };
}

function finishGame(gameId, winnerId, loserId, moveCount, duration, isDraw) {
  const winner = pQ.getById(winnerId), loser = pQ.getById(loserId);
  const { dW, dL } = calcElo(winner.elo, loser.elo, isDraw);
  pQ.updateElo(winnerId, dW); pQ.updateElo(loserId, dL);
  if (isDraw) { pQ.draw(winnerId); pQ.draw(loserId); }
  else        { pQ.win(winnerId);  pQ.loss(loserId); }
  gQ.finish({ id: gameId, winner_id: isDraw ? null : winnerId, move_count: moveCount, duration, elo_p1: dW, elo_p2: dL });
  return { dW, dL, winnerEloNow: pQ.getById(winnerId).elo, loserEloNow: pQ.getById(loserId).elo };
}

module.exports = { initDb, pQ, gQ, mQ, bQ, calcElo, finishGame };

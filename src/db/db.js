/**
 * db.js — better-sqlite3
 */
const Database = require('better-sqlite3');
const path     = require('path');
const fs       = require('fs');

const DB_PATH = path.join(__dirname, '../../data/p4.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Migration : ajouter les colonnes couleur/shape si elles n'existent pas
['p1_color TEXT DEFAULT \'#ff2d55\'', 'p2_color TEXT DEFAULT \'#ffd60a\'', 'p1_shape TEXT DEFAULT \'circle\'', 'p2_shape TEXT DEFAULT \'circle\''].forEach(col => {
  try { db.exec(`ALTER TABLE games ADD COLUMN ${col}`); } catch(e) { /* déjà présente */ }
});

db.exec(`
  CREATE TABLE IF NOT EXISTS players (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    pseudo     TEXT    NOT NULL UNIQUE COLLATE NOCASE,
    password   TEXT    NOT NULL DEFAULT '',
    elo        INTEGER NOT NULL DEFAULT 1000,
    wins       INTEGER NOT NULL DEFAULT 0,
    losses     INTEGER NOT NULL DEFAULT 0,
    draws      INTEGER NOT NULL DEFAULT 0,
    color      TEXT    NOT NULL DEFAULT '#ff2d55',
    avatar     TEXT    NOT NULL DEFAULT '',
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
    p1_color    TEXT    DEFAULT '#ff2d55',
    p2_color    TEXT    DEFAULT '#ffd60a',
    p1_shape    TEXT    DEFAULT 'circle',
    p2_shape    TEXT    DEFAULT 'circle',
    created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
    finished_at TEXT
  );
  -- Migration : ajouter colonnes si elles n'existent pas encore
  CREATE TEMPORARY TABLE IF NOT EXISTS _tmp_check(x);
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
  CREATE TABLE IF NOT EXISTS sessions (
    token     TEXT PRIMARY KEY,
    player_id INTEGER NOT NULL,
    expires   INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS follows (
    follower_id  INTEGER NOT NULL REFERENCES players(id),
    following_id INTEGER NOT NULL REFERENCES players(id),
    created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (follower_id, following_id)
  );
  CREATE INDEX IF NOT EXISTS idx_moves_game     ON moves(game_id);
  CREATE INDEX IF NOT EXISTS idx_games_p1       ON games(player1_id);
  CREATE INDEX IF NOT EXISTS idx_games_p2       ON games(player2_id);
  CREATE INDEX IF NOT EXISTS idx_players_pseudo ON players(pseudo);
`);

// Migration : ajouter colonnes si absentes (pour DBs existantes)
try { db.exec(`ALTER TABLE players ADD COLUMN password TEXT NOT NULL DEFAULT ''`); } catch(e) {}
try { db.exec(`ALTER TABLE players ADD COLUMN avatar   TEXT NOT NULL DEFAULT ''`); } catch(e) {}
try { db.exec(`ALTER TABLE players ADD COLUMN shape      TEXT NOT NULL DEFAULT 'circle'`); } catch(e) {}
try { db.exec(`ALTER TABLE players ADD COLUMN suspicious  INTEGER NOT NULL DEFAULT 0`); } catch(e) {}
try { db.exec(`ALTER TABLE players ADD COLUMN discord_id   TEXT`); } catch(e) {}
try { db.exec(`ALTER TABLE players ADD COLUMN discord_info TEXT`); } catch(e) {}
try { db.exec(`ALTER TABLE players ADD COLUMN deleted     INTEGER NOT NULL DEFAULT 0`); } catch(e) {}
try { db.exec(`CREATE TABLE IF NOT EXISTS config (key TEXT PRIMARY KEY, value TEXT)`); } catch(e) {}
try { db.exec(`ALTER TABLE players ADD COLUMN banner     TEXT    NOT NULL DEFAULT ''`); } catch(e) {}
try { db.exec(`ALTER TABLE players ADD COLUMN role       TEXT    NOT NULL DEFAULT 'user'`); } catch(e) {}
try { db.exec(`ALTER TABLE players ADD COLUMN muted_until INTEGER`); } catch(e) {}
try { db.exec(`ALTER TABLE players ADD COLUMN banned     INTEGER NOT NULL DEFAULT 0`); } catch(e) {}
try { db.exec(`ALTER TABLE games ADD COLUMN suspicious INTEGER NOT NULL DEFAULT 0`); } catch(e) {}
try { db.exec(`ALTER TABLE players ADD COLUMN color    TEXT NOT NULL DEFAULT '#ff2d55'`); } catch(e) {}

// ── Players ───────────────────────────────────────────────────────────────────
const pQ = {
  getById:     db.prepare(`SELECT * FROM players WHERE id = ?`),
  getByPseudo: db.prepare(`SELECT * FROM players WHERE pseudo = ? COLLATE NOCASE`),
  register:    db.prepare(`
    INSERT INTO players (pseudo, password) VALUES (@pseudo, @password)
    RETURNING *
  `),
  updateColor:  db.prepare(`UPDATE players SET color  = @color  WHERE id = @id`),
  updateShape:    db.prepare(`UPDATE players SET shape    = @shape    WHERE id = @id`),
  updatePassword: db.prepare(`UPDATE players SET password  = @password  WHERE id = @id`),
  updateBanner:   db.prepare(`UPDATE players SET banner   = @banner   WHERE id = @id`),
  updateRole:     db.prepare(`UPDATE players SET role     = @role     WHERE id = @id`),
  updatePseudo:   db.prepare(`UPDATE players SET pseudo   = @pseudo   WHERE id = @id`),
  setMute:        db.prepare(`UPDATE players SET muted_until = @until WHERE id = @id`),
  setBanned:      db.prepare(`UPDATE players SET banned   = @banned   WHERE id = @id`),
  updateAvatar: db.prepare(`UPDATE players SET avatar = @avatar WHERE id = @id`),
  updateElo:    db.prepare(`UPDATE players SET elo = elo + @delta WHERE id = @id`),
  win:          db.prepare(`UPDATE players SET wins   = wins   + 1 WHERE id = ?`),
  loss:         db.prepare(`UPDATE players SET losses = losses + 1 WHERE id = ?`),
  draw:         db.prepare(`UPDATE players SET draws  = draws  + 1 WHERE id = ?`),
  leaderboard:  db.prepare(`SELECT * FROM players ORDER BY elo DESC LIMIT 10`),
};

// ── Games ─────────────────────────────────────────────────────────────────────
const gQ = {
  create: db.prepare(`INSERT INTO games (player1_id, player2_id, p1_color, p2_color, p1_shape, p2_shape) VALUES (@p1, @p2, @p1_color, @p2_color, @p1_shape, @p2_shape)`),
  getById: db.prepare(`
    SELECT g.*,
      p1.pseudo AS p1_pseudo, p1.elo AS p1_elo,
      COALESCE(g.p1_color, p1.color, '#ff2d55') AS p1_color,
      COALESCE(g.p1_shape, 'circle') AS p1_shape,
      p1.avatar AS p1_avatar,
      p2.pseudo AS p2_pseudo, p2.elo AS p2_elo,
      COALESCE(g.p2_color, p2.color, '#ffd60a') AS p2_color,
      COALESCE(g.p2_shape, 'circle') AS p2_shape,
      p2.avatar AS p2_avatar,
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
      elo_p1=@elo_p1, elo_p2=@elo_p2,
      p1_color=@p1_color, p2_color=@p2_color,
      p1_shape=@p1_shape, p2_shape=@p2_shape,
      finished_at=datetime('now')
    WHERE id=@id
  `),
  getForPlayer: db.prepare(`
    SELECT g.*,
      p1.pseudo AS p1_pseudo, p1.elo AS p1_elo,
      p2.pseudo AS p2_pseudo, p2.elo AS p2_elo,
      w.pseudo  AS winner_pseudo,
      COALESCE(g.p1_color, p1.color) AS p1_color,
      COALESCE(g.p2_color, p2.color) AS p2_color
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

// ── Follows ──────────────────────────────────────────────────────────────────
const fQ = {
  follow:         db.prepare(`INSERT OR IGNORE INTO follows (follower_id, following_id) VALUES (?, ?)`),
  unfollow:       db.prepare(`DELETE FROM follows WHERE follower_id = ? AND following_id = ?`),
  isFollowing:    db.prepare(`SELECT 1 FROM follows WHERE follower_id = ? AND following_id = ?`),
  getFollowing:   db.prepare(`
    SELECT p.id, p.pseudo, p.elo, p.avatar, p.color, p.shape, p.wins, p.losses, p.draws
    FROM follows f JOIN players p ON p.id = f.following_id
    WHERE f.follower_id = ? ORDER BY p.elo DESC
  `),
  getFollowers:   db.prepare(`
    SELECT p.id, p.pseudo, p.elo, p.avatar, p.color, p.shape
    FROM follows f JOIN players p ON p.id = f.follower_id
    WHERE f.following_id = ? ORDER BY f.created_at DESC
  `),
  countFollowing: db.prepare(`SELECT COUNT(*) as n FROM follows WHERE follower_id  = ?`),
  countFollowers: db.prepare(`SELECT COUNT(*) as n FROM follows WHERE following_id = ?`),
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

const finishGame = db.transaction((gameId, winnerId, loserId, moveCount, duration, isDraw, isSuspect = false) => {
  const winner = pQ.getById.get(winnerId);
  const loser  = pQ.getById.get(loserId);
  const { dW, dL } = calcElo(winner.elo, loser.elo, isDraw);

  if (!isSuspect) {
    // ELO et stats appliqués seulement si partie légitime
    pQ.updateElo.run({ delta: dW, id: winnerId });
    pQ.updateElo.run({ delta: dL, id: loserId });
    if (isDraw) { pQ.draw.run(winnerId); pQ.draw.run(loserId); }
    else        { pQ.win.run(winnerId);  pQ.loss.run(loserId); }
  }

  const game   = gQ.getById.get(gameId);
  const p1Delta = isSuspect ? 0 : (game.player1_id === winnerId ? dW : dL);
  const p2Delta = isSuspect ? 0 : (game.player2_id === winnerId ? dW : dL);

  gQ.finish.run({
    id: gameId, winner_id: isDraw ? null : winnerId,
    move_count: moveCount, duration,
    elo_p1: p1Delta, elo_p2: p2Delta,
    p1_color: game.p1_color || '#ff2d55',
    p2_color: game.p2_color || '#ffd60a',
    p1_shape: game.p1_shape || 'circle',
    p2_shape: game.p2_shape || 'circle',
  });

  // Marquer la partie comme suspecte en DB
  if (isSuspect) {
    db.prepare('UPDATE games SET suspicious = 1 WHERE id = ?').run(gameId);
  }

  return { dW: p1Delta, dL: p2Delta, winnerEloNow: pQ.getById.get(winnerId).elo, loserEloNow: pQ.getById.get(loserId).elo };
});

// ── Reset codes (Discord DM) ──────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS reset_codes (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    player_id  INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    code       TEXT    NOT NULL,
    expires_at INTEGER NOT NULL,
    used       INTEGER NOT NULL DEFAULT 0
  );
`);

// ── Anti-boost queries ────────────────────────────────────────────────────────
// Table pour les codes de déliaison Discord
db.exec(`CREATE TABLE IF NOT EXISTS unlink_codes (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  player_id  INTEGER NOT NULL,
  code       TEXT    NOT NULL,
  expires_at INTEGER NOT NULL,
  used       INTEGER NOT NULL DEFAULT 0
)`);

const rQ = {
  insert:    db.prepare(`INSERT INTO reset_codes (player_id, code, expires_at) VALUES (?, ?, ?)`),
  getValid:  db.prepare(`SELECT * FROM reset_codes WHERE player_id = ? AND code = ? AND expires_at > ? AND used = 0`),
  markUsed:  db.prepare(`UPDATE reset_codes SET used = 1 WHERE id = ?`),
  cleanup:   db.prepare(`DELETE FROM reset_codes WHERE expires_at < ? OR used = 1`),
  setDiscord:     db.prepare(`UPDATE players SET discord_id = ?, discord_info = ? WHERE id = ?`),
  clearDiscord:   db.prepare(`UPDATE players SET discord_id = NULL, discord_info = NULL WHERE id = ?`),
  insertUnlink:   db.prepare(`INSERT INTO unlink_codes (player_id, code, expires_at) VALUES (?, ?, ?)`),
  getUnlink:      db.prepare(`SELECT * FROM unlink_codes WHERE player_id = ? AND code = ? AND expires_at > ? AND used = 0`),
  markUnlink:     db.prepare(`UPDATE unlink_codes SET used = 1 WHERE id = ?`),
  cleanUnlink:    db.prepare(`DELETE FROM unlink_codes WHERE expires_at < ? OR used = 1`),
  clearDiscord:   db.prepare(`UPDATE players SET discord_id = NULL, discord_info = NULL WHERE id = ?`),
  getByDiscord: db.prepare(`SELECT * FROM players WHERE discord_id = ?`),
};

const abQ = {
  // Parties entre deux joueurs dans les dernières 2h
  recentBetween: db.prepare(`
    SELECT COUNT(*) as cnt FROM games
    WHERE status = 'finished'
      AND ((player1_id = ? AND player2_id = ?) OR (player1_id = ? AND player2_id = ?))
      AND finished_at > ?
  `),
  // Dernières 3 parties de chaque joueur (pour éviter re-match)
  lastOpponents: db.prepare(`
    SELECT CASE WHEN player1_id = ? THEN player2_id ELSE player1_id END as opp_id
    FROM games WHERE status = 'finished' AND (player1_id = ? OR player2_id = ?)
    ORDER BY finished_at DESC LIMIT 3
  `),
  // Qui a gagné dans les parties récentes entre deux joueurs
  recentWinsBetween: db.prepare(`
    SELECT winner_id FROM games
    WHERE status = 'finished' AND winner_id IS NOT NULL
      AND ((player1_id = ? AND player2_id = ?) OR (player1_id = ? AND player2_id = ?))
      AND finished_at > ?
  `),
  // Marquer un joueur comme suspect
  setSuspicious: db.prepare(`UPDATE players SET suspicious = @val WHERE id = @id`),
};

const sQ = {
  set:   db.prepare('INSERT OR REPLACE INTO sessions (token, player_id, expires) VALUES (?, ?, ?)'),
  get:   db.prepare('SELECT player_id, expires FROM sessions WHERE token = ?'),
  del:   db.prepare('DELETE FROM sessions WHERE token = ?'),
  purge: db.prepare('DELETE FROM sessions WHERE expires < ?'),
};

function initDb() { return Promise.resolve(); }

module.exports = { initDb, db, pQ, gQ, mQ, bQ, fQ, sQ, abQ, rQ, calcElo, finishGame };

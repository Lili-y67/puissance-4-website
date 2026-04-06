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

['tournament_id INTEGER', 'tournament_move_time_seconds INTEGER DEFAULT 0'].forEach(col => {
  try { db.exec(`ALTER TABLE games ADD COLUMN ${col}`); } catch(e) {}
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
try { db.exec(`ALTER TABLE players ADD COLUMN last_seen    INTEGER`); } catch(e) {}
try { db.exec(`ALTER TABLE games ADD COLUMN p1_accuracy REAL`); } catch(e) {}
try { db.exec(`ALTER TABLE games ADD COLUMN p2_accuracy REAL`); } catch(e) {}
try { db.exec(`ALTER TABLE games ADD COLUMN analysis_data TEXT`); } catch(e) {}
try { db.exec(`ALTER TABLE players ADD COLUMN discord_info TEXT`); } catch(e) {}
try { db.exec(`ALTER TABLE players ADD COLUMN deleted     INTEGER NOT NULL DEFAULT 0`); } catch(e) {}
try { db.exec(`CREATE TABLE IF NOT EXISTS config (key TEXT PRIMARY KEY, value TEXT)`); } catch(e) {}
try { db.exec(`ALTER TABLE players ADD COLUMN banner     TEXT    NOT NULL DEFAULT ''`); } catch(e) {}
try { db.exec(`ALTER TABLE players ADD COLUMN role       TEXT    NOT NULL DEFAULT 'user'`); } catch(e) {}
try { db.exec(`ALTER TABLE players ADD COLUMN is_vip     INTEGER NOT NULL DEFAULT 0`); } catch(e) {}
try { db.exec(`ALTER TABLE players ADD COLUMN is_vip_plus INTEGER NOT NULL DEFAULT 0`); } catch(e) {}
try { db.exec(`ALTER TABLE players ADD COLUMN is_perso INTEGER NOT NULL DEFAULT 0`); } catch(e) {}
try { db.exec(`ALTER TABLE players ADD COLUMN vip_expires_at INTEGER`); } catch(e) {}
try { db.exec(`ALTER TABLE players ADD COLUMN muted_until INTEGER`); } catch(e) {}
try { db.exec(`ALTER TABLE players ADD COLUMN banned     INTEGER NOT NULL DEFAULT 0`); } catch(e) {}
try { db.exec(`ALTER TABLE players ADD COLUMN custom_role_text  TEXT    NOT NULL DEFAULT ''`); } catch(e) {}
try { db.exec(`ALTER TABLE players ADD COLUMN custom_role_color TEXT    NOT NULL DEFAULT ''`); } catch(e) {}
try { db.exec(`ALTER TABLE players ADD COLUMN custom_role_emoji TEXT    NOT NULL DEFAULT ''`); } catch(e) {}
try { db.exec(`ALTER TABLE players ADD COLUMN token_emoji_image TEXT NOT NULL DEFAULT ''`); } catch(e) {}
try { db.exec(`ALTER TABLE players ADD COLUMN vip_media_changed_at INTEGER NOT NULL DEFAULT 0`); } catch(e) {}
try { db.exec(`ALTER TABLE players ADD COLUMN avatar_decoration TEXT NOT NULL DEFAULT ''`); } catch(e) {}
try { db.exec(`ALTER TABLE players ADD COLUMN avatar_decoration_changed_at INTEGER NOT NULL DEFAULT 0`); } catch(e) {}
try { db.exec(`ALTER TABLE players ADD COLUMN color_secondary TEXT NOT NULL DEFAULT ''`); } catch(e) {}
try { db.exec(`ALTER TABLE players ADD COLUMN coins INTEGER NOT NULL DEFAULT 0`); } catch(e) {}
try { db.exec(`ALTER TABLE players ADD COLUMN pseudo_changed_at INTEGER NOT NULL DEFAULT 0`); } catch(e) {}
try { db.exec(`ALTER TABLE players ADD COLUMN profile_banner TEXT NOT NULL DEFAULT ''`); } catch(e) {}
try { db.exec(`ALTER TABLE players ADD COLUMN profile_banner_changed_at INTEGER NOT NULL DEFAULT 0`); } catch(e) {}
try { db.exec(`ALTER TABLE players ADD COLUMN custom_bg_desktop TEXT NOT NULL DEFAULT ''`); } catch(e) {}
try { db.exec(`ALTER TABLE players ADD COLUMN custom_bg_mobile TEXT NOT NULL DEFAULT ''`); } catch(e) {}
try { db.exec(`ALTER TABLE players ADD COLUMN custom_bg_changed_at INTEGER NOT NULL DEFAULT 0`); } catch(e) {}
try { db.exec(`ALTER TABLE games ADD COLUMN suspicious INTEGER NOT NULL DEFAULT 0`); } catch(e) {}
try { db.exec(`ALTER TABLE games ADD COLUMN archived  INTEGER NOT NULL DEFAULT 0`); } catch(e) {}
// Table boost VIP individuel
db.exec(`CREATE TABLE IF NOT EXISTS vip_boosts (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  player_id    INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  activated_at INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL,
  tier         TEXT    NOT NULL DEFAULT 'vip',
  multiplier   REAL    NOT NULL DEFAULT 1.2
)`);
db.exec(`
  CREATE TABLE IF NOT EXISTS tournaments (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    public_id         TEXT,
    name              TEXT    NOT NULL,
    created_by        INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    mode              TEXT    NOT NULL DEFAULT 'manual',
    password          TEXT    NOT NULL DEFAULT '',
    duration_minutes  INTEGER NOT NULL DEFAULT 60,
    move_time_seconds INTEGER NOT NULL DEFAULT 30,
    reward_1          INTEGER NOT NULL DEFAULT 0,
    reward_2          INTEGER NOT NULL DEFAULT 0,
    reward_3          INTEGER NOT NULL DEFAULT 0,
    created_at        INTEGER NOT NULL,
    starts_at         INTEGER NOT NULL,
    ends_at           INTEGER NOT NULL,
    status            TEXT    NOT NULL DEFAULT 'active',
    paused_at         INTEGER,
    finished_at       INTEGER
  )
`);
db.exec(`
  CREATE TABLE IF NOT EXISTS tournament_players (
    tournament_id INTEGER NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
    player_id     INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    score         INTEGER NOT NULL DEFAULT 0,
    wins          INTEGER NOT NULL DEFAULT 0,
    losses        INTEGER NOT NULL DEFAULT 0,
    draws         INTEGER NOT NULL DEFAULT 0,
    streak        INTEGER NOT NULL DEFAULT 0,
    joined_at     INTEGER NOT NULL,
    PRIMARY KEY (tournament_id, player_id)
  )
`);
db.exec(`
  CREATE TABLE IF NOT EXISTS tournament_matches (
    tournament_id INTEGER NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
    game_id       INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    created_at    INTEGER NOT NULL,
    PRIMARY KEY (tournament_id, game_id)
  )
`);
try { db.exec(`ALTER TABLE vip_boosts ADD COLUMN tier TEXT NOT NULL DEFAULT 'vip'`); } catch(e) {}
try { db.exec(`ALTER TABLE vip_boosts ADD COLUMN multiplier REAL NOT NULL DEFAULT 1.2`); } catch(e) {}
try { db.exec(`ALTER TABLE tournaments ADD COLUMN public_id TEXT`); } catch(e) {}
try { db.exec(`ALTER TABLE tournaments ADD COLUMN paused_at INTEGER`); } catch(e) {}
try { db.exec(`ALTER TABLE games ADD COLUMN elo_before_p1 INTEGER`); } catch(e) {}
try { db.exec(`ALTER TABLE games ADD COLUMN elo_before_p2 INTEGER`); } catch(e) {}
try { db.exec(`ALTER TABLE games ADD COLUMN reverted      INTEGER NOT NULL DEFAULT 0`); } catch(e) {}
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
  updateVip:      db.prepare(`UPDATE players SET is_vip   = @is_vip   WHERE id = @id`),
  updateVipPlus:  db.prepare(`UPDATE players SET is_vip_plus = @is_vip_plus WHERE id = @id`),
  updatePerso:    db.prepare(`UPDATE players SET is_perso = @is_perso WHERE id = @id`),
  updateVipExpiry: db.prepare(`UPDATE players SET vip_expires_at = @vip_expires_at WHERE id = @id`),
  updateCustomRole: db.prepare(`UPDATE players SET custom_role_text = @text, custom_role_color = @color, custom_role_emoji = @emoji WHERE id = @id`),
  updateTokenEmojiImage: db.prepare(`UPDATE players SET token_emoji_image = @image WHERE id = @id`),
  updateVipMediaChangedAt: db.prepare(`UPDATE players SET vip_media_changed_at = @changedAt WHERE id = @id`),
  updateAvatarDecoration: db.prepare(`UPDATE players SET avatar_decoration = @image WHERE id = @id`),
  updateAvatarDecorationChangedAt: db.prepare(`UPDATE players SET avatar_decoration_changed_at = @changedAt WHERE id = @id`),
  updateProfileBanner: db.prepare(`UPDATE players SET profile_banner = @image WHERE id = @id`),
  updateProfileBannerChangedAt: db.prepare(`UPDATE players SET profile_banner_changed_at = @changedAt WHERE id = @id`),
  updateCustomBgDesktop: db.prepare(`UPDATE players SET custom_bg_desktop = @image WHERE id = @id`),
  updateCustomBgMobile: db.prepare(`UPDATE players SET custom_bg_mobile = @image WHERE id = @id`),
  updateCustomBgChangedAt: db.prepare(`UPDATE players SET custom_bg_changed_at = @changedAt WHERE id = @id`),
  updateColorSecondary: db.prepare(`UPDATE players SET color_secondary = @color_secondary WHERE id = @id`),
  updatePseudo:   db.prepare(`UPDATE players SET pseudo   = @pseudo   WHERE id = @id`),
  updatePseudoChangedAt: db.prepare(`UPDATE players SET pseudo_changed_at = @changedAt WHERE id = @id`),
  setMute:        db.prepare(`UPDATE players SET muted_until = @until WHERE id = @id`),
  setBanned:      db.prepare(`UPDATE players SET banned   = @banned   WHERE id = @id`),
  updateAvatar: db.prepare(`UPDATE players SET avatar = @avatar WHERE id = @id`),
  updateCoins:  db.prepare(`UPDATE players SET coins = @coins WHERE id = @id`),
  addCoins:     db.prepare(`UPDATE players SET coins = coins + @delta WHERE id = @id`),
  updateElo:    db.prepare(`UPDATE players SET elo = elo + @delta WHERE id = @id`),
  win:          db.prepare(`UPDATE players SET wins   = wins   + 1 WHERE id = ?`),
  loss:         db.prepare(`UPDATE players SET losses = losses + 1 WHERE id = ?`),
  draw:         db.prepare(`UPDATE players SET draws  = draws  + 1 WHERE id = ?`),
  leaderboard:  db.prepare(`SELECT * FROM players WHERE deleted = 0 ORDER BY elo DESC LIMIT 10`),
};

// ── Games ─────────────────────────────────────────────────────────────────────
const gQ = {
  create: db.prepare(`INSERT INTO games (player1_id, player2_id, p1_color, p2_color, p1_shape, p2_shape, tournament_id, tournament_move_time_seconds) VALUES (@p1, @p2, @p1_color, @p2_color, @p1_shape, @p2_shape, @tournament_id, @tournament_move_time_seconds)`),
  getById: db.prepare(`
    SELECT g.*,
      p1.pseudo AS p1_pseudo, p1.elo AS p1_elo,
      COALESCE(g.p1_color, p1.color, '#ff2d55') AS p1_color,
      p1.color_secondary AS p1_color_secondary,
      COALESCE(g.p1_shape, 'circle') AS p1_shape,
      p1.avatar AS p1_avatar,
      p1.avatar_decoration AS p1_avatar_decoration,
      p1.profile_banner AS p1_profile_banner,
      p1.token_emoji_image AS p1_token_emoji_image,
      p2.pseudo AS p2_pseudo, p2.elo AS p2_elo,
      COALESCE(g.p2_color, p2.color, '#ffd60a') AS p2_color,
      p2.color_secondary AS p2_color_secondary,
      COALESCE(g.p2_shape, 'circle') AS p2_shape,
      p2.avatar AS p2_avatar,
      p2.avatar_decoration AS p2_avatar_decoration,
      p2.profile_banner AS p2_profile_banner,
      p2.token_emoji_image AS p2_token_emoji_image,
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
      AND g.player1_id != ? AND g.player2_id != ?
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
function calcElo(winnerElo, loserElo, isDraw = false, winnerId = null) {
  const K          = 32;
  const expW       = 1 / (1 + Math.pow(10, (loserElo - winnerElo) / 400));
  const globalMult = bQ.getActive.get()?.multiplier ?? 1;
  // Boost VIP individuel sur le gagnant
  const vipActive  = winnerId && !isDraw ? vipQ.getActive.get(winnerId, Date.now()) : null;
  const vipMult    = vipActive ? Number(vipActive.multiplier || 1) : 1;
  const meta = {
    globalMultiplier: globalMult,
    vipApplied: !!vipActive,
    vipAppliedTo: vipActive ? winnerId : null,
    vipMultiplier: vipMult,
    vipTier: vipActive ? String(vipActive.tier || 'vip') : null,
  };
  // Arrondi au supérieur pour éviter les décimales
  const ceil = Math.ceil.bind(Math);
  const floor = Math.floor.bind(Math);
  if (isDraw) {
    const p1Delta = K * (0.5 - expW) * globalMult;
    const p2Delta = K * (0.5 - (1 - expW)) * globalMult;
    return {
      dW: p1Delta >= 0 ? ceil(p1Delta) : floor(p1Delta),
      dL: p2Delta >= 0 ? ceil(p2Delta) : floor(p2Delta),
      ...meta,
    };
  }
  return {
    dW: ceil(K * (1 - expW) * globalMult * vipMult),
    dL: floor(K * (0 - (1 - expW)) * globalMult), // pertes → floor (plus négatif)
  };
}

const finishGame = db.transaction((gameId, winnerId, loserId, moveCount, duration, isDraw, isSuspect = false) => {
  const game = gQ.getById.get(gameId);
  const player1 = pQ.getById.get(game.player1_id);
  const player2 = pQ.getById.get(game.player2_id);
  const winner = pQ.getById.get(winnerId);
  const loser  = pQ.getById.get(loserId);
  const eloCalc = calcElo(winner.elo, loser.elo, isDraw, isDraw ? null : winnerId);
  const dW = eloCalc.dW;
  const dL = eloCalc.dL;
  const vipApplied = isDraw ? false : !!vipQ.getActive.get(winnerId, Date.now());
  const vipAppliedTo = vipApplied ? winnerId : null;
  const globalMultiplier = eloCalc.globalMultiplier ?? (bQ.getActive.get()?.multiplier ?? 1);
  const activeBoost = vipApplied ? vipQ.getActive.get(winnerId, Date.now()) : null;
  const vipMultiplier = vipApplied ? Number(activeBoost?.multiplier || 1) : 1;
  const vipTier = vipApplied ? String(activeBoost?.tier || 'vip') : null;
  const p1Delta = isSuspect ? 0 : (game.player1_id === winnerId ? dW : dL);
  const p2Delta = isSuspect ? 0 : (game.player2_id === winnerId ? dW : dL);
  const coinBoost = (() => {
    try {
      const multiplier = Number(db.prepare(`SELECT value FROM config WHERE key = 'coin_boost_multiplier'`).get()?.value || 1);
      const expiresAt = Number(db.prepare(`SELECT value FROM config WHERE key = 'coin_boost_expires_at'`).get()?.value || 0);
      return expiresAt > Date.now() ? Math.max(1, multiplier) : 1;
    } catch(e) {
      return 1;
    }
  })();
  const p1Coins = isSuspect ? 0 : Math.ceil((1 + Math.floor(Math.random() * 3)) * coinBoost);
  const p2Coins = isSuspect ? 0 : Math.ceil((1 + Math.floor(Math.random() * 3)) * coinBoost);

  if (!isSuspect) {
    // ELO et stats appliqués seulement si partie légitime
    pQ.updateElo.run({ delta: p1Delta, id: game.player1_id });
    pQ.updateElo.run({ delta: p2Delta, id: game.player2_id });
    pQ.addCoins.run({ delta: p1Coins, id: game.player1_id });
    pQ.addCoins.run({ delta: p2Coins, id: game.player2_id });
    if (isDraw) {
      pQ.draw.run(game.player1_id);
      pQ.draw.run(game.player2_id);
    } else {
      pQ.win.run(winnerId);
      pQ.loss.run(loserId);
    }
  }

  // Stocker l'ELO avant la partie pour permettre un revert
  db.prepare(`UPDATE games SET elo_before_p1=?, elo_before_p2=? WHERE id=?`)
    .run(player1.elo, player2.elo, gameId);

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

  return {
    dW: p1Delta,
    dL: p2Delta,
    vipApplied,
    vipAppliedTo,
    globalMultiplier,
    vipMultiplier,
    vipTier,
    coinBoostMultiplier: coinBoost,
    coins: {
      [game.player1_id]: p1Coins,
      [game.player2_id]: p2Coins,
    },
    player1CoinsNow: pQ.getById.get(game.player1_id).coins,
    player2CoinsNow: pQ.getById.get(game.player2_id).coins,
    player1EloNow: pQ.getById.get(game.player1_id).elo,
    player2EloNow: pQ.getById.get(game.player2_id).elo,
    winnerEloNow: pQ.getById.get(winnerId).elo,
    loserEloNow: pQ.getById.get(loserId).elo,
  };
});

// ── Reset codes (Discord DM) ──────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS reset_codes (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    player_id  INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    code       TEXT    NOT NULL,
    expires_at INTEGER NOT NULL,
    used       INTEGER NOT NULL DEFAULT 0,
    ip_hash    TEXT
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

try { db.exec(`ALTER TABLE reset_codes ADD COLUMN ip_hash TEXT`); } catch(e) {}

const vipQ = {
  activate:   db.prepare(`INSERT INTO vip_boosts (player_id, activated_at, expires_at, tier, multiplier) VALUES (?,?,?,?,?)`),
  getActive:  db.prepare(`SELECT * FROM vip_boosts WHERE player_id=? AND expires_at > ? LIMIT 1`),
  // Vérifier si déjà utilisé aujourd'hui (reset à minuit)
  usedToday:  db.prepare(`SELECT * FROM vip_boosts WHERE player_id=? AND activated_at >= ? AND tier IN ('vip','vip_plus') LIMIT 1`),
  listActive: db.prepare(`
    SELECT v.*, p.pseudo, p.elo, p.color, p.avatar, p.is_vip_plus, p.is_perso
    FROM vip_boosts v JOIN players p ON v.player_id = p.id
    WHERE v.expires_at > ? ORDER BY v.expires_at DESC
  `),
};

const rQ = {
  insert:    db.prepare(`INSERT INTO reset_codes (player_id, code, expires_at, ip_hash) VALUES (?, ?, ?, ?)`),
  getValid:  db.prepare(`SELECT * FROM reset_codes WHERE player_id = ? AND code = ? AND expires_at > ? AND used = 0`),
  markUsed:  db.prepare(`UPDATE reset_codes SET used = 1 WHERE id = ?`),
  cleanup:   db.prepare(`DELETE FROM reset_codes WHERE expires_at < ? OR used = 1`),
  setDiscord:     db.prepare(`UPDATE players SET discord_id = ?, discord_info = ? WHERE id = ?`),
  updateLastSeen: db.prepare(`UPDATE players SET last_seen = ? WHERE id = ?`),
  setAccuracy:    db.prepare(`UPDATE games SET p1_accuracy = ?, p2_accuracy = ? WHERE id = ?`),
  saveAnalysis:   db.prepare(`UPDATE games SET analysis_data = ? WHERE id = ?`),
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

const tQ = {
  create: db.prepare(`
    INSERT INTO tournaments (
      public_id, name, created_by, mode, password, duration_minutes, move_time_seconds,
      reward_1, reward_2, reward_3, created_at, starts_at, ends_at, status, paused_at
    ) VALUES (
      @public_id, @name, @created_by, @mode, @password, @duration_minutes, @move_time_seconds,
      @reward_1, @reward_2, @reward_3, @created_at, @starts_at, @ends_at, @status, @paused_at
    )
  `),
  getById: db.prepare(`SELECT * FROM tournaments WHERE id = ?`),
  getByPublicId: db.prepare(`SELECT * FROM tournaments WHERE public_id = ?`),
  listAll: db.prepare(`
    SELECT
      t.*,
      p.pseudo AS creator_pseudo,
      COUNT(tp.player_id) AS participants
    FROM tournaments t
    JOIN players p ON p.id = t.created_by
    LEFT JOIN tournament_players tp ON tp.tournament_id = t.id
    GROUP BY t.id
    ORDER BY
      CASE t.status WHEN 'active' THEN 0 WHEN 'pending' THEN 1 WHEN 'paused' THEN 2 ELSE 3 END,
      t.starts_at ASC,
      t.created_at DESC
  `),
  listActiveForPair: db.prepare(`
    SELECT t.*
    FROM tournaments t
    JOIN tournament_players a ON a.tournament_id = t.id AND a.player_id = ?
    JOIN tournament_players b ON b.tournament_id = t.id AND b.player_id = ?
    WHERE t.status = 'active' AND t.ends_at > ?
  `),
  join: db.prepare(`
    INSERT OR IGNORE INTO tournament_players (tournament_id, player_id, joined_at)
    VALUES (@tournament_id, @player_id, @joined_at)
  `),
  getEntry: db.prepare(`
    SELECT * FROM tournament_players
    WHERE tournament_id = ? AND player_id = ?
  `),
  standings: db.prepare(`
    SELECT
      tp.*,
      p.pseudo,
      p.avatar,
      p.color,
      p.elo,
      p.role,
      p.is_vip,
      p.is_vip_plus,
      p.is_perso
    FROM tournament_players tp
    JOIN players p ON p.id = tp.player_id
    WHERE tp.tournament_id = ?
    ORDER BY tp.score DESC, tp.wins DESC, tp.streak DESC, tp.joined_at ASC
  `),
  markFinished: db.prepare(`
    UPDATE tournaments
    SET status = 'finished', finished_at = @finished_at, paused_at = NULL
    WHERE id = @id
  `),
  markActive: db.prepare(`
    UPDATE tournaments
    SET status = 'active', paused_at = NULL
    WHERE id = @id
  `),
  markPaused: db.prepare(`
    UPDATE tournaments
    SET status = 'paused', paused_at = @paused_at
    WHERE id = @id
  `),
  resumePaused: db.prepare(`
    UPDATE tournaments
    SET status = 'active', paused_at = NULL, ends_at = @ends_at
    WHERE id = @id
  `),
  addWinner: db.prepare(`
    UPDATE tournament_players
    SET score = score + @score_gain,
        wins = wins + 1,
        streak = streak + 1
    WHERE tournament_id = @tournament_id AND player_id = @player_id
  `),
  addLoser: db.prepare(`
    UPDATE tournament_players
    SET losses = losses + 1,
        streak = 0
    WHERE tournament_id = @tournament_id AND player_id = @player_id
  `),
  addDraw: db.prepare(`
    UPDATE tournament_players
    SET draws = draws + 1,
        streak = 0
    WHERE tournament_id = @tournament_id AND player_id = @player_id
  `),
  insertMatch: db.prepare(`
    INSERT OR IGNORE INTO tournament_matches (tournament_id, game_id, created_at)
    VALUES (?, ?, ?)
  `),
  hasMatch: db.prepare(`
    SELECT 1
    FROM tournament_matches
    WHERE tournament_id = ? AND game_id = ?
  `),
  listExpiredActive: db.prepare(`
    SELECT * FROM tournaments
    WHERE status = 'active' AND ends_at <= ?
    ORDER BY ends_at ASC
  `),
  listPendingToStart: db.prepare(`
    SELECT * FROM tournaments
    WHERE status = 'pending' AND starts_at <= ?
    ORDER BY starts_at ASC
  `),
};

function initDb() { return Promise.resolve(); }

module.exports = { initDb, db, pQ, gQ, mQ, bQ, vipQ, fQ, sQ, abQ, rQ, tQ, calcElo, finishGame };

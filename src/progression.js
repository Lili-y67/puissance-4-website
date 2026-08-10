const DAY_MS = 24 * 60 * 60 * 1000;

const FORTUNE_REWARDS = [
  { key: 'coins_25', label: '25 coins', shortLabel: '25', icon: '/assets/coin.png', coins: 25, gems: 0, weight: 20 },
  { key: 'gems_2', label: '2 gemmes', shortLabel: '2', icon: '/assets/gem.png', coins: 0, gems: 2, weight: 10 },
  { key: 'coins_40', label: '40 coins', shortLabel: '40', icon: '/assets/coin.png', coins: 40, gems: 0, weight: 17 },
  { key: 'gems_3', label: '3 gemmes', shortLabel: '3', icon: '/assets/gem.png', coins: 0, gems: 3, weight: 6 },
  { key: 'coins_60', label: '60 coins', shortLabel: '60', icon: '/assets/coin.png', coins: 60, gems: 0, weight: 14 },
  { key: 'gems_5', label: '5 gemmes', shortLabel: '5', icon: '/assets/gem.png', coins: 0, gems: 5, weight: 4 },
  { key: 'coins_80', label: '80 coins', shortLabel: '80', icon: '/assets/coin.png', coins: 80, gems: 0, weight: 11 },
  { key: 'gems_8', label: '8 gemmes', shortLabel: '8', icon: '/assets/gem.png', coins: 0, gems: 8, weight: 3 },
  { key: 'coins_120', label: '120 coins', shortLabel: '120', icon: '/assets/coin.png', coins: 120, gems: 0, weight: 8 },
  { key: 'gems_12', label: '12 gemmes', shortLabel: '12', icon: '/assets/gem.png', coins: 0, gems: 12, weight: 1 },
  { key: 'coins_200', label: '200 coins', shortLabel: '200', icon: '/assets/coin.png', coins: 200, gems: 0, weight: 5 },
  { key: 'grade_lucky', label: 'Grade Chanceux', shortLabel: 'GRADE', icon: '👑', coins: 0, gems: 0, grade: 'Chanceux', weight: 1 },
];

const CHALLENGES = [
  { key: 'daily_play', period: 'daily', icon: '🎮', rarity: 'common', label: 'Mise en jambes', description: 'Termine 2 parties classées.', metric: 'games', target: 2, coins: 30, xp: 35 },
  { key: 'daily_win', period: 'daily', icon: '🏆', rarity: 'rare', label: 'Première couronne', description: 'Remporte une partie classée.', metric: 'wins', target: 1, coins: 45, xp: 50 },
  { key: 'daily_moves', period: 'daily', icon: '🧠', rarity: 'common', label: 'Calculateur', description: 'Joue 35 coups cumulés.', metric: 'moves', target: 35, coins: 35, xp: 40 },
  { key: 'daily_tactician', period: 'daily', icon: '🎯', rarity: 'epic', label: 'Partie tactique', description: 'Termine une partie d’au moins 28 coups.', metric: 'thoughtful_games', target: 1, coins: 60, xp: 65 },
  { key: 'daily_elo', period: 'daily', icon: '📈', rarity: 'rare', label: 'Ascension', description: 'Gagne 20 points ELO cumulés.', metric: 'elo_gain', target: 20, coins: 55, xp: 60 },
  { key: 'daily_bot_win', period: 'daily', icon: '🤖', rarity: 'rare', label: 'Test de Turing inversé', description: 'Remporte une partie contre un bot.', metric: 'bot_wins', target: 1, coins: 50, xp: 55 },
  { key: 'daily_shop', period: 'daily', icon: '🛍️', rarity: 'common', label: 'Petite trouvaille', description: 'Effectue un achat dans la boutique.', metric: 'shop_purchases', target: 1, coins: 30, xp: 35 },
  { key: 'daily_profile', period: 'daily', icon: '✨', rarity: 'common', label: 'Nouveau look', description: 'Modifie un élément de ton profil.', metric: 'profile_updates', target: 1, coins: 25, xp: 30 },
  { key: 'daily_variant', period: 'daily', icon: '🎲', rarity: 'rare', label: 'Changer les règles', description: 'Termine une partie classée dans une variante.', metric: 'variant_games', target: 1, coins: 50, xp: 55 },
  { key: 'daily_collection', period: 'daily', icon: '🧿', rarity: 'rare', label: 'Pion voyageur', description: 'Ajoute un pion voyageur à ta collection.', metric: 'collectibles', target: 1, coins: 45, xp: 50 },
  { key: 'weekly_play', period: 'weekly', icon: '⚔️', rarity: 'common', label: 'Habitué de l’arène', description: 'Termine 12 parties classées.', metric: 'games', target: 12, coins: 140, xp: 140 },
  { key: 'weekly_win', period: 'weekly', icon: '👑', rarity: 'rare', label: 'Semaine dominante', description: 'Remporte 5 parties classées.', metric: 'wins', target: 5, coins: 190, xp: 180 },
  { key: 'weekly_fast', period: 'weekly', icon: '⚡', rarity: 'epic', label: 'Frappe éclair', description: 'Gagne 2 parties en moins de 3 minutes.', metric: 'fast_wins', target: 2, coins: 220, xp: 210 },
  { key: 'weekly_marathon', period: 'weekly', icon: '🔥', rarity: 'epic', label: 'Marathon mental', description: 'Termine 3 parties de 35 coups ou plus.', metric: 'marathon_games', target: 3, coins: 210, xp: 200 },
  { key: 'weekly_bot_hunter', period: 'weekly', icon: '🧩', rarity: 'epic', label: 'Chasseur de circuits', description: 'Termine 5 parties contre des bots.', metric: 'bot_games', target: 5, coins: 180, xp: 190 },
  { key: 'weekly_shopping', period: 'weekly', icon: '💰', rarity: 'rare', label: 'Collectionneur avisé', description: 'Effectue 3 achats dans la boutique.', metric: 'shop_purchases', target: 3, coins: 150, xp: 160 },
  { key: 'weekly_clan', period: 'weekly', icon: '🛡️', rarity: 'legendary', label: 'Pour la bannière', description: 'Rapporte 12 points à ton clan.', metric: 'clan_points', target: 12, coins: 260, xp: 250 },
  { key: 'weekly_variant_wins', period: 'weekly', icon: '🌀', rarity: 'epic', label: 'Maître des variantes', description: 'Remporte 3 parties classées hors mode classique.', metric: 'variant_wins', target: 3, coins: 230, xp: 225 },
  { key: 'weekly_collection', period: 'weekly', icon: '💠', rarity: 'epic', label: 'Collection en mouvement', description: 'Récupère 5 pions voyageurs.', metric: 'collectibles', target: 5, coins: 210, xp: 205 },
];

const BOARD_THEMES = [
  { key: 'classic', label: 'Classique', level: 1, icon: '🔵', tagline: 'La coque moderne d’origine.', colors: ['#1565c0', '#0d47a1', '#42a5f5'] },
  { key: 'arcade', label: 'Arcade 84', level: 3, icon: '📺', tagline: 'Signal CRT, scanlines et coque rétro.', colors: ['#07150f', '#15ff79', '#063d2a'] },
  { key: 'neon', label: 'Néon Pulse', level: 5, icon: '⚡', tagline: 'Contours électriques et lumière pulsée.', colors: ['#19002f', '#ff2bd6', '#00f7ff'] },
  { key: 'sunset', label: 'Solar Flare', level: 7, icon: '🌅', tagline: 'Métal chaud traversé par le soleil.', colors: ['#4a1208', '#ff5a1f', '#ffd60a'] },
  { key: 'ice', label: 'Cryo', level: 10, icon: '❄️', tagline: 'Verre givré et cristaux polaires.', colors: ['#092c4c', '#4dd9ff', '#e8fbff'] },
  { key: 'obsidian', label: 'Obsidienne', level: 14, icon: '💎', tagline: 'Pierre taillée aux failles violettes.', colors: ['#09080d', '#292431', '#a855f7'] },
];

function periodKey(period, now = Date.now()) {
  const date = new Date(now);
  const day = Math.floor(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) / DAY_MS);
  if (period === 'weekly') return `w${Math.floor((day + 3) / 7)}`;
  return `d${day}`;
}

function levelFromXp(xp) {
  return Math.max(1, Math.floor(Math.sqrt(Math.max(0, Number(xp || 0)) / 90)) + 1);
}

function periodEndsAt(period, now = Date.now()) {
  const date = new Date(now);
  const dayStart = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  if (period === 'weekly') {
    const weekday = (date.getUTCDay() + 6) % 7;
    return dayStart + (7 - weekday) * DAY_MS;
  }
  return dayStart + DAY_MS;
}

function createProgression({ db, pQ, cQ }) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS seasons (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      season_key TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      starts_at INTEGER NOT NULL,
      ends_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS season_player_stats (
      season_id INTEGER NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
      player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      games INTEGER NOT NULL DEFAULT 0,
      wins INTEGER NOT NULL DEFAULT 0,
      losses INTEGER NOT NULL DEFAULT 0,
      draws INTEGER NOT NULL DEFAULT 0,
      points INTEGER NOT NULL DEFAULT 0,
      peak_elo INTEGER NOT NULL DEFAULT 1000,
      PRIMARY KEY (season_id, player_id)
    );
    CREATE TABLE IF NOT EXISTS player_progression (
      player_id INTEGER PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
      xp INTEGER NOT NULL DEFAULT 0,
      fortune_tickets INTEGER NOT NULL DEFAULT 0,
      daily_ticket_key TEXT NOT NULL DEFAULT '',
      fortune_grade TEXT NOT NULL DEFAULT '',
      equipped_board_theme TEXT NOT NULL DEFAULT 'classic',
      updated_at INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS challenge_progress (
      player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      challenge_key TEXT NOT NULL,
      period_key TEXT NOT NULL,
      progress INTEGER NOT NULL DEFAULT 0,
      claimed INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (player_id, challenge_key, period_key)
    );
    CREATE TABLE IF NOT EXISTS progression_game_events (
      game_id INTEGER PRIMARY KEY REFERENCES games(id) ON DELETE CASCADE,
      processed_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS clan_mission_progress (
      clan_id INTEGER NOT NULL REFERENCES clans(id) ON DELETE CASCADE,
      period_key TEXT NOT NULL,
      mission_key TEXT NOT NULL,
      progress INTEGER NOT NULL DEFAULT 0,
      target INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (clan_id, period_key, mission_key)
    );
    CREATE TABLE IF NOT EXISTS spectator_predictions (
      game_id INTEGER NOT NULL,
      player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      predicted_side INTEGER NOT NULL,
      resolved INTEGER NOT NULL DEFAULT 0,
      correct INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (game_id, player_id)
    );
  `);
  try { db.exec(`ALTER TABLE player_progression ADD COLUMN fortune_tickets INTEGER NOT NULL DEFAULT 0`); } catch {}
  try { db.exec(`ALTER TABLE player_progression ADD COLUMN daily_ticket_key TEXT NOT NULL DEFAULT ''`); } catch {}
  try { db.exec(`ALTER TABLE player_progression ADD COLUMN fortune_grade TEXT NOT NULL DEFAULT ''`); } catch {}

  const q = {
    event: db.prepare(`INSERT OR IGNORE INTO progression_game_events (game_id, processed_at) VALUES (?, ?)`),
    season: db.prepare(`SELECT * FROM seasons WHERE starts_at <= ? AND ends_at > ? ORDER BY starts_at DESC LIMIT 1`),
    addSeason: db.prepare(`INSERT INTO seasons (season_key, name, starts_at, ends_at) VALUES (?, ?, ?, ?)`),
    seasonUpsert: db.prepare(`
      INSERT INTO season_player_stats (season_id, player_id, games, wins, losses, draws, points, peak_elo)
      VALUES (@season_id, @player_id, 1, @wins, @losses, @draws, @points, @peak_elo)
      ON CONFLICT(season_id, player_id) DO UPDATE SET
        games = games + 1,
        wins = wins + excluded.wins,
        losses = losses + excluded.losses,
        draws = draws + excluded.draws,
        points = points + excluded.points,
        peak_elo = MAX(peak_elo, excluded.peak_elo)
    `),
    progression: db.prepare(`SELECT * FROM player_progression WHERE player_id = ?`),
    ensureProgression: db.prepare(`INSERT OR IGNORE INTO player_progression (player_id, updated_at) VALUES (?, ?)`),
    addXp: db.prepare(`UPDATE player_progression SET xp = xp + ?, updated_at = ? WHERE player_id = ?`),
    addTickets: db.prepare(`UPDATE player_progression SET fortune_tickets = fortune_tickets + ?, updated_at = ? WHERE player_id = ?`),
    spendTicket: db.prepare(`UPDATE player_progression SET fortune_tickets = fortune_tickets - 1, updated_at = ? WHERE player_id = ? AND fortune_tickets > 0`),
    claimDailyTicket: db.prepare(`UPDATE player_progression SET fortune_tickets = fortune_tickets + 1, daily_ticket_key = ?, updated_at = ? WHERE player_id = ? AND daily_ticket_key <> ?`),
    setFortuneGrade: db.prepare(`UPDATE player_progression SET fortune_grade = ?, updated_at = ? WHERE player_id = ?`),
    setTheme: db.prepare(`UPDATE player_progression SET equipped_board_theme = ?, updated_at = ? WHERE player_id = ?`),
    challenge: db.prepare(`SELECT * FROM challenge_progress WHERE player_id = ? AND challenge_key = ? AND period_key = ?`),
    challengeUpsert: db.prepare(`
      INSERT INTO challenge_progress (player_id, challenge_key, period_key, progress, claimed, updated_at)
      VALUES (?, ?, ?, ?, 0, ?)
      ON CONFLICT(player_id, challenge_key, period_key) DO UPDATE SET
        progress = progress + excluded.progress,
        updated_at = excluded.updated_at
    `),
    claim: db.prepare(`UPDATE challenge_progress SET claimed = 1, updated_at = ? WHERE player_id = ? AND challenge_key = ? AND period_key = ? AND claimed = 0`),
    clanForPlayer: db.prepare(`SELECT clan_id FROM clan_members WHERE player_id = ?`),
    clanMissionUpsert: db.prepare(`
      INSERT INTO clan_mission_progress (clan_id, period_key, mission_key, progress, target, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(clan_id, period_key, mission_key) DO UPDATE SET
        progress = progress + excluded.progress,
        target = excluded.target,
        updated_at = excluded.updated_at
    `),
    leaderboard: db.prepare(`
      SELECT sps.*, p.pseudo, p.avatar, p.color, p.elo
      FROM season_player_stats sps
      JOIN players p ON p.id = sps.player_id
      WHERE sps.season_id = ?
      ORDER BY sps.points DESC, sps.wins DESC, sps.peak_elo DESC
      LIMIT 50
    `),
    prediction: db.prepare(`
      INSERT INTO spectator_predictions (game_id, player_id, predicted_side, created_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(game_id, player_id) DO UPDATE SET predicted_side = excluded.predicted_side, created_at = excluded.created_at
    `),
    predictionStats: db.prepare(`
      SELECT predicted_side, COUNT(*) AS count
      FROM spectator_predictions
      WHERE game_id = ?
      GROUP BY predicted_side
    `),
    resolvePredictions: db.prepare(`
      UPDATE spectator_predictions
      SET resolved = 1, correct = CASE WHEN predicted_side = ? THEN 1 ELSE 0 END
      WHERE game_id = ? AND resolved = 0
    `),
  };

  function currentSeason(now = Date.now()) {
    let season = q.season.get(now, now);
    if (season) return season;
    const date = new Date(now);
    const quarter = Math.floor(date.getUTCMonth() / 3);
    const start = Date.UTC(date.getUTCFullYear(), quarter * 3, 1);
    const end = Date.UTC(date.getUTCFullYear(), quarter * 3 + 3, 1);
    const key = `${date.getUTCFullYear()}-S${quarter + 1}`;
    q.addSeason.run(key, `Saison ${quarter + 1} ${date.getUTCFullYear()}`, start, end);
    return q.season.get(now, now);
  }

  function ensurePlayer(playerId) {
    q.ensureProgression.run(Number(playerId), Date.now());
    return q.progression.get(Number(playerId));
  }

  function addChallengeMetric(playerId, metric, amount) {
    const now = Date.now();
    CHALLENGES.filter(item => item.metric === metric).forEach(item => {
      q.challengeUpsert.run(playerId, item.key, periodKey(item.period, now), Math.max(0, Math.trunc(amount)), now);
    });
  }

  function recordAction(playerId, metric, amount = 1) {
    const id = Number(playerId);
    const value = Math.max(0, Math.trunc(Number(amount || 0)));
    if (!id || !metric || !value) return false;
    ensurePlayer(id);
    addChallengeMetric(id, String(metric), value);
    return true;
  }

  const processGame = db.transaction(({ gameId, player1Id, player2Id, winnerId, isDraw, moveCount = 0, duration = 0, gameType = 'ranked', variant = 'classic', isSuspect = false, eloChanges = {} }) => {
    if (!gameId || isSuspect || String(gameType) === 'friendly') return false;
    if (!q.event.run(gameId, Date.now()).changes) return false;
    const season = currentSeason();
    const players = [Number(player1Id), Number(player2Id)];
    const playerRows = new Map(players.map(playerId => [playerId, pQ.getById.get(playerId)]));
    const hasBot = [...playerRows.values()].some(player => Number(player?.is_bot || 0) === 1);
    players.forEach(playerId => {
      const won = !isDraw && playerId === Number(winnerId);
      const player = playerRows.get(playerId);
      q.seasonUpsert.run({
        season_id: season.id,
        player_id: playerId,
        wins: won ? 1 : 0,
        losses: !isDraw && !won ? 1 : 0,
        draws: isDraw ? 1 : 0,
        points: won ? 3 : isDraw ? 1 : 0,
        peak_elo: Number(player?.elo || 1000),
      });
      ensurePlayer(playerId);
      q.addXp.run(won ? 35 : isDraw ? 22 : 15, Date.now(), playerId);
      addChallengeMetric(playerId, 'games', 1);
      addChallengeMetric(playerId, 'moves', Math.ceil(Number(moveCount || 0) / 2));
      if (Number(moveCount || 0) >= 28) addChallengeMetric(playerId, 'thoughtful_games', 1);
      if (Number(moveCount || 0) >= 35) addChallengeMetric(playerId, 'marathon_games', 1);
      addChallengeMetric(playerId, 'elo_gain', Math.max(0, Number(eloChanges?.[playerId] || 0)));
      if (won) addChallengeMetric(playerId, 'wins', 1);
      if (String(variant || 'classic') !== 'classic') {
        addChallengeMetric(playerId, 'variant_games', 1);
        if (won) addChallengeMetric(playerId, 'variant_wins', 1);
      }
      if (won && Number(duration || 0) > 0 && Number(duration || 0) <= 180) addChallengeMetric(playerId, 'fast_wins', 1);
      if (hasBot && Number(player?.is_bot || 0) !== 1) {
        addChallengeMetric(playerId, 'bot_games', 1);
        if (won) addChallengeMetric(playerId, 'bot_wins', 1);
      }

      const clanId = Number(q.clanForPlayer.get(playerId)?.clan_id || 0);
      if (clanId) {
        const points = won ? 3 : isDraw ? 1 : 0;
        q.clanMissionUpsert.run(clanId, periodKey('weekly'), 'play_games', 1, 20, Date.now());
        q.clanMissionUpsert.run(clanId, periodKey('weekly'), 'win_games', won ? 1 : 0, 8, Date.now());
        q.clanMissionUpsert.run(clanId, periodKey('weekly'), 'score_points', points, 30, Date.now());
        addChallengeMetric(playerId, 'clan_points', points);
      }
    });
    q.resolvePredictions.run(isDraw ? 0 : (Number(winnerId) === Number(player1Id) ? 1 : 2), gameId);
    return true;
  });

  function getPlayerData(playerId) {
    const row = ensurePlayer(playerId);
    const xp = Number(row.xp || 0);
    const level = levelFromXp(xp);
    const now = Date.now();
    const challenges = CHALLENGES.map(item => {
      const key = periodKey(item.period, now);
      const progress = q.challenge.get(playerId, item.key, key);
      return {
        ...item,
        gems: item.period === 'weekly' ? (item.rarity === 'legendary' ? 8 : item.rarity === 'epic' ? 5 : 3) : (item.rarity === 'epic' ? 2 : item.rarity === 'rare' ? 1 : 0),
        tickets: item.period === 'weekly' ? 1 : (item.rarity === 'epic' ? 1 : 0),
        progress: Math.min(item.target, Number(progress?.progress || 0)),
        completed: Number(progress?.progress || 0) >= item.target,
        claimed: !!Number(progress?.claimed || 0),
        expiresAt: periodEndsAt(item.period, now),
      };
    });
    const season = currentSeason(now);
    const seasonStats = db.prepare(`SELECT * FROM season_player_stats WHERE season_id = ? AND player_id = ?`).get(season.id, playerId) || null;
    return {
      xp,
      level,
      fortuneTickets: Number(row.fortune_tickets || 0),
      fortuneGrade: String(row.fortune_grade || ''),
      dailyTicket: { available: String(row.daily_ticket_key || '') !== periodKey('daily', now), nextAt: periodEndsAt('daily', now) },
      wallet: { coins: Number(pQ.getById.get(playerId)?.coins || 0), gems: Number(pQ.getById.get(playerId)?.gems || 0) },
      fortuneRewards: FORTUNE_REWARDS.map(({ weight, ...reward }) => reward.grade && String(row.fortune_grade || '') === reward.grade
        ? { ...reward, label: '1 ticket (grade déjà possédé)', shortLabel: '+1 TICKET', icon: '/assets/fortune-ticket.png', probability: weight }
        : { ...reward, probability: weight }),
      xpCurrent: xp - Math.pow(level - 1, 2) * 90,
      xpNext: Math.max(1, (Math.pow(level, 2) - Math.pow(level - 1, 2)) * 90),
      equippedBoardTheme: row.equipped_board_theme || 'classic',
      themes: BOARD_THEMES.map(theme => ({ ...theme, unlocked: level >= theme.level })),
      challenges,
      challengeSummary: {
        completed: challenges.filter(item => item.completed).length,
        claimed: challenges.filter(item => item.claimed).length,
        total: challenges.length,
        availableRewards: challenges.filter(item => item.completed && !item.claimed).length,
      },
      season: { ...season, stats: seasonStats },
    };
  }

  function claimChallenge(playerId, challengeKey) {
    const definition = CHALLENGES.find(item => item.key === challengeKey);
    if (!definition) throw new Error('Defi introuvable.');
    const key = periodKey(definition.period);
    const progress = q.challenge.get(playerId, definition.key, key);
    if (Number(progress?.progress || 0) < definition.target) throw new Error('Defi incomplet.');
    if (Number(progress?.claimed || 0)) throw new Error('Recompense deja recuperee.');
    if (!q.claim.run(Date.now(), playerId, definition.key, key).changes) throw new Error('Recompense indisponible.');
    ensurePlayer(playerId);
    const gems = definition.period === 'weekly' ? (definition.rarity === 'legendary' ? 8 : definition.rarity === 'epic' ? 5 : 3) : (definition.rarity === 'epic' ? 2 : definition.rarity === 'rare' ? 1 : 0);
    const tickets = definition.period === 'weekly' ? 1 : (definition.rarity === 'epic' ? 1 : 0);
    pQ.addCoins.run({ delta: definition.coins, id: playerId });
    if (gems) pQ.addGems.run({ delta: gems, id: playerId });
    if (tickets) q.addTickets.run(tickets, Date.now(), playerId);
    return { coins: definition.coins, gems, tickets };
  }

  const spinFortune = db.transaction(playerId => {
    const playerProgression = ensurePlayer(playerId);
    if (!q.spendTicket.run(Date.now(), playerId).changes) throw new Error('Tu n\'as pas de ticket Roue Fortune.');
    const total = FORTUNE_REWARDS.reduce((sum, reward) => sum + reward.weight, 0);
    let draw = Math.floor(Math.random() * total);
    const reward = FORTUNE_REWARDS.find(item => ((draw -= item.weight) < 0)) || FORTUNE_REWARDS[0];
    if (reward.coins) pQ.addCoins.run({ delta: reward.coins, id: playerId });
    if (reward.gems) pQ.addGems.run({ delta: reward.gems, id: playerId });
    if (reward.grade) {
      if (String(playerProgression.fortune_grade || '') === reward.grade) {
        q.addTickets.run(1, Date.now(), playerId);
        return { ...reward, label: '1 ticket (grade déjà possédé)', shortLabel: '+1 TICKET', icon: '/assets/fortune-ticket.png', grade: '', tickets: 1, converted: true, weight: undefined };
      }
      q.setFortuneGrade.run(reward.grade, Date.now(), playerId);
    }
    return { ...reward, weight: undefined };
  });

  function claimDailyTicket(playerId) {
    ensurePlayer(playerId);
    const today = periodKey('daily');
    if (!q.claimDailyTicket.run(today, Date.now(), playerId, today).changes) throw new Error('Ton ticket du jour a déjà été récupéré.');
    return { tickets: 1 };
  }

  function equipTheme(playerId, themeKey) {
    const data = getPlayerData(playerId);
    const theme = data.themes.find(item => item.key === themeKey);
    if (!theme) throw new Error('Theme introuvable.');
    if (!theme.unlocked) throw new Error(`Theme disponible au niveau ${theme.level}.`);
    q.setTheme.run(theme.key, Date.now(), playerId);
    return theme;
  }

  function getClanMissions(clanId) {
    const key = periodKey('weekly');
    const definitions = [
      { key: 'play_games', label: 'Jouer 20 parties', target: 20 },
      { key: 'win_games', label: 'Gagner 8 parties', target: 8 },
      { key: 'score_points', label: 'Marquer 30 points', target: 30 },
    ];
    return definitions.map(item => {
      const row = db.prepare(`SELECT * FROM clan_mission_progress WHERE clan_id = ? AND period_key = ? AND mission_key = ?`).get(clanId, key, item.key);
      return { ...item, progress: Math.min(item.target, Number(row?.progress || 0)), completed: Number(row?.progress || 0) >= item.target };
    });
  }

  function getClanWar(clanId) {
    const key = periodKey('weekly');
    const rows = db.prepare(`
      SELECT c.id, c.name, c.tag, c.color, c.blason, COALESCE(SUM(cmp.progress), 0) AS score
      FROM clans c
      LEFT JOIN clan_mission_progress cmp ON cmp.clan_id = c.id AND cmp.period_key = ?
      GROUP BY c.id
      ORDER BY score DESC, c.name COLLATE NOCASE
    `).all(key);
    const index = rows.findIndex(row => Number(row.id) === Number(clanId));
    if (index < 0) return null;
    const current = rows[index];
    const opponent = rows[index % 2 === 0 ? index + 1 : index - 1] || null;
    return {
      rank: index + 1,
      current,
      opponent,
      lead: opponent ? Number(current.score || 0) - Number(opponent.score || 0) : Number(current.score || 0),
      endsAt: (Math.floor((Date.now() / DAY_MS + 3) / 7) + 1) * 7 * DAY_MS - 3 * DAY_MS,
    };
  }

  function seasonData() {
    const season = currentSeason();
    return { season, leaderboard: q.leaderboard.all(season.id) };
  }

  function setPrediction(gameId, playerId, side) {
    if (![1, 2].includes(Number(side))) throw new Error('Pronostic invalide.');
    q.prediction.run(Number(gameId), Number(playerId), Number(side), Date.now());
  }

  function predictionStats(gameId) {
    const counts = { 1: 0, 2: 0 };
    q.predictionStats.all(Number(gameId)).forEach(row => { counts[Number(row.predicted_side)] = Number(row.count || 0); });
    return counts;
  }

  return {
    processGame,
    recordAction,
    getPlayerData,
    claimChallenge,
    spinFortune,
    claimDailyTicket,
    equipTheme,
    getClanMissions,
    getClanWar,
    seasonData,
    setPrediction,
    predictionStats,
    boardThemes: BOARD_THEMES,
  };
}

module.exports = { createProgression };

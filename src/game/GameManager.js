/**
 * GameManager.js - Active games + move recording with think_ms
 */
const { Board } = require('./Board');
const { gQ, mQ, aQ, finishGame, abQ } = require('../db/db');
const { wlogGame } = require('../webhooks');
const { getVariant, normalizeVariant, MISSION_DEFINITIONS } = require('./variants');
const { createNavalGrid } = require('./naval');
const {
  rotateCells: rotateTetrisCells,
  uniqueRotations: uniqueTetrisRotations,
  pieceCells: getTetrisPieceCells,
  positionValid: isTetrisPositionValid,
  createPiece: createTetrisPiece,
  hardDropY: getTetrisHardDropY,
  placePiece: placeTetrisPiece,
  resolveLines: resolveTetrisLines,
} = require('./tetris');

class GameManager {
  constructor() {
    this.games = new Map();
    this.socketToGame = new Map();
    this.nextTransientGameId = -1;

    this._afkInterval = setInterval(() => {
      const AFK_LIMIT = 3 * 60 * 1000;
      const now = Date.now();
      for (const [gameId, state] of this.games) {
        if (state.status !== 'active') continue;
        if (state.variant === 'tetris') continue;
        if (state.variant === 'mission' && (!state.missions[1] || !state.missions[2])) continue;
        const moveTimerLimit = Number(state.turnTimeLimitMs || 0);
        const limit = moveTimerLimit > 0 ? moveTimerLimit : AFK_LIMIT;
        if (now - state.lastMoveAt > limit) {
          const afkSide = state.variant === 'simultaneous'
            ? (state.simultaneousChoices[1] !== null && state.simultaneousChoices[2] === null ? 2
              : state.simultaneousChoices[2] !== null && state.simultaneousChoices[1] === null ? 1
              : state.initiative)
            : state.current;
          const winnerSide = afkSide === 1 ? 2 : 1;
          console.log(`[AFK] Partie ${gameId} - J${afkSide} AFK, J${winnerSide} gagne`);
          const result = this._end(state, winnerSide, [], 'afk');
          if (this._onAfkEnd) this._onAfkEnd(result);
        }
      }
    }, 1000);

    this._tetrisInterval = setInterval(() => {
      const now = Date.now();
      for (const state of this.games.values()) {
        if (state.status !== 'active' || state.variant !== 'tetris') continue;
        if (now < Number(state.tetrisStartsAt || 0)) continue;
        if (now >= Number(state.tetrisEndsAt || 0)) {
          const result = this._finishTetris(state);
          if (result && this._onTetrisEvent) this._onTetrisEvent(result);
          continue;
        }
        if (now < Number(state.tetrisNextFallAt || 0)) continue;
        state.tetrisNextFallAt = now + Number(state.variantConfig.fallEveryMs || 650);
        const result = this._stepTetris(state);
        if (result && this._onTetrisEvent) this._onTetrisEvent(result);
      }
    }, 100);
    this._tetrisInterval.unref?.();
  }

  create(p1, p2, options = {}) {
    const moveTimeSeconds = Number(options.moveTimeSeconds || 0) > 0
      ? Number(options.moveTimeSeconds)
      : 60;
    const persisted = options.persist !== false;
    const initialCurrent = Number(options.current) === 2 ? 2 : 1;

    const variant = normalizeVariant(options.variant);
    const variantConfig = getVariant(variant);
    const gameId = persisted
      ? gQ.create.run({
          p1: p1.id,
          p2: p2.id,
          p1_color: p1.color || '#ff2d55',
          p2_color: p2.color || '#ffd60a',
          p1_shape: p1.shape || 'circle',
          p2_shape: p2.shape || 'circle',
          tournament_id: options.tournamentId || null,
          tournament_move_time_seconds: moveTimeSeconds,
          game_type: String(options.gameType || 'ranked') === 'friendly' ? 'friendly' : 'ranked',
          variant,
        }).lastInsertRowid
      : this.nextTransientGameId--;

    const state = {
      id: gameId,
      board: new Board(variantConfig),
      variant,
      variantConfig,
      players: { 1: p1, 2: p2 },
      current: initialCurrent,
      startedAt: Date.now(),
      lastMoveAt: Date.now(),
      moveCount: 0,
      status: 'active',
      tournamentId: options.tournamentId || null,
      tournamentName: options.tournamentName || '',
      gameType: String(options.gameType || 'ranked') === 'friendly' ? 'friendly' : 'ranked',
      turnTimeLimitMs: moveTimeSeconds * 1000,
      moveTimeSeconds,
      persisted,
      bombs: { 1: true, 2: true },
      antiSegments: { 1: new Set(), 2: new Set() },
      antiScores: { 1: 0, 2: 0 },
      antiLastScorer: null,
      missions: { 1: null, 2: null },
      simultaneousChoices: { 1: null, 2: null },
      initiative: initialCurrent,
      conquestScores: { 1: 0, 2: 0 },
      conquestRound: 1,
      navalSecretGrid: null,
      navalWinningLine: [],
      navalRevealed: new Set(),
      tetrisScores: { 1: 0, 2: 0 },
      tetrisPiece: null,
      tetrisStartsAt: 0,
      tetrisEndsAt: 0,
      tetrisNextFallAt: 0,
      tetrisResets: 0,
      tetrisReadyAt: 0,
    };
    if (variant === 'naval') {
      const naval = createNavalGrid(gameId);
      state.navalSecretGrid = naval.grid;
      state.navalWinningLine = naval.winningLine;
    }
    if (variant === 'tetris') {
      state.turnTimeLimitMs = 0;
      state.moveTimeSeconds = 0;
      state.tetrisStartsAt = Date.now() + Number(options.startsInMs ?? 3000);
      state.tetrisEndsAt = state.tetrisStartsAt + Number(variantConfig.matchDurationMs || 180000);
      state.tetrisNextFallAt = state.tetrisStartsAt + Number(variantConfig.fallEveryMs || 650);
      this._spawnTetrisPiece(state);
    }

    this.games.set(gameId, state);
    this.socketToGame.set(p1.socketId, gameId);
    this.socketToGame.set(p2.socketId, gameId);
    return state;
  }

  playMove(socketId, col, requestedRow = null) {
    const gameId = this.socketToGame.get(socketId);
    if (!gameId) return { error: 'Aucune partie en cours.' };

    const state = this.games.get(gameId);
    if (!state || state.status !== 'active') return { error: 'Partie inactive.' };

    const playerNum = this._side(state, socketId);
    if (state.variant === 'tetris') return { error: 'Utilise les commandes p4-Tetris.' };
    if (state.variant === 'simultaneous') return this.submitSimultaneous(socketId, col);
    if (state.variant === 'mission' && (!state.missions[1] || !state.missions[2])) return { error: 'Les deux missions doivent être choisies.' };
    if (playerNum !== state.current) return { error: 'Pas ton tour.' };
    if (state.variant === 'naval') return this._playNaval(state, playerNum, requestedRow, col);
    if (!state.board.isValidCol(col)) return { error: 'Colonne invalide.' };
    if (state.variant === 'anti') {
      const forced = this._antiForcedCols(state, playerNum);
      if (forced.length && !forced.includes(Number(col))) return { error: 'Tu dois compléter un alignement de 4.', forcedCols: forced };
    }

    const now = Date.now();
    const thinkMs = now - state.lastMoveAt;
    const row = state.board.drop(col, playerNum);
    if (row === null) return { error: 'Coup impossible.' };

    state.moveCount++;
    state.lastMoveAt = now;

    if (state.persisted) {
      mQ.insert.run({
        game_id: gameId,
        player_id: state.players[playerNum].id,
        col,
        row,
        move_number: state.moveCount,
        think_ms: thinkMs,
      });
    }

    const lastMove = { row, col, player: playerNum };
    let winCells = state.board.checkWin(row, col, playerNum);
    if (state.variant === 'anti') {
      const fresh = state.board.getSegments(playerNum).filter(segment => !state.antiSegments[playerNum].has(segment.key));
      fresh.forEach(segment => state.antiSegments[playerNum].add(segment.key));
      if (fresh.length) state.antiLastScorer = playerNum;
      state.antiScores[playerNum] = state.antiSegments[playerNum].size;
      if (state.board.isDraw()) {
        const antiResult = this._resolveAntiWinner(state, playerNum);
        return this._end(
          state,
          antiResult.winner,
          [],
          antiResult.reason,
          lastMove,
          { antiTiebreak: antiResult.tiebreak }
        );
      }
    } else if (state.variant === 'conquest' && winCells) {
      return this._captureConquest(state, playerNum, lastMove);
    } else if (winCells && state.variant !== 'mission') return this._end(state, playerNum, winCells, 'win', lastMove);
    else if (state.variant === 'conquest' && state.board.isDraw()) {
      return this._resetConquestBoard(state, playerNum, lastMove);
    }

    let rotation = null;
    if (state.variant === 'rotate' && state.moveCount % state.variantConfig.rotateEvery === 0) {
      const direction = Math.random() < 0.5 ? -1 : 1;
      state.board.rotate(direction);
      const falls = state.board.applyGravity();
      rotation = { direction, falls, grid: state.board.grid.map(line => [...line]) };
      this._recordAction(state, playerNum, 'rotation', rotation);
      const wins = [1, 2].map(side => ({ side, segment: state.board.getSegments(side)[0] })).filter(item => item.segment);
      if (wins.length === 1) return this._end(state, wins[0].side, wins[0].segment.cells, 'rotation_win', lastMove, { rotation });
      if (wins.length === 2) return this._end(state, null, [], 'position_draw', lastMove, { rotation });
    }


    if (state.variant === 'mission') {
      const completed = this._missionComplete(state.board, playerNum, state.missions[playerNum]);
      if (completed) return this._end(state, playerNum, completed, 'mission', lastMove);
    }

    // Vérifier la grille pleine seulement après les effets de variante : le
    // dernier coup peut encore déclencher une rotation ou accomplir une mission.
    if (state.board.isDraw()) return this._end(state, null, [], 'draw', lastMove);

    state.current = state.current === 1 ? 2 : 1;
    return {
      type: 'move',
      gameId,
      row,
      col,
      player: playerNum,
      next: state.current,
      variant: state.variant,
      board: state.board.grid,
      rotation,
      antiScores: state.antiScores,
      conquestScores: state.conquestScores,
      forcedCols: state.variant === 'anti' ? this._antiForcedCols(state, state.current) : [],
    };
  }

  _publicTetrisPiece(piece) {
    if (!piece) return null;
    return {
      type: piece.type,
      player: Number(piece.player),
      x: Number(piece.x),
      y: Number(piece.y),
      cells: piece.cells.map(cell => [...cell]),
    };
  }

  _tetrisPayload(state, extra = {}) {
    return {
      type: 'tetris_state',
      gameId: state.id,
      variant: 'tetris',
      board: state.board.grid.map(row => [...row]),
      activePiece: this._publicTetrisPiece(state.tetrisPiece),
      tetrisScores: { 1: Number(state.tetrisScores[1] || 0), 2: Number(state.tetrisScores[2] || 0) },
      tetrisEndsAt: Number(state.tetrisEndsAt || 0),
      tetrisStartsAt: Number(state.tetrisStartsAt || 0),
      tetrisResets: Number(state.tetrisResets || 0),
      tetrisReadyAt: Number(state.tetrisReadyAt || 0),
      current: state.current,
      next: state.current,
      moveCount: state.moveCount,
      ...extra,
    };
  }

  _spawnTetrisPiece(state) {
    let reset = false;
    state.tetrisPiece = createTetrisPiece(state.current, state.board.cols);
    if (!isTetrisPositionValid(state.board.grid, state.tetrisPiece.cells, state.tetrisPiece.y, state.tetrisPiece.x)) {
      state.board = new Board(state.variantConfig);
      state.tetrisResets++;
      reset = true;
    }
    return reset;
  }

  _stepTetris(state) {
    if (Date.now() < Number(state.tetrisReadyAt || 0)) return null;
    const piece = state.tetrisPiece;
    if (!piece) return null;
    if (isTetrisPositionValid(state.board.grid, piece.cells, piece.y + 1, piece.x)) {
      piece.y++;
      return this._tetrisPayload(state, { action: 'fall' });
    }
    return this._lockTetrisPiece(state);
  }

  _lockTetrisPiece(state) {
    const piece = state.tetrisPiece;
    if (!piece) return { error: 'Pièce p4-Tetris indisponible.' };
    const actor = Number(piece.player);
    const placedAt = getTetrisPieceCells(piece);
    const placement = placeTetrisPiece(state.board.grid, piece, actor);
    state.tetrisPiece = null;
    state.moveCount++;
    const now = Date.now();
    const thinkMs = Math.max(0, now - Number(state.lastMoveAt || now));
    state.lastMoveAt = now;
    const captureStartBoard = state.board.grid.map(row => [...row]);
    const resolved = resolveTetrisLines(state.board.grid, state.tetrisScores);
    const fallDuration = falls => (falls || []).reduce((duration, fall) => Math.max(
      duration,
      420 + Math.max(1, Number(fall.row) - Number(fall.fromRow)) * 80,
    ), 0);
    const resolutionMs = resolved.lineCount > 0
      ? Math.min(fallDuration(placement.falls), 520)
        + resolved.lineCount * 500
        + resolved.captures.reduce((duration, capture) => {
          const fallMs = fallDuration(capture.falls);
          return duration + (fallMs ? fallMs + 30 : 0);
        }, 0)
      : 0;
    state.tetrisReadyAt = resolutionMs ? now + resolutionMs : 0;
    if (resolutionMs) state.tetrisNextFallAt = state.tetrisReadyAt + Number(state.variantConfig.fallEveryMs || 650);
    const firstCell = placedAt[0] || [0, 0];
    if (state.persisted) {
      mQ.insert.run({
        game_id: state.id,
        player_id: state.players[actor].id,
        col: Number(firstCell[1] || 0),
        row: Number(firstCell[0] || 0),
        move_number: state.moveCount,
        think_ms: thinkMs,
      });
    }
    state.current = actor === 1 ? 2 : 1;
    const reset = this._spawnTetrisPiece(state);
    const details = {
      action: 'lock',
      locked: true,
      actor,
      piece: { ...this._publicTetrisPiece(piece), placedAt },
      placedFalls: placement.falls,
      captures: resolved.captures,
      falls: resolved.falls,
      captureStartBoard: resolved.captures.length ? captureStartBoard : null,
      resolutionMs,
      reset,
    };
    this._recordAction(state, actor, 'tetris_lock', {
      ...details,
      board: state.board.grid,
      scores: state.tetrisScores,
      resets: state.tetrisResets,
      endsAt: state.tetrisEndsAt,
      nextPiece: this._publicTetrisPiece(state.tetrisPiece),
    });
    return this._tetrisPayload(state, details);
  }

  tetrisAction(socketId, requestedAction, payload = {}) {
    const state = this.getBySocket(socketId);
    if (!state || state.status !== 'active' || state.variant !== 'tetris') return { error: 'Partie p4-Tetris introuvable.' };
    const side = this._side(state, socketId);
    if (side !== state.current) return { error: 'Ce n’est pas ta pièce.' };
    if (Date.now() < Number(state.tetrisStartsAt || 0)) return { error: 'La partie n’a pas encore commencé.' };
    if (Date.now() < Number(state.tetrisReadyAt || 0)) return { error: 'Les lignes sont encore en train de disparaître.' };
    const piece = state.tetrisPiece;
    if (!piece) return { error: 'Pièce indisponible.' };
    const action = String(requestedAction || '').toLowerCase();
    let changed = false;
    if (action === 'left' || action === 'right') {
      const nextX = piece.x + (action === 'left' ? -1 : 1);
      if (isTetrisPositionValid(state.board.grid, piece.cells, piece.y, nextX)) {
        piece.x = nextX;
        changed = true;
      }
    } else if (action === 'rotate') {
      const rotated = rotateTetrisCells(piece.cells);
      for (const kick of [0, -1, 1, -2, 2]) {
        if (!isTetrisPositionValid(state.board.grid, rotated, piece.y, piece.x + kick)) continue;
        piece.cells = rotated;
        piece.x += kick;
        changed = true;
        break;
      }
    } else if (action === 'column') {
      const width = Math.max(...piece.cells.map(([, col]) => col)) + 1;
      const target = Math.max(0, Math.min(state.board.cols - width, Number(payload.col) - Math.floor(width / 2)));
      if (isTetrisPositionValid(state.board.grid, piece.cells, piece.y, target)) {
        piece.x = target;
        changed = true;
      }
    } else if (action === 'down') {
      state.tetrisNextFallAt = Date.now() + Number(state.variantConfig.fallEveryMs || 650);
      return this._stepTetris(state);
    } else if (action === 'drop') {
      piece.y = getTetrisHardDropY(state.board.grid, piece);
      return this._lockTetrisPiece(state);
    } else if (action === 'place') {
      const rotations = uniqueTetrisRotations(piece.type);
      const rotation = Math.max(0, Math.min(rotations.length - 1, Number(payload.rotation || 0)));
      const cells = rotations[rotation];
      const width = Math.max(...cells.map(([, col]) => col)) + 1;
      const x = Math.max(0, Math.min(state.board.cols - width, Number(payload.x || 0)));
      if (!isTetrisPositionValid(state.board.grid, cells, 0, x)) return { error: 'Placement robot impossible.' };
      piece.cells = cells.map(cell => [...cell]);
      piece.x = x;
      piece.y = getTetrisHardDropY(state.board.grid, piece);
      return this._lockTetrisPiece(state);
    } else return { error: 'Commande p4-Tetris inconnue.' };
    return this._tetrisPayload(state, { action, changed });
  }

  _finishTetris(state) {
    if (!state || state.status !== 'active') return null;
    const left = Number(state.tetrisScores[1] || 0);
    const right = Number(state.tetrisScores[2] || 0);
    const winner = left === right ? null : (left > right ? 1 : 2);
    return this._end(state, winner, [], winner ? 'tetris_score' : 'tetris_draw', null, {
      tetrisScores: { 1: left, 2: right },
      tetrisResets: Number(state.tetrisResets || 0),
    });
  }

  _playNaval(state, playerNum, requestedRow, requestedCol) {
    const row = Number(requestedRow), col = Number(requestedCol);
    if (!Number.isInteger(row) || !Number.isInteger(col) || row < 0 || row >= 6 || col < 0 || col >= 7) {
      return { error: 'Case navale invalide.' };
    }
    const key = `${row}:${col}`;
    if (state.navalRevealed.has(key)) return { error: 'Cette case est déjà révélée.' };
    const revealedPlayer = Number(state.navalSecretGrid?.[row]?.[col] || 0);
    if (!revealedPlayer) return { error: 'Grille navale indisponible.' };
    const now = Date.now();
    const thinkMs = now - state.lastMoveAt;
    state.navalRevealed.add(key);
    state.board.grid[row][col] = revealedPlayer;
    state.board.moveCount++;
    state.moveCount++;
    state.lastMoveAt = now;
    if (state.persisted) {
      mQ.insert.run({ game_id: state.id, player_id: state.players[playerNum].id, col, row, move_number: state.moveCount, think_ms: thinkMs });
    }
    this._recordAction(state, playerNum, 'naval_reveal', { row, col, revealedPlayer, board: state.board.grid });
    const lastMove = { row, col, player: revealedPlayer, actor: playerNum };
    const discovered = state.navalWinningLine.every(([r, c]) => state.navalRevealed.has(`${r}:${c}`));
    if (discovered) return this._end(state, playerNum, state.navalWinningLine, 'naval_discovery', lastMove);
    state.current = playerNum === 1 ? 2 : 1;
    return {
      type: 'move', gameId: state.id, variant: state.variant, row, col, player: revealedPlayer,
      actor: playerNum, next: state.current, board: state.board.grid, revealedCount: state.navalRevealed.size,
    };
  }


  _captureConquest(state, playerNum, lastMove) {
    const segments = state.board.getSegments(playerNum);
    const captured = [...new Set(segments.flatMap(segment => segment.cells.map(([row, col]) => `${row}:${col}`)))]
      .map(key => key.split(':').map(Number));
    state.conquestScores[playerNum]++;
    for (const [row, col] of captured) state.board.grid[row][col] = 0;
    const falls = state.board.applyGravity();
    this._recordAction(state, playerNum, 'conquest_capture', {
      captured, falls, scores: state.conquestScores, round: state.conquestRound,
    });

    const total = state.conquestScores[1] + state.conquestScores[2];
    const winner = state.conquestScores[playerNum] >= 3 ? playerNum : null;
    if (winner || total >= Number(state.variantConfig.pointsToResolve || 4)) {
      return this._end(state, winner, captured, winner ? 'conquest_win' : 'conquest_draw', lastMove, {
        conquestScores: state.conquestScores, conquest: { captured, falls },
      });
    }

    state.current = playerNum === 1 ? 2 : 1;
    return {
      type: 'conquest_capture', gameId: state.id, variant: state.variant, player: playerNum,
      captured, falls, board: state.board.grid, conquestScores: state.conquestScores,
      round: state.conquestRound, next: state.current,
    };
  }

  _resetConquestBoard(state, playerNum, lastMove) {
    state.board = new Board(state.variantConfig);
    state.conquestRound++;
    state.current = playerNum === 1 ? 2 : 1;
    this._recordAction(state, null, 'conquest_reset', {
      scores: state.conquestScores, round: state.conquestRound,
    });
    return {
      type: 'conquest_reset', gameId: state.id, variant: state.variant, board: state.board.grid,
      conquestScores: state.conquestScores, round: state.conquestRound, next: state.current, lastMove,
    };
  }

  useBomb(socketId, row, col) {
    const state = this.getBySocket(socketId);
    if (!state || state.status !== 'active') return { error: 'Partie inactive.' };
    const side = this._side(state, socketId);
    if (state.variant !== 'bomb') return { error: 'Les bombes ne sont pas actives dans cette variante.' };
    if (side !== state.current) return { error: 'Pas ton tour.' };
    if (!state.bombs[side]) return { error: 'Ta bombe a déjà été utilisée.' };
    row = Number(row); col = Number(col);
    if (row < 0 || row >= state.board.rows || col < 0 || col >= state.board.cols || !state.board.grid[row][col]) return { error: 'Choisis un jeton présent sur la grille.' };
    const removed = [];
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
      if (!dr && !dc) continue;
      const rr = row + dr, cc = col + dc;
      if (rr >= 0 && rr < state.board.rows && cc >= 0 && cc < state.board.cols && state.board.grid[rr][cc]) {
        removed.push({ row: rr, col: cc, player: state.board.grid[rr][cc] });
        state.board.grid[rr][cc] = 0;
      }
    }
    state.bombs[side] = false;
    state.moveCount++;
    state.lastMoveAt = Date.now();
    const falls = state.board.applyGravity();
    this._recordAction(state, side, 'bomb', { row, col, removed, falls, board: state.board.grid });
    const wins = [1, 2].map(player => ({ player, segment: state.board.getSegments(player)[0] })).filter(item => item.segment);
    if (wins.length === 1) return this._end(state, wins[0].player, wins[0].segment.cells, 'bomb_win', null, { bomb: { row, col, removed, falls } });
    if (wins.length === 2) return this._end(state, null, [], 'position_draw', null, { bomb: { row, col, removed, falls } });
    state.current = side === 1 ? 2 : 1;
    return { type: 'bomb', gameId: state.id, variant: state.variant, player: side, row, col, removed, falls, board: state.board.grid, bombs: state.bombs, next: state.current };
  }

  selectMission(socketId, missionId) {
    const state = this.getBySocket(socketId);
    if (!state || state.variant !== 'mission' || state.status !== 'active') return { error: 'Partie Mission personnelle introuvable.' };
    const side = this._side(state, socketId);
    const mission = MISSION_DEFINITIONS.find(item => item.id === String(missionId || ''));
    if (!mission) return { error: 'Mission inconnue.' };
    if (state.moveCount > 0 || state.missions[side]) return { error: 'La mission ne peut plus être modifiée.' };
    state.missions[side] = mission.id;
    this._recordAction(state, side, 'mission', { missionId: mission.id });
    const ready = !!(state.missions[1] && state.missions[2]);
    if (ready) {
      state.startedAt = Date.now();
      state.lastMoveAt = Date.now();
    }
    return { type: 'mission_selected', gameId: state.id, side, mission, ready };
  }

  submitSimultaneous(socketId, col) {
    const state = this.getBySocket(socketId);
    if (!state || state.variant !== 'simultaneous' || state.status !== 'active') return { error: 'Partie simultanée introuvable.' };
    const side = this._side(state, socketId);
    col = Number(col);
    if (!state.board.isValidCol(col)) return { error: 'Colonne invalide.' };
    if (state.simultaneousChoices[side] !== null) return { error: 'Choix déjà envoyé pour ce tour.' };
    state.simultaneousChoices[side] = col;
    if (state.simultaneousChoices[side === 1 ? 2 : 1] === null) return { type: 'simultaneous_wait', gameId: state.id, player: side };
    const order = state.initiative === 1 ? [1, 2] : [2, 1];
    const placements = [];
    for (const player of order) {
      const chosen = state.simultaneousChoices[player];
      const fallback = state.board.getValidCols()[0];
      const actual = state.board.isValidCol(chosen) ? chosen : fallback;
      if (actual === undefined) continue;
      const placedRow = state.board.drop(actual, player);
      placements.push({ player, col: actual, requestedCol: chosen, row: placedRow });
      state.moveCount++;
      if (state.persisted) mQ.insert.run({ game_id: state.id, player_id: state.players[player].id, col: actual, row: placedRow, move_number: state.moveCount, think_ms: 0 });
    }
    state.simultaneousChoices = { 1: null, 2: null };
    state.initiative = state.initiative === 1 ? 2 : 1;
    state.lastMoveAt = Date.now();
    this._recordAction(state, null, 'simultaneous_round', { placements, board: state.board.grid, initiative: state.initiative });
    const wins = [1, 2].map(player => ({ player, segment: state.board.getSegments(player)[0] })).filter(item => item.segment);
    if (wins.length === 1) return this._end(state, wins[0].player, wins[0].segment.cells, 'simultaneous_win', placements.at(-1), { placements });
    if (wins.length === 2) return this._end(state, null, [], 'position_draw', placements.at(-1), { placements });
    if (state.board.isDraw()) return this._end(state, null, [], 'draw', placements.at(-1), { placements });
    return { type: 'simultaneous_round', gameId: state.id, variant: state.variant, placements, board: state.board.grid, initiative: state.initiative };
  }

  _antiForcedCols(state, player) {
    return state.board.getValidCols().filter(col => {
      const copy = state.board.clone();
      const row = copy.drop(col, player);
      return !!copy.checkWin(row, col, player);
    });
  }

  _resolveAntiWinner(state, lastPlayer) {
    const comparisons = [
      {
        key: 'segments4',
        label: 'alignements de 4',
        values: {
          1: Number(state.antiScores[1] || 0),
          2: Number(state.antiScores[2] || 0),
        },
      },
      {
        key: 'segments3',
        label: 'alignements de 3',
        values: {
          1: state.board.getSegments(1, 3).length,
          2: state.board.getSegments(2, 3).length,
        },
      },
      {
        key: 'segments2',
        label: 'alignements de 2',
        values: {
          1: state.board.getSegments(1, 2).length,
          2: state.board.getSegments(2, 2).length,
        },
      },
    ];

    for (const comparison of comparisons) {
      if (comparison.values[1] === comparison.values[2]) continue;
      return {
        winner: comparison.values[1] < comparison.values[2] ? 1 : 2,
        reason: comparison.key === 'segments4' ? 'anti_score' : 'anti_tiebreak',
        tiebreak: {
          criterion: comparison.key,
          label: comparison.label,
          scores: comparison.values,
        },
      };
    }

    const loser = Number(state.antiLastScorer || lastPlayer) === 1 ? 1 : 2;
    return {
      winner: loser === 1 ? 2 : 1,
      reason: 'anti_last_alignment',
      tiebreak: {
        criterion: 'last_alignment',
        label: 'dernier alignement créé',
        loser,
      },
    };
  }

  _missionComplete(board, player, missionId) {
    const grid = board.grid;
    if (missionId === 'square') for (let r = 0; r < board.rows - 1; r++) for (let c = 0; c < board.cols - 1; c++) if ([[r,c],[r+1,c],[r,c+1],[r+1,c+1]].every(([rr,cc]) => grid[rr][cc] === player)) return [[r,c],[r+1,c],[r,c+1],[r+1,c+1]];
    if (missionId === 'double3') { const parts = board.getSegments(player, 3); if (parts.length >= 2) return [...parts[0].cells, ...parts[1].cells]; }
    if (missionId === 'center') { const midR = Math.floor(board.rows / 2), midC = Math.floor(board.cols / 2); const cells=[]; for(let r=midR-1;r<=midR+1;r++)for(let c=midC-1;c<=midC+1;c++)if(grid[r]?.[c]===player)cells.push([r,c]); if(cells.length>=4)return cells; }
    if (missionId === 'high4') { const segment = board.getSegments(player).find(item => item.cells.every(([r]) => r !== board.rows - 1)); if (segment) return segment.cells; }
    if (missionId === 'directions') { const dirs = new Set(); for(let r=0;r<board.rows;r++)for(let c=0;c<board.cols;c++)for(const [dr,dc,name] of [[0,1,'h'],[1,0,'v'],[1,1,'d'],[1,-1,'d']])if(grid[r][c]===player&&grid[r+dr]?.[c+dc]===player)dirs.add(name); if(dirs.size===3)return []; }
    return null;
  }

  _recordAction(state, side, actionType, payload) {
    if (!state.persisted) return;
    aQ.insert.run({
      game_id: state.id,
      player_id: side ? state.players[side].id : null,
      action_number: state.moveCount,
      action_type: actionType,
      payload: JSON.stringify(payload || {}),
    });
  }

  resign(socketId) {
    const gameId = this.socketToGame.get(socketId);
    if (!gameId) return { error: 'Aucune partie en cours.' };
    const state = this.games.get(gameId);
    if (!state || state.status !== 'active') return { error: 'Partie inactive.' };
    const side = this._side(state, socketId);
    if (!side) return { error: 'Joueur introuvable dans cette partie.' };
    const winnerSide = side === 1 ? 2 : 1;
    return this._end(state, winnerSide, [], 'resign');
  }

  agreedDraw(socketId) {
    const gameId = this.socketToGame.get(socketId);
    if (!gameId) return { error: 'Aucune partie en cours.' };
    const state = this.games.get(gameId);
    if (!state || state.status !== 'active') return { error: 'Partie inactive.' };
    const side = this._side(state, socketId);
    if (!side) return { error: 'Joueur introuvable dans cette partie.' };
    return this._end(state, null, [], 'agreement_draw');
  }

  disconnect(socketId) {
    const gameId = this.socketToGame.get(socketId);
    if (!gameId) return null;
    const state = this.games.get(gameId);
    if (!state || state.status !== 'active') return null;

    const disconnected = this._side(state, socketId);
    if (!disconnected) return null;
    const winner = disconnected === 1 ? 2 : 1;
    return this._end(state, winner, [], 'disconnect');
  }

  getBySocket(socketId) {
    const id = this.socketToGame.get(socketId);
    return id ? this.games.get(id) : null;
  }

  _side(state, socketId) {
    if (state.players[1].socketId === socketId) return 1;
    if (state.players[2].socketId === socketId) return 2;
    return null;
  }

  _end(state, winnerSide, winCells, reason, lastMove = null, extra = {}) {
    state.status = 'finished';
    const duration = Math.round((Date.now() - state.startedAt) / 1000);
    const isDraw = reason === 'draw' || reason === 'agreement_draw' || reason === 'position_draw' || reason === 'conquest_draw' || reason === 'tetris_draw';

    const winnerId = winnerSide ? state.players[winnerSide].id : state.players[1].id;
    const loserId = winnerSide ? state.players[winnerSide === 1 ? 2 : 1].id : state.players[2].id;

    const p1id = state.players[1].id;
    const p2id = state.players[2].id;
    const sameIp = state.persisted && state.players[1].sameIpOpponent === true;
    const isSuspect = sameIp;
    if (sameIp) {
      abQ.setSuspicious.run({ val: 1, id: p1id });
      abQ.setSuspicious.run({ val: 1, id: p2id });
      console.log(`[SAME-IP] ELO annule pour partie ${state.id}`);
    }

    const p1IsWinner = winnerSide === 1;
    const p2IsWinner = winnerSide === 2;
    const elo = state.persisted
      ? finishGame(state.id, winnerId, loserId, state.moveCount, duration, isDraw, isSuspect, reason, state.variant, {
          board: state.board.grid,
          antiScores: state.antiScores,
          bombs: state.bombs,
          missions: state.missions,
          conquestScores: state.conquestScores,
          ...extra,
        })
      : {
          dW: 0,
          dL: 0,
          vipApplied: false,
          vipAppliedTo: null,
          globalMultiplier: 1,
          vipMultiplier: 1,
          vipTier: null,
          coins: {
            [state.players[1].id]: 0,
            [state.players[2].id]: 0,
          },
          player1CoinsNow: Number(state.players[1].coins || 0),
          player2CoinsNow: Number(state.players[2].coins || 0),
          player1EloNow: Number(state.players[1].elo || 0),
          player2EloNow: Number(state.players[2].elo || 0),
          winnerEloNow: Number((winnerSide ? state.players[winnerSide] : state.players[1])?.elo || 0),
          loserEloNow: Number((winnerSide ? state.players[winnerSide === 1 ? 2 : 1] : state.players[2])?.elo || 0),
        };

    // finishGame returns deltas by board side, not generic winner/loser deltas.
    const p1Delta = isSuspect ? 0 : Number(elo.player1Delta ?? elo.dW ?? 0);
    const p2Delta = isSuspect ? 0 : Number(elo.player2Delta ?? elo.dL ?? 0);

    try {
      if (!state.persisted) throw new Error('transient-game');
      const p1 = state.players[1];
      const p2 = state.players[2];
      const winner = isDraw ? null : (winnerSide === 1 ? p1 : p2);
      const loser = isDraw ? null : (winnerSide === 1 ? p2 : p1);
      const BASE = (process.env.BASE_URL || process.env.PUBLIC_BASE_URL || `http://127.0.0.1:${process.env.PORT || 3000}`).replace(/\/+$/, '');
      wlogGame({
        gameId: state.id,
        isDraw,
        isSuspect,
        reason,
        variant: state.variant,
        p1: { id: p1.id, pseudo: p1.pseudo, elo: p1.elo, delta: p1Delta, color: p1.color },
        p2: { id: p2.id, pseudo: p2.pseudo, elo: p2.elo, delta: p2Delta, color: p2.color },
        winner: winner?.pseudo,
        loser: loser?.pseudo,
        moves: state.moveCount,
        duration,
        board: state.board.grid.map(row => [...row]),
        winCells: Array.isArray(winCells) ? winCells : [],
        replayUrl: `${BASE}/replay/${state.id}`,
      });
    } catch (e) {}

    state.finishedAt = Date.now();
    state.winCells = Array.isArray(winCells) ? winCells : [];
    state.result = {
      winner: winnerSide,
      reason,
      eloChanges: {
        [state.players[1].id]: p1Delta,
        [state.players[2].id]: p2Delta,
      },
      boostInfo: {
        vipApplied: !!elo.vipApplied,
        vipAppliedTo: elo.vipAppliedTo ?? null,
        globalMultiplier: elo.globalMultiplier ?? 1,
        vipMultiplier: elo.vipMultiplier ?? 1,
        vipTier: elo.vipTier ?? null,
      },
      coinChanges: elo.coins || {},
    };

    this.socketToGame.delete(state.players[1].socketId);
    this.socketToGame.delete(state.players[2].socketId);
    setTimeout(() => { this.games.delete(state.id); }, 6000);

    const payload = {
      type: 'game_over',
      gameId: state.id,
      gameType: String(state.gameType || 'ranked'),
      variant: state.variant,
      reason,
      duration,
      winner: winnerSide,
      winCells,
      lastMove,
      allowReplay: !!state.persisted && Number(state.id) > 0,
      eloChanges: {
        [state.players[1].id]: p1Delta,
        [state.players[2].id]: p2Delta,
      },
      boostInfo: {
        vipApplied: !!elo.vipApplied,
        vipAppliedTo: elo.vipAppliedTo ?? null,
        globalMultiplier: elo.globalMultiplier ?? 1,
        vipMultiplier: elo.vipMultiplier ?? 1,
        vipTier: elo.vipTier ?? null,
      },
      coinChanges: elo.coins || {},
      coinsNow: {
        [state.players[1].id]: elo.player1CoinsNow,
        [state.players[2].id]: elo.player2CoinsNow,
      },
      isSuspect,
      eloNow: {
        [state.players[1].id]: elo.player1EloNow,
        [state.players[2].id]: elo.player2EloNow,
      },
      players: {
        1: { id: state.players[1].id, pseudo: state.players[1].pseudo, color: state.players[1].color },
        2: { id: state.players[2].id, pseudo: state.players[2].pseudo, color: state.players[2].color },
      },
      board: state.board.grid,
      antiScores: state.antiScores,
      bombs: state.bombs,
      missions: state.missions,
      conquestScores: state.conquestScores,
      ...extra,
    };

    if (state.persisted && typeof this._onGameFinished === 'function') {
      try {
        this._onGameFinished({
          gameId: state.id,
          player1Id: state.players[1].id,
          player2Id: state.players[2].id,
          winnerId: isDraw ? null : winnerId,
          loserId: isDraw ? null : loserId,
          isDraw,
          reason,
          payload,
        });
      } catch (e) {
        console.error('[TOURNOI] callback game finished:', e.message);
      }
    }

    return payload;
  }
}

module.exports = { GameManager };

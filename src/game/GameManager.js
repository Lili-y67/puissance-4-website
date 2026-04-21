/**
 * GameManager.js - Active games + move recording with think_ms
 */
const { Board } = require('./Board');
const { gQ, mQ, finishGame, abQ } = require('../db/db');
const { wlogGame } = require('../webhooks');

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
        const moveTimerLimit = Number(state.turnTimeLimitMs || 0);
        const limit = moveTimerLimit > 0 ? moveTimerLimit : AFK_LIMIT;
        if (now - state.lastMoveAt > limit) {
          const afkSide = state.current;
          const winnerSide = afkSide === 1 ? 2 : 1;
          console.log(`[AFK] Partie ${gameId} - J${afkSide} AFK, J${winnerSide} gagne`);
          const result = this._end(state, winnerSide, [], 'afk');
          if (this._onAfkEnd) this._onAfkEnd(result);
        }
      }
    }, 1000);
  }

  create(p1, p2, options = {}) {
    const moveTimeSeconds = Number(options.moveTimeSeconds || 0) > 0
      ? Number(options.moveTimeSeconds)
      : 60;
    const persisted = options.persist !== false;

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
        }).lastInsertRowid
      : this.nextTransientGameId--;

    const state = {
      id: gameId,
      board: new Board(),
      players: { 1: p1, 2: p2 },
      current: 1,
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
    };

    this.games.set(gameId, state);
    this.socketToGame.set(p1.socketId, gameId);
    this.socketToGame.set(p2.socketId, gameId);
    return state;
  }

  playMove(socketId, col) {
    const gameId = this.socketToGame.get(socketId);
    if (!gameId) return { error: 'Aucune partie en cours.' };

    const state = this.games.get(gameId);
    if (!state || state.status !== 'active') return { error: 'Partie inactive.' };

    const playerNum = this._side(state, socketId);
    if (playerNum !== state.current) return { error: 'Pas ton tour.' };
    if (!state.board.isValidCol(col)) return { error: 'Colonne invalide.' };

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
    const winCells = state.board.checkWin(row, col, playerNum);
    if (winCells) return this._end(state, playerNum, winCells, 'win', lastMove);
    if (state.board.isDraw()) return this._end(state, null, [], 'draw', lastMove);

    state.current = state.current === 1 ? 2 : 1;
    return {
      type: 'move',
      gameId,
      row,
      col,
      player: playerNum,
      next: state.current,
    };
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

  _end(state, winnerSide, winCells, reason, lastMove = null) {
    state.status = 'finished';
    const duration = Math.round((Date.now() - state.startedAt) / 1000);
    const isDraw = reason === 'draw';

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
      ? finishGame(state.id, winnerId, loserId, state.moveCount, duration, isDraw, isSuspect)
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
      const BASE = 'https://puissance-4-website-ranked-production.up.railway.app';
      wlogGame({
        gameId: state.id,
        isDraw,
        isSuspect,
        reason,
        p1: { pseudo: p1.pseudo, elo: p1.elo, delta: p1Delta },
        p2: { pseudo: p2.pseudo, elo: p2.elo, delta: p2Delta },
        winner: winner?.pseudo,
        loser: loser?.pseudo,
        moves: state.moveCount,
        duration,
        replayUrl: `${BASE}/replay/${state.id}`,
      });
    } catch (e) {}

    state.finishedAt = Date.now();
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

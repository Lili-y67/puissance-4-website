/**
 * GameManager.js — Active games + move recording with think_ms
 */
const { Board }              = require('./Board');
const { gQ, mQ, finishGame, abQ, pQ } = require('../db/db');
const { wlogGame } = require('../webhooks');

class GameManager {
  constructor() {
    this.games        = new Map(); // gameId → state
    this.socketToGame = new Map(); // socketId → gameId

    // ── Timer AFK : vérifier toutes les 30s ──────────────────────────────────
    this._afkInterval = setInterval(() => {
      const AFK_LIMIT = 3 * 60 * 1000; // 3 minutes
      const now = Date.now();
      for (const [gameId, state] of this.games) {
        if (state.status !== 'active') continue;
        const moveTimerLimit = Number(state.turnTimeLimitMs || 0);
        const limit = moveTimerLimit > 0 ? moveTimerLimit : AFK_LIMIT;
        if (now - state.lastMoveAt > limit) {
          // Le joueur dont c'est le tour est AFK → l'autre gagne
          const afkSide    = state.current;
          const winnerSide = afkSide === 1 ? 2 : 1;
          console.log(`[AFK] Partie ${gameId} — J${afkSide} AFK, J${winnerSide} gagne`);
          const result = this._end(state, winnerSide, [], 'afk');
          // Émettre via le callback (injecté depuis server.js)
          if (this._onAfkEnd) this._onAfkEnd(result);
        }
      }
    }, 1_000);
  }

  create(p1, p2, options = {}) {
    const gameId = gQ.create.run({
      p1: p1.id, p2: p2.id,
      p1_color: p1.color || '#ff2d55',
      p2_color: p2.color || '#ffd60a',
      p1_shape: p1.shape || 'circle',
      p2_shape: p2.shape || 'circle',
      tournament_id: options.tournamentId || null,
      tournament_move_time_seconds: Number(options.moveTimeSeconds || 0) || 0,
    }).lastInsertRowid;

    const state = {
      id:         gameId,
      board:      new Board(),
      players:    { 1: p1, 2: p2 },
      current:    1,
      startedAt:  Date.now(),
      lastMoveAt: Date.now(),
      moveCount:  0,
      status:     'active',
      tournamentId: options.tournamentId || null,
      tournamentName: options.tournamentName || '',
      turnTimeLimitMs: Number(options.moveTimeSeconds || 0) > 0 ? Number(options.moveTimeSeconds) * 1000 : 0,
      moveTimeSeconds: Number(options.moveTimeSeconds || 0) || 0,
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
    if (!state.board.isValidCol(col))  return { error: 'Colonne invalide.' };

    const now     = Date.now();
    const thinkMs = now - state.lastMoveAt;
    const row     = state.board.drop(col, playerNum);
    if (row === null) return { error: 'Coup impossible.' };

    state.moveCount++;
    state.lastMoveAt = now;

    mQ.insert.run({
      game_id:     gameId,
      player_id:   state.players[playerNum].id,
      col,
      row,
      move_number: state.moveCount,
      think_ms:    thinkMs,
    });

    const winCells = state.board.checkWin(row, col, playerNum);
    if (winCells)             return this._end(state, playerNum, winCells, 'win');
    if (state.board.isDraw()) return this._end(state, null,       [],       'draw');

    state.current = state.current === 1 ? 2 : 1;

    return {
      type:   'move',
      gameId,
      row,
      col,
      player: playerNum,
      next:   state.current,
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

  _end(state, winnerSide, winCells, reason) {
    state.status   = 'finished';
    const duration = Math.round((Date.now() - state.startedAt) / 1000);
    const isDraw   = reason === 'draw';

    const winnerId = winnerSide
      ? state.players[winnerSide].id
      : state.players[1].id;
    const loserId = winnerSide
      ? state.players[winnerSide === 1 ? 2 : 1].id
      : state.players[2].id;

    // ── Anti-boost : détecter le pattern "toujours le même qui gagne" ──────────
    const p1id = state.players[1].id;
    const p2id = state.players[2].id;
    const TWO_HOURS = 2 * 60 * 60 * 1000;
    const since = Date.now() - TWO_HOURS;
    const recentCount = abQ.recentBetween.get(p1id, p2id, p2id, p1id, since)?.cnt || 0;

    // Même IP détectée par le serveur → ELO annulé direct
    const sameIp = state.players[1].sameIpOpponent === true;
    const isSuspect = sameIp;
    if (sameIp) {
      abQ.setSuspicious.run({ val: 1, id: p1id });
      abQ.setSuspicious.run({ val: 1, id: p2id });
      console.log(`[SAME-IP] ELO annulé pour partie ${state.id}`);
    }


    // Calculer les deltas AVANT finishGame pour les avoir par joueur
    const p1IsWinner = winnerSide === 1;
    const p2IsWinner = winnerSide === 2;
    // winnerId = gagnant, loserId = perdant (ou p1/p2 pour draw)
    const elo = finishGame(state.id, winnerId, loserId, state.moveCount, duration, isDraw, isSuspect);

    // Delta ELO par joueur (pas winner/loser générique)
    // Si boost détecté : ELO = 0 pour cette partie
    const p1Delta = isSuspect ? 0 : (isDraw ? elo.dW : (p1IsWinner ? elo.dW : elo.dL));
    const p2Delta = isSuspect ? 0 : (isDraw ? elo.dL : (p2IsWinner ? elo.dW : elo.dL));

    // Webhook log partie
    try {
      const p1 = state.players[1]; const p2 = state.players[2];
      const winner = isDraw ? null : (winnerSide === 1 ? p1 : p2);
      const loser  = isDraw ? null : (winnerSide === 1 ? p2 : p1);
      const BASE   = 'https://puissance-4-website-ranked-production.up.railway.app';
      wlogGame({
        gameId: state.id, isDraw, isSuspect, reason,
        p1: { pseudo: p1.pseudo, elo: p1.elo, delta: p1Delta },
        p2: { pseudo: p2.pseudo, elo: p2.elo, delta: p2Delta },
        winner: winner?.pseudo, loser: loser?.pseudo,
        moves: state.moveCount, duration,
        replayUrl: `${BASE}/replay/${state.id}`,
      });
    } catch(e) {}

    // Stocker le résultat dans le state pour /api/live (affiché 5s)
    state.finishedAt = Date.now();
    state.result = {
      winner:     winnerSide,
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

    // Cleanup sockets immédiatement
    this.socketToGame.delete(state.players[1].socketId);
    this.socketToGame.delete(state.players[2].socketId);
    // Retirer du Map après 6s (5s d'affichage + marge)
    setTimeout(() => { this.games.delete(state.id); }, 6000);

    const payload = {
      type:   'game_over',
      gameId: state.id,
      reason,
      duration,
      winner: winnerSide,
      winCells,
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

    if (typeof this._onGameFinished === 'function') {
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

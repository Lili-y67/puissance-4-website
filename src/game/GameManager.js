/**
 * GameManager.js — Active games + move recording with think_ms
 */
const { Board }              = require('./Board');
const { gQ, mQ, finishGame } = require('../db/db');

class GameManager {
  constructor() {
    this.games        = new Map(); // gameId → state
    this.socketToGame = new Map(); // socketId → gameId
  }

  create(p1, p2) {
    const gameId = gQ.create.run({ p1: p1.id, p2: p2.id }).lastInsertRowid;

    const state = {
      id:         gameId,
      board:      new Board(),
      players:    { 1: p1, 2: p2 },
      current:    1,
      startedAt:  Date.now(),
      lastMoveAt: Date.now(),
      moveCount:  0,
      status:     'active',
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

    // Calculer les deltas AVANT finishGame pour les avoir par joueur
    const p1IsWinner = winnerSide === 1;
    const p2IsWinner = winnerSide === 2;
    // winnerId = gagnant, loserId = perdant (ou p1/p2 pour draw)
    const elo = finishGame(state.id, winnerId, loserId, state.moveCount, duration, isDraw);

    // Delta ELO par joueur (pas winner/loser générique)
    const p1Delta = isDraw
      ? (state.players[1].id === winnerId ? elo.dW : elo.dL)
      : (p1IsWinner ? elo.dW : elo.dL);
    const p2Delta = isDraw
      ? (state.players[2].id === winnerId ? elo.dW : elo.dL)
      : (p2IsWinner ? elo.dW : elo.dL);

    // Stocker le résultat dans le state pour /api/live (affiché 5s)
    state.finishedAt = Date.now();
    state.result = {
      winner:     winnerSide,
      reason,
      eloChanges: {
        [state.players[1].id]: p1Delta,
        [state.players[2].id]: p2Delta,
      },
    };

    // Cleanup sockets immédiatement
    this.socketToGame.delete(state.players[1].socketId);
    this.socketToGame.delete(state.players[2].socketId);
    // Retirer du Map après 6s (5s d'affichage + marge)
    setTimeout(() => { this.games.delete(state.id); }, 6000);

    return {
      type:   'game_over',
      gameId: state.id,
      reason,
      winner: winnerSide,
      winCells,
      eloChanges: {
        [state.players[1].id]: p1Delta,
        [state.players[2].id]: p2Delta,
      },
      eloNow: {
        [state.players[1].id]: p1IsWinner ? elo.winnerEloNow : elo.loserEloNow,
        [state.players[2].id]: p2IsWinner ? elo.winnerEloNow : elo.loserEloNow,
      },
      players: {
        1: { id: state.players[1].id, pseudo: state.players[1].pseudo, color: state.players[1].color },
        2: { id: state.players[2].id, pseudo: state.players[2].pseudo, color: state.players[2].color },
      },
    };
  }
}

module.exports = { GameManager };

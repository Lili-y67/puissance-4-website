#!/usr/bin/env node
/*
 * Puissance 4 Ranked - Bot API client example
 *
 * Usage:
 *   P4_BOT_TOKEN=p4bot_xxx node p4-bot-client.js
 *
 * Optional:
 *   P4_API_URL=https://puissance-4-website-production.up.railway.app P4_BOT_TOKEN=p4bot_xxx node p4-bot-client.js
 *   P4_CHALLENGE_BOT_ID=7 P4_BOT_TOKEN=p4bot_xxx node p4-bot-client.js
 *
 * This example is intentionally simple:
 * - pings the site so the bot appears online
 * - joins the bot queue
 * - polls the current game
 * - plays legal moves with a small tactical AI
 */

const API_URL = (process.env.P4_API_URL || 'http://localhost:8080').replace(/\/+$/, '');
const BOT_TOKEN = process.env.P4_BOT_TOKEN || process.env.BOT_TOKEN || '';
const LOOP_MS = Number(process.env.P4_LOOP_MS || 1200);
const CHALLENGE_BOT_ID = Number(process.env.P4_CHALLENGE_BOT_ID || 0);

if (!BOT_TOKEN) {
  console.error('Missing token. Run with: P4_BOT_TOKEN=p4bot_xxx node p4-bot-client.js');
  process.exit(1);
}

const headers = {
  Authorization: `Bearer ${BOT_TOKEN}`,
  'Content-Type': 'application/json',
};

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function api(path, options = {}) {
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: { ...headers, ...(options.headers || {}) },
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  if (!res.ok) {
    const err = new Error(data?.error || `HTTP ${res.status}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

function legalMoves(board) {
  return board[0].map((value, col) => value === 0 ? col : null).filter(col => col !== null);
}

function cloneBoard(board) {
  return board.map(row => [...row]);
}

function drop(board, col, player) {
  for (let row = board.length - 1; row >= 0; row--) {
    if (board[row][col] === 0) {
      board[row][col] = player;
      return row;
    }
  }
  return -1;
}

function checkWin(board, row, col, player) {
  const dirs = [[0, 1], [1, 0], [1, 1], [1, -1]];
  return dirs.some(([dr, dc]) => {
    let count = 1;
    for (const sign of [1, -1]) {
      for (let step = 1; step < 4; step++) {
        const r = row + dr * step * sign;
        const c = col + dc * step * sign;
        if (r < 0 || r >= 6 || c < 0 || c >= 7 || board[r][c] !== player) break;
        count++;
      }
    }
    return count >= 4;
  });
}

function isWinningMove(board, col, player) {
  const copy = cloneBoard(board);
  const row = drop(copy, col, player);
  return row >= 0 && checkWin(copy, row, col, player);
}

function scoreWindow(values, me) {
  const opp = me === 1 ? 2 : 1;
  const mine = values.filter(v => v === me).length;
  const theirs = values.filter(v => v === opp).length;
  const empty = values.filter(v => v === 0).length;
  if (mine === 4) return 100000;
  if (theirs === 4) return -100000;
  if (mine === 3 && empty === 1) return 80;
  if (mine === 2 && empty === 2) return 18;
  if (theirs === 3 && empty === 1) return -95;
  if (theirs === 2 && empty === 2) return -16;
  return 0;
}

function evaluate(board, me) {
  let score = 0;
  const center = board.map(row => row[3]).filter(v => v === me).length;
  score += center * 7;

  for (let r = 0; r < 6; r++) {
    for (let c = 0; c < 4; c++) score += scoreWindow([board[r][c], board[r][c + 1], board[r][c + 2], board[r][c + 3]], me);
  }
  for (let c = 0; c < 7; c++) {
    for (let r = 0; r < 3; r++) score += scoreWindow([board[r][c], board[r + 1][c], board[r + 2][c], board[r + 3][c]], me);
  }
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 4; c++) score += scoreWindow([board[r][c], board[r + 1][c + 1], board[r + 2][c + 2], board[r + 3][c + 3]], me);
  }
  for (let r = 3; r < 6; r++) {
    for (let c = 0; c < 4; c++) score += scoreWindow([board[r][c], board[r - 1][c + 1], board[r - 2][c + 2], board[r - 3][c + 3]], me);
  }
  return score;
}

function chooseMove(game) {
  const board = game.board;
  const me = Number(game.side);
  const opp = me === 1 ? 2 : 1;
  const moves = game.legalMoves?.length ? game.legalMoves : legalMoves(board);
  if (!moves.length) return null;

  for (const col of moves) {
    if (isWinningMove(board, col, me)) return col;
  }
  for (const col of moves) {
    if (isWinningMove(board, col, opp)) return col;
  }

  const centerOrder = [3, 2, 4, 1, 5, 0, 6].filter(col => moves.includes(col));
  let best = centerOrder[0] ?? moves[0];
  let bestScore = -Infinity;
  for (const col of centerOrder) {
    const copy = cloneBoard(board);
    drop(copy, col, me);
    const score = evaluate(copy, me) + (Math.random() * 4);
    if (score > bestScore) {
      bestScore = score;
      best = col;
    }
  }
  return best;
}

async function main() {
  const me = await api('/api/bot/me');
  console.log(`[P4 Bot] Connected as ${me.bot.pseudo} (${me.bot.elo} ELO) on ${API_URL}`);

  if (CHALLENGE_BOT_ID > 0) {
    try {
      const challenge = await api(`/api/bot/challenge/${CHALLENGE_BOT_ID}`, { method: 'POST' });
      console.log(`[P4 Bot] Challenged bot #${CHALLENGE_BOT_ID}, game ${challenge.game?.gameId || '?'}`);
    } catch (error) {
      console.error(`[P4 Bot] Challenge failed: ${error.message}`);
    }
  }

  let lastGameId = null;
  while (true) {
    try {
      await api('/api/bot/ping', {
        method: 'POST',
        body: JSON.stringify({ status: lastGameId ? 'playing' : 'seeking' }),
      });

      let game = (await api('/api/bot/game')).game;
      if (!game) {
        const queue = await api('/api/bot/queue/join', {
          method: 'POST',
          body: JSON.stringify({ allowBuiltin: true }),
        });
        game = queue.game || null;
        if (!game) {
          console.log(`[P4 Bot] Queue: ${queue.status}${queue.position ? ` #${queue.position}` : ''}`);
          await sleep(LOOP_MS);
          continue;
        }
      }

      if (game.gameId !== lastGameId) {
        lastGameId = game.gameId;
        console.log(`[P4 Bot] Game ${game.gameId} started as side ${game.side}: ${game.players[1].pseudo} vs ${game.players[2].pseudo}`);
      }

      if (!game.isMyTurn) {
        await sleep(LOOP_MS);
        continue;
      }

      const col = chooseMove(game);
      if (col === null) {
        await sleep(LOOP_MS);
        continue;
      }

      const result = await api('/api/bot/move', {
        method: 'POST',
        body: JSON.stringify({ col }),
      });
      console.log(`[P4 Bot] Played col.${col + 1}`, result.result?.type === 'game_over' ? '- game over' : '');
      if (result.result?.type === 'game_over') lastGameId = null;
    } catch (error) {
      if (error.status === 404) lastGameId = null;
      console.error('[P4 Bot]', error.message);
      await sleep(Math.max(LOOP_MS, 2500));
    }
  }
}

main().catch(error => {
  console.error('[P4 Bot] Fatal:', error);
  process.exit(1);
});

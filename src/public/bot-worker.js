'use strict';

const ROWS = 6;
const COLS = 7;
const ORDER = [3, 2, 4, 1, 5, 0, 6];
let deadline = 0;
let nodes = 0;

function validColumns(board) {
  return ORDER.filter(col => board[0][col] === 0);
}

function play(board, col, player) {
  for (let row = ROWS - 1; row >= 0; row--) {
    if (board[row][col] === 0) {
      board[row][col] = player;
      return row;
    }
  }
  return -1;
}

function won(board, player) {
  for (let row = 0; row < ROWS; row++) for (let col = 0; col <= COLS - 4; col++)
    if (board[row][col] === player && board[row][col + 1] === player && board[row][col + 2] === player && board[row][col + 3] === player) return true;
  for (let col = 0; col < COLS; col++) for (let row = 0; row <= ROWS - 4; row++)
    if (board[row][col] === player && board[row + 1][col] === player && board[row + 2][col] === player && board[row + 3][col] === player) return true;
  for (let row = 3; row < ROWS; row++) for (let col = 0; col <= COLS - 4; col++)
    if (board[row][col] === player && board[row - 1][col + 1] === player && board[row - 2][col + 2] === player && board[row - 3][col + 3] === player) return true;
  for (let row = 0; row <= ROWS - 4; row++) for (let col = 0; col <= COLS - 4; col++)
    if (board[row][col] === player && board[row + 1][col + 1] === player && board[row + 2][col + 2] === player && board[row + 3][col + 3] === player) return true;
  return false;
}

function scoreWindow(window, player) {
  const opponent = player === 1 ? 2 : 1;
  let mine = 0, theirs = 0, empty = 0;
  for (const cell of window) {
    if (cell === player) mine++;
    else if (cell === opponent) theirs++;
    else empty++;
  }
  if (mine === 4) return 1000;
  if (theirs === 4) return -1000;
  if (mine === 3 && empty === 1) return 50;
  if (theirs === 3 && empty === 1) return -50;
  if (mine === 2 && empty === 2) return 5;
  return 0;
}

function evaluate(board) {
  let score = 0;
  for (let row = 0; row < ROWS; row++) {
    if (board[row][3] === 2) score += 8;
    if (board[row][3] === 1) score -= 8;
  }
  for (let row = 0; row < ROWS; row++) for (let col = 0; col <= COLS - 4; col++) score += scoreWindow([board[row][col], board[row][col + 1], board[row][col + 2], board[row][col + 3]], 2);
  for (let col = 0; col < COLS; col++) for (let row = 0; row <= ROWS - 4; row++) score += scoreWindow([board[row][col], board[row + 1][col], board[row + 2][col], board[row + 3][col]], 2);
  for (let row = 3; row < ROWS; row++) for (let col = 0; col <= COLS - 4; col++) score += scoreWindow([board[row][col], board[row - 1][col + 1], board[row - 2][col + 2], board[row - 3][col + 3]], 2);
  for (let row = 0; row <= ROWS - 4; row++) for (let col = 0; col <= COLS - 4; col++) score += scoreWindow([board[row][col], board[row + 1][col + 1], board[row + 2][col + 2], board[row + 3][col + 3]], 2);
  return score;
}

function minimax(board, depth, alpha, beta, maximizing) {
  nodes++;
  if ((nodes & 1023) === 0 && performance.now() >= deadline) throw new Error('timeout');
  if (won(board, 2)) return 100000 + depth;
  if (won(board, 1)) return -100000 - depth;
  const columns = validColumns(board);
  if (!columns.length || depth === 0) return evaluate(board);

  let best = maximizing ? -Infinity : Infinity;
  const player = maximizing ? 2 : 1;
  for (const col of columns) {
    const row = play(board, col, player);
    const value = minimax(board, depth - 1, alpha, beta, !maximizing);
    board[row][col] = 0;
    if (maximizing) {
      best = Math.max(best, value);
      alpha = Math.max(alpha, best);
    } else {
      best = Math.min(best, value);
      beta = Math.min(beta, best);
    }
    if (beta <= alpha) break;
  }
  return best;
}

function choose(board, targetDepth, budgetMs) {
  const columns = validColumns(board);
  if (!columns.length) return 0;
  for (const col of columns) {
    const row = play(board, col, 2);
    const isWin = won(board, 2);
    board[row][col] = 0;
    if (isWin) return col;
  }
  for (const col of columns) {
    const row = play(board, col, 1);
    const mustBlock = won(board, 1);
    board[row][col] = 0;
    if (mustBlock) return col;
  }

  deadline = performance.now() + budgetMs;
  let completedBest = columns[0];
  for (let depth = 3; depth <= targetDepth; depth += 2) {
    let depthBest = completedBest;
    let depthScore = -Infinity;
    nodes = 0;
    try {
      for (const col of columns) {
        const row = play(board, col, 2);
        const score = minimax(board, depth - 1, -Infinity, Infinity, false);
        board[row][col] = 0;
        if (score > depthScore) {
          depthScore = score;
          depthBest = col;
        }
      }
      completedBest = depthBest;
    } catch (_) {
      break;
    }
  }
  return completedBest;
}

self.onmessage = event => {
  const { id, board, depth = 7, budgetMs = 1100 } = event.data || {};
  try {
    const col = choose(board.map(row => row.slice()), depth, budgetMs);
    self.postMessage({ id, col });
  } catch (error) {
    self.postMessage({ id, error: error?.message || 'bot-error' });
  }
};

'use strict';

const { parentPort, workerData } = require('worker_threads');

const grid = Array.isArray(workerData?.grid) ? workerData.grid.map(row => row.slice()) : [];
const player = Number(workerData?.player || 1);
const opponent = player === 1 ? 2 : 1;
const depthTarget = Math.max(1, Number(workerData?.depth || 7));
const deadline = Date.now() + Math.max(100, Number(workerData?.budgetMs || 2000));
const rows = grid.length;
const cols = Math.max(0, ...grid.map(row => row.length));
const center = Math.floor(cols / 2);
const orderedCols = Array.from({ length: cols }, (_, col) => col)
  .sort((a, b) => Math.abs(a - center) - Math.abs(b - center));
const transposition = new Map();

function validCols(board) { return orderedCols.filter(col => board[0]?.[col] === 0); }
function drop(board, col, side) {
  for (let row = rows - 1; row >= 0; row--) if (board[row]?.[col] === 0) { board[row][col] = side; return row; }
  return -1;
}
function undo(board, row, col) { if (row >= 0) board[row][col] = 0; }
function wins(board, row, col, side) {
  for (const [dr, dc] of [[0,1],[1,0],[1,1],[1,-1]]) {
    let count = 1;
    for (const sign of [1, -1]) for (let step = 1; step < 4; step++) {
      const r = row + dr * step * sign, c = col + dc * step * sign;
      if (r < 0 || r >= rows || c < 0 || c >= cols || board[r][c] !== side) break;
      count++;
    }
    if (count >= 4) return true;
  }
  return false;
}
function windowScore(values, side) {
  const foe = side === 1 ? 2 : 1;
  const mine = values.filter(v => v === side).length;
  const theirs = values.filter(v => v === foe).length;
  const empty = values.filter(v => v === 0).length;
  if (mine === 4) return 100000;
  if (theirs === 4) return -120000;
  if (mine === 3 && empty === 1) return 920;
  if (mine === 2 && empty === 2) return 85;
  if (mine === 1 && empty === 3) return 8;
  if (theirs === 3 && empty === 1) return -1120;
  if (theirs === 2 && empty === 2) return -105;
  if (theirs === 1 && empty === 3) return -10;
  return 0;
}
function evaluate(board, side) {
  const foe = side === 1 ? 2 : 1;
  let score = board.reduce((sum, row) => sum + (row[center] === side ? 34 : row[center] === foe ? -34 : 0), 0);
  for (let r = 0; r < rows; r++) for (let c = 0; c <= cols - 4; c++) score += windowScore([board[r][c],board[r][c+1],board[r][c+2],board[r][c+3]], side);
  for (let c = 0; c < cols; c++) for (let r = 0; r <= rows - 4; r++) score += windowScore([board[r][c],board[r+1][c],board[r+2][c],board[r+3][c]], side);
  for (let r = 0; r <= rows - 4; r++) for (let c = 0; c <= cols - 4; c++) score += windowScore([board[r][c],board[r+1][c+1],board[r+2][c+2],board[r+3][c+3]], side);
  for (let r = 3; r < rows; r++) for (let c = 0; c <= cols - 4; c++) score += windowScore([board[r][c],board[r-1][c+1],board[r-2][c+2],board[r-3][c+3]], side);
  return score;
}
function negamax(board, depth, turn, alpha, beta, ply) {
  if (Date.now() >= deadline || depth <= 0) return evaluate(board, turn);
  const choices = validCols(board);
  if (!choices.length) return evaluate(board, turn);
  const key = `${turn}|${depth}|${board.map(row => row.join('')).join('')}`;
  if (transposition.has(key)) return transposition.get(key);
  let best = -Infinity, exact = true;
  for (const col of choices) {
    const row = drop(board, col, turn);
    let score = wins(board, row, col, turn)
      ? 1000000 - ply
      : -negamax(board, depth - 1, turn === 1 ? 2 : 1, -beta, -alpha, ply + 1);
    undo(board, row, col);
    best = Math.max(best, score);
    alpha = Math.max(alpha, score);
    if (alpha >= beta || Date.now() >= deadline) { exact = false; break; }
  }
  if (exact) transposition.set(key, best);
  return best;
}

function search() {
  const choices = validCols(grid);
  if (!choices.length) return { col: null, depthCompleted: 0, score: 0 };
  for (const col of choices) { const row = drop(grid,col,player); const won = wins(grid,row,col,player); undo(grid,row,col); if (won) return { col, depthCompleted: 0, score: 1000000 }; }
  for (const col of choices) { const row = drop(grid,col,opponent); const mustBlock = wins(grid,row,col,opponent); undo(grid,row,col); if (mustBlock) return { col, depthCompleted: 0, score: 900000 }; }
  let bestCol = choices[0], bestScore = -Infinity, depthCompleted = 0;
  for (let depth = 1; depth <= depthTarget && Date.now() < deadline; depth++) {
    let localCol = bestCol, localScore = -Infinity, complete = true;
    for (const col of choices) {
      if (Date.now() >= deadline) { complete = false; break; }
      const row = drop(grid, col, player);
      const score = wins(grid,row,col,player) ? 1000000 + depth : -negamax(grid, depth - 1, opponent, -Infinity, Infinity, 1);
      undo(grid,row,col);
      const tieBreak = -orderedCols.indexOf(col) * 0.01;
      if (score + tieBreak > localScore) { localScore = score + tieBreak; localCol = col; }
    }
    if (!complete) break;
    bestCol = localCol; bestScore = localScore; depthCompleted = depth;
  }
  return { col: bestCol, depthCompleted, score: Number.isFinite(bestScore) ? Math.round(bestScore) : 0 };
}

try { parentPort.postMessage({ ok: true, ...search(), depthTarget }); }
catch (error) { parentPort.postMessage({ ok: false, error: error.message }); }

'use strict';

const { parentPort, workerData } = require('worker_threads');
const { uniqueRotations, positionValid, hardDropY, placePiece, resolveLines } = require('./tetris');

const board = Array.isArray(workerData?.board) ? workerData.board.map(row => row.slice()) : [];
const piece = workerData?.piece || null;
const side = Number(workerData?.side) === 2 ? 2 : 1;
const skill = Math.max(1, Math.min(13, Number(workerData?.skill || 6)));
const deadline = Date.now() + Math.max(100, Number(workerData?.budgetMs || 900));

function boardCost(grid, player, gained) {
  const rows = grid.length;
  const cols = grid[0]?.length || 0;
  let holes = 0;
  let aggregateHeight = 0;
  let bumpiness = 0;
  const heights = [];
  for (let col = 0; col < cols; col++) {
    let seen = false;
    let height = 0;
    for (let row = 0; row < rows; row++) {
      if (grid[row][col]) {
        if (!seen) height = rows - row;
        seen = true;
      } else if (seen) holes++;
    }
    heights.push(height);
    aggregateHeight += height;
  }
  for (let col = 1; col < heights.length; col++) bumpiness += Math.abs(heights[col] - heights[col - 1]);
  const center = (cols - 1) / 2;
  let centerMass = 0;
  for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) {
    if (grid[row][col] === player) centerMass += Math.max(0, 4 - Math.abs(col - center));
  }
  return gained * 12000 + centerMass * 4 - holes * 125 - aggregateHeight * 11 - bumpiness * 9;
}

function search() {
  if (!piece || !board.length) return null;
  const rotations = uniqueRotations(piece.type);
  const candidates = [];
  for (let rotation = 0; rotation < rotations.length && Date.now() < deadline; rotation++) {
    const cells = rotations[rotation];
    const width = Math.max(...cells.map(([, col]) => col)) + 1;
    for (let x = 0; x <= (board[0]?.length || 0) - width; x++) {
      if (!positionValid(board, cells, 0, x)) continue;
      const candidatePiece = { ...piece, player: side, cells, x, y: 0 };
      candidatePiece.y = hardDropY(board, candidatePiece);
      const grid = board.map(row => row.slice());
      placePiece(grid, candidatePiece, side);
      const scores = { 1: 0, 2: 0 };
      const resolved = resolveLines(grid, scores);
      const gained = Number(resolved.scores[side] || 0);
      const score = boardCost(grid, side, gained) + Math.random() * Math.max(1, 14 - skill) * 18;
      candidates.push({ rotation, x, score, gained });
    }
  }
  candidates.sort((left, right) => right.score - left.score);
  const poolSize = skill <= 3 ? Math.min(5, candidates.length) : skill <= 7 ? Math.min(3, candidates.length) : 1;
  return candidates[Math.floor(Math.random() * Math.max(1, poolSize))] || candidates[0] || null;
}

try {
  parentPort.postMessage({ ok: true, action: search() });
} catch (error) {
  parentPort.postMessage({ ok: false, error: error.message });
}

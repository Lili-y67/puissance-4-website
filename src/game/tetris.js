'use strict';

const SHAPES = Object.freeze({
  I: Object.freeze([[0, 0], [0, 1], [0, 2]]),
  O: Object.freeze([[0, 0], [0, 1], [1, 0], [1, 1]]),
  T: Object.freeze([[0, 0], [0, 1], [0, 2], [1, 1]]),
  L: Object.freeze([[0, 0], [1, 0], [2, 0], [2, 1]]),
  J: Object.freeze([[0, 1], [1, 1], [2, 0], [2, 1]]),
  S: Object.freeze([[0, 1], [0, 2], [1, 0], [1, 1]]),
  Z: Object.freeze([[0, 0], [0, 1], [1, 1], [1, 2]]),
});
const SHAPE_NAMES = Object.freeze(Object.keys(SHAPES));

function normalizeCells(cells) {
  const minRow = Math.min(...cells.map(([row]) => row));
  const minCol = Math.min(...cells.map(([, col]) => col));
  return cells
    .map(([row, col]) => [row - minRow, col - minCol])
    .sort((left, right) => left[0] - right[0] || left[1] - right[1]);
}

function rotateCells(cells) {
  return normalizeCells(cells.map(([row, col]) => [col, -row]));
}

function cellsKey(cells) {
  return normalizeCells(cells).map(cell => cell.join(':')).join('|');
}

function uniqueRotations(type) {
  const rotations = [];
  const seen = new Set();
  let cells = SHAPES[type] ? SHAPES[type].map(cell => [...cell]) : SHAPES.T.map(cell => [...cell]);
  for (let index = 0; index < 4; index++) {
    const key = cellsKey(cells);
    if (!seen.has(key)) {
      seen.add(key);
      rotations.push(cells.map(cell => [...cell]));
    }
    cells = rotateCells(cells);
  }
  return rotations;
}

function pieceCells(piece, y = piece?.y, x = piece?.x, cells = piece?.cells) {
  if (!piece || !Array.isArray(cells)) return [];
  return cells.map(([row, col]) => [Number(y) + row, Number(x) + col]);
}

function positionValid(grid, cells, y, x) {
  const rows = grid.length;
  const cols = grid[0]?.length || 0;
  return cells.every(([row, col]) => {
    const targetRow = Number(y) + row;
    const targetCol = Number(x) + col;
    return targetRow >= 0 && targetRow < rows && targetCol >= 0 && targetCol < cols && !grid[targetRow][targetCol];
  });
}

function createPiece(side, cols = 8, random = Math.random) {
  const type = SHAPE_NAMES[Math.floor(random() * SHAPE_NAMES.length)] || 'T';
  const cells = SHAPES[type].map(cell => [...cell]);
  const width = Math.max(...cells.map(([, col]) => col)) + 1;
  return { type, cells, y: 0, x: Math.floor((cols - width) / 2), player: Number(side) === 2 ? 2 : 1 };
}

function hardDropY(grid, piece) {
  let y = Number(piece.y || 0);
  while (positionValid(grid, piece.cells, y + 1, piece.x)) y++;
  return y;
}

function settleNewCells(grid, cells, player) {
  const falls = [];
  const byColumn = new Map();
  for (const [row, col] of cells) {
    if (!byColumn.has(col)) byColumn.set(col, []);
    byColumn.get(col).push(row);
  }
  for (const [col, startRows] of byColumn) {
    startRows.sort((left, right) => right - left);
    for (const fromRow of startRows) {
      let row = fromRow;
      while (row + 1 < grid.length && !grid[row + 1][col]) row++;
      grid[row][col] = player;
      if (row > fromRow) falls.push({ player, fromRow, row, col });
    }
  }
  return falls;
}

function segmentsFor(grid, player, length = 4) {
  const rows = grid.length;
  const cols = grid[0]?.length || 0;
  const segments = [];
  for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) {
    for (const [dr, dc] of [[0, 1], [1, 0], [1, 1], [1, -1]]) {
      const cells = [];
      for (let index = 0; index < length; index++) {
        const r = row + dr * index;
        const c = col + dc * index;
        if (r < 0 || r >= rows || c < 0 || c >= cols || grid[r][c] !== player) {
          cells.length = 0;
          break;
        }
        cells.push([r, c]);
      }
      if (cells.length) segments.push({ key: cells.map(cell => cell.join(':')).join('|'), cells });
    }
  }
  return segments;
}

function applyLineGravity(grid, removedKeys) {
  const falls = [];
  const cols = new Set(removedKeys.map(key => Number(String(key).split(':')[1])));
  for (const col of cols) {
    const pieces = [];
    for (let row = grid.length - 1; row >= 0; row--) {
      if (grid[row][col]) pieces.push({ player: grid[row][col], fromRow: row });
    }
    for (let row = grid.length - 1, index = 0; row >= 0; row--) {
      if (index < pieces.length) {
        const piece = pieces[index++];
        grid[row][col] = piece.player;
        if (row > piece.fromRow) falls.push({ player: piece.player, fromRow: piece.fromRow, row, col });
      } else grid[row][col] = 0;
    }
  }
  return falls;
}

function resolveLines(grid, scores = { 1: 0, 2: 0 }) {
  const captures = [];
  const allFalls = [];
  let lineCount = 0;
  let guard = 0;
  while (guard++ < 12) {
    const lines = [
      ...segmentsFor(grid, 1).map(segment => ({ ...segment, player: 1 })),
      ...segmentsFor(grid, 2).map(segment => ({ ...segment, player: 2 })),
    ];
    if (!lines.length) break;
    const keys = [...new Set(lines.flatMap(line => line.cells.map(cell => cell.join(':'))))];
    for (const side of [1, 2]) scores[side] = Number(scores[side] || 0) + lines.filter(line => line.player === side).length;
    lineCount += lines.length;
    const capture = {
      lines: lines.map(line => ({ player: line.player, cells: line.cells })),
      cells: keys.map(key => key.split(':').map(Number)),
      scores: { 1: scores[1], 2: scores[2] },
    };
    for (const key of keys) {
      const [row, col] = key.split(':').map(Number);
      grid[row][col] = 0;
    }
    const falls = applyLineGravity(grid, keys);
    allFalls.push(...falls);
    capture.falls = falls;
    capture.board = grid.map(row => [...row]);
    captures.push(capture);
  }
  return { captures, falls: allFalls, scores, lineCount };
}

function placePiece(grid, piece, player = piece?.player) {
  const placed = pieceCells(piece);
  const falls = settleNewCells(grid, placed, player);
  return { placed, falls };
}

module.exports = {
  SHAPES,
  SHAPE_NAMES,
  normalizeCells,
  rotateCells,
  uniqueRotations,
  pieceCells,
  positionValid,
  createPiece,
  hardDropY,
  settleNewCells,
  segmentsFor,
  applyLineGravity,
  resolveLines,
  placePiece,
};

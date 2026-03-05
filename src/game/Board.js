/**
 * Board.js — Pure Puissance 4 logic
 */
const ROWS = 6, COLS = 7;

class Board {
  constructor() {
    this.grid = Array.from({ length: ROWS }, () => Array(COLS).fill(0));
    this.moveCount = 0;
  }

  clone() {
    const b = new Board();
    b.grid = this.grid.map(r => [...r]);
    b.moveCount = this.moveCount;
    return b;
  }

  isValidCol(col) {
    return col >= 0 && col < COLS && this.grid[0][col] === 0;
  }

  getLowestEmpty(col) {
    for (let r = ROWS - 1; r >= 0; r--) {
      if (this.grid[r][col] === 0) return r;
    }
    return -1;
  }

  drop(col, player) {
    if (!this.isValidCol(col)) return null;
    const row = this.getLowestEmpty(col);
    if (row === -1) return null;
    this.grid[row][col] = player;
    this.moveCount++;
    return row;
  }

  isDraw() {
    return this.grid[0].every(v => v !== 0);
  }

  checkWin(row, col, player) {
    const dirs = [[0,1],[1,0],[1,1],[1,-1]];
    for (const [dr, dc] of dirs) {
      const line = this._line(row, col, player, dr, dc);
      if (line.length >= 4) return line;
    }
    return null;
  }

  _line(row, col, player, dr, dc) {
    const pos = [], neg = [];
    for (let s = 1; s < 4; s++) {
      const r = row + dr*s, c = col + dc*s;
      if (r>=0&&r<ROWS&&c>=0&&c<COLS&&this.grid[r][c]===player) pos.push([r,c]); else break;
    }
    for (let s = 1; s < 4; s++) {
      const r = row - dr*s, c = col - dc*s;
      if (r>=0&&r<ROWS&&c>=0&&c<COLS&&this.grid[r][c]===player) neg.push([r,c]); else break;
    }
    const all = [...neg.reverse(), [row,col], ...pos];
    return all.length >= 4 ? all.slice(0, 4) : [];
  }

  getValidCols() {
    const cols = [];
    for (let c = 0; c < COLS; c++) if (this.isValidCol(c)) cols.push(c);
    return cols;
  }
}

module.exports = { Board, ROWS, COLS };

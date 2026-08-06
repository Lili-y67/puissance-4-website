/**
 * Board.js — Pure Puissance 4 logic
 */
const ROWS = 6, COLS = 7;

class Board {
  constructor(options = {}) {
    this.rows = Math.max(4, Number(options.rows || ROWS));
    this.cols = Math.max(4, Number(options.cols || COLS));
    this.grid = Array.from({ length: this.rows }, () => Array(this.cols).fill(0));
    this.moveCount = 0;
  }

  clone() {
    const b = new Board({ rows: this.rows, cols: this.cols });
    b.grid = this.grid.map(r => [...r]);
    b.moveCount = this.moveCount;
    return b;
  }

  isValidCol(col) {
    return col >= 0 && col < this.cols && this.grid[0][col] === 0;
  }

  getLowestEmpty(col) {
    for (let r = this.rows - 1; r >= 0; r--) {
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
      if (r>=0&&r<this.rows&&c>=0&&c<this.cols&&this.grid[r][c]===player) pos.push([r,c]); else break;
    }
    for (let s = 1; s < 4; s++) {
      const r = row - dr*s, c = col - dc*s;
      if (r>=0&&r<this.rows&&c>=0&&c<this.cols&&this.grid[r][c]===player) neg.push([r,c]); else break;
    }
    const all = [...neg.reverse(), [row,col], ...pos];
    return all.length >= 4 ? all.slice(0, 4) : [];
  }

  getValidCols() {
    const cols = [];
    for (let c = 0; c < this.cols; c++) if (this.isValidCol(c)) cols.push(c);
    return cols;
  }

  getSegments(player, length = 4) {
    const segments = [];
    for (let r = 0; r < this.rows; r++) for (let c = 0; c < this.cols; c++) {
      for (const [dr, dc] of [[0,1],[1,0],[1,1],[1,-1]]) {
        const cells = [];
        for (let i = 0; i < length; i++) {
          const rr = r + dr*i, cc = c + dc*i;
          if (rr < 0 || rr >= this.rows || cc < 0 || cc >= this.cols || this.grid[rr][cc] !== player) { cells.length = 0; break; }
          cells.push([rr, cc]);
        }
        if (cells.length) segments.push({ key: cells.map(cell => cell.join(':')).join('|'), cells });
      }
    }
    return segments;
  }

  rotate(direction = 1) {
    if (this.rows !== this.cols) throw new Error('La rotation exige une grille carrée.');
    const next = Array.from({ length: this.rows }, () => Array(this.cols).fill(0));
    for (let r = 0; r < this.rows; r++) for (let c = 0; c < this.cols; c++) {
      if (direction > 0) next[c][this.rows - 1 - r] = this.grid[r][c];
      else next[this.rows - 1 - c][r] = this.grid[r][c];
    }
    this.grid = next;
  }

  applyGravity() {
    const falls = [];
    for (let c = 0; c < this.cols; c++) {
      const pieces = [];
      for (let r = this.rows - 1; r >= 0; r--) if (this.grid[r][c]) pieces.push({ player: this.grid[r][c], from: r });
      for (let r = this.rows - 1, i = 0; r >= 0; r--) {
        if (i < pieces.length) {
          const piece = pieces[i++];
          this.grid[r][c] = piece.player;
          if (r !== piece.from) falls.push({ player: piece.player, fromRow: piece.from, row: r, col: c });
        } else this.grid[r][c] = 0;
      }
    }
    return falls;
  }
}

module.exports = { Board, ROWS, COLS };

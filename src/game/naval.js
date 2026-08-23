function navalRandom(seed) {
  let value = (Number(seed) || 1) >>> 0;
  return () => {
    value = (Math.imul(value ^ (value >>> 15), 1 | value) + 0x6D2B79F5) >>> 0;
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function navalSegments(grid) {
  const segments = [];
  for (const player of [1, 2]) for (let row = 0; row < 6; row++) for (let col = 0; col < 7; col++) {
    for (const [dr, dc] of [[0,1],[1,0],[1,1],[1,-1]]) {
      const cells = [];
      for (let step = 0; step < 4; step++) {
        const r = row + dr * step, c = col + dc * step;
        if (r < 0 || r >= 6 || c < 0 || c >= 7 || grid[r][c] !== player) { cells.length = 0; break; }
        cells.push([r, c]);
      }
      if (cells.length) segments.push({ player, cells });
    }
  }
  return segments;
}

function createNavalGrid(seed) {
  const random = navalRandom(seed);
  for (let attempt = 0; attempt < 100000; attempt++) {
    const grid = Array.from({ length: 6 }, () => Array.from({ length: 7 }, () => random() < .5 ? 1 : 2));
    const segments = navalSegments(grid);
    if (segments.length === 1) return { grid, winningLine: segments[0].cells };
  }
  throw new Error('Impossible de générer la grille navale unique.');
}

module.exports = { createNavalGrid, navalSegments };

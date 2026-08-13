'use strict';

// Le même moteur tourne dans un Web Worker (laboratoire) et un Worker Node
// (bots officiels), afin que les décisions restent identiques.
if (typeof self === 'undefined') {
  const { parentPort } = require('worker_threads');
  global.self = { postMessage: message => parentPort.postMessage(message) };
  parentPort.on('message', data => self.onmessage({ data }));
}

const PROD_MODES = new Set(['rotate', 'anti', 'bomb', 'mission', 'simultaneous', 'fog', 'conquest']);
const DIRS = [[0, 1], [1, 0], [1, 1], [1, -1]];

const clone = grid => grid.map(row => row.slice());
const other = player => player === 1 ? 2 : 1;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function legalRow(grid, col) {
  for (let row = grid.length - 1; row >= 0; row--) if (!grid[row][col]) return row;
  return -1;
}

function legalCols(grid) {
  return Array.from({ length: grid[0]?.length || 0 }, (_, col) => col).filter(col => legalRow(grid, col) >= 0);
}

function drop(grid, col, player) {
  const row = legalRow(grid, col);
  if (row < 0) return null;
  grid[row][col] = player;
  return { row, col, player };
}

function segments(grid, player, length = 4) {
  const rows = grid.length, cols = grid[0]?.length || 0, result = [];
  for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) for (const [dr, dc] of DIRS) {
    const cells = [];
    for (let i = 0; i < length; i++) {
      const rr = row + dr * i, cc = col + dc * i;
      if (rr < 0 || rr >= rows || cc < 0 || cc >= cols || grid[rr][cc] !== player) { cells.length = 0; break; }
      cells.push([rr, cc]);
    }
    if (cells.length) result.push(cells);
  }
  return result;
}

function evaluateWindows(grid, player, fourWeight = 50000) {
  const opponent = other(player), rows = grid.length, cols = grid[0]?.length || 0;
  let score = 0;
  const weights = [0, 2, 13, 72, fourWeight];
  for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) for (const [dr, dc] of DIRS) {
    let mine = 0, theirs = 0, valid = true;
    for (let i = 0; i < 4; i++) {
      const rr = row + dr * i, cc = col + dc * i;
      if (rr < 0 || rr >= rows || cc < 0 || cc >= cols) { valid = false; break; }
      if (grid[rr][cc] === player) mine++;
      else if (grid[rr][cc] === opponent) theirs++;
    }
    if (!valid || (mine && theirs)) continue;
    if (mine) score += weights[mine];
    else if (theirs) score -= weights[theirs] * (theirs === 3 ? 1.16 : 1);
  }
  const center = (cols - 1) / 2;
  for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) {
    const value = grid[row][col];
    if (value) score += (value === player ? 1 : -1) * Math.max(0, 4 - Math.abs(col - center));
  }
  return score;
}

function gravity(grid) {
  const rows = grid.length, cols = grid[0]?.length || 0;
  for (let col = 0; col < cols; col++) {
    const pieces = [];
    for (let row = rows - 1; row >= 0; row--) if (grid[row][col]) pieces.push(grid[row][col]);
    for (let row = rows - 1, index = 0; row >= 0; row--) grid[row][col] = pieces[index++] || 0;
  }
  return grid;
}

function rotate(grid, direction) {
  const size = grid.length;
  const next = Array.from({ length: size }, () => Array(size).fill(0));
  for (let row = 0; row < size; row++) for (let col = 0; col < size; col++) {
    if (direction > 0) next[col][size - 1 - row] = grid[row][col];
    else next[size - 1 - col][row] = grid[row][col];
  }
  return gravity(next);
}

function missionValue(grid, player, missionId) {
  const rows = grid.length, cols = grid[0]?.length || 0;
  if (!missionId) return 0;
  if (missionId === 'square') {
    let best = 0;
    for (let r = 0; r < rows - 1; r++) for (let c = 0; c < cols - 1; c++) {
      best = Math.max(best, [[r,c],[r+1,c],[r,c+1],[r+1,c+1]].filter(([rr,cc]) => grid[rr][cc] === player).length / 4);
    }
    return best;
  }
  if (missionId === 'center') {
    const midR = Math.floor(rows / 2), midC = Math.floor(cols / 2);
    let owned = 0;
    for (let r = midR - 1; r <= midR + 1; r++) for (let c = midC - 1; c <= midC + 1; c++) if (grid[r]?.[c] === player) owned++;
    return Math.min(1, owned / 4);
  }
  if (missionId === 'high4') {
    const copy = clone(grid); copy[rows - 1].fill(0);
    if (segments(copy, player).length) return 1;
    return clamp((evaluateWindows(copy, player) + 80) / 240, 0, .95);
  }
  if (missionId === 'double3') {
    let triples = 0;
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) for (const [dr, dc] of DIRS) {
      let mine = 0, empty = 0, valid = true;
      for (let i = 0; i < 4; i++) {
        const rr = r + dr * i, cc = c + dc * i;
        if (rr < 0 || rr >= rows || cc < 0 || cc >= cols) { valid = false; break; }
        if (grid[rr][cc] === player) mine++; else if (!grid[rr][cc]) empty++; else { valid = false; break; }
      }
      if (valid && mine === 3 && empty === 1) triples++;
    }
    return Math.min(1, triples / 2);
  }
  if (missionId === 'directions') {
    const found = new Set();
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) for (const [dr, dc] of DIRS) {
      const rr = r + dr, cc = c + dc;
      if (grid[r][c] === player && grid[rr]?.[cc] === player) found.add(dr === 0 ? 'h' : dc === 0 ? 'v' : 'd');
    }
    return Math.min(1, found.size / 3);
  }
  return 0;
}

function genericScore(grid, player, state) {
  // En Mission personnelle, une ligne classique n'est pas une victoire sauf
  // si elle accomplit explicitement la mission Haute altitude.
  let score = evaluateWindows(grid, player, state.mode === 'mission' ? 180 : 50000);
  if (state.mode === 'mission') {
    const mine = state.missions?.[player]?.id || state.missions?.[player] || '';
    const theirs = state.missions?.[other(player)]?.id || state.missions?.[other(player)] || '';
    score += missionValue(grid, player, mine) * 820;
    score -= missionValue(grid, other(player), theirs) * 760;
  }
  return score;
}

function forcedAntiCols(grid, player) {
  return legalCols(grid).filter(col => {
    const copy = clone(grid); drop(copy, col, player);
    return segments(copy, player).length > segments(grid, player).length;
  });
}

function antiScore(grid, player) {
  const opponent = other(player);
  const mine = segments(grid, player).length;
  const theirs = segments(grid, opponent).length;
  const myForced = forcedAntiCols(grid, player).length;
  const theirForced = forcedAntiCols(grid, opponent).length;
  return (theirs - mine) * 900 + (theirForced - myForced) * 120;
}

function antiTerminalScore(grid, player) {
  const opponent = other(player);

  for (const length of [4, 3, 2]) {
    const mine = segments(grid, player, length).length;
    const theirs = segments(grid, opponent, length).length;
    if (mine === theirs) continue;
    return mine < theirs ? 100000 - length : -100000 + length;
  }

  return 0;
}

function antiSearch(grid, turn, player, depth, alpha, beta) {
  const legal = legalCols(grid).filter(col => legalRow(grid, col) > 0);
  if (!legal.length) return antiTerminalScore(grid, player);
  if (depth <= 0) return antiScore(grid, player);

  const forced = forcedAntiCols(grid, turn).filter(col => legal.includes(col));
  const choices = forced.length ? forced : legal;
  const maximizing = turn === player;
  let best = maximizing ? -Infinity : Infinity;

  for (const col of choices) {
    const next = clone(grid);
    drop(next, col, turn);
    const value = antiSearch(next, other(turn), player, depth - 1, alpha, beta);

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

function conquestScores(value) {
  return { 1: Number(value?.[1] || 0), 2: Number(value?.[2] || 0) };
}

function conquestResult(grid, scores, turn, col) {
  const next = clone(grid);
  const placed = drop(next, col, turn);
  if (!placed) return null;
  const nextScores = conquestScores(scores);
  const lines = segments(next, turn);
  let captured = 0;
  if (lines.length) {
    const cells = new Set(lines.flatMap(line => line.map(([row, cellCol]) => `${row}:${cellCol}`)));
    captured = cells.size;
    nextScores[turn]++;
    for (const key of cells) {
      const [row, cellCol] = key.split(':').map(Number);
      next[row][cellCol] = 0;
    }
    gravity(next);
  }

  const total = nextScores[1] + nextScores[2];
  const winner = nextScores[turn] >= 3 ? turn : null;
  const draw = !winner && total >= 4;
  let reset = false;
  if (!winner && !draw && !legalCols(next).length) {
    for (const row of next) row.fill(0);
    reset = true;
  }
  return { grid: next, scores: nextScores, captured, lines: lines.length, winner, draw, reset };
}

function conquestHeuristic(grid, scores, player) {
  const opponent = other(player);
  const scoreLead = (scores[player] - scores[opponent]) * 6200;
  const urgency = scores[player] === 2 ? 1100 : 0;
  const danger = scores[opponent] === 2 ? 1350 : 0;
  // Les lignes complètes ont déjà été capturées : on valorise surtout
  // les constructions de 2/3 et davantage le blocage d'une capture décisive.
  return scoreLead + urgency - danger + evaluateWindows(grid, player, 850);
}

function conquestSearch(grid, scores, turn, player, depth, alpha, beta) {
  const choices = legalCols(grid);
  if (depth <= 0 || !choices.length) return conquestHeuristic(grid, scores, player);
  const maximizing = turn === player;
  let best = maximizing ? -Infinity : Infinity;

  // Centre d'abord : l'alpha-beta coupe plus vite tout en restant déterministe.
  const center = (grid[0].length - 1) / 2;
  choices.sort((a, b) => Math.abs(a - center) - Math.abs(b - center));
  for (const col of choices) {
    const result = conquestResult(grid, scores, turn, col);
    let value;
    if (result.winner) value = result.winner === player ? 100000 + depth * 100 : -100000 - depth * 100;
    else if (result.draw) value = 0;
    else value = conquestSearch(result.grid, result.scores, other(turn), player, depth - 1, alpha, beta);

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

function analyseConquest(state, depth) {
  const player = state.turn;
  const scores = conquestScores(state.conquestScores);
  const actions = [];
  for (const col of legalCols(state.grid)) {
    const result = conquestResult(state.grid, scores, player, col);
    let score;
    if (result.winner) score = 100000 + Number(depth || 1) * 100;
    else if (result.draw) score = 0;
    else score = conquestSearch(
      result.grid, result.scores, other(player), player,
      Math.max(0, Number(depth || 1) - 1), -Infinity, Infinity
    );
    const detail = result.winner
      ? `capture décisive · score ${result.scores[1]}–${result.scores[2]}`
      : result.draw
        ? 'quatrième capture · match nul 2–2'
        : result.lines
          ? `${result.lines} alignement${result.lines > 1 ? 's' : ''} capturé${result.lines > 1 ? 's' : ''} · score ${result.scores[1]}–${result.scores[2]}`
          : result.reset
            ? 'grille pleine · nouveau plateau, scores conservés'
            : `prépare une conquête · score ${scores[1]}–${scores[2]}`;
    actions.push({ kind: 'drop', col, label: `Colonne ${col + 1}`, detail, score });
  }
  return actions;
}

// Score absolu de la position, toujours vu depuis le joueur rouge (J1),
// comme dans le moteur classique. Il ne dépend pas du meilleur coup proposé.
function positionScore(state) {
  if (state.mode === 'anti') return antiScore(state.grid, 1);
  if (state.mode === 'conquest') return conquestHeuristic(state.grid, conquestScores(state.conquestScores), 1);
  return genericScore(state.grid, 1, state);
}

function scoreToWinPct(score, mode) {
  if (score >= 50000) return 100;
  if (score <= -50000) return 0;
  const scale = mode === 'anti' ? 900 : mode === 'mission' ? 1050 : mode === 'conquest' ? 4200 : 620;
  return clamp(Math.round(50 + 48 * Math.tanh(score / scale)), 2, 98);
}

function bestOpponentReply(grid, player, state, depth) {
  if (depth <= 1) return 0;
  const opponent = other(player), cols = legalCols(grid);
  let worst = 0;
  for (const col of cols) {
    const copy = clone(grid); drop(copy, col, opponent);
    const value = genericScore(copy, player, state);
    worst = Math.min(worst, value);
  }
  return worst * (depth === 2 ? .36 : .52);
}

function analyseDropModes(state, depth) {
  const player = state.turn, base = state.grid, actions = [];
  let choices = legalCols(base);
  if (state.mode === 'anti') {
    choices = choices.filter(col => legalRow(base, col) > 0);
    const forced = forcedAntiCols(base, player).filter(col => choices.includes(col));
    if (forced.length) choices = forced;
  }
  for (const col of choices) {
    const next = clone(base); drop(next, col, player);
    let score = 0, detail = `Colonne ${col + 1}`;
    if (state.mode === 'anti') {
      const before = segments(base, player).length;
      const added = Math.max(0, segments(next, player).length - before);
      const opponentForced = forcedAntiCols(next, other(player)).length;
      const future = antiSearch(
        next,
        other(player),
        player,
        Math.max(0, Number(depth || 1) - 1),
        -Infinity,
        Infinity
      );
      score = future - added * 1400 + opponentForced * 240 + antiScore(next, player) * .2;
      detail = added ? `${added} nouvel alignement subi` : opponentForced ? `force ${opponentForced} réponse${opponentForced > 1 ? 's' : ''}` : 'aucune ligne offerte immédiatement';
    } else if (state.mode === 'rotate' && (state.moves + 1) % 4 === 0) {
      const clockwise = rotate(clone(next), 1), counter = rotate(clone(next), -1);
      score = (genericScore(clockwise, player, state) + genericScore(counter, player, state)) / 2;
      const risks = [clockwise, counter].filter(board => segments(board, other(player)).length).length;
      detail = `rotation imminente · ${risks ? `${risks}/2 sens dangereux` : 'stable dans les deux sens'}`;
    } else {
      score = genericScore(next, player, state) + bestOpponentReply(next, player, state, depth);
      if (state.mode === 'mission') {
        const missionId = state.missions?.[player]?.id || state.missions?.[player] || '';
        detail = `progression de mission : ${Math.round(missionValue(next, player, missionId) * 100)}%`;
      } else detail = state.mode === 'fog' ? 'construit la position mémorisée' : 'prépare la position avant la prochaine rotation';
    }
    if (segments(next, player).length && state.mode !== 'anti' && state.mode !== 'mission') score += 100000;
    actions.push({ kind: 'drop', col, label: `Colonne ${col + 1}`, detail, score });
  }
  return actions;
}

function explode(grid, row, col) {
  const next = clone(grid);
  let removed = 0;
  for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
    if (!dr && !dc) continue;
    const rr = row + dr, cc = col + dc;
    if (next[rr]?.[cc]) { next[rr][cc] = 0; removed++; }
  }
  return { grid: gravity(next), removed };
}

function analyseBomb(state, depth) {
  const player = state.turn;
  const actions = analyseDropModes(state, depth);
  if (state.bombs?.[player] === false) return actions;
  for (let row = 0; row < state.grid.length; row++) for (let col = 0; col < state.grid[0].length; col++) {
    if (!state.grid[row][col]) continue;
    const result = explode(state.grid, row, col);
    let score = genericScore(result.grid, player, state) + bestOpponentReply(result.grid, player, state, depth);
    if (segments(result.grid, player).length) score += 100000;
    if (segments(result.grid, other(player)).length) score -= 100000;
    score -= 24; // coût stratégique : la bombe est consommée
    actions.push({ kind: 'bomb', row, col, label: `Bombe L${row + 1} C${col + 1}`, detail: `${result.removed} pion${result.removed > 1 ? 's' : ''} retiré${result.removed > 1 ? 's' : ''} · pouvoir consommé`, score });
  }
  return actions;
}

function placeSimultaneous(grid, c1, c2, initiative) {
  const next = clone(grid), order = initiative === 1 ? [1, 2] : [2, 1];
  for (const player of order) drop(next, player === 1 ? c1 : c2, player);
  return next;
}

function analyseSimultaneous(state, depth) {
  const player = state.turn || state.simChooser || 1, opponent = other(player), choices = legalCols(state.grid), actions = [];
  for (const col of choices) {
    const outcomes = [];
    for (const reply of choices) {
      const c1 = player === 1 ? col : reply, c2 = player === 2 ? col : reply;
      const board = placeSimultaneous(state.grid, c1, c2, state.initiative || 1);
      let value = genericScore(board, player, state);
      const mine = segments(board, player).length, theirs = segments(board, opponent).length;
      if (mine && !theirs) value += 100000;
      else if (theirs && !mine) value -= 100000;
      else if (mine && theirs) value = 0;
      outcomes.push(value);
    }
    const average = outcomes.reduce((sum, value) => sum + value, 0) / Math.max(1, outcomes.length);
    const worst = Math.min(...outcomes);
    const score = average * (depth === 1 ? .8 : .55) + worst * (depth === 1 ? .2 : .45);
    const collisions = choices.includes(col) ? 1 : 0;
    actions.push({ kind: 'simultaneous', col, label: `Colonne ${col + 1}`, detail: `${collisions ? 'collision possible' : 'sans collision'} · testé contre ${outcomes.length} réponses`, score });
  }
  return actions;
}

function normalize(actions, player, mode, depth) {
  actions.sort((a, b) => b.score - a.score);
  const top = actions.slice(0, depth === 1 ? 3 : 5);
  const scale = mode === 'anti' ? 900 : mode === 'mission' ? 1050 : mode === 'conquest' ? 4200 : 620;
  const result = top.map((action, index) => {
    const rating = action.score >= 50000 ? 100 : action.score <= -50000 ? 0 : clamp(Math.round(50 + 48 * Math.tanh(action.score / scale)), 2, 98);
    return { ...action, score: Math.round(action.score), rating, rank: index + 1 };
  });
  const best = result[0];
  return {
    player,
    score: best?.score || 0,
    balance: best ? best.rating : 50,
    confidence: actions.length <= 1 ? 100 : clamp(Math.round(58 + depth * 11 + Math.min(16, Math.abs((actions[0]?.score || 0) - (actions[1]?.score || 0)) / 18)), 55, 96),
    actions: result,
  };
}

self.onmessage = event => {
  const { requestId, state, depth = 2 } = event.data || {};
  try {
    if (!state || !PROD_MODES.has(state.mode)) throw new Error('Cette variante n’est pas encore en production.');
    if (!Array.isArray(state.grid) || !state.grid.length) throw new Error('Position invalide.');
    if (state.mode === 'mission' && (!state.missions?.[1] || !state.missions?.[2])) throw new Error('Les deux missions doivent être choisies avant l’analyse.');
    let actions;
    if (state.mode === 'bomb') actions = analyseBomb(state, Number(depth));
    else if (state.mode === 'simultaneous') actions = analyseSimultaneous(state, Number(depth));
    else if (state.mode === 'conquest') actions = analyseConquest(state, Number(depth));
    else actions = analyseDropModes(state, Number(depth));
    const analysis = normalize(actions, state.turn || state.simChooser || 1, state.mode, Number(depth));
    analysis.positionScore = Math.round(positionScore(state));
    analysis.p1WinPct = scoreToWinPct(analysis.positionScore, state.mode);
    analysis.balance = analysis.p1WinPct;
    self.postMessage({ requestId, ok: true, analysis });
  } catch (error) {
    self.postMessage({ requestId, ok: false, error: error.message || 'Analyse impossible.' });
  }
};

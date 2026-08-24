#!/usr/bin/env node
/*
 * Puissance 4 Ranked - Bot API client example
 *
 * Usage:
 *   P4_BOT_TOKEN=p4bot_xxx node p4-bot-client.js
 *
 * Optional:
 *   P4_API_URL=http://localhost:8080 P4_BOT_TOKEN=p4bot_xxx node p4-bot-client.js
 *   P4_CHALLENGE_BOT_ID=7 P4_BOT_TOKEN=p4bot_xxx node p4-bot-client.js
 *   P4_INSECURE_TLS=1 P4_BOT_TOKEN=p4bot_xxx node p4-bot-client.js
 *   P4_DEPTH=8 P4_THINK_MS=5000 P4_BOT_TOKEN=p4bot_xxx node p4-bot-client.js
 *   P4_MAX_TABLE=60000 P4_BOT_TOKEN=p4bot_xxx node p4-bot-client.js
 *   P4_THREADS=4 P4_DEPTH=9 P4_THINK_MS=8000 P4_BOT_TOKEN=p4bot_xxx node p4-bot-client.js
 *
 * This example is intentionally safe but competitive:
 * - pings the site so the bot appears online
 * - joins the bot queue
 * - polls the current game
 * - plays legal moves with alpha-beta + iterative deepening
 * - prints lichess-bot style engine blocks per game id
 * - respects API rate limits with backoff on HTTP 429
 */

const os = require('node:os');
const { Worker, isMainThread, parentPort, workerData } = require('node:worker_threads');

if (process.env.P4_INSECURE_TLS === '1') {
  // À utiliser uniquement pour un certificat TLS local non reconnu.
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
}

const API_URL = (process.env.P4_API_URL || 'http://127.0.0.1:3000').replace(/\/+$/, '');
const BOT_TOKENS = String(process.env.P4_BOT_TOKENS || process.env.P4_BOT_TOKEN || process.env.BOT_TOKEN || '')
  .split(/[,\s]+/)
  .map(token => token.trim())
  .filter(Boolean);
const LOOP_MS = Math.max(1000, Number(process.env.P4_LOOP_MS || 2000));
const CHALLENGE_BOT_ID = Number(process.env.P4_CHALLENGE_BOT_ID || 0);
const MAX_DEPTH = Math.max(1, Math.min(10, Number(process.env.P4_DEPTH || 8)));
const THINK_MS = Math.max(400, Math.min(30000, Number(process.env.P4_THINK_MS || 5000)));
const REQUEST_GAP_MS = Math.max(400, Number(process.env.P4_REQUEST_GAP_MS || 700));
const MAX_CONCURRENT_GAMES = 1;
const MAX_TABLE = Math.max(1000, Math.min(120000, Number(process.env.P4_MAX_TABLE || 60000)));
const MAX_SEARCH_THREADS = Math.max(1, Math.min(4, Number(process.env.P4_MAX_THREADS || 4)));
const SEARCH_THREADS = Math.max(1, Math.min(
  MAX_SEARCH_THREADS,
  Math.max(1, os.cpus().length - 1),
  Number(process.env.P4_THREADS || 1)
));
const LOG_SEARCH = process.env.P4_LOG_SEARCH !== '0';
const USE_COLOR = process.env.P4_COLOR !== '0' && process.stdout.isTTY;

if (isMainThread && !BOT_TOKENS.length) {
  console.error('Missing token. Run with: P4_BOT_TOKEN=p4bot_xxx node p4-bot-client.js');
  process.exit(1);
}

let lastRequestAt = 0;
let rateLimitUntil = 0;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function nowIso() {
  return new Date().toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');
}

function log(message, ...args) {
  console.log(`[${nowIso()}] [P4 Bot] ${message}`, ...args);
}

function warn(message, ...args) {
  console.warn(`[${nowIso()}] [P4 Bot] ${message}`, ...args);
}

function formatPv(pv) {
  return Array.isArray(pv) && pv.length ? pv.map(col => `c${col + 1}`).join(' -> ') : '-';
}

function formatCandidates(candidates) {
  if (!Array.isArray(candidates) || !candidates.length) return '-';
  return candidates
    .slice(0, 4)
    .map(entry => `c${Number(entry.col) + 1}:${formatSignedCp(entry.cp || 0)}`)
    .join(' | ');
}

function formatSignedCp(cp) {
  const value = Number(cp || 0);
  if (Math.abs(value) >= 100000) return value > 0 ? '+M' : '-M';
  return `${value >= 0 ? '+' : ''}${(value / 100).toFixed(2)}`;
}

function color(text, code) {
  return USE_COLOR ? `\x1b[${code}m${text}\x1b[0m` : text;
}

function colorEval(cp) {
  const value = Number(cp || 0);
  const formatted = formatSignedCp(value);
  if (value > 25) return color(formatted, '92;1');
  if (value < -25) return color(formatted, '91;1');
  return color(formatted, '93;1');
}

function boardAfterMove(board, col, side) {
  const copy = cloneBoard(board);
  drop(copy, col, side);
  return copy;
}

function formatBoard(board) {
  return board.map(row => row.map(v => (v === 0 ? '.' : v === 1 ? 'X' : 'O')).join(' ')).join('\n');
}

function gameLabel(game) {
  return `Game ${game?.gameId ?? '?'}`;
}

function moveNumber(game) {
  return Array.isArray(game?.moves) ? game.moves.length + 1 : '?';
}

function scoreToCentipawns(score) {
  if (!Number.isFinite(score)) return 0;
  if (Math.abs(score) >= 900_000) return score > 0 ? 100000 : -100000;
  return Math.max(-5000, Math.min(5000, Math.round(score)));
}

function scoreToWinPct(score) {
  if (!Number.isFinite(score)) return 50;
  if (score >= 900_000) return 100;
  if (score <= -900_000) return 0;
  const normalized = Math.tanh(Math.max(-5000, Math.min(5000, score)) / 1150);
  return Math.round(((normalized + 1) / 2) * 100);
}

function renderEngineReport(game, col, stats, shownBoard = game.board) {
  const elapsed = Math.max(1, Number(stats.elapsedMs || 1));
  const nodes = Number(stats.nodes || 0);
  const nps = Math.round(nodes / (elapsed / 1000));
  const cp = stats.centipawns ?? scoreToCentipawns(stats.score || 0);
  const winPct = scoreToWinPct(cp);
  const lines = [
    '',
    '============================================================',
    color(`[${gameLabel(game)}] Engine analysis`, '96;1'),
    '------------------------------------------------------------',
    `${color('Coup', '97;1')}              : c${Number(col) + 1} (${moveNumber(game)})`,
    `${color('Source', '97;1')}            : Engine${stats.tactical ? ` / ${stats.tactical}` : ''}`,
    `${color('Evaluation', '97;1')}        : ${colorEval(cp)} (${cp} cp)`,
    `${color('Chance estimee', '97;1')}    : ${winPct}%`,
    `${color('Depth', '97;1')}             : ${stats.depth || 0}/${MAX_DEPTH}${stats.timeout ? ` ${color('timeout', '91;1')}` : ''}`,
    `Nodes             : ${nodes.toLocaleString('fr-FR')}`,
    `Nodes/seconde     : ${nps.toLocaleString('fr-FR')}`,
    `Prunes            : ${Number(stats.prunes || 0).toLocaleString('fr-FR')}`,
    `Cache hits        : ${Number(stats.cacheHits || 0).toLocaleString('fr-FR')}`,
    `Table             : ${Number(stats.tableSize || 0).toLocaleString('fr-FR')} / ${MAX_TABLE.toLocaleString('fr-FR')}`,
    `Temps calcul      : ${elapsed} ms`,
    `CP -> Futurs coups: ${formatPv(stats.pv)}`,
    `Candidats         : ${formatCandidates(stats.candidates)}`,
    '------------------------------------------------------------',
    formatBoard(shownBoard),
    '============================================================',
    '',
  ];
  console.log(lines.join('\n'));
}

async function api(path, options = {}, token = BOT_TOKENS[0]) {
  const now = Date.now();
  const waitForRateLimit = Math.max(0, rateLimitUntil - now);
  const waitForGap = Math.max(0, REQUEST_GAP_MS - (now - lastRequestAt));
  if (waitForRateLimit || waitForGap) await sleep(Math.max(waitForRateLimit, waitForGap));
  lastRequestAt = Date.now();

  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  if (!res.ok) {
    const err = new Error(data?.error || `HTTP ${res.status}`);
    err.status = res.status;
    err.data = data;
    if (res.status === 429) {
      const retryAfter = Number(res.headers.get('retry-after') || 0);
      const waitMs = retryAfter > 0 ? retryAfter * 1000 : Math.max(2500, LOOP_MS * 2);
      rateLimitUntil = Date.now() + waitMs;
      err.retryAfterMs = waitMs;
    }
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

function boardKey(board, player, depth) {
  return `${player}|${depth}|${board.map(row => row.join('')).join('')}`;
}

function principalVariation(board, firstCol, me, maxPlies = 6) {
  if (firstCol == null) return [];
  const copy = cloneBoard(board);
  const pv = [];
  let player = me;
  let col = firstCol;
  for (let ply = 0; ply < maxPlies && col != null; ply++) {
    const row = drop(copy, col, player);
    if (row < 0) break;
    pv.push(col);
    if (checkWin(copy, row, col, player)) break;
    player = player === 1 ? 2 : 1;
    const moves = orderedMoves(copy);
    if (!moves.length) break;
    let best = moves[0];
    let bestScore = player === me ? -Infinity : Infinity;
    for (const nextCol of moves) {
      const nextRow = drop(copy, nextCol, player);
      if (nextRow < 0) continue;
      const won = checkWin(copy, nextRow, nextCol, player);
      const score = won
        ? (player === me ? 1_000_000 : -1_000_000)
        : evaluate(copy, me);
      undoDrop(copy, nextRow, nextCol);
      if ((player === me && score > bestScore) || (player !== me && score < bestScore)) {
        bestScore = score;
        best = nextCol;
      }
    }
    col = best;
  }
  return pv;
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

function undoDrop(board, row, col) {
  if (row >= 0) board[row][col] = 0;
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

function isFull(board) {
  return board[0].every(Boolean);
}

function scoreWindow(values, me) {
  const opp = me === 1 ? 2 : 1;
  const mine = values.filter(v => v === me).length;
  const theirs = values.filter(v => v === opp).length;
  const empty = values.filter(v => v === 0).length;
  if (mine === 4) return 1_000_000;
  if (theirs === 4) return -1_000_000;
  if (mine === 3 && empty === 1) return 260;
  if (mine === 2 && empty === 2) return 42;
  if (mine === 1 && empty === 3) return 5;
  if (theirs === 3 && empty === 1) return -310;
  if (theirs === 2 && empty === 2) return -48;
  if (theirs === 1 && empty === 3) return -6;
  return 0;
}

function countThreats(board, player) {
  let threats = 0;
  for (const col of legalMoves(board)) {
    const row = drop(board, col, player);
    if (row >= 0 && checkWin(board, row, col, player)) threats++;
    undoDrop(board, row, col);
  }
  return threats;
}

function evaluate(board, me) {
  let score = 0;
  const opp = me === 1 ? 2 : 1;
  const center = board.map(row => row[3]).filter(v => v === me).length;
  const oppCenter = board.map(row => row[3]).filter(v => v === opp).length;
  score += center * 30;
  score -= oppCenter * 26;

  const myThreats = countThreats(board, me);
  const oppThreats = countThreats(board, opp);
  score += myThreats * 700;
  score -= oppThreats * 820;
  if (myThreats >= 2) score += 2400;
  if (oppThreats >= 2) score -= 2700;

  // Slight preference for lower stable pieces.
  for (let r = 0; r < 6; r++) {
    for (let c = 0; c < 7; c++) {
      if (board[r][c] === me) score += (6 - r) * 2;
      else if (board[r][c] === opp) score -= (6 - r) * 2;
    }
  }

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

function orderedMoves(board, moves = legalMoves(board)) {
  const centerOrder = [3, 2, 4, 1, 5, 0, 6];
  return centerOrder.filter(col => moves.includes(col));
}

function orderedMovesFor(board, player, moves = legalMoves(board)) {
  const opp = player === 1 ? 2 : 1;
  return moves.map(col => {
    const row = drop(board, col, player);
    if (row < 0) return { col, score: -Infinity };
    const win = checkWin(board, row, col, player);
    const myThreats = win ? 0 : countThreats(board, player);
    const oppThreats = win ? 0 : countThreats(board, opp);
    undoDrop(board, row, col);
    const centerBonus = 8 - Math.abs(3 - col);
    return { col, score: (win ? 100000 : 0) + myThreats * 1000 - oppThreats * 1400 + centerBonus };
  }).sort((a, b) => b.score - a.score).map(entry => entry.col);
}

function moveAllowsImmediateLoss(board, col, me) {
  const opp = me === 1 ? 2 : 1;
  const row = drop(board, col, me);
  if (row < 0) return true;
  const loses = legalMoves(board).some(nextCol => isWinningMove(board, nextCol, opp));
  undoDrop(board, row, col);
  return loses;
}

function minimax(board, depth, alpha, beta, currentPlayer, me, deadline, table, stats) {
  stats.nodes++;
  if (Date.now() >= deadline) {
    stats.timeout = true;
    return evaluate(board, me);
  }

  const moves = orderedMovesFor(board, currentPlayer);
  if (depth <= 0 || !moves.length || isFull(board)) return evaluate(board, me);

  const key = boardKey(board, currentPlayer, depth);
  const cached = table.get(key);
  if (cached !== undefined) {
    stats.cacheHits++;
    return cached;
  }

  const maximizing = currentPlayer === me;
  const nextPlayer = currentPlayer === 1 ? 2 : 1;
  let bestScore = maximizing ? -Infinity : Infinity;
  let exact = true;

  for (const col of moves) {
    const row = drop(board, col, currentPlayer);
    if (row < 0) continue;
    const won = checkWin(board, row, col, currentPlayer);
    let score;
    if (won) {
      score = (currentPlayer === me ? 1_000_000 : -1_000_000) + (currentPlayer === me ? depth : -depth);
    } else {
      score = minimax(board, depth - 1, alpha, beta, nextPlayer, me, deadline, table, stats);
    }
    undoDrop(board, row, col);

    if (maximizing) {
      if (score > bestScore) bestScore = score;
      alpha = Math.max(alpha, bestScore);
    } else {
      if (score < bestScore) bestScore = score;
      beta = Math.min(beta, bestScore);
    }
    if (beta <= alpha) {
      stats.prunes++;
      exact = false;
      break;
    }
    if (stats.timeout) break;
  }

  if (exact && table.size < MAX_TABLE) table.set(key, bestScore);
  return bestScore;
}

function searchRootMove(task) {
  const start = Date.now();
  const board = cloneBoard(task.board);
  const me = Number(task.me);
  const opp = me === 1 ? 2 : 1;
  const col = Number(task.col);
  const depth = Number(task.depth || 1);
  const deadline = Number(task.deadline || Date.now() + THINK_MS);
  const table = new Map();
  const stats = { nodes: 0, prunes: 0, cacheHits: 0, timeout: false, depth, score: 0, pv: [], tableSize: 0 };
  const row = drop(board, col, me);
  let score = -Infinity;
  if (row >= 0) {
    score = checkWin(board, row, col, me)
      ? 1_000_000 + depth
      : minimax(board, depth - 1, -Infinity, Infinity, opp, me, deadline, table, stats);
    undoDrop(board, row, col);
  }
  stats.score = score;
  stats.centipawns = scoreToCentipawns(score);
  stats.pv = principalVariation(task.board, col, me, Math.min(8, depth + 1));
  stats.tableSize = table.size;
  stats.elapsedMs = Date.now() - start;
  table.clear();
  return { col, score, stats };
}

function runRootWorker(task) {
  return new Promise(resolve => {
    const worker = new Worker(__filename, { workerData: { type: 'search-root', task } });
    worker.once('message', resolve);
    worker.once('error', error => resolve({ col: task.col, score: -Infinity, stats: { timeout: true, error: error.message, nodes: 0 } }));
    worker.once('exit', code => {
      if (code !== 0) resolve({ col: task.col, score: -Infinity, stats: { timeout: true, nodes: 0 } });
    });
  });
}

async function evaluateRootMoves(board, moveOrder, me, depth, deadline) {
  const tasks = moveOrder.map(col => ({ board, col, me, depth, deadline }));
  if (SEARCH_THREADS <= 1 || tasks.length <= 1 || depth < 7) {
    return tasks.map(searchRootMove);
  }
  const results = [];
  for (let i = 0; i < tasks.length; i += SEARCH_THREADS) {
    const chunk = tasks.slice(i, i + SEARCH_THREADS);
    results.push(...await Promise.all(chunk.map(runRootWorker)));
    if (Date.now() >= deadline) break;
  }
  return results;
}

async function chooseMove(game) {
  const board = game.board;
  if (game.variant === 'naval') {
    const legalCells = Array.isArray(game.legalCells) ? game.legalCells : [];
    if (!legalCells.length) return { row: null, col: null, stats: { tactical: 'naval-no-target', elapsedMs: 0 } };
    const directions = [[0, 1], [1, 0], [1, 1], [1, -1]];
    const scored = legalCells.map(cell => ({ row: Number(cell.row), col: Number(cell.col), score: 0 }));
    const byKey = new Map(scored.map(cell => [`${cell.row}:${cell.col}`, cell]));
    for (let row = 0; row < board.length; row++) for (let col = 0; col < board[row].length; col++) {
      for (const [dr, dc] of directions) {
        const cells = Array.from({ length: 4 }, (_, step) => [row + dr * step, col + dc * step]);
        if (cells.some(([r, c]) => r < 0 || r >= board.length || c < 0 || c >= board[r].length)) continue;
        const known = cells.map(([r, c]) => Number(board[r][c] || 0)).filter(Boolean);
        if (new Set(known).size > 1) continue;
        const weight = Math.pow(known.length + 1, 3);
        cells.forEach(([r, c]) => { const target = byKey.get(`${r}:${c}`); if (target) target.score += weight; });
      }
    }
    scored.forEach(cell => { cell.score += Math.random() * 0.02; });
    scored.sort((a, b) => b.score - a.score);
    return { row: scored[0].row, col: scored[0].col, stats: { tactical: 'naval-public-grid', score: scored[0].score, elapsedMs: 0 } };
  }
  const me = Number(game.side);
  const opp = me === 1 ? 2 : 1;
  const moves = game.legalMoves?.length ? game.legalMoves : legalMoves(board);
  const start = Date.now();
  const deadline = start + THINK_MS;
  const table = new Map();
  const stats = { nodes: 0, prunes: 0, cacheHits: 0, timeout: false, depth: 0, score: 0, pv: [], tableSize: 0 };
  if (!moves.length) return { col: null, stats };

  for (const col of moves) {
    if (isWinningMove(board, col, me)) {
      return { col, stats: { ...stats, tactical: 'win-now', score: 1_000_000, centipawns: 100000, pv: [col], elapsedMs: Date.now() - start } };
    }
  }
  for (const col of moves) {
    if (isWinningMove(board, col, opp)) {
      return { col, stats: { ...stats, tactical: 'block-now', score: 0, centipawns: 0, pv: [col], elapsedMs: Date.now() - start } };
    }
  }

  const safeMoves = moves.filter(col => !moveAllowsImmediateLoss(board, col, me));
  const moveOrder = orderedMovesFor(board, me, safeMoves.length ? safeMoves : moves);
  let best = moveOrder[0] ?? moves[0];
  let bestScore = -Infinity;
  const depthReports = [];
  for (let depth = 1; depth <= MAX_DEPTH; depth++) {
    const results = await evaluateRootMoves(board, moveOrder, me, depth, deadline);
    let depthBest = best;
    let depthBestScore = -Infinity;
    for (const result of results) {
      const s = result.stats || {};
      stats.nodes += Number(s.nodes || 0);
      stats.prunes += Number(s.prunes || 0);
      stats.cacheHits += Number(s.cacheHits || 0);
      stats.timeout = stats.timeout || !!s.timeout;
      stats.tableSize = Math.max(stats.tableSize, Number(s.tableSize || 0));
      if (Number(result.score) > depthBestScore) {
        depthBestScore = Number(result.score);
        depthBest = Number(result.col);
      }
    }
    if (!stats.timeout) {
      const candidates = results
        .map(result => ({ col: Number(result.col), cp: scoreToCentipawns(Number(result.score || 0)) }))
        .sort((a, b) => b.cp - a.cp);
      best = depthBest;
      bestScore = depthBestScore;
      stats.depth = depth;
      stats.score = bestScore;
      stats.centipawns = scoreToCentipawns(bestScore);
      stats.pv = principalVariation(board, best, me, Math.min(8, depth + 1));
      stats.candidates = candidates;
      stats.tableSize = table.size;
      depthReports.push({ depth, best, cp: stats.centipawns, pv: [...stats.pv], nodes: stats.nodes, prunes: stats.prunes, cacheHits: stats.cacheHits });
      if (LOG_SEARCH) {
        log(`[${gameLabel(game)}] info depth ${depth}/${MAX_DEPTH} cp ${formatSignedCp(stats.centipawns)} nodes ${stats.nodes} pv ${formatPv(stats.pv)}`);
      }
    }
    if (stats.tableSize > MAX_TABLE) {
      warn(`transposition table limit reached (${stats.tableSize}/${MAX_TABLE}), stopping search to protect RAM`);
      break;
    }
    if (stats.timeout) {
      warn(`search timeout after ${Date.now() - start}ms, using depth ${stats.depth || 1} result`);
      break;
    }
  }
  stats.elapsedMs = Date.now() - start;
  stats.tableSize = stats.tableSize || table.size;
  stats.depthReports = depthReports;
  table.clear();
  return { col: best, stats };
}

async function runBotWorker(token, workerIndex) {
  const tag = `Bot#${workerIndex + 1}`;
  const workerLog = (message, ...args) => log(`[${tag}] ${message}`, ...args);
  const workerWarn = (message, ...args) => warn(`[${tag}] ${message}`, ...args);
  const me = await api('/api/bot/me', {}, token);
  workerLog(`Connected as ${me.bot.pseudo} (${me.bot.elo} ELO) on ${API_URL}`);
  workerLog(`Config depth=${MAX_DEPTH}, thinkMs=${THINK_MS}, threads=${SEARCH_THREADS}, loopMs=${LOOP_MS}, requestGapMs=${REQUEST_GAP_MS}, maxConcurrent=${MAX_CONCURRENT_GAMES}, maxTable=${MAX_TABLE}`);

  if (CHALLENGE_BOT_ID > 0 && workerIndex === 0) {
    try {
      const challenge = await api(`/api/bot/challenge/${CHALLENGE_BOT_ID}`, { method: 'POST' }, token);
      workerLog(`Challenged bot #${CHALLENGE_BOT_ID}, game ${challenge.game?.gameId || '?'}`);
    } catch (error) {
      workerWarn(`Challenge failed: ${error.message}`);
    }
  }

  let lastGameId = null;
  while (true) {
    try {
      await api('/api/bot/ping', {
        method: 'POST',
        body: JSON.stringify({ status: lastGameId ? 'playing' : 'seeking' }),
      }, token);

      let game = (await api('/api/bot/game', {}, token)).game;
      if (!game) {
        const queue = await api('/api/bot/queue/join', {
          method: 'POST',
          body: JSON.stringify({ allowBuiltin: true }),
        }, token);
        game = queue.game || null;
        if (!game) {
          workerLog(`Queue: ${queue.status}${queue.position ? ` #${queue.position}` : ''}`);
          await sleep(LOOP_MS);
          continue;
        }
      }

      if (game.gameId !== lastGameId) {
        lastGameId = game.gameId;
        workerLog(`Game ${game.gameId} started as side ${game.side}: ${game.players[1].pseudo} (${game.players[1].elo}) vs ${game.players[2].pseudo} (${game.players[2].elo})`);
      }

      if (!game.isMyTurn) {
        await sleep(LOOP_MS);
        continue;
      }

      const choice = await chooseMove(game);
      const col = choice.col;
      if (col === null) {
        await sleep(LOOP_MS);
        continue;
      }

      const result = await api('/api/bot/move', {
        method: 'POST',
        body: JSON.stringify({ col, ...(game.variant === 'naval' ? { row: choice.row } : {}) }),
      }, token);
      const s = choice.stats || {};
      if (game.variant !== 'naval') renderEngineReport(game, col, s, boardAfterMove(game.board, col, Number(game.side)));
      workerLog(`[${gameLabel(game)}] Played ${game.variant === 'naval' ? `r${choice.row + 1}c${col + 1}` : `c${col + 1}`}${result.result?.type === 'game_over' ? ' - game over' : ''}`);
      if (result.result?.type === 'game_over') {
        const winner = result.result?.winner ? `side ${result.result.winner}` : 'draw';
        workerLog(`Game ${game.gameId} ended: ${winner}. Clearing local search memory and seeking next game.`);
        lastGameId = null;
      }
    } catch (error) {
      if (error.status === 404) lastGameId = null;
      if (error.status === 429) {
        workerWarn(`Rate limited, sleeping ${error.retryAfterMs || 2500}ms`);
        await sleep(error.retryAfterMs || 2500);
      } else if (error.status === 409 && error.data?.game) {
        await sleep(Math.max(LOOP_MS, 1500));
      } else {
        workerWarn(error.message);
        await sleep(Math.max(LOOP_MS, 2500));
      }
    }
  }
}

async function main() {
  const activeTokens = BOT_TOKENS.slice(0, MAX_CONCURRENT_GAMES);
  if (BOT_TOKENS.length > 1) {
    warn(`Several tokens provided, but this client is configured for one simultaneous game. Using only the first token.`);
  }
  log(`Starting single-game worker. depth=${MAX_DEPTH}, thinkMs=${THINK_MS}, threads=${SEARCH_THREADS}, maxTable=${MAX_TABLE}.`);
  await Promise.all(activeTokens.map((token, index) => runBotWorker(token, index)));
}

if (!isMainThread) {
  try {
    parentPort.postMessage(searchRootMove(workerData.task));
  } catch (error) {
    parentPort.postMessage({ col: workerData?.task?.col, score: -Infinity, stats: { timeout: true, error: error.message, nodes: 0 } });
  }
} else {
  main().catch(error => {
    console.error('[P4 Bot] Fatal:', error);
    process.exit(1);
  });
}

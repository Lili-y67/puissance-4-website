/**
 * analyse-worker.js — Web Worker d'analyse Puissance 4
 * Algorithme Minimax + Alpha-Beta élagage, profondeur 10
 * Envoi des résultats coup par coup via postMessage
 */

const ROWS = 6, COLS = 7;
const DEPTH = 10;

// ── Utilitaires plateau ───────────────────────────────────────────────────────
function makeBoard() {
  return Array.from({ length: ROWS }, () => new Int8Array(COLS));
}
function cloneBoard(b) {
  return b.map(r => new Int8Array(r));
}
function drop(board, col, player) {
  for (let r = ROWS - 1; r >= 0; r--) {
    if (board[r][col] === 0) { board[r][col] = player; return r; }
  }
  return -1;
}
function undrop(board, col) {
  for (let r = 0; r < ROWS; r++) {
    if (board[r][col] !== 0) { board[r][col] = 0; return; }
  }
}
function validCols(board) {
  const cols = [];
  // Ordonner du centre vers les bords (meilleure élagage)
  const order = [3, 2, 4, 1, 5, 0, 6];
  for (const c of order) if (board[0][c] === 0) cols.push(c);
  return cols;
}

// ── Détection victoire ────────────────────────────────────────────────────────
function checkWin(board, player) {
  // Horizontale
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c <= COLS - 4; c++)
      if (board[r][c]===player && board[r][c+1]===player && board[r][c+2]===player && board[r][c+3]===player) return true;
  // Verticale
  for (let r = 0; r <= ROWS - 4; r++)
    for (let c = 0; c < COLS; c++)
      if (board[r][c]===player && board[r+1][c]===player && board[r+2][c]===player && board[r+3][c]===player) return true;
  // Diag /
  for (let r = 3; r < ROWS; r++)
    for (let c = 0; c <= COLS - 4; c++)
      if (board[r][c]===player && board[r-1][c+1]===player && board[r-2][c+2]===player && board[r-3][c+3]===player) return true;
  // Diag \
  for (let r = 0; r <= ROWS - 4; r++)
    for (let c = 0; c <= COLS - 4; c++)
      if (board[r][c]===player && board[r+1][c+1]===player && board[r+2][c+2]===player && board[r+3][c+3]===player) return true;
  return false;
}

function isFull(board) {
  return board[0].every(c => c !== 0);
}

// ── Fonction d'évaluation heuristique ────────────────────────────────────────
function scoreWindow(window, player) {
  const opp = player === 1 ? 2 : 1;
  const mine = window.filter(c => c === player).length;
  const empty = window.filter(c => c === 0).length;
  const opps  = window.filter(c => c === opp).length;
  if (mine === 4) return 1000;
  if (mine === 3 && empty === 1) return 10;
  if (mine === 2 && empty === 2) return 3;
  if (opps === 3 && empty === 1) return -80;
  if (opps === 2 && empty === 2) return -3;
  return 0;
}

function evaluate(board, player) {
  let score = 0;
  // Centre column bonus
  const center = board.map(r => r[3]).filter(c => c === player).length;
  score += center * 6;

  // Horizontale
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c <= COLS - 4; c++)
      score += scoreWindow([board[r][c], board[r][c+1], board[r][c+2], board[r][c+3]], player);
  // Verticale
  for (let c = 0; c < COLS; c++)
    for (let r = 0; r <= ROWS - 4; r++)
      score += scoreWindow([board[r][c], board[r+1][c], board[r+2][c], board[r+3][c]], player);
  // Diag /
  for (let r = 3; r < ROWS; r++)
    for (let c = 0; c <= COLS - 4; c++)
      score += scoreWindow([board[r][c], board[r-1][c+1], board[r-2][c+2], board[r-3][c+3]], player);
  // Diag \
  for (let r = 0; r <= ROWS - 4; r++)
    for (let c = 0; c <= COLS - 4; c++)
      score += scoreWindow([board[r][c], board[r+1][c+1], board[r+2][c+2], board[r+3][c+3]], player);

  return score;
}

// ── Minimax Alpha-Beta ────────────────────────────────────────────────────────
function minimax(board, depth, alpha, beta, maximizing, rootPlayer) {
  const opp = rootPlayer === 1 ? 2 : 1;
  if (checkWin(board, rootPlayer)) return  100000 + depth;
  if (checkWin(board, opp))        return -100000 - depth;
  if (isFull(board) || depth === 0) return evaluate(board, rootPlayer);

  const cols = validCols(board);
  if (maximizing) {
    let best = -Infinity;
    for (const col of cols) {
      drop(board, col, rootPlayer);
      best = Math.max(best, minimax(board, depth - 1, alpha, beta, false, rootPlayer));
      undrop(board, col);
      alpha = Math.max(alpha, best);
      if (beta <= alpha) break;
    }
    return best;
  } else {
    let best = Infinity;
    for (const col of cols) {
      drop(board, col, opp);
      best = Math.min(best, minimax(board, depth - 1, alpha, beta, true, rootPlayer));
      undrop(board, col);
      beta = Math.min(beta, best);
      if (beta <= alpha) break;
    }
    return best;
  }
}

// Retourne { col, score } du meilleur coup + scores de toutes les colonnes
function bestMove(board, player) {
  const cols = validCols(board);
  if (cols.length === 0) return null;

  let bestCol = cols[0], bestScore = -Infinity;
  const colScores = {};

  for (const col of cols) {
    drop(board, col, player);
    const score = minimax(board, DEPTH - 1, -Infinity, Infinity, false, player);
    undrop(board, col);
    colScores[col] = score;
    if (score > bestScore) { bestScore = score; bestCol = col; }
  }
  return { col: bestCol, score: bestScore, colScores };
}

// ── Classification du coup ────────────────────────────────────────────────────
function classifyMove(playedCol, bestCol, playedScore, bestScore) {
  if (playedCol === bestCol) return 'best';
  const loss = bestScore - playedScore;
  if (loss <= 2)   return 'excellent';
  if (loss <= 8)   return 'good';
  if (loss <= 25)  return 'inaccuracy';
  if (loss <= 80)  return 'mistake';
  return 'blunder';
}

// ── Analyse complète d'une partie ────────────────────────────────────────────
self.onmessage = function(e) {
  const { moves } = e.data; // tableau de colonnes jouées [ col0, col1, ... ]
  const board = makeBoard();
  const results = [];
  let p1Scores = [], p2Scores = []; // pour le % précision

  for (let i = 0; i < moves.length; i++) {
    const player = (i % 2 === 0) ? 1 : 2;
    const playedCol = moves[i];

    // Analyser la position AVANT le coup
    const analysis = bestMove(cloneBoard(board), player);

    let result;
    if (!analysis) {
      result = { moveIndex: i, player, playedCol, bestCol: playedCol, classification: 'best', loss: 0 };
    } else {
      const playedScore = analysis.colScores[playedCol] ?? (analysis.score - 500);
      const classification = classifyMove(playedCol, analysis.col, playedScore, analysis.score);
      const loss = Math.max(0, analysis.score - playedScore);
      result = {
        moveIndex: i,
        player,
        playedCol,
        bestCol:  analysis.col,
        bestScore: analysis.score,
        playedScore,
        classification,
        loss,
        colScores: analysis.colScores,
      };
      if (player === 1) p1Scores.push({ classification, loss });
      else              p2Scores.push({ classification, loss });
    }

    results.push(result);

    // Jouer le coup réel sur le plateau
    drop(board, playedCol, player);

    // Envoyer progression
    self.postMessage({ type: 'progress', moveIndex: i, total: moves.length, result });

    // Vérifier si la partie est terminée
    if (checkWin(board, player)) break;
  }

  // Calculer % de précision par joueur
  function calcAccuracy(scores) {
    if (scores.length === 0) return 100;
    const weights = { best: 100, excellent: 92, good: 78, inaccuracy: 55, mistake: 25, blunder: 5 };
    const sum = scores.reduce((acc, s) => acc + (weights[s.classification] ?? 50), 0);
    return Math.round(sum / scores.length);
  }

  self.postMessage({
    type: 'done',
    results,
    accuracy: {
      p1: calcAccuracy(p1Scores),
      p2: calcAccuracy(p2Scores),
    }
  });
};

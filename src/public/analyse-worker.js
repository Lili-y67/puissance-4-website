/**
 * analyse-worker.js — Web Worker d'analyse Puissance 4
 * Minimax + Alpha-Beta, profondeur 10
 * Nouvelles fonctionnalités : séquence optimale, score d'évaluation coup par coup
 */

const ROWS = 6, COLS = 7;
const DEPTH = 10;
const SEQ_DEPTH = 6; // profondeur pour calculer la séquence optimale (plus léger)

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
  const order = [3, 2, 4, 1, 5, 0, 6];
  return order.filter(c => board[0][c] === 0);
}

// ── Détection victoire ────────────────────────────────────────────────────────
function checkWin(board, player) {
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c <= COLS - 4; c++)
      if (board[r][c]===player && board[r][c+1]===player && board[r][c+2]===player && board[r][c+3]===player) return true;
  for (let r = 0; r <= ROWS - 4; r++)
    for (let c = 0; c < COLS; c++)
      if (board[r][c]===player && board[r+1][c]===player && board[r+2][c]===player && board[r+3][c]===player) return true;
  for (let r = 3; r < ROWS; r++)
    for (let c = 0; c <= COLS - 4; c++)
      if (board[r][c]===player && board[r-1][c+1]===player && board[r-2][c+2]===player && board[r-3][c+3]===player) return true;
  for (let r = 0; r <= ROWS - 4; r++)
    for (let c = 0; c <= COLS - 4; c++)
      if (board[r][c]===player && board[r+1][c+1]===player && board[r+2][c+2]===player && board[r+3][c+3]===player) return true;
  return false;
}
function isFull(board) { return board[0].every(c => c !== 0); }

// ── Évaluation heuristique ────────────────────────────────────────────────────
function scoreWindow(window, player) {
  const opp   = player === 1 ? 2 : 1;
  const mine  = window.filter(c => c === player).length;
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
  score += board.map(r => r[3]).filter(c => c === player).length * 6;
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c <= COLS - 4; c++)
      score += scoreWindow([board[r][c], board[r][c+1], board[r][c+2], board[r][c+3]], player);
  for (let c = 0; c < COLS; c++)
    for (let r = 0; r <= ROWS - 4; r++)
      score += scoreWindow([board[r][c], board[r+1][c], board[r+2][c], board[r+3][c]], player);
  for (let r = 3; r < ROWS; r++)
    for (let c = 0; c <= COLS - 4; c++)
      score += scoreWindow([board[r][c], board[r-1][c+1], board[r-2][c+2], board[r-3][c+3]], player);
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

// ── Séquence optimale (N coups depuis une position) ───────────────────────────
function getOptimalSequence(board, startPlayer, maxMoves) {
  const seq = [];
  const b = cloneBoard(board);
  let player = startPlayer;
  for (let i = 0; i < maxMoves; i++) {
    const cols = validCols(b);
    if (cols.length === 0) break;
    // Trouver le meilleur coup à profondeur réduite
    let bestCol = cols[0], bestScore = -Infinity;
    for (const col of cols) {
      drop(b, col, player);
      const score = minimax(b, SEQ_DEPTH - 1, -Infinity, Infinity, false, player);
      undrop(b, col);
      if (score > bestScore) { bestScore = score; bestCol = col; }
    }
    seq.push(bestCol);
    drop(b, bestCol, player);
    if (checkWin(b, player)) break;
    player = player === 1 ? 2 : 1;
  }
  return seq;
}

// ── Score d'évaluation normalisé (-100 à +100) ───────────────────────────────
// Positif = avantage J1, négatif = avantage J2
function normalizeScore(rawScore, perspective) {
  // rawScore est du point de vue du joueur courant
  const signed = perspective === 1 ? rawScore : -rawScore;
  // Clamp entre -100 et +100
  const MAX = 200;
  return Math.max(-100, Math.min(100, Math.round((signed / MAX) * 100)));
}

// ── Commentaires automatiques ────────────────────────────────────────────────
function generateComment(classification, player, moveIndex, loss, optimalSeq, playedCol) {
  const turn = Math.floor(moveIndex / 2) + 1;
  const comments = {
    best: [
      "Coup parfait !",
      "Exactement le bon choix.",
      "L'algorithme aurait joué pareil.",
    ],
    excellent: [
      "Très bon coup, quasi optimal.",
      "Solide, pratiquement le meilleur.",
      "Bonne lecture de la position.",
    ],
    good: [
      "Bon coup, une légère amélioration était possible.",
      "Correct, mais il y avait mieux.",
      "Pas mauvais, l'avantage reste intact.",
    ],
    inaccuracy: [
      "Imprécision — un peu d'avantage perdu.",
      "Ce coup laisse passer une opportunité.",
      "La position reste jouable mais moins favorable.",
    ],
    mistake: [
      "Erreur — l'avantage change de camp.",
      "Ce coup affaiblit significativement la position.",
      "Il fallait voir plus loin ici.",
    ],
    blunder: [
      "Gaffe décisive !",
      "Ce coup change le résultat de la partie.",
      "L'adversaire pouvait exploiter cette erreur immédiatement.",
    ],
  };
  // Commentaires contextuels supplémentaires
  if (turn <= 3 && classification === 'blunder') return "Gaffe dès l'ouverture — très difficile à rattraper.";
  if (moveIndex % 2 === 0 && optimalSeq && optimalSeq[0] === 3 && playedCol !== 3) {
    if (['mistake','blunder'].includes(classification)) return "La colonne centrale était cruciale ici.";
  }
  const list = comments[classification] || comments.good;
  return list[moveIndex % list.length];
}

// ── Classification ─────────────────────────────────────────────────────────────
function classifyMove(playedCol, bestCol, playedScore, bestScore) {
  if (playedCol === bestCol) return 'best';
  const loss = bestScore - playedScore;
  if (loss <= 2)   return 'excellent';
  if (loss <= 8)   return 'good';
  if (loss <= 25)  return 'inaccuracy';
  if (loss <= 80)  return 'mistake';
  return 'blunder';
}

// ── Analyse complète ──────────────────────────────────────────────────────────
self.onmessage = function(e) {
  const { moves } = e.data;
  const board  = makeBoard();
  const results = [];
  const evalHistory = []; // score d'évaluation après chaque coup
  let p1Scores = [], p2Scores = [];

  for (let i = 0; i < moves.length; i++) {
    const player    = (i % 2 === 0) ? 1 : 2;
    const playedCol = moves[i];

    // Analyser AVANT le coup
    const boardBefore = cloneBoard(board);
    const analysis    = bestMove(boardBefore, player);

    let result;
    if (!analysis) {
      result = { moveIndex: i, player, playedCol, bestCol: playedCol, classification: 'best', loss: 0, evalScore: 0, optimalSeq: [] };
    } else {
      const playedScore    = analysis.colScores[playedCol] ?? (analysis.score - 500);
      const classification = classifyMove(playedCol, analysis.col, playedScore, analysis.score);
      const loss           = Math.max(0, analysis.score - playedScore);
      const evalScore      = normalizeScore(analysis.score, player);

      // Séquence optimale si erreur/gaffe/imprécision
      let optimalSeq = [];
      if (['inaccuracy', 'mistake', 'blunder'].includes(classification)) {
        optimalSeq = getOptimalSequence(boardBefore, player, 5);
      }

      const comment = generateComment(classification, player, i, loss, optimalSeq, playedCol);
      result = {
        moveIndex: i,
        player,
        playedCol,
        bestCol:      analysis.col,
        bestScore:    analysis.score,
        playedScore,
        classification,
        loss,
        evalScore,
        optimalSeq,
        comment,
        colScores:    analysis.colScores,
      };
      if (player === 1) p1Scores.push({ classification, loss });
      else              p2Scores.push({ classification, loss });
    }

    results.push(result);

    // Jouer le coup réel
    drop(board, playedCol, player);

    // Score APRÈS le coup (pour le graphique d'évolution)
    const postEval = evaluate(board, 1) - evaluate(board, 2);
    evalHistory.push({ moveIndex: i, player, score: Math.max(-100, Math.min(100, Math.round(postEval / 2))) });

    self.postMessage({ type: 'progress', moveIndex: i, total: moves.length, result });

    if (checkWin(board, player)) break;
  }

  function calcAccuracy(scores) {
    if (scores.length === 0) return 100;
    const weights = { best: 100, excellent: 92, good: 78, inaccuracy: 55, mistake: 25, blunder: 5 };
    const sum = scores.reduce((acc, s) => acc + (weights[s.classification] ?? 50), 0);
    return Math.round(sum / scores.length);
  }

  self.postMessage({
    type: 'done',
    results,
    evalHistory,
    accuracy: { p1: calcAccuracy(p1Scores), p2: calcAccuracy(p2Scores) }
  });
};

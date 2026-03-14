/**
 * analyse-worker.js — Puissance 4, Minimax + Alpha-Beta profondeur 10
 * Score d'évaluation ABSOLU : positif = avantage J1, négatif = avantage J2
 */

const ROWS = 6, COLS = 7;
const DEPTH = 10;
const SEQ_DEPTH = 6;

// ── Utilitaires ───────────────────────────────────────────────────────────────
function makeBoard() { return Array.from({ length: ROWS }, () => new Int8Array(COLS)); }
function cloneBoard(b) { return b.map(r => new Int8Array(r)); }
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
  return [3,2,4,1,5,0,6].filter(c => board[0][c] === 0);
}
function checkWin(board, player) {
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c <= COLS-4; c++)
      if (board[r][c]===player&&board[r][c+1]===player&&board[r][c+2]===player&&board[r][c+3]===player) return true;
  for (let r = 0; r <= ROWS-4; r++)
    for (let c = 0; c < COLS; c++)
      if (board[r][c]===player&&board[r+1][c]===player&&board[r+2][c]===player&&board[r+3][c]===player) return true;
  for (let r = 3; r < ROWS; r++)
    for (let c = 0; c <= COLS-4; c++)
      if (board[r][c]===player&&board[r-1][c+1]===player&&board[r-2][c+2]===player&&board[r-3][c+3]===player) return true;
  for (let r = 0; r <= ROWS-4; r++)
    for (let c = 0; c <= COLS-4; c++)
      if (board[r][c]===player&&board[r+1][c+1]===player&&board[r+2][c+2]===player&&board[r+3][c+3]===player) return true;
  return false;
}
function isFull(board) { return board[0].every(c => c !== 0); }

// ── Évaluation ABSOLUE — positif = avantage J1, négatif = avantage J2 ────────
function scoreWindow(w, p) {
  const o = p === 1 ? 2 : 1;
  const mine = w.filter(c => c === p).length;
  const opp  = w.filter(c => c === o).length;
  const emp  = w.filter(c => c === 0).length;
  if (mine === 4) return  100;
  if (opp  === 4) return -100;
  if (mine === 3 && emp === 1) return  10;
  if (opp  === 3 && emp === 1) return -10;
  if (mine === 2 && emp === 2) return  3;
  if (opp  === 2 && emp === 2) return -3;
  return 0;
}

// evaluate() retourne TOUJOURS du point de vue de J1 (positif = J1 gagne)
function evaluate(board) {
  let score = 0;
  // Bonus colonne centrale pour J1
  const center = board.map(r => r[3]);
  score += center.filter(c => c === 1).length * 6;
  score -= center.filter(c => c === 2).length * 6;

  // Horizontales
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c <= COLS-4; c++) {
      const w = [board[r][c],board[r][c+1],board[r][c+2],board[r][c+3]];
      score += scoreWindow(w, 1);
    }
  // Verticales
  for (let c = 0; c < COLS; c++)
    for (let r = 0; r <= ROWS-4; r++) {
      const w = [board[r][c],board[r+1][c],board[r+2][c],board[r+3][c]];
      score += scoreWindow(w, 1);
    }
  // Diag /
  for (let r = 3; r < ROWS; r++)
    for (let c = 0; c <= COLS-4; c++) {
      const w = [board[r][c],board[r-1][c+1],board[r-2][c+2],board[r-3][c+3]];
      score += scoreWindow(w, 1);
    }
  // Diag \
  for (let r = 0; r <= ROWS-4; r++)
    for (let c = 0; c <= COLS-4; c++) {
      const w = [board[r][c],board[r+1][c+1],board[r+2][c+2],board[r+3][c+3]];
      score += scoreWindow(w, 1);
    }
  return score;
}

// ── Minimax ABSOLU — retourne toujours du point de vue J1 ────────────────────
function minimax(board, depth, alpha, beta, isP1Turn) {
  if (checkWin(board, 1)) return  100000 + depth;
  if (checkWin(board, 2)) return -100000 - depth;
  if (isFull(board) || depth === 0) return evaluate(board);

  const cols = validCols(board);
  if (isP1Turn) {
    let best = -Infinity;
    for (const col of cols) {
      drop(board, col, 1);
      best = Math.max(best, minimax(board, depth-1, alpha, beta, false));
      undrop(board, col);
      alpha = Math.max(alpha, best);
      if (beta <= alpha) break;
    }
    return best;
  } else {
    let best = Infinity;
    for (const col of cols) {
      drop(board, col, 2);
      best = Math.min(best, minimax(board, depth-1, alpha, beta, true));
      undrop(board, col);
      beta = Math.min(beta, best);
      if (beta <= alpha) break;
    }
    return best;
  }
}

// bestMove retourne le meilleur coup + score absolu pour chaque colonne
function bestMove(board, player) {
  const cols = validCols(board);
  if (!cols.length) return null;
  const isP1 = player === 1;
  let bestCol = cols[0];
  let bestScore = isP1 ? -Infinity : Infinity;
  const colScores = {};

  for (const col of cols) {
    drop(board, col, player);
    const score = minimax(board, DEPTH-1, -Infinity, Infinity, !isP1);
    undrop(board, col);
    colScores[col] = score;
    if (isP1 ? score > bestScore : score < bestScore) {
      bestScore = score; bestCol = col;
    }
  }
  return { col: bestCol, score: bestScore, colScores };
}

// ── Séquence optimale ─────────────────────────────────────────────────────────
function getOptimalSequence(board, startPlayer, maxMoves) {
  const seq = [];
  const b = cloneBoard(board);
  let player = startPlayer;
  for (let i = 0; i < maxMoves; i++) {
    const cols = validCols(b);
    if (!cols.length) break;
    const isP1 = player === 1;
    let bestCol = cols[0], bestScore = isP1 ? -Infinity : Infinity;
    for (const col of cols) {
      drop(b, col, player);
      const score = minimax(b, SEQ_DEPTH-1, -Infinity, Infinity, !isP1);
      undrop(b, col);
      if (isP1 ? score > bestScore : score < bestScore) { bestScore = score; bestCol = col; }
    }
    seq.push(bestCol);
    drop(b, bestCol, player);
    if (checkWin(b, player)) break;
    player = player === 1 ? 2 : 1;
  }
  return seq;
}

// ── Normalisation du score absolu → centipawns lisibles ──────────────────────
// Retourne un float ex: +1.24, -0.87, 0.00
// Positif = avantage J1, négatif = avantage J2
function toCentipawns(absScore) {
  if (absScore >= 99000)  return  99.99;
  if (absScore <= -99000) return -99.99;
  return Math.round(absScore) / 100;
}

// Normalise pour la barre [-100, +100]
function toBar(absScore) {
  if (absScore >= 99000)  return  100;
  if (absScore <= -99000) return -100;
  const MAX = 300;
  return Math.max(-100, Math.min(100, Math.round((absScore / MAX) * 100)));
}

// ── Classification ────────────────────────────────────────────────────────────
function classifyMove(player, playedScore, bestScore) {
  // playedScore et bestScore sont ABSOLUS (J1 perspective)
  // Pour J1 : on veut que playedScore soit proche de bestScore (le plus grand)
  // Pour J2 : on veut que playedScore soit proche de bestScore (le plus petit)
  const loss = player === 1
    ? bestScore - playedScore   // J1 : perte = bestScore - playedScore (doit être >= 0)
    : playedScore - bestScore;  // J2 : perte = playedScore - bestScore (doit être >= 0)

  if (loss <= 0)   return 'best';
  if (loss <= 50)  return 'excellent';
  if (loss <= 200) return 'good';
  if (loss <= 500) return 'inaccuracy';
  if (loss <= 2000) return 'mistake';
  return 'blunder';
}

// ── Commentaires ──────────────────────────────────────────────────────────────
function generateComment(cls, moveIndex, optimalSeq, playedCol) {
  const turn = Math.floor(moveIndex / 2) + 1;
  const map = {
    best:       ["Coup parfait !", "Exactement le bon choix.", "L'algorithme aurait joué pareil."],
    excellent:  ["Très bon coup, quasi optimal.", "Solide, pratiquement le meilleur.", "Bonne lecture de la position."],
    good:       ["Bon coup, une légère amélioration était possible.", "Correct, mais il y avait mieux.", "Pas mauvais, l'avantage reste intact."],
    inaccuracy: ["Imprécision — un peu d'avantage perdu.", "Ce coup laisse passer une opportunité.", "La position reste jouable mais moins favorable."],
    mistake:    ["Erreur — l'avantage change de camp.", "Ce coup affaiblit significativement la position.", "Il fallait voir plus loin ici."],
    blunder:    ["Gaffe décisive !", "Ce coup change le résultat de la partie.", "L'adversaire pouvait exploiter cette erreur immédiatement."],
  };
  if (turn <= 3 && cls === 'blunder') return "Gaffe dès l'ouverture — très difficile à rattraper.";
  if (optimalSeq?.[0] === 3 && playedCol !== 3 && ['mistake','blunder'].includes(cls))
    return "La colonne centrale était cruciale ici.";
  return (map[cls] || map.good)[moveIndex % (map[cls]?.length || 1)];
}

// ── Analyse complète ──────────────────────────────────────────────────────────
self.onmessage = function(e) {
  const { moves } = e.data;
  const board = makeBoard();
  const results = [], evalHistory = [];
  let p1Scores = [], p2Scores = [];

  for (let i = 0; i < moves.length; i++) {
    const player    = (i % 2 === 0) ? 1 : 2;
    const playedCol = moves[i];
    const boardBefore = cloneBoard(board);

    const analysis = bestMove(boardBefore, player);

    let result;
    if (!analysis) {
      result = { moveIndex:i, player, playedCol, bestCol:playedCol, classification:'best', loss:0, evalScore:0, evalCP:0, optimalSeq:[], comment:'' };
    } else {
      const playedScore    = analysis.colScores[playedCol] ?? (player === 1 ? analysis.score - 500 : analysis.score + 500);
      const classification = classifyMove(player, playedScore, analysis.score);
      const loss           = Math.abs(analysis.score - playedScore);
      const evalCP         = toCentipawns(analysis.score); // score AVANT le coup
      const evalBar        = toBar(analysis.score);

      let optimalSeq = [];
      if (['inaccuracy','mistake','blunder'].includes(classification))
        optimalSeq = getOptimalSequence(boardBefore, player, 5);

      const comment = generateComment(classification, i, optimalSeq, playedCol);

      result = { moveIndex:i, player, playedCol, bestCol:analysis.col, bestScore:analysis.score, playedScore, classification, loss, evalScore:evalBar, evalCP, optimalSeq, comment };
      if (player === 1) p1Scores.push({ classification, loss });
      else              p2Scores.push({ classification, loss });
    }

    results.push(result);
    drop(board, playedCol, player);

    // Score ABSOLU après le coup joué
    const postScore = checkWin(board, 1) ? 100000
                    : checkWin(board, 2) ? -100000
                    : evaluate(board);
    evalHistory.push({ moveIndex:i, player, score: toBar(postScore), cp: toCentipawns(postScore) });

    self.postMessage({ type:'progress', moveIndex:i, total:moves.length, result });
    if (checkWin(board, player)) break;
  }

  function calcAccuracy(scores) {
    if (!scores.length) return 100;
    const w = { best:100, excellent:92, good:78, inaccuracy:55, mistake:25, blunder:5 };
    return Math.round(scores.reduce((a,s) => a + (w[s.classification] ?? 50), 0) / scores.length);
  }

  self.postMessage({ type:'done', results, evalHistory, accuracy:{ p1:calcAccuracy(p1Scores), p2:calcAccuracy(p2Scores) } });
};

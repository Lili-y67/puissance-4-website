/**
 * analyse-worker.js v3 — Puissance 4, Minimax Alpha-Beta profondeur 10
 * Score ABSOLU : positif = avantage J1, négatif = avantage J2
 */

const ROWS = 6, COLS = 7;
const DEPTH     = 10;
const SEQ_DEPTH = 8;

// ── Plateau ───────────────────────────────────────────────────────────────────
function makeBoard()   { return Array.from({ length: ROWS }, () => new Int8Array(COLS)); }
function cloneBoard(b) { return b.map(r => new Int8Array(r)); }

function drop(board, col, player) {
  for (let r = ROWS - 1; r >= 0; r--)
    if (board[r][col] === 0) { board[r][col] = player; return r; }
  return -1;
}
function undrop(board, col) {
  for (let r = 0; r < ROWS; r++)
    if (board[r][col] !== 0) { board[r][col] = 0; return; }
}
function validCols(board) {
  return [3,2,4,1,5,0,6].filter(c => board[0][c] === 0);
}
function checkWin(board, player) {
  const P = player;
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c <= COLS-4; c++)
      if (board[r][c]===P&&board[r][c+1]===P&&board[r][c+2]===P&&board[r][c+3]===P) return true;
  for (let c = 0; c < COLS; c++)
    for (let r = 0; r <= ROWS-4; r++)
      if (board[r][c]===P&&board[r+1][c]===P&&board[r+2][c]===P&&board[r+3][c]===P) return true;
  for (let r = 3; r < ROWS; r++)
    for (let c = 0; c <= COLS-4; c++)
      if (board[r][c]===P&&board[r-1][c+1]===P&&board[r-2][c+2]===P&&board[r-3][c+3]===P) return true;
  for (let r = 0; r <= ROWS-4; r++)
    for (let c = 0; c <= COLS-4; c++)
      if (board[r][c]===P&&board[r+1][c+1]===P&&board[r+2][c+2]===P&&board[r+3][c+3]===P) return true;
  return false;
}
function isFull(board) { return board[0].every(c => c !== 0); }

// ── Évaluation ────────────────────────────────────────────────────────────────
function scoreWindow(w, p) {
  const o = p === 1 ? 2 : 1;
  const mine = w.filter(c => c === p).length;
  const opp  = w.filter(c => c === o).length;
  const emp  = w.filter(c => c === 0).length;
  if (mine === 4) return  1000;
  if (opp  === 4) return -1000;
  if (mine === 3 && emp === 1) return   50;
  if (opp  === 3 && emp === 1) return  -50;
  if (mine === 2 && emp === 2) return    5;
  if (opp  === 2 && emp === 2) return   -5;
  return 0;
}
function evaluate(board) {
  let score = 0;
  for (let r = 0; r < ROWS; r++) {
    if (board[r][3] === 1) score += 8;  if (board[r][3] === 2) score -= 8;
    if (board[r][2] === 1 || board[r][4] === 1) score += 3;
    if (board[r][2] === 2 || board[r][4] === 2) score -= 3;
  }
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c <= COLS-4; c++)
      score += scoreWindow([board[r][c],board[r][c+1],board[r][c+2],board[r][c+3]], 1);
  for (let c = 0; c < COLS; c++)
    for (let r = 0; r <= ROWS-4; r++)
      score += scoreWindow([board[r][c],board[r+1][c],board[r+2][c],board[r+3][c]], 1);
  for (let r = 3; r < ROWS; r++)
    for (let c = 0; c <= COLS-4; c++)
      score += scoreWindow([board[r][c],board[r-1][c+1],board[r-2][c+2],board[r-3][c+3]], 1);
  for (let r = 0; r <= ROWS-4; r++)
    for (let c = 0; c <= COLS-4; c++)
      score += scoreWindow([board[r][c],board[r+1][c+1],board[r+2][c+2],board[r+3][c+3]], 1);
  return score;
}

// ── Minimax ───────────────────────────────────────────────────────────────────
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

function bestMove(board, player) {
  const cols = validCols(board);
  if (!cols.length) return null;
  const isP1 = player === 1;
  let bestCol = cols[0], bestScore = isP1 ? -Infinity : Infinity;
  const colScores = {};
  for (const col of cols) {
    drop(board, col, player);
    if (checkWin(board, player)) {
      undrop(board, col);
      colScores[col] = isP1 ? 100000 : -100000;
      bestCol = col; bestScore = colScores[col];
      continue;
    }
    const score = minimax(board, DEPTH-1, -Infinity, Infinity, !isP1);
    undrop(board, col);
    colScores[col] = score;
    if (isP1 ? score > bestScore : score < bestScore) { bestScore = score; bestCol = col; }
  }
  return { col: bestCol, score: bestScore, colScores };
}

function getOptimalSequence(board, startPlayer, maxMoves) {
  const seq = [], b = cloneBoard(board);
  let player = startPlayer;
  for (let i = 0; i < maxMoves; i++) {
    const cols = validCols(b);
    if (!cols.length) break;
    const isP1 = player === 1;
    let bestCol = cols[0], bestScore = isP1 ? -Infinity : Infinity;
    for (const col of cols) {
      drop(b, col, player);
      if (checkWin(b, player)) { undrop(b, col); bestCol = col; break; }
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

// ── Normalisation ─────────────────────────────────────────────────────────────
// evalBar : -100 (J2 domine) à +100 (J1 domine), 0 = égal
function toBar(absScore) {
  if (absScore >=  99000) return  100;
  if (absScore <= -99000) return -100;
  const clamped = Math.max(-3000, Math.min(3000, absScore));
  return Math.round((clamped / 3000) * 100);
}
function toCentipawns(absScore) {
  if (absScore >=  99000) return  99.99;
  if (absScore <= -99000) return -99.99;
  const clamped = Math.max(-3000, Math.min(3000, absScore));
  return Math.round(clamped / 30) / 10;
}

// ── Contexte de position ──────────────────────────────────────────────────────
function getPositionContext(board, player) {
  const opp = player === 1 ? 2 : 1;
  const cols = validCols(board);

  // Peut gagner immédiatement ?
  for (const c of cols) {
    drop(board, c, player);
    const w = checkWin(board, player);
    undrop(board, c);
    if (w) return { type: 'win_available', col: c };
  }
  // Doit bloquer victoire adverse ?
  let blockCount = 0;
  for (const c of cols) {
    drop(board, c, opp);
    const w = checkWin(board, opp);
    undrop(board, c);
    if (w) blockCount++;
  }
  if (blockCount > 0) return { type: 'must_block', count: blockCount };

  return { type: 'normal' };
}

// ── Classification ────────────────────────────────────────────────────────────
function classifyMove(player, playedScore, bestScore, availableCols) {
  const only1 = availableCols === 1;

  // Victoire jouée
  if (player === 1 && playedScore >= 99000) return 'best';
  if (player === 2 && playedScore <= -99000) return 'best';

  // Seul coup possible → jamais une gaffe, au pire une inaccuracy si la position est mauvaise
  if (only1) return 'forced';

  // Victoire forcée ratée
  if (player === 1 && bestScore >= 99000 && playedScore < 99000) return 'blunder';
  if (player === 2 && bestScore <= -99000 && playedScore > -99000) return 'blunder';

  const loss = player === 1
    ? (bestScore - playedScore)
    : (playedScore - bestScore);

  if (loss <= 10)   return 'best';
  if (loss <= 60)   return 'excellent';
  if (loss <= 180)  return 'good';
  if (loss <= 450)  return 'inaccuracy';
  if (loss <= 1400) return 'mistake';
  return 'blunder';
}

// ── Précision — méthode basée sur la perte relative ───────────────────────────
// Formule : 103.1668 * exp(-0.04354 * lossPct) - 3.1668 (inspirée de chess.com)
// lossPct = perte en % de l'avantage max possible (3000)
function moveAccuracyScore(cls, loss, forced) {
  if (forced) return 100; // coup forcé = neutre
  if (cls === 'best')      return 100;
  if (cls === 'excellent') return 90 + Math.max(0, 10 - loss / 6);
  if (cls === 'good')      return 75 + Math.max(0, 15 - loss / 12);
  if (cls === 'inaccuracy')return 50 + Math.max(0, 25 - loss / 18);
  if (cls === 'mistake')   return 20 + Math.max(0, 30 - loss / 47);
  return Math.max(0, 15 - loss / 200); // blunder
}

function calcAccuracy(scores) {
  if (!scores.length) return 100;
  const total = scores.reduce((a, s) => a + s.accScore, 0);
  return Math.min(100, Math.round(total / scores.length));
}

// ── Commentaires ──────────────────────────────────────────────────────────────
function generateComment(cls, moveIndex, bestCol, playedCol, loss, context, availableCols) {
  const turn = Math.floor(moveIndex / 2) + 1;
  const hint = (bestCol !== playedCol && cls !== 'forced') ? ` Colonne ${bestCol+1} était meilleure.` : '';

  // Coup forcé
  if (cls === 'forced') return `Seul coup disponible — coup joué automatiquement.`;

  // Contexte spécial
  if (context.type === 'win_available' && cls === 'blunder')
    return `Victoire en main à la col.${context.col+1} — mais raté ! Gaffe décisive.`;
  if (context.type === 'must_block' && context.count > 1 && cls === 'blunder')
    return `Double menace adverse impossible à bloquer — position perdue.`;
  if (context.type === 'must_block' && cls === 'blunder')
    return `Blocage obligatoire ignoré — l'adversaire gagne maintenant.${hint}`;

  switch(cls) {
    case 'best':
      return ['Coup parfait.', "L'IA aurait joué pareil.", 'Exactement le bon choix.'][moveIndex % 3];
    case 'excellent':
      return ['Très bon coup, quasi optimal.', 'Solide — pratiquement le meilleur.', 'Bonne lecture de position.'][moveIndex % 3];
    case 'good':
      return ['Bon coup, légère amélioration possible.', 'Correct mais il y avait mieux.', `Position solide.${hint}`][moveIndex % 3];
    case 'inaccuracy':
      return `Légère imprécision.${hint}`;
    case 'mistake':
      return turn <= 4 ? `Erreur en ouverture — difficile à rattraper.${hint}` : `Erreur — l'avantage bascule.${hint}`;
    case 'blunder':
      return turn <= 3 ? `Gaffe dès l'ouverture !${hint}` : `Gaffe décisive.${hint}`;
    default: return '';
  }
}

// ── Analyse principale ────────────────────────────────────────────────────────
self.onmessage = function(e) {
  const { moves } = e.data;
  const board = makeBoard();
  const results = [], evalHistory = [];
  let p1Scores = [], p2Scores = [];

  for (let i = 0; i < moves.length; i++) {
    const player    = (i % 2 === 0) ? 1 : 2;
    const playedCol = moves[i];
    const boardBefore = cloneBoard(board);
    const cols = validCols(board);
    const analysis = bestMove(boardBefore, player);
    const context  = getPositionContext(boardBefore, player);

    let result;
    if (!analysis || cols.length === 0) {
      result = { moveIndex:i, player, playedCol, bestCol:playedCol, classification:'forced',
        loss:0, evalScore:0, evalCP:0, optimalSeq:[], comment:'Seul coup possible.', forced:true };
    } else {
      const bestScore   = analysis.score;
      const bestCol     = analysis.col;
      const playedScore = analysis.colScores.hasOwnProperty(playedCol)
        ? analysis.colScores[playedCol]
        : (() => {
            drop(board, playedCol, player);
            const s = checkWin(board, player)
              ? (player === 1 ? 100000 : -100000)
              : minimax(board, DEPTH-2, -Infinity, Infinity, player !== 1);
            undrop(board, playedCol);
            return s;
          })();

      const classification = classifyMove(player, playedScore, bestScore, cols.length);
      const forced = classification === 'forced';
      const loss   = Math.abs(bestScore - playedScore);
      const accScore = moveAccuracyScore(classification, loss, forced);

      // Score APRÈS le coup joué
      drop(board, playedCol, player);
      const postScore = checkWin(board, player)
        ? (player === 1 ? 100000 : -100000)
        : (isFull(board) ? 0 : evaluate(board));
      undrop(board, playedCol);

      const evalCP  = toCentipawns(postScore);
      const evalBar = toBar(postScore);

      // Séquence optimale pour les erreurs
      let optimalSeq = [];
      if (['inaccuracy','mistake','blunder'].includes(classification))
        optimalSeq = getOptimalSequence(boardBefore, player, 6);

      const comment = generateComment(classification, i, bestCol, playedCol, loss, context, cols.length);

      result = { moveIndex:i, player, playedCol, bestCol, bestScore, playedScore,
        classification, forced, loss, accScore, evalScore:evalBar, evalCP, optimalSeq, comment, context };

      if (player === 1) p1Scores.push({ classification, loss, accScore });
      else              p2Scores.push({ classification, loss, accScore });
    }

    results.push(result);
    drop(board, playedCol, player);

    const postScore2 = checkWin(board, player)
      ? (player === 1 ? 100000 : -100000)
      : (isFull(board) ? 0 : evaluate(board));
    evalHistory.push({ moveIndex:i, player, score:toBar(postScore2), cp:toCentipawns(postScore2) });

    self.postMessage({ type:'progress', moveIndex:i, total:moves.length, result });
    if (checkWin(board, player)) break;
  }

  self.postMessage({
    type: 'done', results, evalHistory,
    accuracy: { p1: calcAccuracy(p1Scores), p2: calcAccuracy(p2Scores) }
  });
};

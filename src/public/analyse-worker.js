/**
 * analyse-worker.js v3 - Puissance 4, Minimax Alpha-Beta profondeur 10
 * Score ABSOLU : positif = avantage J1, negatif = avantage J2
 */

const ROWS = 6, COLS = 7;
const DEPTH     = 10;
const SEQ_DEPTH = 8;
const WIN_SCORE = 100000;

//  Plateau 
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

//  Evaluation 
function scoreWindow(w, p) {
  const o = p === 1 ? 2 : 1;
  const mine = w.filter(c => c === p).length;
  const opp  = w.filter(c => c === o).length;
  const emp  = w.filter(c => c === 0).length;
  if (mine === 4) return  20000;
  if (opp  === 4) return -20000;
  if (mine === 3 && emp === 1) return   240;
  if (opp  === 3 && emp === 1) return  -260;
  if (mine === 2 && emp === 2) return    28;
  if (opp  === 2 && emp === 2) return   -32;
  if (mine === 1 && emp === 3) return     3;
  if (opp  === 1 && emp === 3) return    -4;
  return 0;
}

function countImmediateWins(board, player) {
  let count = 0;
  for (const col of validCols(board)) {
    drop(board, col, player);
    const win = checkWin(board, player);
    undrop(board, col);
    if (win) count++;
  }
  return count;
}

function evaluate(board) {
  let score = 0;
  const centerWeights = [3, 4, 5, 7, 5, 4, 3];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (board[r][c] === 1) score += centerWeights[c];
      if (board[r][c] === 2) score -= centerWeights[c];
    }
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
  const p1Wins = countImmediateWins(board, 1);
  const p2Wins = countImmediateWins(board, 2);
  score += p1Wins * 420;
  score -= p2Wins * 460;
  if (p1Wins >= 2) score += 1200;
  if (p2Wins >= 2) score -= 1400;
  return score;
}

//  Minimax 
function minimax(board, depth, alpha, beta, isP1Turn) {
  if (checkWin(board, 1)) return  WIN_SCORE + depth;
  if (checkWin(board, 2)) return -WIN_SCORE - depth;
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
      colScores[col] = isP1 ? WIN_SCORE : -WIN_SCORE;
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

//  Normalisation 
// evalBar : -100 (J2 domine) a +100 (J1 domine), 0 = egal
function scoreToWinPct(absScore) {
  if (absScore >=  99000) return 100;
  if (absScore <= -99000) return 0;
  const clamped = Math.max(-5000, Math.min(5000, absScore));
  const normalized = Math.tanh(clamped / 1100);
  return Math.max(0, Math.min(100, Math.round(((normalized + 1) / 2) * 100)));
}
function toBar(absScore) {
  if (absScore >=  99000) return  100;
  if (absScore <= -99000) return -100;
  return Math.round((scoreToWinPct(absScore) - 50) * 2);
}
function toCentipawns(absScore) {
  if (absScore >=  99000) return  99.99;
  if (absScore <= -99000) return -99.99;
  const clamped = Math.max(-5000, Math.min(5000, absScore));
  return Math.round(clamped / 50) / 10;
}

//  Contexte de position 
function getPositionContext(board, player) {
  const opp = player === 1 ? 2 : 1;
  const cols = validCols(board);

  // Peut gagner immediatement ?
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

//  Classification 
function classifyMove(player, playedScore, bestScore, availableCols, context, playedState = {}) {
  const only1 = availableCols === 1;

  // Victoire jouee
  if (player === 1 && playedScore >= 99000) return 'best';
  if (player === 2 && playedScore <= -99000) return 'best';

  // Seul coup possible  jamais une gaffe, au pire une inaccuracy si la position est mauvaise
  if (only1) return 'forced';

  // Victoire forcee ratee
  if (player === 1 && bestScore >= 99000 && playedScore < 99000) return 'blunder';
  if (player === 2 && bestScore <= -99000 && playedScore > -99000) return 'blunder';

  const loss = player === 1
    ? (bestScore - playedScore)
    : (playedScore - bestScore);
  const bestPct = player === 1 ? scoreToWinPct(bestScore) : 100 - scoreToWinPct(bestScore);
  const playedPct = player === 1 ? scoreToWinPct(playedScore) : 100 - scoreToWinPct(playedScore);
  const swing = Math.max(0, bestPct - playedPct);
  const oppImmediateWins = playedState.oppImmediateWins || 0;
  const bestAllowsOppImmediateWins = playedState.bestAllowsOppImmediateWins || 0;

  if (oppImmediateWins > bestAllowsOppImmediateWins) {
    if (oppImmediateWins >= 2) return 'blunder';
    if (swing >= 20) return 'blunder';
    return 'mistake';
  }

  if (context.type === 'must_block' && swing >= 40) return 'blunder';
  if (context.type === 'win_available' && swing >= 30) return 'blunder';
  if (swing >= 48) return 'blunder';
  if (swing >= 30) return 'mistake';

  if (loss <= 8 && swing <= 1)   return 'best';
  if (loss <= 45 && swing <= 4)  return 'excellent';
  if (loss <= 140 && swing <= 10) return 'good';
  if (loss <= 320 && swing <= 18) return 'inaccuracy';
  if (loss <= 900 && swing <= 34) return 'mistake';
  return 'blunder';
}

//  Precision - methode basee sur la perte relative 
// Formule : 103.1668 * exp(-0.04354 * lossPct) - 3.1668 (inspiree de chess.com)
// lossPct = perte en % de l'avantage max possible (3000)
function moveAccuracyScore(cls, loss, forced, swing = 0) {
  if (forced) return 100; // coup force = neutre
  if (cls === 'best')      return 100;
  if (cls === 'excellent') return Math.max(92, 99 - swing);
  if (cls === 'good')      return Math.max(78, 90 - swing * 1.2);
  if (cls === 'inaccuracy')return Math.max(55, 78 - swing * 1.5);
  if (cls === 'mistake')   return Math.max(22, 54 - swing * 1.1);
  return Math.max(0, 18 - swing * 0.6 - loss / 250); // blunder
}

function calcAccuracy(scores) {
  if (!scores.length) return 100;
  const total = scores.reduce((a, s) => a + s.accScore, 0);
  return Math.min(100, Math.round(total / scores.length));
}

//  Commentaires 
function generateComment(cls, moveIndex, bestCol, playedCol, loss, context, availableCols, swing) {
  const turn = Math.floor(moveIndex / 2) + 1;
  const hint = (bestCol !== playedCol && cls !== 'forced') ? ` Colonne ${bestCol+1} etait meilleure.` : '';

  // Coup force
  if (cls === 'forced') return `Seul coup disponible - coup joue automatiquement.`;

  // Contexte special
  if (context.type === 'win_available' && cls === 'blunder')
    return `Victoire en main a la col.${context.col+1} - mais rate ! Gaffe decisive.`;
  if (context.type === 'must_block' && context.count > 1 && cls === 'blunder')
    return `Double menace adverse impossible a bloquer - position perdue.`;
  if (context.type === 'must_block' && cls === 'blunder')
    return `Blocage obligatoire ignore - l'adversaire gagne maintenant.${hint}`;

  switch(cls) {
    case 'best':
      return ['Coup parfait.', "L'IA aurait joue pareil.", 'Exactement le bon choix.'][moveIndex % 3];
    case 'excellent':
      return ['Tres bon coup, quasi optimal.', 'Solide - pratiquement le meilleur.', 'Bonne lecture de position.'][moveIndex % 3];
    case 'good':
      return ['Bon coup, legere amelioration possible.', 'Correct mais il y avait mieux.', `Position solide.${hint}`][moveIndex % 3];
    case 'inaccuracy':
      return `Legere imprecision, la position glisse de ${swing}% environ.${hint}`;
    case 'mistake':
      return turn <= 4 ? `Erreur en ouverture - difficile a rattraper.${hint}` : `Erreur nette, l'avantage chute de ${swing}% environ.${hint}`;
    case 'blunder':
      return turn <= 3 ? `Gaffe des l'ouverture !${hint}` : `Gaffe decisive, la position s'effondre de ${swing}% environ.${hint}`;
    default: return '';
  }
}

function generateCommentV2(cls, moveIndex, bestCol, playedCol, loss, context, availableCols, swing) {
  const turn = Math.floor(moveIndex / 2) + 1;
  const hint = (bestCol !== playedCol && cls !== 'forced') ? ` Colonne ${bestCol+1} Atait meilleure.` : '';

  if (cls === 'forced') return `Seul coup disponible a" coup jouA automatiquement.`;
  if (context.type === 'win_available' && cls === 'blunder')
    return `Victoire en main A  la col.${context.col+1} a" mais ratA ! Gaffe dAcisive.`;
  if (context.type === 'must_block' && context.count > 1 && cls === 'blunder')
    return `Double menace adverse impossible A  bloquer a" position perdue.`;
  if (context.type === 'must_block' && cls === 'blunder')
    return `Blocage obligatoire ignorA a" l'adversaire gagne maintenant.${hint}`;

  switch(cls) {
    case 'best':
      return ['Coup parfait.', "L'IA aurait jouA pareil.", 'Exactement le bon choix.'][moveIndex % 3];
    case 'excellent':
      return ['TrAs bon coup, quasi optimal.', 'Solide a" pratiquement le meilleur.', 'Bonne lecture de position.'][moveIndex % 3];
    case 'good':
      return ['Bon coup, lAgAre amAlioration possible.', 'Correct mais il y avait mieux.', `Position solide.${hint}`][moveIndex % 3];
    case 'inaccuracy':
      return `LAgAre imprAcision, tu perds environ ${swing}% de chances.${hint}`;
    case 'mistake':
      return turn <= 4 ? `Erreur en ouverture a" difficile A  rattraper.${hint}` : `Erreur nette, tu perds environ ${swing}% de chances.${hint}`;
    case 'blunder':
      return turn <= 3 ? `Gaffe dAs l'ouverture !${hint}` : `Gaffe dAcisive, tu abandonnes environ ${swing}% de chances.${hint}`;
    default:
      return '';
  }
}

//  Analyse principale 
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

      const bestWinPct = player === 1 ? scoreToWinPct(bestScore) : 100 - scoreToWinPct(bestScore);
      const playedWinPct = player === 1 ? scoreToWinPct(playedScore) : 100 - scoreToWinPct(playedScore);
      const swing = Math.max(0, bestWinPct - playedWinPct);

      drop(boardBefore, playedCol, player);
      const oppImmediateWins = countImmediateWins(boardBefore, player === 1 ? 2 : 1);
      undrop(boardBefore, playedCol);

      let bestAllowsOppImmediateWins = oppImmediateWins;
      if (bestCol !== undefined && bestCol !== null) {
        drop(boardBefore, bestCol, player);
        bestAllowsOppImmediateWins = countImmediateWins(boardBefore, player === 1 ? 2 : 1);
        undrop(boardBefore, bestCol);
      }

      const classification = classifyMove(player, playedScore, bestScore, cols.length, context, {
        oppImmediateWins,
        bestAllowsOppImmediateWins,
      });
      const forced = classification === 'forced';
      const loss   = Math.abs(bestScore - playedScore);
      const accScore = moveAccuracyScore(classification, loss, forced, swing);

      // Score APRES le coup joue
      drop(board, playedCol, player);
      const postScore = checkWin(board, player)
        ? (player === 1 ? 100000 : -100000)
        : (isFull(board) ? 0 : evaluate(board));
      undrop(board, playedCol);

      const evalCP  = toCentipawns(postScore);
      const evalBar = toBar(postScore);

      // Sequence optimale pour les erreurs
      let optimalSeq = [];
      if (['inaccuracy','mistake','blunder'].includes(classification))
        optimalSeq = getOptimalSequence(boardBefore, player, 6);

      const comment = generateCommentV2(classification, i, bestCol, playedCol, loss, context, cols.length, swing);

      result = { moveIndex:i, player, playedCol, bestCol, bestScore, playedScore,
        classification, forced, loss, accScore, evalScore:evalBar, evalCP, optimalSeq, comment, context,
        bestWinPct, playedWinPct, swing };

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

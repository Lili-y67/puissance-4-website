/**
 * analyse-worker.js v3 - Puissance 4, Minimax Alpha-Beta profondeur 10
 * Score ABSOLU : positif = avantage J1, negatif = avantage J2
 */

const ROWS = 6, COLS = 7;
const DEFAULT_DEPTH = 10;
const DEFAULT_SEQ_DEPTH = 8;
const WIN_SCORE = 100000;
let ACTIVE_DEPTH = DEFAULT_DEPTH;
let ACTIVE_SEQ_DEPTH = DEFAULT_SEQ_DEPTH;
let TT = new Map();
let NODE_COUNT = 0;

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
function boardKey(board, turn, depth) {
  return `${turn}|${depth}|${board.map(row => Array.from(row).join('')).join('')}`;
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

function orderedCols(board, player) {
  const cols = validCols(board);
  const opp = player === 1 ? 2 : 1;
  return cols.map(col => {
    drop(board, col, player);
    const win = checkWin(board, player);
    const oppWins = win ? 0 : countImmediateWins(board, opp);
    const forks = win ? 0 : countImmediateWins(board, player);
    undrop(board, col);
    const centerBonus = 7 - Math.abs(3 - col);
    return { col, score: (win ? 10000 : 0) + forks * 900 - oppWins * 1200 + centerBonus };
  }).sort((a, b) => b.score - a.score).map(entry => entry.col);
}

function evaluate(board) {
  let score = 0;
  const centerWeights = [6, 9, 13, 18, 13, 9, 6];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const stability = (ROWS - r) * 2;
      if (board[r][c] === 1) score += centerWeights[c] + stability;
      if (board[r][c] === 2) score -= centerWeights[c] + stability;
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
  score += p1Wins * 900;
  score -= p2Wins * 950;
  if (p1Wins >= 2) score += 3500;
  if (p2Wins >= 2) score -= 3700;
  return score;
}

//  Minimax 
function minimax(board, depth, alpha, beta, isP1Turn) {
  NODE_COUNT++;
  if (checkWin(board, 1)) return  WIN_SCORE + depth;
  if (checkWin(board, 2)) return -WIN_SCORE - depth;
  if (isFull(board) || depth === 0) return evaluate(board);
  const turn = isP1Turn ? 1 : 2;
  const key = boardKey(board, turn, depth);
  const cached = TT.get(key);
  if (cached !== undefined) return cached;
  const cols = orderedCols(board, turn);
  let exact = true;
  if (isP1Turn) {
    let best = -Infinity;
    for (const col of cols) {
      drop(board, col, 1);
      best = Math.max(best, minimax(board, depth-1, alpha, beta, false));
      undrop(board, col);
      alpha = Math.max(alpha, best);
      if (beta <= alpha) { exact = false; break; }
    }
    if (exact && TT.size < 120000) TT.set(key, best);
    return best;
  } else {
    let best = Infinity;
    for (const col of cols) {
      drop(board, col, 2);
      best = Math.min(best, minimax(board, depth-1, alpha, beta, true));
      undrop(board, col);
      beta = Math.min(beta, best);
      if (beta <= alpha) { exact = false; break; }
    }
    if (exact && TT.size < 120000) TT.set(key, best);
    return best;
  }
}

function evalForMove(board, col, player, depth = ACTIVE_DEPTH) {
  const isP1 = player === 1;
  drop(board, col, player);
  if (checkWin(board, player)) {
    undrop(board, col);
    return isP1 ? WIN_SCORE : -WIN_SCORE;
  }
  const score = minimax(board, Math.max(0, depth - 1), -Infinity, Infinity, !isP1);
  undrop(board, col);
  return score;
}

function scoreFromPlayerPerspective(absScore, player) {
  return player === 1 ? absScore : -absScore;
}

function scoreToDisplayEval(absScore) {
  if (absScore >= 99000) return '+mat';
  if (absScore <= -99000) return '-mat';
  const cp = toCentipawns(absScore);
  return `${cp > 0 ? '+' : cp < 0 ? '-' : ''}${Math.abs(cp).toFixed(1)}`;
}

function bestMove(board, player, depth = ACTIVE_DEPTH, variantCount = 3) {
  const cols = orderedCols(board, player);
  if (!cols.length) return null;
  const isP1 = player === 1;
  let bestCol = cols[0], bestScore = isP1 ? -Infinity : Infinity;
  const colScores = {};
  for (const col of cols) {
    const score = evalForMove(board, col, player, depth);
    colScores[col] = score;
    if (isP1 ? score > bestScore : score < bestScore) { bestScore = score; bestCol = col; }
  }
  const variants = Object.entries(colScores)
    .map(([col, score]) => ({
      col: Number(col),
      score,
      eval: scoreToDisplayEval(score),
      playerScore: scoreFromPlayerPerspective(score, player),
      winPct: player === 1 ? scoreToWinPct(score) : 100 - scoreToWinPct(score),
    }))
    .sort((a, b) => b.playerScore - a.playerScore)
    .slice(0, Math.max(1, variantCount || 3));
  return { col: bestCol, score: bestScore, colScores, variants };
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
      const score = minimax(b, ACTIVE_SEQ_DEPTH-1, -Infinity, Infinity, !isP1);
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
  const playedAllowsDoubleThreat = oppImmediateWins >= 2 && bestAllowsOppImmediateWins < 2;

  if (oppImmediateWins > bestAllowsOppImmediateWins) {
    if (playedAllowsDoubleThreat) return 'blunder';
    if (oppImmediateWins >= 2) return 'blunder';
    if (swing >= 18) return 'blunder';
    return 'mistake';
  }

  if (context.type === 'must_block' && swing >= 28) return 'blunder';
  if (context.type === 'win_available' && swing >= 20) return 'blunder';
  if (swing >= 42) return 'blunder';
  if (swing >= 24) return 'mistake';

  if (swing <= 1.2 && loss <= 25) return 'best';
  if (swing <= 3.5 && loss <= 85) return 'excellent';
  if (swing <= 8) return 'good';
  if (swing <= 15) return 'inaccuracy';
  if (swing <= 28) return 'mistake';
  return 'blunder';
}

function clampAccuracy(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 100;
}

// Precision basee sur la perte de chances, plus stable que le score brut.
function moveAccuracyScore(cls, loss, forced, swing = 0) {
  if (forced) return 100;
  if (cls === 'best') return 100;
  const lossPenalty = Math.min(18, Math.log10(Math.max(1, Number(loss || 0))) * 4.2);
  const chanceAccuracy = 100 * Math.exp(-Math.pow(Math.max(0, swing) / 18, 1.35));
  const classFloor = {
    excellent: 91,
    good: 76,
    inaccuracy: 54,
    mistake: 24,
    blunder: 0,
  }[cls] ?? 0;
  const classCeil = {
    excellent: 99,
    good: 91,
    inaccuracy: 79,
    mistake: 58,
    blunder: 35,
  }[cls] ?? 100;
  return clampAccuracy(Math.max(classFloor, Math.min(classCeil, chanceAccuracy - lossPenalty)));
}

function calcAccuracy(scores) {
  if (!scores.length) return 100;
  const total = scores.reduce((a, s) => a + s.accScore, 0);
  const value = Number(total / scores.length);
  return Number.isFinite(value) ? Math.max(0, Math.min(100, Math.round(value))) : 100;
}

function currentAbsScore(board) {
  if (checkWin(board, 1)) return WIN_SCORE;
  if (checkWin(board, 2)) return -WIN_SCORE;
  if (isFull(board)) return 0;
  return evaluate(board);
}

function analyzePosition(boardInput, player, depth = DEFAULT_DEPTH, variantCount = 3) {
  ACTIVE_DEPTH = Math.max(1, Math.min(14, Number(depth || DEFAULT_DEPTH)));
  ACTIVE_SEQ_DEPTH = Math.max(1, Math.min(10, ACTIVE_DEPTH - 1));
  TT = new Map();
  NODE_COUNT = 0;
  const board = boardInput.map(row => Int8Array.from(row));
  const currentScore = currentAbsScore(board);
  const analysis = bestMove(board, player, ACTIVE_DEPTH, variantCount);
  const p1WinPct = scoreToWinPct(currentScore);
  return {
    player,
    depth: ACTIVE_DEPTH,
    current: {
      score: currentScore,
      eval: scoreToDisplayEval(currentScore),
      bar: toBar(currentScore),
      p1WinPct,
      p2WinPct: 100 - p1WinPct,
    },
    bestCol: analysis?.col ?? null,
    variants: analysis?.variants || [],
    meta: { nodes: NODE_COUNT, tableSize: TT.size },
  };
}

// Version nettoyee pour eviter les anciens textes mal encodes dans le rendu replay.
function generateCommentV2(cls, moveIndex, bestCol, playedCol, loss, context, availableCols, swing) {
  const turn = Math.floor(moveIndex / 2) + 1;
  const hint = (bestCol !== playedCol && cls !== 'forced') ? ` Colonne ${bestCol + 1} etait meilleure.` : '';

  if (cls === 'forced') return 'Seul coup disponible, coup joue automatiquement.';
  if (context.type === 'win_available' && cls === 'blunder') {
    return `Victoire en main a la col.${context.col + 1}, mais ratee. Gaffe decisive.`;
  }
  if (context.type === 'must_block' && context.count > 1 && cls === 'blunder') {
    return 'Double menace adverse impossible a bloquer, position perdue.';
  }
  if (context.type === 'must_block' && cls === 'blunder') {
    return `Blocage obligatoire ignore, l'adversaire gagne maintenant.${hint}`;
  }

  switch (cls) {
    case 'best':
      return ['Coup parfait.', "L'IA aurait joue pareil.", 'Exactement le bon choix.'][moveIndex % 3];
    case 'excellent':
      return ['Tres bon coup, quasi optimal.', 'Solide, pratiquement le meilleur.', 'Bonne lecture de position.'][moveIndex % 3];
    case 'good':
      return ['Bon coup, legere amelioration possible.', 'Correct mais il y avait mieux.', `Position solide.${hint}`][moveIndex % 3];
    case 'inaccuracy':
      return `Legere imprecision, tu perds environ ${swing}% de chances.${hint}`;
    case 'mistake':
      return turn <= 4 ? `Erreur en ouverture, difficile a rattraper.${hint}` : `Erreur nette, tu perds environ ${swing}% de chances.${hint}`;
    case 'blunder':
      return turn <= 3 ? `Gaffe des l'ouverture !${hint}` : `Gaffe decisive, tu abandonnes environ ${swing}% de chances.${hint}`;
    default:
      return '';
  }
}

//  Analyse principale 
self.onmessage = function(e) {
  const { moves, depth = DEFAULT_DEPTH, variantCount = 3, mode, board: boardInput, player: positionPlayer } = e.data;
  ACTIVE_DEPTH = Math.max(1, Math.min(14, Number(depth || DEFAULT_DEPTH)));
  ACTIVE_SEQ_DEPTH = Math.max(1, Math.min(10, ACTIVE_DEPTH - 1));
  TT = new Map();
  NODE_COUNT = 0;
  if (mode === 'position') {
    self.postMessage({ type: 'position', analysis: analyzePosition(boardInput || makeBoard(), Number(positionPlayer || 1), ACTIVE_DEPTH, variantCount) });
    return;
  }
  const board = makeBoard();
  const results = [], evalHistory = [];
  let p1Scores = [], p2Scores = [];

  for (let i = 0; i < moves.length; i++) {
    const player    = (i % 2 === 0) ? 1 : 2;
    const playedCol = moves[i];
    const boardBefore = cloneBoard(board);
    const cols = validCols(board);
    const analysis = bestMove(boardBefore, player, ACTIVE_DEPTH, variantCount);
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
              : minimax(board, Math.max(0, ACTIVE_DEPTH-2), -Infinity, Infinity, player !== 1);
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
      const postScore = currentAbsScore(board);
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
        bestWinPct, playedWinPct, swing, variants: analysis.variants || [], depth: ACTIVE_DEPTH };

      if (player === 1) p1Scores.push({ classification, loss, accScore });
      else              p2Scores.push({ classification, loss, accScore });
    }

    results.push(result);
    drop(board, playedCol, player);

    const postScore2 = currentAbsScore(board);
    evalHistory.push({ moveIndex:i, player, score:toBar(postScore2), cp:toCentipawns(postScore2) });

    self.postMessage({ type:'progress', moveIndex:i, total:moves.length, result });
    if (checkWin(board, player)) break;
  }

  self.postMessage({
    type: 'done', results, evalHistory,
    accuracy: { p1: calcAccuracy(p1Scores), p2: calcAccuracy(p2Scores) },
    meta: { depth: ACTIVE_DEPTH, variantCount, nodes: NODE_COUNT, tableSize: TT.size }
  });
};

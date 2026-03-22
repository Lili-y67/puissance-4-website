/**
 * analyse-worker.js — Puissance 4, Minimax Alpha-Beta profondeur 10
 * Score ABSOLU : positif = avantage J1, négatif = avantage J2
 */

const ROWS = 6, COLS = 7;
const DEPTH = 10;      // profondeur analyse principale
const SEQ_DEPTH = 8;   // profondeur séquence optimale

// ── Utilitaires plateau ───────────────────────────────────────────────────────
function makeBoard() { return Array.from({ length: ROWS }, () => new Int8Array(COLS)); }
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

// ── Évaluation heuristique ────────────────────────────────────────────────────
function scoreWindow(w, p) {
  const o = p === 1 ? 2 : 1;
  const mine = w.filter(c => c === p).length;
  const opp  = w.filter(c => c === o).length;
  const emp  = w.filter(c => c === 0).length;
  if (mine === 4)              return  1000;
  if (opp  === 4)              return -1000;
  if (mine === 3 && emp === 1) return   50;
  if (opp  === 3 && emp === 1) return  -50;
  if (mine === 2 && emp === 2) return    5;
  if (opp  === 2 && emp === 2) return   -5;
  return 0;
}

function evaluate(board) {
  let score = 0;
  // Préférence colonne centrale
  for (let r = 0; r < ROWS; r++) {
    if (board[r][3] === 1) score += 8;
    if (board[r][3] === 2) score -= 8;
    if (board[r][2] === 1 || board[r][4] === 1) score += 3;
    if (board[r][2] === 2 || board[r][4] === 2) score -= 3;
  }
  // Fenêtres horizontales
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c <= COLS-4; c++)
      score += scoreWindow([board[r][c],board[r][c+1],board[r][c+2],board[r][c+3]], 1);
  // Verticales
  for (let c = 0; c < COLS; c++)
    for (let r = 0; r <= ROWS-4; r++)
      score += scoreWindow([board[r][c],board[r+1][c],board[r+2][c],board[r+3][c]], 1);
  // Diagonales /
  for (let r = 3; r < ROWS; r++)
    for (let c = 0; c <= COLS-4; c++)
      score += scoreWindow([board[r][c],board[r-1][c+1],board[r-2][c+2],board[r-3][c+3]], 1);
  // Diagonales \
  for (let r = 0; r <= ROWS-4; r++)
    for (let c = 0; c <= COLS-4; c++)
      score += scoreWindow([board[r][c],board[r+1][c+1],board[r+2][c+2],board[r+3][c+3]], 1);
  return score;
}

// ── Minimax Alpha-Beta ────────────────────────────────────────────────────────
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

// Retourne le meilleur coup + tous les scores par colonne
function bestMove(board, player) {
  const cols = validCols(board);
  if (!cols.length) return null;
  const isP1 = player === 1;
  let bestCol = cols[0];
  let bestScore = isP1 ? -Infinity : Infinity;
  const colScores = {};
  for (const col of cols) {
    drop(board, col, player);
    // Vérifier victoire immédiate
    if (checkWin(board, player)) {
      undrop(board, col);
      colScores[col] = isP1 ? 100000 : -100000;
      bestCol = col;
      bestScore = colScores[col];
      continue;
    }
    const score = minimax(board, DEPTH-1, -Infinity, Infinity, !isP1);
    undrop(board, col);
    colScores[col] = score;
    if (isP1 ? score > bestScore : score < bestScore) {
      bestScore = score; bestCol = col;
    }
  }
  return { col: bestCol, score: bestScore, colScores };
}

// Séquence de jeu optimal depuis une position
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
      if (checkWin(b, player)) {
        undrop(b, col);
        bestCol = col;
        bestScore = isP1 ? 100000 : -100000;
        break;
      }
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

// ── Normalisation score → centipawns ─────────────────────────────────────────
// On mappe les scores heuristiques [-5000, +5000] vers [-10, +10]
// Les victoires forcées > 99000 → ±99.99
function toCentipawns(absScore) {
  if (absScore >=  99000) return  99.99;
  if (absScore <= -99000) return -99.99;
  // Score heuristique max réaliste ≈ ±3000
  const clamped = Math.max(-3000, Math.min(3000, absScore));
  return Math.round(clamped / 30) / 10; // ex: 300 → +1.0, -600 → -2.0
}

function toBar(absScore) {
  if (absScore >=  99000) return  100;
  if (absScore <= -99000) return -100;
  const clamped = Math.max(-3000, Math.min(3000, absScore));
  return Math.round((clamped / 3000) * 100);
}

// ── Classification du coup joué ───────────────────────────────────────────────
// On compare le score APRÈS le coup joué vs le score APRÈS le meilleur coup
// "loss" = combien d'avantage perdu relativement au meilleur coup disponible
function classifyMove(player, playedScore, bestScore) {
  // Cas victoire immédiate jouée
  if (player === 1 && playedScore >= 99000) return 'best';
  if (player === 2 && playedScore <= -99000) return 'best';

  // Cas où le meilleur coup était une victoire forcée mais pas joué
  if (player === 1 && bestScore >= 99000 && playedScore < 99000) return 'blunder';
  if (player === 2 && bestScore <= -99000 && playedScore > -99000) return 'blunder';

  // Perte d'avantage = différence entre meilleur et joué, du point de vue du joueur
  const loss = player === 1
    ? (bestScore - playedScore)    // J1 veut maximiser
    : (playedScore - bestScore);   // J2 veut minimiser (score J1 perspective)

  // Seuils calibrés sur l'échelle heuristique (max ~3000)
  if (loss <= 10)   return 'best';
  if (loss <= 50)   return 'excellent';
  if (loss <= 150)  return 'good';
  if (loss <= 400)  return 'inaccuracy';
  if (loss <= 1200) return 'mistake';
  return 'blunder';
}

// ── Précision ─────────────────────────────────────────────────────────────────
// Méthode : moyenne pondérée avec pénalité progressive selon la gravité
function calcAccuracy(scores) {
  if (!scores.length) return 100;
  const weights = { best:100, excellent:88, good:70, inaccuracy:45, mistake:15, blunder:0 };
  const total = scores.reduce((a, s) => a + (weights[s.classification] ?? 50), 0);
  return Math.round(total / scores.length);
}

// ── Commentaires ──────────────────────────────────────────────────────────────
function generateComment(cls, moveIndex, bestCol, playedCol, loss) {
  const turn = Math.floor(moveIndex / 2) + 1;
  const col = ['G','F','E','Centre','D','C','B','A','G'][bestCol] || `col.${bestCol+1}`;

  if (cls === 'best')       return ["Coup parfait.", "Exactement le bon choix.", "L'IA aurait joué pareil."][moveIndex % 3];
  if (cls === 'excellent')  return ["Très bon coup, quasi optimal.", "Solide — pratiquement le meilleur.", "Bonne lecture de position."][moveIndex % 3];
  if (cls === 'good')       return ["Bon coup, une légère amélioration était possible.", "Correct mais il y avait mieux.", "Position préservée, l'optimum était ailleurs."][moveIndex % 3];

  const hint = bestCol !== playedCol ? ` Le meilleur était la colonne ${bestCol+1}.` : '';

  if (cls === 'inaccuracy') return `Légère imprécision — un peu d'avantage perdu.${hint}`;
  if (cls === 'mistake') {
    if (turn <= 4) return `Erreur en ouverture — difficile à rattraper.${hint}`;
    return `Erreur — l'avantage bascule.${hint}`;
  }
  if (cls === 'blunder') {
    if (turn <= 3) return `Gaffe dès l'ouverture !${hint}`;
    return `Gaffe décisive — le résultat change.${hint}`;
  }
  return '';
}

// ── Analyse complète ──────────────────────────────────────────────────────────
self.onmessage = function(e) {
  const { moves } = e.data;
  const board = makeBoard();
  const results = [];
  const evalHistory = [];
  let p1Scores = [], p2Scores = [];

  for (let i = 0; i < moves.length; i++) {
    const player    = (i % 2 === 0) ? 1 : 2;
    const playedCol = moves[i];

    // Score AVANT le coup (position actuelle)
    const boardBefore = cloneBoard(board);
    const analysis = bestMove(boardBefore, player);

    let result;
    if (!analysis || validCols(board).length === 0) {
      result = { moveIndex:i, player, playedCol, bestCol:playedCol, classification:'best', loss:0, evalScore:0, evalCP:0, optimalSeq:[], comment:'Seul coup possible.' };
    } else {
      const bestScore   = analysis.score;
      const bestCol     = analysis.col;

      // Score pour le coup joué — TOUJOURS calculé proprement
      const playedScore = analysis.colScores.hasOwnProperty(playedCol)
        ? analysis.colScores[playedCol]
        : (() => {
            // Recalculer si absent (ne devrait pas arriver)
            drop(board, playedCol, player);
            const s = checkWin(board, player)
              ? (player === 1 ? 100000 : -100000)
              : minimax(board, DEPTH-2, -Infinity, Infinity, player !== 1);
            undrop(board, playedCol);
            return s;
          })();

      const classification = classifyMove(player, playedScore, bestScore);
      const loss = Math.abs(bestScore - playedScore);

      // Score APRÈS le coup joué pour le graphe
      drop(board, playedCol, player);
      const postScore = checkWin(board, player)
        ? (player === 1 ? 100000 : -100000)
        : (isFull(board) ? 0 : evaluate(board));
      undrop(board, playedCol);

      const evalCP  = toCentipawns(postScore);
      const evalBar = toBar(postScore);

      // Séquence optimale seulement pour les erreurs
      let optimalSeq = [];
      if (['inaccuracy','mistake','blunder'].includes(classification))
        optimalSeq = getOptimalSequence(boardBefore, player, 6);

      const comment = generateComment(classification, i, bestCol, playedCol, loss);

      result = { moveIndex:i, player, playedCol, bestCol, bestScore, playedScore, classification, loss, evalScore:evalBar, evalCP, optimalSeq, comment };

      if (player === 1) p1Scores.push({ classification, loss });
      else              p2Scores.push({ classification, loss });
    }

    results.push(result);
    drop(board, playedCol, player);

    // Historique d'évaluation APRÈS chaque coup (pour le graphe)
    const postScore2 = checkWin(board, player)
      ? (player === 1 ? 100000 : -100000)
      : (isFull(board) ? 0 : evaluate(board));
    evalHistory.push({ moveIndex:i, player, score:toBar(postScore2), cp:toCentipawns(postScore2) });

    self.postMessage({ type:'progress', moveIndex:i, total:moves.length, result });
    if (checkWin(board, player)) break;
  }

  self.postMessage({
    type: 'done',
    results,
    evalHistory,
    accuracy: { p1: calcAccuracy(p1Scores), p2: calcAccuracy(p2Scores) }
  });
};

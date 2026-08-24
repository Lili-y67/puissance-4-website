const VARIANTS = Object.freeze({
  classic: Object.freeze({ id: 'classic', label: 'Classique', rows: 6, cols: 7, ranked: true }),
  rotate: Object.freeze({ id: 'rotate', label: 'Plateau rotatif', rows: 7, cols: 7, ranked: true, rotateEvery: 4 }),
  anti: Object.freeze({ id: 'anti', label: 'Anti-Puissance 4', rows: 9, cols: 9, ranked: true }),
  bomb: Object.freeze({ id: 'bomb', label: 'Puissance Bombe', rows: 6, cols: 7, ranked: true }),
  mission: Object.freeze({ id: 'mission', label: 'Mission personnelle', rows: 7, cols: 7, ranked: true }),
  simultaneous: Object.freeze({ id: 'simultaneous', label: 'Placement simultané', rows: 6, cols: 7, ranked: true }),
  fog: Object.freeze({ id: 'fog', label: 'Brouillard de Guerre', rows: 6, cols: 7, ranked: true, revealMs: 1250 }),
  conquest: Object.freeze({ id: 'conquest', label: 'Conquête', rows: 6, cols: 7, ranked: true, pointsToResolve: 4 }),
  naval: Object.freeze({ id: 'naval', label: 'Puissance 4 Navale', rows: 6, cols: 7, ranked: true, botSupported: true }),
});

const MISSION_DEFINITIONS = Object.freeze([
  { id: 'square', label: 'Carré parfait', description: 'Former un carré complet de 2×2.' },
  { id: 'double3', label: 'Double menace', description: 'Créer deux alignements distincts de 3 simultanément.' },
  { id: 'center', label: 'Domination centrale', description: 'Contrôler au moins 4 cases de la zone centrale 3×3.' },
  { id: 'high4', label: 'Haute altitude', description: 'Aligner 4 jetons sans utiliser la rangée du bas.' },
  { id: 'directions', label: 'Trois directions', description: 'Former une paire horizontale, verticale et diagonale.' },
]);

function normalizeVariant(value) {
  const id = String(value || 'classic').trim().toLowerCase();
  return VARIANTS[id] ? id : 'classic';
}

function getVariant(value) {
  return VARIANTS[normalizeVariant(value)];
}

function publicVariants() {
  return Object.values(VARIANTS).map(variant => ({ ...variant }));
}

module.exports = { VARIANTS, MISSION_DEFINITIONS, normalizeVariant, getVariant, publicVariants };

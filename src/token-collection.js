const TOKEN_COLOR_CATALOG = Object.freeze([
  { key: 'rouge', label: 'Rouge', hex: '#ff2d55', theme: 'Classiques', rarity: 'common', design: 'classic', weight: 12 },
  { key: 'jaune', label: 'Jaune', hex: '#ffd60a', theme: 'Classiques', rarity: 'common', design: 'classic', weight: 12 },
  { key: 'bleu', label: 'Bleu', hex: '#2f80ff', theme: 'Classiques', rarity: 'common', design: 'classic', weight: 11 },
  { key: 'vert', label: 'Vert', hex: '#30d158', theme: 'Classiques', rarity: 'common', design: 'classic', weight: 11 },
  { key: 'orange', label: 'Orange', hex: '#ff9f0a', theme: 'Classiques', rarity: 'common', design: 'classic', weight: 10 },
  { key: 'violet', label: 'Violet', hex: '#af52de', theme: 'Classiques', rarity: 'common', design: 'classic', weight: 10 },
  { key: 'rose', label: 'Rose', hex: '#ff5ca8', theme: 'Classiques', rarity: 'common', design: 'classic', weight: 10 },
  { key: 'cyan', label: 'Cyan', hex: '#64d2ff', theme: 'Classiques', rarity: 'common', design: 'classic', weight: 10 },

  { key: 'citron', label: 'Citron rainure', hex: '#d7ff2f', theme: 'Couleurs vives', rarity: 'rare', design: 'grooved', weight: 6 },
  { key: 'indigo', label: 'Indigo rainure', hex: '#5e5ce6', theme: 'Couleurs vives', rarity: 'rare', design: 'grooved', weight: 6 },
  { key: 'turquoise', label: 'Turquoise anneau', hex: '#40e0d0', theme: 'Couleurs vives', rarity: 'rare', design: 'ring', weight: 6 },
  { key: 'ambre', label: 'Ambre anneau', hex: '#ffbf00', theme: 'Couleurs vives', rarity: 'rare', design: 'ring', weight: 6 },
  { key: 'corail', label: 'Corail rainure', hex: '#ff7f6e', theme: 'Couleurs vives', rarity: 'rare', design: 'grooved', weight: 6 },
  { key: 'menthe', label: 'Menthe anneau', hex: '#7ef0c5', theme: 'Couleurs vives', rarity: 'rare', design: 'ring', weight: 6 },
  { key: 'lavande', label: 'Lavande rainure', hex: '#c9a7ff', theme: 'Couleurs vives', rarity: 'rare', design: 'grooved', weight: 6 },
  { key: 'fuchsia', label: 'Fuchsia anneau', hex: '#ff2bd6', theme: 'Couleurs vives', rarity: 'rare', design: 'ring', weight: 6 },

  { key: 'or', label: 'Or forge', hex: '#f6c945', hexSecondary: '#9f6712', theme: 'Prestige', rarity: 'epic', design: 'metal', weight: 3 },
  { key: 'argent', label: 'Argent forge', hex: '#eef2f8', hexSecondary: '#7c8799', theme: 'Prestige', rarity: 'epic', design: 'metal', weight: 3 },
  { key: 'obsidienne', label: 'Obsidienne', hex: '#272735', hexSecondary: '#050508', theme: 'Prestige', rarity: 'epic', design: 'star', weight: 3 },
  { key: 'perle', label: 'Perle', hex: '#fffaf0', hexSecondary: '#b8d8e8', theme: 'Prestige', rarity: 'epic', design: 'pearl', weight: 3 },
  { key: 'bordeaux', label: 'Bordeaux royal', hex: '#b0204e', hexSecondary: '#4c071b', theme: 'Prestige', rarity: 'epic', design: 'star', weight: 3 },
  { key: 'marine', label: 'Marine abyssal', hex: '#174687', hexSecondary: '#07152f', theme: 'Prestige', rarity: 'epic', design: 'star', weight: 3 },
  { key: 'emeraude', label: 'Emeraude taillee', hex: '#1bd68e', hexSecondary: '#00623f', theme: 'Prestige', rarity: 'epic', design: 'gem', weight: 3 },
  { key: 'prisme', label: 'Prisme legendaire', hex: '#85ebff', hexSecondary: '#ff5ca8', theme: 'Legendes', rarity: 'legendary', design: 'prism', weight: 1, gemRewardMin: 5, gemRewardMax: 15 },
  { key: 'solaire', label: 'Solaire legendaire', hex: '#fff09a', hexSecondary: '#ff6b00', theme: 'Legendes', rarity: 'legendary', design: 'sun', weight: 1, gemRewardMin: 5, gemRewardMax: 15 },
  { key: 'spectre', label: 'Spectre', hex: '#72f7d4', hexSecondary: '#8b5cf6', theme: 'Anomalies', rarity: 'spectral', design: 'spectral', weight: 1 },
  { key: 'cosmos', label: 'Cosmos', hex: '#80a7ff', hexSecondary: '#d946ef', theme: 'Anomalies', rarity: 'spectral', design: 'cosmos', weight: 1 },
]);

function drawTokenColor(random = Math.random) {
  const totalWeight = TOKEN_COLOR_CATALOG.reduce((sum, color) => sum + Number(color.weight || 1), 0);
  let cursor = Math.max(0, Math.min(0.999999, Number(random()) || 0)) * totalWeight;
  for (const color of TOKEN_COLOR_CATALOG) {
    cursor -= Number(color.weight || 1);
    if (cursor < 0) return color;
  }
  return TOKEN_COLOR_CATALOG[0];
}

function drawTokenColorForRarity(rarity, random = Math.random) {
  const wanted = String(rarity || 'common').toLowerCase();
  const candidates = TOKEN_COLOR_CATALOG.filter(color => color.rarity === wanted);
  const pool = candidates.length ? candidates : TOKEN_COLOR_CATALOG.filter(color => color.rarity === 'common');
  const index = Math.floor(Math.max(0, Math.min(0.999999, Number(random()) || 0)) * pool.length);
  return pool[index] || TOKEN_COLOR_CATALOG[0];
}

function drawTokenGemReward(token, random = Math.random) {
  if (!token || token.rarity !== 'legendary') return 0;
  const min = Math.max(0, Math.floor(Number(token.gemRewardMin || 0)));
  const max = Math.max(min, Math.floor(Number(token.gemRewardMax || min)));
  return min + Math.floor(Math.max(0, Math.min(0.999999, Number(random()) || 0)) * (max - min + 1));
}

module.exports = { TOKEN_COLOR_CATALOG, drawTokenColor, drawTokenColorForRarity, drawTokenGemReward };

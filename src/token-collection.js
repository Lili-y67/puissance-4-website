const TOKEN_COLOR_CATALOG = Object.freeze([
  { key: 'rouge', label: 'Rouge', hex: '#ff2d55', theme: 'Classiques', rarity: 'common', weight: 12 },
  { key: 'jaune', label: 'Jaune', hex: '#ffd60a', theme: 'Classiques', rarity: 'common', weight: 12 },
  { key: 'bleu', label: 'Bleu', hex: '#2f80ff', theme: 'Classiques', rarity: 'common', weight: 11 },
  { key: 'vert', label: 'Vert', hex: '#30d158', theme: 'Classiques', rarity: 'common', weight: 11 },
  { key: 'orange', label: 'Orange', hex: '#ff9f0a', theme: 'Classiques', rarity: 'common', weight: 10 },
  { key: 'violet', label: 'Violet', hex: '#af52de', theme: 'Classiques', rarity: 'common', weight: 10 },
  { key: 'rose', label: 'Rose', hex: '#ff5ca8', theme: 'Classiques', rarity: 'common', weight: 10 },
  { key: 'cyan', label: 'Cyan', hex: '#64d2ff', theme: 'Classiques', rarity: 'common', weight: 10 },

  { key: 'citron', label: 'Citron', hex: '#d7ff2f', theme: 'Couleurs vives', rarity: 'rare', weight: 6 },
  { key: 'indigo', label: 'Indigo', hex: '#5e5ce6', theme: 'Couleurs vives', rarity: 'rare', weight: 6 },
  { key: 'turquoise', label: 'Turquoise', hex: '#40e0d0', theme: 'Couleurs vives', rarity: 'rare', weight: 6 },
  { key: 'ambre', label: 'Ambre', hex: '#ffbf00', theme: 'Couleurs vives', rarity: 'rare', weight: 6 },
  { key: 'corail', label: 'Corail', hex: '#ff7f6e', theme: 'Couleurs vives', rarity: 'rare', weight: 6 },
  { key: 'menthe', label: 'Menthe', hex: '#7ef0c5', theme: 'Couleurs vives', rarity: 'rare', weight: 6 },
  { key: 'lavande', label: 'Lavande', hex: '#c9a7ff', theme: 'Couleurs vives', rarity: 'rare', weight: 6 },
  { key: 'fuchsia', label: 'Fuchsia', hex: '#ff2bd6', theme: 'Couleurs vives', rarity: 'rare', weight: 6 },

  { key: 'or', label: 'Or', hex: '#f6c945', theme: 'Prestige', rarity: 'epic', weight: 3 },
  { key: 'argent', label: 'Argent', hex: '#c6ccd8', theme: 'Prestige', rarity: 'epic', weight: 3 },
  { key: 'obsidienne', label: 'Obsidienne', hex: '#191923', theme: 'Prestige', rarity: 'epic', weight: 3 },
  { key: 'perle', label: 'Perle', hex: '#f7f2e8', theme: 'Prestige', rarity: 'epic', weight: 3 },
  { key: 'bordeaux', label: 'Bordeaux', hex: '#8f1838', theme: 'Prestige', rarity: 'epic', weight: 3 },
  { key: 'marine', label: 'Marine', hex: '#102a56', theme: 'Prestige', rarity: 'epic', weight: 3 },
  { key: 'emeraude', label: 'Emeraude', hex: '#00a86b', theme: 'Prestige', rarity: 'epic', weight: 3 },
  { key: 'prisme', label: 'Prisme', hex: '#85ebff', hexSecondary: '#ff5ca8', theme: 'Prestige', rarity: 'legendary', weight: 1, gemRewardMin: 5, gemRewardMax: 15 },
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

function drawTokenGemReward(token, random = Math.random) {
  if (!token || token.rarity !== 'legendary') return 0;
  const min = Math.max(0, Math.floor(Number(token.gemRewardMin || 0)));
  const max = Math.max(min, Math.floor(Number(token.gemRewardMax || min)));
  return min + Math.floor(Math.max(0, Math.min(0.999999, Number(random()) || 0)) * (max - min + 1));
}

module.exports = { TOKEN_COLOR_CATALOG, drawTokenColor, drawTokenGemReward };

const TOKEN_RARITIES = Object.freeze([
  { key: 'common', label: 'Commun', spawnRate: 49, color: '#ff5c72', design: 'classic' },
  { key: 'rare', label: 'Rare', spawnRate: 25, color: '#4c8dff', design: 'grooved' },
  { key: 'epic', label: 'Epique', spawnRate: 12, color: '#bf5af2', design: 'star' },
  { key: 'legendary', label: 'Legendaire', spawnRate: 7, color: '#ffd60a', design: 'prism' },
  { key: 'mythic', label: 'Mythique', spawnRate: 3.5, color: '#ff2d86', design: 'mythic' },
  { key: 'artifact', label: 'Artefact', spawnRate: 1.5, color: '#72f7d4', design: 'artifact' },
  { key: 'queenpawn', label: 'QueenPawn', spawnRate: 1, color: '#fff2c7', design: 'queen' },
  { key: 'fantastic', label: 'Fantastique', spawnRate: 0.9, color: '#6dffb8', design: 'fantastic' },
  { key: 'unforgettable', label: 'Inoubliable', spawnRate: 0.1, color: '#ff66b7', design: 'image' },
  { key: 'event', label: 'Evenement', spawnRate: 0, color: '#85ebff', design: 'event' },
]);

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
  { key: 'dragon', label: 'Ecaille de dragon', hex: '#ff493d', hexSecondary: '#52120e', theme: 'Legendes', rarity: 'legendary', design: 'scale', weight: 1, gemRewardMin: 5, gemRewardMax: 15 },

  { key: 'spectre', label: 'Spectre mythique', hex: '#72f7d4', hexSecondary: '#8b5cf6', theme: 'Mythiques', rarity: 'mythic', design: 'spectral', weight: 1, gemRewardMin: 8, gemRewardMax: 18 },
  { key: 'cosmos', label: 'Cosmos mythique', hex: '#80a7ff', hexSecondary: '#d946ef', theme: 'Mythiques', rarity: 'mythic', design: 'cosmos', weight: 1, gemRewardMin: 8, gemRewardMax: 18 },
  { key: 'phoenix', label: 'Coeur du Phenix', hex: '#fff07a', hexSecondary: '#ff1744', theme: 'Mythiques', rarity: 'mythic', design: 'flame', weight: 1, gemRewardMin: 8, gemRewardMax: 18 },
  { key: 'lunaire', label: 'Lune eternelle', hex: '#e8e9ff', hexSecondary: '#5754c9', theme: 'Mythiques', rarity: 'mythic', design: 'moon', weight: 1, gemRewardMin: 8, gemRewardMax: 18 },

  { key: 'relique', label: 'Relique ancienne', hex: '#62ffd5', hexSecondary: '#57452b', theme: 'Artefacts', rarity: 'artifact', design: 'artifact', weight: 1, gemRewardMin: 10, gemRewardMax: 22 },
  { key: 'chronos', label: 'Chronos', hex: '#e8cf78', hexSecondary: '#315f72', theme: 'Artefacts', rarity: 'artifact', design: 'clock', weight: 1, gemRewardMin: 10, gemRewardMax: 22 },
  { key: 'runique', label: 'Pion runique', hex: '#c5fff0', hexSecondary: '#087b67', theme: 'Artefacts', rarity: 'artifact', design: 'rune', weight: 1, gemRewardMin: 10, gemRewardMax: 22 },

  { key: 'queenpawn', label: 'QueenPawn', hex: '#fff8dd', hexSecondary: '#d39bff', theme: 'Tresors impossibles', rarity: 'queenpawn', design: 'queen', weight: 1, gemRewardMin: 15, gemRewardMax: 30 },
  { key: 'queenpawn_noire', label: 'QueenPawn Noire', hex: '#5c5278', hexSecondary: '#ff4dc4', theme: 'Tresors impossibles', rarity: 'queenpawn', design: 'queen-dark', weight: 1, gemRewardMin: 15, gemRewardMax: 30 },

  { key: 'fee_sylvestre', label: 'Fee sylvestre', hex: '#79ffb1', hexSecondary: '#8b5cf6', theme: 'Fantastique', rarity: 'fantastic', design: 'fantastic', weight: 1, gemRewardMin: 18, gemRewardMax: 35 },
  { key: 'cristal_draconique', label: 'Cristal draconique', hex: '#ff5a7a', hexSecondary: '#7df9ff', theme: 'Fantastique', rarity: 'fantastic', design: 'dragon-gem', weight: 1, gemRewardMin: 18, gemRewardMax: 35 },
  { key: 'oracle_lunaire', label: 'Oracle lunaire', hex: '#f8f3ff', hexSecondary: '#6457ff', theme: 'Fantastique', rarity: 'fantastic', design: 'oracle', weight: 1, gemRewardMin: 18, gemRewardMax: 35 },
  { key: 'royaume_oublie', label: 'Royaume oublie', hex: '#ffd36e', hexSecondary: '#f05cff', theme: 'Fantastique', rarity: 'fantastic', design: 'crown-gem', weight: 1, gemRewardMin: 18, gemRewardMax: 35 },

  { key: 'princesse_inoubliable', label: 'Princesse inoubliable', hex: '#ff66b7', hexSecondary: '#ffd1ea', theme: 'Inoubliables', rarity: 'unforgettable', design: 'image', image: '/assets/token-inoubliable-princesse.png', weight: 1, gemRewardMin: 40, gemRewardMax: 80 },

  { key: 'event_summer_2026', label: 'Festival ete 2026', hex: '#ffcc4d', hexSecondary: '#25d5ff', theme: 'Evenements', rarity: 'event', design: 'event-sun', weight: 0, gemRewardMin: 0, gemRewardMax: 0 },
  { key: 'event_crown', label: 'Couronne evenement', hex: '#ffe680', hexSecondary: '#7c4dff', theme: 'Evenements', rarity: 'event', design: 'event-crown', weight: 0, gemRewardMin: 0, gemRewardMax: 0 },
  { key: 'event_shadow_drop', label: 'Drop des ombres', hex: '#504a68', hexSecondary: '#ff4dc4', theme: 'Evenements', rarity: 'event', design: 'event-shadow', weight: 0, gemRewardMin: 0, gemRewardMax: 0 },
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

function drawTokenRarity(random = Math.random) {
  const roll = Math.max(0, Math.min(0.999999, Number(random()) || 0)) * 100;
  let cursor = 0;
  for (const rarity of TOKEN_RARITIES) {
    cursor += Number(rarity.spawnRate || 0);
    if (roll < cursor) return rarity;
  }
  return TOKEN_RARITIES[0];
}

function drawTokenGemReward(token, random = Math.random) {
  if (!token || !Number(token.gemRewardMax || 0)) return 0;
  const min = Math.max(0, Math.floor(Number(token.gemRewardMin || 0)));
  const max = Math.max(min, Math.floor(Number(token.gemRewardMax || min)));
  return min + Math.floor(Math.max(0, Math.min(0.999999, Number(random()) || 0)) * (max - min + 1));
}

module.exports = { TOKEN_RARITIES, TOKEN_COLOR_CATALOG, drawTokenColor, drawTokenColorForRarity, drawTokenRarity, drawTokenGemReward };


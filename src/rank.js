/**
 * rank.js - Systeme de rangs ELO
 * 6 rangs x 5 niveaux = 30 grades (100 -> 3500 ELO)
 */
const RANKS = [
  { name: 'Malachite',  key: 'Malachite', color: '#2ecc71', min: 100,  max: 699 },
  { name: 'Quartz',     key: 'Quartz',    color: '#b0bec5', min: 700,  max: 1299 },
  { name: 'Ambre',      key: 'Ambre',     color: '#cd7f32', min: 1300, max: 1799 },
  { name: 'Jade',       key: 'Jade',      color: '#1abc9c', min: 1800, max: 2299 },
  { name: 'Saphir',     key: 'Saphir',    color: '#3498db', min: 2300, max: 2799 },
  { name: 'Am\u00e9thyste', key: 'Amethiste', color: '#9b59b6', min: 2800, max: 3500 },
];

const ROMAN_LEVELS = ['I', 'II', 'III', 'IV', 'V'];

function formatRankLabel(rank) {
  return String(rank?.label || '');
}

function getAllRankRoleNames() {
  return RANKS.flatMap(rank => ROMAN_LEVELS.map(level => `${rank.name} ${level}`));
}

function getRank(elo) {
  const e = Math.max(100, Math.min(elo || 1000, 3500));
  const rank = RANKS.find(r => e >= r.min && e <= r.max) || RANKS[0];
  const range = rank.max - rank.min;
  const level = Math.min(5, Math.ceil(((e - rank.min) / range) * 5) || 1);
  const label = rank.name + ' ' + ROMAN_LEVELS[level - 1];
  return {
    name:   rank.name,
    key:    rank.key,
    level,
    label,
    discordRoleName: label,
    emoji:  '',
    displayLabel: label,
    color:  rank.color,
    image:  '/ranks/' + rank.key + '_' + level + '.png',
    elo:    e,
    next:   e < 3500 ? rank.max + 1 : null,
    progress: Math.round(((e - rank.min) / range) * 100),
  };
}

module.exports = { getRank, RANKS, ROMAN_LEVELS, formatRankLabel, getAllRankRoleNames };

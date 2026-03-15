/**
 * themes.js — Système de thèmes partagé sur toutes les pages
 * Applique les variables CSS et persiste le choix en localStorage
 */
(function() {

const THEMES = {
  default: {
    label: 'Défaut',
    emoji: '🌑',
    vars: {
      '--bg':        '#06060e',
      '--surface':   '#0d0d1c',
      '--surface2':  '#13132a',
      '--border':    'rgba(255,255,255,0.06)',
      '--red':       '#ff2d55',
      '--red-dim':   'rgba(255,45,85,0.15)',
      '--red-glow':  'rgba(255,45,85,0.4)',
      '--yellow':    '#ffd60a',
      '--yel-dim':   'rgba(255,214,10,0.1)',
      '--yel-glow':  'rgba(255,214,10,0.4)',
      '--green':     '#30d158',
      '--orange':    '#ff9f0a',
      '--text':      '#eeeef5',
      '--muted':     'rgba(238,238,245,0.38)',
      '--accent':    '#4c6ef5',
      '--grid':      '#0a0a18',
      '--cell':      '#07071a',
    }
  },
  neon: {
    label: 'Néon',
    emoji: '⚡',
    vars: {
      '--bg':        '#050510',
      '--surface':   '#0a0a20',
      '--surface2':  '#10102e',
      '--border':    'rgba(170,0,255,0.12)',
      '--red':       '#ff00aa',
      '--red-dim':   'rgba(255,0,170,0.15)',
      '--red-glow':  'rgba(255,0,170,0.6)',
      '--yellow':    '#00ffaa',
      '--yel-dim':   'rgba(0,255,170,0.1)',
      '--yel-glow':  'rgba(0,255,170,0.6)',
      '--green':     '#00ffaa',
      '--orange':    '#ff6600',
      '--text':      '#f0f0ff',
      '--muted':     'rgba(240,240,255,0.38)',
      '--accent':    '#aa00ff',
      '--grid':      '#07071a',
      '--cell':      '#04040f',
    }
  },
  fire: {
    label: 'Feu',
    emoji: '🔥',
    vars: {
      '--bg':        '#0f0800',
      '--surface':   '#1a1000',
      '--surface2':  '#251800',
      '--border':    'rgba(255,102,0,0.12)',
      '--red':       '#ff6600',
      '--red-dim':   'rgba(255,102,0,0.15)',
      '--red-glow':  'rgba(255,102,0,0.6)',
      '--yellow':    '#ffdd00',
      '--yel-dim':   'rgba(255,221,0,0.1)',
      '--yel-glow':  'rgba(255,221,0,0.6)',
      '--green':     '#ffaa00',
      '--orange':    '#ff4400',
      '--text':      '#fff8f0',
      '--muted':     'rgba(255,248,240,0.38)',
      '--accent':    '#ff3300',
      '--grid':      '#120900',
      '--cell':      '#0a0600',
    }
  },
  ocean: {
    label: 'Océan',
    emoji: '🌊',
    vars: {
      '--bg':        '#000d1a',
      '--surface':   '#001428',
      '--surface2':  '#001e3c',
      '--border':    'rgba(0,102,255,0.12)',
      '--red':       '#0066ff',
      '--red-dim':   'rgba(0,102,255,0.15)',
      '--red-glow':  'rgba(0,102,255,0.6)',
      '--yellow':    '#00ffee',
      '--yel-dim':   'rgba(0,255,238,0.1)',
      '--yel-glow':  'rgba(0,255,238,0.6)',
      '--green':     '#00ffee',
      '--orange':    '#0099ff',
      '--text':      '#e8f4ff',
      '--muted':     'rgba(232,244,255,0.38)',
      '--accent':    '#0044cc',
      '--grid':      '#000f22',
      '--cell':      '#000812',
    }
  },
  pastel: {
    label: 'Pastel',
    emoji: '🌸',
    vars: {
      '--bg':        '#f0eef8',
      '--surface':   '#e8e4f4',
      '--surface2':  '#ddd8f0',
      '--border':    'rgba(0,0,0,0.08)',
      '--red':       '#e05b8a',
      '--red-dim':   'rgba(224,91,138,0.12)',
      '--red-glow':  'rgba(224,91,138,0.4)',
      '--yellow':    '#5b9ee0',
      '--yel-dim':   'rgba(91,158,224,0.1)',
      '--yel-glow':  'rgba(91,158,224,0.4)',
      '--green':     '#5bc87a',
      '--orange':    '#e08c5b',
      '--text':      '#2a2040',
      '--muted':     'rgba(42,32,64,0.45)',
      '--accent':    '#9b5be0',
      '--grid':      '#ddd8f0',
      '--cell':      '#c8c0e8',
    }
  },
};

function applyTheme(name) {
  const theme = THEMES[name] || THEMES.default;
  const root  = document.documentElement;
  for (const [k, v] of Object.entries(theme.vars)) {
    root.style.setProperty(k, v);
  }
  localStorage.setItem('theme', name);
  // Mettre à jour les boutons actifs si le picker est présent
  document.querySelectorAll('.theme-pick-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.theme === name);
  });
}

function buildPicker() {
  const wrap = document.createElement('div');
  wrap.id = 'theme-picker';
  wrap.style.cssText = `
    position:fixed;bottom:20px;right:20px;z-index:9999;
    display:flex;flex-direction:column;align-items:flex-end;gap:8px;
  `;

  // Boutons thèmes (cachés par défaut)
  const menu = document.createElement('div');
  menu.id = 'theme-menu';
  menu.style.cssText = `
    display:none;flex-direction:column;gap:6px;
    background:#0d0d1c;border:1px solid rgba(255,255,255,0.08);
    border-radius:14px;padding:10px;
    box-shadow:0 8px 32px rgba(0,0,0,0.5);
    min-width:130px;
  `;

  for (const [key, theme] of Object.entries(THEMES)) {
    const btn = document.createElement('button');
    btn.className = 'theme-pick-btn';
    btn.dataset.theme = key;
    btn.textContent = theme.emoji + ' ' + theme.label;
    btn.style.cssText = `
      width:100%;padding:8px 12px;border-radius:8px;
      border:1px solid transparent;background:transparent;
      color:rgba(238,238,245,0.7);font-size:13px;font-weight:600;
      cursor:pointer;text-align:left;transition:all 0.15s;
      font-family:inherit;
    `;
    btn.addEventListener('mouseenter', () => { btn.style.background='rgba(255,255,255,0.06)'; });
    btn.addEventListener('mouseleave', () => {
      btn.style.background = btn.classList.contains('active') ? 'rgba(76,110,245,0.15)' : 'transparent';
    });
    btn.addEventListener('click', () => {
      applyTheme(key);
      menu.style.display = 'none';
    });
    menu.appendChild(btn);
  }

  // Bouton toggle
  const toggle = document.createElement('button');
  toggle.title = 'Changer de thème';
  toggle.textContent = '🎨';
  toggle.style.cssText = `
    width:36px;height:36px;border-radius:10px;
    border:1px solid rgba(255,255,255,0.08);
    background:rgba(13,13,28,0.9);
    color:rgba(238,238,245,0.6);font-size:18px;
    cursor:pointer;backdrop-filter:blur(8px);
    transition:all 0.2s;display:flex;align-items:center;justify-content:center;
  `;
  toggle.addEventListener('click', () => {
    const open = menu.style.display === 'flex';
    menu.style.display = open ? 'none' : 'flex';
  });
  // Fermer si clic ailleurs
  document.addEventListener('click', (e) => {
    if (!wrap.contains(e.target)) menu.style.display = 'none';
  });

  wrap.appendChild(menu);
  wrap.appendChild(toggle);
  document.body.appendChild(wrap);

  // Appliquer le thème sauvegardé
  const saved = localStorage.getItem('theme') || 'default';
  applyTheme(saved);
}

// Attendre que le DOM soit prêt
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', buildPicker);
} else {
  buildPicker();
}

// Exposer pour usage externe si besoin
window._applyTheme = applyTheme;

})();

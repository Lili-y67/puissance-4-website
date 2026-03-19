/**
 * themes.js — Thèmes : UNIQUEMENT --bg, --grid, --cell
 * Tout le reste (surface, text, border, accent...) vient du :root CSS de chaque page
 */
(function() {

const THEMES = {
  // ── Sombres ──────────────────────────────────────────────────────────────
  default:  { label:'Défaut',    emoji:'🌑', dark:true,  vars:{ '--bg':'#06060e',                                                       '--grid':'#1a1a3a', '--cell':'#0d0d22' } },
  neon:     { label:'Néon',      emoji:'⚡', dark:true,  vars:{ '--bg':'linear-gradient(135deg,#050510,#0a0020,#050510)',                '--grid':'#160030', '--cell':'#0a001a' } },
  fire:     { label:'Feu',       emoji:'🔥', dark:true,  vars:{ '--bg':'linear-gradient(to bottom,#0f0800,#1a0c00,#0f0500)',            '--grid':'#2a1000', '--cell':'#1a0800' } },
  ocean:    { label:'Océan',     emoji:'🌊', dark:true,  vars:{ '--bg':'linear-gradient(to bottom,#000d1a,#001428,#000a12)',            '--grid':'#002040', '--cell':'#001228' } },
  forest:   { label:'Forêt',     emoji:'🌿', dark:true,  vars:{ '--bg':'linear-gradient(to bottom,#040d06,#091a0b,#020a03)',            '--grid':'#0a2010', '--cell':'#051008' } },
  midnight: { label:'Minuit',    emoji:'🌙', dark:true,  vars:{ '--bg':'linear-gradient(135deg,#0a0a12,#12101e,#08080f)',               '--grid':'#1e1830', '--cell':'#120e20' } },
  aurora:   { label:'Aurora',    emoji:'🌌', dark:true,  vars:{ '--bg':'linear-gradient(160deg,#020818,#051a14,#0a0520,#020c1a)',       '--grid':'#0a1828', '--cell':'#050c18' } },
  volcano:  { label:'Volcan',    emoji:'🌋', dark:true,  vars:{ '--bg':'linear-gradient(to bottom,#120000,#1a0400,#0a0000)',            '--grid':'#2a0800', '--cell':'#180400' } },
  galaxy:   { label:'Galaxie',   emoji:'🪐', dark:true,  vars:{ '--bg':'linear-gradient(135deg,#050012,#0a0025,#020010,#080018)',       '--grid':'#140a2a', '--cell':'#0a0618' } },
  blood:    { label:'Blood',     emoji:'🩸', dark:true,  vars:{ '--bg':'linear-gradient(to bottom,#0d0000,#1a0000,#080000)',            '--grid':'#2a0000', '--cell':'#180000' } },
  // ── Clairs ───────────────────────────────────────────────────────────────
  light:    { label:'Clair',     emoji:'☀️', dark:false, vars:{ '--bg':'#f5f5f7',                                                       '--grid':'#dcdce0', '--cell':'#c8c8cc' } },
  sunrise:  { label:'Aurore',    emoji:'🌅', dark:false, vars:{ '--bg':'linear-gradient(to bottom,#fff0e8,#fde8d8,#fff5ee)',            '--grid':'#f0ddd0', '--cell':'#e0c8b8' } },
  sky:      { label:'Ciel',      emoji:'🩵', dark:false, vars:{ '--bg':'linear-gradient(to bottom,#e8f4ff,#ddeeff,#eef6ff)',            '--grid':'#d0e8f8', '--cell':'#bcd8ee' } },
  spring:   { label:'Printemps', emoji:'🌺', dark:false, vars:{ '--bg':'linear-gradient(135deg,#fff0f5,#fff5f0,#f5fff0)',               '--grid':'#f0d8e8', '--cell':'#e0c0d5' } },
  mint:     { label:'Menthe',    emoji:'🍃', dark:false, vars:{ '--bg':'linear-gradient(to bottom,#eafaf0,#e0f5ea,#f0faf4)',            '--grid':'#cceedc', '--cell':'#b8e4ca' } },
};

// Variables fixes pour mode clair (seulement quand on passe sur un thème clair)
const LIGHT_OVERRIDES = {
  '--text':     '#111111',
  '--muted':    'rgba(0,0,0,0.55)',
  '--surface':  '#ffffff',
  '--surface2': '#f0f0f2',
  '--border':   'rgba(0,0,0,0.10)',
};
const DARK_OVERRIDES = {
  '--text':     '#eeeef5',
  '--muted':    'rgba(238,238,245,0.38)',
  '--surface':  '#0d0d1c',
  '--surface2': '#13132a',
  '--border':   'rgba(255,255,255,0.06)',
};

const LIGHT_THEMES = new Set(Object.entries(THEMES).filter(([,t])=>!t.dark).map(([k])=>k));
let currentThemeName = 'default';
let lastDark = true; // pour savoir si on vient d'un thème sombre

function applyTheme(name) {
  currentThemeName = name;
  const theme = THEMES[name] || THEMES.default;
  const root = document.documentElement;

  // 1. Appliquer UNIQUEMENT bg, grid, cell
  for (const [k,v] of Object.entries(theme.vars)) root.style.setProperty(k, v);

  // 2. Toujours appliquer les overrides texte/surface selon le mode
  const overrides = !theme.dark ? LIGHT_OVERRIDES : DARK_OVERRIDES;
  for (const [k,v] of Object.entries(overrides)) root.style.setProperty(k, v);
  lastDark = theme.dark;

  localStorage.setItem('theme', name);
  document.querySelectorAll('.theme-pick-btn').forEach(b => {
    const active = b.dataset.theme === name;
    b.classList.toggle('active', active);
    b.style.outline = active ? '2px solid var(--accent,#4c6ef5)' : 'none';
  });
  const mt = document.getElementById('theme-mode-toggle');
  if (mt) { mt.textContent = theme.dark ? '☀️' : '🌙'; mt.title = theme.dark ? 'Mode clair' : 'Mode sombre'; }
}

function buildPicker() {
  const wrap = document.createElement('div');
  wrap.id = 'theme-picker';
  wrap.style.cssText = 'position:fixed;bottom:20px;right:20px;z-index:9999;display:flex;flex-direction:column;align-items:flex-end;gap:6px;';

  const menu = document.createElement('div');
  menu.style.cssText = 'display:none;flex-direction:column;gap:2px;background:var(--surface,#0d0d1c);border:1px solid var(--border,rgba(255,255,255,0.06));border-radius:16px;padding:10px;box-shadow:0 8px 40px rgba(0,0,0,0.7);width:180px;max-height:80vh;overflow-y:auto;';

  function makeSection(label) {
    const s = document.createElement('div');
    s.style.cssText = 'font-size:9px;letter-spacing:2px;text-transform:uppercase;color:var(--muted,rgba(238,238,245,0.35));padding:6px 4px 3px;font-weight:700;';
    s.textContent = label;
    return s;
  }

  const darkThemes  = Object.entries(THEMES).filter(([,t]) =>  t.dark);
  const lightThemes = Object.entries(THEMES).filter(([,t]) => !t.dark);

  menu.appendChild(makeSection('🌑 Sombres'));
  darkThemes.forEach(([key, theme]) => addThemeBtn(menu, key, theme));
  menu.appendChild(makeSection('☀️ Clairs'));
  lightThemes.forEach(([key, theme]) => addThemeBtn(menu, key, theme));

  function addThemeBtn(parent, key, theme) {
    const btn = document.createElement('button');
    btn.className = 'theme-pick-btn';
    btn.dataset.theme = key;

    const preview = document.createElement('span');
    preview.style.cssText = `display:inline-block;width:18px;height:18px;border-radius:4px;flex-shrink:0;background:${theme.vars['--bg']};border:1px solid rgba(128,128,128,0.2);`;

    const label = document.createElement('span');
    label.textContent = theme.emoji + ' ' + theme.label;
    label.style.cssText = 'flex:1;';

    btn.style.cssText = 'width:100%;padding:6px 8px;border-radius:8px;border:none;outline:none;background:transparent;color:var(--text,#eeeef5);font-size:12px;font-weight:600;cursor:pointer;text-align:left;transition:all 0.15s;font-family:inherit;display:flex;align-items:center;gap:8px;';
    btn.append(preview, label);
    btn.addEventListener('click', () => { applyTheme(key); menu.style.display='none'; });
    btn.addEventListener('mouseenter', () => { if(!btn.classList.contains('active')) btn.style.background='rgba(255,255,255,0.06)'; });
    btn.addEventListener('mouseleave', () => { if(!btn.classList.contains('active')) btn.style.background='transparent'; });
    parent.appendChild(btn);
  }

  // Toggle mode 🌙/☀️
  const modeToggle = document.createElement('button');
  modeToggle.id = 'theme-mode-toggle';
  const saved = localStorage.getItem('theme') || 'default';
  modeToggle.textContent = (THEMES[saved]?.dark ?? true) ? '☀️' : '🌙';
  modeToggle.title = (THEMES[saved]?.dark ?? true) ? 'Mode clair' : 'Mode sombre';
  modeToggle.style.cssText = 'width:38px;height:38px;border-radius:10px;border:1px solid var(--border,rgba(255,255,255,0.06));background:var(--surface,#0d0d1c);font-size:18px;cursor:pointer;backdrop-filter:blur(10px);transition:all 0.2s;display:flex;align-items:center;justify-content:center;';
  modeToggle.addEventListener('click', e => {
    e.stopPropagation();
    const cur = localStorage.getItem('theme') || 'default';
    const isDark = THEMES[cur]?.dark ?? true;
    applyTheme(isDark ? (lightThemes[0]?.[0] || 'light') : (darkThemes[0]?.[0] || 'default'));
    menu.style.display = 'none';
  });

  // Toggle 🎨
  const toggle = document.createElement('button');
  toggle.textContent = '🎨';
  toggle.title = 'Thèmes';
  toggle.style.cssText = 'width:38px;height:38px;border-radius:10px;border:1px solid var(--border,rgba(255,255,255,0.06));background:var(--surface,#0d0d1c);font-size:18px;cursor:pointer;backdrop-filter:blur(10px);transition:all 0.2s;display:flex;align-items:center;justify-content:center;';
  toggle.addEventListener('click', e => {
    e.stopPropagation();
    menu.style.display = menu.style.display === 'flex' ? 'none' : 'flex';
  });
  document.addEventListener('click', e => { if (!wrap.contains(e.target)) menu.style.display='none'; });

  wrap.appendChild(menu);
  wrap.appendChild(modeToggle);
  wrap.appendChild(toggle);
  document.body.appendChild(wrap);
  applyTheme(localStorage.getItem('theme') || 'default');
}

// Appliquer immédiatement (avant DOMContentLoaded) pour éviter le flash
(function() {
  const saved = localStorage.getItem('theme') || 'default';
  const theme = THEMES[saved] || THEMES.default;
  const root = document.documentElement;
  for (const [k,v] of Object.entries(theme.vars)) root.style.setProperty(k, v);
  // Appliquer overrides de mode si besoin
  if (!theme.dark) {
    for (const [k,v] of Object.entries(LIGHT_OVERRIDES)) root.style.setProperty(k, v);
  }
  lastDark = theme.dark;
})();

if (document.readyState==='loading') document.addEventListener('DOMContentLoaded', buildPicker);
else buildPicker();

window._applyTheme = applyTheme;

})();

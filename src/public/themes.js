/**
 * themes.js — Système de thèmes v3
 * Custom = fond seulement (dégradé 1-3 couleurs)
 * Reste de l'UI hérite du thème de base choisi
 */
(function() {

// Thèmes sombres vs clairs
const LIGHT_THEMES = new Set(['pastel','light']);

const THEMES = {
  default:  { label:'Défaut',  emoji:'🌑', vars:{ '--bg':'#06060e','--surface':'#0d0d1c','--surface2':'#13132a','--border':'rgba(255,255,255,0.06)','--text':'#eeeef5','--muted':'rgba(238,238,245,0.38)','--accent':'#4c6ef5','--grid':'#0d0d20','--cell':'#15153a','--red':'#ff2d55','--red-dim':'rgba(255,45,85,0.15)','--red-glow':'rgba(255,45,85,0.4)','--yellow':'#ffd60a','--yel-dim':'rgba(255,214,10,0.1)','--yel-glow':'rgba(255,214,10,0.4)','--green':'#30d158','--orange':'#ff9f0a' } },
  neon:     { label:'Néon',    emoji:'⚡', vars:{ '--bg':'#050510','--surface':'#0a0a20','--surface2':'#10102e','--border':'rgba(170,0,255,0.15)','--text':'#f0f0ff','--muted':'rgba(240,240,255,0.38)','--accent':'#aa00ff','--grid':'#07071a','--cell':'#04040f','--red':'#ff00aa','--red-dim':'rgba(255,0,170,0.15)','--red-glow':'rgba(255,0,170,0.6)','--yellow':'#00ffaa','--yel-dim':'rgba(0,255,170,0.1)','--yel-glow':'rgba(0,255,170,0.6)','--green':'#00ffaa','--orange':'#ff6600' } },
  fire:     { label:'Feu',     emoji:'🔥', vars:{ '--bg':'#0f0800','--surface':'#1a1000','--surface2':'#251800','--border':'rgba(255,102,0,0.12)','--text':'#fff8f0','--muted':'rgba(255,248,240,0.38)','--accent':'#ff3300','--grid':'#120900','--cell':'#0a0600','--red':'#ff6600','--red-dim':'rgba(255,102,0,0.15)','--red-glow':'rgba(255,102,0,0.6)','--yellow':'#ffdd00','--yel-dim':'rgba(255,221,0,0.1)','--yel-glow':'rgba(255,221,0,0.6)','--green':'#ffaa00','--orange':'#ff4400' } },
  ocean:    { label:'Océan',   emoji:'🌊', vars:{ '--bg':'#000d1a','--surface':'#001428','--surface2':'#001e3c','--border':'rgba(0,102,255,0.15)','--text':'#e8f4ff','--muted':'rgba(232,244,255,0.38)','--accent':'#0044cc','--grid':'#000f22','--cell':'#000812','--red':'#0066ff','--red-dim':'rgba(0,102,255,0.15)','--red-glow':'rgba(0,102,255,0.6)','--yellow':'#00ffee','--yel-dim':'rgba(0,255,238,0.1)','--yel-glow':'rgba(0,255,238,0.6)','--green':'#00ffee','--orange':'#0099ff' } },
  pastel:   { label:'Pastel',  emoji:'🌸', vars:{ '--bg':'#f0eef8','--surface':'#e8e4f4','--surface2':'#ddd8f0','--border':'rgba(0,0,0,0.08)','--text':'#2a2040','--muted':'rgba(42,32,64,0.45)','--accent':'#9b5be0','--grid':'#ddd8f0','--cell':'#c8c0e8','--red':'#e05b8a','--red-dim':'rgba(224,91,138,0.15)','--red-glow':'rgba(224,91,138,0.4)','--yellow':'#5b9ee0','--yel-dim':'rgba(91,158,224,0.1)','--yel-glow':'rgba(91,158,224,0.4)','--green':'#5bc87a','--orange':'#e08c5b' } },
  forest:   { label:'Forêt',   emoji:'🌿', vars:{ '--bg':'#040d06','--surface':'#0a1a0d','--surface2':'#122518','--border':'rgba(0,200,80,0.1)','--text':'#e8f5ec','--muted':'rgba(232,245,236,0.38)','--accent':'#00aa44','--grid':'#061008','--cell':'#030a04','--red':'#00cc55','--red-dim':'rgba(0,204,85,0.15)','--red-glow':'rgba(0,204,85,0.5)','--yellow':'#aaee00','--yel-dim':'rgba(170,238,0,0.1)','--yel-glow':'rgba(170,238,0,0.5)','--green':'#00ff88','--orange':'#88cc00' } },
  midnight: { label:'Minuit',  emoji:'🌙', vars:{ '--bg':'#0a0a12','--surface':'#12121e','--surface2':'#1a1a2e','--border':'rgba(150,130,255,0.1)','--text':'#e8e8ff','--muted':'rgba(232,232,255,0.35)','--accent':'#6655ee','--grid':'#0d0d1a','--cell':'#080812','--red':'#8866ff','--red-dim':'rgba(136,102,255,0.15)','--red-glow':'rgba(136,102,255,0.5)','--yellow':'#ffaa44','--yel-dim':'rgba(255,170,68,0.1)','--yel-glow':'rgba(255,170,68,0.5)','--green':'#44ddaa','--orange':'#ee7744' } },
  light:    { label:'Clair',   emoji:'☀️', vars:{ '--bg':'#f5f5f7','--surface':'#ffffff','--surface2':'#ebebed','--border':'rgba(0,0,0,0.08)','--text':'#1d1d1f','--muted':'rgba(29,29,31,0.45)','--accent':'#0066cc','--grid':'#e8e8ea','--cell':'#d4d4d6','--red':'#cc2d55','--red-dim':'rgba(204,45,85,0.12)','--red-glow':'rgba(204,45,85,0.35)','--yellow':'#b8860b','--yel-dim':'rgba(184,134,11,0.1)','--yel-glow':'rgba(184,134,11,0.35)','--green':'#1a7a34','--orange':'#c14a00' } },
};

let currentBase = 'default'; // thème de base utilisé par le custom

function applyTheme(name) {
  const root = document.documentElement;

  if (name === 'custom') {
    // 1. Appliquer le thème de base sauvegardé (sans --bg)
    const base = localStorage.getItem('custom_base') || 'default';
    currentBase = base;
    const baseVars = (THEMES[base] || THEMES.default).vars;
    for (const [k,v] of Object.entries(baseVars)) {
      if (k !== '--bg') root.style.setProperty(k, v);
    }
    // 2. Appliquer le fond custom par-dessus
    const customBg = buildBgValue();
    if (customBg) root.style.setProperty('--bg', customBg);
  } else {
    currentBase = name;
    const vars = (THEMES[name] || THEMES.default).vars;
    for (const [k,v] of Object.entries(vars)) root.style.setProperty(k, v);
  }

  localStorage.setItem('theme', name);
  // Mettre à jour le toggle mode si présent
  if (typeof updateModeToggle === 'function') updateModeToggle();
  document.querySelectorAll('.theme-pick-btn').forEach(b => {
    const active = b.dataset.theme === name;
    b.classList.toggle('active', active);
    b.style.borderColor = active ? 'var(--accent,#4c6ef5)' : 'transparent';
    b.style.background  = active ? 'rgba(100,100,255,0.12)' : 'transparent';
  });
}

function buildBgValue() {
  const c1 = localStorage.getItem('tcustom_c1') || '#06060e';
  const c2 = localStorage.getItem('tcustom_c2') || '#0d0d2e';
  const c3 = localStorage.getItem('tcustom_c3') || '#1a0a2e';
  const n  = parseInt(localStorage.getItem('tcustom_n') || '2');
  const st = localStorage.getItem('tcustom_style') || 'linear-tb';
  const stops = n === 1 ? c1 : n === 3 ? `${c1}, ${c2}, ${c3}` : `${c1}, ${c2}`;
  if (st === 'solid')      return c1;
  if (st === 'linear-tb')  return `linear-gradient(to bottom, ${stops})`;
  if (st === 'linear-br')  return `linear-gradient(135deg, ${stops})`;
  if (st === 'radial')     return `radial-gradient(ellipse at center, ${stops})`;
  if (st === 'radial-tl')  return `radial-gradient(ellipse at top left, ${stops})`;
  return `linear-gradient(to bottom, ${stops})`;
}

function buildPicker() {
  applyTheme(localStorage.getItem('theme') || 'default');

  const wrap = document.createElement('div');
  wrap.style.cssText = 'position:fixed;bottom:20px;right:20px;z-index:9999;display:flex;flex-direction:column;align-items:flex-end;gap:8px;';

  const menu = document.createElement('div');
  menu.style.cssText = 'display:none;flex-direction:column;gap:3px;background:var(--surface,#0d0d1c);border:1px solid var(--border,rgba(255,255,255,0.06));border-radius:16px;padding:10px;box-shadow:0 8px 40px rgba(0,0,0,0.7);min-width:155px;';

  // Thèmes prédéfinis
  for (const [key, theme] of Object.entries(THEMES)) {
    const btn = document.createElement('button');
    btn.className = 'theme-pick-btn';
    btn.dataset.theme = key;
    btn.textContent = theme.emoji + ' ' + theme.label;
    btn.style.cssText = 'width:100%;padding:7px 11px;border-radius:8px;border:1px solid transparent;background:transparent;color:var(--text,#eeeef5);font-size:13px;font-weight:600;cursor:pointer;text-align:left;transition:all 0.15s;font-family:inherit;';
    btn.addEventListener('click', () => { applyTheme(key); customP.style.display='none'; });
    btn.addEventListener('mouseenter', () => { if(!btn.classList.contains('active')) btn.style.background='rgba(255,255,255,0.05)'; });
    btn.addEventListener('mouseleave', () => { if(!btn.classList.contains('active')) btn.style.background='transparent'; });
    menu.appendChild(btn);
  }

  // Séparateur + Custom
  const sep = document.createElement('div');
  sep.style.cssText = 'height:1px;background:var(--border,rgba(255,255,255,0.06));margin:4px 0;';
  menu.appendChild(sep);

  const customBtn = document.createElement('button');
  customBtn.className = 'theme-pick-btn';
  customBtn.dataset.theme = 'custom';
  customBtn.textContent = '🎨 Custom';
  customBtn.style.cssText = 'width:100%;padding:7px 11px;border-radius:8px;border:1px solid transparent;background:transparent;color:var(--text,#eeeef5);font-size:13px;font-weight:600;cursor:pointer;text-align:left;transition:all 0.15s;font-family:inherit;';
  customBtn.addEventListener('click', () => { customP.style.display = customP.style.display==='none'?'flex':'none'; });
  menu.appendChild(customBtn);

  // ── Panel custom ──────────────────────────────────────────────────────────
  const customP = document.createElement('div');
  customP.style.cssText = 'display:none;flex-direction:column;gap:10px;background:var(--surface,#0d0d1c);border:1px solid var(--border,rgba(255,255,255,0.06));border-radius:12px;padding:14px;margin-top:4px;min-width:220px;';

  // Titre
  const title = document.createElement('div');
  title.style.cssText = 'font-size:11px;letter-spacing:1.5px;text-transform:uppercase;color:var(--muted,rgba(238,238,245,0.4));font-weight:700;';
  title.textContent = 'Fond personnalisé';
  customP.appendChild(title);

  // Thème de base (pour surface, texte, etc.)
  const baseRow = document.createElement('div');
  baseRow.style.cssText = 'display:flex;flex-direction:column;gap:5px;';
  const baseLabel = document.createElement('div');
  baseLabel.style.cssText = 'font-size:11px;color:var(--muted,rgba(238,238,245,0.4));';
  baseLabel.textContent = 'Interface de base';
  baseRow.appendChild(baseLabel);
  const baseBtns = document.createElement('div');
  baseBtns.style.cssText = 'display:flex;gap:4px;flex-wrap:wrap;';
  const savedBase = localStorage.getItem('custom_base') || 'default';
  for (const [key, theme] of Object.entries(THEMES)) {
    const bb = document.createElement('button');
    bb.dataset.base = key;
    bb.textContent = theme.emoji;
    bb.title = theme.label;
    bb.style.cssText = `width:28px;height:28px;border-radius:6px;border:1px solid ${key===savedBase?'var(--accent,#4c6ef5)':'var(--border,rgba(255,255,255,0.06))'};background:${key===savedBase?'rgba(100,100,255,0.12)':'transparent'};cursor:pointer;font-size:14px;transition:all 0.15s;`;
    bb.addEventListener('click', () => {
      document.querySelectorAll('[data-base]').forEach(b => { b.style.borderColor='var(--border,rgba(255,255,255,0.06))'; b.style.background='transparent'; });
      bb.style.borderColor='var(--accent,#4c6ef5)'; bb.style.background='rgba(100,100,255,0.12)';
      localStorage.setItem('custom_base', key);
    });
    baseBtns.appendChild(bb);
  }
  baseRow.appendChild(baseBtns);
  customP.appendChild(baseRow);

  // Style dégradé
  const styleLabel = document.createElement('div');
  styleLabel.style.cssText = 'font-size:11px;color:var(--muted,rgba(238,238,245,0.4));';
  styleLabel.textContent = 'Style';
  customP.appendChild(styleLabel);
  const styleRow = document.createElement('div');
  styleRow.style.cssText = 'display:flex;gap:4px;flex-wrap:wrap;';
  const STYLES = [['solid','■ Uni'],['linear-tb','↓ Bas'],['linear-br','↘ Diag'],['radial','◉ Centre'],['radial-tl','◎ Coin']];
  const savedStyle = localStorage.getItem('tcustom_style') || 'linear-tb';
  const styleHidden = document.createElement('input');
  styleHidden.type='hidden'; styleHidden.id='tc-style'; styleHidden.value=savedStyle;
  STYLES.forEach(([val,lbl]) => {
    const sb = document.createElement('button');
    sb.textContent = lbl;
    sb.style.cssText = `padding:4px 8px;border-radius:6px;border:1px solid ${val===savedStyle?'var(--accent,#4c6ef5)':'var(--border,rgba(255,255,255,0.06))'};background:${val===savedStyle?'rgba(100,100,255,0.15)':'transparent'};color:var(--text,#eeeef5);font-size:10px;cursor:pointer;font-family:inherit;transition:all 0.15s;`;
    sb.addEventListener('click', () => {
      styleRow.querySelectorAll('button').forEach(b => { b.style.borderColor='var(--border,rgba(255,255,255,0.06))'; b.style.background='transparent'; });
      sb.style.borderColor='var(--accent,#4c6ef5)'; sb.style.background='rgba(100,100,255,0.15)';
      styleHidden.value = val;
      localStorage.setItem('tcustom_style', val);
      livePreview();
    });
    styleRow.appendChild(sb);
  });
  styleRow.appendChild(styleHidden);
  customP.appendChild(styleRow);

  // Couleurs — jusqu'à 3
  const colLabel = document.createElement('div');
  colLabel.style.cssText = 'font-size:11px;color:var(--muted,rgba(238,238,245,0.4));';
  colLabel.textContent = 'Couleurs (1-3)';
  customP.appendChild(colLabel);

  const colsWrap = document.createElement('div');
  colsWrap.style.cssText = 'display:flex;align-items:center;gap:8px;';

  const savedN = parseInt(localStorage.getItem('tcustom_n') || '2');
  const savedCols = [
    localStorage.getItem('tcustom_c1') || '#06060e',
    localStorage.getItem('tcustom_c2') || '#0d0d2e',
    localStorage.getItem('tcustom_c3') || '#1a0a2e',
  ];

  // Les 3 color pickers
  for (let i = 0; i < 3; i++) {
    const inp = document.createElement('input');
    inp.type = 'color';
    inp.id = 'tc-c' + (i+1);
    inp.value = savedCols[i];
    inp.style.cssText = `width:36px;height:32px;border:2px solid var(--border,rgba(255,255,255,0.06));background:transparent;cursor:pointer;border-radius:8px;transition:opacity 0.2s;${i >= savedN ? 'opacity:0.25;pointer-events:none;' : ''}`;
    inp.addEventListener('input', () => { localStorage.setItem('tcustom_c'+(i+1), inp.value); livePreview(); });
    colsWrap.appendChild(inp);
  }

  // Boutons − et + pour changer le nombre de couleurs
  const nWrap = document.createElement('div');
  nWrap.style.cssText = 'display:flex;align-items:center;gap:4px;margin-left:4px;';
  const nDisplay = document.createElement('span');
  nDisplay.style.cssText = 'font-size:12px;color:var(--muted,rgba(238,238,245,0.4));min-width:16px;text-align:center;';
  nDisplay.textContent = savedN;

  let currentN = savedN;
  function updateN(delta) {
    currentN = Math.max(1, Math.min(3, currentN + delta));
    localStorage.setItem('tcustom_n', currentN);
    nDisplay.textContent = currentN;
    for (let i = 0; i < 3; i++) {
      const el = document.getElementById('tc-c'+(i+1));
      if (!el) continue;
      const active = i < currentN;
      el.style.opacity = active ? '1' : '0.25';
      el.style.pointerEvents = active ? 'auto' : 'none';
    }
    livePreview();
  }

  const btnMinus = document.createElement('button');
  btnMinus.textContent = '−';
  btnMinus.style.cssText = 'width:22px;height:22px;border-radius:50%;border:1px solid var(--border,rgba(255,255,255,0.06));background:transparent;color:var(--muted,rgba(238,238,245,0.4));cursor:pointer;font-size:16px;line-height:1;font-family:inherit;';
  btnMinus.addEventListener('click', () => updateN(-1));

  const btnPlus = document.createElement('button');
  btnPlus.textContent = '+';
  btnPlus.style.cssText = 'width:22px;height:22px;border-radius:50%;border:1px solid var(--border,rgba(255,255,255,0.06));background:transparent;color:var(--muted,rgba(238,238,245,0.4));cursor:pointer;font-size:16px;line-height:1;font-family:inherit;';
  btnPlus.addEventListener('click', () => updateN(+1));

  nWrap.append(btnMinus, nDisplay, btnPlus);
  colsWrap.appendChild(nWrap);
  customP.appendChild(colsWrap);

  // Preview
  const preview = document.createElement('div');
  preview.id = 'tc-preview';
  preview.style.cssText = 'height:36px;border-radius:10px;border:1px solid var(--border,rgba(255,255,255,0.06));transition:background 0.3s;';
  customP.appendChild(preview);

  // Bouton Appliquer
  const applyBtn = document.createElement('button');
  applyBtn.textContent = '✓ Appliquer';
  applyBtn.style.cssText = 'width:100%;padding:9px;border-radius:8px;border:none;background:var(--accent,#4c6ef5);color:#fff;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit;letter-spacing:0.5px;';
  applyBtn.addEventListener('click', () => {
    applyTheme('custom');
    customP.style.display = 'none';
  });
  customP.appendChild(applyBtn);

  function livePreview() {
    const bg = buildBgValue();
    const pv = document.getElementById('tc-preview');
    if (pv) pv.style.background = bg;
  }
  setTimeout(livePreview, 50);

  menu.appendChild(customP);

  // Toggle 🌙/☀️ mode clair/sombre
  const modeToggle = document.createElement('button');
  function updateModeToggle() {
    const cur = localStorage.getItem('theme') || 'default';
    const isLight = LIGHT_THEMES.has(cur);
    modeToggle.textContent = isLight ? '🌙' : '☀️';
    modeToggle.title = isLight ? 'Passer en mode sombre' : 'Passer en mode clair';
  }
  modeToggle.style.cssText = 'width:38px;height:38px;border-radius:10px;border:1px solid var(--border,rgba(255,255,255,0.06));background:var(--surface,#0d0d1c);color:var(--muted,rgba(238,238,245,0.5));font-size:18px;cursor:pointer;backdrop-filter:blur(10px);transition:all 0.2s;display:flex;align-items:center;justify-content:center;';
  updateModeToggle();
  modeToggle.addEventListener('click', e => {
    e.stopPropagation();
    const cur = localStorage.getItem('theme') || 'default';
    const isLight = LIGHT_THEMES.has(cur);
    // Basculer vers l'opposé
    const target = isLight ? 'default' : 'light';
    applyTheme(target);
    updateModeToggle();
    menu.style.display = 'none';
    customP.style.display = 'none';
  });

  // Toggle 🎨
  const toggle = document.createElement('button');
  toggle.textContent = '🎨';
  toggle.title = 'Thèmes';
  toggle.style.cssText = 'width:38px;height:38px;border-radius:10px;border:1px solid var(--border,rgba(255,255,255,0.06));background:var(--surface,#0d0d1c);color:var(--muted,rgba(238,238,245,0.5));font-size:18px;cursor:pointer;backdrop-filter:blur(10px);transition:all 0.2s;display:flex;align-items:center;justify-content:center;';
  toggle.addEventListener('click', e => {
    e.stopPropagation();
    const o = menu.style.display === 'flex';
    menu.style.display = o ? 'none' : 'flex';
    if (o) customP.style.display = 'none';
  });
  document.addEventListener('click', e => {
    if (!wrap.contains(e.target)) { menu.style.display='none'; customP.style.display='none'; }
  });

  wrap.appendChild(menu);
  wrap.appendChild(modeToggle);
  wrap.appendChild(toggle);
  document.body.appendChild(wrap);

  // Marquer le thème actif
  applyTheme(localStorage.getItem('theme') || 'default');
}

if (document.readyState==='loading') document.addEventListener('DOMContentLoaded', buildPicker);
else buildPicker();

window._applyTheme = applyTheme;

})();

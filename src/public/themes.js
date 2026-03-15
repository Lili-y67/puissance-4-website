/**
 * themes.js — Thèmes prédéfinis (pas de custom)
 * Ne touche JAMAIS --p1/--p2 (réservés aux couleurs joueurs)
 */
(function() {

const THEMES = {
  // ── Sombres ──────────────────────────────────────────────────────────────
  default:   { label:'Défaut',     emoji:'🌑', dark:true,  vars:{ '--bg':'#06060e','--surface':'#0d0d1c','--surface2':'#13132a','--border':'rgba(255,255,255,0.06)','--text':'#eeeef5','--muted':'rgba(238,238,245,0.38)','--accent':'#4c6ef5','--grid':'#0d0d20','--cell':'#15153a','--red':'#ff2d55','--red-dim':'rgba(255,45,85,0.15)','--red-glow':'rgba(255,45,85,0.4)','--yellow':'#ffd60a','--yel-dim':'rgba(255,214,10,0.1)','--yel-glow':'rgba(255,214,10,0.4)','--green':'#30d158','--orange':'#ff9f0a' } },
  neon:      { label:'Néon',       emoji:'⚡', dark:true,  vars:{ '--bg':'linear-gradient(135deg,#050510,#0a0020,#050510)','--surface':'#0a0a20','--surface2':'#10102e','--border':'rgba(170,0,255,0.15)','--text':'#f0f0ff','--muted':'rgba(240,240,255,0.38)','--accent':'#aa00ff','--grid':'#07071a','--cell':'#04040f','--red':'#ff00aa','--red-dim':'rgba(255,0,170,0.15)','--red-glow':'rgba(255,0,170,0.6)','--yellow':'#00ffaa','--yel-dim':'rgba(0,255,170,0.1)','--yel-glow':'rgba(0,255,170,0.6)','--green':'#00ffaa','--orange':'#ff6600' } },
  fire:      { label:'Feu',        emoji:'🔥', dark:true,  vars:{ '--bg':'linear-gradient(to bottom,#0f0800,#1a0c00,#0f0500)','--surface':'#1a1000','--surface2':'#251800','--border':'rgba(255,102,0,0.12)','--text':'#fff8f0','--muted':'rgba(255,248,240,0.38)','--accent':'#ff3300','--grid':'#120900','--cell':'#0a0600','--red':'#ff6600','--red-dim':'rgba(255,102,0,0.15)','--red-glow':'rgba(255,102,0,0.6)','--yellow':'#ffdd00','--yel-dim':'rgba(255,221,0,0.1)','--yel-glow':'rgba(255,221,0,0.6)','--green':'#ffaa00','--orange':'#ff4400' } },
  ocean:     { label:'Océan',      emoji:'🌊', dark:true,  vars:{ '--bg':'linear-gradient(to bottom,#000d1a,#001428,#000a12)','--surface':'#001428','--surface2':'#001e3c','--border':'rgba(0,102,255,0.15)','--text':'#e8f4ff','--muted':'rgba(232,244,255,0.38)','--accent':'#0044cc','--grid':'#000f22','--cell':'#000812','--red':'#0066ff','--red-dim':'rgba(0,102,255,0.15)','--red-glow':'rgba(0,102,255,0.6)','--yellow':'#00ffee','--yel-dim':'rgba(0,255,238,0.1)','--yel-glow':'rgba(0,255,238,0.6)','--green':'#00ffee','--orange':'#0099ff' } },
  forest:    { label:'Forêt',      emoji:'🌿', dark:true,  vars:{ '--bg':'linear-gradient(to bottom,#040d06,#091a0b,#020a03)','--surface':'#0a1a0d','--surface2':'#122518','--border':'rgba(0,200,80,0.1)','--text':'#e8f5ec','--muted':'rgba(232,245,236,0.38)','--accent':'#00aa44','--grid':'#061008','--cell':'#030a04','--red':'#00cc55','--red-dim':'rgba(0,204,85,0.15)','--red-glow':'rgba(0,204,85,0.5)','--yellow':'#aaee00','--yel-dim':'rgba(170,238,0,0.1)','--yel-glow':'rgba(170,238,0,0.5)','--green':'#00ff88','--orange':'#88cc00' } },
  midnight:  { label:'Minuit',     emoji:'🌙', dark:true,  vars:{ '--bg':'linear-gradient(135deg,#0a0a12,#12101e,#08080f)','--surface':'#12121e','--surface2':'#1a1a2e','--border':'rgba(150,130,255,0.1)','--text':'#e8e8ff','--muted':'rgba(232,232,255,0.35)','--accent':'#6655ee','--grid':'#0d0d1a','--cell':'#080812','--red':'#8866ff','--red-dim':'rgba(136,102,255,0.15)','--red-glow':'rgba(136,102,255,0.5)','--yellow':'#ffaa44','--yel-dim':'rgba(255,170,68,0.1)','--yel-glow':'rgba(255,170,68,0.5)','--green':'#44ddaa','--orange':'#ee7744' } },
  aurora:    { label:'Aurora',     emoji:'🌌', dark:true,  vars:{ '--bg':'linear-gradient(160deg,#020818,#051a14,#0a0520,#020c1a)','--surface':'#0a1020','--surface2':'#101828','--border':'rgba(0,220,150,0.1)','--text':'#e0fff8','--muted':'rgba(224,255,248,0.38)','--accent':'#00ddaa','--grid':'#061018','--cell':'#030810','--red':'#00ccaa','--red-dim':'rgba(0,204,170,0.15)','--red-glow':'rgba(0,204,170,0.5)','--yellow':'#44ffcc','--yel-dim':'rgba(68,255,204,0.1)','--yel-glow':'rgba(68,255,204,0.5)','--green':'#00ffcc','--orange':'#44bbff' } },
  volcano:   { label:'Volcan',     emoji:'🌋', dark:true,  vars:{ '--bg':'linear-gradient(to bottom,#120000,#1a0400,#0a0000)','--surface':'#1a0800','--surface2':'#220e00','--border':'rgba(200,50,0,0.15)','--text':'#ffeee0','--muted':'rgba(255,238,224,0.38)','--accent':'#cc3300','--grid':'#100400','--cell':'#0a0200','--red':'#ff4400','--red-dim':'rgba(255,68,0,0.15)','--red-glow':'rgba(255,68,0,0.6)','--yellow':'#ffaa00','--yel-dim':'rgba(255,170,0,0.1)','--yel-glow':'rgba(255,170,0,0.6)','--green':'#ff6600','--orange':'#ff2200' } },
  galaxy:    { label:'Galaxie',    emoji:'🪐', dark:true,  vars:{ '--bg':'linear-gradient(135deg,#050012,#0a0025,#020010,#080018)','--surface':'#0c0820','--surface2':'#140e2e','--border':'rgba(120,80,255,0.12)','--text':'#ede8ff','--muted':'rgba(237,232,255,0.35)','--accent':'#7755ff','--grid':'#08061a','--cell':'#050412','--red':'#aa66ff','--red-dim':'rgba(170,102,255,0.15)','--red-glow':'rgba(170,102,255,0.5)','--yellow':'#ffcc44','--yel-dim':'rgba(255,204,68,0.1)','--yel-glow':'rgba(255,204,68,0.5)','--green':'#44eebb','--orange':'#ff8844' } },
  blood:     { label:'Blood',      emoji:'🩸', dark:true,  vars:{ '--bg':'linear-gradient(to bottom,#0d0000,#1a0000,#080000)','--surface':'#180000','--surface2':'#220000','--border':'rgba(180,0,0,0.15)','--text':'#ffe8e8','--muted':'rgba(255,232,232,0.38)','--accent':'#cc0000','--grid':'#0f0000','--cell':'#0a0000','--red':'#ff1111','--red-dim':'rgba(255,17,17,0.15)','--red-glow':'rgba(255,17,17,0.6)','--yellow':'#ff6600','--yel-dim':'rgba(255,102,0,0.1)','--yel-glow':'rgba(255,102,0,0.6)','--green':'#aa0000','--orange':'#cc2200' } },
  // ── Clairs ───────────────────────────────────────────────────────────────
  light:     { label:'Clair',      emoji:'☀️', dark:false, vars:{ '--bg':'#f5f5f7','--surface':'#ffffff','--surface2':'#ebebed','--border':'rgba(0,0,0,0.08)','--text':'#1d1d1f','--muted':'rgba(29,29,31,0.45)','--accent':'#0066cc','--grid':'#e0e0e2','--cell':'#ccccce','--red':'#cc2d55','--red-dim':'rgba(204,45,85,0.12)','--red-glow':'rgba(204,45,85,0.35)','--yellow':'#b8860b','--yel-dim':'rgba(184,134,11,0.1)','--yel-glow':'rgba(184,134,11,0.35)','--green':'#1a7a34','--orange':'#c14a00' } },
  sunrise:   { label:'Aurore',     emoji:'🌅', dark:false, vars:{ '--bg':'linear-gradient(to bottom,#fff0e8,#fde8d8,#fff5ee)','--surface':'#fff8f4','--surface2':'#fceee4','--border':'rgba(200,100,50,0.1)','--text':'#2d1a0e','--muted':'rgba(45,26,14,0.45)','--accent':'#d4500a','--grid':'#f0ddd0','--cell':'#e0c8b8','--red':'#d4500a','--red-dim':'rgba(212,80,10,0.12)','--red-glow':'rgba(212,80,10,0.35)','--yellow':'#c8880a','--yel-dim':'rgba(200,136,10,0.1)','--yel-glow':'rgba(200,136,10,0.35)','--green':'#5a8a1a','--orange':'#c03000' } },
  sky:       { label:'Ciel',       emoji:'🩵', dark:false, vars:{ '--bg':'linear-gradient(to bottom,#e8f4ff,#ddeeff,#eef6ff)','--surface':'#f5faff','--surface2':'#eaf4ff','--border':'rgba(0,80,180,0.1)','--text':'#001430','--muted':'rgba(0,20,48,0.45)','--accent':'#0055bb','--grid':'#d0e8f8','--cell':'#bcd8ee','--red':'#0055bb','--red-dim':'rgba(0,85,187,0.12)','--red-glow':'rgba(0,85,187,0.35)','--yellow':'#007799','--yel-dim':'rgba(0,119,153,0.1)','--yel-glow':'rgba(0,119,153,0.35)','--green':'#006644','--orange':'#005599' } },
  spring:    { label:'Printemps',  emoji:'🌺', dark:false, vars:{ '--bg':'linear-gradient(135deg,#fff0f5,#fff5f0,#f5fff0)','--surface':'#fff8fc','--surface2':'#ffeef6','--border':'rgba(180,80,120,0.1)','--text':'#2a0a1a','--muted':'rgba(42,10,26,0.45)','--accent':'#cc2266','--grid':'#f0d8e8','--cell':'#e0c0d5','--red':'#cc2266','--red-dim':'rgba(204,34,102,0.12)','--red-glow':'rgba(204,34,102,0.35)','--yellow':'#aa6600','--yel-dim':'rgba(170,102,0,0.1)','--yel-glow':'rgba(170,102,0,0.35)','--green':'#228844','--orange':'#bb4400' } },
  mint:      { label:'Menthe',     emoji:'🍃', dark:false, vars:{ '--bg':'linear-gradient(to bottom,#eafaf0,#e0f5ea,#f0faf4)','--surface':'#f5fdf8','--surface2':'#e8f8ee','--border':'rgba(0,140,70,0.1)','--text':'#062010','--muted':'rgba(6,32,16,0.45)','--accent':'#008844','--grid':'#cceedc','--cell':'#b8e4ca','--red':'#008844','--red-dim':'rgba(0,136,68,0.12)','--red-glow':'rgba(0,136,68,0.35)','--yellow':'#558800','--yel-dim':'rgba(85,136,0,0.1)','--yel-glow':'rgba(85,136,0,0.35)','--green':'#006633','--orange':'#447700' } },
};

const LIGHT_THEMES = new Set(Object.entries(THEMES).filter(([,t])=>!t.dark).map(([k])=>k));

let currentThemeName = 'default';

function applyTheme(name) {
  currentThemeName = name;
  const theme = THEMES[name] || THEMES.default;
  const root = document.documentElement;
  for (const [k,v] of Object.entries(theme.vars)) root.style.setProperty(k, v);
  localStorage.setItem('theme', name);
  document.querySelectorAll('.theme-pick-btn').forEach(b => {
    const active = b.dataset.theme === name;
    b.classList.toggle('active', active);
    b.style.outline = active ? '2px solid var(--accent,#4c6ef5)' : 'none';
  });
  // Mettre à jour toggle mode
  const mt = document.getElementById('theme-mode-toggle');
  if (mt) { mt.textContent = theme.dark ? '☀️' : '🌙'; mt.title = theme.dark ? 'Mode clair' : 'Mode sombre'; }
}

function buildPicker() {
  applyTheme(localStorage.getItem('theme') || 'default');

  const wrap = document.createElement('div');
  wrap.id = 'theme-picker';
  wrap.style.cssText = 'position:fixed;bottom:20px;right:20px;z-index:9999;display:flex;flex-direction:column;align-items:flex-end;gap:6px;';

  // ── Menu ─────────────────────────────────────────────────────────────────
  const menu = document.createElement('div');
  menu.style.cssText = 'display:none;flex-direction:column;gap:2px;background:var(--surface,#0d0d1c);border:1px solid var(--border,rgba(255,255,255,0.06));border-radius:16px;padding:10px;box-shadow:0 8px 40px rgba(0,0,0,0.7);width:180px;max-height:80vh;overflow-y:auto;';

  function makeSection(label) {
    const s = document.createElement('div');
    s.style.cssText = 'font-size:9px;letter-spacing:2px;text-transform:uppercase;color:var(--muted,rgba(238,238,245,0.35));padding:6px 4px 3px;font-weight:700;';
    s.textContent = label;
    return s;
  }

  const darkThemes = Object.entries(THEMES).filter(([,t]) => t.dark);
  const lightThemes = Object.entries(THEMES).filter(([,t]) => !t.dark);

  menu.appendChild(makeSection('🌑 Sombres'));
  darkThemes.forEach(([key, theme]) => addThemeBtn(menu, key, theme));
  menu.appendChild(makeSection('☀️ Clairs'));
  lightThemes.forEach(([key, theme]) => addThemeBtn(menu, key, theme));

  function addThemeBtn(parent, key, theme) {
    const btn = document.createElement('button');
    btn.className = 'theme-pick-btn';
    btn.dataset.theme = key;

    // Mini preview du fond
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

  // ── Bouton toggle mode ────────────────────────────────────────────────────
  const modeToggle = document.createElement('button');
  modeToggle.id = 'theme-mode-toggle';
  const curTheme = THEMES[localStorage.getItem('theme')] || THEMES.default;
  modeToggle.textContent = curTheme.dark ? '☀️' : '🌙';
  modeToggle.title = curTheme.dark ? 'Mode clair' : 'Mode sombre';
  modeToggle.style.cssText = 'width:38px;height:38px;border-radius:10px;border:1px solid var(--border,rgba(255,255,255,0.06));background:var(--surface,#0d0d1c);font-size:18px;cursor:pointer;backdrop-filter:blur(10px);transition:all 0.2s;display:flex;align-items:center;justify-content:center;';
  modeToggle.addEventListener('click', e => {
    e.stopPropagation();
    const cur = localStorage.getItem('theme') || 'default';
    const isDark = THEMES[cur]?.dark ?? true;
    // Trouver l'équivalent dans l'autre mode
    const target = isDark
      ? (lightThemes[0]?.[0] || 'light')
      : (darkThemes[0]?.[0] || 'default');
    applyTheme(target);
    menu.style.display = 'none';
  });

  // ── Bouton 🎨 ─────────────────────────────────────────────────────────────
  const toggle = document.createElement('button');
  toggle.textContent = '🎨';
  toggle.title = 'Thèmes';
  toggle.style.cssText = 'width:38px;height:38px;border-radius:10px;border:1px solid var(--border,rgba(255,255,255,0.06));background:var(--surface,#0d0d1c);font-size:18px;cursor:pointer;backdrop-filter:blur(10px);transition:all 0.2s;display:flex;align-items:center;justify-content:center;';
  toggle.addEventListener('click', e => {
    e.stopPropagation();
    menu.style.display = menu.style.display === 'flex' ? 'none' : 'flex';
  });
  document.addEventListener('click', e => {
    if (!wrap.contains(e.target)) menu.style.display = 'none';
  });

  wrap.appendChild(menu);
  wrap.appendChild(modeToggle);
  wrap.appendChild(toggle);
  document.body.appendChild(wrap);
  applyTheme(localStorage.getItem('theme') || 'default');
}

if (document.readyState==='loading') document.addEventListener('DOMContentLoaded', buildPicker);
else buildPicker();

window._applyTheme = applyTheme;

})();

/**
 * themes.js — Système de thèmes v2
 * Ne touche JAMAIS --p1/--p2 (réservés aux couleurs joueurs)
 */
(function() {

const THEMES = {
  default:  { label:'Défaut',  emoji:'🌑', vars:{ '--bg':'#06060e','--surface':'#0d0d1c','--surface2':'#13132a','--border':'rgba(255,255,255,0.06)','--text':'#eeeef5','--muted':'rgba(238,238,245,0.38)','--accent':'#4c6ef5','--grid':'#0d0d20','--cell':'#15153a','--red':'#ff2d55','--red-dim':'rgba(255,45,85,0.15)','--red-glow':'rgba(255,45,85,0.4)','--yellow':'#ffd60a','--yel-dim':'rgba(255,214,10,0.1)','--yel-glow':'rgba(255,214,10,0.4)','--green':'#30d158','--orange':'#ff9f0a' } },
  neon:     { label:'Néon',    emoji:'⚡', vars:{ '--bg':'#050510','--surface':'#0a0a20','--surface2':'#10102e','--border':'rgba(170,0,255,0.15)','--text':'#f0f0ff','--muted':'rgba(240,240,255,0.38)','--accent':'#aa00ff','--grid':'#07071a','--cell':'#04040f','--red':'#ff00aa','--red-dim':'rgba(255,0,170,0.15)','--red-glow':'rgba(255,0,170,0.6)','--yellow':'#00ffaa','--yel-dim':'rgba(0,255,170,0.1)','--yel-glow':'rgba(0,255,170,0.6)','--green':'#00ffaa','--orange':'#ff6600' } },
  fire:     { label:'Feu',     emoji:'🔥', vars:{ '--bg':'#0f0800','--surface':'#1a1000','--surface2':'#251800','--border':'rgba(255,102,0,0.12)','--text':'#fff8f0','--muted':'rgba(255,248,240,0.38)','--accent':'#ff3300','--grid':'#120900','--cell':'#0a0600','--red':'#ff6600','--red-dim':'rgba(255,102,0,0.15)','--red-glow':'rgba(255,102,0,0.6)','--yellow':'#ffdd00','--yel-dim':'rgba(255,221,0,0.1)','--yel-glow':'rgba(255,221,0,0.6)','--green':'#ffaa00','--orange':'#ff4400' } },
  ocean:    { label:'Océan',   emoji:'🌊', vars:{ '--bg':'#000d1a','--surface':'#001428','--surface2':'#001e3c','--border':'rgba(0,102,255,0.15)','--text':'#e8f4ff','--muted':'rgba(232,244,255,0.38)','--accent':'#0044cc','--grid':'#000f22','--cell':'#000812','--red':'#0066ff','--red-dim':'rgba(0,102,255,0.15)','--red-glow':'rgba(0,102,255,0.6)','--yellow':'#00ffee','--yel-dim':'rgba(0,255,238,0.1)','--yel-glow':'rgba(0,255,238,0.6)','--green':'#00ffee','--orange':'#0099ff' } },
  pastel:   { label:'Pastel',  emoji:'🌸', vars:{ '--bg':'#f0eef8','--surface':'#e8e4f4','--surface2':'#ddd8f0','--border':'rgba(0,0,0,0.08)','--text':'#2a2040','--muted':'rgba(42,32,64,0.45)','--accent':'#9b5be0','--grid':'#ddd8f0','--cell':'#c8c0e8','--red':'#e05b8a','--red-dim':'rgba(224,91,138,0.15)','--red-glow':'rgba(224,91,138,0.4)','--yellow':'#5b9ee0','--yel-dim':'rgba(91,158,224,0.1)','--yel-glow':'rgba(91,158,224,0.4)','--green':'#5bc87a','--orange':'#e08c5b' } },
  forest:   { label:'Forêt',   emoji:'🌿', vars:{ '--bg':'#040d06','--surface':'#0a1a0d','--surface2':'#122518','--border':'rgba(0,200,80,0.1)','--text':'#e8f5ec','--muted':'rgba(232,245,236,0.38)','--accent':'#00aa44','--grid':'#061008','--cell':'#030a04','--red':'#00cc55','--red-dim':'rgba(0,204,85,0.15)','--red-glow':'rgba(0,204,85,0.5)','--yellow':'#aaee00','--yel-dim':'rgba(170,238,0,0.1)','--yel-glow':'rgba(170,238,0,0.5)','--green':'#00ff88','--orange':'#88cc00' } },
  midnight: { label:'Minuit',  emoji:'🌙', vars:{ '--bg':'#0a0a12','--surface':'#12121e','--surface2':'#1a1a2e','--border':'rgba(150,130,255,0.1)','--text':'#e8e8ff','--muted':'rgba(232,232,255,0.35)','--accent':'#6655ee','--grid':'#0d0d1a','--cell':'#080812','--red':'#8866ff','--red-dim':'rgba(136,102,255,0.15)','--red-glow':'rgba(136,102,255,0.5)','--yellow':'#ffaa44','--yel-dim':'rgba(255,170,68,0.1)','--yel-glow':'rgba(255,170,68,0.5)','--green':'#44ddaa','--orange':'#ee7744' } },
};

let currentThemeName = 'default';

function hexToRgba(hex, a) {
  const r=parseInt(hex.slice(1,3),16), g=parseInt(hex.slice(3,5),16), b=parseInt(hex.slice(5,7),16);
  return `rgba(${r},${g},${b},${a})`;
}

function applyTheme(name, customVars) {
  currentThemeName = name;
  let vars;
  if (name === 'custom') {
    try { vars = customVars || JSON.parse(localStorage.getItem('theme_custom') || 'null')?.vars; } catch {}
    if (!vars) vars = THEMES.default.vars;
  } else {
    vars = (THEMES[name] || THEMES.default).vars;
  }
  const root = document.documentElement;
  for (const [k,v] of Object.entries(vars)) root.style.setProperty(k, v);
  localStorage.setItem('theme', name);
  document.querySelectorAll('.theme-pick-btn').forEach(b => {
    const active = b.dataset.theme === name;
    b.classList.toggle('active', active);
    b.style.borderColor = active ? 'var(--accent)' : 'transparent';
    b.style.background  = active ? 'rgba(100,100,255,0.12)' : 'transparent';
  });
}

function buildCustomVars() {
  const get = (id, def) => { const el=document.getElementById('tc-'+id); const v=el?el.value:def; localStorage.setItem('tcustom_'+id,v); return v; };
  const c1  = get('bg1','#06060e');
  const c2  = get('bg2','#0d0d2e');
  const c3  = get('bg3','#1a0a2e');
  const use3 = document.getElementById('tc-use3')?.checked ?? (localStorage.getItem('tcustom_use3')==='1');
  const style = document.getElementById('tc-style')?.value ?? localStorage.getItem('tcustom_style') ?? 'linear-tb';
  localStorage.setItem('tcustom_use3', use3 ? '1' : '0');
  localStorage.setItem('tcustom_style', style);

  // Construire le fond
  const stops = use3 ? `${c1}, ${c2}, ${c3}` : `${c1}, ${c2}`;
  let bg;
  if (style === 'solid')       bg = c1;
  else if (style === 'linear-tb')  bg = `linear-gradient(to bottom, ${stops})`;
  else if (style === 'linear-br')  bg = `linear-gradient(135deg, ${stops})`;
  else if (style === 'radial') bg = `radial-gradient(ellipse at center, ${stops})`;
  else if (style === 'radial-tl') bg = `radial-gradient(ellipse at top left, ${stops})`;
  else bg = `linear-gradient(to bottom, ${stops})`;

  const surf = get('surface','#0d0d1c');
  const acc  = get('accent','#4c6ef5');
  const txt  = get('text','#eeeef5');
  const grid = get('grid','#0a0a18');
  const cell = get('cell','#07071a');
  const r=parseInt(surf.slice(1,3),16), g=parseInt(surf.slice(3,5),16), bb=parseInt(surf.slice(5,7),16);
  return {
    '--bg':bg,'--surface':surf,'--surface2':`rgb(${Math.min(255,r+12)},${Math.min(255,g+12)},${Math.min(255,bb+12)})`,
    '--border':hexToRgba(acc,0.12),'--text':txt,'--muted':hexToRgba(txt,0.4),
    '--accent':acc,'--grid':grid,'--cell':cell,
    '--red':acc,'--red-dim':hexToRgba(acc,0.15),'--red-glow':hexToRgba(acc,0.45),
    '--yellow':'#ffd60a','--yel-dim':'rgba(255,214,10,0.1)','--yel-glow':'rgba(255,214,10,0.4)',
    '--green':'#30d158','--orange':'#ff9f0a',
  };
}

function buildPicker() {
  // Appliquer thème sauvegardé immédiatement
  applyTheme(localStorage.getItem('theme') || 'default');

  const wrap = document.createElement('div');
  wrap.style.cssText = 'position:fixed;bottom:20px;right:20px;z-index:9999;display:flex;flex-direction:column;align-items:flex-end;gap:8px;';

  const menu = document.createElement('div');
  menu.style.cssText = 'display:none;flex-direction:column;gap:3px;background:var(--surface);border:1px solid var(--border);border-radius:16px;padding:10px;box-shadow:0 8px 40px rgba(0,0,0,0.7);min-width:155px;';

  // Thèmes prédéfinis
  for (const [key, theme] of Object.entries(THEMES)) {
    const btn = document.createElement('button');
    btn.className = 'theme-pick-btn';
    btn.dataset.theme = key;
    btn.textContent = theme.emoji + ' ' + theme.label;
    btn.style.cssText = 'width:100%;padding:7px 11px;border-radius:8px;border:1px solid transparent;background:transparent;color:var(--text);font-size:13px;font-weight:600;cursor:pointer;text-align:left;transition:all 0.15s;font-family:inherit;';
    btn.addEventListener('click', () => { applyTheme(key); customP.style.display='none'; });
    btn.addEventListener('mouseenter', () => { if(!btn.classList.contains('active')) btn.style.background='rgba(255,255,255,0.05)'; });
    btn.addEventListener('mouseleave', () => { if(!btn.classList.contains('active')) btn.style.background='transparent'; });
    menu.appendChild(btn);
  }

  // Séparateur + Custom
  const sep = document.createElement('div');
  sep.style.cssText = 'height:1px;background:var(--border);margin:4px 0;';
  menu.appendChild(sep);

  const customBtn = document.createElement('button');
  customBtn.className = 'theme-pick-btn';
  customBtn.dataset.theme = 'custom';
  customBtn.textContent = '🎨 Custom';
  customBtn.style.cssText = 'width:100%;padding:7px 11px;border-radius:8px;border:1px solid transparent;background:transparent;color:var(--text);font-size:13px;font-weight:600;cursor:pointer;text-align:left;transition:all 0.15s;font-family:inherit;';
  customBtn.addEventListener('click', () => { customP.style.display = customP.style.display==='none'?'flex':'none'; });
  menu.appendChild(customBtn);

  // Panel custom
  const customP = document.createElement('div');
  customP.style.cssText = 'display:none;flex-direction:column;gap:8px;background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:12px;margin-top:4px;';
  // Section Fond dégradé
  const bgSec = document.createElement('div');
  bgSec.style.cssText = 'display:flex;flex-direction:column;gap:6px;';

  const bgTitle = document.createElement('div');
  bgTitle.style.cssText = 'font-size:10px;letter-spacing:1.5px;text-transform:uppercase;color:var(--muted);';
  bgTitle.textContent = '🎨 Arrière-plan';
  bgSec.appendChild(bgTitle);

  // Style selector
  const styleRow = document.createElement('div');
  styleRow.style.cssText = 'display:flex;gap:4px;flex-wrap:wrap;';
  const styles = [['solid','Uni'],['linear-tb','↓ Linéaire'],['linear-br','↘ Diagonal'],['radial','◉ Radial'],['radial-tl','◎ Coin']];
  const savedStyle = localStorage.getItem('tcustom_style') || 'linear-tb';
  styles.forEach(([val,lbl]) => {
    const sb = document.createElement('button');
    sb.id = 'tcstyle-'+val;
    sb.textContent = lbl;
    sb.dataset.val = val;
    sb.style.cssText = `padding:3px 7px;border-radius:6px;border:1px solid ${val===savedStyle?'var(--accent)':'var(--border)'};background:${val===savedStyle?'rgba(100,100,255,0.15)':'transparent'};color:var(--text);font-size:10px;cursor:pointer;font-family:inherit;transition:all 0.15s;`;
    sb.addEventListener('click', () => {
      document.querySelectorAll('[id^="tcstyle-"]').forEach(b => { b.style.borderColor='var(--border)'; b.style.background='transparent'; });
      sb.style.borderColor='var(--accent)'; sb.style.background='rgba(100,100,255,0.15)';
      document.getElementById('tc-style').value = val;
      localStorage.setItem('tcustom_style', val);
      livePreview();
    });
    styleRow.appendChild(sb);
  });
  const styleInput = document.createElement('input');
  styleInput.type='hidden'; styleInput.id='tc-style'; styleInput.value=savedStyle;
  styleRow.appendChild(styleInput);
  bgSec.appendChild(styleRow);

  // Couleurs dégradé
  const colorRow = document.createElement('div');
  colorRow.style.cssText = 'display:flex;align-items:center;gap:8px;';
  const use3saved = localStorage.getItem('tcustom_use3')==='1';
  const colDefs = [['bg1','#06060e'],['bg2','#0d0d2e'],['bg3','#1a0a2e']];
  colDefs.forEach(([k,def],i) => {
    const saved = localStorage.getItem('tcustom_'+k) || def;
    const inp = document.createElement('input');
    inp.type='color'; inp.id='tc-'+k; inp.value=saved;
    inp.style.cssText = `width:32px;height:28px;border:none;background:transparent;cursor:pointer;border-radius:6px;${i===2&&!use3saved?'opacity:0.3;pointer-events:none;':''}`;
    inp.addEventListener('input', livePreview);
    colorRow.appendChild(inp);
    if (i===1) {
      // Toggle 3ème couleur
      const tog = document.createElement('button');
      tog.id='tc-use3-btn'; tog.title='Ajouter une 3ème couleur';
      tog.textContent = use3saved ? '−' : '+';
      tog.style.cssText = 'width:22px;height:22px;border-radius:50%;border:1px solid var(--border);background:transparent;color:var(--muted);cursor:pointer;font-size:14px;line-height:1;';
      tog.addEventListener('click', () => {
        const cb = document.getElementById('tc-use3');
        cb.checked = !cb.checked;
        localStorage.setItem('tcustom_use3', cb.checked?'1':'0');
        const c3inp = document.getElementById('tc-bg3');
        if (c3inp) { c3inp.style.opacity=cb.checked?'1':'0.3'; c3inp.style.pointerEvents=cb.checked?'auto':'none'; }
        tog.textContent = cb.checked ? '−' : '+';
        livePreview();
      });
      colorRow.appendChild(tog);
      const cb = document.createElement('input');
      cb.type='checkbox'; cb.id='tc-use3'; cb.checked=use3saved; cb.style.display='none';
      colorRow.appendChild(cb);
    }
  });
  bgSec.appendChild(colorRow);

  // Preview miniature
  const preview = document.createElement('div');
  preview.id = 'tc-preview';
  preview.style.cssText = 'height:32px;border-radius:8px;border:1px solid var(--border);transition:background 0.3s;';
  bgSec.appendChild(preview);
  customP.appendChild(bgSec);

  // Séparateur
  const sep2 = document.createElement('div');
  sep2.style.cssText = 'height:1px;background:var(--border);margin:2px 0;';
  customP.appendChild(sep2);

  // Autres couleurs
  const otherTitle = document.createElement('div');
  otherTitle.style.cssText = 'font-size:10px;letter-spacing:1.5px;text-transform:uppercase;color:var(--muted);margin-bottom:2px;';
  otherTitle.textContent = '⚙️ Interface';
  customP.appendChild(otherTitle);

  const rows = [['surface','Surface','#0d0d1c'],['accent','Accent','#4c6ef5'],['text','Texte','#eeeef5'],['grid','Plateau','#0a0a18'],['cell','Cellules','#07071a']];
  rows.forEach(([k,label,def]) => {
    const saved = localStorage.getItem('tcustom_'+k) || def;
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:8px;';
    const inp2 = document.createElement('input');
    inp2.type='color'; inp2.id='tc-'+k; inp2.value=saved;
    inp2.style.cssText='width:32px;height:24px;border:none;background:transparent;cursor:pointer;border-radius:4px;';
    inp2.addEventListener('input', livePreview);
    row.innerHTML = `<span style="font-size:12px;color:var(--muted)">${label}</span>`;
    row.appendChild(inp2);
    customP.appendChild(row);
  });

  function livePreview() {
    const c1v = document.getElementById('tc-bg1')?.value||'#06060e';
    const c2v = document.getElementById('tc-bg2')?.value||'#0d0d2e';
    const c3v = document.getElementById('tc-bg3')?.value||'#1a0a2e';
    const u3  = document.getElementById('tc-use3')?.checked;
    const stv = document.getElementById('tc-style')?.value||'linear-tb';
    const stops = u3 ? `${c1v}, ${c2v}, ${c3v}` : `${c1v}, ${c2v}`;
    let bg2;
    if(stv==='solid') bg2=c1v;
    else if(stv==='linear-tb') bg2=`linear-gradient(to bottom, ${stops})`;
    else if(stv==='linear-br') bg2=`linear-gradient(135deg, ${stops})`;
    else if(stv==='radial') bg2=`radial-gradient(ellipse at center, ${stops})`;
    else if(stv==='radial-tl') bg2=`radial-gradient(ellipse at top left, ${stops})`;
    else bg2=`linear-gradient(to bottom, ${stops})`;
    const pv = document.getElementById('tc-preview');
    if(pv) pv.style.background = bg2;
  }
  setTimeout(livePreview, 50);
  const applyBtn2 = document.createElement('button');
  applyBtn2.textContent = 'Appliquer';
  applyBtn2.style.cssText = 'width:100%;padding:8px;border-radius:8px;border:none;background:var(--accent);color:#fff;font-size:12px;font-weight:700;cursor:pointer;margin-top:4px;font-family:inherit;';
  applyBtn2.addEventListener('click', () => {
    const vars = buildCustomVars();
    localStorage.setItem('theme_custom', JSON.stringify({vars}));
    applyTheme('custom', vars);
  });
  customP.appendChild(applyBtn2);
  menu.appendChild(customP);

  // Toggle
  const toggle = document.createElement('button');
  toggle.textContent = '🎨';
  toggle.title = 'Thèmes';
  toggle.style.cssText = 'width:38px;height:38px;border-radius:10px;border:1px solid var(--border);background:var(--surface);color:var(--muted);font-size:18px;cursor:pointer;backdrop-filter:blur(10px);transition:all 0.2s;display:flex;align-items:center;justify-content:center;';
  toggle.addEventListener('click', e => { e.stopPropagation(); const o=menu.style.display==='flex'; menu.style.display=o?'none':'flex'; if(o)customP.style.display='none'; });
  document.addEventListener('click', e => { if(!wrap.contains(e.target)){menu.style.display='none';customP.style.display='none';} });

  wrap.appendChild(menu);
  wrap.appendChild(toggle);
  document.body.appendChild(wrap);

  // Marquer le thème actif
  applyTheme(localStorage.getItem('theme') || 'default');
}

if (document.readyState==='loading') document.addEventListener('DOMContentLoaded', buildPicker);
else buildPicker();

window._applyTheme = applyTheme;

})();

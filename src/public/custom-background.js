(function () {
  const MOBILE_QUERY = '(max-width: 820px)';
  const OPACITY_KEY = 'customBackgroundOpacity';
  let styleInjected = false;
  let resizeBound = false;

  function injectStyle() {
    if (styleInjected || document.getElementById('custom-profile-bg-style')) return;
    const style = document.createElement('style');
    style.id = 'custom-profile-bg-style';
    style.textContent = `
      body.custom-profile-bg-active{
        background-image:none !important;
        background-color:#090914 !important;
      }
      #custom-profile-bg-layer{
        position:fixed;
        inset:0;
        z-index:0;
        pointer-events:none;
        opacity:1;
        background-position:center center;
        background-repeat:no-repeat;
        background-size:cover;
        filter:none;
      }
      body.custom-profile-bg-active .bg-grid{display:none !important;}
      body.custom-profile-bg-active .scanlines{z-index:2 !important;}
      body.custom-profile-bg-active > *:not(#custom-profile-bg-layer):not(.bg-grid):not(.scanlines):not(script):not(style){
        position:relative;
        z-index:3;
      }
      #custom-profile-bg-controls{
        display:none;
        position:fixed;
        left:16px;
        bottom:16px;
        z-index:99998;
        width:min(280px,calc(100vw - 24px));
        padding:12px 14px;
        border-radius:16px;
        background:linear-gradient(180deg,rgba(14,14,28,.94),rgba(10,10,22,.94));
        border:1px solid rgba(255,255,255,.08);
        box-shadow:0 16px 36px rgba(0,0,0,.38);
        color:#eef2ff;
        font-family:Barlow,Segoe UI,Arial,sans-serif;
      }
      #custom-profile-bg-controls.show{display:block}
      #custom-profile-bg-controls label{
        display:flex;
        align-items:center;
        justify-content:space-between;
        gap:12px;
        font-family:"Barlow Condensed",Segoe UI,Arial,sans-serif;
        font-size:15px;
        font-weight:800;
        letter-spacing:1px;
        text-transform:uppercase;
        margin-bottom:8px;
      }
      #custom-profile-bg-controls input{width:100%;accent-color:#85ebff}
      #custom-profile-bg-controls .meta{
        margin-top:8px;
        font-size:11px;
        color:rgba(238,242,255,.66);
        line-height:1.4;
      }
    `;
    document.head.appendChild(style);
    styleInjected = true;
  }

  function getPlayerFromStorage() {
    try {
      const raw = localStorage.getItem('player') || sessionStorage.getItem('player');
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function selectBackground(player) {
    if (!player) return '';
    const desktop = String(player.custom_bg_desktop || '').trim();
    const mobile = String(player.custom_bg_mobile || '').trim();
    const isMobile = window.matchMedia(MOBILE_QUERY).matches;
    if (isMobile) return mobile || desktop || '';
    return desktop || mobile || '';
  }

  function ensureLayer() {
    injectStyle();
    let layer = document.getElementById('custom-profile-bg-layer');
    if (!layer) {
      layer = document.createElement('div');
      layer.id = 'custom-profile-bg-layer';
      document.body.insertBefore(layer, document.body.firstChild || null);
    }
    return layer;
  }

  function ensureControls() {
    injectStyle();
    let box = document.getElementById('custom-profile-bg-controls');
    if (box) return box;
    box = document.createElement('div');
    box.id = 'custom-profile-bg-controls';
    box.innerHTML = `
      <label>
        <span>Transparence</span>
        <strong id="custom-profile-bg-opacity-label">100%</strong>
      </label>
      <input id="custom-profile-bg-opacity-input" type="range" min="0" max="100" step="1" value="100">
      <div class="meta">Ajuste la visibilité de ton fond personnalisé.</div>
    `;
    document.body.appendChild(box);
    const input = box.querySelector('#custom-profile-bg-opacity-input');
    const label = box.querySelector('#custom-profile-bg-opacity-label');
    const stored = Math.max(0, Math.min(100, Number(localStorage.getItem(OPACITY_KEY) || '100') || 100));
    input.value = String(stored);
    label.textContent = `${stored}%`;
    input.addEventListener('input', () => {
      const val = Math.max(0, Math.min(100, Number(input.value || '100') || 100));
      localStorage.setItem(OPACITY_KEY, String(val));
      label.textContent = `${val}%`;
      const layer = document.getElementById('custom-profile-bg-layer');
      if (layer) layer.style.opacity = String(val / 100);
    });
    return box;
  }

  function applyCustomBackground(player) {
    const src = selectBackground(player);
    const layer = ensureLayer();
    const controls = ensureControls();
    const opacity = Math.max(0, Math.min(100, Number(localStorage.getItem(OPACITY_KEY) || '100') || 100));
    if (!src) {
      layer.style.backgroundImage = '';
      layer.style.display = 'none';
      controls.classList.remove('show');
      document.body.classList.remove('custom-profile-bg-active');
      return;
    }
    layer.style.display = 'block';
    layer.style.opacity = String(opacity / 100);
    layer.style.backgroundImage = `url("${src.replace(/"/g, '\\"')}")`;
    controls.classList.add('show');
    document.body.classList.add('custom-profile-bg-active');
  }

  async function refreshCustomBackground() {
    const player = getPlayerFromStorage();
    if (!player?.id) {
      applyCustomBackground(null);
      return;
    }
    try {
      const res = await fetch(`/api/players/${player.id}`, { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        if (data?.player) {
          applyCustomBackground(data.player);
          return;
        }
      }
    } catch (e) {}
    applyCustomBackground(player);
  }

  window.refreshCustomBackground = refreshCustomBackground;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', refreshCustomBackground, { once: true });
  } else {
    refreshCustomBackground();
  }

  if (!resizeBound) {
    resizeBound = true;
    window.addEventListener('resize', refreshCustomBackground, { passive: true });
    window.addEventListener('orientationchange', refreshCustomBackground, { passive: true });
  }
})();

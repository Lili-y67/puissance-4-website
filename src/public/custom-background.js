(function () {
  const MOBILE_QUERY = '(max-width: 820px)';
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
      body.custom-profile-bg-active .bg-grid{z-index:1 !important;}
      body.custom-profile-bg-active .scanlines{z-index:2 !important;}
      body.custom-profile-bg-active > *:not(#custom-profile-bg-layer):not(.bg-grid):not(.scanlines):not(script):not(style){
        position:relative;
        z-index:3;
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

  function applyCustomBackground(player) {
    const src = selectBackground(player);
    const layer = ensureLayer();
    if (!src) {
      layer.style.backgroundImage = '';
      layer.style.display = 'none';
      document.body.classList.remove('custom-profile-bg-active');
      return;
    }
    layer.style.display = 'block';
    layer.style.backgroundImage = `url("${src.replace(/"/g, '\\"')}")`;
    document.body.classList.add('custom-profile-bg-active');
  }

  function patchStoredPlayer(patch) {
    try {
      const raw = localStorage.getItem('player');
      if (raw) localStorage.setItem('player', JSON.stringify({ ...JSON.parse(raw), ...patch }));
    } catch (e) {}
    try {
      const raw = sessionStorage.getItem('player');
      if (raw) sessionStorage.setItem('player', JSON.stringify({ ...JSON.parse(raw), ...patch }));
    } catch (e) {}
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
          patchStoredPlayer({
            custom_bg_desktop: data.player.custom_bg_desktop || '',
            custom_bg_mobile: data.player.custom_bg_mobile || '',
            is_perso: data.player.is_perso || 0,
          });
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

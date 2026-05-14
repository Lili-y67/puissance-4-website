(function () {
  const STYLE_ID = 'p4-custom-background-style';
  const LAYER_ID = 'p4-custom-background-layer';
  const DARK_ID = 'p4-custom-background-dim';

  function readStoredPlayer() {
    try {
      return JSON.parse(localStorage.getItem('player') || sessionStorage.getItem('player') || '{}');
    } catch {
      return {};
    }
  }

  function canUseBackground(player) {
    return !!player && (Number(player.is_perso || 0) === 1 || String(player.role || '').toLowerCase() === 'admin');
  }

  function isSafeImage(src) {
    return /^\/uploads\/backgrounds\/[a-zA-Z0-9_.-]+\.(png|jpe?g|webp|gif)$/i.test(String(src || ''));
  }

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #${LAYER_ID}{position:fixed;inset:0;z-index:-3;pointer-events:none;background-repeat:no-repeat;background-position:center;background-attachment:fixed;opacity:var(--p4-bg-opacity,.28);background-size:var(--p4-bg-size,cover);filter:saturate(1.08) contrast(1.04);}
      #${DARK_ID}{position:fixed;inset:0;z-index:-2;pointer-events:none;background:radial-gradient(circle at 50% 16%,rgba(255,255,255,.04),transparent 34%),linear-gradient(180deg,rgba(4,4,10,.28),rgba(4,4,10,.72));}
      body.p4-has-custom-background{background-color:#05050b!important;background-image:none!important;}
      body.p4-has-custom-background .bg-grid{display:none!important;}
    `;
    document.head.appendChild(style);
  }

  function clearBackground() {
    document.body.classList.remove('p4-has-custom-background');
    document.getElementById(LAYER_ID)?.remove();
    document.getElementById(DARK_ID)?.remove();
  }

  function applyBackground(player) {
    if (!canUseBackground(player)) return clearBackground();
    const mobile = window.matchMedia('(max-width: 760px)').matches;
    const src = mobile
      ? String(player.custom_bg_mobile || player.custom_bg_desktop || '')
      : String(player.custom_bg_desktop || '');
    if (!isSafeImage(src)) return clearBackground();

    ensureStyle();
    let layer = document.getElementById(LAYER_ID);
    if (!layer) {
      layer = document.createElement('div');
      layer.id = LAYER_ID;
      document.body.prepend(layer);
    }
    let dim = document.getElementById(DARK_ID);
    if (!dim) {
      dim = document.createElement('div');
      dim.id = DARK_ID;
      document.body.prepend(dim);
    }
    const opacity = Math.max(0.08, Math.min(0.7, Number(player.custom_bg_opacity || 0.28)));
    const allowedSizes = new Set(['cover', 'contain', 'auto', '120%', '140%', '160%']);
    const size = allowedSizes.has(String(player.custom_bg_size || '')) ? String(player.custom_bg_size) : 'cover';
    layer.style.backgroundImage = `url("${src}")`;
    layer.style.setProperty('--p4-bg-opacity', String(opacity));
    layer.style.setProperty('--p4-bg-size', size);
    document.body.classList.add('p4-has-custom-background');
  }

  async function refreshOwnPlayer(player) {
    if (!player?.id) return player;
    try {
      const res = await fetch(`/api/players/${encodeURIComponent(player.id)}`, { cache: 'no-store' });
      if (!res.ok) return player;
      const payload = await res.json();
      const fresh = payload?.player || payload;
      const merged = { ...player, ...fresh };
      localStorage.setItem('player', JSON.stringify(merged));
      sessionStorage.setItem('player', JSON.stringify(merged));
      return merged;
    } catch {
      return player;
    }
  }

  async function init() {
    const stored = readStoredPlayer();
    applyBackground(stored);
    const fresh = await refreshOwnPlayer(stored);
    applyBackground(fresh);
  }

  window.P4CustomBackground = { apply: applyBackground, refresh: init };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
  window.addEventListener('resize', () => applyBackground(readStoredPlayer()));
})();

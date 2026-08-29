(function () {
  const STORAGE_KEY = 'p4_theme';
  const root = document.documentElement;
  let deferredInstallPrompt = null;

  function getSavedTheme() {
    try {
      return localStorage.getItem(STORAGE_KEY) === 'light' ? 'light' : 'dark';
    } catch (error) {
      return 'dark';
    }
  }

  function applyTheme(theme) {
    const next = theme === 'light' ? 'light' : 'dark';
    root.dataset.theme = next;
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch (error) {}

    const btn = document.getElementById('p4-theme-toggle');
    if (btn) {
      const icon = btn.querySelector('.p4-theme-menu-icon');
      const label = btn.querySelector('.p4-theme-menu-label');
      const sub = btn.querySelector('.p4-theme-menu-sub');
      if (icon) icon.textContent = next === 'light' ? '☀️' : '🌙';
      if (label) label.textContent = next === 'light' ? 'Mode clair' : 'Mode sombre';
      if (sub) sub.textContent = next === 'light' ? 'Cliquer pour passer en sombre' : 'Cliquer pour passer en clair';
      if (!icon && !label) btn.textContent = next === 'light' ? '☀️' : '🌙';
      btn.title = next === 'light' ? 'Mode clair' : 'Mode sombre';
      btn.setAttribute('aria-label', next === 'light' ? 'Passer en mode sombre' : 'Passer en mode clair');
    }
  }

  function ensureThemeStylesheet() {
    const stylesheets = [
      { id: 'p4-theme-base-css', href: '/theme.css?v=eggs-31', match: '/theme.css' },
      { id: 'p4-theme-pc-css', href: '/theme-pc.css?v=1', match: '/theme-pc.css', media: '(min-width: 721px)' },
      { id: 'p4-theme-phone-css', href: '/theme-phone.css?v=1', match: '/theme-phone.css', media: '(max-width: 720px)' },
    ];

    const hasStylesheet = match => [...document.styleSheets].some(sheet => {
      try {
        return typeof sheet.href === 'string' && sheet.href.includes(match);
      } catch (error) {
        return false;
      }
    }) || !!document.querySelector(`link[href*="${match}"]`);

    stylesheets.forEach(sheet => {
      if (hasStylesheet(sheet.match) || document.getElementById(sheet.id)) return;
      const link = document.createElement('link');
      link.id = sheet.id;
      link.rel = 'stylesheet';
      link.href = sheet.href;
      if (sheet.media) link.media = sheet.media;
      document.head.appendChild(link);
    });
  }

  function applyCustomCursor() {
    let player = null;
    try {
      player = JSON.parse(localStorage.getItem('player') || sessionStorage.getItem('player') || 'null');
    } catch (_) {}
    const cursor = String(player?.custom_cursor || '');
    let style = document.getElementById('p4-custom-cursor-style');
    if (!/^data:image\/png;base64,[a-z0-9+/=]+$/i.test(cursor)) {
      style?.remove();
      return;
    }
    if (!style) {
      style = document.createElement('style');
      style.id = 'p4-custom-cursor-style';
      document.head.appendChild(style);
    }
    style.textContent = `html,body,body *{cursor:url("${cursor}") 0 0,auto!important}`;
  }

  const MODAL_LAYER_SELECTOR = [
    '#bot-modal', '#duel-modal', '#training-modal', '#unlink-modal-bg',
    '.modal-bg', '.preview-modal-bg', '.token-collection-modal-bg',
    '.pseudo-font-modal-bg', '.avatar-decoration-modal-bg', '.elo-sim-bg',
    '.image-editor-bg', '.upload-chooser-bg', '.fps-config-modal',
  ].join(',');

  function mountModalLayers(scope = document) {
    if (!document.body) return;
    const candidates = [];
    if (scope instanceof Element && scope.matches(MODAL_LAYER_SELECTOR)) candidates.push(scope);
    scope.querySelectorAll?.(MODAL_LAYER_SELECTOR).forEach(element => candidates.push(element));
    candidates.forEach(layer => {
      layer.classList.add('p4-modal-layer');
      if (layer.parentElement !== document.body) document.body.appendChild(layer);
    });
  }

  function watchModalLayers() {
    mountModalLayers();
    const observer = new MutationObserver(mutations => {
      mutations.forEach(mutation => mutation.addedNodes.forEach(node => {
        if (node.nodeType === Node.ELEMENT_NODE) mountModalLayers(node);
      }));
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  const FPS_STORAGE_KEY = 'p4_show_fps';
  const FPS_CONFIG_KEY = 'p4_fps_config';
  const DEFAULT_FPS_CONFIG = {
    text: 'FPS',
    animateRgb: false,
    colorGood: '#30d158',
    colorOk: '#ffd60a',
    colorBad: '#ff2d55',
    goodMin: 55,
    okMin: 35,
  };
  let fpsFrameId = 0;
  let fpsLastFrame = 0;
  let fpsLastPaint = 0;
  let fpsFrames = 0;
  let fpsMeter = null;

  function fpsEnabled() {
    try {
      return localStorage.getItem(FPS_STORAGE_KEY) === 'true';
    } catch (_) {
      return false;
    }
  }

  function isHexColor(value) {
    return /^#[0-9a-f]{6}$/i.test(String(value || ''));
  }

  function readFpsConfig() {
    let raw = null;
    try {
      raw = JSON.parse(localStorage.getItem(FPS_CONFIG_KEY) || 'null');
    } catch (_) {}
    const config = { ...DEFAULT_FPS_CONFIG, ...(raw && typeof raw === 'object' ? raw : {}) };
    config.text = String(config.text || DEFAULT_FPS_CONFIG.text).trim().slice(0, 18) || DEFAULT_FPS_CONFIG.text;
    config.colorGood = isHexColor(config.colorGood) ? config.colorGood : DEFAULT_FPS_CONFIG.colorGood;
    config.colorOk = isHexColor(config.colorOk) ? config.colorOk : DEFAULT_FPS_CONFIG.colorOk;
    config.colorBad = isHexColor(config.colorBad) ? config.colorBad : DEFAULT_FPS_CONFIG.colorBad;
    config.goodMin = clampNumber(config.goodMin, DEFAULT_FPS_CONFIG.goodMin, 1, 240);
    config.okMin = Math.min(config.goodMin - 1, clampNumber(config.okMin, DEFAULT_FPS_CONFIG.okMin, 1, 239));
    config.animateRgb = Boolean(config.animateRgb);
    return config;
  }

  function saveFpsConfig(next = {}) {
    const config = { ...readFpsConfig(), ...(next && typeof next === 'object' ? next : {}) };
    try {
      localStorage.setItem(FPS_CONFIG_KEY, JSON.stringify(config));
    } catch (_) {}
    applyFpsConfig(readFpsConfig());
    return readFpsConfig();
  }

  function applyFpsConfig(config = readFpsConfig()) {
    const meter = fpsMeter?.isConnected ? fpsMeter : null;
    if (!meter) return;
    meter.style.setProperty('--p4-fps-good', config.colorGood);
    meter.style.setProperty('--p4-fps-ok', config.colorOk);
    meter.style.setProperty('--p4-fps-bad', config.colorBad);
    meter.classList.toggle('rgb', config.animateRgb);
  }

  function ensureFpsMeter() {
    if (fpsMeter?.isConnected) return fpsMeter;
    fpsMeter = document.createElement('div');
    fpsMeter.id = 'p4-fps-meter';
    fpsMeter.className = 'p4-fps-meter';
    fpsMeter.setAttribute('aria-label', 'Images par seconde');
    fpsMeter.textContent = 'FPS --';
    document.body.appendChild(fpsMeter);
    return fpsMeter;
  }

  function paintFpsMeter(fps) {
    const meter = ensureFpsMeter();
    const config = readFpsConfig();
    applyFpsConfig(config);
    meter.textContent = `${config.text} ${fps}`;
    meter.dataset.state = fps >= config.goodMin ? 'good' : fps >= config.okMin ? 'ok' : 'bad';
  }

  function stopFpsMeter() {
    if (fpsFrameId) cancelAnimationFrame(fpsFrameId);
    fpsFrameId = 0;
    fpsLastFrame = 0;
    fpsLastPaint = 0;
    fpsFrames = 0;
    fpsMeter?.remove();
  }

  function tickFpsMeter(now) {
    if (!fpsEnabled()) {
      stopFpsMeter();
      return;
    }
    if (!fpsLastFrame) {
      fpsLastFrame = now;
      fpsLastPaint = now;
    }
    fpsFrames += 1;
    if (now - fpsLastPaint >= 500) {
      const fps = Math.round((fpsFrames * 1000) / Math.max(1, now - fpsLastPaint));
      paintFpsMeter(fps);
      fpsFrames = 0;
      fpsLastPaint = now;
    }
    fpsLastFrame = now;
    fpsFrameId = requestAnimationFrame(tickFpsMeter);
  }

  function setFpsMeterEnabled(enabled) {
    try {
      localStorage.setItem(FPS_STORAGE_KEY, enabled ? 'true' : 'false');
    } catch (_) {}
    if (!enabled) {
      stopFpsMeter();
      return;
    }
    ensureFpsMeter();
    if (!fpsFrameId) fpsFrameId = requestAnimationFrame(tickFpsMeter);
  }

  window.P4FpsCounter = {
    setEnabled: setFpsMeterEnabled,
    isEnabled: fpsEnabled,
    getConfig: readFpsConfig,
    setConfig: saveFpsConfig,
  };

  function clampNumber(value, fallback, min, max) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.min(max, Math.max(min, number));
  }

  function cssUrl(value) {
    return String(value || '').replace(/["\\\n\r]/g, char => {
      if (char === '"') return '\\"';
      if (char === '\\') return '\\\\';
      return '';
    });
  }

  const WALLPAPER_MAX_CACHE_BYTES = 650 * 1024;

  function approxDataUrlBytes(value) {
    const input = String(value || '').trim();
    const comma = input.indexOf(',');
    if (!input || comma < 0) return 0;
    return Math.ceil((input.length - comma - 1) * 0.75);
  }

  function pruneStoredHeavyWallpaper(player) {
    if (!player || typeof player !== 'object') return player;
    const patch = {};
    if (approxDataUrlBytes(player.profile_wallpaper_desktop || player.profile_wallpaper || '') > WALLPAPER_MAX_CACHE_BYTES) {
      patch.profile_wallpaper_desktop = '';
      patch.profile_wallpaper = '';
    }
    if (approxDataUrlBytes(player.profile_wallpaper_mobile || '') > WALLPAPER_MAX_CACHE_BYTES) {
      patch.profile_wallpaper_mobile = '';
    }
    if (!Object.keys(patch).length) return player;
    patchStoredMenuPlayer(patch);
    return { ...player, ...patch };
  }

  function readWallpaperSettings() {
    let player = null;
    try {
      player = JSON.parse(localStorage.getItem('player') || sessionStorage.getItem('player') || 'null');
    } catch (_) {}
    player = pruneStoredHeavyWallpaper(player);
    let desktopWallpaper = '';
    let mobileWallpaper = '';
    let opacity = 0.48;
    let dim = 0.28;
    desktopWallpaper = String(player?.profile_wallpaper_desktop || player?.profile_wallpaper || '').trim();
    mobileWallpaper = String(player?.profile_wallpaper_mobile || '').trim();
    opacity = player?.profile_wallpaper_opacity ?? opacity;
    dim = player?.profile_wallpaper_dim ?? dim;
    const isMobile = window.matchMedia?.('(max-width: 720px)').matches;
    const wallpaper = isMobile ? (mobileWallpaper || desktopWallpaper) : desktopWallpaper;
    return {
      wallpaper,
      desktopWallpaper,
      mobileWallpaper,
      opacity: clampNumber(opacity, 0.48, 0.08, 1),
      dim: clampNumber(dim, 0.28, 0, 0.85),
    };
  }

  function applyWallpaperMode(settings = readWallpaperSettings()) {
    if (!document.body) return;
    const wallpaper = String(settings?.wallpaper || '').trim();
    document.body.classList.toggle('p4-wallpaper-mode', Boolean(wallpaper));
    if (!wallpaper) {
      document.body.style.removeProperty('--p4-wallpaper-image');
      document.body.style.removeProperty('--p4-wallpaper-opacity');
      document.body.style.removeProperty('--p4-wallpaper-dim');
      return;
    }
    document.body.style.setProperty('--p4-wallpaper-image', `url("${cssUrl(wallpaper)}")`);
    document.body.style.setProperty('--p4-wallpaper-opacity', String(clampNumber(settings.opacity, 0.48, 0.08, 1)));
    document.body.style.setProperty('--p4-wallpaper-dim', String(clampNumber(settings.dim, 0.28, 0, 0.85)));
  }

  function saveWallpaperMode(settings = {}) {
    const current = readWallpaperSettings();
    const desktopWallpaper = typeof settings.desktopWallpaper === 'string'
      ? settings.desktopWallpaper.trim()
      : (typeof settings.wallpaper === 'string' ? settings.wallpaper.trim() : current.desktopWallpaper);
    const mobileWallpaper = typeof settings.mobileWallpaper === 'string'
      ? settings.mobileWallpaper.trim()
      : current.mobileWallpaper;
    const opacity = clampNumber(settings.opacity, 0.48, 0.08, 1);
    const dim = clampNumber(settings.dim, 0.28, 0, 0.85);
    patchStoredMenuPlayer({
      profile_wallpaper_desktop: desktopWallpaper,
      profile_wallpaper_mobile: mobileWallpaper,
      profile_wallpaper_opacity: opacity,
      profile_wallpaper_dim: dim,
    });
    applyWallpaperMode({ desktopWallpaper, mobileWallpaper, opacity, dim });
  }

  window.P4Wallpaper = {
    apply: saveWallpaperMode,
    refresh: () => applyWallpaperMode(),
    get: readWallpaperSettings,
  };

  function clearLegacyWallpaperStorage() {
    try {
      [
        'p4_profile_wallpaper',
        'p4_profile_wallpaper_desktop',
        'p4_profile_wallpaper_mobile',
        'p4_profile_wallpaper_opacity',
        'p4_profile_wallpaper_dim',
      ].forEach(key => localStorage.removeItem(key));
    } catch (_) {}
  }

  function ensurePwaMetadata() {
    const head = document.head;
    if (!head) return;
    const entries = [
      ['link', { rel: 'manifest', href: '/manifest.webmanifest' }],
      ['link', { rel: 'apple-touch-icon', href: '/assets/apple-touch-icon.png' }],
      ['meta', { name: 'theme-color', content: '#ff2d55' }],
      ['meta', { name: 'mobile-web-app-capable', content: 'yes' }],
      ['meta', { name: 'apple-mobile-web-app-capable', content: 'yes' }],
      ['meta', { name: 'apple-mobile-web-app-status-bar-style', content: 'black-translucent' }],
      ['meta', { name: 'apple-mobile-web-app-title', content: 'Puissance 4' }],
    ];
    entries.forEach(([tag, attrs]) => {
      const selector = tag === 'link'
        ? `link[rel="${attrs.rel}"]`
        : `meta[name="${attrs.name}"]`;
      if (head.querySelector(selector)) return;
      const element = document.createElement(tag);
      Object.entries(attrs).forEach(([key, value]) => element.setAttribute(key, value));
      head.appendChild(element);
    });
  }

  function isStandalone() {
    return window.matchMedia?.('(display-mode: standalone)').matches
      || window.navigator.standalone === true;
  }

  function isIosDevice() {
    return /iphone|ipad|ipod/i.test(navigator.userAgent)
      || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  }

  function updateInstallButton() {
    const button = document.getElementById('p4-install-app');
    if (!button) return;
    const canInstall = Boolean(deferredInstallPrompt);
    const showIosHelp = isIosDevice() && !isStandalone();
    const canShowInstallEntry = !isStandalone() && (
      canInstall
      || showIosHelp
      || (window.location.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(window.location.hostname))
    );
    button.hidden = !canShowInstallEntry;
    button.querySelector('.p4-install-label').textContent = showIosHelp && !canInstall
      ? (window.P4I18n?.t('menu.install.ios') || 'Installer sur iPhone')
      : (window.P4I18n?.t('menu.install.label') || 'Installer l’application');
    button.querySelector('.p4-install-sub').textContent = showIosHelp && !canInstall
      ? (window.P4I18n?.t('menu.install.iosSub') || 'Partager puis Sur l’écran d’accueil')
      : (window.P4I18n?.t('menu.install.sub') || 'Ouvrir comme une vraie application');
  }

  async function installApplication() {
    if (deferredInstallPrompt) {
      deferredInstallPrompt.prompt();
      await deferredInstallPrompt.userChoice.catch(() => null);
      deferredInstallPrompt = null;
      updateInstallButton();
      return;
    }
    if (isIosDevice()) {
      alert('Sur iPhone ou iPad : ouvre le menu Partager de Safari, puis touche « Sur l’écran d’accueil ».');
      return;
    }
    alert('Pour ouvrir Puissance 4 en mode application, utilise le bouton d’installation de ton navigateur (icône écran/flèche dans la barre d’adresse, ou menu ⋮ > Installer l’application).');
  }

  function registerPwa() {
    ensurePwaMetadata();
    if ('serviceWorker' in navigator && window.isSecureContext) {
      navigator.serviceWorker.register('/service-worker.js?v=profile-menu-local-round-28', {
        scope: '/',
        updateViaCache: 'none',
      }).then(registration => {
        registration.update().catch(() => {});
      }).catch(() => {});
    }
    window.addEventListener('beforeinstallprompt', event => {
      event.preventDefault();
      deferredInstallPrompt = event;
      updateInstallButton();
    });
    window.addEventListener('appinstalled', () => {
      deferredInstallPrompt = null;
      updateInstallButton();
    });
  }

  function loadDiscordPresence() {
    if (document.querySelector('script[data-p4-rpc-presence]')) return;
    const script = document.createElement('script');
    script.src = '/rpc-presence.js?v=9';
    script.async = true;
    script.dataset.p4RpcPresence = '1';
    document.head.appendChild(script);
  }

  function loadI18n() {
    if (window.P4I18n || document.querySelector('script[data-p4-i18n]')) return;
    const script = document.createElement('script');
    script.src = '/i18n.js?v=18';
    script.defer = true;
    script.dataset.p4I18n = '1';
    script.addEventListener('load', () => window.P4I18n?.apply(document.body));
    document.head.appendChild(script);
  }

  const MENU_ITEMS = [
    { href: '/', icon: '🏠', labelKey: 'menu.home.label', subKey: 'menu.home.sub' },
    { href: '/profil', icon: '👤', labelKey: 'menu.profile.label', subKey: 'menu.profile.sub' },
    { href: '/games.html', icon: '🎮', labelKey: 'menu.games.label', subKey: 'menu.games.sub' },
    { href: '/progression', icon: '🎯', labelKey: 'menu.progression.label', subKey: 'menu.progression.sub' },
    { href: '/live', icon: '🔴', labelKey: 'menu.live.label', subKey: 'menu.live.sub' },
    { href: '/local', icon: '🎲', labelKey: 'menu.local.label', subKey: 'menu.local.sub' },
    { href: '/players', icon: '👥', labelKey: 'menu.players.label', subKey: 'menu.players.sub' },
    { href: '/leaderboard', icon: '🏆', labelKey: 'menu.leaderboard.label', subKey: 'menu.leaderboard.sub' },
    { href: '/clan', icon: '🛡️', labelKey: 'menu.clan.label', subKey: 'menu.clan.sub' },
    { href: '/analyse', icon: '🧠', labelKey: 'menu.analysis.label', subKey: 'menu.analysis.sub' },
    { href: '/outils', icon: '🧰', labelKey: 'menu.tools.label', subKey: 'menu.tools.sub' },
    { href: '/boutique', icon: '🛒', labelKey: 'menu.shop.label', subKey: 'menu.shop.sub' },
    { href: '/stats', icon: '📈', labelKey: 'menu.stats.label', subKey: 'menu.stats.sub' },
    { href: '/news', icon: '📰', labelKey: 'menu.news.label', subKey: 'menu.news.sub' },
    { href: '/regles', icon: '📘', labelKey: 'menu.rules.label', subKey: 'menu.rules.sub' },
    { href: '/api-doc', icon: '🧪', labelKey: 'menu.api.label', subKey: 'menu.api.sub' },
    { href: 'https://discord.gg/MrKbBAAWcm', icon: '📣', labelKey: 'menu.discord.label', subKey: 'menu.discord.sub' },
  ];

  const I18N_FALLBACK = {
    'menu.home.label': 'Accueil',
    'menu.home.sub': 'Lancer une partie',
    'menu.profile.label': 'Profil',
    'menu.profile.sub': 'Compte et style',
    'menu.games.label': 'Toutes les parties',
    'menu.games.sub': 'Historique global et replays',
    'menu.progression.label': 'Progression',
    'menu.progression.sub': 'Quêtes et thèmes',
    'menu.live.label': 'Live',
    'menu.live.sub': 'Spectateur',
    'menu.local.label': 'Local',
    'menu.local.sub': '1v1 hors ligne',
    'menu.players.label': 'Joueurs',
    'menu.players.sub': 'Profils publics',
    'menu.leaderboard.label': 'Classement',
    'menu.leaderboard.sub': 'Membres et bots',
    'menu.clan.label': 'Clan',
    'menu.clan.sub': 'Equipe et tchat',
    'menu.analysis.label': 'Analyse',
    'menu.analysis.sub': 'Moteur de coups',
    'menu.tools.label': 'Outils',
    'menu.tools.sub': 'Téléchargements et replays',
    'menu.shop.label': 'Boutique',
    'menu.shop.sub': 'Coins et gemmes',
    'menu.stats.label': 'Stats',
    'menu.stats.sub': 'Données du site',
    'menu.news.label': 'News',
    'menu.news.sub': 'Mise a jour 4.1.0',
    'menu.rules.label': 'Règles',
    'menu.rules.sub': 'Jeu et gains',
    'menu.api.label': 'API',
    'menu.api.sub': 'Docs développeur',
    'menu.discord.label': 'Discord',
    'menu.discord.sub': 'Communauté',
  };

  const MENU_LANGUAGES = [
    { code: 'fr', name: 'Français', country: 'France', aliases: ['fra', 'france', 'français', 'francais'] },
    { code: 'en', name: 'English', country: 'United Kingdom / United States', aliases: ['ang', 'anglais', 'eng', 'english', 'usa', 'uk', 'royaume'] },
    { code: 'es', name: 'Español', country: 'Espagne / Mexique', aliases: ['esp', 'espagne', 'mex', 'mexique', 'spanish'] },
    { code: 'de', name: 'Deutsch', country: 'Allemagne', aliases: ['all', 'allemagne', 'deu', 'german', 'deutsch'] },
    { code: 'it', name: 'Italiano', country: 'Italie', aliases: ['ita', 'italie', 'italien', 'italian'] },
    { code: 'pt', name: 'Português', country: 'Portugal / Brésil', aliases: ['por', 'portugal', 'bresil', 'brésil', 'brazil', 'portuguese'] },
    { code: 'nl', name: 'Nederlands', country: 'Pays-Bas', aliases: ['pay', 'pays-bas', 'hollande', 'dutch', 'netherlands'] },
    { code: 'pl', name: 'Polski', country: 'Pologne', aliases: ['pol', 'pologne', 'polish'] },
    { code: 'ro', name: 'Română', country: 'Roumanie', aliases: ['rou', 'roumanie', 'romania', 'romanian'] },
    { code: 'sv', name: 'Svenska', country: 'Suède', aliases: ['sue', 'suede', 'suède', 'swedish'] },
    { code: 'tr', name: 'Türkçe', country: 'Turquie', aliases: ['tur', 'turquie', 'turkish'] },
    { code: 'ru', name: 'Русский', country: 'Russie', aliases: ['rus', 'russie', 'russian'] },
    { code: 'uk', name: 'Українська', country: 'Ukraine', aliases: ['ukr', 'ukraine', 'ukrainian'] },
    { code: 'ar', name: 'العربية', country: 'Monde arabe', aliases: ['ara', 'arabe', 'arabic', 'maroc', 'algerie', 'algérie'] },
    { code: 'zh', name: '中文', country: 'Chine', aliases: ['chi', 'chine', 'chinois', 'chinese', 'mandarin'] },
    { code: 'ja', name: '日本語', country: 'Japon', aliases: ['jap', 'japon', 'japanese'] },
    { code: 'ko', name: '한국어', country: 'Corée', aliases: ['cor', 'coree', 'corée', 'korean'] },
    { code: 'el', name: 'Ελληνικά', country: 'Grèce', aliases: ['gre', 'grece', 'grèce', 'greek'] },
    { code: 'cs', name: 'Čeština', country: 'Tchéquie', aliases: ['tch', 'tchequie', 'tchéquie', 'czech'] },
    { code: 'hu', name: 'Magyar', country: 'Hongrie', aliases: ['hon', 'hongrie', 'hungarian'] },
    { code: 'id', name: 'Bahasa Indonesia', country: 'Indonésie', aliases: ['ind', 'indonesie', 'indonésie', 'indonesian'] },
    { code: 'hi', name: 'हिन्दी', country: 'Inde', aliases: ['hin', 'inde', 'hindi', 'india'] },
  ];

  function i18nText(key) {
    const translated = window.P4I18n?.t(key);
    return translated && translated !== key ? translated : (I18N_FALLBACK[key] || key);
  }

  function escapeHtml(value) {
    return String(value || '').replace(/[&<>"']/g, char => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    }[char]));
  }

  function normalizeLanguageQuery(value) {
    return String(value || '')
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
  }

  function menuLanguages() {
    return Array.isArray(window.P4I18n?.languages) && window.P4I18n.languages.length
      ? window.P4I18n.languages
      : MENU_LANGUAGES;
  }

  function allKnownMenuLanguages() {
    const seen = new Set();
    return [...menuLanguages(), ...MENU_LANGUAGES].filter(language => {
      if (!language?.code || seen.has(language.code)) return false;
      seen.add(language.code);
      return true;
    });
  }

  function resolveMenuLanguage(query) {
    const needle = normalizeLanguageQuery(query);
    if (!needle) return null;
    return allKnownMenuLanguages().find(language => {
      const haystack = [language.code, language.name, language.country, ...(language.aliases || [])].map(normalizeLanguageQuery);
      return haystack.some(value => value === needle || value.startsWith(needle) || value.includes(needle));
    }) || null;
  }

  function languageInputValue(code) {
    const language = menuLanguages().find(entry => entry.code === code) || MENU_LANGUAGES.find(entry => entry.code === code);
    return language ? language.name : 'Français';
  }

  function languageOptionsHtml() {
    return menuLanguages().map(language => (
      `<option value="${escapeHtml(language.name)}" label="${escapeHtml(`${language.country} · ${language.code.toUpperCase()}`)}"></option>`
    )).join('');
  }

  function readMenuPlayer() {
    try {
      return JSON.parse(localStorage.getItem('player') || sessionStorage.getItem('player') || 'null');
    } catch (_) {
      return null;
    }
  }

  function readMenuToken() {
    try {
      return localStorage.getItem('token') || sessionStorage.getItem('token') || '';
    } catch (_) {
      return '';
    }
  }

  function patchStoredMenuPlayer(patch) {
    [localStorage, sessionStorage].forEach(store => {
      try {
        const player = JSON.parse(store.getItem('player') || 'null');
        if (player?.id) store.setItem('player', JSON.stringify({ ...player, ...patch }));
      } catch (_) {}
    });
  }

  async function saveMenuLanguage() {
    const input = document.getElementById('p4-menu-language-input') || document.getElementById('p4-menu-language-select');
    const button = document.getElementById('p4-menu-language-save');
    const matchedLanguage = resolveMenuLanguage(input?.value || 'fr');
    if (!matchedLanguage) {
      alert(window.P4I18n?.t('common.languageUnknown') || 'Langue non reconnue.');
      return;
    }
    const language = matchedLanguage.code;
    const player = readMenuPlayer();
    const token = readMenuToken();
    if (button) {
      button.disabled = true;
      button.textContent = '...';
    }
    try {
      if (player?.id && token) {
        const res = await fetch(`/api/players/${player.id}/language`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', 'x-session-token': token },
          body: JSON.stringify({ token, language }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Impossible de sauvegarder la langue.');
        patchStoredMenuPlayer({ language: data.language || language });
      } else {
        try { localStorage.setItem('p4_language', language); } catch (_) {}
      }
      await window.P4I18n?.setLanguage(language);
      alert(window.P4I18n?.t('menu.language.refresh') || 'La page va se recharger pour appliquer la langue.');
      location.reload();
    } catch (error) {
      alert(error.message || 'Erreur langue.');
      if (button) {
        button.disabled = false;
        button.textContent = window.P4I18n?.t('menu.language.validate') || 'Valider';
      }
    }
  }

  function shouldMountGlobalMenu() {
    const path = window.location.pathname.replace(/\/+$/, '') || '/';
    if (path === '/game' || path.endsWith('/game.html')) return false;
    if (document.body?.dataset?.disableGlobalMenu === '1') return false;
    return true;
  }

  function setMenuOpen(open) {
    document.body.classList.toggle('p4-global-menu-open', Boolean(open));
    const toggle = document.getElementById('p4-global-menu-toggle');
    if (toggle) {
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      toggle.setAttribute('aria-label', open ? (window.P4I18n?.t('common.closeMenu') || 'Fermer le menu') : (window.P4I18n?.t('common.openMenu') || 'Ouvrir le menu'));
      const icon = toggle.querySelector('.p4-global-menu-toggle-icon');
      const text = toggle.querySelector('.p4-global-menu-toggle-text');
      if (icon) icon.textContent = open ? '×' : '☰';
      if (text) text.textContent = open ? (window.P4I18n?.t('common.close') || 'Fermer') : (window.P4I18n?.t('common.menu') || 'Menu');
    }
  }

  function mountGlobalMenu() {
    if (!shouldMountGlobalMenu()) return;
    if (document.getElementById('p4-global-menu-toggle')) return;
    ensureThemeStylesheet();
    document.getElementById('p4-theme-toggle')?.remove();
    document.body.classList.add('p4-menu-mounted');
    const currentLanguage = window.P4I18n?.getLanguage?.() || readMenuPlayer()?.language || localStorage.getItem('p4_language') || 'fr';
    const currentLanguageLabel = languageInputValue(currentLanguage);

    const toggle = document.createElement('button');
    toggle.id = 'p4-global-menu-toggle';
    toggle.className = 'p4-global-menu-toggle';
    toggle.type = 'button';
    toggle.setAttribute('aria-label', 'Ouvrir le menu');
    toggle.dataset.i18nAttr = 'aria-label:common.openMenu';
    toggle.setAttribute('aria-controls', 'p4-global-menu-panel');
    toggle.setAttribute('aria-expanded', 'false');
    toggle.innerHTML = '<span class="p4-global-menu-toggle-icon">☰</span><span class="p4-global-menu-toggle-text" data-i18n="common.menu">Menu</span>';

    const backdrop = document.createElement('div');
    backdrop.className = 'p4-global-menu-backdrop';

    const panel = document.createElement('aside');
    panel.id = 'p4-global-menu-panel';
    panel.className = 'p4-global-menu-panel';
    panel.setAttribute('aria-label', 'Navigation principale');
    panel.innerHTML = `
      <div class="p4-global-menu-head">
        <div class="p4-global-menu-brand">
          <img class="p4-global-menu-logo" src="/assets/site-logo-small.png" alt="Puissance 4">
          <div>
            <div class="p4-global-menu-eyebrow">Arena Ranked</div>
            <div class="p4-global-menu-title">Puissance <span>4</span></div>
          </div>
        </div>
        <button class="p4-global-menu-close" type="button" aria-label="Fermer le menu" data-i18n-attr="aria-label:common.closeMenu">×</button>
      </div>
      <div class="p4-global-menu-grid">
        ${MENU_ITEMS.map(item => `
          <a class="p4-global-menu-link" href="${item.href}">
            <span class="p4-global-menu-emoji">${item.icon}</span>
            <span class="p4-global-menu-copy">
              <span class="p4-global-menu-label" data-i18n="${item.labelKey}">${i18nText(item.labelKey)}</span>
              <span class="p4-global-menu-sub" data-i18n="${item.subKey}">${i18nText(item.subKey)}</span>
            </span>
          </a>
        `).join('')}
      </div>
      <button class="p4-install-app" id="p4-install-app" type="button" hidden>
        <span class="p4-install-icon">⬇</span>
        <span class="p4-global-menu-copy">
          <span class="p4-global-menu-label p4-install-label" data-i18n="menu.install.label">Installer l’application</span>
          <span class="p4-global-menu-sub p4-install-sub" data-i18n="menu.install.sub">Ouvrir comme une vraie application</span>
        </span>
      </button>
      <button class="p4-theme-menu-button" id="p4-theme-toggle" type="button">
        <span class="p4-theme-menu-icon">🌙</span>
        <span class="p4-global-menu-copy">
          <span class="p4-global-menu-label p4-theme-menu-label">Mode sombre</span>
          <span class="p4-global-menu-sub p4-theme-menu-sub">Cliquer pour passer en clair</span>
        </span>
      </button>
      <div class="p4-menu-language-box">
        <div class="p4-menu-language-head">
          <span class="p4-menu-language-icon">🌐</span>
          <span>
            <strong data-i18n="menu.language.title">Langue</strong>
            <small data-i18n="menu.language.help">Choix de la langue</small>
          </span>
        </div>
        <div class="p4-menu-language-row">
          <input id="p4-menu-language-input" class="p4-menu-language-select" list="p4-menu-language-list" value="${escapeHtml(currentLanguageLabel)}" placeholder="fra, ang, all..." autocomplete="off">
          <datalist id="p4-menu-language-list">${languageOptionsHtml()}</datalist>
          <button id="p4-menu-language-save" class="p4-menu-language-save" type="button" data-i18n="menu.language.validate">Valider</button>
        </div>
      </div>
      <div class="p4-global-menu-foot"><span data-i18n="menu.footer">
        Menu compact pour éviter les pages qui débordent. Les pages de partie gardent leur interface dédiée.
        </span>
        <a class="p4-global-menu-copyright" href="/cgu">© 2026 Puissance-4 · CGU</a>
      </div>
    `;

    toggle.addEventListener('click', () => setMenuOpen(!document.body.classList.contains('p4-global-menu-open')));
    backdrop.addEventListener('click', () => setMenuOpen(false));
    panel.querySelector('.p4-global-menu-close')?.addEventListener('click', () => setMenuOpen(false));
    panel.querySelector('#p4-install-app')?.addEventListener('click', installApplication);
    panel.querySelector('#p4-theme-toggle')?.addEventListener('click', () => applyTheme(root.dataset.theme === 'light' ? 'dark' : 'light'));
    panel.querySelector('#p4-menu-language-save')?.addEventListener('click', saveMenuLanguage);
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape') setMenuOpen(false);
    });

    document.body.appendChild(toggle);
    document.body.appendChild(backdrop);
    document.body.appendChild(panel);
    window.P4I18n?.apply(panel);
    applyTheme(root.dataset.theme || getSavedTheme());
    updateInstallButton();
  }

  const EGG_EXCLUDED_PATHS = ['/admin', '/dev', '/game', '/'];
  const EGG_MESSAGES = {
    '/profil': 'Pion de profil trouvé : il voulait essayer ta décoration d’avatar.',
    '/boutique': 'Pion de boutique trouvé : non, il n’était pas en promotion.',
    '/progression': 'Pion de progression trouvé : +0 ELO, mais beaucoup de panache.',
    '/leaderboard': 'Pion du classement trouvé : il exige la place numéro 4.',
    '/players': 'Pion sociable trouvé : il suivait tous les profils en silence.',
    '/analyse': 'Pion tacticien trouvé : son analyse était « joue au milieu ».',
    '/stats': 'Pion statistique trouvé : 100 % des pions cachés détestent les graphiques.',
    '/news': 'Pion journaliste trouvé : exclusivité, il était caché ici.',
    '/regles': 'Pion réglementaire trouvé : il avait lu les règles, lui.',
    '/api-doc': 'Pion développeur trouvé : réponse HTTP 204, aucune stratégie.',
    '/local': 'Pion local trouvé : aucune connexion internet requise pour le surprendre.',
    '/replay': 'Pion du replay trouvé : oui, tu peux revoir sa fuite au ralenti.',
    '/404': 'Pion perdu trouvé : finalement, cette page menait quelque part.',
  };

  function normalizedPath() {
    const path = window.location.pathname.replace(/\.html$/, '').replace(/\/+$/, '') || '/';
    return ['/replay', '/duel'].find(base => path === base || path.startsWith(`${base}/`)) || path;
  }

  function eggAllowed(path) {
    return !EGG_EXCLUDED_PATHS.some(excluded => path === excluded || (excluded !== '/' && path.startsWith(`${excluded}/`)));
  }

  function eggSeed(value) {
    return [...String(value)].reduce((total, char) => ((total * 31) + char.charCodeAt(0)) >>> 0, 2166136261);
  }

  const EGG_PAGE_SALT = `${Date.now()}:${Math.random()}`;

  function eggIsPhoneLayout() {
    return Boolean(window.matchMedia?.('(max-width: 768px), (pointer: coarse)').matches);
  }

  function eggViewportPlacement(key, attempt = 0) {
    const isPhone = eggIsPhoneLayout();
    const width = Math.max(320, window.visualViewport?.width || window.innerWidth || document.documentElement.clientWidth || 1280);
    const height = Math.max(420, window.visualViewport?.height || window.innerHeight || document.documentElement.clientHeight || 720);
    const size = isPhone ? 38 : 46;
    const sidePad = isPhone ? 16 : 56;
    const topMin = isPhone ? 92 : 112;
    const topMax = isPhone
      ? Math.max(topMin, Math.min(height - 130, height * 0.58, 430))
      : Math.max(topMin, Math.min(height - 170, height * 0.62, 560));
    const seed = eggSeed(`${key}:${attempt}:${EGG_PAGE_SALT}`);
    return {
      left: Math.round(sidePad + ((seed * 17) % Math.max(1, Math.round(width - size - sidePad * 2)))),
      top: Math.round(topMin + ((seed * 29) % Math.max(1, Math.round(topMax - topMin)))),
    };
  }

  function hideEggInContent(element, key, attempt = 0) {
    element.style.removeProperty('--egg-layer-left');
    element.style.removeProperty('--egg-layer-top');
    const position = eggViewportPlacement(key, attempt);
    element.style.setProperty('--egg-layer-left', `${position.left}px`);
    element.style.setProperty('--egg-layer-top', `${position.top}px`);
    element.classList.add('p4-egg-fixed');
    element.dataset.eggPlacementKey = key;
    element.dataset.eggPlacementAttempt = String(attempt);
    document.body.appendChild(element);
    return true;
  }

  function refreshFixedEggPlacements() {
    document.querySelectorAll('.p4-egg-fixed[data-egg-placement-key]').forEach(element => {
      const key = element.dataset.eggPlacementKey;
      const attempt = Number(element.dataset.eggPlacementAttempt || 0);
      const position = eggViewportPlacement(key, attempt);
      element.style.setProperty('--egg-layer-left', `${position.left}px`);
      element.style.setProperty('--egg-layer-top', `${position.top}px`);
    });
  }

  let eggAudioContext = null;

  function playEggSound(kind, rarity = 'common') {
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;
      eggAudioContext ||= new AudioContext();
      if (eggAudioContext.state === 'suspended') eggAudioContext.resume();

      const context = eggAudioContext;
      const now = context.currentTime;
      const tone = (from, to, delay, duration, wave = 'sine', volume = 0.035) => {
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        const startsAt = now + delay;
        oscillator.type = wave;
        oscillator.frequency.setValueAtTime(from, startsAt);
        oscillator.frequency.exponentialRampToValueAtTime(Math.max(1, to), startsAt + duration);
        gain.gain.setValueAtTime(0.0001, startsAt);
        gain.gain.exponentialRampToValueAtTime(volume, startsAt + Math.min(0.018, duration / 3));
        gain.gain.exponentialRampToValueAtTime(0.0001, startsAt + duration);
        oscillator.connect(gain);
        gain.connect(context.destination);
        oscillator.start(startsAt);
        oscillator.stop(startsAt + duration + 0.02);
      };

      if (kind === 'dodge') {
        tone(310, 760, 0, 0.12, 'triangle', 0.028);
        tone(580, 980, 0.07, 0.1, 'sine', 0.018);
      } else if (kind === 'coin') {
        tone(720, 980, 0, 0.08, 'square', 0.025);
        tone(980, 1320, 0.08, 0.1, 'square', 0.022);
      } else if (kind === 'gem') {
        [1047, 1319, 1568].forEach((frequency, index) => {
          tone(frequency, frequency * 1.04, index * 0.065, 0.16, 'sine', 0.03);
        });
      } else if (kind === 'queenpawn') {
        [523, 659, 784, 1047, 1319].forEach((frequency, index) => {
          tone(frequency, frequency * 1.02, index * 0.075, 0.2, index === 4 ? 'triangle' : 'sine', 0.035);
        });
      } else if (kind === 'capture') {
        const baseFrequency = {
          common: 420,
          rare: 500,
          epic: 590,
          legendary: 700,
          mythic: 820,
          artifact: 940,
        }[rarity] || 420;
        tone(baseFrequency, baseFrequency * 1.45, 0, 0.14, 'triangle', 0.03);
        tone(baseFrequency * 1.3, baseFrequency * 2, 0.09, 0.18, 'sine', 0.025);
      } else {
        tone(190, 125, 0, 0.16, 'sawtooth', 0.018);
      }
    } catch {
      // Audio is decorative; restricted browsers can safely ignore it.
    }
  }

  async function mountPageEasterEgg() {
    const path = normalizedPath();
    if (!eggAllowed(path) || document.getElementById('p4-page-egg')) return;

    const storageKey = `p4_egg_${path}`;
    const sessionToken = localStorage.getItem('token') || sessionStorage.getItem('token') || '';
    if (!sessionToken) return;
    let storedPlayer = null;
    try {
      const response = await fetch('/api/shop/me', {
        cache: 'no-store',
        headers: { 'x-session-token': sessionToken },
      });
      if (!response.ok) return;
      const data = await response.json();
      storedPlayer = data?.player || null;
      if (!storedPlayer || Number(storedPlayer.is_guest || 0) === 1 || Number(storedPlayer.is_bot || 0) === 1) return;
    } catch (_) {
      return;
    }
    const EGG_RESPAWN_MS = Number(storedPlayer?.is_perso || 0) === 1 || ['admin', 'moderator'].includes(String(storedPlayer?.role || ''))
      ? 10 * 60 * 1000
      : Number(storedPlayer?.is_vip_plus || 0) === 1 || Number(storedPlayer?.is_crystal || 0) === 1
        ? 15 * 60 * 1000
        : Number(storedPlayer?.is_vip || 0) === 1
          ? 30 * 60 * 1000
          : 60 * 60 * 1000;
    const readStorage = key => {
      try { return localStorage.getItem(key); } catch (_) { return null; }
    };
    const writeStorage = (key, value) => {
      try { localStorage.setItem(key, value); } catch (_) {}
    };
    const cooldownKey = type => `p4_egg_cooldown_v2_${type}_${path}`;
    const cooldownReady = type => Date.now() - Number(readStorage(cooldownKey(type)) || 0) >= EGG_RESPAWN_MS;
    const startCooldown = type => writeStorage(cooldownKey(type), String(Date.now()));
    const setCooldownRemaining = (type, remainingMs) => {
      const elapsed = Math.max(0, EGG_RESPAWN_MS - Number(remainingMs || 0));
      writeStorage(cooldownKey(type), String(Date.now() - elapsed));
    };
    const hourlySeed = value => {
      const hour = Math.floor(Date.now() / EGG_RESPAWN_MS);
      return [...`${value}:${hour}`].reduce((total, char) => ((total * 31) + char.charCodeAt(0)) >>> 0, 2166136261);
    };
    const rarityFor = value => {
      const rarities = [
        { key: 'common', label: 'Commun', color: '#ff5c72', rate: 49 },
        { key: 'rare', label: 'Rare', color: '#4c8dff', rate: 25 },
        { key: 'epic', label: 'Épique', color: '#bf5af2', rate: 12 },
        { key: 'legendary', label: 'Légendaire', color: '#ffd60a', rate: 7 },
        { key: 'mythic', label: 'Mythique', color: '#ff2d86', rate: 3.5 },
        { key: 'artifact', label: 'Artefact', color: '#72f7d4', rate: 1.5 },
        { key: 'queenpawn', label: 'QueenPawn', color: '#fff2c7', rate: 1 },
        { key: 'fantastic', label: 'Fantastique', color: '#6dffb8', rate: .9 },
        { key: 'unforgettable', label: 'Inoubliable', color: '#ff66b7', rate: .1 },
      ];
      const roll = (hourlySeed(value) % 10000) / 100;
      let cursor = 0;
      for (const rarity of rarities) {
        cursor += rarity.rate;
        if (roll < cursor) return rarity;
      }
      return rarities[0];
    };
    const designForRarity = rarity => ({
      common: 'classic',
      rare: 'grooved',
      epic: 'star',
      legendary: 'prism',
      mythic: 'mythic',
      artifact: 'artifact',
      queenpawn: 'queen',
      fantastic: 'fantastic',
      unforgettable: 'prism',
      event: 'event',
    }[rarity] || 'classic');
    const caughtCount = () => {
      try {
        let total = 0;
        for (let index = 0; index < localStorage.length; index++) {
          const key = localStorage.key(index);
          if (key?.startsWith('p4_egg_') && localStorage.getItem(key) === '1') total += 1;
        }
        return total;
      } catch (_) {
        return 0;
      }
    };
    const alreadyCaught = readStorage(storageKey) === '1';
    const travelerReady = cooldownReady('traveler');
    const egg = document.createElement('button');
    const toast = document.createElement('div');
    const travelerRarity = rarityFor(`${path}:traveler`);
    const dodgeRanges = {
      common: [0, 1],
      rare: [1, 2],
      epic: [2, 3],
      legendary: [3, 4],
      mythic: [4, 5],
      artifact: [5, 6],
      queenpawn: [7, 9],
      fantastic: [8, 10],
      unforgettable: [10, 12],
    };
    const [minimumDodges, maximumDodges] = dodgeRanges[travelerRarity.key] || [1, 2];
    const dodgeSeed = hourlySeed(`${path}:traveler:dodges`);
    let dodges = minimumDodges + (dodgeSeed % (maximumDodges - minimumDodges + 1));
    let dodgeAttempt = 0;

    egg.id = 'p4-page-egg';
    egg.className = 'p4-page-egg';
    egg.type = 'button';
    egg.dataset.rarity = travelerRarity.key;
    egg.dataset.design = designForRarity(travelerRarity.key);
    egg.setAttribute('aria-label', `Pion voyageur ${travelerRarity.label}`);
    egg.style.setProperty('--egg-color', travelerRarity.color);

    toast.className = 'p4-egg-toast';
    toast.setAttribute('role', 'status');
    toast.setAttribute('aria-live', 'polite');

    function toastAnchor(rect) {
      const fallback = egg?.isConnected ? egg.getBoundingClientRect() : null;
      const anchor = rect || fallback || { left: window.innerWidth / 2, top: 120, width: 0, height: 0 };
      const width = Math.max(320, window.visualViewport?.width || window.innerWidth || document.documentElement.clientWidth || 1280);
      const height = Math.max(420, window.visualViewport?.height || window.innerHeight || document.documentElement.clientHeight || 720);
      return {
        left: Math.round(Math.min(width - 170, Math.max(170, anchor.left + anchor.width / 2))),
        top: Math.round(Math.min(height - 84, Math.max(76, anchor.top + anchor.height + 14))),
        inBox: false,
        afterCatchZone: true,
      };
    }

    function showToast(message, rect = null) {
      if (!document.body.contains(toast)) document.body.appendChild(toast);
      const anchor = toastAnchor(rect);
      toast.style.setProperty('--egg-toast-left', `${anchor.left}px`);
      toast.style.setProperty('--egg-toast-top', `${anchor.top}px`);
      toast.classList.toggle('in-box', Boolean(anchor.inBox));
      toast.classList.toggle('after-catch-zone', Boolean(anchor.afterCatchZone));
      toast.textContent = message;
      toast.classList.remove('show');
      void toast.offsetWidth;
      toast.classList.add('show');
      clearTimeout(showToast.timer);
      showToast.timer = setTimeout(() => toast.classList.remove('show'), 5200);
    }

    function sparks(rect, burst = 'big') {
      if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      const count = burst === 'small' ? 14 : 28;
      const baseDistance = burst === 'small' ? 42 : 86;
      const randomDistance = burst === 'small' ? 82 : 175;
      for (let index = 0; index < count; index++) {
        const spark = document.createElement('i');
        const angle = Math.PI * 2 * index / count;
        const distance = baseDistance + Math.random() * randomDistance;
        spark.className = `p4-egg-spark ${index % 4 === 0 ? 'big' : ''}`;
        const color = ['#ffd60a', '#ff2d55', '#85ebff', '#30d158', '#bf5af2'][index % 5];
        spark.style.left = `${rect.left + rect.width / 2}px`;
        spark.style.top = `${rect.top + rect.height / 2}px`;
        spark.style.setProperty('--mini-egg-color', color);
        spark.style.color = color;
        spark.style.setProperty('--spark-x', `${Math.cos(angle) * distance}px`);
        spark.style.setProperty('--spark-y', `${Math.sin(angle) * distance}px`);
        spark.style.setProperty('--spark-rotate', `${180 + Math.random() * 720}deg`);
        document.body.appendChild(spark);
        setTimeout(() => spark.remove(), 1600);
      }
    }

    egg.addEventListener('click', async () => {
      if (dodges > 0) {
        const rect = egg.getBoundingClientRect();
        dodges -= 1;
        dodgeAttempt += 1;
        sparks(rect, 'small');
        hideEggInContent(egg, `${path}:traveler:${dodgeSeed}`, dodgeAttempt + 1);
        egg.classList.remove('escaping');
        void egg.offsetWidth;
        egg.classList.add('escaping');
        window.setTimeout(() => egg.classList.remove('escaping'), 440);
        playEggSound('dodge', travelerRarity.key);
        const dodgeMessages = [
          'Raté, le pion change de case.',
          'Presque. Il vient encore de filer.',
          'Ce pion refuse décidément de rester tranquille.',
          'Bien tenté, mais il avait prévu le clic.',
        ];
        const remaining = dodges > 0
          ? ` Encore ${dodges} esquive${dodges > 1 ? 's' : ''} possible${dodges > 1 ? 's' : ''}.`
          : ' Le prochain clic sera le bon.';
        showToast(`${dodgeMessages[(dodgeAttempt - 1) % dodgeMessages.length]}${remaining}`, rect);
        return;
      }
      const rect = egg.getBoundingClientRect();
      const token = sessionToken;
      let collectible = null;
      let gems = 0;
      if (token && rewardPaths.has(path)) {
        egg.disabled = true;
        try {
          const response = await fetch('/api/easter-eggs/claim', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-session-token': token },
            body: JSON.stringify({ path, eggId: 'traveler-v1' }),
          });
          const data = await response.json().catch(() => ({}));
          if (!response.ok) throw new Error(data.error || 'Collection indisponible.');
          if (data.alreadyClaimed) {
            const minutes = Math.max(1, Math.ceil(Number(data.retryAfterMs || EGG_RESPAWN_MS) / 60000));
            setCooldownRemaining('traveler', data.retryAfterMs || EGG_RESPAWN_MS);
            playEggSound('blocked');
            showToast(`Ce pion voyageur reviendra dans environ ${minutes} minute(s).`, rect);
            egg.classList.add('caught');
            setTimeout(() => egg.remove(), 500);
            return;
          }
          collectible = data.collectible || null;
          gems = Number(data.gems || 0);
          try {
            const player = JSON.parse(localStorage.getItem('player') || '{}');
            if (player?.id && gems > 0) {
              player.gems = Number(data.gemsNow || player.gems || 0);
              localStorage.setItem('player', JSON.stringify(player));
              sessionStorage.setItem('player', JSON.stringify(player));
            }
          } catch (_) {}
        } catch (error) {
          egg.disabled = false;
          playEggSound('blocked');
          showToast(error.message, egg.getBoundingClientRect());
          return;
        }
      }
      const caught = caughtCount() + (alreadyCaught ? 0 : 1);
      writeStorage(storageKey, '1');
      startCooldown('traveler');
      playEggSound(travelerRarity.key === 'queenpawn' ? 'queenpawn' : 'capture', travelerRarity.key);
      if (gems > 0) window.setTimeout(() => playEggSound('gem'), 220);
      sparks(rect);
      egg.classList.add('caught');
      const collectionText = collectible
        ? ` ${collectible.label} rejoint ta collection${gems > 0 ? ` et rapporte +${gems} gemmes` : ''}.`
        : ` Collection locale : ${caught} pion(s).`;
      showToast(`${travelerRarity.label} trouvé ! ${EGG_MESSAGES[path] || 'Le pion voyageur préparait quelque chose de très peu stratégique.'}${collectionText}`, rect);
      setTimeout(() => egg.remove(), 500);
    });

    if (travelerReady) {
      hideEggInContent(egg, `${path}:traveler`);
    }
    document.body.appendChild(toast);

    const rewardPaths = new Set([
      '/profil', '/boutique', '/progression', '/leaderboard', '/players',
      '/analyse', '/stats', '/news', '/regles', '/api-doc',
      '/local', '/replay', '/cgu', '/duel', '/forgot-password',
      '/reset-password', '/404',
    ]);

    if (rewardPaths.has(path) && cooldownReady('coins')) {
      const coinEgg = document.createElement('button');
      const coinRarity = rarityFor(`${path}:coins`);
      coinEgg.className = 'p4-page-egg p4-coin-egg';
      coinEgg.type = 'button';
      coinEgg.dataset.rarity = coinRarity.key;
      coinEgg.dataset.design = designForRarity(coinRarity.key);
      coinEgg.setAttribute('aria-label', `Mini pion brillant ${coinRarity.label}`);
      coinEgg.style.setProperty('--egg-color', coinRarity.color);
      coinEgg.addEventListener('click', async () => {
        const rect = coinEgg.getBoundingClientRect();
        const token = localStorage.getItem('token') || sessionStorage.getItem('token') || '';
        if (!token) {
          playEggSound('blocked');
          showToast('Ce mini-pion contient des coins, mais il ne reconnaît que les joueurs connectés.', rect);
          return;
        }
        coinEgg.disabled = true;
        try {
          const response = await fetch('/api/easter-eggs/claim', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-session-token': token },
            body: JSON.stringify({ path, eggId: 'coin-v1' }),
          });
          const data = await response.json().catch(() => ({}));
          if (!response.ok) throw new Error(data.error || 'Recompense indisponible.');
          sparks(rect);
          coinEgg.classList.add('caught');
          if (data.alreadyClaimed) {
            const minutes = Math.max(1, Math.ceil(Number(data.retryAfterMs || EGG_RESPAWN_MS) / 60000));
            setCooldownRemaining('coins', data.retryAfterMs || EGG_RESPAWN_MS);
            playEggSound('blocked');
            showToast(`Ce mini-pion recharge ses poches. Retour dans environ ${minutes} minute(s).`, rect);
          } else {
            startCooldown('coins');
            playEggSound('coin');
            if (Number(data.gems || 0) > 0) window.setTimeout(() => playEggSound('gem'), 150);
            const gemText = Number(data.gems || 0) > 0 ? ` Coup de chance rarissime : +${Number(data.gems)} gemmes !` : '';
            showToast(`Trésor minuscule trouvé : +${Number(data.reward || 0)} coins.${gemText}`, rect);
            try {
              const player = JSON.parse(localStorage.getItem('player') || '{}');
              if (player?.id) {
                player.coins = Number(data.coins || player.coins || 0);
                player.gems = Number(data.gemsNow || player.gems || 0);
                localStorage.setItem('player', JSON.stringify(player));
                sessionStorage.setItem('player', JSON.stringify(player));
              }
            } catch (_) {}
          }
          setTimeout(() => coinEgg.remove(), 500);
        } catch (error) {
          coinEgg.disabled = false;
          playEggSound('blocked');
          showToast(error.message, coinEgg.getBoundingClientRect());
        }
      });
      hideEggInContent(coinEgg, `${path}:coins`, 3);
    }

    if (cooldownReady('chaos')) {
      const chaosEgg = document.createElement('button');
      const chaosIcons = ['?', '4', '!', '☻'];
      chaosEgg.className = 'p4-chaos-egg';
      chaosEgg.type = 'button';
      chaosEgg.textContent = chaosIcons[path.length % chaosIcons.length];
      chaosEgg.setAttribute('aria-label', 'Bouton très suspect');
      chaosEgg.addEventListener('click', () => {
        const banner = document.createElement('div');
        const chaosMessages = [
          'Mode stratégie approximative activé',
          'Le site vient de perdre 4 points de sérieux',
          'Alerte : un pion a touché aux réglages',
          'Technique secrète : cliquer partout',
        ];
        startCooldown('chaos');
        banner.className = 'p4-egg-banner';
        banner.textContent = chaosMessages[path.length % chaosMessages.length];
        document.body.classList.add('p4-egg-chaos');
        document.body.appendChild(banner);
        sparks(chaosEgg.getBoundingClientRect());
        setTimeout(() => document.body.classList.remove('p4-egg-chaos'), 3000);
        setTimeout(() => banner.remove(), 3300);
        chaosEgg.remove();
      });
      hideEggInContent(chaosEgg, `${path}:chaos`, 5);
    }
  }

  applyTheme(root.dataset.theme || getSavedTheme());
  applyCustomCursor();
  clearLegacyWallpaperStorage();
  ensureThemeStylesheet();
  if (fpsEnabled()) {
    if (document.body) setFpsMeterEnabled(true);
    else document.addEventListener('DOMContentLoaded', () => setFpsMeterEnabled(true), { once: true });
  }
  registerPwa();
  loadI18n();
  loadDiscordPresence();
  window.addEventListener('storage', event => {
    if (event.key === 'player') {
      applyWallpaperMode();
    }
    if (event.key === FPS_STORAGE_KEY) {
      setFpsMeterEnabled(event.newValue === 'true');
    }
  });
  window.matchMedia?.('(max-width: 720px)').addEventListener?.('change', () => applyWallpaperMode());
  window.matchMedia?.('(max-width: 768px)').addEventListener?.('change', refreshFixedEggPlacements);
  window.visualViewport?.addEventListener?.('resize', refreshFixedEggPlacements);
  window.addEventListener('resize', refreshFixedEggPlacements);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      applyWallpaperMode();
      watchModalLayers();
      mountGlobalMenu();
      mountPageEasterEgg();
    });
  } else {
    applyWallpaperMode();
    watchModalLayers();
    mountGlobalMenu();
    mountPageEasterEgg();
  }
})();

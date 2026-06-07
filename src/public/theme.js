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
      btn.textContent = next === 'light' ? '☀️' : '🌙';
      btn.title = next === 'light' ? 'Mode clair' : 'Mode sombre';
      btn.setAttribute('aria-label', next === 'light' ? 'Passer en mode sombre' : 'Passer en mode clair');
    }
  }

  function ensureThemeStylesheet() {
    const hasThemeCss = [...document.styleSheets].some(sheet => {
      try {
        return typeof sheet.href === 'string' && sheet.href.includes('/theme.css');
      } catch (error) {
        return false;
      }
    }) || !!document.querySelector('link[href="/theme.css"]');

    if (hasThemeCss) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = '/theme.css';
    document.head.appendChild(link);
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
    button.hidden = isStandalone() || (!canInstall && !showIosHelp);
    button.querySelector('.p4-install-label').textContent = showIosHelp && !canInstall
      ? 'Installer sur iPhone'
      : 'Installer l’application';
    button.querySelector('.p4-install-sub').textContent = showIosHelp && !canInstall
      ? 'Partager puis Sur l’écran d’accueil'
      : 'Ouvrir comme une vraie application';
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
    }
  }

  function registerPwa() {
    ensurePwaMetadata();
    if ('serviceWorker' in navigator && window.isSecureContext) {
      navigator.serviceWorker.register('/service-worker.js', { scope: '/' }).catch(() => {});
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

  function mountButton() {
    if (document.getElementById('p4-theme-toggle')) return;
    const btn = document.createElement('button');
    btn.id = 'p4-theme-toggle';
    btn.type = 'button';
    btn.addEventListener('click', () => applyTheme(root.dataset.theme === 'light' ? 'dark' : 'light'));
    document.body.appendChild(btn);
    applyTheme(root.dataset.theme || getSavedTheme());
  }

  const MENU_ITEMS = [
    { href: '/', icon: '🏠', label: 'Accueil', sub: 'Lancer une partie' },
    { href: '/profil', icon: '👤', label: 'Profil', sub: 'Compte et style' },
    { href: '/live', icon: '🔴', label: 'Live', sub: 'Spectateur' },
    { href: '/local', icon: '🎲', label: 'Local', sub: '1v1 hors ligne' },
    { href: '/players', icon: '👥', label: 'Joueurs', sub: 'Profils publics' },
    { href: '/leaderboard', icon: '🏆', label: 'Classement', sub: 'Membres et bots' },
    { href: '/clan', icon: '🛡️', label: 'Clan', sub: 'Equipe et tchat' },
    { href: '/tournoi', icon: '🏟️', label: 'Tournois', sub: 'Arènes events' },
    { href: '/analyse', icon: '🧠', label: 'Analyse', sub: 'Moteur de coups' },
    { href: '/boutique', icon: '🛒', label: 'Boutique', sub: 'Coins et gemmes' },
    { href: '/stats', icon: '📈', label: 'Stats', sub: 'Données du site' },
    { href: '/news', icon: '📰', label: 'News', sub: 'Mise a jour 3.2.0' },
    { href: '/regles', icon: '📘', label: 'Règles', sub: 'Jeu et gains' },
    { href: '/api-doc', icon: '🧪', label: 'API', sub: 'Docs développeur' },
    { href: 'https://discord.gg/MrKbBAAWcm', icon: '📣', label: 'Discord', sub: 'Communauté' },
  ];

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
      toggle.setAttribute('aria-label', open ? 'Fermer le menu' : 'Ouvrir le menu');
      const icon = toggle.querySelector('.p4-global-menu-toggle-icon');
      const text = toggle.querySelector('.p4-global-menu-toggle-text');
      if (icon) icon.textContent = open ? '×' : '☰';
      if (text) text.textContent = open ? 'Fermer' : 'Menu';
    }
  }

  function mountGlobalMenu() {
    if (!shouldMountGlobalMenu()) return;
    if (document.getElementById('p4-global-menu-toggle')) return;
    ensureThemeStylesheet();
    document.body.classList.add('p4-menu-mounted');

    const toggle = document.createElement('button');
    toggle.id = 'p4-global-menu-toggle';
    toggle.className = 'p4-global-menu-toggle';
    toggle.type = 'button';
    toggle.setAttribute('aria-label', 'Ouvrir le menu');
    toggle.setAttribute('aria-controls', 'p4-global-menu-panel');
    toggle.setAttribute('aria-expanded', 'false');
    toggle.innerHTML = '<span class="p4-global-menu-toggle-icon">☰</span><span class="p4-global-menu-toggle-text">Menu</span>';

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
        <button class="p4-global-menu-close" type="button" aria-label="Fermer le menu">×</button>
      </div>
      <div class="p4-global-menu-grid">
        ${MENU_ITEMS.map(item => `
          <a class="p4-global-menu-link" href="${item.href}">
            <span class="p4-global-menu-emoji">${item.icon}</span>
            <span class="p4-global-menu-copy">
              <span class="p4-global-menu-label">${item.label}</span>
              <span class="p4-global-menu-sub">${item.sub}</span>
            </span>
          </a>
        `).join('')}
      </div>
      <button class="p4-install-app" id="p4-install-app" type="button" hidden>
        <span class="p4-install-icon">⬇</span>
        <span class="p4-global-menu-copy">
          <span class="p4-global-menu-label p4-install-label">Installer l’application</span>
          <span class="p4-global-menu-sub p4-install-sub">Ouvrir comme une vraie application</span>
        </span>
      </button>
      <div class="p4-global-menu-foot">
        Menu compact pour éviter les pages qui débordent. Les pages de partie gardent leur interface dédiée.
        <a class="p4-global-menu-copyright" href="/cgu">© 2026 Puissance-4 · CGU</a>
      </div>
    `;

    toggle.addEventListener('click', () => setMenuOpen(!document.body.classList.contains('p4-global-menu-open')));
    backdrop.addEventListener('click', () => setMenuOpen(false));
    panel.querySelector('.p4-global-menu-close')?.addEventListener('click', () => setMenuOpen(false));
    panel.querySelector('#p4-install-app')?.addEventListener('click', installApplication);
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape') setMenuOpen(false);
    });

    document.body.appendChild(toggle);
    document.body.appendChild(backdrop);
    document.body.appendChild(panel);
    updateInstallButton();
  }

  applyTheme(root.dataset.theme || getSavedTheme());
  ensureThemeStylesheet();
  registerPwa();

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      mountButton();
      mountGlobalMenu();
    });
  } else {
    mountButton();
    mountGlobalMenu();
  }
})();

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
    link.href = '/theme.css?v=eggs-5';
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
      navigator.serviceWorker.register('/service-worker.js?v=eggs-5', { scope: '/' }).catch(() => {});
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
    script.src = '/rpc-presence.js?v=8';
    script.async = true;
    script.dataset.p4RpcPresence = '1';
    document.head.appendChild(script);
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
    { href: '/progression', icon: '🎯', label: 'Progression', sub: 'Quêtes et thèmes' },
    { href: '/live', icon: '🔴', label: 'Live', sub: 'Spectateur' },
    { href: '/local', icon: '🎲', label: 'Local', sub: '1v1 hors ligne' },
    { href: '/players', icon: '👥', label: 'Joueurs', sub: 'Profils publics' },
    { href: '/leaderboard', icon: '🏆', label: 'Classement', sub: 'Membres et bots' },
    { href: '/clan', icon: '🛡️', label: 'Clan', sub: 'Equipe et tchat' },
    { href: '/tournoi', icon: '🏟️', label: 'Tournois', sub: 'Arènes events' },
    { href: '/analyse', icon: '🧠', label: 'Analyse', sub: 'Moteur de coups' },
    { href: '/boutique', icon: '🛒', label: 'Boutique', sub: 'Coins et gemmes' },
    { href: '/stats', icon: '📈', label: 'Stats', sub: 'Données du site' },
    { href: '/news', icon: '📰', label: 'News', sub: 'Mise a jour 3.4.0' },
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

  const EGG_EXCLUDED_PATHS = ['/live', '/admin', '/dev', '/game', '/clan', '/'];
  const EGG_MESSAGES = {
    '/profil': 'Pion de profil trouvé : il voulait essayer ta décoration d’avatar.',
    '/boutique': 'Pion de boutique trouvé : non, il n’était pas en promotion.',
    '/progression': 'Pion de progression trouvé : +0 ELO, mais beaucoup de panache.',
    '/leaderboard': 'Pion du classement trouvé : il exige la place numéro 4.',
    '/players': 'Pion sociable trouvé : il suivait tous les profils en silence.',
    '/analyse': 'Pion tacticien trouvé : son analyse était « joue au milieu ».',
    '/stats': 'Pion statistique trouvé : 100 % des pions cachés détestent les graphiques.',
    '/news': 'Pion journaliste trouvé : exclusivité, il était caché ici.',
    '/tournoi': 'Pion de tournoi trouvé : éliminé pour avoir roulé hors du plateau.',
    '/regles': 'Pion réglementaire trouvé : il avait lu les règles, lui.',
    '/api-doc': 'Pion développeur trouvé : réponse HTTP 204, aucune stratégie.',
    '/local': 'Pion local trouvé : aucune connexion internet requise pour le surprendre.',
    '/replay': 'Pion du replay trouvé : oui, tu peux revoir sa fuite au ralenti.',
    '/404': 'Pion perdu trouvé : finalement, cette page menait quelque part.',
  };

  function normalizedPath() {
    const path = window.location.pathname.replace(/\.html$/, '').replace(/\/+$/, '') || '/';
    return ['/replay', '/tournoi', '/duel'].find(base => path === base || path.startsWith(`${base}/`)) || path;
  }

  function eggAllowed(path) {
    return !EGG_EXCLUDED_PATHS.some(excluded => path === excluded || (excluded !== '/' && path.startsWith(`${excluded}/`)));
  }

  function eggPosition(path, attempt = 0) {
    const seed = [...path].reduce((total, char) => total + char.charCodeAt(0), 0) + attempt * 97;
    return {
      left: 5 + (seed * 17 % 82),
      top: 16 + (seed * 29 % 68),
    };
  }

  function mountPageEasterEgg() {
    const path = normalizedPath();
    if (!eggAllowed(path) || document.getElementById('p4-page-egg')) return;

    const storageKey = `p4_egg_${path}`;
    const EGG_RESPAWN_MS = 60 * 60 * 1000;
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
      const roll = hourlySeed(value) % 1000;
      if (roll < 8) return { key: 'spectral', label: 'Spectral', color: '#72f7d4' };
      if (roll < 45) return { key: 'legendary', label: 'Légendaire', color: '#ffd60a' };
      if (roll < 155) return { key: 'epic', label: 'Épique', color: '#bf5af2' };
      if (roll < 390) return { key: 'rare', label: 'Rare', color: '#4c8dff' };
      return { key: 'common', label: 'Commun', color: '#ff2d55' };
    };
    const designForRarity = rarity => ({
      common: 'classic',
      rare: 'grooved',
      epic: 'star',
      legendary: 'prism',
      spectral: 'spectral',
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
    const position = eggPosition(path);
    const travelerRarity = rarityFor(`${path}:traveler`);
    let dodges = 1;

    egg.id = 'p4-page-egg';
    egg.className = 'p4-page-egg';
    egg.type = 'button';
    egg.dataset.rarity = travelerRarity.key;
    egg.dataset.design = designForRarity(travelerRarity.key);
    egg.setAttribute('aria-label', `Pion voyageur ${travelerRarity.label}`);
    egg.style.setProperty('--egg-left', `${position.left}vw`);
    egg.style.setProperty('--egg-top', `${position.top}vh`);
    egg.style.setProperty('--egg-color', travelerRarity.color);

    toast.className = 'p4-egg-toast';
    toast.setAttribute('role', 'status');
    toast.setAttribute('aria-live', 'polite');

    function showToast(message) {
      toast.textContent = message;
      toast.classList.add('show');
      clearTimeout(showToast.timer);
      showToast.timer = setTimeout(() => toast.classList.remove('show'), 3600);
    }

    function sparks(rect) {
      if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      for (let index = 0; index < 24; index++) {
        const spark = document.createElement('i');
        const angle = Math.PI * 2 * index / 24;
        const distance = 70 + Math.random() * 130;
        spark.className = 'p4-egg-spark';
        spark.style.left = `${rect.left + rect.width / 2}px`;
        spark.style.top = `${rect.top + rect.height / 2}px`;
        spark.style.background = index % 2 ? '#ffd60a' : '#ff2d55';
        spark.style.setProperty('--spark-x', `${Math.cos(angle) * distance}px`);
        spark.style.setProperty('--spark-y', `${Math.sin(angle) * distance}px`);
        document.body.appendChild(spark);
        setTimeout(() => spark.remove(), 1300);
      }
    }

    egg.addEventListener('click', async () => {
      if (dodges > 0) {
        dodges -= 1;
        const next = eggPosition(path, 2);
        egg.style.setProperty('--egg-left', `${next.left}vw`);
        egg.style.setProperty('--egg-top', `${next.top}vh`);
        showToast('Raté. Ce pion connaît visiblement une case que tu ne connais pas.');
        return;
      }
      const rect = egg.getBoundingClientRect();
      const token = localStorage.getItem('token') || sessionStorage.getItem('token') || '';
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
            showToast(`Ce pion voyageur reviendra dans environ ${minutes} minute(s).`);
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
          showToast(error.message);
          return;
        }
      }
      const caught = caughtCount() + (alreadyCaught ? 0 : 1);
      writeStorage(storageKey, '1');
      startCooldown('traveler');
      sparks(rect);
      egg.classList.add('caught');
      const collectionText = collectible
        ? ` ${collectible.label} rejoint ta collection${gems > 0 ? ` et rapporte +${gems} gemmes` : ''}.`
        : ` Collection locale : ${caught} pion(s).`;
      showToast(`${travelerRarity.label} trouvé ! ${EGG_MESSAGES[path] || 'Le pion voyageur préparait quelque chose de très peu stratégique.'}${collectionText}`);
      setTimeout(() => egg.remove(), 500);
    });

    if (travelerReady) {
      document.body.appendChild(egg);
    }
    document.body.appendChild(toast);

    const rewardPaths = new Set([
      '/profil', '/boutique', '/progression', '/leaderboard', '/players',
      '/analyse', '/stats', '/news', '/tournoi', '/regles', '/api-doc',
      '/local', '/replay', '/cgu', '/duel', '/forgot-password',
      '/reset-password', '/404',
    ]);

    if (rewardPaths.has(path) && cooldownReady('coins')) {
      const coinEgg = document.createElement('button');
      const coinPosition = eggPosition(`${path}:coins`, 3);
      const coinRarity = rarityFor(`${path}:coins`);
      coinEgg.className = 'p4-page-egg p4-coin-egg';
      coinEgg.type = 'button';
      coinEgg.dataset.rarity = coinRarity.key;
      coinEgg.dataset.design = designForRarity(coinRarity.key);
      coinEgg.setAttribute('aria-label', `Mini pion brillant ${coinRarity.label}`);
      coinEgg.style.setProperty('--egg-left', `${coinPosition.left}vw`);
      coinEgg.style.setProperty('--egg-top', `${coinPosition.top}vh`);
      coinEgg.style.setProperty('--egg-color', coinRarity.color);
      coinEgg.addEventListener('click', async () => {
        const rect = coinEgg.getBoundingClientRect();
        const token = localStorage.getItem('token') || sessionStorage.getItem('token') || '';
        if (!token) {
          showToast('Ce mini-pion contient des coins, mais il ne reconnaît que les joueurs connectés.');
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
            showToast(`Ce mini-pion recharge ses poches. Retour dans environ ${minutes} minute(s).`);
          } else {
            startCooldown('coins');
            const gemText = Number(data.gems || 0) > 0 ? ` +${Number(data.gems)} gemmes légendaires.` : '';
            const tokenText = data.collectible?.label ? ` Pion ${data.collectible.label} ajouté à la collection.` : '';
            showToast(`Trésor minuscule trouvé : +${Number(data.reward || 0)} coins.${gemText}${tokenText}`);
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
          showToast(error.message);
        }
      });
      document.body.appendChild(coinEgg);
    }

    if (cooldownReady('chaos')) {
      const chaosEgg = document.createElement('button');
      const chaosPosition = eggPosition(`${path}:chaos`, 5);
      const chaosIcons = ['?', '4', '!', '☻'];
      chaosEgg.className = 'p4-chaos-egg';
      chaosEgg.type = 'button';
      chaosEgg.textContent = chaosIcons[path.length % chaosIcons.length];
      chaosEgg.setAttribute('aria-label', 'Bouton très suspect');
      chaosEgg.style.setProperty('--chaos-left', `${chaosPosition.left}vw`);
      chaosEgg.style.setProperty('--chaos-top', `${chaosPosition.top}vh`);
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
      document.body.appendChild(chaosEgg);
    }
  }

  applyTheme(root.dataset.theme || getSavedTheme());
  ensureThemeStylesheet();
  registerPwa();
  loadDiscordPresence();

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      mountButton();
      mountGlobalMenu();
      mountPageEasterEgg();
    });
  } else {
    mountButton();
    mountGlobalMenu();
    mountPageEasterEgg();
  }
})();

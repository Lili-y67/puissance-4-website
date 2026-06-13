(function () {
  const ENDPOINT = 'http://127.0.0.1:6464/activity';
  const HEARTBEAT_MS = 30_000;
  const UPDATE_DELAY_MS = 1_500;
  const SESSION_KEY = 'p4_rpc_session_started';
  const VISITOR_KEY = 'p4_visitor_id';
  const ANONYMOUS_AVATAR_STYLES = [
    'adventurer',
    'adventurer-neutral',
    'bottts',
    'fun-emoji',
    'lorelei',
    'micah',
    'pixel-art',
  ];
  let customContext = window.__p4RpcContext || {};
  let publishTimer = null;
  let lastSignature = '';

  const pageLabels = {
    '/': ['Dans l’arène', 'Recherche sa prochaine partie'],
    '/profil': ['Consulte un profil', 'Personnalise son combattant'],
    '/progression': ['Progression et quêtes', 'Prépare ses prochains défis'],
    '/live': ['Regarde les parties en direct', 'Mode spectateur'],
    '/local': ['Partie locale', 'Duel sur le même écran'],
    '/players': ['Parcourt les joueurs', 'Observe la communauté'],
    '/leaderboard': ['Consulte le classement', 'Vise le sommet'],
    '/clan': ['Dans son clan', 'Avec son équipe'],
    '/tournoi': ['Dans l’arène tournoi', 'Prépare la compétition'],
    '/analyse': ['Analyse une position', 'Étudie ses prochains coups'],
    '/boutique': ['Dans la boutique', 'Choisit ses cosmétiques'],
    '/stats': ['Consulte les statistiques', 'Décortique les chiffres'],
    '/news': ['Lit les nouveautés', 'Suit les mises à jour'],
    '/regles': ['Consulte les règles', 'Révise ses stratégies'],
    '/api-doc': ['Explore l’API', 'Mode développeur'],
    '/replay': ['Regarde un replay', 'Analyse une ancienne partie'],
    '/duel': ['Prépare un duel', 'Attend son adversaire'],
    '/admin': ['Administre Puissance 4', 'Supervise la plateforme'],
    '/dev': ['Console développeur', 'Observe les outils techniques'],
    '/cgu': ['Consulte les conditions', 'Informations légales'],
    '/forgot-password': ['Récupération de compte', 'Prépare une demande sécurisée'],
    '/reset-password': ['Sécurise son compte', 'Modifie son mot de passe'],
    '/duel-auth': ['Rejoint un duel privé', 'Vérifie son accès'],
    '/404': ['Explore les alentours', 'Cette page reste introuvable'],
  };

  const adminSections = {
    'tab-players-btn': 'Gestion des joueurs',
    'tab-games-btn': 'Supervision des parties',
    'tab-tournaments-btn': 'Gestion des tournois',
  };

  const devSections = {
    'tab-performance': 'Performance et télémétrie',
    'tab-bots': 'Utilisation des bots',
    'tab-sources': 'Exploration du code source',
  };

  function readPlayer() {
    try {
      const raw = localStorage.getItem('player')
        || sessionStorage.getItem('duel_guest_player')
        || sessionStorage.getItem('player');
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function visitorId() {
    try {
      let value = localStorage.getItem(VISITOR_KEY);
      if (!value) {
        value = crypto.randomUUID?.() || `visitor-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
        localStorage.setItem(VISITOR_KEY, value);
      }
      return value;
    } catch {
      return 'anonymous-puissance4';
    }
  }

  function hashValue(value) {
    let hash = 2166136261;
    for (const char of String(value || '')) {
      hash ^= char.charCodeAt(0);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  function anonymousAvatar() {
    const seed = visitorId();
    const style = ANONYMOUS_AVATAR_STYLES[hashValue(seed) % ANONYMOUS_AVATAR_STYLES.length];
    return `https://api.dicebear.com/9.x/${style}/png?seed=${encodeURIComponent(seed)}&backgroundType=gradientLinear&size=128`;
  }

  function readMatch() {
    try {
      return JSON.parse(sessionStorage.getItem('match') || 'null');
    } catch {
      return null;
    }
  }

  function normalizedPath() {
    const path = location.pathname.replace(/\.html$/, '').replace(/\/+$/, '') || '/';
    if (path.startsWith('/game/')) return '/game';
    if (path.startsWith('/replay/')) return '/replay';
    if (path.startsWith('/profil/')) return '/profil';
    return path;
  }

  function absoluteAsset(value) {
    if (!value) return '';
    try {
      return new URL(String(value), location.origin).toString();
    } catch {
      return '';
    }
  }

  function opponentName(player, match) {
    const players = match?.players || {};
    const entries = Object.values(players);
    const opponent = entries.find(entry => entry && String(entry.id) !== String(player?.id || ''));
    return opponent?.pseudo || opponent?.name || '';
  }

  function pageActivity(player) {
    const path = normalizedPath();
    if (path === '/game') {
      const match = readMatch();
      const opponent = opponentName(player, match);
      const versusBot = Boolean(sessionStorage.getItem('vs_ia'));
      return [
        versusBot ? 'Affronte une intelligence artificielle' : 'Dispute une partie en ligne',
        opponent ? `Contre ${opponent}` : 'La partie est en cours',
      ];
    }

    if (path === '/profil') {
      const viewedId = new URLSearchParams(location.search).get('id');
      if (viewedId && String(viewedId) !== String(player?.id || '')) {
        return ['Consulte un profil public', 'Observe un autre joueur'];
      }
    }
    if (path === '/admin') {
      const active = Object.keys(adminSections).find(id => document.getElementById(id)?.classList.contains('active'));
      return ['Administre Puissance 4', adminSections[active] || 'Supervise la plateforme'];
    }
    if (path === '/dev') {
      const active = Object.keys(devSections).find(id => document.getElementById(id)?.classList.contains('active'));
      return ['Console développeur', devSections[active] || 'Observe les outils techniques'];
    }
    return pageLabels[path] || ['Explore Puissance 4', document.title || 'Puissance 4 Arena'];
  }

  function isOwnProfile(player) {
    if (normalizedPath() !== '/profil' || !player?.id) return false;
    const viewedId = new URLSearchParams(location.search).get('id');
    return !viewedId || String(viewedId) === String(player.id);
  }

  function sessionStart() {
    try {
      let value = Number(sessionStorage.getItem(SESSION_KEY));
      if (!Number.isFinite(value) || value <= 0) {
        value = Date.now();
        sessionStorage.setItem(SESSION_KEY, String(value));
      }
      return value;
    } catch {
      return Date.now();
    }
  }

  function buildPayload() {
    const player = readPlayer();
    const [fallbackDetails, fallbackState] = pageActivity(player);
    const details = customContext.details || fallbackDetails;
    const pageState = customContext.state || fallbackState;
    const identity = player?.pseudo || '';
    const showIdentity = !customContext.hideIdentity && isOwnProfile(player);
    return {
      details,
      state: showIdentity && identity ? `${identity} • ${pageState}` : pageState,
      largeImageText: 'Puissance 4 Arena',
      smallImage: player?.id ? absoluteAsset(player.avatar) : anonymousAvatar(),
      smallImageText: player?.pseudo ? `Joue avec ${player.pseudo}` : 'Visiteur anonyme',
      startedAt: sessionStart(),
      url: customContext.url || location.href,
      playerId: player?.id || '',
      profileUrl: player?.id ? `${location.origin}/profil?id=${encodeURIComponent(player.id)}` : '',
      siteUrl: location.origin,
    };
  }

  async function publish(force = false) {
    if (document.visibilityState === 'hidden') return;
    const payload = buildPayload();
    const signature = JSON.stringify(payload);
    if (!force && signature === lastSignature) return;
    lastSignature = signature;
    try {
      await fetch(ENDPOINT, {
        method: 'POST',
        mode: 'cors',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: signature,
      });
    } catch {
      // Le compagnon est optionnel, notamment sur téléphone.
    }
  }

  function refresh() {
    clearTimeout(publishTimer);
    publishTimer = setTimeout(() => publish(false), UPDATE_DELAY_MS);
  }

  function setContext(next = {}) {
    customContext = {
      ...customContext,
      ...next,
    };
    window.__p4RpcContext = customContext;
    refresh();
  }

  function clearContext() {
    customContext = {};
    window.__p4RpcContext = {};
    refresh();
  }

  publish();
  const heartbeat = setInterval(() => publish(true), HEARTBEAT_MS);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') publish(true);
  });
  window.addEventListener('storage', event => {
    if (['player', 'token'].includes(event.key)) refresh();
  });
  window.addEventListener('pageshow', () => publish(true));
  document.addEventListener('click', event => {
    if (event.target.closest('#tab-players-btn,#tab-games-btn,#tab-tournaments-btn,#tab-performance,#tab-bots,#tab-sources')) {
      setTimeout(refresh, 0);
    }
  });
  window.addEventListener('pagehide', () => {
    clearInterval(heartbeat);
    clearTimeout(publishTimer);
  }, { once: true });
  window.P4DiscordPresence = Object.freeze({ refresh, setContext, clearContext });
  window.p4SetDiscordActivity = setContext;
  window.dispatchEvent(new CustomEvent('p4:rpc-ready'));
})();

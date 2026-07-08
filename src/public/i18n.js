(function () {
  const STORAGE_KEY = 'p4_language';
  const DEFAULT_LANGUAGE = 'fr';

  const fallbackLanguages = [
    { code: 'fr', name: 'Français', country: 'France', aliases: ['fra', 'france', 'français', 'francais'] },
    { code: 'en', name: 'English', country: 'United Kingdom / United States', aliases: ['ang', 'anglais', 'eng', 'english', 'usa', 'uk', 'royaume'] },
    { code: 'es', name: 'Español', country: 'Espagne / Mexique', aliases: ['esp', 'espagne', 'mex', 'mexique', 'spanish'] },
  ];

  const fallbackSource = {
    'common.save': 'Enregistrer',
    'common.close': 'Fermer',
    'common.menu': 'Menu',
    'common.openMenu': 'Ouvrir le menu',
    'common.closeMenu': 'Fermer le menu',
    'common.languageSaved': 'Langue enregistree',
    'common.languageUnknown': 'Langue non reconnue.',
    'common.loginForLanguage': 'Connecte-toi pour changer la langue.',
    'menu.home.label': 'Accueil',
    'menu.home.sub': 'Lancer une partie',
    'menu.profile.label': 'Profil',
    'menu.profile.sub': 'Compte et style',
    'menu.shop.label': 'Boutique',
    'menu.shop.sub': 'Coins et gemmes',
    'menu.footer': 'Menu compact pour éviter les pages qui débordent. Les pages de partie gardent leur interface dédiée.',
    'profile.language.title': 'Langue du site',
    'profile.language.help': 'Choisis une langue par pays ou par nom.',
    'profile.language.firstPass': 'Premiere version : les textes communs changent tout de suite, le reste gardera le francais en fallback.',
  };

  const fallbackTranslations = {
    en: {
      'common.save': 'Save',
      'common.close': 'Close',
      'common.menu': 'Menu',
      'common.openMenu': 'Open menu',
      'common.closeMenu': 'Close menu',
      'common.languageSaved': 'Language saved',
      'common.languageUnknown': 'Language not recognized.',
      'common.loginForLanguage': 'Log in to change the language.',
      'menu.home.label': 'Home',
      'menu.home.sub': 'Start a game',
      'menu.profile.label': 'Profile',
      'menu.profile.sub': 'Account and style',
      'menu.shop.label': 'Shop',
      'menu.shop.sub': 'Coins and gems',
      'menu.footer': 'Compact menu to avoid overflowing pages. Game pages keep their dedicated interface.',
      'profile.language.title': 'Site language',
      'profile.language.help': 'Choose a language by country or name.',
      'profile.language.firstPass': 'First pass: common text changes right away, the rest keeps French as fallback.',
    },
    es: {
      'common.save': 'Guardar',
      'common.close': 'Cerrar',
      'common.menu': 'Menú',
      'common.openMenu': 'Abrir menú',
      'common.closeMenu': 'Cerrar menú',
      'common.languageSaved': 'Idioma guardado',
      'common.languageUnknown': 'Idioma no reconocido.',
      'common.loginForLanguage': 'Inicia sesión para cambiar el idioma.',
      'menu.home.label': 'Inicio',
      'menu.home.sub': 'Iniciar partida',
      'menu.profile.label': 'Perfil',
      'menu.profile.sub': 'Cuenta y estilo',
      'menu.shop.label': 'Tienda',
      'menu.shop.sub': 'Monedas y gemas',
      'menu.footer': 'Menú compacto para evitar páginas desbordadas. Las páginas de partida conservan su interfaz dedicada.',
      'profile.language.title': 'Idioma del sitio',
      'profile.language.help': 'Elige un idioma por país o nombre.',
      'profile.language.firstPass': 'Primera versión: los textos comunes cambian al instante, el resto mantiene francés como fallback.',
    },
  };

  let languages = fallbackLanguages;
  let activeLanguage = DEFAULT_LANGUAGE;
  let activeSource = fallbackSource;
  let activeTranslations = {};
  let textIndex = new Map();
  const bundleCache = new Map();

  function normalize(value) {
    return String(value || '')
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
  }

  function normalizeText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function readStoredPlayer() {
    try {
      return JSON.parse(localStorage.getItem('player') || sessionStorage.getItem('player') || 'null');
    } catch (_) {
      return null;
    }
  }

  function hasLanguage(code) {
    return languages.some(lang => lang.code === code) || fallbackLanguages.some(lang => lang.code === code);
  }

  function getLanguage() {
    const player = readStoredPlayer();
    const code = String(player?.language || localStorage.getItem(STORAGE_KEY) || activeLanguage || DEFAULT_LANGUAGE).toLowerCase();
    return hasLanguage(code) ? code : DEFAULT_LANGUAGE;
  }

  function rebuildTextIndex() {
    textIndex = new Map();
    Object.entries(activeSource || {}).forEach(([key, sourceText]) => {
      const translated = activeLanguage === DEFAULT_LANGUAGE
        ? sourceText
        : (activeTranslations?.[key] || sourceText);
      textIndex.set(normalizeText(sourceText), translated);
    });
  }

  async function fetchBundle(language) {
    const safe = hasLanguage(language) ? language : DEFAULT_LANGUAGE;
    if (bundleCache.has(safe)) return bundleCache.get(safe);
    try {
      const res = await fetch(`/api/i18n?lang=${encodeURIComponent(safe)}`, { cache: 'no-store' });
      if (!res.ok) throw new Error('i18n unavailable');
      const bundle = await res.json();
      bundleCache.set(safe, bundle);
      return bundle;
    } catch (_) {
      const bundle = {
        language: safe,
        fallbackLanguage: DEFAULT_LANGUAGE,
        languages: fallbackLanguages,
        source: fallbackSource,
        translations: safe === DEFAULT_LANGUAGE ? {} : (fallbackTranslations[safe] || {}),
      };
      bundleCache.set(safe, bundle);
      return bundle;
    }
  }

  async function loadLanguage(language) {
    const safe = hasLanguage(language) ? language : DEFAULT_LANGUAGE;
    const bundle = await fetchBundle(safe);
    languages = Array.isArray(bundle.languages) && bundle.languages.length ? bundle.languages : fallbackLanguages;
    activeLanguage = hasLanguage(bundle.language) ? bundle.language : safe;
    activeSource = bundle.source || fallbackSource;
    activeTranslations = activeLanguage === DEFAULT_LANGUAGE ? {} : (bundle.translations || fallbackTranslations[activeLanguage] || {});
    rebuildTextIndex();
    return activeLanguage;
  }

  function findLanguage(query) {
    const needle = normalize(query);
    if (!needle) return null;
    return languages.find(lang => {
      const haystack = [lang.code, lang.name, lang.country, ...(lang.aliases || [])].map(normalize);
      return haystack.some(value => value === needle || value.startsWith(needle) || value.includes(needle));
    }) || null;
  }

  function t(keyOrText, lang = getLanguage()) {
    const value = normalizeText(keyOrText);
    if (!value) return keyOrText;
    if (lang !== activeLanguage) {
      const sourceText = fallbackSource[value] || keyOrText;
      return fallbackTranslations[lang]?.[value] || fallbackTranslations[lang]?.[sourceText] || sourceText;
    }
    if (activeSource[value]) return activeTranslations[value] || activeSource[value];
    return textIndex.get(value) || keyOrText;
  }

  function applyKey(element) {
    const key = element?.dataset?.i18n;
    if (!key) return;
    element.textContent = t(key);
  }

  function applyAttributes(element) {
    const spec = element?.dataset?.i18nAttr || '';
    spec.split(',').map(part => part.trim()).filter(Boolean).forEach(part => {
      const [attr, key] = part.split(':').map(value => value.trim());
      if (attr && key) element.setAttribute(attr, t(key));
    });
  }

  function translateNode(node) {
    if (!node || node.nodeType !== Node.TEXT_NODE) return;
    const raw = node.nodeValue;
    if (!raw || !raw.trim()) return;
    const translated = t(raw);
    if (translated !== raw.trim()) node.nodeValue = raw.replace(raw.trim(), translated);
  }

  function apply(root = document.body) {
    document.documentElement.lang = activeLanguage || getLanguage();
    if (!root) return;
    root.querySelectorAll?.('[data-i18n]').forEach(applyKey);
    root.querySelectorAll?.('[data-i18n-attr]').forEach(applyAttributes);
    root.querySelectorAll?.('[title],[aria-label],[placeholder]').forEach(element => {
      if (element.dataset?.i18nAttr) return;
      ['title', 'aria-label', 'placeholder'].forEach(attr => {
        const value = element.getAttribute(attr);
        if (value) element.setAttribute(attr, t(value));
      });
    });

    const blocked = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'INPUT']);
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const parent = node.parentElement;
        if (!parent || blocked.has(parent.tagName) || parent.closest('[data-i18n-ignore],[data-i18n]')) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach(translateNode);
  }

  async function setLanguage(code) {
    const safe = hasLanguage(code) ? code : DEFAULT_LANGUAGE;
    try { localStorage.setItem(STORAGE_KEY, safe); } catch (_) {}
    await loadLanguage(safe);
    apply(document.body);
    return activeLanguage;
  }

  window.P4I18n = {
    get languages() { return languages; },
    getLanguage,
    setLanguage,
    findLanguage,
    t,
    apply,
    loadLanguage,
  };

  setLanguage(getLanguage());
})();

(function () {
  const STORAGE_KEY = 'p4_language';
  const DEFAULT_LANGUAGE = 'fr';

  const fallbackLanguages = [
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
  const machineCache = new Map();
  const machineTranslatedNodes = new WeakMap();
  const machineTranslatedAttrs = new WeakMap();
  let machineRunId = 0;
  let observer = null;
  let observerTimer = null;
  let translationInFlight = false;
  let pendingTranslationRoot = null;
  let overlayTimer = null;
  const fetchedPageTranslations = new Set();

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

  function shouldMachineTranslate(value) {
    const text = normalizeText(value);
    if (activeLanguage === DEFAULT_LANGUAGE) return false;
    if (text.length < 2 || text.length > 240) return false;
    if (!/[A-Za-zÀ-ÖØ-öø-ÿ]/.test(text)) return false;
    if (/puissance\s*-?\s*4|puissance4/i.test(text)) return false;
    if (/^(https?:\/\/|www\.|[#@])/.test(text)) return false;
    if (/^[\d\s.,:;!?%/+()[\]-]+$/.test(text)) return false;
    return true;
  }

  function shouldIgnoreElement(element) {
    return Boolean(element?.closest?.('[data-i18n-ignore],.logo,.logo-p4,.logo-num,.hero-logo-mark,.dock-brand,.welcome-logo,.p4-global-menu-logo'));
  }

  function ensureTranslationOverlay() {
    let overlay = document.getElementById('p4-i18n-progress');
    if (overlay) return overlay;
    const style = document.createElement('style');
    style.id = 'p4-i18n-progress-style';
    style.textContent = `
      .p4-i18n-progress{position:fixed;inset:0;z-index:100000;display:grid;place-items:center;padding:24px;background:radial-gradient(circle at 50% 15%,rgba(255,45,85,.18),transparent 34%),rgba(5,5,14,.88);backdrop-filter:blur(14px);color:#f4f4fb;font-family:Inter,system-ui,sans-serif;opacity:0;pointer-events:none;transition:opacity .22s ease}
      .p4-i18n-progress.show{opacity:1;pointer-events:auto}
      .p4-i18n-progress-card{width:min(440px,100%);padding:22px;border:1px solid rgba(133,235,255,.25);border-radius:20px;background:linear-gradient(180deg,rgba(22,20,42,.96),rgba(11,10,24,.96));box-shadow:0 30px 90px rgba(0,0,0,.48),0 0 42px rgba(133,235,255,.08);text-align:center}
      .p4-i18n-progress-spinner{width:46px;height:46px;margin:0 auto 14px;border-radius:50%;border:3px solid rgba(255,255,255,.12);border-top-color:#85ebff;border-right-color:#ffd60a;animation:p4I18nSpin .8s linear infinite}
      .p4-i18n-progress-title{font:900 22px "Barlow Condensed",Inter,sans-serif;letter-spacing:1.5px;text-transform:uppercase}
      .p4-i18n-progress-eta{margin-top:7px;color:#85ebff;font-size:12px;font-weight:900}
      .p4-i18n-progress-text{margin-top:10px;color:rgba(244,244,251,.72);font-size:12px;line-height:1.45}
      .p4-i18n-progress-track{height:8px;margin-top:16px;border-radius:999px;overflow:hidden;background:rgba(255,255,255,.08)}
      .p4-i18n-progress-fill{width:18%;height:100%;border-radius:inherit;background:linear-gradient(90deg,#ff2d55,#ffd60a,#85ebff);animation:p4I18nPulse 1.2s ease-in-out infinite}
      @keyframes p4I18nSpin{to{transform:rotate(360deg)}}
      @keyframes p4I18nPulse{0%,100%{transform:translateX(-70%)}50%{transform:translateX(470%)}}
    `;
    document.head.appendChild(style);
    overlay = document.createElement('div');
    overlay.id = 'p4-i18n-progress';
    overlay.className = 'p4-i18n-progress';
    overlay.setAttribute('role', 'status');
    overlay.setAttribute('aria-live', 'polite');
    overlay.innerHTML = `
      <div class="p4-i18n-progress-card">
        <div class="p4-i18n-progress-spinner"></div>
        <div class="p4-i18n-progress-title">Traduction en cours</div>
        <div class="p4-i18n-progress-eta">calcul...</div>
        <div class="p4-i18n-progress-text">La page est masquée pendant l'application de la langue.</div>
        <div class="p4-i18n-progress-track"><div class="p4-i18n-progress-fill"></div></div>
      </div>
    `;
    document.body.appendChild(overlay);
    return overlay;
  }

  function formatSeconds(seconds) {
    if (!Number.isFinite(seconds) || seconds <= 0) return 'quelques secondes';
    seconds = Math.max(1, Math.ceil(seconds));
    if (seconds < 60) return `${seconds}s restantes`;
    const minutes = Math.floor(seconds / 60);
    const rest = seconds % 60;
    return `${minutes}m ${String(rest).padStart(2, '0')}s restantes`;
  }

  function showTranslationOverlay(total, startedAt) {
    if (activeLanguage === DEFAULT_LANGUAGE || total <= 0) return;
    const overlay = ensureTranslationOverlay();
    const estimatedSeconds = Math.max(2, Math.min(45, Math.ceil(total * 0.45)));
    const refresh = () => {
      const elapsedSeconds = Math.floor((Date.now() - startedAt) / 1000);
      const remaining = Math.max(1, estimatedSeconds - elapsedSeconds);
      overlay.querySelector('.p4-i18n-progress-eta').textContent = `environ ${formatSeconds(remaining)}`;
      overlay.querySelector('.p4-i18n-progress-text').textContent = `${total} textes envoyes en une seule requete vers ${activeLanguage.toUpperCase()}.`;
    };
    clearInterval(overlayTimer);
    refresh();
    overlayTimer = setInterval(refresh, 1000);
    requestAnimationFrame(() => overlay.classList.add('show'));
  }

  function completeTranslationOverlay(total) {
    const overlay = document.getElementById('p4-i18n-progress');
    if (!overlay) return;
    clearInterval(overlayTimer);
    overlayTimer = null;
    overlay.querySelector('.p4-i18n-progress-eta').textContent = 'termine';
    overlay.querySelector('.p4-i18n-progress-text').textContent = `${total} textes traduits.`;
    setTimeout(() => {
      overlay.classList.remove('show');
      setTimeout(() => overlay.remove(), 260);
    }, 450);
  }

  function failTranslationOverlay(message) {
    const overlay = document.getElementById('p4-i18n-progress') || ensureTranslationOverlay();
    clearInterval(overlayTimer);
    overlayTimer = null;
    overlay.querySelector('.p4-i18n-progress-eta').textContent = 'traduction partielle';
    overlay.querySelector('.p4-i18n-progress-text').textContent = message || 'Le service de traduction ne repond pas pour cette langue.';
    overlay.classList.add('show');
    setTimeout(() => {
      overlay.classList.remove('show');
      setTimeout(() => overlay.remove(), 260);
    }, 2200);
  }

  function hideTranslationOverlay() {
    const overlay = document.getElementById('p4-i18n-progress');
    clearInterval(overlayTimer);
    overlayTimer = null;
    if (!overlay) return;
    overlay.classList.remove('show');
    setTimeout(() => overlay.remove(), 260);
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

  function hasActiveLanguage(code) {
    return languages.some(lang => lang.code === code);
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
    activeLanguage = hasActiveLanguage(bundle.language) ? bundle.language : DEFAULT_LANGUAGE;
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

  function collectMachineTextNodes(root) {
    const blocked = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'INPUT', 'SELECT', 'OPTION', 'CODE', 'PRE']);
    const groups = new Map();
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const parent = node.parentElement;
        if (!parent || blocked.has(parent.tagName) || shouldIgnoreElement(parent)) return NodeFilter.FILTER_REJECT;
        if (machineTranslatedNodes.get(node) === normalizeText(node.nodeValue)) return NodeFilter.FILTER_REJECT;
        const keyedParent = parent.closest('[data-i18n]');
        if (keyedParent?.dataset?.i18n && activeTranslations?.[keyedParent.dataset.i18n]) return NodeFilter.FILTER_REJECT;
        const text = normalizeText(node.nodeValue);
        if (!shouldMachineTranslate(text)) return NodeFilter.FILTER_REJECT;
        if (t(text) !== text) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    while (walker.nextNode()) {
      const node = walker.currentNode;
      const text = normalizeText(node.nodeValue);
      if (!groups.has(text)) groups.set(text, []);
      groups.get(text).push(node);
    }
    return groups;
  }

  function applyMachineResult(groups, translations) {
    groups.forEach((nodes, source) => {
      const translated = translations[source] || machineCache.get(`${activeLanguage}:${source}`);
      if (!translated || translated === source) return;
      nodes.forEach(node => {
        if (!node?.nodeValue) return;
        const raw = node.nodeValue;
        const current = normalizeText(raw);
        if (current === source) {
          node.nodeValue = raw.replace(raw.trim(), translated);
          machineTranslatedNodes.set(node, normalizeText(node.nodeValue));
        }
      });
    });
  }

  function collectMachineAttributes(root) {
    const groups = new Map();
    root.querySelectorAll?.('[title],[aria-label],[placeholder],input[type="button"][value],input[type="submit"][value]').forEach(element => {
      if (shouldIgnoreElement(element) || element.dataset?.i18nAttr) return;
      ['title', 'aria-label', 'placeholder', 'value'].forEach(attr => {
        if (attr === 'value' && !/^(button|submit)$/i.test(element.getAttribute('type') || '')) return;
        const text = normalizeText(element.getAttribute(attr));
        if (!shouldMachineTranslate(text) || t(text) !== text) return;
        const attrMarks = machineTranslatedAttrs.get(element) || {};
        if (attrMarks[attr] === text) return;
        if (!groups.has(text)) groups.set(text, []);
        groups.get(text).push({ element, attr });
      });
    });
    return groups;
  }

  function applyMachineAttributeResult(groups, translations) {
    groups.forEach((items, source) => {
      const translated = translations[source] || machineCache.get(`${activeLanguage}:${source}`);
      if (!translated || translated === source) return;
      items.forEach(({ element, attr }) => {
        if (normalizeText(element.getAttribute(attr)) !== source) return;
        element.setAttribute(attr, translated);
        const attrMarks = machineTranslatedAttrs.get(element) || {};
        attrMarks[attr] = translated;
        machineTranslatedAttrs.set(element, attrMarks);
      });
    });
  }

  function pageTranslationKey() {
    return `${activeLanguage}:${location.pathname}${location.search}`;
  }

  async function applyMachineTranslations(root = document.body, options = {}) {
    const allowFetch = options.allowFetch !== false;
    if (!root || activeLanguage === DEFAULT_LANGUAGE) {
      hideTranslationOverlay();
      return;
    }
    if (translationInFlight) {
      pendingTranslationRoot = root;
      return;
    }
    translationInFlight = true;
    const runId = ++machineRunId;
    let totalMissing = 0;
    const startedAt = Date.now();

    try {
      const groups = collectMachineTextNodes(root);
      const attrGroups = collectMachineAttributes(root);
      if (!groups.size && !attrGroups.size) {
        hideTranslationOverlay();
        return;
      }

      const ready = {};
      const missing = [];
      const allTexts = [...new Set([...groups.keys(), ...attrGroups.keys()])].slice(0, 400);
      allTexts.forEach(text => {
        const key = `${activeLanguage}:${text}`;
        if (machineCache.has(key)) ready[text] = machineCache.get(key);
        else missing.push(text);
      });
      applyMachineResult(groups, ready);
      applyMachineAttributeResult(attrGroups, ready);
      if (!missing.length) {
        hideTranslationOverlay();
        return;
      }
      if (!allowFetch || fetchedPageTranslations.has(pageTranslationKey())) {
        hideTranslationOverlay();
        return;
      }

      totalMissing = missing.length;
      showTranslationOverlay(totalMissing, startedAt);
      fetchedPageTranslations.add(pageTranslationKey());
      if (runId !== machineRunId || activeLanguage === DEFAULT_LANGUAGE) return;
      const res = await fetch('/api/i18n/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ language: activeLanguage, texts: missing }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || data.error || 'translation failed');
      if (runId !== machineRunId || data.language !== activeLanguage) return;
      const translations = data.translations || {};
      Object.entries(translations).forEach(([source, translated]) => {
        machineCache.set(`${activeLanguage}:${source}`, translated);
      });
      applyMachineResult(groups, translations);
      applyMachineAttributeResult(attrGroups, translations);
      const translatedTotal = Number(data.stats?.translated || Object.keys(translations).length);
      if (translatedTotal <= 0) {
        failTranslationOverlay(`Aucune traduction recue pour ${activeLanguage.toUpperCase()}. Provider: ${data.provider || 'inconnu'}.`);
      } else {
        completeTranslationOverlay(totalMissing);
      }
    } catch (error) {
      failTranslationOverlay(error.message || 'Le service de traduction ne repond pas.');
    } finally {
      translationInFlight = false;
      if (pendingTranslationRoot && activeLanguage !== DEFAULT_LANGUAGE) {
        const nextRoot = pendingTranslationRoot;
        pendingTranslationRoot = null;
        setTimeout(() => applyMachineTranslations(nextRoot, { allowFetch: false }), 250);
      }
    }
  }

  function startObserver() {
    if (observer || !document.body || !window.MutationObserver) return;
    observer = new MutationObserver(() => {
      clearTimeout(observerTimer);
      observerTimer = setTimeout(() => {
        if (activeLanguage !== DEFAULT_LANGUAGE) {
          applyMachineTranslations(document.body, { allowFetch: false });
        }
      }, 350);
    });
    observer.observe(document.body, {
      childList: true,
      characterData: true,
      subtree: true,
    });
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
        if (!parent || blocked.has(parent.tagName) || shouldIgnoreElement(parent) || parent.closest('[data-i18n]')) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach(translateNode);
    applyMachineTranslations(root);
    startObserver();
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

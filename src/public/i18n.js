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
  const MACHINE_BATCH_SIZE = 28;
  let machineRunId = 0;
  let observer = null;
  let observerTimer = null;
  let translationInFlight = false;
  let pendingTranslationRoot = null;

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

  function ensureTranslationToast() {
    let toast = document.getElementById('p4-i18n-progress');
    if (toast) return toast;
    const style = document.createElement('style');
    style.id = 'p4-i18n-progress-style';
    style.textContent = `
      .p4-i18n-progress{position:fixed;left:50%;bottom:22px;z-index:100000;min-width:min(380px,calc(100vw - 28px));padding:13px 14px;border:1px solid rgba(133,235,255,.26);border-radius:16px;background:rgba(13,12,28,.94);box-shadow:0 18px 55px rgba(0,0,0,.42),0 0 32px rgba(133,235,255,.08);backdrop-filter:blur(16px);color:#f4f4fb;font-family:Inter,system-ui,sans-serif;transform:translate(-50%,18px);opacity:0;pointer-events:none;transition:opacity .22s ease,transform .22s ease}
      .p4-i18n-progress.show{opacity:1;transform:translate(-50%,0)}
      .p4-i18n-progress-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:9px}
      .p4-i18n-progress-title{font:900 13px "Barlow Condensed",Inter,sans-serif;letter-spacing:1.2px;text-transform:uppercase}
      .p4-i18n-progress-eta{color:#85ebff;font-size:11px;font-weight:800;white-space:nowrap}
      .p4-i18n-progress-text{color:rgba(244,244,251,.68);font-size:11px;line-height:1.35;margin-bottom:10px}
      .p4-i18n-progress-track{height:7px;border-radius:999px;overflow:hidden;background:rgba(255,255,255,.08)}
      .p4-i18n-progress-fill{width:0%;height:100%;border-radius:inherit;background:linear-gradient(90deg,#ff2d55,#ffd60a,#85ebff);transition:width .24s ease}
    `;
    document.head.appendChild(style);
    toast = document.createElement('div');
    toast.id = 'p4-i18n-progress';
    toast.className = 'p4-i18n-progress';
    toast.setAttribute('role', 'status');
    toast.setAttribute('aria-live', 'polite');
    toast.innerHTML = `
      <div class="p4-i18n-progress-head">
        <div class="p4-i18n-progress-title">Traduction en cours</div>
        <div class="p4-i18n-progress-eta">calcul...</div>
      </div>
      <div class="p4-i18n-progress-text">Preparation des textes...</div>
      <div class="p4-i18n-progress-track"><div class="p4-i18n-progress-fill"></div></div>
    `;
    document.body.appendChild(toast);
    return toast;
  }

  function formatEta(ms) {
    if (!Number.isFinite(ms) || ms <= 0) return 'quelques secondes';
    const seconds = Math.max(1, Math.ceil(ms / 1000));
    if (seconds < 60) return `${seconds}s restantes`;
    const minutes = Math.floor(seconds / 60);
    const rest = seconds % 60;
    return `${minutes}m ${String(rest).padStart(2, '0')}s restantes`;
  }

  function updateTranslationToast(done, total, startedAt) {
    if (activeLanguage === DEFAULT_LANGUAGE || total <= 0) return;
    const toast = ensureTranslationToast();
    const percent = total ? Math.min(100, Math.round((done / total) * 100)) : 0;
    const elapsed = Date.now() - startedAt;
    const etaMs = done > 0 ? (elapsed / done) * Math.max(0, total - done) : 0;
    toast.querySelector('.p4-i18n-progress-eta').textContent = done > 0 ? formatEta(etaMs) : 'calcul...';
    toast.querySelector('.p4-i18n-progress-text').textContent = `${done}/${total} textes traduits en ${activeLanguage.toUpperCase()} (${percent}%).`;
    toast.querySelector('.p4-i18n-progress-fill').style.width = `${percent}%`;
    requestAnimationFrame(() => toast.classList.add('show'));
  }

  function completeTranslationToast(total) {
    const toast = document.getElementById('p4-i18n-progress');
    if (!toast) return;
    toast.querySelector('.p4-i18n-progress-eta').textContent = 'termine';
    toast.querySelector('.p4-i18n-progress-text').textContent = `${total} textes traduits.`;
    toast.querySelector('.p4-i18n-progress-fill').style.width = '100%';
    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.remove(), 260);
    }, 900);
  }

  function hideTranslationToast() {
    const toast = document.getElementById('p4-i18n-progress');
    if (!toast) return;
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 260);
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

  async function applyMachineTranslations(root = document.body) {
    if (!root || activeLanguage === DEFAULT_LANGUAGE) {
      hideTranslationToast();
      return;
    }
    if (translationInFlight) {
      pendingTranslationRoot = root;
      return;
    }
    translationInFlight = true;
    const runId = ++machineRunId;
    let translatedCount = 0;
    let totalMissing = 0;
    const startedAt = Date.now();

    try {
      const groups = collectMachineTextNodes(root);
      const attrGroups = collectMachineAttributes(root);
      if (!groups.size && !attrGroups.size) {
        hideTranslationToast();
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
        hideTranslationToast();
        return;
      }

      totalMissing = missing.length;
      updateTranslationToast(0, totalMissing, startedAt);
      for (let index = 0; index < missing.length; index += MACHINE_BATCH_SIZE) {
        if (runId !== machineRunId || activeLanguage === DEFAULT_LANGUAGE) return;
        const batch = missing.slice(index, index + MACHINE_BATCH_SIZE);
        const res = await fetch('/api/i18n/translate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ language: activeLanguage, texts: batch }),
        });
        if (!res.ok) break;
        const data = await res.json();
        if (runId !== machineRunId || data.language !== activeLanguage) return;
        const translations = data.translations || {};
        Object.entries(translations).forEach(([source, translated]) => {
          machineCache.set(`${activeLanguage}:${source}`, translated);
        });
        applyMachineResult(groups, translations);
        applyMachineAttributeResult(attrGroups, translations);
        translatedCount = Math.min(totalMissing, index + batch.length);
        updateTranslationToast(translatedCount, totalMissing, startedAt);
      }
      if (translatedCount >= totalMissing) completeTranslationToast(totalMissing);
    } catch (_) {
      hideTranslationToast();
    } finally {
      translationInFlight = false;
      if (pendingTranslationRoot && activeLanguage !== DEFAULT_LANGUAGE) {
        const nextRoot = pendingTranslationRoot;
        pendingTranslationRoot = null;
        setTimeout(() => applyMachineTranslations(nextRoot), 250);
      }
    }
  }

  function startObserver() {
    if (observer || !document.body || !window.MutationObserver) return;
    observer = new MutationObserver(() => {
      clearTimeout(observerTimer);
      observerTimer = setTimeout(() => {
        if (activeLanguage !== DEFAULT_LANGUAGE) {
          applyMachineTranslations(document.body);
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

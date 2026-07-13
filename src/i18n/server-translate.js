'use strict';

const fs = require('fs');
const path = require('path');

const LANGUAGES = [
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

const SOURCE = {
  'common.save': 'Enregistrer',
  'common.close': 'Fermer',
  'common.menu': 'Menu',
  'common.openMenu': 'Ouvrir le menu',
  'common.closeMenu': 'Fermer le menu',
  'common.preview': 'Aperçu :',
  'common.languageSaved': 'Langue enregistree',
  'common.languageUnknown': 'Langue non reconnue.',
  'common.loginForLanguage': 'Connecte-toi pour changer la langue.',

  'menu.home.label': 'Accueil',
  'menu.home.sub': 'Lancer une partie',
  'menu.profile.label': 'Profil',
  'menu.profile.sub': 'Compte et style',
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
  'menu.clan.sub': 'Equipe et tchat',  'menu.analysis.label': 'Analyse',
  'menu.analysis.sub': 'Moteur de coups',
  'menu.shop.label': 'Boutique',
  'menu.shop.sub': 'Coins et gemmes',
  'menu.stats.label': 'Stats',
  'menu.stats.sub': 'Données du site',
  'menu.news.label': 'News',
  'menu.news.sub': 'Mise a jour 3.4.0',
  'menu.rules.label': 'Règles',
  'menu.rules.sub': 'Jeu et gains',
  'menu.api.label': 'API',
  'menu.api.sub': 'Docs développeur',
  'menu.discord.label': 'Discord',
  'menu.discord.sub': 'Communauté',
  'menu.install.label': 'Installer l’application',
  'menu.install.sub': 'Ouvrir comme une vraie application',
  'menu.install.ios': 'Installer sur iPhone',
  'menu.install.iosSub': 'Partager puis Sur l’écran d’accueil',
  'menu.footer': 'Menu compact pour éviter les pages qui débordent. Les pages de partie gardent leur interface dédiée.',
  'menu.language.title': 'Langue',
  'menu.language.help': 'Choix de la langue',
  'menu.language.validate': 'Valider',
  'menu.language.refresh': 'La page va se recharger pour appliquer la langue.',

  'profile.custom.title': 'Personnalisation',
  'profile.custom.sub': 'Pseudo, couleurs, pion, decor et medias premium.',
  'profile.nickname.title': 'Pseudo du profil',
  'profile.tokenColor.title': 'Couleur de jeton',
  'profile.finalPreview': 'Aperçu final',
  'profile.color1': 'Couleur 1',
  'profile.color2': 'Couleur 2',
  'profile.tokenShape.title': 'Forme de pion',
  'profile.avatarDecoration.title': 'Décoration avatar',
  'profile.cursor.title': 'Curseur du site',
  'profile.chooseDecoration': 'Choisir une décoration',
  'home.playBot': "Jouer contre l'ordinateur",
  'home.local1v1': '1v1 Local',
  'home.joinGame': 'Rejoindre la partie',
  'home.sendDuel': 'Envoyer un duel',
  'home.myProfile': 'Mon profil',
};

const TRANSLATIONS = {
  en: {
    'common.save': 'Save',
    'common.close': 'Close',
    'common.menu': 'Menu',
    'common.openMenu': 'Open menu',
    'common.closeMenu': 'Close menu',
    'common.preview': 'Preview:',
    'common.languageSaved': 'Language saved',
    'common.languageUnknown': 'Language not recognized.',
    'common.loginForLanguage': 'Log in to change the language.',

    'menu.home.label': 'Home',
    'menu.home.sub': 'Start a game',
    'menu.profile.label': 'Profile',
    'menu.profile.sub': 'Account and style',
    'menu.progression.label': 'Progression',
    'menu.progression.sub': 'Quests and themes',
    'menu.live.label': 'Live',
    'menu.live.sub': 'Spectator',
    'menu.local.label': 'Local',
    'menu.local.sub': 'Offline 1v1',
    'menu.players.label': 'Players',
    'menu.players.sub': 'Public profiles',
    'menu.leaderboard.label': 'Leaderboard',
    'menu.leaderboard.sub': 'Members and bots',
    'menu.clan.label': 'Clan',
    'menu.clan.sub': 'Team and chat',    'menu.analysis.label': 'Analysis',
    'menu.analysis.sub': 'Move engine',
    'menu.shop.label': 'Shop',
    'menu.shop.sub': 'Coins and gems',
    'menu.stats.label': 'Stats',
    'menu.stats.sub': 'Site data',
    'menu.news.label': 'News',
    'menu.news.sub': 'Update 3.4.0',
    'menu.rules.label': 'Rules',
    'menu.rules.sub': 'Game and rewards',
    'menu.api.label': 'API',
    'menu.api.sub': 'Developer docs',
    'menu.discord.label': 'Discord',
    'menu.discord.sub': 'Community',
    'menu.install.label': 'Install the app',
    'menu.install.sub': 'Open like a real app',
    'menu.install.ios': 'Install on iPhone',
    'menu.install.iosSub': 'Share then Add to Home Screen',
    'menu.footer': 'Compact menu to avoid overflowing pages. Game pages keep their dedicated interface.',
    'menu.language.title': 'Language',
    'menu.language.help': 'Choose language',
    'menu.language.validate': 'Apply',
    'menu.language.refresh': 'The page will reload to apply the language.',

    'profile.custom.title': 'Customization',
    'profile.custom.sub': 'Nickname, colors, token, decor and premium media.',
    'profile.nickname.title': 'Profile nickname',
    'profile.tokenColor.title': 'Token color',
    'profile.finalPreview': 'Final preview',
    'profile.color1': 'Color 1',
    'profile.color2': 'Color 2',
    'profile.tokenShape.title': 'Token shape',
    'profile.avatarDecoration.title': 'Avatar decoration',
    'profile.cursor.title': 'Site cursor',
    'profile.chooseDecoration': 'Choose a decoration',
    'home.playBot': 'Play against the computer',
    'home.local1v1': 'Local 1v1',
    'home.joinGame': 'Join the game',
    'home.sendDuel': 'Send a duel',
    'home.myProfile': 'My profile',
  },
  es: {
    'common.save': 'Guardar',
    'common.close': 'Cerrar',
    'common.menu': 'Menú',
    'common.openMenu': 'Abrir menú',
    'common.closeMenu': 'Cerrar menú',
    'common.preview': 'Vista previa:',
    'common.languageSaved': 'Idioma guardado',
    'common.languageUnknown': 'Idioma no reconocido.',
    'common.loginForLanguage': 'Inicia sesión para cambiar el idioma.',

    'menu.home.label': 'Inicio',
    'menu.home.sub': 'Iniciar partida',
    'menu.profile.label': 'Perfil',
    'menu.profile.sub': 'Cuenta y estilo',
    'menu.progression.label': 'Progreso',
    'menu.progression.sub': 'Misiones y temas',
    'menu.live.label': 'En directo',
    'menu.live.sub': 'Espectador',
    'menu.local.label': 'Local',
    'menu.local.sub': '1v1 sin conexión',
    'menu.players.label': 'Jugadores',
    'menu.players.sub': 'Perfiles públicos',
    'menu.leaderboard.label': 'Clasificación',
    'menu.leaderboard.sub': 'Miembros y bots',
    'menu.clan.label': 'Clan',
    'menu.clan.sub': 'Equipo y chat',    'menu.analysis.label': 'Análisis',
    'menu.analysis.sub': 'Motor de jugadas',
    'menu.shop.label': 'Tienda',
    'menu.shop.sub': 'Monedas y gemas',
    'menu.stats.label': 'Estadísticas',
    'menu.stats.sub': 'Datos del sitio',
    'menu.news.label': 'Noticias',
    'menu.news.sub': 'Actualización 3.4.0',
    'menu.rules.label': 'Reglas',
    'menu.rules.sub': 'Juego y recompensas',
    'menu.api.label': 'API',
    'menu.api.sub': 'Docs para desarrolladores',
    'menu.discord.label': 'Discord',
    'menu.discord.sub': 'Comunidad',
    'menu.install.label': 'Instalar la app',
    'menu.install.sub': 'Abrir como una app real',
    'menu.install.ios': 'Instalar en iPhone',
    'menu.install.iosSub': 'Compartir y añadir a inicio',
    'menu.footer': 'Menú compacto para evitar páginas desbordadas. Las páginas de partida conservan su interfaz dedicada.',
    'menu.language.title': 'Idioma',
    'menu.language.help': 'Elegir idioma',
    'menu.language.validate': 'Validar',
    'menu.language.refresh': 'La página se recargará para aplicar el idioma.',

    'profile.custom.title': 'Personalización',
    'profile.custom.sub': 'Apodo, colores, ficha, decoración y medios premium.',
    'profile.nickname.title': 'Apodo del perfil',
    'profile.tokenColor.title': 'Color de ficha',
    'profile.finalPreview': 'Vista final',
    'profile.color1': 'Color 1',
    'profile.color2': 'Color 2',
    'profile.tokenShape.title': 'Forma de ficha',
    'profile.avatarDecoration.title': 'Decoración de avatar',
    'profile.cursor.title': 'Cursor del sitio',
    'profile.chooseDecoration': 'Elegir una decoración',
    'home.playBot': 'Jugar contra el ordenador',
    'home.local1v1': '1v1 local',
    'home.joinGame': 'Unirse a la partida',
    'home.sendDuel': 'Enviar un duelo',
    'home.myProfile': 'Mi perfil',
  },
};

const LANGUAGE_SET = new Set(LANGUAGES.map(language => language.code));
const CACHE_PATH = path.join(__dirname, '../../data/i18n-machine-cache.json');
const LIBRETRANSLATE_URL = String(process.env.LIBRETRANSLATE_URL || '').replace(/\/+$/, '');
const LIBRETRANSLATE_KEY = String(process.env.LIBRETRANSLATE_KEY || process.env.TRANSLATION_API_KEY || '');
const TRANSLATION_EMAIL = String(process.env.TRANSLATION_CONTACT_EMAIL || process.env.PUBLIC_CONTACT_EMAIL || '');
const MAX_MACHINE_TEXTS = numberFromEnv('I18N_MAX_MACHINE_TEXTS', 400, { min: 1, max: 800 });
const MAX_MACHINE_TEXT_BYTES = 500;
const EXTERNAL_TRANSLATION_TIMEOUT_MS = numberFromEnv('I18N_TRANSLATION_TIMEOUT_MS', 60000, { min: 5000, max: 300000 });
const LIBRETRANSLATE_BATCH_SIZE = numberFromEnv('LIBRETRANSLATE_BATCH_SIZE', 1, { min: 1, max: 25 });
const LIBRETRANSLATE_DELAY_MS = numberFromEnv('LIBRETRANSLATE_DELAY_MS', 1500, { min: 0, max: 30000 });
const LANGUAGE_DISCOVERY_TTL_MS = 10 * 60 * 1000;
const PROVIDER_LANGUAGE_CODES = {
  mymemory: {
    en: 'en',
    es: 'es',
    de: 'de',
    it: 'it',
    pt: 'pt-PT',
    nl: 'nl',
    pl: 'pl',
    ro: 'ro',
    sv: 'sv',
    tr: 'tr',
    ru: 'ru',
    uk: 'uk-UA',
    ar: 'ar',
    zh: 'zh-CN',
    ja: 'ja',
    ko: 'ko',
    el: 'el',
    cs: 'cs',
    hu: 'hu',
    id: 'id',
    hi: 'hi',
  },
  libretranslate: {
    en: 'en',
    es: 'es',
    de: 'de',
    it: 'it',
    pt: 'pt',
    nl: 'nl',
    pl: 'pl',
    ro: 'ro',
    sv: 'sv',
    tr: 'tr',
    ru: 'ru',
    uk: 'uk',
    ar: 'ar',
    zh: 'zh-Hans',
    ja: 'ja',
    ko: 'ko',
    el: 'el',
    cs: 'cs',
    hu: 'hu',
    id: 'id',
    hi: 'hi',
  },
};
const PROVIDER_TO_SITE_LANGUAGE_CODES = {
  mymemory: {
    'zh-cn': 'zh',
    'pt-pt': 'pt',
    'uk-ua': 'uk',
  },
  libretranslate: {
    'zh-hans': 'zh',
    'zh-cn': 'zh',
    'zh': 'zh',
  },
};

let machineCache = loadMachineCache();
let languageDiscoveryCache = null;

function numberFromEnv(name, fallback, limits = {}) {
  const value = Number(process.env[name]);
  if (!Number.isFinite(value)) return fallback;
  const rounded = Math.round(value);
  if (Number.isFinite(limits.min) && rounded < limits.min) return limits.min;
  if (Number.isFinite(limits.max) && rounded > limits.max) return limits.max;
  return rounded;
}

function getMachineProvider() {
  const configured = String(process.env.TRANSLATION_PROVIDER || process.env.I18N_TRANSLATION_PROVIDER || '').trim().toLowerCase();
  if (configured) return configured;
  return LIBRETRANSLATE_URL ? 'libretranslate' : 'disabled';
}

const LOCAL_MACHINE_TRANSLATIONS = {
  en: {
    'Jouez en ligne': 'Play online',
    'Connecte · Défie · Domine': 'Connect · Challenge · Dominate',
    'Duels rapides': 'Quick duels',
    'Parties classées': 'Ranked games',
    'Spectateur': 'Spectator',
    'Live en direct': 'Live',
    'Progression': 'Progression',
    'Quêtes 3.4.0': 'Quests 3.4.0',
    'Communauté': 'Community',
    'Clans & events': 'Clans & events',
    'Règles & CGU à jour': 'Rules & terms updated',
    'Lire les CGU': 'Read the terms',
    'Entrée immédiate': 'Immediate entry',
    'Mode duel': 'Duel mode',
    'Entrer dans l’arène': 'Enter arena',
    'Connexion': 'Log in',
    'Créer un compte': 'Create account',
    'Se connecter': 'Log in',
    'Connecter via Discord': 'Connect with Discord',
    'Voir mon profil': 'View my profile',
    'Jouer contre l’ordinateur': 'Play against the computer',
    '1v1 local': 'Local 1v1',
    'Pseudo': 'Username',
    'Mot de passe': 'Password',
    'Ou': 'Or',
    'Mode ranked compétitif': 'Competitive ranked mode',
    'Connexion classique ou Discord': 'Classic login or Discord',
    'Bot configurable par difficulté ou ELO': 'Bot configurable by difficulty or ELO',    'Quêtes bots, boutique et profil en 3.4.0': 'Bot quests, shop and profile in 3.4.0',
  },
  es: {
    'Jouez en ligne': 'Juega en línea',
    'Connecte · Défie · Domine': 'Conecta · Desafía · Domina',
    'Duels rapides': 'Duelos rápidos',
    'Parties classées': 'Partidas clasificatorias',
    'Live en direct': 'Directo',
    'Quêtes 3.4.0': 'Misiones 3.4.0',
    'Règles & CGU à jour': 'Reglas y condiciones actualizadas',
    'Lire les CGU': 'Leer las condiciones',
    'Entrée immédiate': 'Entrada inmediata',
    'Mode duel': 'Modo duelo',
    'Entrer dans l’arène': 'Entrar en la arena',
    'Connexion': 'Iniciar sesión',
    'Créer un compte': 'Crear cuenta',
    'Se connecter': 'Iniciar sesión',
    'Connecter via Discord': 'Conectar con Discord',
    'Voir mon profil': 'Ver mi perfil',
    'Jouer contre l’ordinateur': 'Jugar contra el ordenador',
    '1v1 local': '1v1 local',
    'Pseudo': 'Usuario',
    'Mot de passe': 'Contraseña',
    'Ou': 'O',
  },
};

function loadMachineCache() {
  try {
    return JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8'));
  } catch (_) {
    return {};
  }
}

function saveMachineCache() {
  try {
    fs.mkdirSync(path.dirname(CACHE_PATH), { recursive: true });
    fs.writeFileSync(CACHE_PATH, JSON.stringify(machineCache, null, 2), 'utf8');
  } catch (_) {}
}

function normalizeLanguage(code) {
  const normalized = normalizeProviderCode(code);
  const mapped = siteLanguageCodeFromAnyProvider(normalized);
  if (LANGUAGE_SET.has(mapped)) return mapped;
  return LANGUAGE_SET.has(normalized) ? normalized : 'fr';
}

function normalizeProviderCode(code) {
  return String(code || 'fr').trim().toLowerCase();
}

function siteLanguageCodeFromProvider(provider, code) {
  const normalized = normalizeProviderCode(code);
  const providerMap = PROVIDER_TO_SITE_LANGUAGE_CODES[provider] || {};
  return providerMap[normalized] || normalized;
}

function siteLanguageCodeFromAnyProvider(code) {
  const normalized = normalizeProviderCode(code);
  for (const provider of Object.keys(PROVIDER_TO_SITE_LANGUAGE_CODES)) {
    const mapped = siteLanguageCodeFromProvider(provider, normalized);
    if (mapped !== normalized) return mapped;
  }
  return normalized;
}

function normalizeText(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

function wait(ms) {
  if (!ms) return Promise.resolve();
  return new Promise(resolve => setTimeout(resolve, ms));
}

function textByteLength(text) {
  return Buffer.byteLength(String(text || ''), 'utf8');
}

function shouldMachineTranslate(text) {
  const value = normalizeText(text);
  if (value.length < 2 || value.length > 240) return false;
  if (textByteLength(value) > MAX_MACHINE_TEXT_BYTES) return false;
  if (!/[A-Za-zÀ-ÖØ-öø-ÿ]/.test(value)) return false;
  if (/puissance\s*-?\s*4|puissance4/i.test(value)) return false;
  if (/^(https?:\/\/|www\.|[#@])/.test(value)) return false;
  if (/^[\d\s.,:;!?%/+()[\]-]+$/.test(value)) return false;
  return true;
}

function localMachineTranslation(text, language) {
  const target = normalizeLanguage(language);
  const source = normalizeText(text);
  const direct = LOCAL_MACHINE_TRANSLATIONS[target]?.[source];
  if (direct) return direct;
  const lowerMatch = Object.entries(LOCAL_MACHINE_TRANSLATIONS[target] || {})
    .find(([key]) => key.toLowerCase() === source.toLowerCase());
  return lowerMatch?.[1] || '';
}

function splitDecoratedText(text) {
  const source = normalizeText(text);
  const match = source.match(/^([^A-Za-zÀ-ÖØ-öø-ÿ0-9]*)(.*?)([^A-Za-zÀ-ÖØ-öø-ÿ0-9]*)$/);
  if (!match) return { prefix: '', core: source, suffix: '' };
  return { prefix: match[1] || '', core: normalizeText(match[2]), suffix: match[3] || '' };
}

function machineCacheKey(language, text) {
  return `${normalizeLanguage(language)}:${normalizeText(text).toLowerCase()}`;
}

function providerLanguageCode(language) {
  const target = normalizeLanguage(language);
  if (target === 'fr') return 'fr';
  const machineProvider = getMachineProvider();
  const providerMap = PROVIDER_LANGUAGE_CODES[machineProvider] || {};
  return providerMap[target] || target;
}

async function fetchJsonWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), EXTERNAL_TRANSLATION_TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    const data = await res.json().catch(() => ({}));
    return { res, data };
  } finally {
    clearTimeout(timer);
  }
}

async function translateWithLibreTranslate(text, language) {
  if (!LIBRETRANSLATE_URL) throw new Error('LibreTranslate URL missing');
  const target = providerLanguageCode(language);
  if (!target) throw new Error(`Language ${language} not supported by libretranslate`);
  const { res, data } = await fetchJsonWithTimeout(`${LIBRETRANSLATE_URL}/translate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      q: text,
      source: 'fr',
      target,
      format: 'text',
      ...(LIBRETRANSLATE_KEY ? { api_key: LIBRETRANSLATE_KEY } : {}),
    }),
  });
  if (!res.ok || !data.translatedText) throw new Error(data.error || 'LibreTranslate failed');
  return normalizeText(data.translatedText);
}

async function translateBatchWithLibreTranslate(texts, language) {
  if (!LIBRETRANSLATE_URL) throw new Error('LibreTranslate URL missing');
  const target = providerLanguageCode(language);
  if (!target) throw new Error(`Language ${language} not supported by libretranslate`);
  const batch = (Array.isArray(texts) ? texts : []).map(normalizeText).filter(Boolean);
  if (!batch.length) return [];
  const translatedBatch = [];
  const chunkErrors = [];

  for (let offset = 0; offset < batch.length; offset += LIBRETRANSLATE_BATCH_SIZE) {
    if (offset > 0) await wait(LIBRETRANSLATE_DELAY_MS);
    const chunk = batch.slice(offset, offset + LIBRETRANSLATE_BATCH_SIZE);
    try {
      const { res, data } = await fetchJsonWithTimeout(`${LIBRETRANSLATE_URL}/translate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          q: chunk.length === 1 ? chunk[0] : chunk,
          source: 'fr',
          target,
          format: 'text',
          ...(LIBRETRANSLATE_KEY ? { api_key: LIBRETRANSLATE_KEY } : {}),
        }),
      });
      if (!res.ok || !data.translatedText) throw new Error(data.error || 'LibreTranslate failed');
      const translated = Array.isArray(data.translatedText) ? data.translatedText : [data.translatedText];
      chunk.forEach((_, index) => translatedBatch.push(normalizeText(translated[index] || '')));
    } catch (error) {
      const message = error.name === 'AbortError'
        ? `LibreTranslate timeout apres ${Math.round(EXTERNAL_TRANSLATION_TIMEOUT_MS / 1000)}s`
        : (error.message || 'LibreTranslate failed');
      chunk.forEach(text => {
        translatedBatch.push('');
        chunkErrors.push({ text, error: message });
      });
    }
  }

  translatedBatch.errors = chunkErrors;
  return translatedBatch;
}

async function translateWithMyMemory(text, language) {
  const target = providerLanguageCode(language);
  if (!target) throw new Error(`Language ${language} not supported by mymemory`);
  const url = new URL('https://api.mymemory.translated.net/get');
  url.searchParams.set('q', text);
  url.searchParams.set('langpair', `fr|${target}`);
  url.searchParams.set('mt', '1');
  if (TRANSLATION_EMAIL) url.searchParams.set('de', TRANSLATION_EMAIL);
  const { res, data } = await fetchJsonWithTimeout(url);
  const translated = data?.responseData?.translatedText || data?.matches?.[0]?.translation || '';
  if (!res.ok || !translated) throw new Error(data?.responseDetails || 'MyMemory failed');
  return normalizeText(translated);
}

async function translateOne(text, language) {
  const target = normalizeLanguage(language);
  const source = normalizeText(text);
  if (target === 'fr' || !shouldMachineTranslate(source)) return source;
  const machineProvider = getMachineProvider();
  if (machineProvider === 'disabled') throw new Error('No translation provider configured');
  const key = machineCacheKey(target, source);
  if (machineCache[key]) return machineCache[key];
  const local = localMachineTranslation(source, target);
  if (local) {
    machineCache[key] = local;
    saveMachineCache();
    return local;
  }

  const decorated = splitDecoratedText(source);
  const textForApi = decorated.core || source;
  const localCore = decorated.core !== source ? localMachineTranslation(textForApi, target) : '';
  if (localCore) {
    machineCache[key] = `${decorated.prefix}${localCore}${decorated.suffix}`.trim();
    saveMachineCache();
    return machineCache[key];
  }

  let translatedCore = '';
  if (machineProvider === 'libretranslate') {
    translatedCore = await translateWithLibreTranslate(textForApi, target);
  } else if (machineProvider === 'mymemory') {
    translatedCore = await translateWithMyMemory(textForApi, target);
  } else {
    throw new Error(`Translation provider ${machineProvider} is not supported`);
  }
  const translated = decorated.core !== source
    ? `${decorated.prefix}${translatedCore}${decorated.suffix}`.trim()
    : translatedCore;

  machineCache[key] = translated || source;
  saveMachineCache();
  return machineCache[key];
}

async function translateTexts(texts, language) {
  const result = await translateTextsDetailed(texts, language);
  return result.translations;
}

async function translateTextsDetailed(texts, language) {
  const target = normalizeLanguage(language);
  const entries = [...new Set((Array.isArray(texts) ? texts : [])
    .map(normalizeText)
    .filter(shouldMachineTranslate))]
    .slice(0, MAX_MACHINE_TEXTS);

  const translations = {};
  const errors = [];
  if (target === 'fr') return { translations, errors, total: entries.length, translated: 0, failed: 0 };

  const machineProvider = getMachineProvider();
  if (machineProvider === 'libretranslate') {
    const apiItems = [];
    for (const text of entries) {
      const key = machineCacheKey(target, text);
      if (machineCache[key]) {
        if (machineCache[key] !== text) translations[text] = machineCache[key];
        continue;
      }

      const local = localMachineTranslation(text, target);
      if (local) {
        machineCache[key] = local;
        translations[text] = local;
        continue;
      }

      const decorated = splitDecoratedText(text);
      const textForApi = decorated.core || text;
      const localCore = decorated.core !== text ? localMachineTranslation(textForApi, target) : '';
      if (localCore) {
        machineCache[key] = `${decorated.prefix}${localCore}${decorated.suffix}`.trim();
        translations[text] = machineCache[key];
        continue;
      }

      apiItems.push({ source: text, cacheKey: key, decorated, textForApi });
    }

    if (apiItems.length) {
      try {
        const translatedTexts = await translateBatchWithLibreTranslate(apiItems.map(item => item.textForApi), target);
        const batchErrors = translatedTexts.errors || [];
        apiItems.forEach((item, index) => {
          const translatedCore = translatedTexts[index] || '';
          if (!translatedCore) {
            const batchError = batchErrors.find(error => error.text === item.textForApi);
            errors.push({ text: item.source, error: batchError?.error || 'LibreTranslate returned an empty translation' });
            return;
          }
          const translated = item.decorated.core !== item.source
            ? `${item.decorated.prefix}${translatedCore}${item.decorated.suffix}`.trim()
            : translatedCore;
          machineCache[item.cacheKey] = translated || item.source;
          if (machineCache[item.cacheKey] !== item.source) translations[item.source] = machineCache[item.cacheKey];
        });
        saveMachineCache();
      } catch (error) {
        apiItems.forEach(item => errors.push({ text: item.source, error: error.message || 'translation failed' }));
      }
    }
    if (Object.keys(translations).length) saveMachineCache();
    return {
      translations,
      errors: errors.slice(0, 12),
      total: entries.length,
      translated: Object.keys(translations).length,
      failed: errors.length,
      provider: machineProvider,
    };
  }

  for (const text of entries) {
    try {
      const translated = await translateOne(text, target);
      if (translated && translated !== text) translations[text] = translated;
    } catch (error) {
      errors.push({ text, error: error.message || 'translation failed' });
    }
  }
  return {
    translations,
    errors: errors.slice(0, 12),
    total: entries.length,
    translated: Object.keys(translations).length,
    failed: errors.length,
    provider: getMachineProvider(),
  };
}

async function discoverLibreTranslateLanguages() {
  if (!LIBRETRANSLATE_URL) return null;
  const now = Date.now();
  if (languageDiscoveryCache && now - languageDiscoveryCache.createdAt < LANGUAGE_DISCOVERY_TTL_MS) {
    return languageDiscoveryCache.languages;
  }

  const { res, data } = await fetchJsonWithTimeout(`${LIBRETRANSLATE_URL}/languages`);
  if (!res.ok || !Array.isArray(data)) throw new Error('LibreTranslate languages unavailable');

  const providerEntries = data
    .map(language => ({
      ...language,
      providerCode: normalizeProviderCode(language.code),
      siteCode: siteLanguageCodeFromProvider('libretranslate', language.code),
    }))
    .filter(language => language.providerCode);
  const providerBySiteCode = new Map(providerEntries.map(language => [language.siteCode, language]));
  const providerCodes = new Set(providerEntries.map(language => language.siteCode));
  const frenchEntry = providerEntries.find(language => language.siteCode === 'fr' || language.providerCode === 'fr');
  const frenchTargets = new Set((frenchEntry?.targets || [])
    .map(code => siteLanguageCodeFromProvider('libretranslate', code))
    .filter(Boolean));
  const providerMap = PROVIDER_LANGUAGE_CODES.libretranslate;
  const languages = LANGUAGES.map(language => {
    const providerEntry = providerBySiteCode.get(language.code);
    return providerEntry
      ? {
        ...language,
        providerCode: providerEntry.code || providerMap[language.code] || language.code,
        providerName: providerEntry.name || language.name,
        aliases: [...new Set([...(language.aliases || []), providerEntry.code, providerEntry.name].filter(Boolean))],
      }
      : language;
  }).filter(language => {
    if (language.code === 'fr') return true;
    if (frenchTargets.size) return frenchTargets.has(language.code);
    return providerCodes.has(language.code) || Boolean(providerMap[language.code]);
  });

  languageDiscoveryCache = {
    createdAt: now,
    languages: languages.length > 1 ? languages : LANGUAGES.filter(language => language.code === 'fr'),
  };
  return languageDiscoveryCache.languages;
}

async function getAvailableLanguages() {
  const machineProvider = getMachineProvider();
  if (machineProvider === 'libretranslate') {
    try {
      return await discoverLibreTranslateLanguages();
    } catch (_) {
      return LANGUAGES.filter(language => language.code === 'fr');
    }
  }
  if (machineProvider === 'mymemory') {
    const providerMap = PROVIDER_LANGUAGE_CODES.mymemory;
    return LANGUAGES.filter(language => language.code === 'fr' || Boolean(providerMap[language.code]));
  }
  return LANGUAGES.filter(language => language.code === 'fr');
}

function buildBundle(language) {
  const lang = normalizeLanguage(language);
  return {
    language: lang,
    fallbackLanguage: 'fr',
    languages: LANGUAGES,
    source: SOURCE,
    translations: lang === 'fr' ? {} : (TRANSLATIONS[lang] || {}),
  };
}

async function buildBundleAsync(language) {
  const bundle = buildBundle(language);
  bundle.languages = await getAvailableLanguages();
  bundle.provider = getMachineProvider();
  bundle.translationConfigured = bundle.provider === 'libretranslate' ? Boolean(LIBRETRANSLATE_URL) : bundle.provider !== 'disabled';
  return bundle;
}

module.exports = {
  LANGUAGES,
  SOURCE,
  TRANSLATIONS,
  LANGUAGE_SET,
  normalizeLanguage,
  buildBundle,
  buildBundleAsync,
  getAvailableLanguages,
  getMachineProvider,
  translateTexts,
  translateTextsDetailed,
};


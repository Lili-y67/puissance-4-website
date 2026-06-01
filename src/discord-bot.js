const {
  Client,
  GatewayIntentBits,
  ActivityType,
  REST,
  Routes,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  MessageFlags,
} = require('discord.js');
const crypto = require('crypto');
const { getAllRankRoleNames, RANKS } = require('./rank');

const DEFAULT_API = 'https://puissance-4-website-production.up.railway.app';
const STAFF_ORDER = { user: 0, moderator: 1, admin: 2 };
const CONNECTED_ROLE_ID = process.env.DISCORD_CONNECTED_ROLE_ID || '1508402625370918952';
const CONNECTED_ROLE_NAME = process.env.DISCORD_CONNECTED_ROLE_NAME || 'Connect\u00e9e';
const GIVEAWAY_MINUTES_MAX = 10080;
const ADMIN_COMMAND_ACTIONS = {
  'admin-stats': 'stats',
  'admin-player': 'player',
  'admin-mute': 'mute',
  'admin-unmute': 'unmute',
  'admin-ban': 'ban',
  'admin-unban': 'unban',
  'admin-coins': 'coins',
  'admin-elo': 'elo',
  'admin-boost-elo': 'boost-elo',
  'admin-boost-coins': 'boost-coins',
  'admin-give-item': 'give-item',
  'admin-crystal': 'crystal',
  'admin-tournoi-finish': 'tournoi-finish',
  'admin-tournoi-pause': 'tournoi-pause',
  'admin-tournoi-resume': 'tournoi-resume',
  'admin-tournoi-delete': 'tournoi-delete',
  'admin-backups': 'backups',
  'admin-maintenance-on': 'maintenance-on',
  'admin-maintenance-off': 'maintenance-off',
  'admin-role-generator': 'role-generator',
  'admin-reload': 'reload',
};

function buildDiscordCommandDefinitions(shopItems = {}) {
  const pseudoOption = (required = true) => ({ type: 3, name: 'pseudo', description: 'Joueur cible', required, autocomplete: true });
  const valueOption = (description = 'Valeur') => ({ type: 10, name: 'valeur', description, required: true });
  const optionalValueOption = (description = 'Valeur') => ({ type: 10, name: 'valeur', description, required: false });
  const reasonOption = (description = 'Raison ou detail') => ({ type: 3, name: 'raison', description, required: false });
  const idOption = (description = 'ID tournoi, partie ou ressource') => ({ type: 3, name: 'id', description, required: true });
  const adminCommand = (name, description, options = []) => ({ name: `admin-${name}`, description, options });

  return [
    { name: 'profil', description: 'Afficher le profil Puissance 4 d un joueur', options: [{ type: 3, name: 'pseudo', description: 'Pseudo du joueur', required: true, autocomplete: true }] },
    { name: 'moi', description: 'Afficher ton profil lie Discord' },
    { name: 'ui', description: 'Afficher les informations Discord d un membre', options: [{ type: 6, name: 'utilisateur', description: 'Membre a inspecter', required: false }] },
    { name: 'classement', description: 'Afficher le top ELO Puissance 4', options: [{ type: 3, name: 'type', description: 'Classement a afficher', required: false, choices: [{ name: 'Membres', value: 'humans' }, { name: 'Bots', value: 'bots' }] }] },
    { name: 'stats', description: 'Afficher les statistiques du site' },
    { name: 'systeme', description: 'Afficher l etat public du serveur' },
    { name: 'live', description: 'Afficher les parties en direct' },
    { name: 'boutique', description: 'Afficher la boutique Puissance 4' },
    { name: 'api', description: 'Afficher la documentation API officielle du site' },
    { name: 'boosts', description: 'Afficher les boosts ELO et Coins actifs' },
    { name: 'cosmetiques', description: 'Lister les collections de cosmetiques', options: [{ type: 3, name: 'type', description: 'Collection', required: true, choices: [{ name: 'Decorations', value: 'decorations' }, { name: 'Bannieres', value: 'banners' }, { name: 'Musiques', value: 'musics' }] }] },
    { name: 'replay', description: 'Afficher le resume d une partie', options: [{ type: 4, name: 'id', description: 'ID de partie', required: true }] },
    { name: 'duel-lien', description: 'Generer un lien de duel 15 minutes', options: [{ type: 3, name: 'type', description: 'Type de duel', required: true, choices: [{ name: 'Ranked', value: 'ranked' }, { name: 'Amical', value: 'friendly' }] }] },
    { name: 'giveaway', description: 'Creer un giveaway Discord avec recompense auto si le gagnant est lie', options: [
      { type: 3, name: 'titre', description: 'Titre du giveaway', required: true },
      { type: 4, name: 'duree', description: 'Duree en minutes', required: true },
      { type: 3, name: 'recompense', description: 'coins, gems ou code item boutique', required: true },
      { type: 4, name: 'quantite', description: 'Quantite ou montant', required: false },
      { type: 4, name: 'gagnants', description: 'Nombre de gagnants', required: false },
    ] },
    { name: 'drop', description: 'Creer un drop instantane: premier clic, premier servi', options: [
      { type: 3, name: 'titre', description: 'Titre du drop', required: true },
      { type: 3, name: 'recompense', description: 'coins, gems ou code item boutique', required: true },
      { type: 4, name: 'quantite', description: 'Quantite ou montant', required: false },
    ] },
    { name: 'tournois', description: 'Lister les tournois officiels' },
    { name: 'tournoi', description: 'Afficher le detail d un tournoi', options: [{ type: 3, name: 'id', description: 'ID public ou interne', required: true }] },
    { name: 'leaderboard', description: 'Alias du classement officiel', options: [{ type: 3, name: 'type', description: 'Classement a afficher', required: false, choices: [{ name: 'Membres', value: 'humans' }, { name: 'Bots', value: 'bots' }] }] },
    { name: 'bots', description: 'Afficher les bots API et preconfigures' },
    { name: 'login', description: 'Ouvrir une session staff Discord pendant 10 minutes', options: [{ type: 3, name: 'password', description: 'Mot de passe de ton compte Puissance 4', required: true }] },
    adminCommand('coupon', 'Creer un code promotionnel boutique', [
      { type: 3, name: 'code', description: 'Code a creer, vide = aleatoire', required: false },
      { type: 3, name: 'type', description: 'Type de reduction', required: false, choices: [{ name: 'Pourcentage', value: 'discount' }, { name: 'Montant fixe', value: 'flat' }] },
      { type: 4, name: 'valeur', description: 'Pourcentage ou montant retire', required: false },
      { type: 4, name: 'utilisations', description: 'Nombre maximum d utilisations', required: false },
      { type: 4, name: 'heures', description: 'Expiration en heures, vide = pas d expiration', required: false },
    ]),
    { name: 'aide', description: 'Afficher le centre de commandes Puissance 4' },
    adminCommand('stats', 'Afficher les statistiques staff'),
    adminCommand('player', 'Afficher le profil staff d un joueur', [pseudoOption(true)]),
    adminCommand('mute', 'Mute un joueur', [pseudoOption(true), optionalValueOption('Duree en minutes, defaut 60'), reasonOption('Raison du mute')]),
    adminCommand('unmute', 'Retirer le mute d un joueur', [pseudoOption(true)]),
    adminCommand('ban', 'Bannir un joueur', [pseudoOption(true), reasonOption('Raison du ban')]),
    adminCommand('unban', 'Debannir un joueur', [pseudoOption(true)]),
    adminCommand('coins', 'Ajouter ou retirer des coins', [pseudoOption(true), valueOption('Delta coins, negatif possible'), reasonOption('Motif')]),
    adminCommand('elo', 'Ajouter ou retirer de l ELO', [pseudoOption(true), valueOption('Delta ELO, negatif possible'), reasonOption('Motif')]),
    adminCommand('boost-elo', 'Activer ou modifier le boost ELO global', [valueOption('Multiplicateur entre 1 et 10')]),
    adminCommand('boost-coins', 'Activer ou modifier le boost Coins global', [valueOption('Multiplicateur entre 1 et 10'), reasonOption('Duree en minutes, max 1440')]),
    adminCommand('give-item', 'Donner un item boutique a un joueur', [
      pseudoOption(true),
      { type: 3, name: 'item', description: 'Code item: elo_custom_0_2, coin_custom_05, vip_1m...', required: true },
      optionalValueOption('Quantite, defaut 1'),
    ]),
    adminCommand('crystal', 'Donner le rang Crystal a un joueur', [
      pseudoOption(true),
      optionalValueOption('Duree en jours, defaut 30'),
    ]),
    adminCommand('tournoi-finish', 'Terminer un tournoi', [idOption('ID public ou interne du tournoi')]),
    adminCommand('tournoi-pause', 'Mettre un tournoi en pause', [idOption('ID public ou interne du tournoi')]),
    adminCommand('tournoi-resume', 'Reprendre un tournoi pause', [idOption('ID public ou interne du tournoi')]),
    adminCommand('tournoi-delete', 'Supprimer un tournoi', [idOption('ID public ou interne du tournoi')]),
    adminCommand('backups', 'Afficher les backups disponibles'),
    adminCommand('maintenance-on', 'Activer l alerte maintenance', [reasonOption('Message affiche aux joueurs')]),
    adminCommand('maintenance-off', 'Desactiver l alerte maintenance'),
    { ...adminCommand('role-generator', 'Creer ou verifier les roles Discord de rang ELO'), default_member_permissions: '8' },
    adminCommand('reload', 'Recharger les commandes Discord'),
  ];
}

function startDiscordBot(ctx) {
  const { botToken } = ctx.discordConfig();
  if (!botToken) {
    console.log('[BOT] Token manquant - bot Discord desactive');
    return null;
  }

  const bot = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildPresences, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });
  const api = String(process.env.BASE_URL || DEFAULT_API).replace(/\/+$/, '');
  const fmt = value => Number(value || 0).toLocaleString('fr-FR');
  const truncate = (value, max = 100) => String(value == null ? '' : value).slice(0, max);
  const code = value => `\`${String(value == null ? '-' : value).replace(/`/g, '')}\``;
  const playerUrl = player => `${api}/profil?id=${player.id}`;
  const rankOf = elo => ctx.getRank(Number(elo || 0)) || { label: 'Non classe', color: '#8b9cf4' };
  const discordEmojiCache = new Map();
  const staffSessions = new Map();
  const activeGiveaways = new Map();
  const activeDrops = new Map();
  const STAFF_SESSION_TTL_MS = 10 * 60 * 1000;

  function normalizeCouponCode(value) {
    return String(value || '')
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9_-]/g, '')
      .slice(0, 24);
  }

  function makeCouponCode() {
    return `P4-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
  }

  function rowButtons(buttons) {
    const row = new ActionRowBuilder();
    row.addComponents(buttons.slice(0, 5));
    return row;
  }

  function linkButton(label, url, emoji) {
    const btn = new ButtonBuilder().setLabel(label).setStyle(ButtonStyle.Link).setURL(url);
    if (emoji) btn.setEmoji(emoji);
    return btn;
  }

  function containerMessage({ color = 0xff2d55, title, subtitle = '', sections = [], buttons = [], rows = [], files = [] }) {
    const container = new ContainerBuilder().setAccentColor(color);
    const header = [`## ${title}`, subtitle].filter(Boolean).join('\n');
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(header));
    if (sections.length) container.addSeparatorComponents(new SeparatorBuilder());
    for (const section of sections) {
      const content = Array.isArray(section) ? section.filter(Boolean).join('\n') : String(section || '');
      if (content) container.addTextDisplayComponents(new TextDisplayBuilder().setContent(content.slice(0, 4000)));
    }
    if (buttons.length || rows.length) container.addSeparatorComponents(new SeparatorBuilder());
    if (buttons.length) container.addActionRowComponents(rowButtons(buttons));
    for (const row of rows) container.addActionRowComponents(row);
    const payload = { flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral, components: [container] };
    if (files.length) payload.files = files;
    return payload;
  }

  function ephemeralMessage(payload) {
    return { ...payload, flags: Number(payload.flags || 0) | MessageFlags.Ephemeral };
  }

  function optionValue(interaction, name, fallback = null) {
    const option = interaction.options?.get(name, false);
    return option ? option.value : fallback;
  }

  function optionString(interaction, name, fallback = null) {
    const value = optionValue(interaction, name, fallback);
    return value == null ? fallback : String(value);
  }

  function optionNumber(interaction, name, fallback = null) {
    const value = optionValue(interaction, name, fallback);
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function optionInteger(interaction, name, fallback = null) {
    const value = optionNumber(interaction, name, fallback);
    return value == null ? fallback : Math.trunc(value);
  }

  async function replyError(interaction, title, subtitle = '') {
    const payload = ephemeralMessage(containerMessage({ color: 0xff3b30, title, subtitle }));
    if (interaction.deferred || interaction.replied) {
      return interaction.editReply(payload).catch(() => interaction.followUp(payload).catch(() => {}));
    }
    return interaction.reply(payload).catch(() => {});
  }

  function normalizeEmojiName(value) {
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9_]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .toLowerCase();
  }

  function findGuildEmoji(candidates = []) {
    for (const candidate of candidates) {
      const key = normalizeEmojiName(candidate);
      if (discordEmojiCache.has(key)) return discordEmojiCache.get(key);
    }
    return '';
  }

  function rankEmoji(rank) {
    const label = String(rank?.label || '');
    const base = label.split(/\s+/)[0] || label;
    const tierRaw = label.split(/\s+/)[1] || '';
    const romanToNumber = { I: '1', II: '2', III: '3', IV: '4', V: '5' };
    const tier = romanToNumber[tierRaw.toUpperCase()] || tierRaw;
    return findGuildEmoji([
      label,
      label.replace(/\s+/g, '_'),
      `${base}_${tier}`,
      `${base}${tier}`,
      base,
    ]);
  }

  function badgeEmoji(name, fallback = '') {
    const map = {
      PERSO: ['Perso', 'Badge_Perso', 'Role_Perso'],
      'VIP+': ['VIPPlus', 'VIP_Plus', 'VIP+', 'Badge_VIPPlus'],
      VIP: ['VIP', 'Badge_VIP'],
      ADMIN: ['Admin', 'Administrateur', 'Badge_Admin'],
      MODO: ['Modo', 'Moderateur', 'Badge_Modo'],
      BOT: ['Bot', 'Robot', 'Badge_Bot'],
    };
    return findGuildEmoji(map[name] || [name]) || fallback;
  }

  function resolveGiveItem(itemKey) {
    const key = String(itemKey || '').trim();
    if (!key) return null;
    if (ctx.SHOP_ITEMS?.[key]) return ctx.SHOP_ITEMS[key];
    const eloMatch = key.match(/^elo_custom_(\d+)_(\d+)$/);
    if (eloMatch) {
      const bonus = Number(`${eloMatch[1]}.${eloMatch[2]}`);
      if (!Number.isFinite(bonus) || bonus < 0.1 || bonus > 1) return null;
      return {
        key,
        label: `Booster ELO x${(1 + bonus).toFixed(2)}`,
        boostType: 'elo',
      };
    }
    const coinMatch = key.match(/^coin_custom_(\d{1,2})$/);
    if (coinMatch) {
      const multiplier = Number(coinMatch[1]);
      if (!Number.isFinite(multiplier) || multiplier < 1 || multiplier > 10) return null;
      return {
        key,
        label: `Booster Coins x${multiplier}`,
        boostType: 'coins',
      };
    }
    return null;
  }

  function normalizeRewardKey(value) {
    return String(value || '').trim().toLowerCase();
  }

  function rewardLabel(rewardKey, quantity = 1) {
    const key = normalizeRewardKey(rewardKey);
    if (key === 'coins') return `${fmt(quantity)} coins`;
    if (key === 'gems' || key === 'gemmes') return `${fmt(quantity)} gemmes`;
    const item = resolveGiveItem(key);
    return item ? `${fmt(quantity)} x ${item.label || item.key}` : `${fmt(quantity)} x ${key}`;
  }

  function grantRewardToDiscordUser(discordId, rewardKey, quantity = 1, reason = '') {
    const player = playerByDiscord(discordId);
    if (!player || Number(player.is_bot || 0) === 1) return { ok: false, reason: 'Compte non lie' };
    const key = normalizeRewardKey(rewardKey);
    const qty = Math.max(1, Math.min(999999, Math.trunc(Number(quantity || 1))));
    if (key === 'coins') {
      ctx.pQ.addCoins.run({ delta: qty, id: player.id });
      try { ctx.WH?.wlogCoins?.(player.pseudo, player.id, qty, reason); } catch {}
      return { ok: true, player, label: rewardLabel(key, qty) };
    }
    if (key === 'gems' || key === 'gemmes') {
      ctx.pQ.addGems.run({ delta: qty, id: player.id });
      try { ctx.WH?.wlogGems?.(player.pseudo, player.id, qty, reason); } catch {}
      return { ok: true, player, label: rewardLabel('gems', qty) };
    }
    const item = resolveGiveItem(key);
    if (!item) return { ok: false, reason: 'Recompense invalide' };
    ctx.shopItemQ.addQty.run({ player_id: player.id, item_key: item.key, quantity: qty });
    try { ctx.WH?.wlogAdminAction?.(reason || 'Giveaway Discord', player.pseudo, player.id, [['Item', item.label || item.key, true], ['Quantite', qty, true]]); } catch {}
    return { ok: true, player, label: rewardLabel(item.key, qty) };
  }

  async function requireDiscordAdmin(interaction) {
    const staff = await getLinkedStaffContext(interaction.user.id);
    if (staff.error) {
      await replyError(interaction, 'Acces refuse', staff.error);
      return null;
    }
    if ((STAFF_ORDER[staff.effectiveRole] || 0) < STAFF_ORDER.admin) {
      await replyError(interaction, 'Acces admin requis');
      return null;
    }
    return staff;
  }

  function roleBadges(player) {
    const badges = [];
    const push = (name, fallback) => badges.push(`${badgeEmoji(name, fallback)} **${name}**`.trim());
    if (Number(player?.is_crystal) === 1) push('CRYSTAL', '💠');
    if (Number(player?.is_perso) === 1) push('PERSO', '✨');
    if (Number(player?.is_vip_plus) === 1) push('VIP+', '💎');
    else if (Number(player?.is_vip) === 1) push('VIP', '⭐');
    if (player?.role === 'admin') push('ADMIN', '⚡');
    else if (player?.role === 'moderator') push('MODO', '🛡️');
    if (Number(player?.is_bot) === 1) push('BOT', '🤖');
    return badges.join(' / ') || 'JOUEUR';
  }

  function escapeDiscordMarkdown(value) {
    return String(value == null ? '' : value).replace(/([\\*_~`>|])/g, '\\$1');
  }

  function formatDiscordActivity(member) {
    const activities = member?.presence?.activities || [];
    if (!activities.length) return 'Aucune activite detectee.';
    const activityIcon = activity => {
      if (activity.type === ActivityType.Custom) return '💬';
      if (activity.type === ActivityType.Playing) return '🎮';
      if (activity.type === ActivityType.Streaming) return '📺';
      if (activity.type === ActivityType.Listening) return activity.name === 'Spotify' ? '<:Spotify:1508052989645033612>' : '🎧';
      if (activity.type === ActivityType.Watching) return '👀';
      if (activity.type === ActivityType.Competing) return '⚔️';
      return '✨';
    };
    const formatTime = ms => {
      const seconds = Math.max(0, Math.floor(Number(ms || 0) / 1000));
      return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
    };
    const activityEmoji = activity => {
      const emoji = activity.emoji;
      if (!emoji) return '';
      if (emoji.id) return `<${emoji.animated ? 'a' : ''}:${emoji.name}:${emoji.id}>`;
      return emoji.name || '';
    };
    const assetUrl = (activity, key) => {
      const asset = activity.assets?.[key];
      if (!asset) return '';
      if (/^https?:\/\//i.test(asset)) return asset;
      if (String(asset).startsWith('mp:')) return `https://media.discordapp.net/${String(asset).slice(3)}`;
      if (activity.applicationId) return `https://cdn.discordapp.com/app-assets/${activity.applicationId}/${asset}.png`;
      return '';
    };
    return activities.slice(0, 6).map((activity, index) => {
      const emoji = activityEmoji(activity);
      const title = activity.type === ActivityType.Custom
        ? `Statut perso ${emoji ? `${emoji} ` : ''}${escapeDiscordMarkdown(activity.state || activity.name || 'Aucun texte')}`
        : `${activityIcon(activity)} ${escapeDiscordMarkdown(activity.name || 'Activite')}`;
      const details = [];
      if (activity.details) details.push(`details: **${escapeDiscordMarkdown(activity.details)}**`);
      if (activity.state && activity.type !== ActivityType.Custom) details.push(`state: **${escapeDiscordMarkdown(activity.state)}**`);
      if (activity.assets?.largeText) details.push(`large: **${escapeDiscordMarkdown(activity.assets.largeText)}**`);
      if (activity.assets?.smallText) details.push(`small: **${escapeDiscordMarkdown(activity.assets.smallText)}**`);
      if (activity.timestamps?.start && activity.timestamps?.end) {
        const elapsed = Date.now() - activity.timestamps.start.getTime();
        const total = activity.timestamps.end.getTime() - activity.timestamps.start.getTime();
        details.push(`temps: **${formatTime(elapsed)} / ${formatTime(total)}**`);
      } else if (activity.timestamps?.start) {
        details.push(`depuis: <t:${Math.floor(activity.timestamps.start.getTime() / 1000)}:R>`);
      }
      if (activity.url) details.push(`[ouvrir](${activity.url})`);
      else if (activity.syncId && activity.name === 'Spotify') details.push(`[Spotify](https://open.spotify.com/track/${activity.syncId})`);
      const largeUrl = assetUrl(activity, 'largeImage');
      const smallUrl = assetUrl(activity, 'smallImage');
      if (largeUrl) details.push(`[image](${largeUrl})`);
      if (smallUrl) details.push(`[mini](${smallUrl})`);
      return `**${index + 1}.** ${title}${details.length ? `\n${details.map(line => `   ・${line}`).join('\n')}` : ''}`;
    }).join('\n');
  }

  function formatDiscordTimestamp(value, style = 'F') {
    const ms = Number(value || 0);
    if (!Number.isFinite(ms) || ms <= 0) return 'Inconnu';
    return `<t:${Math.floor(ms / 1000)}:${style}>`;
  }

  function formatAgeDays(value) {
    const ms = Number(value || 0);
    if (!Number.isFinite(ms) || ms <= 0) return 'anciennete inconnue';
    const days = Math.max(0, Math.floor((Date.now() - ms) / 86400000));
    if (days >= 365) return `${Math.floor(days / 365)} an(s), ${days % 365} jour(s)`;
    return `${days} jour(s)`;
  }

  function parseJsonObject(value) {
    if (!value) return {};
    if (typeof value === 'object') return value;
    try {
      const parsed = JSON.parse(String(value));
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }

  function compactList(values, empty = 'Aucun') {
    const list = values.filter(Boolean);
    return list.length ? list.join(' | ') : empty;
  }

  async function userInfoPayload(interaction) {
    if (!interaction.guild) {
      return containerMessage({ color: 0xff3b30, title: 'Serveur requis', subtitle: 'La commande /ui doit etre utilisee dans un serveur Discord.' });
    }
    const user = interaction.options.getUser('utilisateur', false) || interaction.user;
    const member = await interaction.guild.members.fetch({ user: user.id, force: true }).catch(() => null);
    if (!member) {
      return containerMessage({ color: 0xff3b30, title: 'Membre introuvable', subtitle: 'Impossible de retrouver ce membre sur le serveur.' });
    }
    const fullUser = await user.fetch(true).catch(() => user);
    const avatar = fullUser.displayAvatarURL({ size: 1024 });
    const banner = typeof fullUser.bannerURL === 'function' ? fullUser.bannerURL({ size: 1024 }) : null;
    const decoration = typeof fullUser.avatarDecorationURL === 'function' ? fullUser.avatarDecorationURL() : null;
    const linked = playerByDiscord(user.id);
    const statusMap = {
      online: '🟢 En ligne',
      idle: '🌙 Inactif',
      dnd: '⛔ Ne pas deranger',
      offline: '⚫ Hors ligne / Invisible',
      invisible: '⚫ Hors ligne / Invisible',
    };
    const clientStatus = member.presence?.clientStatus || {};
    const clientText = compactList([
      clientStatus.desktop ? 'Desktop' : '',
      clientStatus.mobile ? 'Mobile' : '',
      clientStatus.web ? 'Web' : '',
    ]);
    const roles = member.roles.cache
      .filter(role => role.id !== interaction.guild.id)
      .sort((a, b) => b.position - a.position)
      .map(role => role.toString());
    const highestRole = member.roles.highest && member.roles.highest.id !== interaction.guild.id ? member.roles.highest.toString() : 'Aucun';
    const rolesText = roles.length
      ? roles.length > 8 ? `${roles.slice(0, 8).join(', ')} et **${roles.length - 8}** autre(s)` : roles.join(', ')
      : 'Aucun role';
    const boostText = member.premiumSinceTimestamp ? `Oui, depuis <t:${Math.floor(member.premiumSinceTimestamp / 1000)}:F>` : 'Non';
    const ownerText = interaction.guild.ownerId === member.id ? 'Oui' : 'Non';
    const timeoutText = member.communicationDisabledUntilTimestamp && member.communicationDisabledUntilTimestamp > Date.now()
      ? `Oui, jusqu'a ${formatDiscordTimestamp(member.communicationDisabledUntilTimestamp)}`
      : 'Non';
    const permissionLabels = {
      Administrator: 'ADMINISTRATOR',
      ManageGuild: 'MANAGE_GUILD',
      ManageRoles: 'MANAGE_ROLES',
      ManageChannels: 'MANAGE_CHANNELS',
      BanMembers: 'BAN_MEMBERS',
      KickMembers: 'KICK_MEMBERS',
      ManageMessages: 'MANAGE_MESSAGES',
      ManageWebhooks: 'MANAGE_WEBHOOKS',
    };
    const strongPerms = Object.keys(permissionLabels).filter(perm => member.permissions?.has?.(perm)).map(perm => `\`${permissionLabels[perm]}\``);
    const rank = linked ? rankOf(linked.elo) : null;
    const linkedTotal = linked ? totalGames(linked) : 0;
    const linkedLastSeen = linked?.last_seen ? formatDiscordTimestamp(Number(linked.last_seen), 'R') : 'Inconnu';
    const crystalText = linked && Number(linked.is_crystal || 0) === 1
      ? `Actif${linked.crystal_expires_at ? ` jusqu'a ${formatDiscordTimestamp(Number(linked.crystal_expires_at))}` : ''}`
      : 'Non';
    const sections = [
      [
        '### 👤 Identite Discord',
        `🔖・Mention: ${user}`,
        `👤・Nom affiche: **${escapeDiscordMarkdown(fullUser.displayName || fullUser.username)}**`,
        `🏷️・Username: **${escapeDiscordMarkdown(fullUser.username)}**${fullUser.globalName ? ` | Global: **${escapeDiscordMarkdown(fullUser.globalName)}**` : ''}`,
        `🆔・ID Discord: ${code(fullUser.id)}`,
        `📅・Compte cree: ${formatDiscordTimestamp(fullUser.createdTimestamp)} (${formatAgeDays(fullUser.createdTimestamp)})`,
        `🤖・Bot: **${fullUser.bot ? 'Oui' : 'Non'}** | System: **${fullUser.system ? 'Oui' : 'Non'}**`,
      ],
      [
        '### 🏠 Serveur',
        `🪪・Pseudo serveur: **${escapeDiscordMarkdown(member.displayName || fullUser.displayName || fullUser.username)}**`,
        `📥・Arrivee: ${formatDiscordTimestamp(member.joinedTimestamp)} (${formatAgeDays(member.joinedTimestamp)})`,
        `👑・Owner: **${ownerText}**`,
        `🚀・Boost serveur: **${boostText}**`,
        `🔇・Timeout: **${timeoutText}**`,
        `🎚️・Role le plus haut: ${highestRole}`,
        `🎭・Roles (${roles.length}): ${rolesText}`,
        `🧱・Permissions fortes: ${strongPerms.length ? strongPerms.join(' ') : '`NONE`'}`,
      ],
      [
        '### 🟢 Activite',
        `📡・Statut: **${statusMap[member.presence?.status || 'offline'] || statusMap.offline}**`,
        `💻・Client: **${clientText}** | Activites: **${member.presence?.activities?.length || 0}**`,
        `🎧・${formatDiscordActivity(member)}`,
      ],
      [
        '### 🎮 Puissance 4',
        linked
          ? [
              `🔗・Compte lie: **${escapeDiscordMarkdown(linked.pseudo)}** | ID joueur: ${code(linked.id)}`,
              `🏆・Rang: **${rankEmoji(rank)} ${escapeDiscordMarkdown(rank.label || 'Non classe')}** | ELO: **${fmt(linked.elo)}**`,
              `✨・Roles site: ${roleBadges(linked)} | Crystal: **${crystalText}**`,
              `📊・Stats: **${fmt(linked.wins)}V / ${fmt(linked.losses)}D / ${fmt(linked.draws)}N** | WR: **${winRate(linked)}** | Parties: **${fmt(linkedTotal)}**`,
              `💰・Economie: **${fmt(linked.coins)} coins** | **${fmt(linked.gems)} gemmes**`,
              `🟢・Derniere presence site: **${linkedLastSeen}**`,
              `🌐・Lien utile: ${api}/profil?id=${linked.id}`,
            ].join('\n')
          : `🔗・Compte lie: **Non**\n🌐・Lien utile: ${api}/profil\n🆔・ID Discord: ${code(user.id)}`,
      ],
      [
        '### 🎨 Medias',
        `🖼️・Avatar Discord: **${avatar ? 'Disponible' : 'Non'}**`,
        `🌌・Banniere Discord: **${banner ? 'Disponible' : 'Aucune'}**`,
        `✨・Decoration avatar: **${decoration ? 'Disponible' : 'Aucune'}**`,
      ],
    ];
    const buttons = [linkButton('Avatar', avatar, '👤')];
    if (banner) buttons.push(linkButton('Banniere', banner, '🖼️'));
    if (decoration) buttons.push(linkButton('Decoration', decoration, '✨'));
    if (linked) buttons.push(linkButton('Profil P4', playerUrl(linked), '🎮'));
    buttons.push(linkButton('Serveur', api, '🔗'));
    return containerMessage({
      color: Number.parseInt(String(member.displayHexColor || '#85ebff').replace('#', ''), 16) || 0x85ebff,
      title: `📌 UI Discord - ${escapeDiscordMarkdown(fullUser.displayName || fullUser.username)}`,
      subtitle: 'Fiche complete: Discord, serveur, activite, medias et liaison Puissance 4.',
      sections,
      buttons,
    });
  }

  function totalGames(player) {
    return Number(player?.wins || 0) + Number(player?.losses || 0) + Number(player?.draws || 0);
  }

  function winRate(player) {
    const total = totalGames(player);
    return total ? `${Math.round((Number(player?.wins || 0) / total) * 100)}%` : '--';
  }

  function playerByPseudo(pseudo) {
    const q = String(pseudo || '').trim();
    if (!q) return null;
    return ctx.db.prepare(`SELECT * FROM players WHERE pseudo=? COLLATE NOCASE AND deleted=0`).get(q);
  }

  function playerByDiscord(discordId) {
    const id = String(discordId || '').trim();
    if (!id) return null;
    return ctx.db.prepare(`SELECT * FROM players WHERE discord_id=? AND deleted=0`).get(id);
  }

  
  const DISCORD_GEM_CHAR_THRESHOLD = 10_000;
  const DISCORD_GEM_REWARD = 10;

  function awardDiscordActivityGems(message) {
    if (!message?.guildId || message.author?.bot) return;
    const discordId = String(message.author?.id || '');
    const player = playerByDiscord(discordId);
    if (!player || Number(player.is_bot || 0) === 1) return;
    const charCount = Array.from(String(message.content || '')).length;
    if (charCount <= 0) return;
    const now = Date.now();
    const row = ctx.db.prepare(`SELECT * FROM discord_activity WHERE discord_id = ?`).get(discordId);
    const rawProgress = Number(row?.character_progress || 0) + charCount;
    const rewardSteps = Math.floor(rawProgress / DISCORD_GEM_CHAR_THRESHOLD);
    const gainedGems = rewardSteps * DISCORD_GEM_REWARD;
    const nextProgress = rawProgress % DISCORD_GEM_CHAR_THRESHOLD;
    const nextTotal = Number(row?.character_count || 0) + charCount;
    ctx.db.prepare(`
      INSERT INTO discord_activity (discord_id, player_id, xp, level, character_count, character_progress, messages, last_reward_at, updated_at)
      VALUES (?, ?, 0, 0, ?, ?, 1, ?, ?)
      ON CONFLICT(discord_id) DO UPDATE SET
        player_id=excluded.player_id,
        character_count=excluded.character_count,
        character_progress=excluded.character_progress,
        messages=discord_activity.messages + 1,
        last_reward_at=excluded.last_reward_at,
        updated_at=excluded.updated_at
    `).run(discordId, player.id, nextTotal, nextProgress, gainedGems > 0 ? now : Number(row?.last_reward_at || 0), now);
    if (gainedGems > 0 && Number(player.is_bot || 0) !== 1) {
      ctx.pQ.addGems.run({ delta: gainedGems, id: player.id });
      try {
        ctx.WH?.wlogGems?.(player.pseudo, player.id, gainedGems, `Activite Discord (${DISCORD_GEM_CHAR_THRESHOLD} caracteres)`);
      } catch {}
    }
  }

  function purgeStaffSessions() {
    const now = Date.now();
    for (const [discordId, session] of staffSessions.entries()) {
      if (Number(session.expiresAt || 0) <= now) staffSessions.delete(discordId);
    }
  }

  function localPasswordMatches(player, password) {
    if (!player?.password) return false;
    const expected = String(player.password);
    const hashed = typeof ctx.hashPwd === 'function' ? ctx.hashPwd(String(password || '')) : String(password || '');
    return expected === hashed || expected === String(password || '');
  }

  function staffPasswordMatches(player, password) {
    const raw = String(password || '');
    if (!raw) return false;
    if (localPasswordMatches(player, raw)) return true;
    // Compat: les admins utilisaient deja le mot de passe global avec /admin.
    return player?.role === 'admin' && raw === String(ctx.ADMIN_PASSWORD || '');
  }

  async function getLinkedStaffContext(discordId) {
    const player = playerByDiscord(discordId);
    if (!player) return { error: 'Compte Puissance 4 non lie a Discord.' };
    const siteRole = String(player.role || 'user');
    if ((STAFF_ORDER[siteRole] || 0) < STAFF_ORDER.moderator) {
      return { error: 'Ton compte Puissance 4 n a pas de role staff.' };
    }
    const discordRole = await ctx.getDiscordRole(discordId, botToken).catch(() => 'user');
    if ((STAFF_ORDER[discordRole] || 0) < STAFF_ORDER.moderator) {
      return { error: 'Role Discord insuffisant ou non synchronise.' };
    }
    const effectiveRank = Math.min(STAFF_ORDER[siteRole] || 0, STAFF_ORDER[discordRole] || 0);
    const effectiveRole = effectiveRank >= STAFF_ORDER.admin ? 'admin' : 'moderator';
    return { player, siteRole, discordRole, effectiveRole };
  }

  function playerAccuracy(playerId) {
    const row = ctx.db.prepare(`
      SELECT AVG(accuracy) AS accuracy
      FROM (
        SELECT accuracy FROM (
          SELECT games.p1_accuracy AS accuracy
          FROM games
          WHERE games.status='finished' AND games.player1_id=? AND games.p1_accuracy IS NOT NULL
          ORDER BY games.id DESC
          LIMIT 200
        )
        UNION ALL
        SELECT accuracy FROM (
          SELECT games.p2_accuracy AS accuracy
          FROM games
          WHERE games.status='finished' AND games.player2_id=? AND games.p2_accuracy IS NOT NULL
          ORDER BY games.id DESC
          LIMIT 200
        )
      )
    `).get(playerId, playerId);
    return row?.accuracy != null ? `${Math.round(Number(row.accuracy))}%` : '--';
  }

  function latestGames(playerId) {
    return ctx.db.prepare(`
      WITH recent AS (
        SELECT games.id AS game_id FROM games WHERE games.status='finished' AND games.player1_id=?
        UNION
        SELECT games.id AS game_id FROM games WHERE games.status='finished' AND games.player2_id=?
        ORDER BY game_id DESC
        LIMIT 25
      )
      SELECT games.id AS id,
             games.player1_id AS player1_id,
             games.player2_id AS player2_id,
             games.winner_id AS winner_id,
             games.move_count AS move_count,
             games.duration AS duration,
             games.elo_p1 AS elo_p1,
             games.elo_p2 AS elo_p2,
             p1.pseudo AS p1_pseudo,
             p2.pseudo AS p2_pseudo,
             games.finished_at AS finished_at
      FROM recent
      JOIN games ON games.id = recent.game_id
      JOIN players p1 ON p1.id = games.player1_id
      JOIN players p2 ON p2.id = games.player2_id
      ORDER BY games.id DESC
      LIMIT 25
    `).all(playerId, playerId);
  }

  function profileRows(player, games) {
    if (!games.length) {
      const empty = new StringSelectMenuBuilder()
        .setCustomId(`p4_profile_games:${player.id}`)
        .setPlaceholder('Aucune partie recente')
        .setDisabled(true)
        .addOptions(new StringSelectMenuOptionBuilder().setLabel('Aucune partie').setDescription('Ce joueur n a pas encore de partie.').setValue('none'));
      return [new ActionRowBuilder().addComponents(empty)];
    }
    const menu = new StringSelectMenuBuilder()
      .setCustomId(`p4_profile_games:${player.id}`)
      .setPlaceholder('Voir une partie recente')
      .addOptions(games.slice(0, 25).map(game => {
        const isP1 = Number(game.player1_id) === Number(player.id);
        const opponent = isP1 ? game.p2_pseudo : game.p1_pseudo;
        const delta = isP1 ? Number(game.elo_p1 || 0) : Number(game.elo_p2 || 0);
        const result = game.winner_id == null ? 'NUL' : Number(game.winner_id) === Number(player.id) ? 'WIN' : 'LOSE';
        const emojiMap = {
          WIN: { id: '1507869143985295440', name: 'victoire' },
          LOSE: { id: '1507869174419161250', name: 'defaite' },
          NUL: { id: '1507869216127193228', name: 'nulle' }
        };
        return new StringSelectMenuOptionBuilder()
          .setLabel(`${result} vs ${opponent} / ${delta >= 0 ? '+' : ''}${delta} ELO`.slice(0, 100))
          .setDescription(`#${game.id} / ${game.move_count || 0} coups / ${game.duration || 0}s`.slice(0, 100))
          .setValue(`game:${game.id}`)
          .setEmoji(emojiMap[result]);
      }));
    return [new ActionRowBuilder().addComponents(menu)];
  }

  function profilePayload(player) {
    const rank = rankOf(player.elo);
    const rankIcon = rankEmoji(rank);
    const games = latestGames(player.id);
    const follows = ctx.db.prepare(
      'SELECT (SELECT COUNT(*) FROM follows WHERE follower_id=?) AS following, (SELECT COUNT(*) FROM follows WHERE following_id=?) AS followers'
    ).get(player.id, player.id);
    const last = games[0];
    const lastLine = last
      ? `Derniere partie: ${code(`#${last.id}`)} / ${last.move_count || 0} coups / ${last.duration || 0}s`
      : 'Derniere partie: aucune partie recente';
    return containerMessage({
      color: parseInt(String(player.color || '#ff2d55').replace('#', ''), 16) || 0xff2d55,
      title: `${rankIcon ? `${rankIcon} ` : ''}${player.pseudo} - ${fmt(player.elo)} ELO`,
      subtitle: `Rang: ${rankIcon ? `${rankIcon} ` : ''}**${rank.label}** | Badges: ${roleBadges(player)} | Coins: **${fmt(player.coins || 0)}**`,
      sections: [
        `### Statistiques\nVictoires: **${player.wins || 0}** | Defaites: **${player.losses || 0}** | Nuls: **${player.draws || 0}**\nParties: **${totalGames(player)}** | Winrate: **${winRate(player)}** | Precision: **${playerAccuracy(player.id)}**`,
        `### Social et profil\nSuivis: **${follows?.following || 0}** | Abonnes: **${follows?.followers || 0}**\n${lastLine}`,
      ],
      buttons: [
        linkButton('Voir profil', playerUrl(player), '👤'),
        linkButton('Boutique', `${api}/boutique`, '🛒'),
        linkButton('Live', `${api}/live`, '🔴'),
      ],
      rows: profileRows(player, games),
    });
  }

  function statsPayload() {
    const registeredHumans = Number(ctx.db.prepare(`SELECT COUNT(*) AS c FROM players WHERE deleted=0 AND is_guest=0 AND is_bot=0 AND id != ?`).get(ctx.BOT_PLAYER_ID)?.c || 0);
    const registeredBots = Number(ctx.db.prepare(`SELECT COUNT(*) AS c FROM players WHERE deleted=0 AND is_guest=0 AND is_bot=1`).get()?.c || 0);
    const games = Number(ctx.db.prepare(`SELECT COUNT(*) AS c FROM games WHERE status='finished'`).get()?.c || 0);
    const activeGames = Number(ctx.db.prepare(`SELECT COUNT(*) AS c FROM games WHERE status='active'`).get()?.c || 0);
    const coins = Number(ctx.db.prepare(`SELECT COALESCE(SUM(coins),0) AS c FROM players WHERE deleted=0`).get()?.c || 0);
    const presence = ctx.getPresenceCounts();
    return containerMessage({
      color: 0x85ebff,
      title: 'Centre statistiques Puissance 4',
      subtitle: `${presence.totalPresent || 0} presents maintenant | ${activeGames} parties live`,
      sections: [
        `### Population\nJoueurs inscrits: **${fmt(registeredHumans)}**\nBots inscrits: **${fmt(registeredBots)}**\nVisiteurs: **${fmt(presence.visitors || 0)}**`,
        `### Activite\nParties terminees: **${fmt(games)}**\nParties en cours: **${fmt(activeGames)}**\nCoins en circulation: **${fmt(coins)}**`,
      ],
      buttons: [linkButton('Ouvrir stats', `${api}/stats`, '📈'), linkButton('Classement', `${api}/leaderboard`, '🏆')],
    });
  }

  function systemPayload() {
    const presence = ctx.getPresenceCounts();
    const activeGames = Number(ctx.db.prepare(`SELECT COUNT(*) AS c FROM games WHERE status='active'`).get()?.c || 0);
    const queueCount = Number(ctx.mm?.queue?.length || ctx.mm?.q?.length || 0);
    const status = typeof ctx.readSystemStatus === 'function' ? ctx.readSystemStatus() : null;
    return containerMessage({
      color: status?.restarting ? 0xff9f0a : 0x30d158,
      title: status?.restarting ? 'Maintenance signalee' : 'Systeme operationnel',
      subtitle: status?.message || 'Aucune alerte serveur active.',
      sections: [
        `### Temps reel\nPresents: **${presence.totalPresent || 0}** | Visiteurs: **${presence.visitors || 0}**\nFile: **${queueCount}** | Parties actives: **${activeGames}**`,
        '### Securite\nLes webhooks Discord ne publient aucune IP ni donnee reseau privee.',
      ],
      buttons: [linkButton('Stats', `${api}/stats`, '📈'), linkButton('Live', `${api}/live`, '🔴')],
    });
  }

  function boostsPayload() {
    const eloBoost = ctx.bQ.getActive.get(Date.now());
    const coinMultiplier = Number(ctx.db.prepare(`SELECT value FROM config WHERE key='coin_boost_multiplier'`).get()?.value || 1);
    const coinExpiresAt = Number(ctx.db.prepare(`SELECT value FROM config WHERE key='coin_boost_expires_at'`).get()?.value || 0);
    const coinBy = ctx.getBoostDisplayName(ctx.db.prepare(`SELECT value FROM config WHERE key='coin_boost_applied_by'`).get()?.value || '');
    const coinActive = coinMultiplier > 1 && coinExpiresAt > Date.now();
    const vipBoosts = Number(ctx.db.prepare(`SELECT COUNT(*) AS c FROM vip_boosts WHERE expires_at > ?`).get(Date.now())?.c || 0);
    return containerMessage({
      color: 0xffd60a,
      title: 'Boosts actifs',
      subtitle: 'ELO, Coins et boosts VIP',
      sections: [
        `### Boost ELO global\n${eloBoost ? `x${eloBoost.multiplier} par **${ctx.getBoostDisplayName(eloBoost.applied_by)}**` : 'Aucun boost actif'}`,
        `### Boost Coins global\n${coinActive ? `x${coinMultiplier} par **${coinBy}** / expire dans ${Math.ceil((coinExpiresAt - Date.now()) / 60000)} min` : 'Aucun boost actif'}`,
        `### VIP\nBoosts VIP actifs: **${vipBoosts}**`,
      ],
      buttons: [linkButton('Boutique boosts', `${api}/boutique`, '⚡')],
    });
  }

  function livePayload() {
    const active = [...(ctx.gm.games || new Map()).values()].filter(game => game.status === 'active');
    const lines = active.slice(0, 10).map(game => {
      const p1 = game.players?.[1];
      const p2 = game.players?.[2];
      if (!p1 || !p2) return null;
      const current = game.current === 1 ? p1.pseudo : p2.pseudo;
      return `${code(`#${game.id || '?'}`)} **${p1.pseudo}** vs **${p2.pseudo}** | tour: **${current}** | coups: **${game.moveCount || game.moves?.length || 0}**`;
    }).filter(Boolean);
    return containerMessage({
      color: 0xff2d55,
      title: `${active.length} partie${active.length > 1 ? 's' : ''} en direct`,
      subtitle: active.length ? 'Spectateur live disponible.' : 'Aucune partie active pour le moment.',
      sections: [lines.join('\n') || 'Le live est calme. La prochaine partie apparaitra ici.'],
      buttons: [linkButton('Voir le live', `${api}/live`, '🔴')],
    });
  }

  function leaderboardPayload(type = 'humans') {
    const bots = type === 'bots';
    const rows = ctx.db.prepare(`
      SELECT * FROM players
      WHERE deleted=0 AND is_guest=0 AND is_bot=?
      ORDER BY elo DESC, wins DESC
      LIMIT 10
    `).all(bots ? 1 : 0);
    const medals = ['🥇', '🥈', '🥉'];
    const lines = rows.map((p, i) => {
      const rank = rankOf(p.elo);
      return `${medals[i] || `#${i + 1}`} **${p.pseudo}** - ${fmt(p.elo)} ELO - ${rank.label} - ${p.wins || 0}V/${p.losses || 0}D`;
    });
    return containerMessage({
      color: bots ? 0x85ebff : 0xffd60a,
      title: bots ? 'Classement des bots' : 'Classement des membres',
      subtitle: 'Top 10 officiel',
      sections: [lines.join('\n') || 'Aucun joueur classe.'],
      buttons: [linkButton('Page classement', `${api}/leaderboard`, '🏆')],
    });
  }

  function hexToRgb(hex) {
    const normalized = String(hex || '').trim().replace('#', '');
    if (!/^[0-9a-f]{6}$/i.test(normalized)) return null;
    return [
      parseInt(normalized.slice(0, 2), 16),
      parseInt(normalized.slice(2, 4), 16),
      parseInt(normalized.slice(4, 6), 16),
    ];
  }

  function tokenEmojiFromColor(color, fallback) {
    const rgb = hexToRgb(color);
    if (!rgb) return fallback;
    const palette = [
      { emoji: '🔴', rgb: [255, 45, 85] },
      { emoji: '🟠', rgb: [255, 159, 10] },
      { emoji: '🟡', rgb: [255, 214, 10] },
      { emoji: '🟢', rgb: [48, 209, 88] },
      { emoji: '🔵', rgb: [47, 128, 255] },
      { emoji: '🟣', rgb: [191, 90, 242] },
      { emoji: '⚪', rgb: [235, 245, 255] },
      { emoji: '⚫', rgb: [35, 35, 45] },
    ];
    let best = palette[0];
    let bestDistance = Infinity;
    for (const item of palette) {
      const distance = Math.hypot(rgb[0] - item.rgb[0], rgb[1] - item.rgb[1], rgb[2] - item.rgb[2]);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = item;
      }
    }
    return best.emoji || fallback;
  }

  function boardFromMoves(game, moves) {
    const board = Array.from({ length: 6 }, () => Array(7).fill(0));
    for (const [index, move] of moves.entries()) {
      const col = Number(move.col);
      if (!Number.isInteger(col) || col < 0 || col > 6) continue;
      let row = Number(move.row);
      const playerId = Number(move.player_id);
      const side = playerId === Number(game.player1_id) ? 1 : playerId === Number(game.player2_id) ? 2 : (index % 2) + 1;
      if (!Number.isInteger(row) || row < 0 || row > 5 || board[row][col] !== 0) {
        row = -1;
        for (let r = 5; r >= 0; r--) {
          if (board[r][col] === 0) {
            row = r;
            break;
          }
        }
      }
      if (row >= 0 && board[row][col] === 0) board[row][col] = side;
    }
    return board;
  }

  function replayGridSection(game) {
    const moves = ctx.mQ.getByGame.all(Number(game.id));
    const p1Emoji = tokenEmojiFromColor(game.p1_color, '🔴');
    const p2Emoji = tokenEmojiFromColor(game.p2_color, '🟡');
    const emptyEmoji = '⚫';
    const board = boardFromMoves(game, moves);
    const grid = board
      .map(row => row.map(cell => (cell === 1 ? p1Emoji : cell === 2 ? p2Emoji : emptyEmoji)).join(''))
      .join('\n');
    return [
      '### Plateau final',
      `${p1Emoji} **${game.p1_pseudo}**  vs  ${p2Emoji} **${game.p2_pseudo}**`,
      grid,
      '1️⃣2️⃣3️⃣4️⃣5️⃣6️⃣7️⃣',
    ].join('\n');
  }

  function replayPayload(id) {
    const game = ctx.gQ.getById.get(Number(id));
    if (!game) return null;
    const winner = game.winner_id == null ? 'Partie nulle' : `Victoire ${game.winner_id === game.player1_id ? game.p1_pseudo : game.p2_pseudo}`;
    return containerMessage({
      color: game.winner_id == null ? 0xffd60a : 0x30d158,
      title: `Replay #${game.id}`,
      subtitle: winner,
      sections: [
        `### Match\n**${game.p1_pseudo}** (${game.p1_elo || 0}) vs **${game.p2_pseudo}** (${game.p2_elo || 0})`,
        replayGridSection(game),
        `### Details\nCoups: **${game.move_count || 0}** | Duree: **${game.duration || 0}s**\nELO: **${game.elo_p1 >= 0 ? '+' : ''}${game.elo_p1 || 0}** / **${game.elo_p2 >= 0 ? '+' : ''}${game.elo_p2 || 0}**`,
      ],
      buttons: [
        linkButton('Voir replay', `${api}/replay/${game.id}`, '🎬'),
        linkButton('Profil J1', playerUrl({ id: game.player1_id }), '👤'),
        linkButton('Profil J2', playerUrl({ id: game.player2_id }), '👤'),
      ],
    });
  }

  function shopPayload() {
    return containerMessage({
      color: 0xff9f0a,
      title: 'Boutique Puissance 4',
      subtitle: 'Rangs, boosters, cosmetiques et reset ELO avec les coins.',
      sections: [
        '### Rangs\nVIP 1 mois, VIP 1 an, VIP+, Perso.',
        '### Boosters\nBoost ELO personnalise, boost coins, packs limites et reset ELO.',
        '### Cosmetiques\nAvatar GIF, bannieres, decorations, musiques de queue et emojis selon le role.',
      ],
      buttons: [linkButton('Ouvrir boutique', `${api}/boutique`, '🛒')],
    });
  }

  function apiPayload() {
    return containerMessage({
      color: 0x85ebff,
      title: 'API officielle',
      subtitle: 'HTTP, Bot API, duels, boutique, stats et Socket.IO.',
      sections: [
        '### Bot API\nCreation de bots, token affiche une seule fois, ping, file, game state et coups.',
        '### Site API\nProfils, classements, boutique, tournois, live, stats et endpoints admin.',
      ],
      buttons: [linkButton('Documentation API', `${api}/api-doc`, '🧪'), linkButton('Client bot JS', `${api}/downloads/p4-bot-client.js`, '🤖')],
    });
  }

  function tournamentsPayload() {
    const rows = ctx.tQ.listAll.all().slice(0, 8);
    const lines = rows.map(t => {
      const status = String(t.status || '').toUpperCase();
      const starts = Number(t.starts_at || 0) > Date.now() ? `debut <t:${Math.floor(Number(t.starts_at) / 1000)}:R>` : status;
      return `${code(t.public_id || t.id)} **${t.name}** | ${starts} | ${t.duration_minutes || 60}m | ${t.move_time_seconds || 30}s/coup`;
    });
    return containerMessage({
      color: 0x30d158,
      title: 'Tournois officiels',
      subtitle: 'Publics automatiques et tournois Perso.',
      sections: [lines.join('\n') || 'Aucun tournoi programme.'],
      buttons: [linkButton('Page tournois', `${api}/tournoi`, '🏟️')],
    });
  }

  function tournamentPayload(ref) {
    const tournament = ctx.findTournamentByRef(String(ref || ''));
    if (!tournament) return null;
    const standings = ctx.tQ.standings.all(tournament.id).slice(0, 5);
    const lines = standings.map((entry, index) => `${index + 1}. **${entry.pseudo}** - ${entry.score || 0} pts (${entry.wins || 0}V)`);
    return containerMessage({
      color: 0x30d158,
      title: tournament.name,
      subtitle: `${code(tournament.public_id || tournament.id)} | ${String(tournament.status || '').toUpperCase()}`,
      sections: [
        `### Configuration\nDuree: **${tournament.duration_minutes || 60}m** | Par coup: **${tournament.move_time_seconds || 30}s**\nRewards: **${tournament.reward_1 || 0} / ${tournament.reward_2 || 0} / ${tournament.reward_3 || 0} coins**`,
        `### Classement\n${lines.join('\n') || 'Aucun participant classe.'}`,
      ],
      buttons: [linkButton('Ouvrir tournoi', `${api}/tournoi/${tournament.public_id || tournament.id}`, '🏟️')],
    });
  }

  function cosmeticsPayload(type) {
    const meta = {
      decorations: ['Decorations avatar', 'Collection dans /decorations, reservee VIP+ ou Perso selon droits.'],
      banners: ['Bannieres pseudo', 'Collection dans /banner, visible dans les recherches et previews.'],
      musics: ['Musiques de queue', 'Collection dans /sounds, selectionnable par les Perso.'],
    }[type] || ['Cosmetiques', 'Collection inconnue.'];
    return containerMessage({
      color: 0xbf5af2,
      title: meta[0],
      subtitle: meta[1],
      sections: ['Les fichiers sont detectes automatiquement par le site quand ils sont ajoutes dans le bon dossier.'],
      buttons: [linkButton('Modifier profil', `${api}/profil`, '🎨')],
    });
  }

  function botsPayload() {
    const rows = ctx.db.prepare(`SELECT * FROM players WHERE deleted=0 AND is_guest=0 AND is_bot=1 ORDER BY elo DESC LIMIT 10`).all();
    const lines = rows.map((botPlayer, i) => {
      const runtime = Number(botPlayer.bot_last_seen || 0) > Date.now() - 45000 ? 'online' : 'offline';
      return `${i + 1}. **${botPlayer.pseudo}** - ${fmt(botPlayer.elo)} ELO - ${runtime}`;
    });
    return containerMessage({
      color: 0x85ebff,
      title: 'Bots Puissance 4',
      subtitle: 'Bots API et robots preconfigures.',
      sections: [lines.join('\n') || 'Aucun bot inscrit.'],
      buttons: [linkButton('Annuaire bots', `${api}/players?type=bots`, '🤖'), linkButton('API bots', `${api}/api-doc#bot-api`, '🧪')],
    });
  }

  function helpPayload() {
    const adminNames = Object.keys(ADMIN_COMMAND_ACTIONS).map(name => `/${name}`).join(', ');
    return containerMessage({
      color: 0x8b9cf4,
      title: 'Centre de commandes',
      subtitle: 'Puissance 4 Ranked sur Discord',
      sections: [
        '### Joueurs\n`/profil`, `/moi`, `/ui`, `/classement`, `/stats`, `/live`, `/replay`, `/duel-lien`',
        '### Systeme\n`/boutique`, `/boosts`, `/tournois`, `/tournoi`, `/cosmetiques`, `/api`, `/bots`',
        `### Staff\n\`/login\`, puis commandes dediees: ${adminNames}\nEvents: \`/giveaway\`, \`/drop\`. Coupon: \`/admin-coupon\`. Session 10 min + verification du role Discord.`,
      ],
      buttons: [linkButton('Ouvrir le site', api, '🎮'), linkButton('Doc API', `${api}/api-doc`, '🧪')],
    });
  }

  async function registerCommands() {
    const rest = new REST({ version: '10' }).setToken(botToken);
    const route = Routes.applicationCommands(bot.user.id);
    await rest.put(route, { body: buildDiscordCommandDefinitions(ctx.SHOP_ITEMS) });
  }

  function rankRoleColor(rankName) {
    const base = String(rankName || '').split(/\s+/)[0];
    const rank = RANKS.find(r => r.name === base);
    return rank ? Number.parseInt(rank.color.replace('#', ''), 16) : 0x8b9cf4;
  }

  async function generateRankRoles(interaction) {
    if (!ctx.DISCORD_GUILD) {
      return interaction.editReply(containerMessage({
        color: 0xff3b30,
        title: 'Serveur Discord manquant',
        subtitle: 'DISCORD_GUILD_ID doit etre configure pour creer les roles.',
      }));
    }

    const guild = await bot.guilds.fetch(ctx.DISCORD_GUILD);
    const roles = await guild.roles.fetch();
    const expected = getAllRankRoleNames();
    const byName = new Map();
    const byId = new Map();
    roles.forEach(role => byName.set(role.name, role));
    roles.forEach(role => byId.set(role.id, role));

    const found = [];
    const created = [];
    const failed = [];

    for (const name of expected) {
      if (byName.has(name)) {
        found.push(name);
        continue;
      }
      try {
        const role = await guild.roles.create({
          name,
          color: rankRoleColor(name),
          reason: `Puissance 4 rank role generator (${interaction.user.tag || interaction.user.id})`,
        });
        byName.set(name, role);
        created.push(name);
      } catch (error) {
        failed.push(`${name} (${error.message || 'erreur'})`);
      }
    }

    const utilityFound = [];
    const utilityCreated = [];
    const utilityFailed = [];
    const connectedRole = CONNECTED_ROLE_ID ? byId.get(CONNECTED_ROLE_ID) : byName.get(CONNECTED_ROLE_NAME);
    if (connectedRole) {
      utilityFound.push(`${connectedRole.name} (${connectedRole.id})`);
    } else {
      const name = CONNECTED_ROLE_NAME;
      if (CONNECTED_ROLE_ID) {
        utilityFailed.push(`${name} (ID ${CONNECTED_ROLE_ID} introuvable sur ce serveur)`);
      } else if (byName.has(name)) {
        utilityFound.push(name);
      } else {
        try {
          const role = await guild.roles.create({
            name,
            color: 0x30d158,
            reason: `Puissance 4 utility role generator (${interaction.user.tag || interaction.user.id})`,
          });
          byName.set(name, role);
          byId.set(role.id, role);
          utilityCreated.push(`${role.name} (${role.id})`);
        } catch (error) {
          utilityFailed.push(`${name} (${error.message || 'erreur'})`);
        }
      }
    }
    if (typeof ctx.syncOnlineDiscordConnectedRoles === 'function') ctx.syncOnlineDiscordConnectedRoles();

    const missing = expected.filter(name => !byName.has(name));
    return interaction.editReply(containerMessage({
      color: failed.length || utilityFailed.length ? 0xff9f0a : 0x30d158,
      title: 'Roles ELO verifies',
      subtitle: `${expected.length} roles ELO | ${found.length} deja presents | ${created.length} crees | ${missing.length} manquants`,
      sections: [
        created.length ? `### Crees\n${created.map(name => `- ${name}`).join('\n')}` : '### Crees\nAucun role cree.',
        found.length ? `### Deja presents\n${found.slice(0, 30).map(name => `- ${name}`).join('\n')}` : '',
        failed.length ? `### Erreurs\n${failed.map(name => `- ${name}`).join('\n')}` : '',
        `### Presence\n${utilityFound.length ? `Deja present : ${utilityFound.join(', ')}` : ''}${utilityCreated.length ? `Cree : ${utilityCreated.join(', ')}` : ''}${utilityFailed.length ? `Erreur : ${utilityFailed.join(', ')}` : ''}`.trim(),
      ].filter(Boolean),
    }));
  }

  async function autocomplete(interaction) {
    const focused = interaction.options.getFocused(true);
    if (focused.name !== 'pseudo') return interaction.respond([]);
    const query = String(focused.value || '').replace(/[%_]/g, '').trim();
    const rows = ctx.db.prepare(`
      SELECT pseudo, elo, is_bot
      FROM players
      WHERE deleted=0 AND is_guest=0 AND LOWER(pseudo) LIKE LOWER(?)
      ORDER BY is_bot ASC, elo DESC
      LIMIT 25
    `).all(`%${query}%`);
    return interaction.respond(rows.map(p => ({ name: `${p.is_bot ? '[BOT] ' : ''}${p.pseudo} - ${fmt(p.elo)} ELO`.slice(0, 100), value: p.pseudo })));
  }

  async function handleLogin(interaction) {
    const password = interaction.options.getString('password', true);
    const ctxStaff = await getLinkedStaffContext(interaction.user.id);
    if (ctxStaff.error) return replyError(interaction, 'Connexion staff refusee', ctxStaff.error);
    if (!staffPasswordMatches(ctxStaff.player, password)) {
      staffSessions.delete(interaction.user.id);
      return replyError(interaction, 'Connexion staff refusee', 'Mot de passe invalide.');
    }
    const expiresAt = Date.now() + STAFF_SESSION_TTL_MS;
    staffSessions.set(interaction.user.id, {
      playerId: ctxStaff.player.id,
      pseudo: ctxStaff.player.pseudo,
      role: ctxStaff.effectiveRole,
      expiresAt,
      lastUsedAt: Date.now(),
    });
    return interaction.editReply(containerMessage({
      color: 0x30d158,
      title: 'Session staff active',
      subtitle: `${ctxStaff.player.pseudo} connecte en ${ctxStaff.effectiveRole.toUpperCase()} pendant 10 minutes.`,
      sections: ['La session est prolongee a chaque commande admin. Si tu restes AFK, elle expire automatiquement.'],
    }));
  }

  async function requireStaff(interaction, minimum = 'moderator') {
    purgeStaffSessions();
    const session = staffSessions.get(interaction.user.id);
    if (!session || Number(session.expiresAt || 0) <= Date.now()) {
      staffSessions.delete(interaction.user.id);
      await interaction.editReply(containerMessage({
        color: 0xff3b30,
        title: 'Connexion staff requise',
        subtitle: 'Utilise /login avec le mot de passe de ton profil Puissance 4.',
      }));
      return null;
    }
    const ctxStaff = await getLinkedStaffContext(interaction.user.id);
    if (ctxStaff.error || Number(ctxStaff.player?.id) !== Number(session.playerId)) {
      staffSessions.delete(interaction.user.id);
      await interaction.editReply(containerMessage({
        color: 0xff3b30,
        title: 'Session staff invalide',
        subtitle: ctxStaff.error || 'Le compte Discord lie a change.',
      }));
      return null;
    }
    const role = ctxStaff.effectiveRole;
    if ((STAFF_ORDER[role] || 0) < (STAFF_ORDER[minimum] || 1)) {
      await interaction.editReply(containerMessage({
        color: 0xff3b30,
        title: 'Acces refuse',
        subtitle: 'Role staff insuffisant pour cette commande.',
      }));
      return null;
    }
    session.expiresAt = Date.now() + STAFF_SESSION_TTL_MS;
    session.lastUsedAt = Date.now();
    session.role = role;
    staffSessions.set(interaction.user.id, session);
    return role;
  }

  async function requireStaffForAdmin(interaction, minimum = 'moderator') {
    const password = optionString(interaction, 'password', '') || '';
    if (password) {
      const ctxStaff = await getLinkedStaffContext(interaction.user.id);
      if (ctxStaff.error) {
        await interaction.editReply(containerMessage({ color: 0xff3b30, title: 'Connexion staff refusee', subtitle: ctxStaff.error }));
        return null;
      }
      if (!staffPasswordMatches(ctxStaff.player, password)) {
        await interaction.editReply(containerMessage({ color: 0xff3b30, title: 'Mot de passe invalide', subtitle: 'Utilise le mot de passe de ton profil ou le mot de passe admin global si tu es admin.' }));
        return null;
      }
      staffSessions.set(interaction.user.id, {
        playerId: ctxStaff.player.id,
        pseudo: ctxStaff.player.pseudo,
        role: ctxStaff.effectiveRole,
        expiresAt: Date.now() + STAFF_SESSION_TTL_MS,
        lastUsedAt: Date.now(),
      });
    }
    return requireStaff(interaction, minimum);
  }


  async function handleAdmin(interaction) {
    const action = ADMIN_COMMAND_ACTIONS[interaction.commandName] || optionString(interaction, 'action', '');
    const pseudo = optionString(interaction, 'pseudo');
    const value = optionNumber(interaction, 'valeur');
    const reason = optionString(interaction, 'raison', '') || '';
    const resourceId = optionString(interaction, 'id');
    const itemKey = optionString(interaction, 'item');
    const adminOnly = ['ban', 'unban', 'coins', 'elo', 'boost-elo', 'boost-coins', 'give-item', 'crystal', 'tournoi-finish', 'tournoi-pause', 'tournoi-resume', 'tournoi-delete', 'backups', 'maintenance-on', 'maintenance-off', 'role-generator', 'reload'];
    const role = await requireStaffForAdmin(interaction, adminOnly.includes(action) ? 'admin' : 'moderator');
    if (!role) return;

    if (action === 'reload') {
      await registerCommands();
      return interaction.editReply(containerMessage({ color: 0x30d158, title: 'Commandes rechargees', subtitle: `Role confirme: ${role}` }));
    }
    if (action === 'role-generator') return generateRankRoles(interaction);
    if (action === 'stats') return interaction.editReply(statsPayload());
    if (action === 'backups') {
      return interaction.editReply(containerMessage({
        color: 0xff9f0a,
        title: 'Backups disponibles',
        subtitle: 'Telechargement depuis le panel admin uniquement.',
        sections: ['`main` - p4.db\n`wal` - p4.db-wal\n`shm` - p4.db-shm'],
        buttons: [linkButton('Panel admin', `${api}/admin`, '🛡️')],
      }));
    }
    if (action === 'maintenance-on' || action === 'maintenance-off') {
      const status = ctx.writeSystemStatus({ restarting: action === 'maintenance-on', message: action === 'maintenance-on' ? (reason || 'Maintenance ou redeploiement en cours.') : '' });
      ctx.io.emit('system_status_update', status);
      ctx.WH.wlogSystem(action === 'maintenance-on' ? 'maintenance' : 'normal', status.message);
      return interaction.editReply(containerMessage({ color: action === 'maintenance-on' ? 0xff9f0a : 0x30d158, title: action === 'maintenance-on' ? 'Maintenance activee' : 'Maintenance desactivee', subtitle: status.message || 'Etat normal.' }));
    }
    if (action === 'boost-elo') {
      const multiplier = Math.max(1, Math.min(10, Number(value || 1)));
      ctx.bQ.deactivateAll.run();
      if (multiplier > 1) ctx.bQ.create.run({ multiplier, applied_by: 'Puissance4-Booster', expires_at: 0 });
      ctx.WH.wlogBoost('elo', multiplier, 'Puissance4-Booster', multiplier > 1 ? '60 min' : 'desactive');
      return interaction.editReply(boostsPayload());
    }
    if (action === 'boost-coins') {
      const multiplier = Math.max(1, Math.min(10, Number(value || 1)));
      const minutes = Math.max(1, Math.min(1440, Math.ceil(Number(reason || 60))));
      const expiresAt = multiplier > 1 ? Date.now() + minutes * 60 * 1000 : 0;
      ctx.db.prepare(`INSERT INTO config (key, value) VALUES ('coin_boost_multiplier', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`).run(String(multiplier));
      ctx.db.prepare(`INSERT INTO config (key, value) VALUES ('coin_boost_expires_at', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`).run(String(expiresAt));
      ctx.db.prepare(`INSERT INTO config (key, value) VALUES ('coin_boost_applied_by', 'Puissance4-Booster') ON CONFLICT(key) DO UPDATE SET value=excluded.value`).run();
      ctx.WH.wlogBoost('coins', multiplier, 'Puissance4-Booster', expiresAt ? `${minutes} min` : 'desactive');
      return interaction.editReply(boostsPayload());
    }
    if (['tournoi-finish', 'tournoi-pause', 'tournoi-resume', 'tournoi-delete'].includes(action)) {
      const tournament = ctx.findTournamentByRef(resourceId);
      if (!tournament) return replyError(interaction, 'Tournoi introuvable', String(resourceId || '-'));
      if (action === 'tournoi-finish') {
        ctx.finalizeTournament(tournament.id, Date.now());
        ctx.clearTournamentQueue(tournament.id);
      } else if (action === 'tournoi-pause') {
        ctx.tQ.markPaused.run({ id: tournament.id, paused_at: Date.now() });
        ctx.clearTournamentQueue(tournament.id);
      } else if (action === 'tournoi-resume') {
        const delta = Number(tournament.paused_at || 0) > 0 ? Date.now() - Number(tournament.paused_at || 0) : 0;
        ctx.tQ.resumePaused.run({ id: tournament.id, ends_at: Number(tournament.ends_at || 0) + delta });
      } else if (action === 'tournoi-delete') {
        ctx.db.prepare(`DELETE FROM tournaments WHERE id=?`).run(tournament.id);
        ctx.tournamentQueues.delete(Number(tournament.id));
      }
      ctx.WH.wlogTournament(tournament.name, tournament.public_id || tournament.id, action);
      return interaction.editReply(tournamentPayload(tournament.public_id || tournament.id) || tournamentsPayload());
    }

    const target = playerByPseudo(pseudo);
    if (!target) return replyError(interaction, 'Joueur introuvable', pseudo || 'Aucun pseudo fourni.');
    if (action === 'player') return interaction.editReply(profilePayload(target));
    if (action === 'mute') {
      const minutes = Math.max(1, Math.min(1440, Math.ceil(Number(value || 60))));
      ctx.pQ.setMute.run({ until: Date.now() + minutes * 60000, id: target.id });
      ctx.WH.wlogMute(target.pseudo, target.id, minutes / 60);
      if (typeof ctx.notifyPlayerProfileChanged === 'function') ctx.notifyPlayerProfileChanged(target.id, `Mute applique via Discord (${minutes} min).`);
      return interaction.editReply(containerMessage({ color: 0xff9f0a, title: 'Joueur mute', subtitle: `${target.pseudo} pendant ${minutes} min.` }));
    }
    if (action === 'unmute') {
      ctx.pQ.setMute.run({ until: 0, id: target.id });
      ctx.WH.wlogMute(target.pseudo, target.id, 0);
      if (typeof ctx.notifyPlayerProfileChanged === 'function') ctx.notifyPlayerProfileChanged(target.id, 'Mute retire via Discord.');
      return interaction.editReply(containerMessage({ color: 0x30d158, title: 'Mute leve', subtitle: target.pseudo }));
    }
    if (action === 'ban' || action === 'unban') {
      const banned = action === 'ban' ? 1 : 0;
      ctx.pQ.setBanned.run({ banned, id: target.id });
      ctx.WH.wlogBan(target.pseudo, target.id, banned);
      if (typeof ctx.notifyPlayerProfileChanged === 'function') ctx.notifyPlayerProfileChanged(target.id, banned ? 'Compte banni via Discord.' : 'Bannissement retire via Discord.');
      return interaction.editReply(containerMessage({ color: banned ? 0xff3b30 : 0x30d158, title: banned ? 'Joueur banni' : 'Joueur debanni', subtitle: target.pseudo }));
    }
    if (action === 'coins') {
      const delta = Math.trunc(Number(value || 0));
      const nextCoins = Math.max(0, Number(target.coins || 0) + delta);
      ctx.pQ.updateCoins.run({ coins: nextCoins, id: target.id });
      ctx.WH.wlogCoins(target.pseudo, target.id, delta, reason || 'Commande Discord admin');
      if (typeof ctx.notifyPlayerProfileChanged === 'function') ctx.notifyPlayerProfileChanged(target.id, `Coins modifies via Discord (${delta >= 0 ? '+' : ''}${delta}).`);
      return interaction.editReply(containerMessage({ color: 0xff9f0a, title: 'Coins modifies', subtitle: `${target.pseudo}: ${fmt(nextCoins)} coins (${delta >= 0 ? '+' : ''}${delta})` }));
    }
    if (action === 'elo') {
      const delta = Math.trunc(Number(value || 0));
      const nextElo = Math.max(0, Number(target.elo || 0) + delta);
      ctx.pQ.setElo.run({ elo: nextElo, id: target.id });
      ctx.WH.wlogAdminAction('ELO Discord', target.pseudo, target.id, [['Delta', delta, true], ['Nouveau', nextElo, true]]);
      if (typeof ctx.syncPlayerDiscordRankRole === 'function') ctx.syncPlayerDiscordRankRole(target.id).catch(() => {});
      if (typeof ctx.notifyPlayerProfileChanged === 'function') ctx.notifyPlayerProfileChanged(target.id, `ELO modifie via Discord : ${nextElo}.`);
      return interaction.editReply(containerMessage({ color: 0xffd60a, title: 'ELO modifie', subtitle: `${target.pseudo}: ${nextElo} ELO (${delta >= 0 ? '+' : ''}${delta})` }));
    }
    if (action === 'give-item') {
      const item = resolveGiveItem(itemKey);
      if (!item) return replyError(interaction, 'Item invalide', itemKey || '-');
      const quantity = Math.max(1, Math.min(99, Math.trunc(Number(value || 1))));
      ctx.shopItemQ.addQty.run({ player_id: target.id, item_key: item.key, quantity });
      ctx.WH.wlogAdminAction('Item boutique Discord', target.pseudo, target.id, [['Item', item.label, true], ['Quantite', quantity, true]]);
      if (typeof ctx.notifyPlayerProfileChanged === 'function') ctx.notifyPlayerProfileChanged(target.id, `Item ajoute via Discord : ${item.label} x${quantity}.`);
      return interaction.editReply(containerMessage({ color: 0xbf5af2, title: 'Item donne', subtitle: `${target.pseudo} recoit ${quantity} x ${item.label}` }));
    }
    if (action === 'crystal') {
      const days = Math.max(1, Math.min(3650, Math.ceil(Number(value || 30))));
      const fresh = typeof ctx.grantCrystal === 'function'
        ? ctx.grantCrystal(target.id, { durationMs: days * 24 * 60 * 60 * 1000, autoRenew: true })
        : null;
      if (!fresh) return replyError(interaction, 'Crystal impossible', 'Ce joueur ne peut pas recevoir Crystal.');
      ctx.WH.wlogAdminAction('Crystal Discord', target.pseudo, target.id, [['Duree', `${days} jour(s)`, true], ['Par', interaction.user.tag || interaction.user.id, true]]);
      if (typeof ctx.notifyPlayerProfileChanged === 'function') ctx.notifyPlayerProfileChanged(target.id, `Crystal accorde via Discord (${days}j).`);
      return interaction.editReply(containerMessage({ color: 0x85ebff, title: 'Crystal accorde', subtitle: `${fresh.pseudo} recoit Crystal pendant ${days} jour(s). Renouvellement auto actif.` }));
    }
    return interaction.editReply(containerMessage({ color: 0xff3b30, title: 'Action inconnue', subtitle: action }));
  }

  async function handleCoupon(interaction) {
    const role = await requireStaff(interaction, 'admin');
    if (!role) return;

    const type = optionString(interaction, 'type') === 'flat' ? 'flat' : 'discount';
    const codeValue = normalizeCouponCode(optionString(interaction, 'code') || makeCouponCode());
    if (!codeValue || codeValue.length < 3) {
      return replyError(interaction, 'Code coupon invalide', 'Utilise au moins 3 caracteres alphanumeriques.');
    }

    const maxValue = type === 'flat' ? 100000 : 95;
    const value = Math.max(1, Math.min(maxValue, optionInteger(interaction, 'valeur', type === 'flat' ? 100 : 20)));
    const maxUses = Math.max(1, Math.min(10000, optionInteger(interaction, 'utilisations', 1)));
    const hours = Math.max(0, Math.min(8760, optionInteger(interaction, 'heures', 0)));
    const expiresAt = hours ? Date.now() + hours * 60 * 60 * 1000 : null;
    const staff = await getLinkedStaffContext(interaction.user.id);

    ctx.db.prepare(`
      INSERT INTO coupons (code, type, value, max_uses, uses, expires_at, created_by, created_at)
      VALUES (?, ?, ?, ?, 0, ?, ?, ?)
      ON CONFLICT(code) DO UPDATE SET
        type=excluded.type,
        value=excluded.value,
        max_uses=excluded.max_uses,
        uses=0,
        expires_at=excluded.expires_at,
        created_by=excluded.created_by,
        created_at=excluded.created_at
    `).run(codeValue, type, value, maxUses, expiresAt, staff.player?.id || null, Date.now());

    return interaction.editReply(containerMessage({
      color: 0x85ebff,
      title: 'Coupon boutique cree',
      subtitle: `${code(codeValue)} est pret pour la boutique.`,
      sections: [[
        `Type : **${type === 'flat' ? 'montant fixe' : 'reduction'}**`,
        `Valeur : **${value}${type === 'flat' ? '' : '%'}**`,
        `Utilisations : **${maxUses}**`,
        `Expiration : **${hours ? `${hours}h` : 'aucune'}**`,
      ]],
      buttons: [linkButton('Ouvrir la boutique', `${api}/boutique`, '🛒')],
    }));
  }

  function updateStatus() {
    try {
      const presence = ctx.getPresenceCounts();
      const activeGames = Number(ctx.db.prepare(`SELECT COUNT(*) AS c FROM games WHERE status='active'`).get()?.c || 0);
      const queueCount = Number(ctx.mm?.queue?.length || ctx.mm?.q?.length || 0);
      const registered = Number(ctx.db.prepare(`SELECT COUNT(*) AS c FROM players WHERE deleted=0 AND is_guest=0 AND id != ?`).get(ctx.BOT_PLAYER_ID)?.c || 0);
      const bots = Number(ctx.db.prepare(`SELECT COUNT(*) AS c FROM players WHERE deleted=0 AND is_guest=0 AND is_bot=1`).get()?.c || 0);
      const statuses = [
        { text: `🟢・${presence.totalPresent || 0} présents`, type: ActivityType.Watching },
        { text: `🎬・${activeGames} parties live`, type: ActivityType.Watching },
        { text: `⏳・${queueCount} en file`, type: ActivityType.Competing },
        { text: `🖥️・${registered} comptes`, type: ActivityType.Watching },
        { text: `🤖・${bots} bots API`, type: ActivityType.Watching },
        {text :`💾・Version 3.1.2`,type:ActivityType.Watching}
      ];
      const status = statuses[Math.floor(Date.now() / 10000) % statuses.length];
      bot.user.setStatus('idle')
      bot.user.setActivity(status.text, { type: status.type });
    } catch (_) {}
  }

  async function loadGuildEmojis() {
    discordEmojiCache.clear();
    if (!ctx.DISCORD_GUILD) return;
    try {
      const guild = await bot.guilds.fetch(ctx.DISCORD_GUILD);
      const emojis = await guild.emojis.fetch();
      emojis.forEach(emoji => {
        const rendered = emoji.animated ? `<a:${emoji.name}:${emoji.id}>` : `<:${emoji.name}:${emoji.id}>`;
        discordEmojiCache.set(normalizeEmojiName(emoji.name), rendered);
      });
      console.log(`[BOT] ${discordEmojiCache.size} emojis serveur charges`);
    } catch (error) {
      console.warn('[BOT] Emojis serveur indisponibles:', error.message);
    }
  }

  function publicRewardRow(customId, label, emoji) {
    return rowButtons([
      new ButtonBuilder()
        .setCustomId(customId)
        .setLabel(label)
        .setEmoji(emoji)
        .setStyle(ButtonStyle.Primary),
    ]);
  }

  async function handleGiveaway(interaction) {
    const staff = await requireDiscordAdmin(interaction);
    if (!staff) return;
    const title = truncate(optionString(interaction, 'titre', 'Giveaway Puissance 4'), 90);
    const minutes = Math.max(1, Math.min(GIVEAWAY_MINUTES_MAX, optionInteger(interaction, 'duree', 10)));
    const reward = normalizeRewardKey(optionString(interaction, 'recompense', 'coins'));
    const quantity = Math.max(1, Math.min(999999, optionInteger(interaction, 'quantite', 1)));
    const winnersCount = Math.max(1, Math.min(10, optionInteger(interaction, 'gagnants', 1)));
    if (reward !== 'coins' && reward !== 'gems' && reward !== 'gemmes' && !resolveGiveItem(reward)) {
      return replyError(interaction, 'Recompense invalide', 'Utilise coins, gems ou un code item boutique.');
    }
    const id = crypto.randomBytes(5).toString('hex');
    const endsAt = Date.now() + minutes * 60 * 1000;
    const message = await interaction.channel.send({
      content: [
        `## 🎉 ${title}`,
        `Prix : **${rewardLabel(reward, quantity)}**`,
        `Fin : <t:${Math.floor(endsAt / 1000)}:R>`,
        `Gagnants : **${winnersCount}**`,
        `Clique sur le bouton pour participer.`,
      ].join('\n'),
      components: [publicRewardRow(`p4_giveaway_join:${id}`, 'Participer', '🎉')],
    });
    activeGiveaways.set(id, {
      id,
      title,
      reward,
      quantity,
      winnersCount,
      entrants: new Set(),
      channelId: interaction.channelId,
      messageId: message.id,
      endsAt,
    });
    setTimeout(() => finalizeGiveaway(id).catch(error => console.warn('[BOT] Giveaway:', error.message)), minutes * 60 * 1000);
    return interaction.editReply(containerMessage({
      color: 0xffd60a,
      title: 'Giveaway publie',
      subtitle: `${title} | ${rewardLabel(reward, quantity)} | ${minutes} min`,
    }));
  }

  async function finalizeGiveaway(id) {
    const giveaway = activeGiveaways.get(id);
    if (!giveaway) return;
    activeGiveaways.delete(id);
    const channel = await bot.channels.fetch(giveaway.channelId).catch(() => null);
    const entrants = [...giveaway.entrants];
    const winners = entrants.sort(() => Math.random() - .5).slice(0, giveaway.winnersCount);
    const lines = [];
    for (const discordId of winners) {
      const result = grantRewardToDiscordUser(discordId, giveaway.reward, giveaway.quantity, `Giveaway Discord: ${giveaway.title}`);
      lines.push(result.ok
        ? `<@${discordId}> gagne **${result.label}** sur le compte **${result.player.pseudo}**.`
        : `<@${discordId}> gagne, mais son compte Discord n'est pas lie: recompense non attribuee automatiquement.`);
    }
    const finalContent = winners.length
      ? `## 🎉 Giveaway termine: ${giveaway.title}\n${lines.join('\n')}`
      : `## 🎉 Giveaway termine: ${giveaway.title}\nAucun participant.`;
    const message = channel ? await channel.messages.fetch(giveaway.messageId).catch(() => null) : null;
    if (message) await message.edit({ content: finalContent, components: [] }).catch(() => {});
    else if (channel) await channel.send(finalContent).catch(() => {});
  }

  async function handleDrop(interaction) {
    const staff = await requireDiscordAdmin(interaction);
    if (!staff) return;
    const title = truncate(optionString(interaction, 'titre', 'Drop Puissance 4'), 90);
    const reward = normalizeRewardKey(optionString(interaction, 'recompense', 'coins'));
    const quantity = Math.max(1, Math.min(999999, optionInteger(interaction, 'quantite', 1)));
    if (reward !== 'coins' && reward !== 'gems' && reward !== 'gemmes' && !resolveGiveItem(reward)) {
      return replyError(interaction, 'Recompense invalide', 'Utilise coins, gems ou un code item boutique.');
    }
    const id = crypto.randomBytes(5).toString('hex');
    const message = await interaction.channel.send({
      content: [
        `## ⚡ ${title}`,
        `Prix : **${rewardLabel(reward, quantity)}**`,
        `Premier clic = gagnant.`,
      ].join('\n'),
      components: [publicRewardRow(`p4_drop_claim:${id}`, 'Claim', '⚡')],
    });
    activeDrops.set(id, { id, title, reward, quantity, channelId: interaction.channelId, messageId: message.id, claimed: false });
    return interaction.editReply(containerMessage({
      color: 0x85ebff,
      title: 'Drop publie',
      subtitle: `${title} | ${rewardLabel(reward, quantity)}`,
    }));
  }

  async function handleGiveawayButton(interaction, id) {
    const giveaway = activeGiveaways.get(id);
    if (!giveaway || Date.now() >= Number(giveaway.endsAt || 0)) {
      return interaction.reply({ content: 'Ce giveaway est termine.', flags: MessageFlags.Ephemeral }).catch(() => {});
    }
    giveaway.entrants.add(interaction.user.id);
    return interaction.reply({ content: `Participation validee. Participants: ${giveaway.entrants.size}`, flags: MessageFlags.Ephemeral }).catch(() => {});
  }

  async function handleDropButton(interaction, id) {
    const drop = activeDrops.get(id);
    if (!drop || drop.claimed) {
      return interaction.reply({ content: 'Drop deja reclame.', flags: MessageFlags.Ephemeral }).catch(() => {});
    }
    drop.claimed = true;
    activeDrops.delete(id);
    const result = grantRewardToDiscordUser(interaction.user.id, drop.reward, drop.quantity, `Drop Discord: ${drop.title}`);
    const content = result.ok
      ? `## ⚡ Drop reclame: ${drop.title}\n<@${interaction.user.id}> gagne **${result.label}** sur le compte **${result.player.pseudo}**.`
      : `## ⚡ Drop reclame: ${drop.title}\n<@${interaction.user.id}> a clique en premier, mais son compte Discord n'est pas lie: recompense non attribuee automatiquement.`;
    await interaction.update({ content, components: [] }).catch(() => {});
  }

  bot.once('clientReady', async () => {
    console.log(`[BOT] Bot connecte : ${bot.user.tag}`);
    try {
      await loadGuildEmojis();
      await registerCommands();
      console.log('[BOT] Commandes slash enregistrees depuis discord-bot.js');
    } catch (error) {
      console.error('[BOT] Register commands:', error.message);
    }
    updateStatus();
    setInterval(updateStatus, 10000);
  });

  bot.on('interactionCreate', async interaction => {
    try {
      if (interaction.isAutocomplete()) return autocomplete(interaction);
      if (interaction.isStringSelectMenu() && interaction.customId.startsWith('p4_profile_games:')) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const value = interaction.values?.[0] || '';
        if (!value.startsWith('game:')) return replyError(interaction, 'Selection invalide');
        const payload = replayPayload(Number(value.slice(5)));
        if (!payload) return replyError(interaction, 'Partie introuvable');
        return interaction.editReply(payload);
      }
      if (interaction.isButton?.() && interaction.customId.startsWith('p4_giveaway_join:')) {
        return handleGiveawayButton(interaction, interaction.customId.split(':')[1]);
      }
      if (interaction.isButton?.() && interaction.customId.startsWith('p4_drop_claim:')) {
        return handleDropButton(interaction, interaction.customId.split(':')[1]);
      }
      if (!interaction.isChatInputCommand()) return;
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      if (interaction.commandName === 'profil') {
        const player = playerByPseudo(interaction.options.getString('pseudo', true));
        if (!player) return replyError(interaction, 'Joueur introuvable');
        return interaction.editReply(profilePayload(player));
      }
      if (interaction.commandName === 'moi') {
        const player = playerByDiscord(interaction.user.id);
        if (!player) return replyError(interaction, 'Compte non lie', `Lie ton compte depuis ${api}/profil`);
        return interaction.editReply(profilePayload(player));
      }
      if (interaction.commandName === 'ui') return interaction.editReply(await userInfoPayload(interaction));
      if (interaction.commandName === 'classement') return interaction.editReply(leaderboardPayload(interaction.options.getString('type') || 'humans'));
      if (interaction.commandName === 'leaderboard') return interaction.editReply(leaderboardPayload(interaction.options.getString('type') || 'humans'));
      if (interaction.commandName === 'stats') return interaction.editReply(statsPayload());
      if (interaction.commandName === 'systeme') return interaction.editReply(systemPayload());
      if (interaction.commandName === 'live') return interaction.editReply(livePayload());
      if (interaction.commandName === 'boutique') return interaction.editReply(shopPayload());
      if (interaction.commandName === 'api') return interaction.editReply(apiPayload());
      if (interaction.commandName === 'boosts') return interaction.editReply(boostsPayload());
      if (interaction.commandName === 'cosmetiques') return interaction.editReply(cosmeticsPayload(interaction.options.getString('type', true)));
      if (interaction.commandName === 'bots') return interaction.editReply(botsPayload());
      if (interaction.commandName === 'login') return handleLogin(interaction);
      if (interaction.commandName === 'replay') {
        const payload = replayPayload(interaction.options.getInteger('id', true));
        if (!payload) return replyError(interaction, 'Partie introuvable');
        return interaction.editReply(payload);
      }
      if (interaction.commandName === 'duel-lien') {
        const player = playerByDiscord(interaction.user.id);
        if (!player) return replyError(interaction, 'Compte non lie', 'Ton compte Discord doit etre lie pour creer un duel ranked.');
        const gameType = interaction.options.getString('type', true) === 'friendly' ? 'friendly' : 'ranked';
        const challenge = ctx.createDuelChallenge({ senderId: player.id, mode: 'link', ttlMs: 15 * 60 * 1000, gameType });
        const url = `${api}/duel/${challenge.id}`;
        ctx.WH.wlogDuel(player.pseudo, 'Lien public', gameType);
        return interaction.editReply(containerMessage({
          color: gameType === 'friendly' ? 0x85ebff : 0xffd60a,
          title: 'Lien de duel cree',
          subtitle: `${gameType === 'friendly' ? 'Amical' : 'Ranked'} | expire dans 15 minutes`,
          buttons: [linkButton('Ouvrir le duel', url, '⚔️')],
        }));
      }
      if (interaction.commandName === 'giveaway') return handleGiveaway(interaction);
      if (interaction.commandName === 'drop') return handleDrop(interaction);
      if (interaction.commandName === 'tournois') return interaction.editReply(tournamentsPayload());
      if (interaction.commandName === 'tournoi') {
        const payload = tournamentPayload(interaction.options.getString('id', true));
        if (!payload) return replyError(interaction, 'Tournoi introuvable');
        return interaction.editReply(payload);
      }
      if (interaction.commandName === 'aide') return interaction.editReply(helpPayload());
      if (ADMIN_COMMAND_ACTIONS[interaction.commandName]) return handleAdmin(interaction);
      if (interaction.commandName === 'admin-coupon') return handleCoupon(interaction);
    } catch (error) {
      console.error('[BOT ERROR]', error);
      return replyError(interaction, 'Erreur bot Discord', truncate(error.message || 'Erreur inconnue', 300));
    }
  });

  bot.on('messageCreate', message => {
    try {
      awardDiscordActivityGems(message);
    } catch (error) {
      console.warn('[BOT] Activite Discord:', error.message);
    }
  });

  bot.login(botToken).catch(error => console.error('[BOT] Login failed:', error.message));
  return bot;
}

module.exports = {
  buildDiscordCommandDefinitions,
  startDiscordBot,
};

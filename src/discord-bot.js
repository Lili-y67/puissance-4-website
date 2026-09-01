const {
  Client,
  GatewayIntentBits,
  ActivityType,
  REST,
  Routes,
  ButtonBuilder,
  ButtonStyle,
  AttachmentBuilder,
  ActionRowBuilder,
  ChannelType,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ContainerBuilder,
  TextDisplayBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  SeparatorBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  MessageFlags,
  PermissionsBitField,
  EmbedBuilder,
} = require('discord.js');
const {DefaultWebSocketManagerOptions}=require('@discordjs/ws')
DefaultWebSocketManagerOptions.identifyProperties.browser = 'Discord Android'
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { getAllRankRoleNames, RANKS } = require('./rank');
const { normalizeVariant, getVariant, publicVariants } = require('./game/variants');

const DEFAULT_API = `http://127.0.0.1:${process.env.PORT || 3000}`;
const STAFF_ORDER = { user: 0, moderator: 1, admin: 2 };
const CONNECTED_ROLE_ID = process.env.DISCORD_CONNECTED_ROLE_ID || '1508402625370918952';
const CONNECTED_ROLE_NAME = process.env.DISCORD_CONNECTED_ROLE_NAME || 'Connect\u00e9e';
const GIVEAWAY_MINUTES_MAX = 10080;
const TICKET_CATEGORY_ID = process.env.DISCORD_TICKET_CATEGORY_ID || '1524802853338616079';
const TICKET_SUPPORT_ROLE_ID = process.env.DISCORD_TICKET_SUPPORT_ROLE_ID || '1480180483613655181';
const TICKET_TRANSCRIPT_CHANNEL_ID = process.env.DISCORD_TICKET_TRANSCRIPT_CHANNEL_ID || '1508532192349913119';
const CONNECTED_COUNT_CHANNEL_ID = process.env.DISCORD_CONNECTED_COUNT_CHANNEL_ID || '1531954706752999434';
const configuredConnectedCountInterval = Number(process.env.DISCORD_CONNECTED_COUNT_INTERVAL_MS || 30_000);
const CONNECTED_COUNT_INTERVAL_MS = Number.isFinite(configuredConnectedCountInterval)
  ? Math.max(30_000, configuredConnectedCountInterval)
  : 30_000;
const DISCORD_EMOJI_SYNC_ENABLED = String(process.env.DISCORD_SYNC_EMOJIS || '1') !== '0';
const configuredEmojiSyncDelay = Number(process.env.DISCORD_EMOJI_SYNC_DELAY_MS || 15_000);
const DISCORD_EMOJI_SYNC_DELAY_MS = Number.isFinite(configuredEmojiSyncDelay)
  ? Math.max(5_000, configuredEmojiSyncDelay)
  : 15_000;
const DISCORD_EMOJI_MAX_BYTES = 256 * 1024;
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
  const idOption = (description = 'ID partie ou ressource') => ({ type: 3, name: 'id', description, required: true });
  const adminCommand = (name, description, options = []) => ({ name: `admin-${name}`, description, options });
  const variantOption = () => ({
    type: 3,
    name: 'variante',
    description: 'Variante et classement ELO',
    required: false,
    choices: publicVariants().map(variant => ({ name: variant.label, value: variant.id })),
  });

  return [
    { name: 'profil', description: 'Afficher le profil Puissance 4 d un joueur', options: [{ type: 3, name: 'pseudo', description: 'Pseudo du joueur', required: true, autocomplete: true }, variantOption()] },
    { name: 'moi', description: 'Afficher ton profil lie Discord', options: [variantOption()] },
    { name: 'ui', description: 'Afficher en francais les informations Discord d un membre', options: [{ type: 6, name: 'utilisateur', description: 'Membre a inspecter', required: false }] },
    { name: 'classement', description: 'Afficher le top ELO Puissance 4', options: [{ type: 3, name: 'type', description: 'Classement a afficher', required: false, choices: [{ name: 'Membres', value: 'humans' }, { name: 'Bots', value: 'bots' }] }, variantOption()] },
    { name: 'stats', description: 'Afficher les statistiques du site' },
    { name: 'systeme', description: 'Afficher l etat public du serveur' },
    { name: 'live', description: 'Afficher les parties en direct' },
    { name: 'variantes', description: 'Lire les regles des variantes Puissance 4' },
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
    { name: 'ticket-setup', description: 'Installer le panneau de tickets Puissance 4', default_member_permissions: '16' },
    { name: 'leaderboard', description: 'Alias du classement officiel', options: [{ type: 3, name: 'type', description: 'Classement a afficher', required: false, choices: [{ name: 'Membres', value: 'humans' }, { name: 'Bots', value: 'bots' }] }, variantOption()] },
    { name: 'bots', description: 'Afficher les bots API et preconfigures' },
    { name: 'login', description: 'Ouvrir une session staff Discord pendant 10 minutes', options: [{ type: 3, name: 'password', description: 'Mot de passe de ton compte Puissance 4', required: true }] },
    { name: 'db-reset', description: 'Reset DB admin: wallpapers ou base complete avec confirmation', default_member_permissions: '8', options: [
      { type: 3, name: 'mode', description: 'Type de reset', required: true, choices: [{ name: 'Wallpapers seulement', value: 'wallpapers' }, { name: 'Sessions seulement', value: 'sessions' }, { name: 'DB complete', value: 'all' }] },
      { type: 3, name: 'confirmation', description: 'Ecris CONFIRMER pour DB complete', required: false },
      { type: 3, name: 'password', description: 'Mot de passe staff/admin si session expiree', required: false },
    ] },
    adminCommand('coupon', 'Creer un code promotionnel boutique', [
      { type: 3, name: 'code', description: 'Code a creer, vide = aleatoire', required: false },
      { type: 3, name: 'type', description: 'Type de reduction', required: false, choices: [{ name: 'Pourcentage', value: 'discount' }, { name: 'Montant fixe', value: 'flat' }] },
      { type: 4, name: 'valeur', description: 'Pourcentage ou montant retire', required: false },
      { type: 4, name: 'utilisations', description: 'Nombre maximum d utilisations', required: false },
      { type: 4, name: 'heures', description: 'Expiration en heures, vide = pas d expiration', required: false },
    ]),
    { name: 'key-generate', description: 'Ouvrir le generateur de cle produit', default_member_permissions: '8' },
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
  const variantMeta = value => getVariant(normalizeVariant(value));
  const variantLabel = value => variantMeta(value).label;
  const playerVariantStats = (player, value) => {
    const variant = normalizeVariant(value);
    if (variant === 'classic') return { variant, elo: Number(player.elo || 0), wins: Number(player.wins || 0), losses: Number(player.losses || 0), draws: Number(player.draws || 0) };
    const stats = ctx.variantQ?.get?.get(player.id, variant) || {};
    return { variant, elo: Number(stats.elo ?? 1000), wins: Number(stats.wins || 0), losses: Number(stats.losses || 0), draws: Number(stats.draws || 0) };
  };
  const discordEmojiCache = new Map();
  const staffSessions = new Map();
  const activeGiveaways = new Map();
  const activeDrops = new Map();
  const STAFF_SESSION_TTL_MS = 10 * 60 * 1000;
  let connectedCountTimer = null;
  let previousOnlinePlayers = null;
  let connectedCountUpdateRunning = false;
  let emojiSyncRunning = false;

  async function updateConnectedCountChannel() {
    if (connectedCountUpdateRunning || !CONNECTED_COUNT_CHANNEL_ID) return;
    connectedCountUpdateRunning = true;
    try {
      const channel = await bot.channels.fetch(CONNECTED_COUNT_CHANNEL_ID).catch(() => null);
      if (!channel) {
        console.warn(`[BOT CONNECTES] Salon introuvable : ${CONNECTED_COUNT_CHANNEL_ID}`);
        return;
      }

      const players = typeof ctx.getOnlinePlayers === 'function' ? ctx.getOnlinePlayers() : [];
      const current = new Map(players.map(player => [Number(player.id), String(player.pseudo)]));
      const expectedName = `🟢・Connectés : ${current.size}`;

      if (channel.name !== expectedName && typeof channel.setName === 'function') {
        await channel.setName(expectedName, 'Mise à jour du nombre de joueurs connectés au site');
      }

      if (previousOnlinePlayers !== null) {
        const joined = [...current]
          .filter(([id]) => !previousOnlinePlayers.has(id))
          .map(([, pseudo]) => pseudo);
        const left = [...previousOnlinePlayers]
          .filter(([id]) => !current.has(id))
          .map(([, pseudo]) => pseudo);

        if ((joined.length || left.length) && typeof channel.send === 'function') {
          const lines = [
            ...joined.map(pseudo => `[+] ${pseudo}`),
            ...left.map(pseudo => `[-] ${pseudo}`),
          ];
          const overflow = Math.max(0, lines.length - 50);
          const description = [
            ...lines.slice(0, 50),
            ...(overflow ? [`… et ${overflow} autre(s) changement(s)`] : []),
          ].join('\n');
          const embed = new EmbedBuilder()
            .setColor(joined.length && !left.length ? 0x30d158 : (!joined.length && left.length ? 0xff453a : 0xffd60a))
            .setTitle('Présence sur Puissance 4')
            .setDescription(description)
            .setFooter({ text: `${current.size} joueur${current.size > 1 ? 's' : ''} connecté${current.size > 1 ? 's' : ''}` })
            .setTimestamp();
          await channel.send({ embeds: [embed] });
        }
      }

      previousOnlinePlayers = current;
    } catch (error) {
      console.warn('[BOT CONNECTES]', error.message);
    } finally {
      connectedCountUpdateRunning = false;
    }
  }

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

  function containerMessage({
    color = 0xff2d55,
    title,
    subtitle = '',
    sections = [],
    media = [],
    buttons = [],
    rows = [],
    files = [],
  }) {
    const container = new ContainerBuilder().setAccentColor(color);
    const header = [`## ${title}`, subtitle].filter(Boolean).join('\n');
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(header));

    if (media.length) {
      container.addSeparatorComponents(new SeparatorBuilder());
      const gallery = new MediaGalleryBuilder();
      gallery.addItems(
        media.slice(0, 10).map((item) => {
          const source = typeof item === 'string' ? { url: item } : item;
          const galleryItem = new MediaGalleryItemBuilder().setURL(source.url);
          if (source.description) galleryItem.setDescription(source.description);
          return galleryItem;
        })
      );
      container.addMediaGalleryComponents(gallery);
    }

    if (sections.length) container.addSeparatorComponents(new SeparatorBuilder());
    for (const section of sections) {
      const contentSource = section && typeof section === 'object' && !Array.isArray(section)
        ? section.content
        : section;
      const content = Array.isArray(contentSource) ? contentSource.filter(Boolean).join('\n') : String(contentSource || '');
      if (content) container.addTextDisplayComponents(new TextDisplayBuilder().setContent(content.slice(0, 4000)));
      if (section && typeof section === 'object' && !Array.isArray(section) && Array.isArray(section.rows)) {
        for (const row of section.rows) container.addActionRowComponents(row);
      }
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

  function elapsedApiMs(startedAt) {
    return Math.max(0, Math.round(Number(process.hrtime.bigint() - startedAt) / 1e6));
  }

  function appendApiLatency(payload, startedAt) {
    const line = `-# API Puissance 4 : **${fmt(elapsedApiMs(startedAt))} ms**`;
    if (typeof payload === 'string') return { content: `${payload}\n${line}` };
    if (!payload || typeof payload !== 'object') return payload;

    const container = Array.isArray(payload.components) ? payload.components[0] : null;
    if (container?.addSeparatorComponents && container?.addTextDisplayComponents) {
      container.addSeparatorComponents(new SeparatorBuilder());
      container.addTextDisplayComponents(new TextDisplayBuilder().setContent(line));
      return payload;
    }

    const next = { ...payload };
    next.content = next.content ? `${next.content}\n${line}` : line;
    return next;
  }

  function trackSlashApiLatency(interaction, startedAt) {
    const editReply = interaction.editReply.bind(interaction);
    interaction.editReply = payload => editReply(appendApiLatency(payload, startedAt));
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

  async function requireDiscordStaff(interaction) {
    const staff = await getLinkedStaffContext(interaction.user.id);
    if (staff.error) {
      await replyError(interaction, 'Acces refuse', staff.error);
      return null;
    }
    if ((STAFF_ORDER[staff.effectiveRole] || 0) < STAFF_ORDER.moderator) {
      await replyError(interaction, 'Acces staff requis');
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

  function activityAssetUrl(activity, key) {
    const asset = activity?.assets?.[key];
    if (!asset) return '';
    if (/^https?:\/\//i.test(asset)) return asset;
    if (String(asset).startsWith('mp:')) return `https://media.discordapp.net/${String(asset).slice(3)}`;
    if (String(asset).startsWith('spotify:')) return `https://i.scdn.co/image/${String(asset).slice(8)}`;
    if (activity.applicationId) return `https://cdn.discordapp.com/app-assets/${activity.applicationId}/${asset}.png`;
    return '';
  }

  function progressBar(elapsedMs, totalMs, size = 21, marker = '🔘') {
    const total = Math.max(1, Number(totalMs || 0));
    const ratio = Math.max(0, Math.min(1, Number(elapsedMs || 0) / total));
    const pos = Math.max(0, Math.min(size - 1, Math.round(ratio * (size - 1))));
    return `${'─'.repeat(pos)}${marker}${'─'.repeat(size - 1 - pos)}`;
  }

  function getSpotifyActivity(member) {
    return (member?.presence?.activities || []).find(activity => activity?.name === 'Spotify' || activity?.syncId) || null;
  }

  function spotifyActivityButtons(member) {
    const spotify = getSpotifyActivity(member);
    if (!spotify) return [];
    const buttons = [];
    if (spotify.syncId) buttons.push(linkButton('Ouvrir Musique', `https://open.spotify.com/track/${spotify.syncId}`, '🎵'));
    const cover = activityAssetUrl(spotify, 'largeImage');
    if (cover) buttons.push(linkButton('Voir Pochette', cover, '💿'));
    return buttons;
  }

  function formatDiscordActivity(member) {
    const activities = member?.presence?.activities || [];
    if (!activities.length) return 'Aucune activite detectee.';
    const activityIcon = activity => {
      if (activity.type === ActivityType.Custom) return activityEmoji(activity) || '💬';
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
      if (!emoji) return '💬';
      if (emoji.id && emoji.name) return `<${emoji.animated ? 'a' : ''}:${emoji.name}:${emoji.id}>`;
      return emoji.name || '💬';
    };
    const assetUrl = (activity, key) => {
      const asset = activity.assets?.[key];
      if (!asset) return '';
      if (/^https?:\/\//i.test(asset)) return asset;
      if (String(asset).startsWith('mp:')) return `https://media.discordapp.net/${String(asset).slice(3)}`;
      if (String(asset).startsWith('spotify:')) return `https://i.scdn.co/image/${String(asset).slice(8)}`;
      if (activity.applicationId) return `https://cdn.discordapp.com/app-assets/${activity.applicationId}/${asset}.png`;
      return '';
    };
    const activitySearchText = activity => [
      activity.name,
      activity.details,
      activity.state,
      activity.assets?.largeText,
      activity.assets?.smallText,
    ].filter(Boolean).join(' ').toLowerCase();
    const isCodeActivity = activity => /(^|\s)(code|vscode|visual studio code|cursor|sublime text|intellij|webstorm|pycharm|phpstorm|rider|clion|fleet)(\s|$)/i.test(activitySearchText(activity));
    const isMinecraftActivity = activity => /minecraft|Lunar Client|Feather Client|CheatBreaker|badlion|labymod|salwyrr|pvplounge/i.test(activitySearchText(activity));
    const firstMatch = (values, regex) => {
      for (const value of values.filter(Boolean)) {
        const match = String(value).match(regex);
        if (match?.[1]) return match[1];
        if (match?.[0]) return match[0];
      }
      return '';
    };
    const codeAppName = activity => {
      const values = [activity.assets?.smallText, activity.assets?.largeText, activity.name];
      return values.find(value => /visual studio code|cursor|sublime text|intellij|webstorm|pycharm|phpstorm|rider|clion|fleet/i.test(String(value || '')))
        || (String(activity.name || '').toLowerCase() === 'code' ? 'Visual Studio Code' : activity.name || 'editeur');
    };
    const minecraftServer = activity => firstMatch(
      [activity.state, activity.details, activity.assets?.largeText, activity.assets?.smallText],
      /(?:serveur|server|sur)\s*:?\s*([a-z0-9_.-]+\.[a-z]{2,}(?::\d{2,5})?)/i,
    ) || firstMatch(
      [activity.state, activity.details],
      /[a-z0-9_.-]+\.[a-z]{2,}(?::\d{2,5})?/i,
    );
    const minecraftPseudo = activity => firstMatch(
      [activity.state, activity.details, activity.assets?.largeText, activity.assets?.smallText],
      /(?:pseudo|joueur|player|as)\s*:?\s*([a-z0-9_]{3,16})/i,
    );
    const activityText = activity => {
      const name = escapeDiscordMarkdown(activity.name || 'Activite');
      if (activity.type === ActivityType.Custom) {
        const emoji = activityEmoji(activity);
        return `${emoji || '💬'}・Statut perso: **${escapeDiscordMarkdown(activity.state || activity.name || 'Aucun texte')}**`;
      }
      if (isCodeActivity(activity)) return `💻・Code avec **${escapeDiscordMarkdown(codeAppName(activity))}**`;
      if (isMinecraftActivity(activity)) return `⛏️・Minecraft${activity.assets?.smallText ? ` via **${escapeDiscordMarkdown(activity.assets.smallText)}**` : ''}`;
      if (activity.type === ActivityType.Playing) return `${activityIcon(activity)}・Joue a **${name}**`;
      if (activity.type === ActivityType.Streaming) return `${activityIcon(activity)}・En live sur **${name}**`;
      if (activity.type === ActivityType.Listening) return `${activityIcon(activity)}・Ecoute **${name}**`;
      if (activity.type === ActivityType.Watching) return `${activityIcon(activity)}・Regarde **${name}**`;
      if (activity.type === ActivityType.Competing) return `${activityIcon(activity)}・Competition sur **${name}**`;
      return `${activityIcon(activity)}・Activite: **${name}**`;
    };
    const activityLabels = activity => {
      if (isCodeActivity(activity)) {
        return {
          details: 'Projet / diagnostics',
          state: 'Fichier / position',
          large: 'Langage',
          small: 'Editeur',
          elapsed: 'Session de code',
          since: 'Code depuis',
          link: 'Ouvrir',
        };
      }
      if (isMinecraftActivity(activity)) {
        return {
          details: 'Mode',
          state: 'Etat',
          large: 'Monde / version',
          small: 'Launcher',
          elapsed: 'Session Minecraft',
          since: 'Joue depuis',
          link: 'Ouvrir',
        };
      }
      if (activity.type === ActivityType.Playing) {
        return {
          details: 'Partie',
          state: 'Etat de jeu',
          large: 'Jeu',
          small: 'Statut',
          elapsed: 'Session',
          since: 'Joue depuis',
          link: 'Ouvrir le jeu',
        };
      }
      if (activity.type === ActivityType.Streaming) {
        return {
          details: 'Titre du live',
          state: 'Categorie',
          large: 'Plateforme',
          small: 'Info live',
          elapsed: 'Live',
          since: 'En live depuis',
          link: 'Regarder',
        };
      }
      if (activity.type === ActivityType.Listening) {
        return {
          details: 'Titre',
          state: 'Artiste',
          large: 'Album',
          small: 'Source',
          elapsed: 'Lecture',
          since: 'Ecoute depuis',
          link: 'Ouvrir',
        };
      }
      if (activity.type === ActivityType.Watching) {
        return {
          details: 'Contenu',
          state: 'Chaine / plateforme',
          large: 'Programme',
          small: 'Info',
          elapsed: 'Visionnage',
          since: 'Regarde depuis',
          link: 'Ouvrir',
        };
      }
      if (activity.type === ActivityType.Competing) {
        return {
          details: 'Competition',
          state: 'Mode',
          large: 'Competition',
          small: 'Classement',
          elapsed: 'Match',
          since: 'En cours depuis',
          link: 'Voir',
        };
      }
      return {
        details: 'Detail',
        state: 'Etat',
        large: 'Image principale',
        small: 'Petite image',
        elapsed: 'Temps',
        since: 'Depuis',
        link: 'Ouvrir',
      };
    };
    return activities.slice(0, 6).map((activity, index) => {
      if (activity.name === 'Spotify' || activity.syncId) {
        const elapsed = activity.timestamps?.start ? Date.now() - activity.timestamps.start.getTime() : 0;
        const total = activity.timestamps?.start && activity.timestamps?.end
          ? activity.timestamps.end.getTime() - activity.timestamps.start.getTime()
          : 0;
        const cover = assetUrl(activity, 'largeImage');
        const lines = [];
        if (activity.details) lines.push(`   🎵・Titre: **${escapeDiscordMarkdown(activity.details)}**`);
        if (activity.state) lines.push(`   🎤・Artiste: **${escapeDiscordMarkdown(activity.state)}**`);
        if (activity.assets?.largeText) lines.push(`   💿・Album: **${escapeDiscordMarkdown(activity.assets.largeText)}**`);
        if (total > 0) {
          lines.push(`   ⏱️・Lecture: **${formatTime(elapsed)} / ${formatTime(total)}**`);
          lines.push(`   ${progressBar(elapsed, total)} **${Math.round(Math.max(0, Math.min(1, elapsed / total)) * 100)}%**`);
        } else if (activity.timestamps?.start) {
          lines.push(`   ⏱️・Depuis: <t:${Math.floor(activity.timestamps.start.getTime() / 1000)}:R>`);
        }
        if (activity.syncId) lines.push(`   🔗・Musique: https://open.spotify.com/track/${activity.syncId}`);
        if (cover) lines.push(`   🖼️・Pochette: ${cover}`);
        return `**${index + 1}.** <:Spotify:1508052989645033612> **Spotify**\n${lines.join('\n')}`;
      }
      const labels = activityLabels(activity);
      const title = activityText(activity);
      const details = [];
      const server = isMinecraftActivity(activity) ? minecraftServer(activity) : '';
      const pseudo = isMinecraftActivity(activity) ? minecraftPseudo(activity) : '';
      if (activity.details) details.push(`🎯・${labels.details}: **${escapeDiscordMarkdown(activity.details)}**`);
      if (server) details.push(`🌐・${isMinecraftActivity(activity) ? 'Serveur / URL' : 'Serveur'}: **${escapeDiscordMarkdown(server)}**`);
      if (pseudo) details.push(`👤・Pseudo: **${escapeDiscordMarkdown(pseudo)}**`);
      if (activity.state && activity.type !== ActivityType.Custom && activity.state !== server && activity.state !== pseudo) details.push(`📝・${labels.state}: **${escapeDiscordMarkdown(activity.state)}**`);
      if (activity.assets?.largeText) details.push(`🖼️・${labels.large}: **${escapeDiscordMarkdown(activity.assets.largeText)}**`);
      if (activity.assets?.smallText) details.push(`🔎・${labels.small}: **${escapeDiscordMarkdown(activity.assets.smallText)}**`);
      if (activity.timestamps?.start && activity.timestamps?.end) {
        const elapsed = Date.now() - activity.timestamps.start.getTime();
        const total = activity.timestamps.end.getTime() - activity.timestamps.start.getTime();
        details.push(`⏱️・${labels.elapsed}: **${formatTime(elapsed)} / ${formatTime(total)}**`);
      } else if (activity.timestamps?.start) {
        details.push(`⏱️・${labels.since}: <t:${Math.floor(activity.timestamps.start.getTime() / 1000)}:R>`);
      }
      if (activity.url) details.push(`🔗・${labels.link}: ${activity.url}`);
      else if (activity.syncId && activity.name === 'Spotify') details.push(`🔗・Spotify: https://open.spotify.com/track/${activity.syncId}`);
      if (Array.isArray(activity.buttons) && activity.buttons.length) {
        details.push(`🔘・Boutons RPC: **${activity.buttons.map(button => escapeDiscordMarkdown(button)).join('** | **')}**`);
      }
      const largeUrl = assetUrl(activity, 'largeImage');
      const smallUrl = assetUrl(activity, 'smallImage');
      if (largeUrl) details.push(`🖼️・Image: ${largeUrl}`);
      if (smallUrl) details.push(`🔎・Miniature: ${smallUrl}`);
      return `**${index + 1}.** ${title}${details.length ? `\n${details.map(line => `   ${line}`).join('\n')}` : ''}`;
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
    const guild = interaction.guild
      || (interaction.guildId ? await bot.guilds.fetch(interaction.guildId).catch(() => null) : null)
      || (ctx.DISCORD_GUILD ? await bot.guilds.fetch(ctx.DISCORD_GUILD).catch(() => null) : null);
    const user = interaction.options.getUser('utilisateur', false) || interaction.user;
    let member = guild ? await guild.members.fetch({ user: user.id, force: true }).catch(() => null) : null;
    const hasMemberContext = Boolean(member);
    const memberContextWarning = !guild
      ? '⚠️・Infos serveur limitees: serveur indisponible pour cette interaction.'
      : !hasMemberContext
        ? "⚠️・Infos serveur limitees: le bot n'est pas membre de ce serveur ou ne peut pas lire ce membre."
        : '';
    if (!member) {
      member = {
        id: user.id,
        displayName: 'Indisponible',
        joinedTimestamp: 0,
        presence: null,
        displayHexColor: '#85ebff',
        roles: null,
        permissions: null,
        premiumSinceTimestamp: null,
        communicationDisabledUntilTimestamp: null,
      };
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
    const clientStatus = member?.presence?.clientStatus || {};
    const clientText = compactList([
      clientStatus.desktop ? 'Ordinateur' : '',
      clientStatus.mobile ? 'Mobile' : '',
      clientStatus.web ? 'Navigateur web' : '',
    ]);
    const roles = member?.roles?.cache
      ? member.roles.cache
      .filter(role => role.id !== guild?.id)
      .sort((a, b) => b.position - a.position)
      .map(role => role.toString())
      : [];
    const highestRole = member?.roles?.highest && member.roles.highest.id !== guild?.id ? member.roles.highest.toString() : 'Aucun';
    const rolesText = roles.length
      ? roles.length > 8 ? `${roles.slice(0, 8).join(', ')} et **${roles.length - 8}** autre(s)` : roles.join(', ')
      : 'Aucun role';
    const boostText = member?.premiumSinceTimestamp ? `Oui, depuis <t:${Math.floor(member.premiumSinceTimestamp / 1000)}:F>` : hasMemberContext ? 'Non' : 'Indisponible';
    const ownerText = guild?.ownerId === member?.id ? 'Oui' : hasMemberContext ? 'Non' : 'Indisponible';
    const timeoutText = member?.communicationDisabledUntilTimestamp && member.communicationDisabledUntilTimestamp > Date.now()
      ? `Oui, jusqu'a ${formatDiscordTimestamp(member.communicationDisabledUntilTimestamp)}`
      : hasMemberContext ? 'Non' : 'Indisponible';
    const permissionLabels = {
      Administrator: 'Administrateur',
      ManageGuild: 'Gerer le serveur',
      ManageRoles: 'Gerer les roles',
      ManageChannels: 'Gerer les salons',
      BanMembers: 'Bannir des membres',
      KickMembers: 'Expulser des membres',
      ManageMessages: 'Gerer les messages',
      ManageWebhooks: 'Gerer les webhooks',
    };
    const strongPerms = hasMemberContext
      ? Object.keys(permissionLabels).filter(perm => member.permissions?.has?.(perm)).map(perm => `\`${permissionLabels[perm]}\``)
      : [];
    const rank = linked ? rankOf(linked.elo) : null;
    const linkedTotal = linked ? totalGames(linked) : 0;
    const linkedLastSeen = linked?.last_seen ? formatDiscordTimestamp(Number(linked.last_seen), 'R') : 'Inconnu';
    const crystalText = linked && Number(linked.is_crystal || 0) === 1
      ? `Actif${linked.crystal_expires_at ? ` jusqu'a ${formatDiscordTimestamp(Number(linked.crystal_expires_at))}` : ''}`
      : 'Non';
    const linkedCrystals = linked ? Number(linked.bot_crystals || 0) : 0;
    const linkedCosmetics = linked
      ? [
          linked.pseudo_font ? `Police ${code(linked.pseudo_font)}` : 'Police defaut',
          linked.pseudo_color_secondary ? 'Pseudo degrade' : linked.pseudo_color ? 'Pseudo couleur' : 'Pseudo defaut',
          linked.elo_curve_rgb ? 'Courbe RGB' : linked.elo_curve_color ? 'Courbe couleur' : 'Courbe defaut',
          linked.avatar_decoration ? 'Decoration avatar' : null,
        ].filter(Boolean).join(' | ')
      : '';
    const linkedBotInfo = linked && Number(linked.is_bot || 0) === 1
      ? `\n🤖・Bot API: **Oui** | ID proprietaire: ${linked.bot_owner_id ? code(linked.bot_owner_id) : '`AUCUN`'} | Suspendu: **${Number(linked.bot_enabled || 0) === 1 ? 'Non' : 'Oui'}**`
      : '';
    const spotifyButtons = spotifyActivityButtons(member);
    const sections = [
      memberContextWarning ? [
        '### ⚠️ Contexte serveur',
        memberContextWarning,
        '🧩・Les roles, permissions et presences demandent que le bot soit present sur ce serveur.',
      ] : null,
      [
        '### 👤 Identite Discord',
        `🔖・Mention: ${user}`,
        `👤・Nom affiche: **${escapeDiscordMarkdown(fullUser.displayName || fullUser.username)}**`,
        `🏷️・Nom utilisateur: **${escapeDiscordMarkdown(fullUser.username)}**${fullUser.globalName ? ` | Nom global: **${escapeDiscordMarkdown(fullUser.globalName)}**` : ''}`,
        `🆔・ID Discord: ${code(fullUser.id)}`,
        `📅・Compte cree: ${formatDiscordTimestamp(fullUser.createdTimestamp)} (${formatAgeDays(fullUser.createdTimestamp)})`,
        `🤖・Bot: **${fullUser.bot ? 'Oui' : 'Non'}** | Compte systeme: **${fullUser.system ? 'Oui' : 'Non'}**`,
      ],
      [
        '### 🏠 Serveur',
        `🪪・Pseudo serveur: **${escapeDiscordMarkdown(member.displayName || fullUser.displayName || fullUser.username)}**`,
        `📥・Arrivee: ${formatDiscordTimestamp(member.joinedTimestamp)} (${formatAgeDays(member.joinedTimestamp)})`,
        `👑・Proprietaire du serveur: **${ownerText}**`,
        `🚀・Boost serveur: **${boostText}**`,
        `🔇・Exclusion temporaire: **${timeoutText}**`,
        `🎚️・Role le plus haut: ${highestRole}`,
        `🎭・Roles (${roles.length}): ${rolesText}`,
        `🧱・Permissions importantes: ${strongPerms.length ? strongPerms.join(' | ') : '`AUCUNE`'}`,
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
              `💰・Economie: **${fmt(linked.coins)} coins** | **${fmt(linked.gems)} gemmes** | **${fmt(linkedCrystals)} cristaux**`,
              `🎨・Cosmetiques: ${linkedCosmetics || 'Aucun style actif'}`,
              `🟢・Derniere presence site: **${linkedLastSeen}**`,
              `🌐・Lien utile: ${api}/profil?id=${linked.id}`,
              linkedBotInfo.trim(),
            ].filter(Boolean).join('\n')
          : `🔗・Compte lie: **Non**\n🌐・Lien utile: ${api}/profil\n🆔・ID Discord: ${code(user.id)}`,
      ],
      [
        '### 🎨 Medias',
        `🖼️・Avatar Discord: **${avatar ? 'Disponible' : 'Non'}**`,
        `🌌・Banniere Discord: **${banner ? 'Disponible' : 'Aucune'}**`,
        `✨・Decoration avatar: **${decoration ? 'Disponible' : 'Aucune'}**`,
      ],
    ];
    if (spotifyButtons.length) {
      const activityIndex = sections.findIndex(section =>
        Array.isArray(section) && section.some(line => String(line || '').includes('Activite'))
      );
      sections.splice(activityIndex >= 0 ? activityIndex + 1 : sections.length, 0, {
        content: '',
        rows: [rowButtons(spotifyButtons)],
      });
    }
    const buttons = [linkButton('Avatar', avatar, '👤')];
    if (banner) buttons.push(linkButton('Banniere', banner, '🖼️'));
    if (decoration) buttons.push(linkButton('Decoration', decoration, '✨'));
    if (linked) buttons.push(linkButton('Profil P4', playerUrl(linked), '🎮'));
    buttons.push(linkButton('Serveur', api, '🔗'));
    return containerMessage({
      color: Number.parseInt(String(member.displayHexColor || '#85ebff').replace('#', ''), 16) || 0x85ebff,
      title: `📌 UI Discord - ${escapeDiscordMarkdown(fullUser.displayName || fullUser.username)}`,
      subtitle: 'Fiche traduite en francais : Discord, serveur, activite, medias et liaison Puissance 4.',
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

  function latestGames(playerId, requestedVariant = 'classic') {
    const variant = normalizeVariant(requestedVariant);
    return ctx.db.prepare(`
      WITH recent AS (
        SELECT games.id AS game_id FROM games WHERE games.status='finished' AND games.player1_id=? AND COALESCE(games.variant,'classic')=?
        UNION
        SELECT games.id AS game_id FROM games WHERE games.status='finished' AND games.player2_id=? AND COALESCE(games.variant,'classic')=?
        ORDER BY game_id DESC
        LIMIT 25
      )
      SELECT games.id AS id,
             games.player1_id AS player1_id,
             games.player2_id AS player2_id,
             games.winner_id AS winner_id,
             games.move_count AS move_count,
             games.duration AS duration,
             COALESCE(games.variant,'classic') AS variant,
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
    `).all(playerId, variant, playerId, variant);
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
          .setDescription(`${variantLabel(game.variant)} / #${game.id} / ${game.move_count || 0} coups / ${game.duration || 0}s`.slice(0, 100))
          .setValue(`game:${game.id}`)
          .setEmoji(emojiMap[result]);
      }));
    return [new ActionRowBuilder().addComponents(menu)];
  }

  function premiumSummary(player) {
    const crystal = Number(player?.is_crystal || 0) === 1
      ? `Crystal actif${player.crystal_expires_at ? ` jusqu'a ${formatDiscordTimestamp(Number(player.crystal_expires_at), 'd')}` : ''}`
      : 'Crystal non';
    const tier = Number(player?.is_perso || 0) === 1
      ? 'Perso'
      : Number(player?.is_vip_plus || 0) === 1
        ? 'VIP+'
        : Number(player?.is_vip || 0) === 1
          ? 'VIP'
          : 'Aucun';
    return `Pack: **${tier}** | ${crystal}`;
  }

  function profileCosmeticsSummary(player) {
    return [
      `Police: ${player.pseudo_font ? code(player.pseudo_font) : '`defaut`'}`,
      `Pseudo: ${player.pseudo_color_secondary ? 'degrade' : player.pseudo_color ? 'couleur' : 'defaut'}`,
      `Badge perso: ${player.custom_role_text ? `**${escapeDiscordMarkdown(player.custom_role_text)}**` : 'aucun'}`,
      `Courbe ELO: ${player.elo_curve_rgb ? '**RGB Perso**' : player.elo_curve_color ? 'couleur' : 'defaut'}`,
      `Decoration avatar: **${player.avatar_decoration ? 'Oui' : 'Non'}**`,
      `Banniere profil: **${player.profile_banner ? 'Oui' : 'Non'}**`,
    ].join(' | ');
  }

  function profileBotSummary(player) {
    if (Number(player?.is_bot || 0) !== 1) return '';
    const runtime = typeof ctx.publicBotRuntime === 'function'
      ? ctx.publicBotRuntime(player.id)
      : { online: false, status: 'offline', lastSeen: 0 };
    const owner = player.bot_owner_id ? code(player.bot_owner_id) : '`NONE`';
    const online = runtime.online ? 'En ligne' : 'Hors ligne';
    const suspended = Number(player.bot_enabled || 0) === 1 ? 'Non' : 'Oui';
    return `### 🤖 Bot API\nOwner ID: ${owner} | Etat: **${online}** | Suspendu: **${suspended}**\nCristaux owner: **${fmt(player.bot_crystals || 0)}** | Dernier ping: **${player.bot_last_seen ? formatDiscordTimestamp(Number(player.bot_last_seen), 'R') : 'Jamais'}**`;
  }

  function profilePayload(player, requestedVariant = 'classic') {
    const selectedStats = playerVariantStats(player, requestedVariant);
    const statPlayer = { ...player, ...selectedStats };
    const rank = rankOf(selectedStats.elo);
    const rankIcon = rankEmoji(rank);
    const games = latestGames(player.id, selectedStats.variant);
    const follows = ctx.db.prepare(
      'SELECT (SELECT COUNT(*) FROM follows WHERE follower_id=?) AS following, (SELECT COUNT(*) FROM follows WHERE following_id=?) AS followers'
    ).get(player.id, player.id);
    const last = games[0];
    const lastLine = last
      ? `Derniere partie: ${code(`#${last.id}`)} / ${last.move_count || 0} coups / ${last.duration || 0}s`
      : 'Derniere partie: aucune partie recente';
    const linkedLine = player.discord_id
      ? `Discord: ${code(player.discord_id)} | ID joueur: ${code(player.id)}`
      : `Discord: **Non lie** | ID joueur: ${code(player.id)}`;
    const economyLine = `Coins: **${fmt(player.coins || 0)}** | Gemmes: **${fmt(player.gems || 0)}** | Cristaux: **${fmt(player.bot_crystals || 0)}**`;
    const referralLine = player.referral_slug
      ? `Parrainage: ${api}/?ref=${encodeURIComponent(player.referral_slug)}`
      : `Parrainage: ${api}/?ref=${encodeURIComponent(player.id)}`;
    return containerMessage({
      color: parseInt(String(player.color || '#ff2d55').replace('#', ''), 16) || 0xff2d55,
      title: `${rankIcon ? `${rankIcon} ` : ''}${player.pseudo} - ${fmt(selectedStats.elo)} ELO`,
      subtitle: `${variantLabel(selectedStats.variant)} | Rang: ${rankIcon ? `${rankIcon} ` : ''}**${rank.label}** | Badges: ${roleBadges(player)}`,
      sections: [
        `### 📊 Statistiques · ${variantLabel(selectedStats.variant)}\nVictoires: **${selectedStats.wins}** | Defaites: **${selectedStats.losses}** | Nuls: **${selectedStats.draws}**\nParties: **${totalGames(statPlayer)}** | Winrate: **${winRate(statPlayer)}** | Precision globale: **${playerAccuracy(player.id)}**`,
        `### 👤 Profil\n${linkedLine}\n${premiumSummary(player)}\n${economyLine}\nDerniere presence site: **${player.last_seen ? formatDiscordTimestamp(Number(player.last_seen), 'R') : 'Inconnue'}**`,
        `### 🎨 Cosmetiques\n${profileCosmeticsSummary(player)}`,
        `### 🔗 Social\nSuivis: **${follows?.following || 0}** | Abonnes: **${follows?.followers || 0}**\n${referralLine}\n${lastLine}`,
        profileBotSummary(player),
      ],
      buttons: [
        linkButton('Voir profil', playerUrl(player), '👤'),
        linkButton('Boutique', `${api}/boutique`, '🛒'),
        linkButton('Live', `${api}/live`, '🔴'),
      ],
      rows: profileRows(player, games),
    });
  }

  function profileVariantRow(player, selected) {
    return new ActionRowBuilder().addComponents(new StringSelectMenuBuilder()
      .setCustomId(`p4_profile_variant:${player.id}`).setPlaceholder(`Variante : ${variantLabel(selected)}`)
      .addOptions(publicVariants().map(v => new StringSelectMenuOptionBuilder().setLabel(v.label).setValue(v.id).setDefault(v.id === selected))));
  }

  async function profileCanvasPayload(player, requestedVariant = 'classic') {
    const stats = playerVariantStats(player, requestedVariant);
    const games = latestGames(player.id, stats.variant);
    let createCanvas;
    let loadImage;

    try {
      ({ createCanvas, loadImage } = require('canvas'));
    } catch (error) {
      console.warn('[BOT PROFIL CANVAS]', error.message);
      return profilePayload(player, requestedVariant);
    }

    const width = 1200;
    const height = 560;
    const canvas = createCanvas(width, height);
    const c = canvas.getContext('2d');
    const accent = /^#[0-9a-f]{6}$/i.test(String(player.color || ''))
      ? String(player.color)
      : '#ff2d55';

    const loadProfileImage = async (value, fallback = '') => {
      try {
        const source = String(value || fallback);
        if (!source) return null;
        const resolved = source.startsWith('/')
          ? path.join(__dirname, 'public', source.slice(1))
          : source;
        return await loadImage(resolved);
      } catch (_) {
        return null;
      }
    };

    const drawCover = (image, x, y, targetWidth, targetHeight) => {
      const imageWidth = Number(image?.width || image?.naturalWidth || 0);
      const imageHeight = Number(image?.height || image?.naturalHeight || 0);
      if (!imageWidth || !imageHeight) return;
      const scale = Math.max(targetWidth / imageWidth, targetHeight / imageHeight);
      const sourceWidth = targetWidth / scale;
      const sourceHeight = targetHeight / scale;
      const sourceX = Math.max(0, (imageWidth - sourceWidth) / 2);
      const sourceY = Math.max(0, (imageHeight - sourceHeight) / 2);
      c.drawImage(
        image,
        sourceX,
        sourceY,
        sourceWidth,
        sourceHeight,
        x,
        y,
        targetWidth,
        targetHeight
      );
    };

    const wallpaper = await loadProfileImage(
      player.profile_wallpaper_desktop || player.profile_wallpaper_mobile,
      '/assets/profile-wallpaper.jpg'
    );

    if (wallpaper) {
      drawCover(wallpaper, 0, 0, width, height);
    } else {
      const fallback = c.createLinearGradient(0, 0, width, height);
      fallback.addColorStop(0, '#090b1e');
      fallback.addColorStop(0.55, accent);
      fallback.addColorStop(1, '#170822');
      c.fillStyle = fallback;
      c.fillRect(0, 0, width, height);
    }

    const shade = c.createLinearGradient(0, 0, width, 0);
    shade.addColorStop(0, 'rgba(3,5,16,.92)');
    shade.addColorStop(0.48, 'rgba(3,5,16,.66)');
    shade.addColorStop(1, 'rgba(3,5,16,.32)');
    c.fillStyle = shade;
    c.fillRect(0, 0, width, height);

    const glow = c.createRadialGradient(930, 100, 20, 930, 100, 500);
    glow.addColorStop(0, `${accent}88`);
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = glow;
    c.fillRect(0, 0, width, height);

    c.fillStyle = 'rgba(7,9,24,.70)';
    c.beginPath();
    c.roundRect(34, 34, width - 68, height - 68, 34);
    c.fill();
    c.strokeStyle = 'rgba(255,255,255,.16)';
    c.lineWidth = 2;
    c.stroke();

    c.fillStyle = accent;
    c.beginPath();
    c.roundRect(34, 34, 9, height - 68, 5);
    c.fill();

    const avatar = await loadProfileImage(player.avatar, '/assets/site-logo-small.png');
    c.save();
    c.shadowColor = accent;
    c.shadowBlur = 32;
    c.fillStyle = accent;
    c.beginPath();
    c.arc(180, 180, 103, 0, Math.PI * 2);
    c.fill();
    c.restore();

    c.save();
    c.beginPath();
    c.arc(180, 180, 94, 0, Math.PI * 2);
    c.clip();
    if (avatar) drawCover(avatar, 86, 86, 188, 188);
    c.restore();

    c.strokeStyle = '#ffffff';
    c.lineWidth = 5;
    c.beginPath();
    c.arc(180, 180, 98, 0, Math.PI * 2);
    c.stroke();

    const decoration = await loadProfileImage(player.avatar_decoration);
    if (decoration) c.drawImage(decoration, 61, 61, 238, 238);

    c.fillStyle = '#ffffff';
    c.font = '700 56px "Barlow Condensed", sans-serif';
    c.fillText(String(player.pseudo || 'Joueur').slice(0, 24), 330, 118);

    c.fillStyle = accent;
    c.font = '700 21px "Barlow Condensed", sans-serif';
    c.fillText(String(roleBadges(player).replace(/\*/g, '') || 'JOUEUR').slice(0, 50), 333, 153);

    c.fillStyle = '#d1d6e5';
    c.font = '500 19px Barlow, sans-serif';
    c.fillText(
      `${variantLabel(stats.variant)}  •  ${fmt(stats.elo)} ELO  •  ID #${player.id}`,
      333,
      188
    );

    const lastSeen = player.last_seen
      ? new Date(Number(player.last_seen)).toLocaleString('fr-FR', {
          day: '2-digit',
          month: 'short',
          hour: '2-digit',
          minute: '2-digit',
        })
      : 'inconnue';
    c.fillStyle = 'rgba(255,255,255,.62)';
    c.font = '500 16px Barlow, sans-serif';
    c.fillText(`Dernière connexion : ${lastSeen}`, 333, 218);

    const total = Number(stats.wins || 0) + Number(stats.losses || 0) + Number(stats.draws || 0);
    const winrate = total ? Math.round((Number(stats.wins || 0) / total) * 100) : 0;
    const values = [
      ['ELO', fmt(stats.elo), accent],
      ['VICTOIRES', fmt(stats.wins), '#54e38e'],
      ['DÉFAITES', fmt(stats.losses), '#ff6174'],
      ['NULS', fmt(stats.draws), '#aeb5ca'],
      ['WINRATE', `${winrate}%`, '#ffd65a'],
    ];

    values.forEach(([label, value, color], index) => {
      const cardWidth = 157;
      const gap = 14;
      const x = 330 + index * (cardWidth + gap);
      const y = 260;

      c.fillStyle = 'rgba(255,255,255,.075)';
      c.beginPath();
      c.roundRect(x, y, cardWidth, 112, 20);
      c.fill();
      c.strokeStyle = 'rgba(255,255,255,.11)';
      c.lineWidth = 1;
      c.stroke();

      c.fillStyle = color;
      c.beginPath();
      c.roundRect(x + 14, y + 14, 28, 5, 3);
      c.fill();
      c.font = '700 15px "Barlow Condensed", sans-serif';
      c.fillText(label, x + 14, y + 45);
      c.fillStyle = '#ffffff';
      c.font = '700 34px "Barlow Condensed", sans-serif';
      c.fillText(String(value), x + 14, y + 86);
    });

    c.fillStyle = 'rgba(255,255,255,.075)';
    c.beginPath();
    c.roundRect(330, 398, 841, 102, 20);
    c.fill();

    c.fillStyle = '#ffffff';
    c.font = '700 17px "Barlow Condensed", sans-serif';
    c.fillText('ÉCONOMIE', 352, 427);
    c.fillStyle = '#ffd65a';
    c.font = '700 28px "Barlow Condensed", sans-serif';
    c.fillText(`${fmt(player.coins || 0)} COINS`, 352, 469);
    c.fillStyle = '#85ebff';
    c.fillText(`${fmt(player.gems || 0)} GEMMES`, 560, 469);
    c.fillStyle = '#65ef9b';
    c.fillText(`${fmt(player.bot_crystals || 0)} CRISTAUX`, 780, 469);

    c.textAlign = 'right';
    c.fillStyle = 'rgba(255,255,255,.55)';
    c.font = '600 15px Barlow, sans-serif';
    c.fillText('PUISSANCE 4 • PROFIL OFFICIEL', 1145, 522);
    c.textAlign = 'left';

    const file = new AttachmentBuilder(canvas.toBuffer('image/png'), {
      name: `profil-${player.id}.png`,
    });
    return containerMessage({
      color: parseInt(accent.replace('#', ''), 16) || 0xff2d55,
      title: player.pseudo,
      subtitle: `${variantLabel(stats.variant)} · ${fmt(stats.elo)} ELO`,
      media: [{
        url: `attachment://profil-${player.id}.png`,
        description: `Carte du profil de ${player.pseudo}`,
      }],
      sections: [
        `Dernière connexion : ${player.last_seen ? formatDiscordTimestamp(Number(player.last_seen), 'R') : '**inconnue**'}`,
        profileBotSummary(player),
      ],
      buttons: [
        linkButton('Voir profil', playerUrl(player), '👤'),
        linkButton('Personnaliser', `${api}/profil`, '🎨'),
      ],
      rows: [profileVariantRow(player, stats.variant), ...profileRows(player, games)],
      files: [file],
    });
  }

  function variantsPayload() {
    return containerMessage({color:0x85ebff,title:'Règles des variantes',subtitle:'Chaque variante possède son propre classement.',sections:['### Classique\nAligne quatre jetons.','### Plateau rotatif\nLa grille tourne tous les quatre coups, puis la gravité agit.','### Anti-Puissance 4\nÉvite les lignes ; un alignement disponible devient obligatoire et le plus petit score gagne. Une égalité est départagée par les lignes de 3, puis de 2.','### Puissance Bombe\nUne bombe par joueur retire les voisins d’un jeton.','### Mission personnelle\nAccomplis ton objectif secret avant l’adversaire.','### Placement simultané\nLes deux choix sont révélés ensemble et l’initiative alterne.','### Brouillard de Guerre\nChaque pion n’est visible que 1,25 seconde avant de disparaître dans la brume. Mémorise la grille.','### Conquête\nUn alignement capturé rapporte un point puis disparaît. Après quatre captures : 3–0 ou 3–1 gagne, 2–2 donne un nul. Une grille pleine repart à zéro avec les scores conservés.','### Puissance 4 Navale\nRévèle les cases d’une grille cachée et découvre son unique ligne de quatre.','### p4-Tetris\nOriente des figures de pions ronds et forme un maximum de lignes de quatre en 3 minutes. Les lignes disparaissent, le score reste et une grille pleine est remise à zéro.'],buttons:[linkButton('Règles complètes',`${api}/regles`,'📖')]});
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
    const queueDetails = publicVariants().map(variant => {
      const count = (ctx.mm?.queue || ctx.mm?.q || []).filter(player => normalizeVariant(player?.variant) === variant.id).length;
      return count ? `${variant.label}: **${count}**` : null;
    }).filter(Boolean).join(' | ');
    const status = typeof ctx.readSystemStatus === 'function' ? ctx.readSystemStatus() : null;
    return containerMessage({
      color: status?.restarting ? 0xff9f0a : 0x30d158,
      title: status?.restarting ? 'Maintenance signalee' : 'Systeme operationnel',
      subtitle: status?.message || 'Aucune alerte serveur active.',
      sections: [
        `### Temps reel\nPresents: **${presence.totalPresent || 0}** | Visiteurs: **${presence.visitors || 0}**\nFile: **${queueCount}** | Parties actives: **${activeGames}**${queueDetails ? `\n${queueDetails}` : ''}`,
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
      return `${code(`#${game.id || '?'}`)} **${p1.pseudo}** vs **${p2.pseudo}** | **${variantLabel(game.variant)}** | tour: **${current}** | coups: **${game.moveCount || game.moves?.length || 0}**`;
    }).filter(Boolean);
    return containerMessage({
      color: 0xff2d55,
      title: `${active.length} partie${active.length > 1 ? 's' : ''} en direct`,
      subtitle: active.length ? 'Spectateur live disponible.' : 'Aucune partie active pour le moment.',
      sections: [lines.join('\n') || 'Le live est calme. La prochaine partie apparaitra ici.'],
      buttons: [linkButton('Voir le live', `${api}/live`, '🔴')],
    });
  }

  function leaderboardPayload(type = 'humans', requestedVariant = 'classic') {
    const bots = type === 'bots';
    const variant = normalizeVariant(requestedVariant);
    const rows = variant === 'classic'
      ? ctx.db.prepare(`SELECT * FROM players WHERE deleted=0 AND is_guest=0 AND is_bot=? ORDER BY elo DESC, wins DESC LIMIT 10`).all(bots ? 1 : 0)
      : ctx.db.prepare(`
          SELECT p.*, s.elo AS elo, s.wins AS wins, s.losses AS losses, s.draws AS draws
          FROM player_variant_stats s JOIN players p ON p.id=s.player_id
          WHERE s.variant=? AND p.deleted=0 AND p.is_guest=0 AND p.is_bot=?
          ORDER BY s.elo DESC, s.wins DESC LIMIT 10
        `).all(variant, bots ? 1 : 0);
    const medals = ['🥇', '🥈', '🥉'];
    const lines = rows.map((p, i) => {
      const rank = rankOf(p.elo);
      return `${medals[i] || `#${i + 1}`} **${p.pseudo}** - ${fmt(p.elo)} ELO - ${rank.label} - ${p.wins || 0}V/${p.losses || 0}D`;
    });
    return containerMessage({
      color: bots ? 0x85ebff : 0xffd60a,
      title: bots ? 'Classement des bots' : 'Classement des membres',
      subtitle: `Top 10 officiel · ${variantLabel(variant)}`,
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
    const config = variantMeta(game.variant);
    const rows = Number(config.rows || 6);
    const cols = Number(config.cols || 7);
    const board = Array.from({ length: rows }, () => Array(cols).fill(0));
    for (const [index, move] of moves.entries()) {
      const col = Number(move.col);
      if (!Number.isInteger(col) || col < 0 || col >= cols) continue;
      let row = Number(move.row);
      const playerId = Number(move.player_id);
      const side = playerId === Number(game.player1_id) ? 1 : playerId === Number(game.player2_id) ? 2 : (index % 2) + 1;
      if (!Number.isInteger(row) || row < 0 || row >= rows || board[row][col] !== 0) {
        row = -1;
        for (let r = rows - 1; r >= 0; r--) {
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
    const config = variantMeta(game.variant);
    const numberEmojis = ['1️⃣','2️⃣','3️⃣','4️⃣','5️⃣','6️⃣','7️⃣','8️⃣','9️⃣'];
    const grid = board
      .map(row => row.map(cell => (cell === 1 ? p1Emoji : cell === 2 ? p2Emoji : emptyEmoji)).join(''))
      .join('\n');
    return [
      `### Plateau · ${config.label} (${config.rows}×${config.cols})`,
      `${p1Emoji} **${game.p1_pseudo}**  vs  ${p2Emoji} **${game.p2_pseudo}**`,
      grid,
      numberEmojis.slice(0, config.cols).join(''),
      game.variant && game.variant !== 'classic' ? '_Les actions spéciales sont détaillées dans le replay du site._' : '',
    ].filter(Boolean).join('\n');
  }

  function replayPayload(id) {
    const game = ctx.gQ.getById.get(Number(id));
    if (!game) return null;
    const winner = game.winner_id == null ? 'Partie nulle' : `Victoire ${game.winner_id === game.player1_id ? game.p1_pseudo : game.p2_pseudo}`;
    return containerMessage({
      color: game.winner_id == null ? 0xffd60a : 0x30d158,
      title: `Replay #${game.id}`,
      subtitle: `${winner} · ${variantLabel(game.variant)}`,
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
        '### Site API\nProfils, classements, boutique, live, stats et endpoints admin.',
      ],
      buttons: [linkButton('Documentation API', `${api}/api-doc`, '🧪'), linkButton('Client bot JS', `${api}/downloads/p4-bot-client.js`, '🤖')],
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
        '### Systeme\n`/boutique`, `/boosts`, `/cosmetiques`, `/api`, `/bots`',
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

  function createDbResetBackup(label = 'manual') {
    const row = ctx.db.prepare('PRAGMA database_list').all().find(entry => entry.name === 'main');
    const dbPath = row?.file || '';
    if (!dbPath || !fs.existsSync(dbPath)) return null;
    try { ctx.db.pragma('wal_checkpoint(FULL)'); } catch (_) {}
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupDir = path.join(path.dirname(dbPath), 'backups');
    fs.mkdirSync(backupDir, { recursive: true });
    const safeLabel = String(label || 'manual').replace(/[^a-z0-9_-]/gi, '-').slice(0, 32);
    const backupPath = path.join(backupDir, `p4-${safeLabel}-${stamp}.db`);
    fs.copyFileSync(dbPath, backupPath);
    for (const suffix of ['-wal', '-shm']) {
      const sidecar = `${dbPath}${suffix}`;
      if (fs.existsSync(sidecar)) fs.copyFileSync(sidecar, `${backupPath}${suffix}`);
    }
    return backupPath;
  }

  function resetWallpaperRows() {
    return ctx.db.prepare(`
      UPDATE players
      SET profile_wallpaper_desktop = '',
          profile_wallpaper_mobile = '',
          profile_wallpaper_opacity = 0.48,
          profile_wallpaper_dim = 0.28
      WHERE COALESCE(profile_wallpaper_desktop, '') != ''
         OR COALESCE(profile_wallpaper_mobile, '') != ''
         OR COALESCE(profile_wallpaper_opacity, 0.48) != 0.48
         OR COALESCE(profile_wallpaper_dim, 0.28) != 0.28
    `).run().changes || 0;
  }

  function resetRuntimeSessions() {
    let changes = 0;
    for (const table of ['sessions', 'reset_codes', 'unlink_codes']) {
      try { changes += ctx.db.prepare(`DELETE FROM ${table}`).run().changes || 0; } catch (_) {}
    }
    return changes;
  }

  function resetWholeDatabase() {
    const tables = ctx.db.prepare(`
      SELECT name
      FROM sqlite_master
      WHERE type = 'table'
        AND name NOT LIKE 'sqlite_%'
        AND name NOT IN ('config')
    `).all().map(row => row.name);
    ctx.db.pragma('foreign_keys = OFF');
    let changes = 0;
    try {
      for (const table of tables) {
        changes += ctx.db.prepare(`DELETE FROM "${String(table).replace(/"/g, '""')}"`).run().changes || 0;
      }
      try { ctx.db.prepare(`DELETE FROM sqlite_sequence WHERE name NOT IN ('config')`).run(); } catch (_) {}
    } finally {
      ctx.db.pragma('foreign_keys = ON');
    }
    return { tables: tables.length, changes };
  }

  async function handleDbReset(interaction) {
    const mode = optionString(interaction, 'mode', 'wallpapers') || 'wallpapers';
    const role = await requireStaffForAdmin(interaction, 'admin');
    if (!role) return;
    if (mode === 'all' && optionString(interaction, 'confirmation', '') !== 'CONFIRMER') {
      return interaction.editReply(containerMessage({
        color: 0xff3b30,
        title: 'Confirmation requise',
        subtitle: 'Pour reset toute la DB, relance avec confirmation = CONFIRMER.',
        sections: ['Conseil: utilise `mode: wallpapers` pour supprimer seulement les fonds custom qui bloquent les profils.'],
      }));
    }
    let backupPath = null;
    try {
      backupPath = createDbResetBackup(mode);
      let subtitle = '';
      let sections = [];
      if (mode === 'wallpapers') {
        const changed = resetWallpaperRows();
        resetRuntimeSessions();
        subtitle = `${changed} profil(s) nettoye(s). Sessions reset pour forcer un refresh propre.`;
      } else if (mode === 'sessions') {
        const changed = resetRuntimeSessions();
        subtitle = `${changed} session/code(s) supprime(s).`;
      } else if (mode === 'all') {
        const result = resetWholeDatabase();
        subtitle = `DB videe: ${result.tables} table(s), ${result.changes} ligne(s) supprimee(s). Redemarre le serveur apres cette action.`;
        sections.push('Le bot officiel et les schemas seront recréés au prochain demarrage via les migrations.');
      } else {
        return replyError(interaction, 'Mode invalide', mode);
      }
      if (backupPath) sections.push(`Backup cree: \`${backupPath}\``);
      try { ctx.WH?.wlogAdminAction?.('DB reset Discord', interaction.user.tag || interaction.user.id, interaction.user.id, [['Mode', mode, true], ['Backup', backupPath || 'non', false]]); } catch (_) {}
      return interaction.editReply(containerMessage({
        color: mode === 'all' ? 0xff3b30 : 0x30d158,
        title: mode === 'all' ? 'DB reset complet effectue' : 'DB reset effectue',
        subtitle,
        sections,
      }));
    } catch (error) {
      return replyError(interaction, 'DB reset impossible', error.message || 'Erreur inconnue');
    }
  }


  async function handleAdmin(interaction) {
    const action = ADMIN_COMMAND_ACTIONS[interaction.commandName] || optionString(interaction, 'action', '');
    const pseudo = optionString(interaction, 'pseudo');
    const value = optionNumber(interaction, 'valeur');
    const reason = optionString(interaction, 'raison', '') || '';
    const resourceId = optionString(interaction, 'id');
    const itemKey = optionString(interaction, 'item');
    // Les modos disposent des memes commandes operationnelles que les admins.
    // Les sauvegardes restent liees au panel admin, qui leur est interdit.
    const adminOnly = ['backups'];
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
      ctx.pQ.setBanned.run({ banned, until: null, id: target.id });
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
    const role = await requireStaff(interaction, 'moderator');
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

  async function handleProductKey(interaction) {
    const role = await requireStaff(interaction, 'moderator');
    if (!role) return;
    const fromModal = interaction.isModalSubmit?.();
    const content = String(fromModal ? interaction.fields.getTextInputValue('content') : optionString(interaction, 'contenu') || '').trim().toLowerCase();
    const rawQuantity = Number(fromModal ? interaction.fields.getTextInputValue('quantity') || 1 : optionInteger(interaction, 'quantite', 1));
    const rawHours = Number(fromModal ? interaction.fields.getTextInputValue('hours') || 0 : optionInteger(interaction, 'heures', 0));
    if (!Number.isFinite(rawQuantity) || rawQuantity < 1 || !Number.isFinite(rawHours) || rawHours < 0) {
      return replyError(interaction, 'Valeurs invalides', 'La quantite doit etre positive et les heures doivent etre egales ou superieures a 0.');
    }
    const quantity = Math.max(1, Math.min(999, Math.trunc(rawQuantity)));
    const hours = Math.max(0, Math.min(8760, Math.trunc(rawHours)));
    const item = content === 'coins' || content === 'gems' || content === 'gemmes'
      ? null
      : resolveGiveItem(content);
    if (!item && !['coins', 'gems', 'gemmes'].includes(content)) {
      return replyError(interaction, 'Contenu invalide', 'Utilise coins, gems, un rang ou un code item boutique.');
    }
    if (item?.key === 'bot_host_1m') {
      return replyError(interaction, 'Contenu invalide', 'Le host bot demande un bot cible et ne peut pas etre mis dans une cle produit.');
    }
    const rewardKey = content === 'gemmes' ? 'gems' : item?.key || content;
    const codeValue = `P4K-${crypto.randomBytes(4).toString('hex').toUpperCase()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
    const expiresAt = hours ? Date.now() + hours * 60 * 60 * 1000 : null;
    const staff = await getLinkedStaffContext(interaction.user.id);
    ctx.db.prepare(`
      INSERT INTO product_keys (code, grants_json, created_by, created_at, expires_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(codeValue, JSON.stringify([{ key: rewardKey, qty: quantity }]), staff.player?.id || null, Date.now(), expiresAt);
    return interaction.editReply(containerMessage({
      color: 0x30d158,
      title: 'Cle produit generee',
      subtitle: `${code(codeValue)} est prete a etre utilisee dans la boutique.`,
      sections: [[
        `Contenu : **${item?.label || rewardKey}**`,
        `Quantite : **${quantity}**`,
        `Expiration : **${hours ? `${hours}h` : 'aucune'}**`,
      ]],
      buttons: [linkButton('Ouvrir la boutique', `${api}/boutique`, '🛒')],
    }));
  }

  function productKeyModal() {
    return new ModalBuilder()
      .setCustomId('p4_product_key_generate')
      .setTitle('Generer une cle produit')
      .addComponents(
        new ActionRowBuilder().addComponents(new TextInputBuilder()
          .setCustomId('content')
          .setLabel('Contenu de la cle')
          .setPlaceholder('coins, gems, vip_1m, vip_plus, perso...')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(64)),
        new ActionRowBuilder().addComponents(new TextInputBuilder()
          .setCustomId('quantity')
          .setLabel('Quantite')
          .setPlaceholder('1')
          .setValue('1')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(3)),
        new ActionRowBuilder().addComponents(new TextInputBuilder()
          .setCustomId('hours')
          .setLabel('Expiration en heures (0 = aucune)')
          .setPlaceholder('24')
          .setValue('0')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(4))
      );
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
        { text: '💾・Version 4.1.0', type: ActivityType.Watching }
      ];
      const status = statuses[Math.floor(Date.now() / 10000) % statuses.length];
      bot.user.setStatus('online')
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

  function discordEmojiAssets() {
    const emojiDir = path.join(__dirname, 'public', 'emojis');
    const assets = [
      { name: 'p4_coin', filePath: path.join(__dirname, 'public', 'assets', 'coin.png') },
      { name: 'p4_gem', filePath: path.join(__dirname, 'public', 'assets', 'gem.png') },
    ];
    if (fs.existsSync(emojiDir)) {
      for (const entry of fs.readdirSync(emojiDir, { withFileTypes: true })) {
        if (!entry.isFile() || !/\.(png|gif|webp|jpe?g)$/i.test(entry.name) || entry.name === 'preview-pack.png') continue;
        assets.push({
          name: normalizeEmojiName(path.parse(entry.name).name).slice(0, 32),
          filePath: path.join(emojiDir, entry.name),
        });
      }
    }
    return assets
      .filter(asset => asset.name && fs.existsSync(asset.filePath))
      .filter(asset => fs.statSync(asset.filePath).size <= DISCORD_EMOJI_MAX_BYTES)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async function syncGuildEmojiAssets() {
    if (!DISCORD_EMOJI_SYNC_ENABLED || emojiSyncRunning || !ctx.DISCORD_GUILD) return;
    emojiSyncRunning = true;
    try {
      const guild = await bot.guilds.fetch(ctx.DISCORD_GUILD);
      const existing = await guild.emojis.fetch();
      const existingNames = new Set(existing.map(emoji => normalizeEmojiName(emoji.name)));
      const missing = discordEmojiAssets().filter(asset => !existingNames.has(asset.name));
      if (!missing.length) {
        console.log('[BOT EMOJIS] Synchronisation deja a jour, aucun upload.');
        return;
      }
      console.log(`[BOT EMOJIS] ${missing.length} emoji(s) manquant(s), envoi espace de ${Math.round(DISCORD_EMOJI_SYNC_DELAY_MS / 1000)}s.`);
      for (let index = 0; index < missing.length; index += 1) {
        const asset = missing[index];
        try {
          const emoji = await guild.emojis.create({
            attachment: asset.filePath,
            name: asset.name,
            reason: 'Synchronisation automatique des emojis Puissance 4',
          });
          const rendered = emoji.animated ? `<a:${emoji.name}:${emoji.id}>` : `<:${emoji.name}:${emoji.id}>`;
          discordEmojiCache.set(normalizeEmojiName(emoji.name), rendered);
          console.log(`[BOT EMOJIS] ${index + 1}/${missing.length} cree : ${emoji.name}`);
        } catch (error) {
          console.warn(`[BOT EMOJIS] Synchronisation stoppee sur ${asset.name}:`, error.message);
          break;
        }
        if (index < missing.length - 1) await new Promise(resolve => setTimeout(resolve, DISCORD_EMOJI_SYNC_DELAY_MS));
      }
    } catch (error) {
      console.warn('[BOT EMOJIS] Synchronisation indisponible:', error.message);
    } finally {
      emojiSyncRunning = false;
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
    const staff = await requireDiscordStaff(interaction);
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
    const staff = await requireDiscordStaff(interaction);
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

  const ticketTypes = {
    bug: {
      label: 'Signaler un bug',
      emoji: '⚙️',
      color: 0x85ebff,
      title: 'Ticket bug',
      channel: 'bug',
      intro: 'Decris le bug, la page concernee et ce que tu faisais juste avant.',
      fields: [
        ['page', 'Page concernee', 'Ex: /game, /live, /profil...', true, TextInputStyle.Short, 3, 120],
        ['details', 'Description du bug', 'Explique le probleme avec un maximum de details.', true, TextInputStyle.Paragraph, 20, 1200],
      ],
    },
    report: {
      label: 'Report joueur',
      emoji: '🚨',
      color: 0xff2d55,
      title: 'Ticket report',
      channel: 'report',
      intro: 'Indique le joueur, le contexte et les preuves disponibles.',
      fields: [
        ['player', 'Joueur concerne', 'Pseudo ou ID du joueur', true, TextInputStyle.Short, 2, 80],
        ['reason', 'Motif du report', 'Triche, insultes, comportement...', true, TextInputStyle.Paragraph, 20, 1200],
      ],
    },
    host: {
      label: 'Aide host bot',
      emoji: '🤖',
      color: 0x30d158,
      title: 'Ticket host bot',
      channel: 'host',
      intro: 'Pour les soucis de bot API, hosting, token ou logs.',
      fields: [
        ['bot', 'Bot concerne', 'Pseudo ou ID du bot', true, TextInputStyle.Short, 1, 80],
        ['logs', 'Logs / probleme', 'Colle les logs utiles ou explique le comportement.', true, TextInputStyle.Paragraph, 10, 1400],
      ],
    },
    purchase: {
      label: 'Boutique / achat',
      emoji: '🛒',
      color: 0xffd60a,
      title: 'Ticket boutique',
      channel: 'shop',
      intro: 'Pour les achats, Cristaux, gemmes, boosters et roles.',
      fields: [
        ['item', 'Achat ou item concerne', 'Ex: Host Bot 1 mois, VIP, booster...', true, TextInputStyle.Short, 2, 100],
        ['details', 'Details de la demande', 'Explique ce qui manque ou ce qui semble incorrect.', true, TextInputStyle.Paragraph, 10, 1200],
      ],
    },
    other: {
      label: 'Autre demande',
      emoji: '❔',
      color: 0x9b7cff,
      title: 'Autre demande',
      channel: 'ticket',
      intro: 'Pour toute demande qui ne rentre pas dans une categorie precise.',
      fields: [
        ['subject', 'Sujet', 'Resume rapide de la demande', true, TextInputStyle.Short, 3, 100],
        ['details', 'Message', 'Explique ta demande.', true, TextInputStyle.Paragraph, 10, 1200],
      ],
    },
  };

  function ticketPanelPayload(guildName = 'Puissance 4') {
    const container = new ContainerBuilder()
      .setAccentColor(0xff2d55)
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(
        `## Support ${guildName}\nChoisis une categorie pour ouvrir un ticket prive avec le staff.`
      ))
      .addSeparatorComponents(new SeparatorBuilder())
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(
        [
          '**Bug**: probleme sur le site ou une page.',
          '**Report**: signalement joueur.',
          '**Host bot**: aide API, token, code ou logs.',
          '**Boutique**: achat, Cristaux, gemmes, boosters.',
          '**Autre**: demande generale.',
        ].join('\n')
      ));
    const row = new ActionRowBuilder().addComponents(
      Object.entries(ticketTypes).map(([key, type]) => new ButtonBuilder()
        .setCustomId(`p4_ticket_open:${key}`)
        .setLabel(type.label)
        .setEmoji(type.emoji)
        .setStyle(key === 'report' ? ButtonStyle.Danger : key === 'host' ? ButtonStyle.Success : ButtonStyle.Secondary))
    );
    return { flags: MessageFlags.IsComponentsV2, components: [container, row] };
  }

  function ticketModal(typeKey) {
    const type = ticketTypes[typeKey] || ticketTypes.other;
    const modal = new ModalBuilder()
      .setCustomId(`p4_ticket_modal:${typeKey}`)
      .setTitle(type.title.slice(0, 45));
    for (const [id, label, placeholder, required, style, min, max] of type.fields) {
      modal.addComponents(new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId(id)
          .setLabel(label.slice(0, 45))
          .setPlaceholder(placeholder.slice(0, 100))
          .setRequired(required)
          .setStyle(style)
          .setMinLength(min)
          .setMaxLength(max)
      ));
    }
    return modal;
  }

  function ticketTopic(userId, typeKey) {
    return `p4-ticket:${userId}:${typeKey}`;
  }

  function parseTicketTopic(channel) {
    const match = String(channel?.topic || '').match(/^p4-ticket:(\d+):([a-z0-9_-]+)/);
    return match ? { userId: match[1], typeKey: match[2] } : null;
  }

  function sanitizeTicketName(value) {
    return String(value || 'ticket')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'ticket';
  }

  function isTicketStaff(interaction) {
    if (interaction.memberPermissions?.has?.(PermissionsBitField.Flags.ManageChannels)) return true;
    return Boolean(TICKET_SUPPORT_ROLE_ID && interaction.member?.roles?.cache?.has?.(TICKET_SUPPORT_ROLE_ID));
  }

  async function findOpenTicket(guild, userId) {
    const channels = await guild.channels.fetch().catch(() => null);
    if (!channels) return null;
    return channels.find(channel =>
      channel?.type === ChannelType.GuildText &&
      String(channel.topic || '').startsWith(`p4-ticket:${userId}:`)
    ) || null;
  }

  function ticketActions(closed = false) {
    return new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(closed ? 'p4_ticket_reopen' : 'p4_ticket_close')
        .setLabel(closed ? 'Rouvrir' : 'Fermer')
        .setEmoji(closed ? '🔓' : '🔒')
        .setStyle(closed ? ButtonStyle.Success : ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId('p4_ticket_delete_panel')
        .setLabel('Supprimer')
        .setEmoji('🗑️')
        .setStyle(ButtonStyle.Danger)
    );
  }

  function deleteTranscriptChoices() {
    return new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('p4_ticket_transcript_member').setLabel('Transcript staff + membre').setEmoji('📑').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('p4_ticket_transcript_staff').setLabel('Transcript staff').setEmoji('📂').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('p4_ticket_transcript_none').setLabel('Aucun transcript').setEmoji('📤').setStyle(ButtonStyle.Danger)
    );
  }

  async function handleTicketSetup(interaction) {
    const staff = await requireDiscordStaff(interaction);
    if (!staff) return;
    await interaction.channel.send(ticketPanelPayload(interaction.guild?.name || 'Puissance 4'));
    return interaction.editReply(containerMessage({
      color: 0x30d158,
      title: 'Panneau ticket publie',
      subtitle: 'Les membres peuvent maintenant ouvrir un ticket depuis ce salon.',
    }));
  }

  async function handleTicketModal(interaction, typeKey) {
    const type = ticketTypes[typeKey] || ticketTypes.other;
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const existing = await findOpenTicket(interaction.guild, interaction.user.id);
    if (existing) {
      return interaction.editReply(containerMessage({
        color: 0xff3b30,
        title: 'Ticket deja ouvert',
        subtitle: `Tu as deja un ticket: <#${existing.id}>`,
      }));
    }
    const overwrites = [
      { id: interaction.guild.roles.everyone.id, deny: [PermissionsBitField.Flags.ViewChannel] },
      {
        id: interaction.user.id,
        allow: [
          PermissionsBitField.Flags.ViewChannel,
          PermissionsBitField.Flags.SendMessages,
          PermissionsBitField.Flags.ReadMessageHistory,
          PermissionsBitField.Flags.AttachFiles,
          PermissionsBitField.Flags.EmbedLinks,
        ],
      },
    ];
    if (TICKET_SUPPORT_ROLE_ID) {
      overwrites.push({
        id: TICKET_SUPPORT_ROLE_ID,
        allow: [
          PermissionsBitField.Flags.ViewChannel,
          PermissionsBitField.Flags.SendMessages,
          PermissionsBitField.Flags.ReadMessageHistory,
          PermissionsBitField.Flags.ManageMessages,
        ],
      });
    }
    const name = `${type.channel}-${sanitizeTicketName(interaction.user.username)}`;
    const channel = await interaction.guild.channels.create({
      name,
      type: ChannelType.GuildText,
      parent: TICKET_CATEGORY_ID || interaction.channel?.parentId || undefined,
      topic: ticketTopic(interaction.user.id, typeKey),
      permissionOverwrites: overwrites,
      reason: `Ticket ${type.title} ouvert par ${interaction.user.tag}`,
    });
    const fieldLines = type.fields.map(([id, label]) => {
      const value = interaction.fields.getTextInputValue(id);
      return `**${label}:**\n${truncate(value, 1500)}`;
    });
    const mentionLine = `${TICKET_SUPPORT_ROLE_ID ? `<@&${TICKET_SUPPORT_ROLE_ID}> ` : ''}<@${interaction.user.id}>`;
    const container = new ContainerBuilder()
      .setAccentColor(type.color)
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(
        `## ${type.emoji} ${type.title}\n${mentionLine}\n${type.intro}`
      ))
      .addSeparatorComponents(new SeparatorBuilder())
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(fieldLines.join('\n\n').slice(0, 4000)));
    await channel.send({
      flags: MessageFlags.IsComponentsV2,
      components: [container, ticketActions(false)],
    });
    return interaction.editReply(containerMessage({
      color: type.color,
      title: 'Ticket cree',
      subtitle: `Ton ticket est ouvert: <#${channel.id}>`,
    }));
  }

  async function handleTicketButton(interaction) {
    if (interaction.customId.startsWith('p4_ticket_open:')) {
      const typeKey = interaction.customId.split(':')[1] || 'other';
      return interaction.showModal(ticketModal(typeKey));
    }
    const info = parseTicketTopic(interaction.channel);
    if (!info) return interaction.reply({ content: 'Ce salon ne semble pas etre un ticket Puissance 4.', flags: MessageFlags.Ephemeral });
    const isOwner = info.userId === interaction.user.id;
    const isStaff = isTicketStaff(interaction);
    if (!isOwner && !isStaff) return interaction.reply({ content: 'Tu ne peux pas gerer ce ticket.', flags: MessageFlags.Ephemeral });

    if (interaction.customId === 'p4_ticket_close') {
      await interaction.channel.permissionOverwrites.edit(info.userId, { SendMessages: false }).catch(() => null);
      return interaction.reply({
        content: `🔒 Ticket ferme par <@${interaction.user.id}>.`,
        components: [ticketActions(true)],
      });
    }
    if (interaction.customId === 'p4_ticket_reopen') {
      await interaction.channel.permissionOverwrites.edit(info.userId, { SendMessages: true }).catch(() => null);
      return interaction.reply({
        content: `🔓 Ticket rouvert par <@${interaction.user.id}>.`,
        components: [ticketActions(false)],
      });
    }
    if (interaction.customId === 'p4_ticket_delete_panel') {
      return interaction.reply({
        content: 'Choisis si un transcript doit etre genere avant suppression. Le ticket sera supprime 30 secondes apres le choix.',
        components: [deleteTranscriptChoices()],
        flags: MessageFlags.Ephemeral,
      });
    }
    if (interaction.customId.startsWith('p4_ticket_transcript_')) {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const mode = interaction.customId.replace('p4_ticket_transcript_', '');
      if (mode !== 'none') await sendTicketTranscript(interaction.channel, info.userId, mode === 'member');
      else await interaction.channel.send('📤 Aucun transcript ne sera genere.').catch(() => null);
      await interaction.editReply({ content: 'Suppression programmee dans 30 secondes.' }).catch(() => null);
      setTimeout(() => interaction.channel.delete('Ticket Puissance 4 termine').catch(() => null), 30000);
    }
  }

  async function sendTicketTranscript(channel, userId, sendToMember) {
    const transcriptPath = await createTicketTranscriptFile(channel);
    try {
      const file = new AttachmentBuilder(transcriptPath, { name: `transcript-${channel.name}.html` });
      const targetChannel = TICKET_TRANSCRIPT_CHANNEL_ID
        ? await channel.guild.channels.fetch(TICKET_TRANSCRIPT_CHANNEL_ID).catch(() => null)
        : channel;
      const message = await (targetChannel?.isTextBased?.() ? targetChannel : channel).send({
        content: `📄 Transcript du ticket ${channel.name}`,
        files: [file],
      });
      const url = message.attachments.first()?.url || '';
      await channel.send(url ? `📄 Transcript genere: ${url}` : '📄 Transcript genere.').catch(() => null);
      if (sendToMember && url) {
        const member = await channel.guild.members.fetch(userId).catch(() => null);
        await member?.send?.(`📑 Transcript de ton ticket sur ${channel.guild.name}: ${url}`).catch(() => null);
      }
    } finally {
      fs.unlinkSync(transcriptPath);
    }
  }

  async function createTicketTranscriptFile(channel) {
    const messages = [];
    let before;
    while (true) {
      const batch = await channel.messages.fetch({ limit: 100, before });
      if (!batch.size) break;
      messages.push(...batch.values());
      before = batch.last().id;
      if (batch.size < 100) break;
    }
    messages.sort((a, b) => a.createdTimestamp - b.createdTimestamp);
    const html = renderTicketTranscript(channel, messages);
    const filePath = path.join(os.tmpdir(), `p4-transcript-${channel.id}-${Date.now()}.html`);
    fs.writeFileSync(filePath, html, 'utf8');
    return filePath;
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function renderTicketTranscript(channel, messages) {
    const rows = messages.map(message => {
      const attachments = [...message.attachments.values()].map(file => `<a href="${escapeHtml(file.url)}">${escapeHtml(file.name || file.url)}</a>`).join('<br>');
      const embeds = message.embeds.length ? `<div class="embed">${message.embeds.length} embed(s)</div>` : '';
      return `<article class="msg"><img src="${escapeHtml(message.author.displayAvatarURL?.({ size: 64 }) || '')}" alt=""><div><header><strong>${escapeHtml(message.author.tag || message.author.username)}</strong><span>${new Date(message.createdTimestamp).toLocaleString('fr-FR')}</span></header><p>${escapeHtml(message.content || '').replace(/\n/g, '<br>') || '<em>Sans texte</em>'}</p>${attachments ? `<div class="files">${attachments}</div>` : ''}${embeds}</div></article>`;
    }).join('\n');
    return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Transcript ${escapeHtml(channel.name)}</title><style>body{margin:0;background:#080910;color:#f4f7fb;font:15px system-ui,Segoe UI,sans-serif}.wrap{width:min(980px,calc(100% - 28px));margin:auto;padding:32px 0}h1{margin:0 0 8px}.meta{color:#9aa4b2;margin-bottom:22px}.msg{display:grid;grid-template-columns:46px 1fr;gap:12px;margin:12px 0;padding:14px;border:1px solid rgba(255,255,255,.1);border-radius:14px;background:#10131d}.msg img{width:46px;height:46px;border-radius:12px}.msg header{display:flex;gap:10px;flex-wrap:wrap}.msg header span,.files,.embed{color:#9aa4b2}.msg p{margin:6px 0 0;line-height:1.5}.files,.embed{margin-top:8px}.files a{color:#66d9ef}</style></head><body><main class="wrap"><h1>Transcript du ticket</h1><div class="meta">${escapeHtml(channel.name)} | ${messages.length} message(s) | genere le ${new Date().toLocaleString('fr-FR')}</div>${rows || '<p>Aucun message.</p>'}</main></body></html>`;
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
    await updateConnectedCountChannel();
    connectedCountTimer = setInterval(updateConnectedCountChannel, CONNECTED_COUNT_INTERVAL_MS);
    connectedCountTimer.unref?.();
    syncGuildEmojiAssets().catch(error => console.warn('[BOT EMOJIS]', error.message));
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
      if (interaction.isStringSelectMenu() && interaction.customId.startsWith('p4_profile_variant:')) {
        const player = ctx.db.prepare('SELECT * FROM players WHERE id=? AND deleted=0').get(Number(interaction.customId.split(':')[1]));
        if (!player) return replyError(interaction, 'Joueur introuvable');
        const payload = await profileCanvasPayload(player, interaction.values?.[0] || 'classic');
        delete payload.flags;
        payload.attachments = [];
        return interaction.update(payload);
      }
      if (interaction.isButton?.() && interaction.customId.startsWith('p4_giveaway_join:')) {
        return handleGiveawayButton(interaction, interaction.customId.split(':')[1]);
      }
      if (interaction.isButton?.() && interaction.customId.startsWith('p4_drop_claim:')) {
        return handleDropButton(interaction, interaction.customId.split(':')[1]);
      }
      if (interaction.isButton?.() && interaction.customId.startsWith('p4_ticket_')) {
        return handleTicketButton(interaction);
      }
      if (interaction.isModalSubmit?.() && interaction.customId.startsWith('p4_ticket_modal:')) {
        return handleTicketModal(interaction, interaction.customId.split(':')[1] || 'other');
      }
      if (interaction.isModalSubmit?.() && interaction.customId === 'p4_product_key_generate') {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        return handleProductKey(interaction);
      }
      if (!interaction.isChatInputCommand()) return;
      if (interaction.commandName === 'key-generate') return interaction.showModal(productKeyModal());
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      trackSlashApiLatency(interaction, process.hrtime.bigint());

      if (interaction.commandName === 'profil') {
        const player = playerByPseudo(interaction.options.getString('pseudo', true));
        if (!player) return replyError(interaction, 'Joueur introuvable');
        return interaction.editReply(await profileCanvasPayload(player, interaction.options.getString('variante') || 'classic'));
      }
      if (interaction.commandName === 'moi') {
        const player = playerByDiscord(interaction.user.id);
        if (!player) return replyError(interaction, 'Compte non lie', `Lie ton compte depuis ${api}/profil`);
        return interaction.editReply(await profileCanvasPayload(player, interaction.options.getString('variante') || 'classic'));
      }
      if (interaction.commandName === 'ui') return interaction.editReply(await userInfoPayload(interaction));
      if (interaction.commandName === 'classement') return interaction.editReply(leaderboardPayload(interaction.options.getString('type') || 'humans', interaction.options.getString('variante') || 'classic'));
      if (interaction.commandName === 'leaderboard') return interaction.editReply(leaderboardPayload(interaction.options.getString('type') || 'humans', interaction.options.getString('variante') || 'classic'));
      if (interaction.commandName === 'stats') return interaction.editReply(statsPayload());
      if (interaction.commandName === 'systeme') return interaction.editReply(systemPayload());
      if (interaction.commandName === 'live') return interaction.editReply(livePayload());
      if (interaction.commandName === 'variantes') return interaction.editReply(variantsPayload());
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
      if (interaction.commandName === 'ticket-setup') return handleTicketSetup(interaction);
      if (interaction.commandName === 'aide') return interaction.editReply(helpPayload());
      if (interaction.commandName === 'db-reset') return handleDbReset(interaction);
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


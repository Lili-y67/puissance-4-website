/**
 * Central Discord webhook logger.
 * Never send private network data such as IP addresses to Discord.
 */

const fs = require('fs');
const path = require('path');

const BASE = (process.env.BASE_URL || 'https://puissance-4-website-production.up.railway.app').replace(/\/+$/, '');
const MEMBER_FORUM_CHANNEL_ID = process.env.DISCORD_MEMBER_FORUM_CHANNEL_ID || '1508534889153036461';
const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN || process.env.BOT_TOKEN || '';
const MEMBER_THREAD_STORE = path.join(__dirname, '..', 'data', 'discord-member-forum-threads.json');
const WEBHOOKS = Object.freeze({
  get: process.env.DISCORD_WEBHOOK_GET || 'https://discord.com/api/webhooks/1503398804404179114/PuuvWQUV4Stby6Y_eekKKkxKnxdBHWgpHYpr9QfzAXEsD7Lemp1InNdah_MGF9k8eRFz',
  post: process.env.DISCORD_WEBHOOK_POST || 'https://discord.com/api/webhooks/1508532434008801351/EdesEHSTzRz5xlDEYpa9fRIHTBNrFuE1ch-lm9vNubPKqa8Nerch36lvqumJHmmKuWp5',
  games: process.env.DISCORD_WEBHOOK_GAMES || 'https://discord.com/api/webhooks/1508532437549060268/SKY1sUhOfMrXJHWSygRovS821KoRyBjpJu_yLzOJl1XaRSWcoIBNIfR82NJHlqiIwugy',
  global: process.env.DISCORD_WEBHOOK_GLOBAL || 'https://discord.com/api/webhooks/1508532441911136377/WQP56D0Y-EmQ-S5pK4HPpygXW6KQakDMIsjTN9PDDuummxJwAMlp00livy-akPvJB4KS',
  default: process.env.DISCORD_WEBHOOK || 'https://discord.com/api/webhooks/1508532441911136377/WQP56D0Y-EmQ-S5pK4HPpygXW6KQakDMIsjTN9PDDuummxJwAMlp00livy-akPvJB4KS',
});

const EMOJI = Object.freeze({
  replay: '\uD83C\uDFAC',
  profile: '\uD83D\uDC64',
  live: '\uD83D\uDD34',
  trophy: '\uD83C\uDFC6',
  draw: '\uD83E\uDD1D',
  warning: '\u26A0\uFE0F',
  bolt: '\u26A1',
  cart: '\uD83D\uDED2',
  gem: '\uD83D\uDC8E',
  shield: '\uD83D\uDEE1\uFE0F',
  ticket: '\uD83C\uDF9F\uFE0F',
  robot: '\uD83E\uDD16',
  sword: '\u2694\uFE0F',
  link: '\uD83D\uDD17',
  red: '\uD83D\uDD34',
  yellow: '\uD83D\uDFE1',
  black: '\u26AB',
  win: '\uD83D\uDFE2',
});

function webhookUrl(target = 'global') {
  return WEBHOOKS[target] || WEBHOOKS.default || WEBHOOKS.global || WEBHOOKS.get;
}

function readMemberThreadStore() {
  try {
    if (!fs.existsSync(MEMBER_THREAD_STORE)) return {};
    return JSON.parse(fs.readFileSync(MEMBER_THREAD_STORE, 'utf8'));
  } catch {
    return {};
  }
}

function writeMemberThreadStore(store) {
  try {
    fs.mkdirSync(path.dirname(MEMBER_THREAD_STORE), { recursive: true });
    fs.writeFileSync(MEMBER_THREAD_STORE, JSON.stringify(store, null, 2), 'utf8');
  } catch (error) {
    console.error('[WEBHOOK FORUM]', error.message);
  }
}

function forumThreadName(pseudo, id) {
  return clean(pseudo, `Joueur ${id}`)
    .replace(/[^\p{L}\p{N}_. -]/gu, '')
    .trim()
    .slice(0, 80) || `Joueur ${id}`;
}

async function ensureMemberForumThread(player = {}) {
  const id = Number(player.id || player.actorId || 0);
  if (!id || !DISCORD_BOT_TOKEN || !MEMBER_FORUM_CHANNEL_ID) return '';
  const store = readMemberThreadStore();
  if (store[id]?.threadId) return store[id].threadId;
  try {
    const res = await fetch(`https://discord.com/api/v10/channels/${MEMBER_FORUM_CHANNEL_ID}/threads`, {
      method: 'POST',
      headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: forumThreadName(player.pseudo || player.actorPseudo, id),
        auto_archive_duration: 10080,
        message: {
          content: `# ${clean(player.pseudo || player.actorPseudo, `Joueur ${id}`)}\nFil automatique des GET site du membre. Aucun token, mot de passe ou IP n'est journalise.`,
        },
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.error('[WEBHOOK FORUM]', `HTTP ${res.status}`, text.slice(0, 240));
      return '';
    }
    const thread = await res.json();
    if (!thread?.id) return '';
    store[id] = {
      threadId: thread.id,
      pseudo: player.pseudo || player.actorPseudo || '',
      createdAt: Date.now(),
    };
    writeMemberThreadStore(store);
    return thread.id;
  } catch (error) {
    console.error('[WEBHOOK FORUM]', error.message);
    return '';
  }
}

async function postForumThreadMessage(threadId, payload) {
  if (!threadId || !DISCORD_BOT_TOKEN) return false;
  try {
    const res = await fetch(`https://discord.com/api/v10/channels/${threadId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.error('[WEBHOOK FORUM MESSAGE]', `HTTP ${res.status}`, text.slice(0, 240));
      return false;
    }
    return true;
  } catch (error) {
    console.error('[WEBHOOK FORUM MESSAGE]', error.message);
    return false;
  }
}

async function postWebhook(payload, target = 'global') {
  const url = webhookUrl(target);
  if (!url) return;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.error('[WEBHOOK]', `HTTP ${res.status}`, text.slice(0, 240));
    }
  } catch (e) {
    console.error('[WEBHOOK]', e.message);
  }
}

function clean(value, fallback = '-') {
  const text = value == null ? '' : String(value).trim();
  return text || fallback;
}

function truncate(value, max = 3900) {
  const text = clean(value);
  return text.length > max ? `${text.slice(0, max - 1)}...` : text;
}

function publicMediaUrl(value) {
  const src = String(value || '').trim();
  if (!src || /^data:/i.test(src)) return '';
  if (/^https?:\/\//i.test(src)) return src;
  if (src.startsWith('/')) return `${BASE}${src}`;
  if (/^(assets|images|uploads)\//i.test(src)) return `${BASE}/${src}`;
  return '';
}

function mkEmbed(color, title, fields = [], options = {}) {
  const embed = {
    color,
    title: clean(title),
    fields: fields.filter(Boolean).map(([name, value, inline = false]) => ({
      name: clean(name),
      value: truncate(value, 1024),
      inline,
    })),
    timestamp: new Date().toISOString(),
    footer: { text: options.footer || 'Puissance 4 Ranked' },
  };
  if (options.description) embed.description = truncate(options.description, 4096);
  if (options.url) embed.url = options.url;
  const thumbnail = publicMediaUrl(options.thumbnail);
  const image = publicMediaUrl(options.image);
  if (thumbnail) embed.thumbnail = { url: thumbnail };
  if (image) embed.image = { url: image };
  return embed;
}

function linkButton(label, url, emoji) {
  const button = {
    type: 2,
    style: 5,
    label: truncate(label, 80),
    url,
  };
  if (emoji) button.emoji = { name: emoji };
  return button;
}

function actionRow(buttons = []) {
  return { type: 1, components: buttons.filter(Boolean).slice(0, 5) };
}

function webhookColor(value, fallback = 0xff3b30) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const normalized = String(value || '').trim().replace('#', '');
  return /^[0-9a-f]{6}$/i.test(normalized) ? parseInt(normalized, 16) : fallback;
}

function mkContainer(color, title, fields = [], options = {}) {
  return {
    kind: 'p4-webhook-card',
    embed: mkEmbed(webhookColor(color), title, fields, {
      description: options.subtitle,
      url: options.url,
      footer: options.footer,
      thumbnail: options.thumbnail,
      image: options.image,
    }),
    buttons: Array.isArray(options.buttons) ? options.buttons.filter(Boolean) : [],
  };
}

function cardToPayload(card) {
  if (card?.kind === 'p4-webhook-card') {
    const payload = { embeds: [card.embed] };
    if (card.buttons?.length) payload.components = [actionRow(card.buttons)];
    return payload;
  }
  return { embeds: [card] };
}

async function send(items, target = 'global') {
  const cards = Array.isArray(items) ? items : [items];
  for (const card of cards.filter(Boolean).slice(0, 10)) {
    await postWebhook(cardToPayload(card), target);
  }
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
    { emoji: '\uD83D\uDD34', rgb: [255, 45, 85] },
    { emoji: '\uD83D\uDFE0', rgb: [255, 159, 10] },
    { emoji: '\uD83D\uDFE1', rgb: [255, 214, 10] },
    { emoji: '\uD83D\uDFE2', rgb: [48, 209, 88] },
    { emoji: '\uD83D\uDD35', rgb: [47, 128, 255] },
    { emoji: '\uD83D\uDFE3', rgb: [191, 90, 242] },
    { emoji: '\u26AA', rgb: [235, 245, 255] },
    { emoji: '\u26AB', rgb: [35, 35, 45] },
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

function normalizeWinCell(cell) {
  if (Array.isArray(cell)) return `${Number(cell[0])}:${Number(cell[1])}`;
  if (cell && typeof cell === 'object') return `${Number(cell.row)}:${Number(cell.col)}`;
  return '';
}

function boardGrid(board, p1Emoji, p2Emoji, winCells = []) {
  if (!Array.isArray(board) || board.length !== 6) return '';
  const winners = new Set((Array.isArray(winCells) ? winCells : []).map(normalizeWinCell).filter(Boolean));
  return board
    .map((row, r) => (Array.isArray(row) ? row : [])
      .slice(0, 7)
      .map((cell, c) => {
        if (winners.has(`${r}:${c}`)) return EMOJI.win;
        return Number(cell) === 1 ? p1Emoji : Number(cell) === 2 ? p2Emoji : EMOJI.black;
      })
      .join(''))
    .join('\n');
}

function profileButtons(id) {
  return Number.isFinite(Number(id)) ? [linkButton('Voir profil', `${BASE}/profil?id=${id}`, EMOJI.profile)] : [];
}

function clanButtons(id) {
  return Number.isFinite(Number(id)) ? [linkButton('Voir clan', `${BASE}/clan?id=${id}`, EMOJI.shield)] : [];
}

module.exports = {
  wlog: cards => send(cards),
  mkEmbed,
  mkContainer,
  linkButton,

  wlogGame({ gameId, isDraw, isSuspect, reason, p1, p2, winner, moves, duration, replayUrl, board, winCells }) {
    const titleIcon = isDraw ? EMOJI.draw : isSuspect ? EMOJI.warning : EMOJI.trophy;
    const title = isDraw ? `${titleIcon} Partie nulle` : isSuspect ? `${titleIcon} Partie suspecte` : `${titleIcon} Victoire de ${winner}`;
    const color = isDraw ? 0xffd60a : isSuspect ? 0xff9f0a : 0x30d158;
    const d1 = Number(p1?.delta || 0) >= 0 ? `+${p1?.delta || 0}` : String(p1?.delta || 0);
    const d2 = Number(p2?.delta || 0) >= 0 ? `+${p2?.delta || 0}` : String(p2?.delta || 0);
    const p1Emoji = tokenEmojiFromColor(p1?.color, EMOJI.red);
    const p2Emoji = tokenEmojiFromColor(p2?.color, EMOJI.yellow);
    const grid = boardGrid(board, p1Emoji, p2Emoji, winCells);
    const fields = [
      ['Duel', `${p1Emoji} **${clean(p1?.pseudo)}** \`${p1?.elo || 0} ELO\` (${d1})\n${p2Emoji} **${clean(p2?.pseudo)}** \`${p2?.elo || 0} ELO\` (${d2})`, false],
      ['Resultat', isDraw ? `${EMOJI.draw} Nul` : `${EMOJI.trophy} **${clean(winner)}** gagne`, true],
      ['Rythme', `${moves || 0} coups - ${duration || 0}s`, true],
      ['Controle', `ID #${gameId} - Suspect: ${isSuspect ? 'Oui' : 'Non'}\nRaison: ${clean(reason)}`, false],
    ];
    if (grid) {
      fields.splice(1, 0, ['Plateau final', `${grid}\n1\uFE0F\u20E3 2\uFE0F\u20E3 3\uFE0F\u20E3 4\uFE0F\u20E3 5\uFE0F\u20E3 6\uFE0F\u20E3 7\uFE0F\u20E3\n${EMOJI.win} = ligne gagnante`, false]);
    }
    send([mkContainer(color, title, fields, {
      subtitle: isSuspect ? 'Surveillance anti-abus' : 'Fin de partie',
      url: replayUrl,
      buttons: [
        replayUrl ? linkButton('Replay', replayUrl, EMOJI.replay) : null,
        linkButton('Live', `${BASE}/live`, EMOJI.live),
        p1?.id ? linkButton(clean(p1.pseudo, 'J1').slice(0, 20), `${BASE}/profil?id=${p1.id}`, EMOJI.profile) : null,
        p2?.id ? linkButton(clean(p2.pseudo, 'J2').slice(0, 20), `${BASE}/profil?id=${p2.id}`, EMOJI.profile) : null,
      ],
    })], 'games');
  },

  wlogRegister(pseudo, id) {
    ensureMemberForumThread({ id, pseudo }).catch(() => {});
    send([mkContainer(0x30d158, 'Nouveau compte', [
      ['Pseudo', pseudo, true],
      ['ID', id, true],
    ], { subtitle: 'Un nouveau joueur rejoint l arene', buttons: profileButtons(id) })]);
  },

  wlogLogin(pseudo, id) {
    send([mkContainer(0x4c6ef5, 'Connexion', [
      ['Pseudo', pseudo, true],
      ['ID', id, true],
    ], { subtitle: 'Session joueur ouverte', buttons: profileButtons(id) })]);
  },

  wlogLoginFail(pseudo) {
    send([mkContainer(0xff3b30, 'Echec connexion', [
      ['Pseudo tente', pseudo, true],
    ], { subtitle: 'Tentative refusee' })]);
  },

  wlogAvatar(pseudo, id, sizeKB, image = '') {
    send([mkContainer(0xff9f0a, 'Avatar change', [
      ['Joueur', pseudo, true],
      ['ID', id, true],
      ['Taille', `${sizeKB} KB`, true],
    ], { subtitle: 'Cosmetique profil', thumbnail: image, buttons: profileButtons(id) })]);
  },

  wlogBanner(pseudo, id, sizeKB, image = '') {
    send([mkContainer(0xff9f0a, 'Banniere changee', [
      ['Joueur', pseudo, true],
      ['ID', id, true],
      ['Taille', `${sizeKB} KB`, true],
    ], { subtitle: 'Cosmetique profil', image, buttons: profileButtons(id) })]);
  },

  wlogProfileView(visitorPseudo, targetPseudo, targetId) {
    send([mkContainer(0x636366, 'Profil consulte', [
      ['Visiteur', visitorPseudo, true],
      ['Profil', targetPseudo, true],
    ], { subtitle: 'Activite profil', buttons: profileButtons(targetId) })]);
  },

  wlogReplay(watcherPseudo, gameId) {
    send([mkContainer(0x8b9cf4, 'Replay visionne', [
      ['Visionne par', watcherPseudo, true],
      ['Partie ID', gameId, true],
    ], { subtitle: 'Replay consulte', buttons: [linkButton('Voir replay', `${BASE}/replay/${gameId}`, EMOJI.replay)] })], 'games');
  },

  wlogAdminLogin() {
    send([mkContainer(0xff2d55, 'Connexion panel admin', [
      ['Heure', new Date().toLocaleString('fr-FR'), true],
    ], { subtitle: 'Securite admin' })]);
  },

  wlogAdminAction(action, pseudo, id, details = []) {
    send([mkContainer(0xff2d55, `Action admin - ${clean(action)}`, [
      ['Joueur', pseudo, true],
      ['ID', id, true],
      ...details,
    ], { subtitle: 'Journal moderation', buttons: profileButtons(id) })]);
  },

  wlogDiscordLink(pseudo, discordId, discordUsername, role) {
    send([mkContainer(0x5865f2, 'Discord lie', [
      ['Joueur', pseudo, true],
      ['Discord', discordUsername || discordId, true],
      ['Role attribue', role, true],
    ], { subtitle: 'Liaison Discord validee' })]);
  },

  wlogResetPwd(pseudo, id) {
    send([mkContainer(0xff6b00, 'Mot de passe reinitialise', [
      ['Joueur', pseudo, true],
      ['ID', id, true],
    ], { subtitle: 'Securite compte', buttons: profileButtons(id) })]);
  },

  wlogDelete(pseudo, id) {
    send([mkContainer(0x8b0000, 'Compte supprime', [
      ['Pseudo', pseudo, true],
      ['ID', id, true],
    ], { subtitle: 'Compte ferme' })]);
  },

  wlogRoleSync(pseudo, oldRole, newRole) {
    send([mkContainer(0x8b9cf4, 'Role sync Discord', [
      ['Joueur', pseudo, true],
      ['Avant', oldRole, true],
      ['Apres', newRole, true],
    ], { subtitle: 'Synchronisation roles' })]);
  },

  wlogBan(pseudo, id, banned) {
    send([mkContainer(0xff3b30, banned ? 'Joueur banni' : 'Joueur debanni', [
      ['Joueur', pseudo, true],
      ['ID', id, true],
    ], { subtitle: 'Moderation', buttons: profileButtons(id) })]);
  },

  wlogMute(pseudo, id, hours) {
    send([mkContainer(0xff9f0a, hours > 0 ? 'Joueur mute' : 'Joueur unmute', [
      ['Joueur', pseudo, true],
      ['ID', id, true],
      ['Duree', hours > 0 ? `${hours}h` : 'Leve', true],
    ], { subtitle: 'Moderation', buttons: profileButtons(id) })]);
  },

  wlogShopPurchase(pseudo, id, item, priceOrMeta, meta = {}) {
    const details = typeof priceOrMeta === 'object' && priceOrMeta !== null ? priceOrMeta : { paid: priceOrMeta, ...meta };
    const currency = String(details.currency || 'coins') === 'gems' ? 'Gemmes' : 'Coins';
    const coupon = details.coupon?.code || details.coupon || '';
    send([mkContainer(currency === 'Gemmes' ? 0x85ebff : 0xffd60a, 'Achat boutique', [
      ['Joueur', pseudo, true],
      ['ID', id, true],
      ['Article', item, true],
      [currency + ' depensees', details.paid ?? details.price ?? 0, true],
      details.basePrice != null && Number(details.basePrice) !== Number(details.paid) ? ['Prix initial', details.basePrice, true] : null,
      coupon ? ['Code promo', coupon, true] : null,
    ], { subtitle: currency === 'Gemmes' ? 'Boutique gemmes' : 'Boutique coins', buttons: [linkButton('Voir boutique', `${BASE}/boutique`, currency === 'Gemmes' ? EMOJI.gem : EMOJI.cart), ...profileButtons(id)] })]);
  },

  wlogGems(pseudo, id, delta, reason = '') {
    send([mkContainer(0x85ebff, 'Gemmes modifiees', [
      ['Joueur', pseudo, true],
      ['ID', id, true],
      ['Delta', Number(delta || 0) >= 0 ? `+${delta}` : delta, true],
      ['Raison', reason || '-', false],
    ], { subtitle: 'Economie gemmes', buttons: profileButtons(id) })]);
  },

  wlogCoupon(code, type, value, maxUses, expiresAt, createdBy = 'Staff') {
    send([mkContainer(0x8b5cf6, 'Code promo cree', [
      ['Code', `\`${clean(code)}\``, true],
      ['Type', type || 'discount', true],
      ['Valeur', value, true],
      ['Utilisations', maxUses || 1, true],
      ['Expiration', expiresAt ? new Date(Number(expiresAt)).toLocaleString('fr-FR') : 'Aucune', true],
      ['Cree par', createdBy || 'Staff', true],
    ], { subtitle: 'Boutique - promotion limitee', buttons: [linkButton('Boutique', `${BASE}/boutique`, EMOJI.ticket)] })]);
  },

  wlogLimitedPack(offer = {}, createdBy = 'Staff') {
    const items = Array.isArray(offer.items) ? offer.items : [];
    const itemLines = items.map(item => {
      const key = clean(item.key || item.itemKey);
      const qty = Number(item.qty || item.quantity || 1);
      return `- ${key} x${qty}`;
    }).join('\n') || 'Aucun contenu';
    send([mkContainer(0xffd60a, `${EMOJI.ticket} Pack limite publie`, [
      ['Nom', clean(offer.label, 'Offre limitee'), true],
      ['Prix', `${offer.priceCoins || 0} coins / ${offer.priceGems || 0} gemmes`, true],
      ['Stock', String(offer.stock || 0), true],
      ['Expiration', offer.expiresAt ? new Date(Number(offer.expiresAt)).toLocaleString('fr-FR') : 'Aucune', true],
      ['Cree par', clean(createdBy, 'Staff'), true],
      ['Contenu', itemLines, false],
    ], { subtitle: 'Nouvelle offre boutique', buttons: [linkButton('Voir boutique', `${BASE}/boutique`, EMOJI.cart)] })]);
  },

  wlogClan(action, clan = {}, actor = {}, details = []) {
    const color = action === 'delete' ? 0xff3b30 : action === 'join' ? 0x30d158 : action === 'update' ? 0x85ebff : 0x8b5cf6;
    const titleMap = {
      create: 'Clan cree',
      update: 'Clan modifie',
      delete: 'Clan supprime',
      join: 'Nouveau membre clan',
      leave: 'Membre parti du clan',
      member: 'Gestion membre clan',
    };
    send([mkContainer(color, `${EMOJI.shield} ${titleMap[action] || 'Clan'}`, [
      ['Clan', `${clean(clan.blason, EMOJI.shield)} **${clean(clan.name)}** [${clean(clan.tag, 'CLAN')}]`, false],
      ['ID clan', clan.id || '-', true],
      ['ELO moyen', clan.avg_elo || '-', true],
      ['Membres', clan.member_count || '-', true],
      actor?.pseudo ? ['Action par', `${actor.pseudo} (#${actor.id || '?'})`, true] : null,
      ...details,
    ], { subtitle: 'Systeme de clans', buttons: clanButtons(clan.id) })]);
  },

  wlogBoost(type, multiplier, appliedBy, duration) {
    send([mkContainer(type === 'coins' ? 0xff9f0a : 0xffd60a, 'Boost global active', [
      ['Type', type === 'coins' ? 'Coins' : 'ELO', true],
      ['Multiplicateur', `x${multiplier}`, true],
      ['Par', clean(appliedBy, 'Puissance4-Booster'), true],
      ['Duree', duration || '-', true],
    ], { subtitle: 'Boost serveur', buttons: [linkButton('Rejoindre', BASE, EMOJI.bolt)] })]);
  },

  wlogCoins(pseudo, id, delta, reason = '') {
    send([mkContainer(0xff9f0a, 'Coins modifies', [
      ['Joueur', pseudo, true],
      ['ID', id, true],
      ['Delta', Number(delta || 0) >= 0 ? `+${delta}` : delta, true],
      ['Raison', reason || '-', false],
    ], { subtitle: 'Economie coins', buttons: profileButtons(id) })]);
  },

  wlogTournament(name, id, status) {
    send([mkContainer(0x30d158, 'Tournoi', [
      ['Nom', name, true],
      ['ID', id, true],
      ['Statut', status, true],
    ], { subtitle: 'Evenement tournoi', buttons: [linkButton('Voir tournoi', `${BASE}/tournoi?id=${id}`, EMOJI.trophy)] })], 'games');
  },

  wlogDuel(sender, target, type) {
    send([mkContainer(0x8b9cf4, 'Duel', [
      ['Createur', sender, true],
      ['Cible', target || 'Lien public', true],
      ['Type', type || 'ranked', true],
    ], { subtitle: 'Defi cree', buttons: [linkButton('Ouvrir le site', BASE, EMOJI.sword)] })], 'games');
  },

  wlogApiEvent(event = {}) {
    const status = Number(event.status || 0);
    const color = status >= 500 ? 0xff3b30 : status >= 400 ? 0xff9f0a : 0x4c6ef5;
    const method = String(event.method || '').toUpperCase();
    const isAdmin = !!event.admin || String(event.kind || '').toLowerCase() === 'admin';
    const target = method === 'GET' ? 'get' : 'post';
    const card = mkContainer(color, isAdmin ? 'ADMIN - API site' : 'API site', [
      ['Route', `${clean(event.method)} ${clean(event.path)}`, false],
      ['Statut', `${status || '-'} - ${Number(event.durationMs || 0)}ms`, true],
      ['Acteur', clean(event.actor, 'Visiteur/Anonyme'), true],
      ['Type', clean(event.kind, 'api'), true],
      event.changes ? ['Changements', event.changes, false] : null,
      event.note ? ['Note', event.note, false] : null,
    ], { thumbnail: event.thumbnail, image: event.image, buttons: [linkButton('Ouvrir le site', BASE, EMOJI.link)] });
    if (method === 'GET' && event.actorId && !isAdmin && !event.bot) {
      ensureMemberForumThread({ id: event.actorId, pseudo: event.actorPseudo })
        .then(threadId => threadId ? postForumThreadMessage(threadId, cardToPayload(card)) : send([card], target))
        .catch(() => send([card], target));
      return;
    }
    send([card], isAdmin ? 'global' : target);
  },

  wlogSystem(status, message, details = {}) {
    const hasSnapshot = Object.prototype.hasOwnProperty.call(details, 'totalPresent');
    const siteLines = hasSnapshot ? [
      `Presents: **${Number(details.totalPresent || 0)}**`,
      `Joueurs: **${Number(details.onlinePlayers || 0)}**`,
      `Bots: **${Number(details.onlineBots || 0)}**`,
      `Visiteurs: **${Number(details.visitors || 0)}**`,
      `Parties actives: **${Number(details.activeGames || 0)}**`,
      `Comptes: **${Number(details.players || 0)}**`,
      `Comptes Discord lies: **${Number(details.linkedDiscord || 0)}**`,
      `Parties finies: **${Number(details.finishedGames || 0)}**`,
      `Tournois actifs: **${Number(details.activeTournaments || 0)}**`,
    ] : [];
    send([mkContainer(details.color || 0xff3b30, `${clean(details.emoji, EMOJI.warning)} Etat serveur`, [
      ['Statut', status, true],
      details.animation ? ['Animation', details.animation, true] : null,
      ['Message', message || '-', false],
      hasSnapshot ? ['Snapshot site', siteLines.join('\n'), false] : null,
    ], { subtitle: 'Alerte systeme', buttons: [linkButton('Ouvrir le site', BASE, EMOJI.warning)] })]);
  },
};

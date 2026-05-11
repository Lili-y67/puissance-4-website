/**
 * Central Discord webhook logger.
 * Never send private network data such as IP addresses to Discord.
 */

const DISCORD_WEBHOOK = process.env.DISCORD_WEBHOOK || 'https://discord.com/api/webhooks/1503398804404179114/PuuvWQUV4Stby6Y_eekKKkxKnxdBHWgpHYpr9QfzAXEsD7Lemp1InNdah_MGF9k8eRFz';
const BASE = process.env.BASE_URL || 'https://puissance-4-website-production.up.railway.app';
const COMPONENTS_V2 = 1 << 15;
const TYPE_ACTION_ROW = 1;
const TYPE_BUTTON = 2;
const TYPE_TEXT_DISPLAY = 10;
const TYPE_SEPARATOR = 14;
const TYPE_CONTAINER = 17;
const BUTTON_LINK = 5;
const EMOJI = Object.freeze({
  replay: '\uD83C\uDFAC',
  profile: '\uD83D\uDC64',
  live: '\uD83D\uDD34',
  trophy: '\uD83C\uDFC6',
  draw: '\uD83E\uDD1D',
  warning: '\u26A0\uFE0F',
  bolt: '\u26A1',
  cart: '\uD83D\uDED2',
  sword: '\u2694\uFE0F',
  link: '\uD83D\uDD17',
  red: '\uD83D\uDD34',
  yellow: '\uD83D\uDFE1',
  black: '\u26AB',
  win: '\uD83D\uDFE2',
});

async function postWebhook(payload) {
  if (!DISCORD_WEBHOOK) return;
  try {
    const res = await fetch(DISCORD_WEBHOOK, {
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
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function mkEmbed(color, title, fields = []) {
  return {
    color,
    title,
    fields: fields.map(([name, value, inline = false]) => ({
      name: clean(name),
      value: clean(value),
      inline,
    })),
    timestamp: new Date().toISOString(),
    footer: { text: 'Puissance 4 Ranked' },
  };
}

function textDisplay(content) {
  return { type: TYPE_TEXT_DISPLAY, content: truncate(content) };
}

function separator() {
  return { type: TYPE_SEPARATOR, divider: true, spacing: 1 };
}

function linkButton(label, url, emoji) {
  const button = {
    type: TYPE_BUTTON,
    style: BUTTON_LINK,
    label: truncate(label, 80),
    url,
  };
  if (emoji) button.emoji = { name: emoji };
  return button;
}

function actionRow(buttons = []) {
  return { type: TYPE_ACTION_ROW, components: buttons.slice(0, 5) };
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

function fieldLines(fields = []) {
  return fields
    .filter(Boolean)
    .map(([name, value, inline = false]) => {
      const safeName = clean(name);
      const safeValue = clean(value);
      return inline ? `**${safeName}**\n${safeValue}` : `### ${safeName}\n${safeValue}`;
    })
    .join('\n\n');
}

function mkContainer(color, title, fields = [], options = {}) {
  const components = [
    textDisplay(`## ${clean(title)}\n${options.subtitle ? clean(options.subtitle) : 'Puissance 4 Ranked'}`),
  ];
  const body = fieldLines(fields);
  if (body) {
    components.push(separator());
    components.push(textDisplay(body));
  }
  const buttons = Array.isArray(options.buttons) ? options.buttons.filter(Boolean) : [];
  if (buttons.length) {
    components.push(separator());
    components.push(actionRow(buttons));
  }
  return {
    type: TYPE_CONTAINER,
    accent_color: color,
    components,
  };
}

function embedToContainer(embed) {
  const fields = (embed.fields || []).map(field => [field.name, field.value, field.inline]);
  const buttons = [];
  const markdownLinks = fields
    .map(([, value]) => String(value || '').match(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/))
    .filter(Boolean)
    .slice(0, 3);
  for (const match of markdownLinks) buttons.push(linkButton(match[1], match[2], '🔗'));
  return mkContainer(embed.color || 0xff2d55, embed.title || 'Webhook', fields, {
    subtitle: embed.footer?.text || 'Puissance 4 Ranked',
    buttons,
  });
}

async function sendContainers(containers) {
  await postWebhook({
    flags: COMPONENTS_V2,
    components: containers.slice(0, 5),
  });
}

async function send(embedsOrContainers) {
  const items = Array.isArray(embedsOrContainers) ? embedsOrContainers : [embedsOrContainers];
  const containers = items.map(item => item?.type === TYPE_CONTAINER ? item : embedToContainer(item || {}));
  await sendContainers(containers);
}

module.exports = {
  wlog: embeds => send(embeds),
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
      ['Rythme', `${moves || 0} coups • ${duration || 0}s`, true],
      ['Controle', `ID #${gameId} • Suspect: ${isSuspect ? 'Oui' : 'Non'}\nRaison: ${clean(reason)}`, false],
    ];
    if (grid) {
      fields.splice(1, 0, ['Plateau final', `${grid}\n1\uFE0F\u20E32\uFE0F\u20E33\uFE0F\u20E34\uFE0F\u20E35\uFE0F\u20E36\uFE0F\u20E37\uFE0F\u20E3\n${EMOJI.win} = ligne gagnante`, false]);
    }
    const buttons = [
      replayUrl ? linkButton('Replay', replayUrl, EMOJI.replay) : null,
      linkButton('Live', `${BASE}/live`, EMOJI.live),
      p1?.id ? linkButton(clean(p1.pseudo, 'J1').slice(0, 20), `${BASE}/profil?id=${p1.id}`, EMOJI.profile) : null,
      p2?.id ? linkButton(clean(p2.pseudo, 'J2').slice(0, 20), `${BASE}/profil?id=${p2.id}`, EMOJI.profile) : null,
    ].filter(Boolean);
    send([mkContainer(color, title, fields, {
      subtitle: isSuspect ? 'Surveillance anti-abus' : 'Fin de partie',
      buttons: replayUrl ? [linkButton('Voir le replay', replayUrl, '🎬')] : [],
    })]);
  },

  wlogRegister(pseudo, id) {
    send([mkContainer(0x30d158, 'Nouveau compte', [
      ['Pseudo', pseudo, true],
      ['ID', id, true],
    ], { subtitle: 'Un nouveau joueur rejoint l arene', buttons: [linkButton('Voir profil', `${BASE}/profil?id=${id}`, '👤')] })]);
  },

  wlogLogin(pseudo, id) {
    send([mkContainer(0x4c6ef5, 'Connexion', [
      ['Pseudo', pseudo, true],
      ['ID', id, true],
    ], { subtitle: 'Session joueur ouverte', buttons: [linkButton('Voir profil', `${BASE}/profil?id=${id}`, '👤')] })]);
  },

  wlogLoginFail(pseudo) {
    send([mkContainer(0xff3b30, 'Echec connexion', [
      ['Pseudo tente', pseudo, true],
    ], { subtitle: 'Tentative refusee' })]);
  },

  wlogAvatar(pseudo, id, sizeKB) {
    send([mkContainer(0xff9f0a, 'Avatar change', [
      ['Joueur', pseudo, true],
      ['ID', id, true],
      ['Taille', `${sizeKB} KB`, true],
    ], { subtitle: 'Cosmetique profil', buttons: [linkButton('Voir profil', `${BASE}/profil?id=${id}`, '👤')] })]);
  },

  wlogBanner(pseudo, id, sizeKB) {
    send([mkContainer(0xff9f0a, 'Banniere changee', [
      ['Joueur', pseudo, true],
      ['ID', id, true],
      ['Taille', `${sizeKB} KB`, true],
    ], { subtitle: 'Cosmetique profil', buttons: [linkButton('Voir profil', `${BASE}/profil?id=${id}`, '👤')] })]);
  },

  wlogProfileView(visitorPseudo, targetPseudo, targetId) {
    send([mkContainer(0x636366, 'Profil consulte', [
      ['Visiteur', visitorPseudo, true],
      ['Profil', targetPseudo, true],
    ], { subtitle: 'Activite profil', buttons: [linkButton('Ouvrir profil', `${BASE}/profil?id=${targetId}`, '👤')] })]);
  },

  wlogReplay(watcherPseudo, gameId) {
    send([mkContainer(0x8b9cf4, 'Replay visionne', [
      ['Visionne par', watcherPseudo, true],
      ['Partie ID', gameId, true],
    ], { subtitle: 'Replay consulte', buttons: [linkButton('Voir replay', `${BASE}/replay/${gameId}`, '🎬')] })]);
  },

  wlogAdminLogin() {
    send([mkContainer(0xff2d55, 'Connexion panel admin', [
      ['Heure', new Date().toLocaleString('fr-FR'), true],
    ], { subtitle: 'Securite admin' })]);
  },

  wlogAdminAction(action, pseudo, id, details = []) {
    const profileButton = Number.isFinite(Number(id)) ? [linkButton('Voir profil', `${BASE}/profil?id=${id}`, '👤')] : [];
    send([mkContainer(0xff2d55, `Action admin - ${clean(action)}`, [
      ['Joueur', pseudo, true],
      ['ID', id, true],
      ...details,
    ], { subtitle: 'Journal moderation', buttons: profileButton })]);
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
    ], { subtitle: 'Securite compte', buttons: [linkButton('Voir profil', `${BASE}/profil?id=${id}`, '👤')] })]);
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
    ], { subtitle: 'Moderation', buttons: [linkButton('Voir profil', `${BASE}/profil?id=${id}`, '👤')] })]);
  },

  wlogMute(pseudo, id, hours) {
    send([mkContainer(0xff9f0a, hours > 0 ? 'Joueur mute' : 'Joueur unmute', [
      ['Joueur', pseudo, true],
      ['ID', id, true],
      ['Duree', hours > 0 ? `${hours}h` : 'Leve', true],
    ], { subtitle: 'Moderation', buttons: [linkButton('Voir profil', `${BASE}/profil?id=${id}`, '👤')] })]);
  },

  wlogShopPurchase(pseudo, id, item, coins) {
    send([mkContainer(0xffd60a, 'Achat boutique', [
      ['Joueur', pseudo, true],
      ['ID', id, true],
      ['Article', item, true],
      ['Coins depenses', coins, true],
    ], { subtitle: 'Boutique coins', buttons: [linkButton('Voir boutique', `${BASE}/boutique`, '🛒'), linkButton('Voir profil', `${BASE}/profil?id=${id}`, '👤')] })]);
  },

  wlogBoost(type, multiplier, appliedBy, duration) {
    send([mkContainer(type === 'coins' ? 0xff9f0a : 0xffd60a, 'Boost global active', [
      ['Type', type === 'coins' ? 'Coins' : 'ELO', true],
      ['Multiplicateur', `x${multiplier}`, true],
      ['Par', clean(appliedBy, 'Puissance4-Booster'), true],
      ['Duree', duration || '-', true],
    ], { subtitle: 'Boost serveur', buttons: [linkButton('Rejoindre', BASE, '⚡')] })]);
  },

  wlogCoins(pseudo, id, delta, reason = '') {
    send([mkContainer(0xff9f0a, 'Coins modifies', [
      ['Joueur', pseudo, true],
      ['ID', id, true],
      ['Delta', Number(delta || 0) >= 0 ? `+${delta}` : delta, true],
      ['Raison', reason || '-', false],
    ], { subtitle: 'Economie coins', buttons: [linkButton('Voir profil', `${BASE}/profil?id=${id}`, '👤')] })]);
  },

  wlogTournament(name, id, status) {
    send([mkContainer(0x30d158, 'Tournoi', [
      ['Nom', name, true],
      ['ID', id, true],
      ['Statut', status, true],
    ], { subtitle: 'Evenement tournoi', buttons: [linkButton('Voir tournoi', `${BASE}/tournoi?id=${id}`, '🏆')] })]);
  },

  wlogDuel(sender, target, type) {
    send([mkContainer(0x8b9cf4, 'Duel', [
      ['Createur', sender, true],
      ['Cible', target || 'Lien public', true],
      ['Type', type || 'ranked', true],
    ], { subtitle: 'Defi cree', buttons: [linkButton('Ouvrir le site', BASE, '⚔️')] })]);
  },

  wlogSystem(status, message) {
    send([mkContainer(0xff3b30, 'Etat serveur', [
      ['Statut', status, true],
      ['Message', message || '-', false],
    ], { subtitle: 'Alerte systeme', buttons: [linkButton('Ouvrir le site', BASE, '⚠️')] })]);
  },
};

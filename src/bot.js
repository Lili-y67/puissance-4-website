/**
 * bot.js — Bot Discord Puissance 4
 * Commandes : /profil /classement /live
 */
const {
  Client, GatewayIntentBits, EmbedBuilder, AttachmentBuilder,
  ActionRowBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder,
  ButtonBuilder, ButtonStyle
} = require('discord.js');
const { createCanvas, loadImage } = require('canvas');
const path = require('path');

const BOT_TOKEN = 'MTQ3NzI1MjU0ODA5MDkyMTA2MA.GEJCC1.RcGqtpcrM8uFTqClZAVCILtiEMAxNisTFm3PuA';
const API       = process.env.BASE_URL || 'https://puissance-4-website-production.up.railway.app';
const PROFILE_BG_URL = 'https://i.pinimg.com/736x/40/65/a2/4065a24c58246a208cc7057db8b0286c.jpg';

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] });

// ── Helpers ───────────────────────────────────────────────────────────────────
async function apiFetch(path) {
  try {
    const res = await fetch(API + path);
    if (!res.ok) { console.error(`[API] ${path} → ${res.status}`); return null; }
    return res.json();
  } catch (e) {
    console.error(`[API] fetch error ${path}:`, e.message);
    return null;
  }
}

function getRank(elo) {
  const e = Math.max(100, Math.min(elo || 1000, 3500));
  if (e < 700)  return { label: 'Malachite', emoji: '🟢', color: '#2ecc71' };
  if (e < 1300) return { label: 'Quartz',    emoji: '⚪', color: '#b0bec5' };
  if (e < 1800) return { label: 'Ambre',     emoji: '🟤', color: '#cd7f32' };
  if (e < 2300) return { label: 'Jade',      emoji: '🟦', color: '#1abc9c' };
  if (e < 2800) return { label: 'Saphir',    emoji: '🔵', color: '#3498db' };
  return               { label: 'Améthyste', emoji: '🟣', color: '#9b59b6' };
}

function winRate(p) {
  const total = (p.wins || 0) + (p.losses || 0) + (p.draws || 0);
  if (!total) return '—';
  return Math.round((p.wins / total) * 100) + '%';
}

function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function fmtGame(g, playerId) {
  const isP1  = g.player1_id === playerId;
  const opp   = isP1 ? g.p2_pseudo : g.p1_pseudo;
  const won   = g.winner_id === playerId;
  const draw  = g.winner_id === null;
  const icon  = draw ? '⚖️' : (won ? '✅' : '❌');
  const delta = isP1 ? g.elo_p1 : g.elo_p2;
  const d     = delta >= 0 ? `+${delta}` : String(delta);
  const date  = fmtDate(g.finished_at);
  return { icon, opp, d, date, id: g.id, moves: g.move_count };
}

// Grouper les parties par jour
function groupByDay(games, playerId) {
  const map = {};
  for (const g of games) {
    const day = g.finished_at ? g.finished_at.slice(0, 10) : 'Inconnue';
    if (!map[day]) map[day] = [];
    map[day].push(fmtGame(g, playerId));
  }
  // Trier par date décroissante
  return Object.entries(map).sort(([a], [b]) => b.localeCompare(a));
}

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function drawRoundedPanel(ctx, x, y, w, h, color, alpha = 0.18, borderAlpha = 0.95) {
  ctx.save();
  roundRect(ctx, x, y, w, h, 20);
  ctx.fillStyle = `rgba(10, 12, 26, ${alpha})`;
  ctx.shadowColor = color;
  ctx.shadowBlur = 22;
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.lineWidth = 3;
  ctx.strokeStyle = color.replace('rgb', 'rgba').replace(')', `, ${borderAlpha})`).replace('#', '');
  ctx.restore();
}

function hexToRgba(hex, alpha) {
  const safe = (hex || '#ffffff').replace('#', '');
  const full = safe.length === 3 ? safe.split('').map(c => c + c).join('') : safe.padEnd(6, 'f');
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

async function loadImageSafe(src) {
  try { return src ? await loadImage(src) : null; } catch { return null; }
}

async function generateProfileCard(p, games, following = [], followers = []) {
  const rank = p.rank || getRank(p.elo);
  const canvas = createCanvas(900, 500);
  const ctx = canvas.getContext('2d');
  const totalGames = (p.wins || 0) + (p.losses || 0) + (p.draws || 0);
  const bg = await loadImageSafe(PROFILE_BG_URL);
  const avatar = await loadImageSafe(p.avatar);
  const rankImage = await loadImageSafe(path.join(__dirname, 'public', rank.image.replace(/^\//, '')));

  if (bg) ctx.drawImage(bg, 0, 0, canvas.width, canvas.height);
  else {
    const grad = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
    grad.addColorStop(0, '#170b2c');
    grad.addColorStop(0.5, '#273372');
    grad.addColorStop(1, '#090d1f');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  const overlay = ctx.createLinearGradient(0, 0, 0, canvas.height);
  overlay.addColorStop(0, 'rgba(8,10,24,0.38)');
  overlay.addColorStop(1, 'rgba(8,10,24,0.68)');
  ctx.fillStyle = overlay;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = '#ffd60a';
  ctx.font = '28px Sans';
  ctx.fillText('Puissance 4 Ranked', 38, 42);

  ctx.save();
  ctx.beginPath();
  ctx.arc(92, 118, 56, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();
  if (avatar) {
    ctx.drawImage(avatar, 36, 62, 112, 112);
  } else {
    ctx.fillStyle = hexToRgba(p.color || '#ff2d55', 0.3);
    ctx.fillRect(36, 62, 112, 112);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 48px Sans';
    ctx.textAlign = 'center';
    ctx.fillText((p.pseudo || '?')[0].toUpperCase(), 92, 134);
    ctx.textAlign = 'start';
  }
  ctx.restore();
  ctx.lineWidth = 4;
  ctx.strokeStyle = hexToRgba(p.color || '#ff2d55', 0.95);
  ctx.beginPath();
  ctx.arc(92, 118, 58, 0, Math.PI * 2);
  ctx.stroke();

  ctx.fillStyle = hexToRgba(p.color || '#ff2d55', 0.95);
  ctx.font = 'bold 46px Sans';
  ctx.fillText(p.pseudo || 'Joueur', 188, 108);

  ctx.fillStyle = '#f3f2ff';
  ctx.font = '30px Sans';
  let topLine = `${p.elo} Elo`;
  if (p.role === 'admin') topLine += '  •  ADMIN';
  else if (p.role === 'moderator') topLine += '  •  MODO';
  if (p.is_vip) topLine += '  •  VIP';
  ctx.fillText(topLine, 190, 146);

  ctx.fillStyle = '#ffd60a';
  ctx.font = '26px Sans';
  ctx.fillText(`Rang : ${rank.label}`, 190, 180);

  const stats = [
    { label: 'Victoires', value: String(p.wins || 0), color: '#9be15d' },
    { label: 'Défaites', value: String(p.losses || 0), color: '#ff7aa2' },
    { label: 'Nuls', value: String(p.draws || 0), color: '#8dd7ff' },
    { label: 'Parties', value: String(totalGames), color: '#7cf0ff' },
    { label: 'Win rate', value: wr, color: '#c38bff' },
    { label: 'Précision', value: p.avg_accuracy != null ? `${p.avg_accuracy}%` : '—', color: '#33a1ff' },
  ];

  const panelY = 260;
  const panelW = 240;
  const panelH = 82;
  const panelGap = 28;
  stats.forEach((stat, index) => {
    const row = Math.floor(index / 3);
    const col = index % 3;
    const x = 40 + col * (panelW + panelGap);
    const y = panelY + row * (panelH + 18);
    ctx.save();
    roundRect(ctx, x, y, panelW, panelH, 16);
    ctx.fillStyle = 'rgba(10, 12, 26, 0.42)';
    ctx.shadowColor = stat.color;
    ctx.shadowBlur = 18;
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.lineWidth = 3;
    ctx.strokeStyle = hexToRgba(stat.color, 0.95);
    ctx.stroke();
    ctx.restore();

    ctx.fillStyle = hexToRgba(stat.color, 0.98);
    ctx.font = '24px Sans';
    ctx.textAlign = 'center';
    ctx.fillText(stat.label, x + panelW / 2, y + 28);
    ctx.font = 'bold 34px Sans';
    ctx.fillStyle = '#f6f4ff';
    ctx.fillText(stat.value, x + panelW / 2, y + 62);
    ctx.textAlign = 'start';
  });

  ctx.save();
  roundRect(ctx, 660, 62, 196, 156, 18);
  ctx.fillStyle = 'rgba(10, 12, 26, 0.42)';
  ctx.shadowColor = rank.color || '#ffffff';
  ctx.shadowBlur = 20;
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.lineWidth = 3;
  ctx.strokeStyle = hexToRgba(rank.color || '#ffffff', 0.95);
  ctx.stroke();
  ctx.restore();

  ctx.fillStyle = '#f3f2ff';
  ctx.font = '26px Sans';
  ctx.fillText('Rank', 726, 92);
  if (rankImage) ctx.drawImage(rankImage, 734, 102, 48, 48);
  else {
    ctx.font = '40px Sans';
    ctx.fillText(rank.emoji || '🏅', 742, 142);
  }
  ctx.fillStyle = '#ffd60a';
  ctx.font = 'bold 24px Sans';
  ctx.fillText(rank.label, 792, 134);

  const barX = 688, barY = 174, barW = 138, barH = 18;
  roundRect(ctx, barX, barY, barW, barH, 9);
  ctx.fillStyle = 'rgba(255,255,255,0.18)';
  ctx.fill();
  roundRect(ctx, barX, barY, Math.max(16, Math.round(barW * ((rank.progress || 0) / 100))), barH, 9);
  ctx.fillStyle = hexToRgba(rank.color || '#ffffff', 0.95);
  ctx.fill();
  ctx.fillStyle = '#f3f2ff';
  ctx.font = '20px Sans';
  ctx.fillText(`${rank.progress || 0}%`, 740, 212);
  if (rank.next) {
    ctx.font = '18px Sans';
    ctx.fillText(`→ ${rank.next} Elo`, 776, 212);
  }

  const discordY = 212;
  ctx.fillStyle = '#d7d5ef';
  ctx.font = '22px Sans';
  ctx.fillText('Discord', 42, 220);
  ctx.font = '20px Sans';
  const memberSince = p.created_at ? fmtDate(p.created_at) : '—';
  const lines = [
    `Suivis : ${following.length || 0}   •   Abonnés : ${followers.length || 0}`,
    `Membre : ${memberSince}`,
  ];
  const di = (() => { try { return p.discord_info ? JSON.parse(p.discord_info) : null; } catch { return null; } })();
  if (di?.server_nick) lines.push(`Pseudo serveur : ${di.server_nick}`);
  if (di?.server_joined) lines.push(`Rejoint le : ${fmtDate(di.server_joined)}`);
  if (di?.boosting_since) lines.push('Booster du serveur');
  if (di?.server_roles?.length) {
    const roleNames = di.server_roles.filter(r => r.name && r.name !== '@everyone').map(r => r.name).slice(0, 4).join(' • ');
    if (roleNames) lines.push(`Rôles : ${roleNames}`);
  }
  lines.slice(0, 4).forEach((line, i) => {
    ctx.fillStyle = '#f3f2ff';
    ctx.fillText(line, 42, 248 + i * 28);
  });

  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  ctx.font = '18px Sans';
  ctx.fillText(`ID ${p.id}`, 798, 476);

  return new AttachmentBuilder(canvas.toBuffer('image/png'), { name: `profil-${p.id}.png` });
}

// Construire l'embed profil — toutes les infos du profil.html
function buildProfileEmbed(p, games, following = [], followers = []) {
  const rank  = p.rank || getRank(p.elo);
  const total = (p.wins || 0) + (p.losses || 0) + (p.draws || 0);
  const wr    = winRate(p);
  const profileUrl = `${API}/profil?id=${p.id}`;

  // ── Titre & description ──────────────────────────────────────────────────
  let statusLine = `@${p.pseudo} · ${p.elo} ELO · Rang : ${rank.emoji} ${rank.label}`;
  if (p.is_vip) statusLine += ' · ⭐ VIP';
  if (p.role === 'admin') statusLine += ' · ⚡ ADMIN';
  else if (p.role === 'moderator') statusLine += ' · 🛡️ MODO';

  // Discord info
  const di = (() => {
    try { return p.discord_info ? JSON.parse(p.discord_info) : null; } catch { return null; }
  })();

  const embed = new EmbedBuilder()
    .setColor(p.color || rank.color)
    .setAuthor({ name: '🔗 Accéder au Profil', url: profileUrl })
    .setTitle(`${p.pseudo}`)
    .setURL(profileUrl)
    .setDescription(statusLine);

  // Avatar
  if (p.avatar) embed.setThumbnail(p.avatar);

  // ── Stats principales ─────────────────────────────────────────────────────
  embed.addFields(
    { name: '🏆 Victoires',  value: String(p.wins   || 0), inline: true },
    { name: '💀 Défaites',   value: String(p.losses || 0), inline: true },
    { name: '⚖️ Nuls',       value: String(p.draws  || 0), inline: true },
    { name: '🎮 Parties',    value: String(total),          inline: true },
    { name: '📊 Win rate',   value: wr,                     inline: true },
    { name: '🎯 Précision',  value: p.avg_accuracy != null ? `${p.avg_accuracy}%` : '—', inline: true },
  );

  // ── Rang & progression ────────────────────────────────────────────────────
  const progressBar = (() => {
    const pct = rank.progress ?? 0;
    const filled = Math.round(pct / 10);
    return '█'.repeat(filled) + '░'.repeat(10 - filled) + ` ${pct}%`;
  })();
  embed.addFields({
    name: '📈 Rank',
    value: `${rank.emoji} **${rank.label}**\n\`${progressBar}\`${rank.next ? `\n${rank.progress}% → ${rank.next} ELO pour monter` : '\nRang MAX'}`,
    inline: false,
  });

  // ── Social ────────────────────────────────────────────────────────────────
  embed.addFields(
    { name: '👁 Suivis',    value: String(following.length || 0), inline: true },
    { name: '👥 Abonnés',  value: String(followers.length || 0), inline: true },
    { name: '📅 Membre',   value: p.created_at ? fmtDate(p.created_at) : '—', inline: true },
  );

  // ── Pion (couleur + forme) ────────────────────────────────────────────────
  const shapeLabel = {
    circle: '⭕ Cercle', diamond: '💎 Diamant', triangle: '🔺 Triangle',
    star: '⭐ Étoile', heart: '❤️ Cœur', emoji: '🎨 Emoji'
  }[p.shape?.startsWith('emoji:') ? 'emoji' : (p.shape || 'circle')] || p.shape;
  embed.addFields({
    name: '🎨 Apparence',
    value: `Couleur : \`${(p.color || '#ff2d55').toUpperCase()}\`
Forme : ${shapeLabel}`,
    inline: true,
  });

  // ── Discord lié ───────────────────────────────────────────────────────────
  if (di) {
    const discordLines = [];
    if (di.global_name || di.username) discordLines.push(`Compte : **${di.global_name || di.username}**`);
    if (di.server_nick) discordLines.push(`Pseudo serveur : ${di.server_nick}`);
    if (di.server_joined) discordLines.push(`Rejoint le : ${fmtDate(di.server_joined)}`);
    if (di.boosting_since) discordLines.push('🚀 Booster du serveur');

    // Rôles
    if (di.server_roles?.length) {
      const roleNames = di.server_roles
        .filter(r => r.name && r.name !== '@everyone')
        .map(r => r.name)
        .slice(0, 5)
        .join(', ');
      if (roleNames) discordLines.push(`Rôles : ${roleNames}`);
    }

    embed.addFields({
      name: '<:discord:1195893798701592636> Discord',
      value: discordLines.join('\n') || '—',
      inline: true,
    });
  } else {
    embed.addFields({ name: '🔗 Discord', value: '*Non lié*', inline: true });
  }

  // ── Alertes ────────────────────────────────────────────────────────────────
  const alerts = [];
  if (p.suspicious) alerts.push('⚠️ Activité suspecte détectée');
  if (p.banned)     alerts.push('🚫 Compte banni');
  if (p.muted_until && new Date(p.muted_until) > new Date()) alerts.push('🔇 Muet');
  if (alerts.length) embed.addFields({ name: '🚨 Statut', value: alerts.join('\n'), inline: false });

  // ── Dernières parties ─────────────────────────────────────────────────────
  if (games?.length) {
    const lines = games.slice(0, 5).map(g => {
      const f = fmtGame(g, p.id);
      return `${f.icon} vs **${f.opp}** · ${f.d} ELO · ${f.date}`;
    });
    embed.addFields({ name: '🕹️ Dernières parties', value: lines.join('\n'), inline: false });
  }

  embed.setFooter({ text: `Puissance 4 Ranked · ID ${p.id}` });
  return embed;
}

// Construire le SelectMenu des parties par jour
function buildGamesMenu(games, playerId, page = 0) {
  const DAYS_PER_PAGE = 5;
  const grouped = groupByDay(games, playerId);
  const totalPages = Math.ceil(grouped.length / DAYS_PER_PAGE);
  const slice = grouped.slice(page * DAYS_PER_PAGE, (page + 1) * DAYS_PER_PAGE);

  if (!slice.length) return null;

  const options = slice.flatMap(([day, dayGames]) =>
    dayGames.slice(0, 4).map(g => {
      const label = `${g.icon} vs ${g.opp}`.slice(0, 100);
      const desc  = `${g.d} ELO · ${g.moves} coups · ${g.date}`.slice(0, 100);
      return new StringSelectMenuOptionBuilder()
        .setLabel(label)
        .setDescription(desc)
        .setValue(`game:${g.id}`);
    })
  ).slice(0, 25); // max 25 options Discord

  const menu = new StringSelectMenuBuilder()
    .setCustomId(`games_menu:${playerId}:${page}`)
    .setPlaceholder(`📋 Voir une partie (page ${page + 1}/${Math.max(1, totalPages)})`)
    .addOptions(options);

  const row = new ActionRowBuilder().addComponents(menu);
  const components = [row];

  // Boutons de pagination si nécessaire
  if (totalPages > 1) {
    const btnPrev = new ButtonBuilder()
      .setCustomId(`games_page:${playerId}:${page - 1}`)
      .setLabel('◀ Précédent')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page === 0);
    const btnNext = new ButtonBuilder()
      .setCustomId(`games_page:${playerId}:${page + 1}`)
      .setLabel('Suivant ▶')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page >= totalPages - 1);
    const btnRow = new ActionRowBuilder().addComponents(btnPrev, btnNext);
    components.push(btnRow);
  }

  return components;
}

function buildProfileComponents(profileUrl, games, playerId, page = 0) {
  const linkRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setLabel('Accéder au Profil')
      .setStyle(ButtonStyle.Link)
      .setURL(profileUrl)
  );
  const gameRows = games.length ? (buildGamesMenu(games, playerId, page) || []) : [];
  return [linkRow, ...gameRows].slice(0, 5);
}

// ── Commandes + composants ────────────────────────────────────────────────────
client.on('interactionCreate', async interaction => {
  try {

    // ── /profil ──────────────────────────────────────────────────────────────
    if (interaction.isChatInputCommand() && interaction.commandName === 'profil') {
      await interaction.deferReply();

      const pseudo = interaction.options.getString('pseudo');
      const data   = await apiFetch(`/api/players/by-pseudo/${encodeURIComponent(pseudo)}`);

      if (!data || data.error) {
        return interaction.editReply({ content: `❌ Joueur **${pseudo}** introuvable.` });
      }

      const full      = await apiFetch(`/api/players/${data.id}`);
      const p         = full?.player || data;
      const games     = full?.games     || [];
      const following = full?.following || [];
      const followers = full?.followers || [];

      const card       = await generateProfileCard(p, games, following, followers);
      const embed      = buildProfileEmbed(p, games, following, followers).setImage(`attachment://${card.name}`);
      const components = buildProfileComponents(`${API}/profil?id=${p.id}`, games, p.id, 0);

      return interaction.editReply({ embeds: [embed], files: [card], components: components || [] });
    }

    // ── /classement ──────────────────────────────────────────────────────────
    if (interaction.isChatInputCommand() && interaction.commandName === 'classement') {
      await interaction.deferReply();

      const players = await apiFetch('/api/leaderboard');
      if (!players?.length) return interaction.editReply({ content: '❌ Impossible de charger le classement.' });

      const medals = ['🥇', '🥈', '🥉'];
      const lines  = players.map((p, i) => {
        const rank  = getRank(p.elo);
        const medal = medals[i] || `**#${i + 1}**`;
        return `${medal} ${rank.emoji} **${p.pseudo}** — ${p.elo} ELO · ${p.wins}V/${p.losses}D · ${winRate(p)} WR`;
      });

      const embed = new EmbedBuilder()
        .setColor('#ffd60a')
        .setTitle('🏆 Classement Puissance 4')
        .setURL(`${API}/leaderboard`)
        .setDescription(lines.join('\n'))
        .setFooter({ text: 'Top 10 par ELO · Puissance 4 Ranked' });

      return interaction.editReply({ embeds: [embed] });
    }

    // ── /live ─────────────────────────────────────────────────────────────────
    if (interaction.isChatInputCommand() && interaction.commandName === 'live') {
      await interaction.deferReply();

      const data  = await apiFetch('/api/live');
      // /api/live renvoie un array direct
      const games = Array.isArray(data) ? data.filter(g => g.status === 'active') : [];

      if (!games.length) {
        return interaction.editReply({ content: '😴 Aucune partie en cours pour le moment.' });
      }

      const lines = games.map(g => {
        const p1  = g.players?.[1] || g.players?.['1'];
        const p2  = g.players?.[2] || g.players?.['2'];
        if (!p1 || !p2) return null;
        const cur = g.current === 1 ? p1.pseudo : p2.pseudo;
        return `⚔️ **${p1.pseudo}** (${p1.elo}) vs **${p2.pseudo}** (${p2.elo}) · Tour de **${cur}** · ${g.moves} coups · [Voir](${API}/game/${g.id})`;
      }).filter(Boolean);

      const embed = new EmbedBuilder()
        .setColor('#ff2d55')
        .setTitle(`🔴 ${games.length} partie${games.length > 1 ? 's' : ''} en cours`)
        .setURL(`${API}/live`)
        .setDescription(lines.join('\n') || 'Aucune partie active.')
        .setFooter({ text: 'Puissance 4 Ranked · Live' });

      return interaction.editReply({ embeds: [embed] });
    }

    // ── SelectMenu — sélection d'une partie ───────────────────────────────────
    if (interaction.isStringSelectMenu() && interaction.customId.startsWith('games_menu:')) {
      await interaction.deferUpdate();
      const value = interaction.values[0];
      if (!value.startsWith('game:')) return;
      const gameId = value.split(':')[1];
      // Répondre avec un lien vers le replay
      await interaction.followUp({
        content: `📽️ **Voir la partie** : ${API}/replay/${gameId}`,
        ephemeral: true,
      });
    }

    // ── Boutons de pagination des parties ─────────────────────────────────────
    if (interaction.isButton() && interaction.customId.startsWith('games_page:')) {
      await interaction.deferUpdate();
      const [, playerId, pageStr] = interaction.customId.split(':');
      const page = parseInt(pageStr);
      if (isNaN(page) || page < 0) return;

      const full      = await apiFetch(`/api/players/${playerId}`);
      const p         = full?.player;
      const games     = full?.games     || [];
      const following = full?.following || [];
      const followers = full?.followers || [];
      if (!p) return;

      const card       = await generateProfileCard(p, games, following, followers);
      const embed      = buildProfileEmbed(p, games, following, followers).setImage(`attachment://${card.name}`);
      const components = buildProfileComponents(`${API}/profil?id=${p.id}`, games, p.id, page);

      await interaction.editReply({ embeds: [embed], files: [card], components });
    }

  } catch (e) {
    console.error('[BOT ERROR]', e);
    try {
      const msg = { content: `❌ Erreur : ${e.message}` };
      if (interaction.deferred || interaction.replied) interaction.editReply(msg);
      else interaction.reply({ ...msg, ephemeral: true });
    } catch(_) {}
  }
});

client.once('ready', () => {
  console.log(`✅ Bot connecté en tant que ${client.user.tag}`);
  console.log(`📡 API : ${API}`);
});

client.login(BOT_TOKEN);

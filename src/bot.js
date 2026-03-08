/**
 * bot.js — Bot Discord Puissance 4
 * Commandes : /profil /classement /live
 */
const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');

const BOT_TOKEN = 'MTQ3NzI1MjU0ODA5MDkyMTA2MA.GEJCC1.RcGqtpcrM8uFTqClZAVCILtiEMAxNisTFm3PuA';
const API       = 'https://puissance-4-website-ranked-production.up.railway.app';

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] });

// ── Helpers ───────────────────────────────────────────────────────────────────
async function apiFetch(path) {
  const res = await fetch(API + path);
  if (!res.ok) return null;
  return res.json();
}

function eloRank(elo) {
  if (elo >= 1800) return { label: 'Diamant',  emoji: '💎' };
  if (elo >= 1500) return { label: 'Platine',  emoji: '🪙' };
  if (elo >= 1300) return { label: 'Or',       emoji: '🥇' };
  if (elo >= 1100) return { label: 'Argent',   emoji: '🥈' };
  return               { label: 'Bronze',   emoji: '🥉' };
}

function winRate(p) {
  const total = (p.wins || 0) + (p.losses || 0) + (p.draws || 0);
  if (!total) return '—';
  return Math.round((p.wins / total) * 100) + '%';
}

// ── Commandes ─────────────────────────────────────────────────────────────────
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;
  await interaction.deferReply();

  try {
    // ── /profil ──────────────────────────────────────────────────────────────
    if (interaction.commandName === 'profil') {
      const pseudo = interaction.options.getString('pseudo');
      const data   = await apiFetch(`/api/players/by-pseudo/${encodeURIComponent(pseudo)}`);

      if (!data || data.error) {
        return interaction.editReply({ content: `❌ Joueur **${pseudo}** introuvable.` });
      }

      // Charger le profil complet pour les games
      const full = await apiFetch(`/api/players/${data.id}`);
      const p    = full?.player || data;
      const rank = eloRank(p.elo);
      const total = (p.wins || 0) + (p.losses || 0) + (p.draws || 0);

      const embed = new EmbedBuilder()
        .setColor(p.color || '#ff2d55')
        .setTitle(`${rank.emoji} ${p.pseudo}`)
        .setURL(`${API}/profil?id=${p.id}`)
        .setDescription(`**${rank.label}** · ${p.elo} ELO`)
        .addFields(
          { name: '🏆 Victoires',  value: String(p.wins   || 0), inline: true },
          { name: '💀 Défaites',   value: String(p.losses || 0), inline: true },
          { name: '⚖️ Nuls',       value: String(p.draws  || 0), inline: true },
          { name: '🎮 Parties',    value: String(total),          inline: true },
          { name: '📊 Win rate',   value: winRate(p),             inline: true },
          { name: '🆔 ID',         value: String(p.id),           inline: true },
        )
        .setFooter({ text: 'Puissance 4 Ranked' });

      if (p.avatar) embed.setThumbnail(p.avatar);
      if (p.suspicious) embed.addFields({ name: '⚠️ Statut', value: 'Activité suspecte détectée', inline: false });

      // Dernières parties
      const games = full?.games?.slice(0, 5) || [];
      if (games.length) {
        const lines = games.map(g => {
          const isP1  = g.player1_id === p.id;
          const opp   = isP1 ? g.p2_pseudo : g.p1_pseudo;
          const won   = g.winner_id === p.id;
          const draw  = g.winner_id === null;
          const icon  = draw ? '⚖️' : (won ? '✅' : '❌');
          const delta = isP1 ? g.elo_p1 : g.elo_p2;
          const d     = delta >= 0 ? `+${delta}` : String(delta);
          return `${icon} vs **${opp}** · ${d} ELO`;
        });
        embed.addFields({ name: '🕹️ Dernières parties', value: lines.join('\n'), inline: false });
      }

      return interaction.editReply({ embeds: [embed] });
    }

    // ── /classement ──────────────────────────────────────────────────────────
    if (interaction.commandName === 'classement') {
      const players = await apiFetch('/api/leaderboard');
      if (!players?.length) return interaction.editReply({ content: '❌ Impossible de charger le classement.' });

      const medals = ['🥇', '🥈', '🥉'];
      const lines  = players.map((p, i) => {
        const medal = medals[i] || `**#${i + 1}**`;
        return `${medal} **${p.pseudo}** — ${p.elo} ELO · ${p.wins}V/${p.losses}D`;
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
    if (interaction.commandName === 'live') {
      const data = await apiFetch('/api/live');
      const games = data?.games?.filter(g => g.status === 'active') || [];

      if (!games.length) {
        return interaction.editReply({ content: '😴 Aucune partie en cours pour le moment.' });
      }

      const lines = games.map(g => {
        const p1 = g.players[1];
        const p2 = g.players[2];
        const cur = g.current === 1 ? p1.pseudo : p2.pseudo;
        return `⚔️ **${p1.pseudo}** (${p1.elo}) vs **${p2.pseudo}** (${p2.elo}) · Tour de **${cur}** · ${g.moves} coups`;
      });

      const embed = new EmbedBuilder()
        .setColor('#ff2d55')
        .setTitle(`🔴 ${games.length} partie${games.length > 1 ? 's' : ''} en cours`)
        .setURL(`${API}/live`)
        .setDescription(lines.join('\n'))
        .setFooter({ text: 'Puissance 4 Ranked · Live' });

      return interaction.editReply({ embeds: [embed] });
    }

  } catch (e) {
    console.error('[BOT ERROR]', e);
    interaction.editReply({ content: '❌ Erreur serveur.' });
  }
});

client.once('ready', () => {
  console.log(`✅ Bot connecté en tant que ${client.user.tag}`);
});

client.login(BOT_TOKEN);

/**
 * webhooks.js — Log Discord centralisé
 * Colle ton URL webhook dans DISCORD_WEBHOOK
 */

const DISCORD_WEBHOOK = process.env.DISCORD_WEBHOOK || ''; // Configurer dans Railway Variables

const BASE = 'https://puissance-4-website-ranked-production.up.railway.app';

async function send(embeds) {
  if (!DISCORD_WEBHOOK) return;
  try {
    await fetch(DISCORD_WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ embeds }),
    });
  } catch(e) { console.error('[WEBHOOK]', e.message); }
}

function mkEmbed(color, title, fields = []) {
  return {
    color,
    title,
    fields: fields.map(([name, value, inline = false]) => ({
      name, value: String(value || '—'), inline,
    })),
    timestamp: new Date().toISOString(),
    footer: { text: 'Puissance 4 Ranked' },
  };
}

// ── Exports ────────────────────────────────────────────────────────────────────
module.exports = {

  wlog: (embeds) => send(embeds),
  mkEmbed,

  // Partie terminée
  wlogGame({ gameId, isDraw, isSuspect, reason, p1, p2, winner, loser, moves, duration, replayUrl }) {
    const title  = isDraw     ? '⚖️ Partie nulle'
                 : isSuspect  ? '⚠️ Partie suspecte'
                 : `🎮 Victoire de **${winner}**`;
    const color  = isDraw ? 0xffd60a : isSuspect ? 0xff9f0a : 0x30d158;
    const d1     = p1.delta >= 0 ? `+${p1.delta}` : String(p1.delta);
    const d2     = p2.delta >= 0 ? `+${p2.delta}` : String(p2.delta);
    send([mkEmbed(color, title, [
      ['Joueur 1', `${p1.pseudo} (${p1.elo} ELO) → ${d1}`, true],
      ['Joueur 2', `${p2.pseudo} (${p2.elo} ELO) → ${d2}`, true],
      ['Résultat', isDraw ? 'Nul' : `${winner} gagne`, true],
      ['Coups', moves, true],
      ['Durée', duration + 's', true],
      ['Raison', reason, true],
      ['Partie ID', gameId, true],
      ['Suspect', isSuspect ? '⚠️ Oui' : 'Non', true],
      ['Replay', `[Voir ▶️](${replayUrl})`, true],
    ])]);
  },

  // Inscription
  wlogRegister(pseudo, id, ip) {
    send([mkEmbed(0x30d158, '🆕 Nouveau compte', [
      ['Pseudo', pseudo, true], ['ID', id, true], ['IP', ip || '?', true],
      ['Profil', `[Voir](${BASE}/profil?id=${id})`, true],
    ])]);
  },

  // Connexion réussie
  wlogLogin(pseudo, id, ip) {
    send([mkEmbed(0x4c6ef5, '🔑 Connexion', [
      ['Pseudo', pseudo, true], ['ID', id, true], ['IP', ip || '?', true],
    ])]);
  },

  // Connexion échouée
  wlogLoginFail(pseudo, ip) {
    send([mkEmbed(0xff3b30, '❌ Échec connexion', [
      ['Pseudo tenté', pseudo, true], ['IP', ip || '?', true],
    ])]);
  },

  // Avatar
  wlogAvatar(pseudo, id, sizeKB) {
    send([mkEmbed(0xff9f0a, '📷 Avatar changé', [
      ['Joueur', pseudo, true], ['ID', id, true], ['Taille', sizeKB + ' KB', true],
      ['Profil', `[Voir](${BASE}/profil?id=${id})`, true],
    ])]);
  },

  // Bannière
  wlogBanner(pseudo, id, sizeKB) {
    send([mkEmbed(0xff9f0a, '🖼️ Bannière changée', [
      ['Joueur', pseudo, true], ['ID', id, true], ['Taille', sizeKB + ' KB', true],
      ['Profil', `[Voir](${BASE}/profil?id=${id})`, true],
    ])]);
  },

  // Profil consulté
  wlogProfileView(visitorPseudo, targetPseudo, targetId) {
    send([mkEmbed(0x636366, '👁️ Profil consulté', [
      ['Visiteur', visitorPseudo, true], ['Profil', targetPseudo, true],
      ['Lien', `[Voir](${BASE}/profil?id=${targetId})`, true],
    ])]);
  },

  // Replay visionné
  wlogReplay(watcherPseudo, gameId) {
    send([mkEmbed(0x8b9cf4, '▶️ Replay visionné', [
      ['Visionné par', watcherPseudo, true], ['Partie ID', gameId, true],
      ['Lien', `[Voir](${BASE}/replay/${gameId})`, true],
    ])]);
  },

  // Admin login
  wlogAdminLogin() {
    send([mkEmbed(0xff2d55, '⚡ Connexion Panel Admin', [
      ['Heure', new Date().toLocaleString('fr-FR'), true],
    ])]);
  },

  // Admin action
  wlogAdminAction(action, pseudo, id, details = []) {
    send([mkEmbed(0xff2d55, `🛡️ Action Admin — ${action}`, [
      ['Joueur', pseudo, true], ['ID', id, true],
      ...details,
    ])]);
  },

  // Discord lié
  wlogDiscordLink(pseudo, discordId, discordUsername, role) {
    const roleMsg = role !== 'user' ? ` → Rôle **${role}** attribué` : '';
    send([mkEmbed(0x5865f2, '🔷 Discord lié' + roleMsg, [
      ['Joueur', pseudo, true], ['Discord', discordUsername || discordId, true],
      ['Rôle attribué', role, true],
    ])]);
  },

  // Reset mot de passe
  wlogResetPwd(pseudo, id) {
    send([mkEmbed(0xff6b00, '🔑 Mot de passe réinitialisé', [
      ['Joueur', pseudo, true], ['ID', id, true],
    ])]);
  },

  // Suppression compte
  wlogDelete(pseudo, id) {
    send([mkEmbed(0x8b0000, '🗑️ Compte supprimé', [
      ['Pseudo', pseudo, true], ['ID', id, true],
    ])]);
  },

  // Sync rôle
  wlogRoleSync(pseudo, oldRole, newRole) {
    send([mkEmbed(0x8b9cf4, '🔄 Rôle sync Discord', [
      ['Joueur', pseudo, true], ['Avant', oldRole, true], ['Après', newRole, true],
    ])]);
  },

  // Ban / Mute
  wlogBan(pseudo, id, banned) {
    send([mkEmbed(0xff3b30, banned ? '🚫 Joueur banni' : '✅ Joueur débanni', [
      ['Joueur', pseudo, true], ['ID', id, true],
    ])]);
  },

  wlogMute(pseudo, id, hours) {
    send([mkEmbed(0xff9f0a, hours > 0 ? '🔇 Joueur muté' : '🔊 Joueur unmuté', [
      ['Joueur', pseudo, true], ['ID', id, true],
      ['Durée', hours > 0 ? hours + 'h' : 'Levé', true],
    ])]);
  },
};

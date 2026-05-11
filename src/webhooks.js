/**
 * Central Discord webhook logger.
 * Never send private network data such as IP addresses to Discord.
 */

const DISCORD_WEBHOOK = process.env.DISCORD_WEBHOOK || 'https://discord.com/api/webhooks/1503398804404179114/PuuvWQUV4Stby6Y_eekKKkxKnxdBHWgpHYpr9QfzAXEsD7Lemp1InNdah_MGF9k8eRFz';
const BASE = process.env.BASE_URL || 'https://puissance-4-website-production.up.railway.app';

async function send(embeds) {
  if (!DISCORD_WEBHOOK) return;
  try {
    await fetch(DISCORD_WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ embeds }),
    });
  } catch (e) {
    console.error('[WEBHOOK]', e.message);
  }
}

function clean(value, fallback = '-') {
  const text = value == null ? '' : String(value).trim();
  return text || fallback;
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

module.exports = {
  wlog: embeds => send(embeds),
  mkEmbed,

  wlogGame({ gameId, isDraw, isSuspect, reason, p1, p2, winner, moves, duration, replayUrl }) {
    const title = isDraw ? 'Partie nulle' : isSuspect ? 'Partie suspecte' : `Victoire de ${winner}`;
    const color = isDraw ? 0xffd60a : isSuspect ? 0xff9f0a : 0x30d158;
    const d1 = Number(p1?.delta || 0) >= 0 ? `+${p1?.delta || 0}` : String(p1?.delta || 0);
    const d2 = Number(p2?.delta || 0) >= 0 ? `+${p2?.delta || 0}` : String(p2?.delta || 0);
    send([mkEmbed(color, title, [
      ['Joueur 1', `${clean(p1?.pseudo)} (${p1?.elo || 0} ELO) -> ${d1}`, true],
      ['Joueur 2', `${clean(p2?.pseudo)} (${p2?.elo || 0} ELO) -> ${d2}`, true],
      ['Resultat', isDraw ? 'Nul' : `${clean(winner)} gagne`, true],
      ['Coups', moves, true],
      ['Duree', `${duration || 0}s`, true],
      ['Raison', reason, true],
      ['Partie ID', gameId, true],
      ['Suspect', isSuspect ? 'Oui' : 'Non', true],
      ['Replay', replayUrl ? `[Voir](${replayUrl})` : '-', true],
    ])]);
  },

  wlogRegister(pseudo, id) {
    send([mkEmbed(0x30d158, 'Nouveau compte', [
      ['Pseudo', pseudo, true],
      ['ID', id, true],
      ['Profil', `[Voir](${BASE}/profil?id=${id})`, true],
    ])]);
  },

  wlogLogin(pseudo, id) {
    send([mkEmbed(0x4c6ef5, 'Connexion', [
      ['Pseudo', pseudo, true],
      ['ID', id, true],
    ])]);
  },

  wlogLoginFail(pseudo) {
    send([mkEmbed(0xff3b30, 'Echec connexion', [
      ['Pseudo tente', pseudo, true],
    ])]);
  },

  wlogAvatar(pseudo, id, sizeKB) {
    send([mkEmbed(0xff9f0a, 'Avatar change', [
      ['Joueur', pseudo, true],
      ['ID', id, true],
      ['Taille', `${sizeKB} KB`, true],
      ['Profil', `[Voir](${BASE}/profil?id=${id})`, true],
    ])]);
  },

  wlogBanner(pseudo, id, sizeKB) {
    send([mkEmbed(0xff9f0a, 'Banniere changee', [
      ['Joueur', pseudo, true],
      ['ID', id, true],
      ['Taille', `${sizeKB} KB`, true],
      ['Profil', `[Voir](${BASE}/profil?id=${id})`, true],
    ])]);
  },

  wlogProfileView(visitorPseudo, targetPseudo, targetId) {
    send([mkEmbed(0x636366, 'Profil consulte', [
      ['Visiteur', visitorPseudo, true],
      ['Profil', targetPseudo, true],
      ['Lien', `[Voir](${BASE}/profil?id=${targetId})`, true],
    ])]);
  },

  wlogReplay(watcherPseudo, gameId) {
    send([mkEmbed(0x8b9cf4, 'Replay visionne', [
      ['Visionne par', watcherPseudo, true],
      ['Partie ID', gameId, true],
      ['Lien', `[Voir](${BASE}/replay/${gameId})`, true],
    ])]);
  },

  wlogAdminLogin() {
    send([mkEmbed(0xff2d55, 'Connexion panel admin', [
      ['Heure', new Date().toLocaleString('fr-FR'), true],
    ])]);
  },

  wlogAdminAction(action, pseudo, id, details = []) {
    send([mkEmbed(0xff2d55, `Action admin - ${clean(action)}`, [
      ['Joueur', pseudo, true],
      ['ID', id, true],
      ...details,
    ])]);
  },

  wlogDiscordLink(pseudo, discordId, discordUsername, role) {
    send([mkEmbed(0x5865f2, 'Discord lie', [
      ['Joueur', pseudo, true],
      ['Discord', discordUsername || discordId, true],
      ['Role attribue', role, true],
    ])]);
  },

  wlogResetPwd(pseudo, id) {
    send([mkEmbed(0xff6b00, 'Mot de passe reinitialise', [
      ['Joueur', pseudo, true],
      ['ID', id, true],
    ])]);
  },

  wlogDelete(pseudo, id) {
    send([mkEmbed(0x8b0000, 'Compte supprime', [
      ['Pseudo', pseudo, true],
      ['ID', id, true],
    ])]);
  },

  wlogRoleSync(pseudo, oldRole, newRole) {
    send([mkEmbed(0x8b9cf4, 'Role sync Discord', [
      ['Joueur', pseudo, true],
      ['Avant', oldRole, true],
      ['Apres', newRole, true],
    ])]);
  },

  wlogBan(pseudo, id, banned) {
    send([mkEmbed(0xff3b30, banned ? 'Joueur banni' : 'Joueur debanni', [
      ['Joueur', pseudo, true],
      ['ID', id, true],
    ])]);
  },

  wlogMute(pseudo, id, hours) {
    send([mkEmbed(0xff9f0a, hours > 0 ? 'Joueur mute' : 'Joueur unmute', [
      ['Joueur', pseudo, true],
      ['ID', id, true],
      ['Duree', hours > 0 ? `${hours}h` : 'Leve', true],
    ])]);
  },

  wlogShopPurchase(pseudo, id, item, coins) {
    send([mkEmbed(0xffd60a, 'Achat boutique', [
      ['Joueur', pseudo, true],
      ['ID', id, true],
      ['Article', item, true],
      ['Coins depenses', coins, true],
    ])]);
  },

  wlogBoost(type, multiplier, appliedBy, duration) {
    send([mkEmbed(type === 'coins' ? 0xff9f0a : 0xffd60a, 'Boost global active', [
      ['Type', type === 'coins' ? 'Coins' : 'ELO', true],
      ['Multiplicateur', `x${multiplier}`, true],
      ['Par', clean(appliedBy, 'Puissance4-Booster'), true],
      ['Duree', duration || '-', true],
    ])]);
  },

  wlogCoins(pseudo, id, delta, reason = '') {
    send([mkEmbed(0xff9f0a, 'Coins modifies', [
      ['Joueur', pseudo, true],
      ['ID', id, true],
      ['Delta', Number(delta || 0) >= 0 ? `+${delta}` : delta, true],
      ['Raison', reason || '-', false],
    ])]);
  },

  wlogTournament(name, id, status) {
    send([mkEmbed(0x30d158, 'Tournoi', [
      ['Nom', name, true],
      ['ID', id, true],
      ['Statut', status, true],
      ['Lien', `[Voir](${BASE}/tournoi?id=${id})`, true],
    ])]);
  },

  wlogDuel(sender, target, type) {
    send([mkEmbed(0x8b9cf4, 'Duel', [
      ['Createur', sender, true],
      ['Cible', target || 'Lien public', true],
      ['Type', type || 'ranked', true],
    ])]);
  },

  wlogSystem(status, message) {
    send([mkEmbed(0xff3b30, 'Etat serveur', [
      ['Statut', status, true],
      ['Message', message || '-', false],
    ])]);
  },
};

require('dotenv').config();
const { REST, Routes } = require('discord.js');

const DISCORD_GUILD = process.env.DISCORD_GUILD_ID || '1477078197530263582';
const FALLBACK_CLIENT_ID = '1477252548090921060';
const FALLBACK_BOT_TOKEN = 'MTQ3NzI1MjU0ODA5MDkyMTA2MA.Gxv9su.HtL_16ym65VieW5VEL4Pr8EQI_AcZ6jFbgZKrc';
const clientId = process.env.DISCORD_CLIENT_ID || FALLBACK_CLIENT_ID;
const botToken = process.env.DISCORD_BOT_TOKEN || process.env.BOT_TOKEN || FALLBACK_BOT_TOKEN;

const commands = [
  {
    name: 'profil',
    description: 'Afficher le profil Puissance 4 d un joueur',
    options: [{ type: 3, name: 'pseudo', description: 'Pseudo du joueur', required: true, autocomplete: true }],
  },
  { name: 'classement', description: 'Afficher le top ELO Puissance 4' },
  { name: 'stats', description: 'Afficher les statistiques du site' },
  { name: 'live', description: 'Afficher les parties en direct' },
  { name: 'boutique', description: 'Afficher la boutique Puissance 4' },
  { name: 'api', description: 'Afficher la documentation API officielle du site' },
  { name: 'systeme', description: 'Afficher l etat serveur public' },
  { name: 'boosts', description: 'Afficher les boosts ELO, coins et VIP actifs' },
  { name: 'cosmetiques', description: 'Lister les bibliotheques publiques de cosmetiques', options: [{ type: 3, name: 'type', description: 'Type de bibliotheque', required: true, choices: [{ name: 'decorations', value: 'decorations' }, { name: 'bannieres', value: 'banners' }, { name: 'musiques', value: 'musics' }] }] },
  { name: 'leaderboard', description: 'Afficher un classement officiel', options: [{ type: 3, name: 'type', description: 'Type de classement', required: false, choices: [{ name: 'elo', value: 'elo' }, { name: 'victoires', value: 'wins' }] }] },
  { name: 'replay', description: 'Afficher le resume d une partie', options: [{ type: 4, name: 'id', description: 'ID de partie', required: true }] },
  { name: 'duel-lien', description: 'Generer un lien de duel officiel', options: [{ type: 3, name: 'type', description: 'Type de duel', required: true, choices: [{ name: 'ranked', value: 'ranked' }, { name: 'amical', value: 'friendly' }] }] },
  { name: 'tournois', description: 'Lister les tournois officiels' },
  { name: 'tournoi', description: 'Afficher le detail d un tournoi', options: [{ type: 3, name: 'id', description: 'ID public ou interne du tournoi', required: true }] },
  { name: 'aide', description: 'Afficher les commandes Discord disponibles' },
  {
    name: 'admin',
    description: 'Commandes staff Puissance 4',
    options: [
      {
        type: 3,
        name: 'action',
        description: 'Action a executer',
        required: true,
        choices: [
          { name: 'stats', value: 'stats' },
          { name: 'player', value: 'player' },
          { name: 'mute', value: 'mute' },
          { name: 'unmute', value: 'unmute' },
          { name: 'ban', value: 'ban' },
          { name: 'unban', value: 'unban' },
          { name: 'coins', value: 'coins' },
          { name: 'elo', value: 'elo' },
          { name: 'boost-elo', value: 'boost-elo' },
          { name: 'boost-coins', value: 'boost-coins' },
          { name: 'give-item', value: 'give-item' },
          { name: 'tournoi-finish', value: 'tournoi-finish' },
          { name: 'tournoi-pause', value: 'tournoi-pause' },
          { name: 'tournoi-resume', value: 'tournoi-resume' },
          { name: 'tournoi-delete', value: 'tournoi-delete' },
          { name: 'backups', value: 'backups' },
          { name: 'maintenance-on', value: 'maintenance-on' },
          { name: 'maintenance-off', value: 'maintenance-off' },
          { name: 'reload', value: 'reload' },
        ],
      },
      { type: 3, name: 'password', description: 'Mot de passe admin', required: true },
      { type: 3, name: 'pseudo', description: 'Joueur cible si besoin', required: false, autocomplete: true },
      { type: 3, name: 'id', description: 'ID de tournoi, partie ou ressource si besoin', required: false },
      { type: 3, name: 'item', description: 'Item boutique si besoin', required: false, choices: [
        { name: 'VIP 1 mois', value: 'vip_1m' },
        { name: 'VIP 1 an', value: 'vip_1y' },
        { name: 'VIP+', value: 'vip_plus' },
        { name: 'Perso', value: 'perso' },
        { name: 'Mini Boost', value: 'elo_mini' },
        { name: 'Classic Boost', value: 'elo_classic' },
        { name: 'Max Boost', value: 'elo_max' },
        { name: 'Princess Boost', value: 'elo_princess' },
        { name: 'Coin Boost', value: 'coin_boost' },
        { name: 'Coin Boost +', value: 'coin_boost_plus' },
      ] },
      { type: 10, name: 'valeur', description: 'Nombre, minutes, ELO, coins ou multiplicateur', required: false },
      { type: 3, name: 'raison', description: 'Raison ou duree minutes pour boost coins', required: false },
    ],
  },
];

async function main() {
  if (!botToken) throw new Error('DISCORD_BOT_TOKEN manquant.');
  const rest = new REST({ version: '10' }).setToken(botToken);
  const route = DISCORD_GUILD
    ? Routes.applicationGuildCommands(clientId, DISCORD_GUILD)
    : Routes.applicationCommands(clientId);
  await rest.put(route, { body: commands });
  console.log(`Commandes Discord enregistrees (${commands.length}).`);
}

main().catch(error => {
  console.error('[register-commands]', error.message);
  process.exit(1);
});

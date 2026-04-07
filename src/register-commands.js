/**
 * register-commands.js
 * À exécuter UNE FOIS pour enregistrer les commandes slash Discord.
 * node src/register-commands.js
 */
const { REST, Routes } = require('discord.js');

const BOT_TOKEN = 'MTQ3NzI1MjU0ODA5MDkyMTA2MA.Gxv9su.HtL_16ym65VieW5VEL4Pr8EQI_AcZ6jFbgZKrc';
const CLIENT_ID = '1477252548090921060';

const commands = [
  {
    name: 'profil',
    description: 'Affiche le profil d\'un joueur Puissance 4',
    options: [
      {
        name: 'pseudo',
        description: 'Le pseudo du joueur (2 caractères min)',
        type: 3, // STRING
        required: true,
        autocomplete: true,
      },
    ],
  },
  {
    name: 'classement',
    description: 'Affiche le top 10 des joueurs par ELO',
  },
  {
    name: 'live',
    description: 'Affiche les parties en cours',
  },
  {
    name: 'reload',
    description: 'Recharge les commandes slash du bot',
  },
];

const rest = new REST({ version: '10' }).setToken(BOT_TOKEN);

(async () => {
  try {
    console.log('📡 Enregistrement des commandes slash...');
    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
    console.log('✅ Commandes enregistrées !');
  } catch (e) {
    console.error('❌ Erreur :', e);
  }
})();

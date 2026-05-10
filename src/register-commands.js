require('dotenv').config();
const { REST, Routes } = require('discord.js');
const { buildDiscordCommandDefinitions } = require('./discord-bot');

const DISCORD_GUILD = process.env.DISCORD_GUILD_ID || '1477078197530263582';
const FALLBACK_CLIENT_ID = '1477252548090921060';
const FALLBACK_BOT_TOKEN = 'MTQ3NzI1MjU0ODA5MDkyMTA2MA.Gxv9su.HtL_16ym65VieW5VEL4Pr8EQI_AcZ6jFbgZKrc';
const clientId = process.env.DISCORD_CLIENT_ID || FALLBACK_CLIENT_ID;
const botToken = process.env.DISCORD_BOT_TOKEN || process.env.BOT_TOKEN || FALLBACK_BOT_TOKEN;

const commands = buildDiscordCommandDefinitions({
  vip_1m: { key: 'vip_1m', label: 'VIP 1 mois' },
  vip_1y: { key: 'vip_1y', label: 'VIP 1 an' },
  vip_plus: { key: 'vip_plus', label: 'VIP+' },
  perso: { key: 'perso', label: 'Perso' },
  elo_mini: { key: 'elo_mini', label: 'Mini Boost' },
  elo_classic: { key: 'elo_classic', label: 'Classic Boost' },
  elo_max: { key: 'elo_max', label: 'Max Boost' },
  elo_princess: { key: 'elo_princess', label: 'Princess Boost' },
  coin_boost: { key: 'coin_boost', label: 'Coin Boost' },
  coin_boost_plus: { key: 'coin_boost_plus', label: 'Coin Boost +' },
  elo_reset: { key: 'elo_reset', label: 'Reset ELO' },
});

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
  if (error.status === 401 || /unauthorized/i.test(String(error.message || ''))) {
    console.warn('[register-commands] Discord a refuse le token. Build non bloque: le bot retentera au demarrage serveur.');
    process.exit(0);
  }
  process.exit(1);
});

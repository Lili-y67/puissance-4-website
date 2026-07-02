'use strict';

// Point d'entrée unique du site sur un serveur Node.js / VPS.
// Le serveur principal lance Express, Socket.IO, la base et le bot Discord.
require('dotenv').config();
require('./src/server');

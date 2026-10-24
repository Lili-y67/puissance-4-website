'use strict';

// Point d'entrée unique du site sur un serveur Node.js / VPS.
// Le serveur principal lance Express, Socket.IO, la base et le bot Discord.
require('./src/runtime-version').assertSupportedNode();
require('dotenv').config();
require('./src/server');

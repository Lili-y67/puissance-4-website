# Puissance 4 - Documentation complete du site

Version documentee : **3.5.0**

Dernier point README utilise comme reference : commit **2695733 - Fix Musiquee**.

Ce README sert de documentation principale pour relancer, comprendre, maintenir et deployer le site Puissance 4. Il regroupe aussi les grosses mises a jour effectuees depuis le dernier commit qui avait modifie ce fichier.

---

## Sommaire

- [Page 1 - Vue d'ensemble](#page-1---vue-densemble)
- [Page 2 - Installation locale](#page-2---installation-locale)
- [Page 3 - Configuration `.env`](#page-3---configuration-env)
- [Page 4 - Structure du projet](#page-4---structure-du-projet)
- [Page 5 - Parcours joueur](#page-5---parcours-joueur)
- [Page 6 - Pages publiques](#page-6---pages-publiques)
- [Page 7 - Systeme de compte et sessions](#page-7---systeme-de-compte-et-sessions)
- [Page 8 - Discord, OAuth et Rich Presence](#page-8---discord-oauth-et-rich-presence)
- [Page 9 - Musiques de file et YouTube](#page-9---musiques-de-file-et-youtube)
- [Page 10 - Boutique, cosmetiques et collections](#page-10---boutique-cosmetiques-et-collections)
- [Page 11 - Pions voyageurs et easter eggs](#page-11---pions-voyageurs-et-easter-eggs)
- [Page 12 - Clans, duels et live](#page-12---clans-duels-et-live)
- [Page 13 - Administration et console dev](#page-13---administration-et-console-dev)
- [Page 14 - API principale](#page-14---api-principale)
- [Page 15 - Deploiement VPS et Nginx](#page-15---deploiement-vps-et-nginx)
- [Page 16 - Maintenance et verification](#page-16---maintenance-et-verification)
- [Page 17 - Mises a jour depuis `2695733`](#page-17---mises-a-jour-depuis-2695733)

---

## Page 1 - Vue d'ensemble

Puissance 4 est un site multijoueur en ligne avec :

- parties temps reel avec Socket.IO ;
- comptes joueurs, invites, profils publics et statistiques ;
- ELO, historique, replays, analyse et classement ;
- bots internes et bots connectables par API ;
- boutique, cristaux, boosters, cosmetiques et personnalisation ;
- Discord OAuth, roles, Rich Presence et compagnon local ;
- clans, chat de clan, duels et pages live ;
- traduction automatique optionnelle ;
- panneau admin et console dev ;
- page offline Nginx pour remplacer les erreurs 502/503/504 brutes.

Le projet actif est le dossier :

```text
final/
```

Le dossier parent peut contenir d'autres tests ou mini-apps, mais l'application principale du site est dans `final`.

---

## Page 2 - Installation locale

### Prerequis

- Node.js 20.x
- npm
- un terminal place dans le dossier `final`

Sous Windows, si PowerShell bloque `npm.ps1`, utilise `npm.cmd`.

### Etapes

```bash
npm install
```

Copier la configuration :

```bash
cp .env.example .env
```

Sous Windows CMD :

```cmd
copy .env.example .env
```

Lancer le serveur :

```bash
npm run dev
```

Puis ouvrir :

```text
http://127.0.0.1:3000
```

Pour tester une vraie partie :

1. ouvre le site dans un premier onglet ;
2. cree ou connecte un joueur ;
3. ouvre un deuxieme onglet ou un autre navigateur ;
4. connecte un autre joueur ;
5. lance la file d'attente depuis les deux comptes.

### Scripts disponibles

| Script | Commande | Role |
|---|---|---|
| Production | `npm start` | demarre `index.js` |
| Developpement | `npm run dev` | demarre avec nodemon |
| Discord RPC | `npm run rpc` | lance le compagnon Rich Presence local |
| Bot Discord | `npm run bot` | lance le bot Discord separe |
| Slash commands | `npm run register-commands` | enregistre les commandes Discord |

---

## Page 3 - Configuration `.env`

Le fichier `.env.example` contient les valeurs a recopier dans `.env`.

### Serveur

| Variable | Exemple | Description |
|---|---|---|
| `PORT` | `3000` | Port HTTP interne |
| `BASE_URL` | `https://votre-domaine.fr` | URL publique principale |
| `PUBLIC_BASE_URL` | `https://votre-domaine.fr` | URL publique exposee aux helpers |
| `PUBLIC_SITE_URL` | optionnel | URL exacte du site quand certains modules en ont besoin |

### Discord OAuth

| Variable | Description |
|---|---|
| `DISCORD_CLIENT_ID` | ID de l'application Discord |
| `DISCORD_CLIENT_SECRET` | secret OAuth Discord |
| `DISCORD_BOT_TOKEN` | token du bot Discord |
| `DISCORD_REDIRECT_URI` | optionnel, force exactement le callback configure dans le portail Discord |
| `DISCORD_ROLE_DEVELOPER` | role autorise pour la console dev/admin |

Le callback normal est :

```text
https://votre-domaine.fr/auth/discord/callback
```

Si le portail Discord impose une URL exacte, renseigne :

```env
DISCORD_REDIRECT_URI=https://votre-domaine.fr/auth/discord/callback
```

### Traduction automatique

| Variable | Role |
|---|---|
| `TRANSLATION_PROVIDER` | fournisseur demande, par defaut `libretranslate` |
| `LIBRETRANSLATE_URL` | URL du serveur LibreTranslate/Argos |
| `LIBRETRANSLATE_KEY` | cle API si necessaire |
| `LIBRETRANSLATE_BATCH_SIZE` | taille des lots |
| `LIBRETRANSLATE_DELAY_MS` | delai entre lots |
| `I18N_TRANSLATION_TIMEOUT_MS` | timeout d'une traduction |
| `I18N_MAX_MACHINE_TEXTS` | limite de textes machine par page |

Si `LIBRETRANSLATE_URL` est vide, seules les traductions locales deja connues sont disponibles.

### Musique YouTube

| Variable | Role |
|---|---|
| `LAVALINK_URL` | serveur Lavalink utilise pour chercher/resoudre les titres |
| `LAVALINK_PASSWORD` | mot de passe Lavalink |
| `YTDLP_PATH` | chemin vers `yt-dlp` |
| `YTDLP_FORMAT` | format audio demande |
| `YTDLP_NO_CHECK_CERTIFICATES` | ajoute `--no-check-certificates` si `1` |

### Securite et sessions

| Variable | Role |
|---|---|
| `SESSION_IDLE_MS` | duree d'inactivite avant expiration de session |
| `SECURITY_SALT` | sel serveur pour certaines protections |
| `ADMIN_PASSWORD` | peut servir de fallback local |
| `SECURITY_BLOCK_PROXY_CHAINS` | bloque certains enchainements proxy si active |

### Bots

| Variable | Role |
|---|---|
| `BOT_ARENA_ENABLED` | active/desactive l'arene automatique de bots |
| `BOT_ARENA_INTERVAL_MS` | frequence de lancement |
| `BOT_ARENA_MAX_ACTIVE` | nombre max de matchs bots actifs |
| `P4_HOST_DEPTH` | profondeur de recherche du bot heberge |
| `P4_HOST_THINK_MS` | delai de reflexion du bot heberge |
| `P4_HOST_MAX_TABLE` | limite de table de recherche |

---

## Page 4 - Structure du projet

```text
final/
|-- index.js
|-- package.json
|-- .env.example
|-- start-discord-rpc.cmd
|-- deploy/
|   `-- nginx/
|       |-- README.md
|       |-- offline.html
|       `-- puissance4-site.conf
`-- src/
    |-- server.js
    |-- bot.js
    |-- discord-bot.js
    |-- discord-rpc-companion.js
    |-- progression.js
    |-- token-collection.js
    |-- webhooks.js
    |-- db/
    |   `-- db.js
    |-- game/
    |   |-- Board.js
    |   |-- GameManager.js
    |   `-- Matchmaking.js
    |-- i18n/
    |   `-- server-translate.js
    `-- public/
        |-- index.html
        |-- game.html
        |-- profil.html
        |-- clan.html
        |-- boutique.html
        |-- live.html
        |-- leaderboard.html
        |-- stats.html
        |-- news.html
        |-- theme.css
        |-- theme.js
        `-- service-worker.js
```

### Fichiers importants

| Fichier | Role |
|---|---|
| `index.js` | point d'entree unique de production |
| `src/server.js` | Express, Socket.IO, routes API, Discord OAuth, logique serveur |
| `src/db/db.js` | schema SQLite et requetes preparees |
| `src/game/Board.js` | logique pure du Puissance 4 |
| `src/game/GameManager.js` | parties actives, etat, fin de partie |
| `src/game/Matchmaking.js` | file d'attente |
| `src/progression.js` | quetes, progression, saisons |
| `src/token-collection.js` | raretes et catalogue des pions de collection |
| `src/public/theme.js` | shell commun, menu, presence, easter eggs, cache assets |
| `src/public/theme.css` | design commun, responsive, pions, overlays |
| `src/public/service-worker.js` | cache PWA |

---

## Page 5 - Parcours joueur

### 1. Arrivee sur le site

Le joueur arrive sur `/`.

Il peut :

- creer un compte ;
- se connecter ;
- utiliser une session invite ;
- se connecter via Discord ;
- rejoindre la file d'attente ;
- choisir des elements cosmetiques visibles en partie si son profil en possede.

### 2. Matchmaking

La file est geree par Socket.IO :

- le client envoie `queue_join` ;
- le serveur ajoute le joueur dans `Matchmaking` ;
- quand deux joueurs compatibles sont trouves, le serveur cree une partie ;
- les deux sockets recoivent `match_found` ;
- les joueurs sont envoyes vers `/game/:id`.

### 3. Partie

La page `/game` gere :

- la grille ;
- les coups ;
- le chat de partie ;
- la latence ;
- la reconnexion ;
- la proposition de nulle ;
- l'abandon ;
- la revanche ;
- les pions custom, images de pions et couleurs RGB.

### 4. Fin de partie

Quand une partie se termine :

- le gagnant est calcule ;
- l'ELO est mis a jour ;
- les statistiques joueur changent ;
- le replay devient consultable ;
- la progression peut recevoir une action ;
- Discord/RPC/live peuvent etre notifies.

---

## Page 6 - Pages publiques

| Route | Page | Role |
|---|---|---|
| `/` | `index.html` | accueil, connexion, file, musique de file |
| `/game` et `/game/:id` | `game.html` | partie en temps reel |
| `/game/bot` | `game.html` | partie contre bot |
| `/local` | `local.html` | mode local |
| `/profil` | `profil.html` | profil, stats, cosmetiques, collection |
| `/players` | `players.html` | liste joueurs |
| `/bots` | `players.html` | liste bots |
| `/leaderboard` | `leaderboard.html` | classement |
| `/classement` | `leaderboard.html` | alias classement |
| `/clan` | `clan.html` | clans |
| `/clan/:id` | `clan.html` | detail clan |
| `/boutique` | `boutique.html` | achats, boosters, cosmetiques |
| `/live` | `live.html` | parties en direct |
| `/replay/:id` | `replay.html` | replay joueur |
| `/replay-bot/:id` | `replay.html` | replay bot |
| `/analyse` | `analyse.html` | analyse de partie |
| `/progression` | `progression.html` | quetes et saisons |
| `/stats` | `stats.html` | statistiques globales |
| `/news` | `news.html` | nouveautes |
| `/nouveautes` | `news.html` | alias nouveautes |
| `/regles` | `regles.html` | regles |
| `/api-doc` | `api-doc.html` | documentation API visible |
| `/cgu` | `cgu.html` | conditions |
| `/admin` | `admin.html` | administration |
| `/dev` | `dev.html` | console developpeur |

### Page tournoi

La page `tournoi.html` a ete retiree.

Les anciennes routes :

```text
/tournoi
/tournoi/:id
```

redirigent maintenant vers `/`.

Les routes API de tournoi renvoient une reponse indiquant que les tournois ont ete retires, sauf si le systeme est reactive explicitement cote serveur avec `TOURNAMENTS_ENABLED=1`.

---

## Page 7 - Systeme de compte et sessions

### Comptes

Le site gere :

- comptes classiques pseudo/mot de passe ;
- comptes invites ;
- liaison Discord ;
- recuperation de mot de passe ;
- profils publics ;
- sessions identifiees par token.

### Expiration d'inactivite

Les sessions ne sont plus pensees comme des connexions longues sans limite visible. Le serveur utilise maintenant `SESSION_IDLE_MS`.

Comportement attendu :

- une session active est prolongee quand elle est validee ;
- une session expiree est supprimee ;
- un socket identifie peut recevoir `session_expired` ;
- le client est invite a se reconnecter apres inactivite.

### Presence

Le module de presence suit :

- joueurs connectes ;
- visiteurs ;
- sockets identifies ;
- derniers passages ;
- expiration et nettoyage cote serveur.

Les compteurs visibles du site sont donc lies a l'etat reel des sockets et non uniquement a un chiffre statique.

---

## Page 8 - Discord, OAuth et Rich Presence

### OAuth Discord

Le site gere plusieurs entrees Discord :

- liaison d'un compte existant ;
- connexion via Discord ;
- reset via Discord ;
- callback commun `/auth/discord/callback`.

Depuis les dernieres mises a jour, le callback peut etre force avec :

```env
DISCORD_REDIRECT_URI=https://votre-domaine.fr/auth/discord/callback
```

Cela evite les problemes quand Discord exige une URL de redirection strictement identique a celle inscrite dans le portail developpeur.

### Synchronisation profil Discord

Depuis le profil, le joueur peut recuperer :

- avatar Discord ;
- banniere Discord ;
- pseudo Discord.

Routes cote serveur :

```text
POST /api/me/discord-avatar/refresh
POST /api/me/discord-banner/refresh
POST /api/me/discord-pseudo/refresh
POST /api/players/:id/refresh-discord
```

La logique conserve `discord_info` et met a jour le profil local quand l'action est valide.

### Roles Discord

Le serveur sait synchroniser ou utiliser :

- role connecte ;
- role developpeur ;
- informations membre ;
- cache membre/role ;
- delais REST pour limiter les rate limits.

### Rich Presence

Le compagnon Rich Presence local se lance avec :

```bash
npm run rpc
```

Sous Windows, un lanceur existe :

```text
start-discord-rpc.cmd
```

Le compagnon doit rester ouvert avec Discord Desktop. Un navigateur mobile ou une PWA mobile ne peut pas piloter directement le Rich Presence Discord.

---

## Page 9 - Musiques de file et YouTube

Le profil permet de choisir une musique de file.

Types pris en charge :

- sons locaux dans `src/public/sounds/` ;
- fichiers choisis localement par le joueur ;
- recherches YouTube via Lavalink ;
- lecture web via flux extrait par `yt-dlp`.

### Pourquoi Lavalink et yt-dlp ?

Lavalink sert a chercher et resoudre les titres. Le navigateur, lui, a besoin d'une URL audio lisible. C'est le role de `yt-dlp`.

### Installation Linux recommandee

```bash
sudo apt update
sudo apt install -y pipx
pipx ensurepath
pipx install yt-dlp
which yt-dlp
```

Si le shell ne voit pas encore `yt-dlp`, reconnecte-toi ou teste :

```bash
~/.local/bin/yt-dlp --version
```

Puis configure :

```env
YTDLP_PATH=/home/p4/.local/bin/yt-dlp
```

### Alternative avec binaire direct

```bash
sudo curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp
sudo chmod a+rx /usr/local/bin/yt-dlp
yt-dlp --version
```

### Verification au demarrage

Au lancement, le serveur doit indiquer que `yt-dlp` est trouve. Si ce n'est pas le cas :

1. verifie `YTDLP_PATH` ;
2. verifie le PATH du service systemd ;
3. mets un chemin absolu dans `.env` ;
4. redemarre le service Node.

---

## Page 10 - Boutique, cosmetiques et collections

### Boutique

La boutique gere notamment :

- cristaux ;
- VIP/VIP+/Perso ;
- boosters ;
- coupons ;
- product keys ;
- cosmetiques de profil ;
- decorations ;
- polices ;
- couleurs ;
- pions custom ;
- musiques ;
- curseur personnalise ;
- avantages de cooldown pour les pions voyageurs.

### Product keys

Une product key peut donner directement des elements a un profil cible. Ce systeme est separe des coupons classiques, car le but est de livrer des objets/avantages, pas seulement une reduction.

Route importante :

```text
POST /api/shop/product-key/redeem
```

### Collection de pions

La collection est basee sur `src/token-collection.js`.

Raretes documentees actuellement :

| Rarete | Spawn |
|---|---:|
| Commun | 49% |
| Rare | 25% |
| Epique | 12% |
| Legendaire | 7% |
| Mythique | 3.5% |
| Artefact | 1.5% |
| QueenPawn | 1% |
| Fantastique | 0.9% |
| Inoubliable | 0.1% |
| Evenement | 0% |

Nouveaux themes/pions ajoutes depuis le dernier README :

- Fantastique : Fee sylvestre, Cristal draconique, Oracle lunaire, Royaume oublie ;
- Inoubliables : Princesse inoubliable avec image dediee ;
- Evenements : Festival ete 2026, Couronne evenement, Drop des ombres.

Routes utiles :

```text
GET /api/token-collection/catalog
GET /api/players/:id/token-collection
PATCH /api/admin/players/:id/token-collection
```

La reponse joueur inclut maintenant des statistiques par rarete et par theme, afin que le profil puisse afficher une vraie progression de collection.

---

## Page 11 - Pions voyageurs et easter eggs

Le site contient un systeme de pions voyageurs sur les pages publiques.

Le systeme est dans :

```text
src/public/theme.js
src/public/theme.css
src/public/service-worker.js
```

### Fonctionnement general

1. `theme.js` verifie si la page accepte les pions voyageurs.
2. Le script choisit une rarete et une position.
3. Le pion apparait dans la page.
4. Le joueur peut cliquer dessus.
5. Le serveur valide la recompense avec `/api/easter-eggs/claim`.
6. Le profil recoit le pion et les cristaux associes.

### Pages exclues

Certaines pages techniques ou sensibles peuvent etre exclues pour eviter que les pions genent :

- live ;
- admin ;
- dev ;
- pages de jeu quand l'interaction pourrait perturber une partie.

### Responsive

Les pions voyageurs ont ete ajustes pour mieux fonctionner :

- sur mobile ;
- avec des placements fixes ;
- avec repositionnement au resize ;
- avec toast mieux ancre dans le contenu visible ;
- avec effets visuels et sonores ;
- avec comportement de fuite/esquive sur certaines raretes.

### Cache

Quand `theme.js`, `theme.css` ou les pions voyageurs changent, il faut aussi verifier :

```text
src/public/service-worker.js
```

Le cache actuel est :

```text
p4-shell-v3.5.0-split-eggs-1
```

---

## Page 12 - Clans, duels et live

### Clans

La page `clan.html` a ete retravaillee plusieurs fois depuis le dernier README.

Le systeme de clans couvre :

- creation de clan ;
- consultation d'un clan ;
- leaderboard de clans ;
- membres ;
- roles ;
- exclusion ;
- quitter un clan ;
- chat de clan ;
- missions de clan.

Routes principales :

```text
GET /api/clans
GET /api/clans/leaderboard
GET /api/players/:id/clan
GET /api/clans/:id
POST /api/clans
DELETE /api/clans/:id
GET /api/clans/:id/messages
POST /api/clans/:id/messages
POST /api/clans/:id/members/:playerId/remove
POST /api/clans/:id/members/:playerId/role
POST /api/clans/:id/join
POST /api/clans/leave
GET /api/clans/:id/missions
```

### Duels

Le systeme de duel permet de defier un joueur directement.

Routes principales :

```text
POST /api/duels/challenge
POST /api/duels/link
POST /api/duels/:id/guest-session
GET /api/duels/:id
POST /api/duels/:id/accept
```

Socket.IO gere aussi les evenements :

```text
duel_invite
duel_invite_sent
duel_invite_accepted
duel_invite_declined
duel_invite_expired
duel_invite_error
duel_accept
duel_decline
```

### Live

La page live affiche les parties en cours et permet des reactions.

Routes et evenements importants :

```text
GET /api/live
POST /api/live/:id/predict
join_live
join_live_game
leave_live_game
live_reaction
live_update
```

---

## Page 13 - Administration et console dev

### Admin

La page `/admin` permet de gerer :

- joueurs ;
- coupons ;
- boosts ;
- product keys ;
- backups ;
- parties ;
- annulation/revert de parties ;
- statut systeme ;
- dons de pions de collection.

Routes exemples :

```text
GET /api/admin/players
POST /api/admin/coupons
DELETE /api/admin/coupons/:code
POST /api/admin/limited-pack
GET /api/admin/backups
GET /api/admin/games
POST /api/admin/games/:id/revert
PATCH /api/admin/players/:id/token-collection
```

### Console dev

La page `/dev` sert a inspecter :

- sources ;
- metriques ;
- usage des bots ;
- donnees de diagnostic ;
- flux temps reel via Socket.IO.

Routes exemples :

```text
GET /api/dev/me
GET /api/dev/sources
GET /api/dev/source
GET /api/dev/metrics
GET /api/dev/bot-usage
```

Les metriques de la console dev excluent les requetes de telemetry qui pourraient fausser les graphiques.

---

## Page 14 - API principale

Cette liste ne remplace pas `src/public/api-doc.html`, mais donne les familles utiles pour retrouver rapidement une route.

### Authentification

```text
POST /api/auth/register
POST /api/auth/login
POST /api/auth/guest
POST /api/reset-password
GET  /auth/discord/link
GET  /auth/discord/signin
GET  /auth/discord/reset
GET  /auth/discord/callback
```

### Joueurs

```text
GET    /api/players
GET    /api/players/search
GET    /api/players/by-pseudo/:pseudo
GET    /api/players/:id
DELETE /api/players/:id
POST   /api/players/:id/follow
DELETE /api/players/:id/follow
GET    /api/players/:id/follow-status
GET    /api/players/:id/status
GET    /api/players/:id/elo-history
GET    /api/players/:id/elo-history/export
```

### Parties

```text
GET  /api/games/:id
GET  /api/games/:id/moves
GET  /api/games/:id/replay-view
POST /api/games/:id/analysis
GET  /api/games/:id/analysis
POST /api/games/:id/accuracy
POST /api/bot-replay
```

### Boutique

```text
GET  /api/shop/catalog
GET  /api/shop/me
POST /api/shop/buy
POST /api/shop/coupon/validate
POST /api/shop/product-key/redeem
POST /api/shop/boosters/activate
```

### Profil et cosmetiques

```text
GET  /api/decorations
GET  /api/profile-banners
GET  /api/musics
GET  /api/me/discord-info
POST /api/me/discord-avatar/refresh
POST /api/me/discord-banner/refresh
POST /api/me/discord-pseudo/refresh
POST /api/discord/unlink/request
POST /api/discord/unlink/confirm
```

### Pions et progression

```text
POST /api/easter-eggs/claim
GET  /api/token-collection/catalog
GET  /api/players/:id/token-collection
GET  /api/progression/me
POST /api/progression/challenges/:key/claim
POST /api/progression/theme
GET  /api/seasons/current
```

### Bots

```text
GET  /api/bot-id
GET  /api/bot/me
POST /api/bot/token/rotate
POST /api/bot/ping
POST /api/bot/queue/join
POST /api/bot/queue/leave
GET  /api/bot/game
POST /api/bot/move
POST /api/bot/challenge/:id
GET  /api/bots/preconfigured
POST /api/bots/preconfigured/match
POST /api/bots/:id/challenge
GET  /api/bot-host/me
POST /api/bot-host/:botId/code
GET  /api/bot-host/:botId/download
GET  /api/bot-host/:botId/logs
GET  /api/bot-host/:botId/metrics
POST /api/bot-host/:botId/action
```

### Statistiques

```text
GET /api/leaderboard
GET /api/leaderboard/bots
GET /api/leaderboard/wins
GET /api/site-stats
GET /api/stats/overview
GET /api/stats/weekly
GET /api/system-status
```

### Musique

```text
GET /api/queue-music/search
GET /api/queue-music/lavalink-stream/:videoId
```

---

## Page 15 - Deploiement VPS et Nginx

### Installation Node sur VPS

```bash
npm install --omit=dev
cp .env.example .env
npm start
```

Le point d'entree est :

```text
index.js
```

Il charge le serveur principal, la base, Socket.IO et les modules lies.

### Variables minimales production

```env
PORT=3000
BASE_URL=https://votre-domaine.fr
PUBLIC_BASE_URL=https://votre-domaine.fr
DISCORD_CLIENT_ID=...
DISCORD_CLIENT_SECRET=...
DISCORD_BOT_TOKEN=...
```

### Page offline Nginx

Le dossier :

```text
deploy/nginx/
```

contient :

```text
offline.html
puissance4-site.conf
README.md
```

Cette page remplace un `502 Bad Gateway` brut quand Node est down.

Installation :

```bash
sudo mkdir -p /var/www/puissance4-offline
sudo cp deploy/nginx/offline.html /var/www/puissance4-offline/offline.html
```

Dans le bloc Nginx du site :

```nginx
error_page 502 503 504 /offline.html;

location = /offline.html {
    root /var/www/puissance4-offline;
    internal;
    add_header Cache-Control "no-store";
}
```

Dans le `location /` qui proxy vers Node :

```nginx
proxy_intercept_errors on;
```

Verification :

```bash
sudo nginx -t
sudo systemctl reload nginx
```

### Attention cache PWA

Apres une modification de `theme.js`, `theme.css`, `service-worker.js`, d'une page publique ou d'un asset important, il faut :

1. verifier la version de cache dans `service-worker.js` ;
2. verifier les query strings de `theme.js` et `theme.css` ;
3. redemarrer le serveur si le HTML est servi par Node ;
4. vider le cache navigateur si besoin pendant le test.

---

## Page 16 - Maintenance et verification

### Verifications rapides

```bash
node --check index.js
node --check src/server.js
node --check src/discord-bot.js
node --check src/public/theme.js
node --check src/i18n/server-translate.js
```

Pour verifier les scripts inline d'une page HTML, extraire le script ou utiliser une validation ciblee avec Node.

### Recherches utiles

Voir les anciennes references Railway/Nixpacks :

```bash
rg --hidden -n -i "railway|railway\\.app|nixpacks|RAILWAY_" .
```

Voir les versions de cache :

```bash
rg -n "service-worker|theme.css\\?v=|theme.js\\?v=|CACHE_VERSION|p4-shell" src/public
```

Voir les routes Express :

```bash
rg -n "app\\.(get|post|patch|delete|use)\\(" src/server.js
```

Voir les events Socket.IO :

```bash
rg -n "socket\\.on\\(|socket\\.emit\\(|io\\.emit\\(" src
```

### Quand une page semble ne pas changer

Verifier dans cet ordre :

1. le bon fichier dans `src/public/` ;
2. les imports de `theme.css` et `theme.js` ;
3. le service worker ;
4. le cache navigateur ;
5. le port ou le processus Node vraiment utilise ;
6. la presence d'une ancienne version de fichier sur le VPS.

### Quand Discord OAuth echoue

Verifier :

1. `BASE_URL` ;
2. `PUBLIC_BASE_URL` ;
3. `DISCORD_REDIRECT_URI` ;
4. l'URL exacte dans le portail Discord ;
5. le token bot ;
6. les logs serveur au moment du callback.

### Quand YouTube ne joue pas

Verifier :

1. `LAVALINK_URL` ;
2. `LAVALINK_PASSWORD` ;
3. `YTDLP_PATH` ;
4. `yt-dlp --version` depuis le meme utilisateur que le service ;
5. les erreurs `[QUEUE MUSIC]` au demarrage ;
6. le PATH systemd si le serveur tourne en service.

---

## Page 17 - Mises a jour depuis `2695733`

Cette section resume les changements detectes entre le dernier commit qui modifiait ce README, **2695733 - Fix Musiquee**, et l'etat actuel de `main`.

Commits concernes :

```text
7de823c Fix Musiquee
c95dfc7 Fix Musiquee
155a630 Fix login
b01b7fd fix page 502
e192a60 fix page 502
64d831d Suppression tournoi + timer local
17c8775 Ajout timer
57bc75a Fix news
f43df03 BETA Test Backgroud
9ea7423 BETA Test Backgroud
867a95d BETA Test Backgroud
b4034cc Test Backround 2x
120fe15 Test Backround fix
fab0162 Test Backround fix
66e0bb8 Test Backround fix
6f50fa7 Test Backround fix
3561f79 Fix Pions
31ee717 Fix Pions
6d47255 Fix Pions
dc4176d Fix Pions
a15089f Fix Pions
6ee8aa1 Fix Pions
7a5e5d0 Fix Pions
0f7e1fe Fix Pions
aba2950 Fix Pions
c74626b Fix Pions
4d6c868 Fix Pions
1cc9bd9 Fix Pions
8ab4754 Fix Pions
5be3bee Fix Pions
51f0965 Fix Pions
c72b079 Fix pages
875e60c Fix pages
```

### 1. Version projet

- `package.json` est passe de `3.4.0` a `3.5.0`.
- Le point d'entree reste `index.js`.
- Les scripts principaux sont conserves : `start`, `dev`, `rpc`, `bot`, `register-commands`.

### 2. Suppression de la page tournoi

- `src/public/tournoi.html` a ete supprime.
- `/tournoi` et `/tournoi/:id` redirigent vers `/`.
- Les routes tournoi API sont bloquees par defaut avec un message de retrait.
- `TOURNAMENTS_ENABLED` existe cote serveur pour garder une possibilite de reactivation controlee.

### 3. Page offline Nginx

Nouveaux fichiers :

```text
deploy/nginx/README.md
deploy/nginx/offline.html
deploy/nginx/puissance4-site.conf
```

Objectif :

- remplacer les erreurs 502/503/504 par une page offline style Puissance 4 ;
- documenter l'installation VPS ;
- fournir une config Nginx reutilisable.

### 4. Correction login et OAuth Discord

Changements importants :

- ajout de `DISCORD_REDIRECT_URI` dans `.env.example` ;
- normalisation des URLs publiques ;
- callback Discord plus robuste ;
- state OAuth encode avec `redirectUri` ;
- meilleure gestion des erreurs de liaison/connexion ;
- acces admin/dev mieux controle autour des roles Discord.

### 5. Sessions inactives

Changements serveur/base :

- ajout de `SESSION_IDLE_MS` ;
- ajout de `sQ.touch` en base ;
- validation de session avec prolongation ;
- expiration plus claire cote Socket.IO ;
- emission possible de `session_expired`.

### 6. Fonds de profil desktop/mobile

Nouvelles colonnes joueurs :

```text
profile_wallpaper_desktop
profile_wallpaper_mobile
profile_wallpaper_opacity
profile_wallpaper_dim
```

Objectif :

- permettre un fond de profil separe desktop/mobile ;
- controler l'opacite ;
- controler l'assombrissement ;
- eviter de servir des images trop lourdes dans le payload public.

### 7. Theme global et responsive

Fichiers fortement touches :

```text
src/public/theme.css
src/public/theme.js
src/public/service-worker.js
```

Changements :

- mise a jour du shell commun ;
- cache PWA passe en `p4-shell-v3.5.0-split-eggs-1` ;
- meilleure separation desktop/mobile pour les pions voyageurs ;
- styles globaux revus sur de nombreuses pages ;
- corrections de pages qui gardaient un ancien rendu ;
- ajustements responsive sur clan, leaderboard, profil, index et pages secondaires.

### 8. Collection de pions

`src/token-collection.js` a ete etendu.

Ajouts :

- rarete `Fantastique` ;
- rarete `Inoubliable` ;
- rarete `Evenement` ;
- pion image `Princesse inoubliable` ;
- asset `src/public/assets/token-inoubliable-princesse.png` ;
- statistiques par theme et rarete dans l'API ;
- route admin pour donner un pion a un joueur.

### 9. Pions voyageurs

Changements :

- placement mobile retravaille ;
- placement fixe plus stable ;
- toast mieux positionne ;
- effets visuels enrichis ;
- son de collecte/fuite ;
- cooldowns mieux separes ;
- compatibilite avec les nouvelles raretes ;
- exclusions page par page.

### 10. Profil

`src/public/profil.html` a ete fortement modifie.

Changements principaux :

- meilleur rendu des collections ;
- prise en charge des fonds desktop/mobile ;
- synchronisation Discord avatar/banniere/pseudo ;
- queue music plus complete ;
- curseur personnalise ;
- rendu plus riche des pions et cosmetiques ;
- payload public allege quand les images de fond sont trop grosses.

### 11. Accueil et musique de file

`src/public/index.html` a ete modifie pour :

- gerer les musiques de file ;
- ajouter/ajuster des timers ;
- mieux reagir a la presence/session ;
- synchroniser le shell public ;
- corriger des comportements visibles apres les changements de cache.

### 12. News et traduction

Fichiers touches :

```text
src/public/news.html
src/public/i18n.js
src/i18n/server-translate.js
```

Changements :

- page news corrigee ;
- traduction serveur ajustee ;
- garde-fous sur les lots et timeouts ;
- integration plus propre avec le shell commun.

### 13. Clans et leaderboard

Fichiers touches :

```text
src/public/clan.html
src/public/leaderboard.html
```

Changements :

- design et responsive retravailles ;
- meilleure compatibilite avec les pions voyageurs ;
- corrections de rendu page ;
- alignement avec `theme.css` et `theme.js`.

### 14. Admin, dev et API doc

Fichiers touches :

```text
src/public/admin.html
src/public/dev.html
src/public/api-doc.html
src/discord-bot.js
src/server.js
```

Changements :

- documentation API visible mise a jour ;
- console dev ajustee ;
- admin enrichi pour les nouvelles donnees ;
- commandes Discord adaptees ;
- affichage de latence/API dans certains retours bot.

### 15. Pages secondaires synchronisees

Les pages suivantes ont ete retouchees pour rester compatibles avec le shell, le cache, le responsive et les corrections de pages :

```text
404.html
analyse.html
boutique.html
cgu.html
duel-auth.html
duel.html
forgot-password.html
game.html
live.html
local.html
players.html
progression.html
regles.html
replay.html
reset-password.html
stats.html
```

### 16. Webhooks

`src/webhooks.js` a ete nettoye partiellement.

Objectif :

- reduire des valeurs inutiles ;
- garder les logs Discord optionnels ;
- limiter les references a des webhooks inutilises.

### 17. Fichiers generes ou logs

Deux fichiers `.codex-dev-server.*.log` apparaissent dans le delta Git. Ce sont des logs de serveur de developpement et non des fichiers fonctionnels du site.

Avant un commit propre, verifier s'ils doivent vraiment rester suivis.

---

## Checklist avant commit/deploiement

- [ ] `npm install` effectue si les dependances ont change.
- [ ] `.env` aligne avec `.env.example`.
- [ ] `node --check index.js`.
- [ ] `node --check src/server.js`.
- [ ] `node --check src/discord-bot.js`.
- [ ] `node --check src/public/theme.js`.
- [ ] Verification rapide de `/`, `/profil`, `/game`, `/clan`, `/boutique`, `/leaderboard`, `/news`.
- [ ] Cache service worker verifie si le front ne se met pas a jour.
- [ ] `yt-dlp` teste si la musique YouTube est utilisee.
- [ ] Nginx teste avec `sudo nginx -t` si la page offline est modifiee.
- [ ] Anciennes routes `/tournoi` verifiees si un lien externe existe encore.

---

## Notes rapides pour reprendre le projet

Le serveur principal est `src/server.js`.

La majorite des problemes visibles de page/cache passent par :

```text
src/public/theme.js
src/public/theme.css
src/public/service-worker.js
```

La majorite des problemes de profil passent par :

```text
src/public/profil.html
src/server.js
src/db/db.js
```

La majorite des problemes de collection passent par :

```text
src/token-collection.js
src/public/theme.js
src/public/profil.html
src/server.js
```

La majorite des problemes Discord passent par :

```text
src/server.js
src/discord-bot.js
src/discord-rpc-companion.js
src/register-commands.js
```


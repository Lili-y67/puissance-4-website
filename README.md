# Puissance 4 — Multijoueur en ligne

## Stack
- **Backend** : Node.js + Express + Socket.io
- **Base de données** : sql.js (SQLite pur JS, zéro compilation)
- **Front** : HTML/CSS/JS vanilla

## Structure
```
src/
├── server.js              ← Point d'entrée
├── db/
│   └── db.js              ← SQLite (sql.js)
├── game/
│   ├── Board.js           ← Logique Puissance 4
│   ├── Matchmaking.js     ← File d'attente
│   └── GameManager.js     ← Parties actives
└── public/
    ├── index.html         ← Home (login + queue)
    ├── game.html          ← Partie en cours
    ├── profil.html        ← Stats + historique
    └── replay.html        ← Replay automatique
```

## Lancement local

```bash
# 1. Installer les dépendances
npm install

# 2. Copier le fichier d'environnement
cp .env.example .env

# 3. Lancer en développement
npm run dev

# Ouvrir http://localhost:3000
# Ouvrir un 2e onglet pour simuler un 2e joueur
```

## Discord Rich Presence

Le site peut publier la page active dans Discord grâce à un compagnon local :

```bash
npm install
npm run rpc
```

Le domaine public et l'application Discord sont deja configures dans le
compagnon. Sous Windows, `start-discord-rpc.cmd` permet de le lancer en
double-cliquant dessus.
Le compagnon doit rester ouvert avec Discord Desktop. Un navigateur mobile ou
une PWA mobile ne peut pas piloter directement le Rich Presence Discord.

## Installation sur un VPS Node.js

```bash
npm install --omit=dev
cp .env.example .env
npm start
```

Le point d'entrée unique est `index.js`. Il démarre le serveur HTTP, Socket.IO,
la base de données et le bot Discord. Pour la production, configurez
`BASE_URL=https://votre-domaine.fr` dans `.env`, puis placez Nginx ou Caddy
devant le port Node.js.

### Lecture YouTube des musiques de file

La recherche YouTube passe par Lavalink, mais la lecture web a besoin de
`yt-dlp` pour obtenir un vrai flux audio lisible par le navigateur.

Sur un VPS Debian/Ubuntu recent, utilise `pipx` :

```bash
sudo apt update
sudo apt install -y pipx
pipx ensurepath
pipx install yt-dlp
which yt-dlp
```

Si `which yt-dlp` ne repond pas juste apres `pipx ensurepath`, reconnecte-toi
au shell SSH ou utilise directement le chemin :

```bash
~/.local/bin/yt-dlp --version
```

Dans `.env`, laisse ou adapte :

```env
YTDLP_PATH=yt-dlp
YTDLP_FORMAT=bestaudio[ext=m4a]/bestaudio[ext=webm]/bestaudio/best
YTDLP_NO_CHECK_CERTIFICATES=1
```

Si `which yt-dlp` donne par exemple `/home/p4/.local/bin/yt-dlp`, mets :

```env
YTDLP_PATH=/home/p4/.local/bin/yt-dlp
```

Alternative sans Python/pipx :

```bash
sudo curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp
sudo chmod a+rx /usr/local/bin/yt-dlp
yt-dlp --version
```

Au démarrage, le serveur affiche `[QUEUE MUSIC] yt-dlp OK ...` si l'outil est
trouvé. Sans `yt-dlp`, Lavalink peut encore chercher les titres, mais YouTube
ne pourra pas être lu dans la file d'attente web.

## Variables d'environnement

| Variable | Valeur par défaut | Description |
|----------|-------------------|-------------|
| PORT     | 3000              | Port HTTP interne du serveur |
| BASE_URL | http://127.0.0.1:3000 | URL publique du site en production |
| LAVALINK_URL | vide | URL Lavalink pour chercher les musiques YouTube |
| LAVALINK_PASSWORD | vide | Mot de passe Lavalink côté serveur |
| YTDLP_PATH | yt-dlp | Chemin vers le binaire yt-dlp |
| YTDLP_FORMAT | bestaudio... | Format audio YouTube demandé à yt-dlp |
| YTDLP_NO_CHECK_CERTIFICATES | 1 | Ajoute `--no-check-certificates` à yt-dlp |

## Pages

| Route         | Description                        |
|---------------|------------------------------------|
| `/`           | Login + file d'attente             |
| `/game`       | Partie en temps réel               |
| `/profil`     | Stats + historique des 25 parties  |
| `/replay/:id` | Replay automatique avec vrais temps|

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

## Déploiement sur Railway (gratuit)

1. Push le projet sur GitHub
2. Aller sur https://railway.app → New Project → Deploy from GitHub
3. Sélectionner le repo
4. Railway détecte automatiquement Node.js
5. Dans les settings du projet, ajouter la variable : `PORT=3000`
6. C'est tout — Railway build et déploie automatiquement

## Variables d'environnement

| Variable | Valeur par défaut | Description |
|----------|-------------------|-------------|
| PORT     | 3000              | Port du serveur |

## Pages

| Route         | Description                        |
|---------------|------------------------------------|
| `/`           | Login + file d'attente             |
| `/game`       | Partie en temps réel               |
| `/profil`     | Stats + historique des 25 parties  |
| `/replay/:id` | Replay automatique avec vrais temps|

# Puissance 4

Jeu de Puissance 4 multijoueur en temps réel avec classement ELO, variantes, profils, bots, boutique, progression et intégration Discord.

Version actuelle : **4.1.0**

## Fonctionnalités

- parties classées avec Socket.IO ;
- huit modes : Classique et sept variantes classées ;
- ELO, historique, replays, analyse, statistiques et classements par variante ;
- comptes joueurs, profils publics, présence et personnalisation ;
- bots internes et bots externes connectables par API ;
- boutique avec coins, gemmes, Cristaux, panier, cadeaux, boosts et cosmétiques ;
- progression, collections de jetons, missions et Roue Fortune ;
- OAuth, rôles, commandes, tickets et Rich Presence Discord ;
- panneaux Admin et Dev avec authentification renforcée.

Variantes disponibles : Plateau rotatif, Anti-Puissance 4, Puissance Bombe, Mission personnelle, Placement simultané, Brouillard de Guerre et Conquête.

## Installation

Prérequis : Node.js 20 et npm.

```bash
cd final
npm install
```

Copie `.env.example` vers `.env`, complète les valeurs nécessaires puis lance :

```bash
npm run dev
```

Le site est accessible par défaut sur `http://127.0.0.1:3000` ou sur le port défini dans l’environnement.

## Commandes

| Commande | Usage |
|---|---|
| `npm start` | serveur de production |
| `npm run dev` | serveur avec Nodemon |
| `npm run bot` | bot Discord |
| `npm run rpc` | compagnon Rich Presence |
| `npm run register-commands` | réenregistrement manuel des commandes Discord |

## Configuration

Les variables sont commentées dans `.env.example`.

| Variable | Description |
|---|---|
| `SERVER_PORT` / `PORT` | port HTTP interne |
| `BASE_URL` | URL publique du site |
| `DISCORD_CLIENT_ID` | identifiant de l’application Discord |
| `DISCORD_CLIENT_SECRET` | secret OAuth Discord |
| `DISCORD_BOT_TOKEN` | jeton du bot Discord |
| `DISCORD_ROLE_DEVELOPER` | rôle autorisé pour les outils sensibles |
| `DISCORD_WEBHOOK` | webhook facultatif pour les journaux |
| `LIBRETRANSLATE_URL` | service de traduction facultatif |
| `LAVALINK_URL` | recherche et résolution des musiques |
| `LAVALINK_PASSWORD` | mot de passe Lavalink |
| `YTDLP_PATH` | chemin vers `yt-dlp` |

Ne place jamais un secret dans `src/public` ou dans du code envoyé au navigateur.

## Architecture

```text
final/
├─ index.js                 point d’entrée
├─ data/                    base SQLite et données persistantes
├─ deploy/                  configuration de déploiement
├─ scripts/                 scripts de maintenance
└─ src/
   ├─ server.js             serveur Express et API
   ├─ discord-bot.js        commandes et interactions Discord
   ├─ security.js           sécurité HTTP
   ├─ db/                   schéma et requêtes SQLite
   ├─ game/                 matchmaking, parties et variantes
   ├─ i18n/                 traduction
   ├─ routes/               routes séparées
   └─ public/               pages et ressources frontend
```

La liste officielle des variantes se trouve dans `src/game/variants.js`. Les interfaces publiques doivent rester synchronisées avec ce fichier.

## Routes utiles

| Route | Fonction |
|---|---|
| `/` | accueil et matchmaking |
| `/game` | partie en cours |
| `/regles` | règles et variantes interactives |
| `/leaderboard` | classements |
| `/live` | parties en direct |
| `/profil` | profil joueur |
| `/progression` | progression et Roue Fortune |
| `/boutique` | boutique et panier |
| `/news` | nouveautés |
| `/api-doc` | documentation de l’API |
| `/admin` | administration |
| `/dev` | outils développeur |

## Boutique

La boutique gère les monnaies, grades premium, boosts, cosmétiques, collections, panier multi-articles, cadeaux, conversion gemmes–coins, coupons, offres limitées et clés produit.

Les achats sont toujours revalidés côté serveur. Le frontend ne doit jamais être considéré comme une source d’autorité pour le prix, le stock ou le solde.

## Discord

Le bot est lancé avec `npm run bot` et enregistre ses commandes au démarrage. Après une modification de leur définition, redémarre-le.

La commande `/key-generate` ouvre un modal réservé au staff connecté via `/login`.

Le compagnon Rich Presence est indépendant :

```bash
npm run rpc
```

## Données et sécurité

- la base principale se trouve dans `data/p4.db` ;
- sauvegarde `data/` avant une migration ou une opération sensible ;
- n’édite pas directement la base pendant que le serveur écrit dedans ;
- protège les actions Admin avec `isAdmin` ou `isModo` ;
- ne commit jamais les sessions, mots de passe, secrets Discord ou webhooks ;
- valide prix, récompenses et permissions côté serveur.

## Déploiement

1. Installe les dépendances avec `npm install`.
2. Configure `.env` et le reverse proxy.
3. Sauvegarde `data/`.
4. Lance `npm start` avec ton gestionnaire de processus.
5. Vérifie `/api/health`, l’authentification, une partie et la boutique.

La configuration Nginx se trouve dans `deploy/nginx/`. Les pages HTML et le service worker utilisent des règles anti-cache afin d’éviter une ancienne interface après déploiement.

## Checklist avant mise en ligne

- serveur et bot démarrent sans erreur ;
- deux comptes peuvent terminer une partie ;
- chaque variante utilise la bonne grille ;
- profil, classement et replay reflètent la variante jouée ;
- panier, cadeaux et vérification des soldes fonctionnent ;
- Admin et Dev restent protégés ;
- aucune page mobile ne déborde.

## Dépannage

### Une page reste ancienne

Redémarre le serveur qui sert réellement le dossier `final`, redéploie si nécessaire puis vérifie la version active du service worker.

### Discord ne montre pas une commande modifiée

Redémarre le bot. La synchronisation des commandes peut prendre quelques instants.

### La musique ne fonctionne pas

Vérifie Lavalink, son mot de passe, `yt-dlp` et les journaux du serveur.

### Une API Admin répond 403

Reconnecte-toi dans `/admin`, vérifie le rôle lié et renouvelle la validation Discord.

## Exploitation

Projet privé Puissance 4. Les secrets, données joueurs et ressources sous licence ne doivent pas être redistribués.

# Steal a Masterpiece — Le casse du siècle

Jeu de gestion multijoueur en 3D, dans le navigateur et installable en PWA : bâtir le plus grand musée du monde, acheter des chefs-d’œuvre aux enchères, les protéger… et voler ceux des autres. Voir le cahier des charges pour la conception complète et la roadmap.

**État : phases 0 à 6 terminées, prêt à mettre en ligne** (voir [docs/LANCEMENT.md](docs/LANCEMENT.md)).

**Phase 6 — compléments du cahier des charges :**
- **Billet d'entrée :** entrer chez un rival (pour visiter ou voler) coûte 0,05 % de la valeur de son musée (20 pièces au minimum), encaissé par le propriétaire. Le billet vaut 10 min. Sans argent, on reste dehors.
- **Vol d'une Mythique :** décrochage de 20 s ; l'alarme sonne même sous brouilleur ; tout le serveur est prévenu ; n'importe quel joueur qui touche le voleur l'arrête et empoche 1 % de la valeur de l'œuvre (8 M pour la Joconde).
- **Déguisement d'employé** (marché noir, 60 s) : les gardes ignorent le voleur. Les autres joueurs voient son badge « employé ».
- **Chien de garde** (4 h) : flaire les déguisements, les gardes repèrent alors le voleur quand même.
- **Reproductions** (marché noir, 5 000) : copies des Mythiques, marquées « Reproduction ». Décoratives, sans valeur ni revenu, et les voleurs n'en veulent pas.

**Phase 5 — étages, classements, catalogue, lancement :**
- **Étages :** niveau 6 (1er étage, 600 M) et niveau 7 (2e étage, 6 Md), chacun avec 9 salles. 214 emplacements au total.
  - Un escalier en colimaçon dans la salle d'entrée : E pour monter, R pour descendre. Le serveur vérifie qu'on passe par l'escalier, un étage à la fois.
  - Vue de l'intérieur : les étages au-dessus du joueur sont masqués (le musée n'a pas de toit).
  - Vols et arrestations se font au bon étage. Un garde est affecté à chaque étage, et il prend l'escalier pour poursuivre un voleur.
- **Classements :**
  - le panneau de la place fait défiler 4 classements : plus riches (permanent), champions de la semaine (valeur gagnée depuis lundi, remis à zéro chaque semaine), plus gros casses, plus grosses enchères ;
  - bouton 🏆 pour les voir en onglets.
- **Catalogue :** 40 œuvres du domaine public : 12 Communes, 12 Rares, 8 Épiques, 5 Légendaires et 3 Mythiques uniques (La Joconde, La Naissance de Vénus, La Création d’Adam).
- **Performance mobile :**
  - les éléments fixes de chaque bâtiment sont fusionnés en un maillage par matériau : un musée à 3 étages passe de 1 175 à 89 appels de dessin ;
  - les œuvres des musées lointains ne sont pas dessinées ;
  - passage automatique en mode Éco sous 26 images/s.
- **Compte Google (facultatif, `SAM_GOOGLE_CLIENT_ID`) :** lier son musée pour le retrouver sur un autre appareil. Seule une empreinte de l'identifiant Google est gardée.
- **Mise en ligne :**
  - `Dockerfile` et `docker-compose.yml` avec Caddy (HTTPS automatique) ;
  - `assetlinks.json` pour l'APK Android (TWA via Bubblewrap) ;
  - page de confidentialité ;
  - en-têtes de sécurité ;
  - adresse réelle des joueurs derrière le proxy (`SAM_TRUST_PROXY`).

**Phase 4 — enchères, notifications, admin** (`server/auctions.mjs`, `server/push.mjs`, `src/game/auction.ts`, `admin/`) :
- **Hôtel des ventes :** on y entre à pied (E devant la porte, sur la place) ou par le bouton 🔨 quand une vente est en cours ou commence dans moins de 15 min. Une seule salle pour tout le serveur.
  - Chaque joueur est assis automatiquement à une place libre. Caméra tournée vers l'estrade : commissaire-priseur, chevalet sous projecteur, panneau des prix.
  - Les collectionneurs PNJ sont assis dans la salle et lèvent la main quand ils enchérissent.
- **Planning (heure de Paris) :**
  - vente express toutes les 30 min (3 lots, Rare à Épique) ;
  - grande vente à 13 h et 19 h (6 lots, Épique à Légendaire) ;
  - vente prestige le dimanche à 20 h (3 lots, Légendaire à Mythique) ;
  - ventes « admin abuse » programmées depuis le panneau admin.
- **Déroulé d'un lot :** présentation 5 s, puis enchères 20 s. Une enchère dans les 10 dernières secondes relance le chrono à 10 s (anti-sniping).
- **Enchères :** mise à prix 50 % de l'estimation, boutons +5 %, +10 %, +25 % ou montant libre.
  - L'argent du meilleur enchérisseur est bloqué, rendu dès qu'il est surenchéri, et rendu aussi si le serveur redémarre.
  - Les PNJ montent jusqu'à 60–95 % de l'estimation.
  - L'œuvre adjugée arrive directement dans le musée du gagnant (ou dans sa réserve), même s'il a quitté la salle.
  - La Joconde reste unique : une Mythique déjà possédée ne repasse pas en vente.
- **Notifications push :** standard Web Push (VAPID), le mécanisme que FCM utilise dans Chrome, sans compte Firebase. Clés générées au premier lancement dans `server/data/vapid.json`.
  - **Déclencheurs :** vol en cours (caméra, laser, sabotage), œuvre volée, gardes sur le départ (10 min avant), grandes ventes et ventes prestige (15 min avant), admin abuse (dès l'annonce), caisse pleine.
  - Envoyées seulement aux joueurs absents. Réglables par catégorie (🛡 Sécurité → Alertes).
  - 6 par jour au maximum, rien entre 22 h et 8 h sauf « vol en cours » si le joueur l'active.
  - La permission est demandée après le premier achat, jamais au chargement.
  - Sur iPhone : jeu installé sur l'écran d'accueil (iOS 16.4+).
- **Panneau admin** (`/admin/`, jeton dans la variable `SAM_ADMIN_TOKEN`, désactivé sans elle) : planning, création d'une vente admin abuse (titre, date au moins 1 h à l'avance, 1 à 8 lots avec cadre), annonce (push et bandeau en jeu), annulation, derniers lots adjugés, dernières notifications, joueurs en ligne.
- **Barre live :** affiche « 🔴 en direct » pendant une vente ; la landing aussi.

**Phase 3 — sécurité, failles et marché noir** (`server/guards.mjs`, `src/game/guards.ts`, panneau Sécurité, tente du marché noir) :
- **Gardes sous contrat :** Vigile (1 garde, 30 min), Agents (2, 2 h) ou Brigade (3, 8 h). Prix proportionnel au revenu. Simulés par le serveur, y compris quand le propriétaire est absent.
  - Rondes de salle en salle, pause au centre en tournant sur eux-mêmes.
  - Vision : cône de ±55° sur 10 m, affiché au sol, limité à leur salle (les murs arrêtent le regard).
  - Poursuite à 6 m/s ; arrestation au contact (amende 10 % et 60 s de cellule si le voleur portait l'œuvre, 30 s sinon).
- **Caméras** (24 h, une par salle) : un décrochage déclenche l'alarme, le propriétaire est prévenu et les gardes accourent. Sans caméra, la sirène ne sonne plus.
- **Lasers aux portes** (permanents) : alarme si l'on sort avec une œuvre.
- **Vitrines blindées** (par emplacement) : décrochage ×2, puis ×3.
- **Générateur de secours** : caméras et lasers restent allumés pendant une coupure ; le sabotage prend 10 s et déclenche l'alarme.
- **Assurance** (24 h) : rembourse 50 % d'une œuvre volée.
- **Failles voulues et lisibles :**
  - relève de la garde toutes les 10 min (8 s sans patrouille, le garde bâille 6 s avant) ;
  - angles morts entre les salles ;
  - fin de contrat (alerte 10 min avant) ;
  - outils du marché noir.
- **Marché noir** (tente violette, E) : brouilleur (caméras coupées 15 s), fumigène (gardes aveuglés 6 s), pied-de-biche (décrochage ÷2), leurre (un garde distrait 6 s), pince à câbles (coupure de courant 20 s). Usage unique, 3 de chaque au plus, touches 1 à 5.
- **Retour du joueur :** résumé des vols subis, des voleurs arrêtés par les gardes et des tentatives repérées. Les protections de chaque musée s'affichent sur son enseigne.
- **Anti-triche :** la cellule survit à une reconnexion.

**Phase 2 — multijoueur et vol** (`server/district.mjs`, `src/game/net.ts`, `remote.ts`, `museumView.ts`) :
- **Quartiers en temps réel :** WebSocket `/ws` (bibliothèque `ws`). Jusqu’à 7 joueurs en ligne par quartier, une parcelle chacun, attribuée par le serveur. Positions relayées 10 fois par seconde, vitesse contrôlée par le serveur.
- **Musées en sommeil :** les parcelles libres accueillent les musées de joueurs hors ligne, de valeur proche. On peut les visiter et les voler, au plus une œuvre toutes les 2 h pendant l’absence. Le volé l’apprend à sa reconnexion.
- **Vol :** dans un musée rival, maintenir E devant une œuvre (2,5 s pour une Commune, jusqu’à 12 s pour une Mythique). On la porte ensuite au-dessus de la tête, ralenti de 30 %, jusqu’à son propre musée. Le propriétaire présent est alerté (sirène, écran rouge, voleur marqué ⚠).
- **Arrestation :** il suffit que le propriétaire touche le voleur. L’œuvre revient, le voleur paie 10 % de sa valeur d’amende et passe 60 s en cellule.
- **Protections :** verrou des portes (laser, 60 s, recharge 3 min), bouclier débutant (24 h tant que le musée vaut moins de 100 000), immunité de 15 min après un vol, interdiction de voler un musée valant moins de la moitié du sien.
- **Le serveur décide de tout :** portée, durée, livraison, arrestation et transfert de propriété. Une œuvre en cours de vol ne rapporte plus rien. Si le serveur redémarre pendant un vol, l’œuvre revient à son propriétaire.

**Phase 1 — tranche jouable solo** (`game/`, `src/game/`) :
- **Personnage :** RobotExpressive (Quaternius, CC0), animé : repos, marche, course, saut, gestes. Commandes ZQSD / WASD, joystick tactile, caméra à la 3e personne qui passe au-dessus des murs dans le musée.
- **Quartier :** place centrale, route du convoi, fontaine, classement géant des musées les plus riches, musées rivaux, hôtel des ventes (phase 4) et tente du marché noir (ouverte en phase 3).
- **Votre musée :** un local qui s’agrandit jusqu’à 9 salles (niveaux 1 à 5), emplacements muraux, revenu affiché au-dessus de chaque œuvre, visiteurs PNJ qui viennent admirer les œuvres.
- **Économie, entièrement calculée par le serveur :**
  - **Convoi :** un camion toutes les 20 s, raretés Commun / Rare / Épique, cadres dorés (×2) et diamant (×5).
  - **Caisse :** elle se remplit selon le revenu, avec un plafond de 2 h ; 50 % du rythme hors ligne.
  - **Encaissement :** on marche sur le cercle doré.
  - **Agrandissement et revente :** agrandissement payant, revente à 50 %.
- **Catalogue :** 18 œuvres réelles du domaine public (Wikimedia Commons, crédits dans `public/art/credits.json`). 15 s’achètent au convoi ; les Légendaires et La Joconde (Mythique, unique) arriveront avec les enchères.
- **Sauvegarde :** sur le serveur (compte invité, jeton dans le navigateur) ; la partie reprend au rechargement.
- **Objectifs guidés :** 12 étapes, récompenses validées par le serveur. Couleur du personnage au choix. Rang au classement dans l’interface. Façade à colonnes au nom du musée.
- **Qualité graphique :** HD ou Éco (sans ombres, résolution 1×), Éco par défaut sur téléphone.
- **Équilibrage :** taux de revenu par rareté ; `node tools/simulate.mjs [minutes] [parties]` mesure le rythme de progression (voir le cahier des charges).
- **Landing page** : bouton Jouer, présentation, Mythiques, planning des ventes, musées des joueurs.
- **Barre live** en haut de la landing et du jeu, avec des chiffres réels venus du serveur : joueurs en ligne, visiteurs depuis le lancement, heure de Paris, compte à rebours de la prochaine vente, prochaine grande vente, musée n°1.
- **PWA** : manifeste, icônes, service worker ; le jeu s’installe et s’ouvre hors connexion.
- **Ancien prototype :** l’éditeur de musée à la première personne (ex-Memory Museum) reste disponible sur `/museum/`. Il sert de base technique (salles, accrochage, rendu).

Stack : Three.js 0.170, TypeScript, Vite (multi-pages), serveur Node avec deux dépendances (`ws` pour le temps réel, `web-push` pour les notifications).

> ⚠️ Vite ne fonctionne pas si le chemin du projet contient un `#` (par exemple `C:\Users\#NESTOR.COM\…`).
> Gardez le projet dans un dossier comme `C:\dev\game-hub`.

## Démarrer

```bash
npm install
npm run server   # terminal 1 : API (musées publiés) sur http://127.0.0.1:3001
npm run dev      # terminal 2 : http://127.0.0.1:5173 (redirige /api vers le serveur)
```

Production (build + un seul serveur pour le site et l'API) :

```bash
npm start        # http://127.0.0.1:3001   (variables PORT et HOST disponibles)
```

Variables utiles : `SAM_ADMIN_TOKEN` (active le panneau `/admin/`), `SAM_VAPID_SUBJECT` (contact des notifications push, une URL ou `mailto:`). En mode test (`SAM_DEV=1`), le jeton admin vaut `dev-admin`.

Au premier lancement, le serveur crée 3 musées de démonstration pour que l'onglet « Explorer » ne soit pas vide.

## Commandes

| Touche | Action |
| --- | --- |
| ZQSD / WASD / flèches, Maj | marcher, courir |
| Souris | regarder |
| **E** | mode édition : viser un mur et cliquer pour une photo, une œuvre générée ou un son ; viser le sol et cliquer pour une sculpture ; cliquer sur une œuvre pour la modifier |
| Échap | menu : **Plan & salles** (agrandir, choisir l'ambiance), **Publier**, **Explorer les musées**, export/import JSON |

## Architecture

```
index.html                 accueil + musées de la communauté (src/hub/)
museum/index.html          interface du musée (menu à onglets, fenêtre d'œuvre)
src/shared/theme.css       thème commun

src/museum/
  Room.ts                  MuseumBuilding : grille de salles, portes, murs, 4 ambiances, collisions
  MuseumExhibitor.ts       Wall Snapping Engine (normale en repère monde) + placement au sol
  Artifact.ts              photos, sons (PositionalAudio), sculptures, halos lumineux
  art.ts                   générateur d'œuvres procédurales déterministes (gen:style:seed)
  storage.ts               sauvegarde locale, validation, migration v1 → v2
  defaults.ts              musée de départ
  api.ts                   client REST
  main.ts                  contrôles FPS, édition, plan, publication, exploration, visite

server/index.mjs           API REST + fichiers statiques
server/seeds.mjs           musées de démonstration
tests/smoke.mjs            tests navigateur de bout en bout (Playwright + Edge)
```

## API (serveur Node)

| Méthode | Route | Rôle |
| --- | --- | --- |
| POST | `/api/game/login` | crée un joueur invité `{ name }` ou reprend une session `{ id, token }` ; renvoie l’état et le gain hors ligne |
| GET | `/api/game/state`, `/api/game/convoy`, `/api/game/leaderboard` | état du joueur (caisse à jour), camions en cours, musées les plus riches |
| POST | `/api/game/buy`, `/collect`, `/expand`, `/sell`, `/name` | actions validées par le serveur (en-têtes `x-player-id` et `x-player-token`) |
| POST | `/api/game/security` | `{ item: guards\|cameras\|lasers\|generator\|insurance\|vitrine, tier?, slot? }` : acheter une protection |
| POST | `/api/game/blackmarket` | `{ tool }` : acheter un outil de cambrioleur |
| POST | `/api/game/push/subscribe`, `/api/game/push/prefs` | abonner un appareil aux notifications, régler les catégories |
| GET | `/api/push/key` | clé publique VAPID |
| GET/POST/DELETE | `/api/admin/overview`, `/api/admin/sales[/:id[/announce\|/start]]` | panneau admin (en-tête `x-admin-token`) ; `start` seulement en mode test |
| WS | `/ws` | quartier en temps réel. Client → serveur : `auth`, `pos`, `steal`, `steal-cancel`, `lock`, `tool`, `refresh`, `hall-enter`, `hall-leave`, `bid`. Serveur → client : `welcome`, `snap` (joueurs et gardes), `plot`, `steal`, `alarm`, `tool`, `fx`, `hall`, `won`, `sale`… |
| GET | `/api/live?v=<id visiteur>` | flux SSE de la barre live, envoyé toutes les 5 s ; la connexion ouverte compte comme « en ligne », plusieurs onglets comptent pour une personne |
| GET | `/api/stats` | mêmes chiffres en une requête (secours) |
| GET | `/api/museums?sort=popular\|recent` | liste publique |
| POST | `/api/museums` | publier `{ museum, thumbnail }` → `{ id, token }` |
| PUT | `/api/museums/:id` (en-tête `x-edit-token`) | mettre à jour son musée |
| GET | `/api/museums/:id` | charger un musée (compte une vue) |
| GET | `/api/museums/:id/thumb` | vignette JPEG |
| POST | `/api/museums/:id/like` | « j'aime » (un par visiteur) |

Les données envoyées sont validées et nettoyées, la taille est limitée et un anti-abus simple par IP est en place. Le jeton d'édition n'est stocké que sous forme de hachage.

## Tests

Avec le serveur lancé en mode test (`SAM_DEV=1`, qui active `/api/game/dev/grant` pour donner des pièces ; jamais en production) et `npm run dev` :

```powershell
$env:SAM_DEV="1"; npm run server
```

Puis :

```bash
npm test         # PW_CHANNEL=chrome pour utiliser Chrome au lieu d'Edge
npm run test:pwa # après « npm start » : service worker, manifeste, icônes, ouverture hors connexion
npm run test:server # serveur en mode test, sans navigateur :
                    #   tests/ws.mjs      vol, arrestation, verrou, musée endormi, gardes, caméras, vitrines, outils, étages, billet, Mythique, chasseur de primes, déguisement, reproductions
                    #   tests/auction.mjs enchères (PNJ, argent bloqué, adjudication), notifications, admin
```

Les tests de la landing vérifient la barre live : chiffres reçus du serveur, heure, compte à rebours, un seul « en ligne » pour deux onglets, pas de défilement horizontal sur mobile.

Les tests couvrent :
- l'ajout d'une salle et le changement d'ambiance ;
- la création d'une sculpture, d'une œuvre générée et d'une photo ;
- la publication et la liste « Explorer » ;
- la visite en lecture seule et le « j'aime ».

Les captures sont écrites dans `tests/shots/`.

## Limites connues

- Les musées publiés sont stockés en fichiers JSON dans `server/data/`. Il n'y a ni base de données ni comptes utilisateurs : le jeton d'édition est gardé dans le navigateur de l'auteur.
- Photos et sons sont stockés en data-URL. La sauvegarde locale du navigateur (environ 5 Mo) sature vite avec de l'audio : publiez ou exportez.

# Steal a Masterpiece — Le casse du siècle

Jeu de gestion multijoueur en 3D, dans le navigateur et installable en PWA : bâtir le plus grand musée du monde, acheter des chefs-d’œuvre aux enchères, les protéger… et voler ceux des autres. Voir le cahier des charges pour la conception complète et la roadmap.

**État : phases 0 à 6 terminées, prêt à mettre en ligne** (voir [docs/LANCEMENT.md](docs/LANCEMENT.md)). Version actuelle : **1.3.0**.

**Journal des versions** : `src/shared/changelog.json` (versions, nouveautés, corrections, feuille de route), affiché sur
la page d'accueil (section « Journal des versions ») et dans le jeu (menu ☰ → Nouveautés). **À compléter à chaque livraison.**

**Version 1.3 — Lucky coffres, inventaire, nouvelle prise en main :**
- **STH coins** (monnaie premium) : en argent réel (T-Money, Flooz / Moov Money, cartes Visa / Mastercard, PayPal) ou en
  échangeant ses pièces (1 STH = 1 M de pièces, 100 STH et 3 échanges au plus par mois). Offres de 100 à 15 000 STH, prix en FCFA, euros ou dollars selon le pays.
  Paiements vérifiés par le serveur auprès du prestataire, crédités une seule fois : [docs/PAIEMENTS.md](docs/PAIEMENTS.md).
- **Lucky coffres** (simple 60, rare 180, épique 450, légendaire 1 200 STH ; lot de 5 à −10 %) : une œuvre par coffre,
  probabilités affichées avant l'achat et l'ouverture, garantie après une série malchanceuse, Mythique seulement si elle
  est libre. Les coffres attendent dans l'inventaire ; ouverture animée selon la rareté (suspense, rayons, éclat, carte).
- **Inventaire** (🎒, touche I) : coffres, œuvres exposées (ranger, vendre), réserve (exposer, remplacer une œuvre au choix),
  outils du marché noir, album de la collection.
- **Tutoriel interactif** au premier lancement (déplacement, caméra, saut, achat au convoi, accrochage, caisse, inventaire,
  coffres) avec une flèche dorée en 3D ; menu ☰ → Tutoriel pour le revoir.
- **Prise en main** : caméra au clic gauche ou droit qui se replace derrière le personnage ; course par défaut (Maj pour
  marcher) ; saut plus franc (gravité plus forte à la descente, saut mémorisé, pose en l'air, écrasement à l'atterrissage,
  vrille au double saut) ; cadence des pas accordée à la vitesse ; champ de vision élargi en pleine course.
- **Couleurs** : rendu « Neutral » au lieu d'ACES (qui délavait), lumière plus claire, pelouse et pavés lumineux.
- **Interface compacte** : porte-monnaie sur une ligne (pièces, revenu, STH ; détails au toucher), objectif réductible,
  menu ☰ (voix, son, graphismes, commandes, tutoriel, nouveautés).
- **Téléphone** : joystick qui apparaît sous le pouce (moitié gauche de l'écran) et court dès 60 % d'inclinaison, boutons
  d'action redessinés, conseil « tournez votre téléphone » en portrait, application Android en paysage (`npm run android:apk`).
- **Pays** : Togo, Bénin, Burkina Faso, Mali, Niger, Guinée, Gabon, Congo, RD Congo, Tchad, Ghana, Nigeria… (devinés à
  l'inscription d'après la langue du navigateur).

**Phase 9 — plus vivant, plus fun :**
- **Coup de parapluie ☂** (touche F, bouton violet sur mobile) : le joueur le plus proche (2,6 m, même étage) est projeté en arrière et sonné 1,1 s. Un voleur touché lâche l'œuvre, qui retourne aussitôt chez son propriétaire. Recharge 2,5 s ; impossible de voler pendant qu'on est sonné. Tout est décidé par le serveur.
- **Événements en direct (« admin abuse »)**, lancés depuis le panneau admin ou au hasard chaque soir à 21 h (heure de Paris) : 💰 **Pluie d'or** (3 min : des pièces tombent sur la place, la première personne qui passe dessus empoche environ 15 s de revenu), 🌈 **Convoi arc-en-ciel** (10 min : un camion sur quatre porte un cadre arc-en-ciel), ⚡ **Super vitesse** (10 min : tout le monde court 60 % plus vite, contrôle de vitesse du serveur compris). Fanfare, confettis, ciel et porte-monnaie aux couleurs de l'événement.
- **Cadre arc-en-ciel** (×10, 1 chance sur 1 000 au convoi) : arc-en-ciel qui défile sur le cadre (ou le socle d'une statue), étincelles multicolores.
- **Tenues** : 4 silhouettes au choix (costume, tailleur, décontracté, décontractée), à la couleur du joueur, visibles par tous. Choix à l'inscription et dans « Compte ».
- **Déplacements** : marche et course plus rapides (5,4 et 8,6 m/s), double saut, poussière sous les pieds en courant et à l'atterrissage.
- **Monde plus lumineux** : ciel avec des nuages qui dérivent et un halo de soleil, étincelles au-dessus des œuvres Épiques et plus, classement de la place lisible des deux côtés.

**Comptes, application mobile, maintien en éveil :**
- **Comptes** (`server/accounts.mjs`) : inscription par nom d'utilisateur, e-mail et mot de passe (empreinte scrypt), connexion sur n'importe quel appareil, « mot de passe oublié » par e-mail (Brevo, lien valable 1 h, qui ferme les autres sessions), connexion Google (crée le compte au premier passage). Un invité qui s'inscrit garde son musée. « Jouer sans compte » reste possible.
- **Application Android** (Capacitor, `capacitor.config.ts`, `android/`) : plein écran immersif, écran allumé, micro, icône et écran de démarrage tirés du logo. Elle ouvre le jeu en ligne. Voir [docs/MOBILE.md](docs/MOBILE.md).
- **Interface compacte sur téléphone** : porte-monnaie repliable (toucher pour les détails), objectif réduit, boutons en colonne, marges de l'encoche respectées.
- **`/api/ping`** : à appeler toutes les 10 min (Upstash QStash) pour garder le service Render et la base Neon éveillés.

**Accueil et identité visuelle :**
- **Page d'accueil** (`index.html`, `src/landing/main.ts`) : « la salle rouge, après la fermeture ». Un mur de velours où la Joconde a disparu : cadre vide sous un projecteur, laser, bouton « Jouer gratuitement » à la place du tableau et cartel « Volée cette nuit ». Puis le sens de la visite (les 4 étapes du jeu), la collection (une œuvre par rareté, valeur et revenu lus dans le catalogue), le casse, le planning des ventes en direct, le jeu entre amis et les questions fréquentes.
- **Logo** : cadre doré à rosettes, masque de voleur ivoire sur toile de velours, éclat d'or et laser. `public/icons/icon.svg` (icône d'application) et `public/logo.svg` (marque seule) ; PNG régénérés par `npm run icons`.
- **Polices hébergées sur le site** (`public/fonts/`, aucune requête vers un service tiers) : Cinzel pour les titres, Bricolage Grotesque pour le texte.

**Phase 8 — social et vie de la place :**
- **Discussion du quartier** (Entrée pour écrire) : historique en bas à droite, bulles au-dessus des personnages, messages du jeu (arrivées, casses, arrestations, ventes). 4 messages / 8 s au plus, 140 caractères, injures courantes masquées par le serveur.
- **Émotes** 👋 😂 🔥 😱 👏 ❤️ : grande icône au-dessus de la tête, avec un geste.
- **Discussion vocale de proximité** (bouton 🎙, désactivée par défaut) : WebRTC pair à pair entre joueurs du même quartier ; le serveur ne relaie que la signalisation, entre deux micros actifs. Volume selon la distance (plein à 5 m, muet à 25 m), 🔊 au-dessus de qui parle, touche V pour couper son micro. STUN public par défaut ; `SAM_ICE_SERVERS` (JSON) pour ajouter un serveur TURN.
- **Amis et quartier** (bouton 👥) : code et lien d'invitation (`/game/?join=CODE`) pour faire venir un ami dans son quartier (s'il y a de la place et que l'on est en ligne), champ « Rejoindre un ami », liste des joueurs présents avec bouton « Masquer » (ni texte ni voix).
- **Place animée :** guirlandes de fanions, fleurs, bancs (les passants s'y assoient), jets de la fontaine ; confettis aux grands moments (casse, agrandissement, enchère gagnée, Renaissance, récompense du jour) et gains flottants à la caisse.

**Phase 7 — progression, vie du quartier, rendu :**
- **Boutique** (étal bleu sur la place, touche B ou bouton 🛒) : 5 améliorations permanentes à 3 niveaux, gardées après une Renaissance.
  - 👟 Baskets de sprint (+12/24/36 % de vitesse, contrôlée aussi par le serveur) ;
  - 🔒 Verrou renforcé (75/90/120 s) ;
  - 💰 Coffre-fort (caisse de 3/4/6 h) ;
  - 🧤 Gants de velours (décrochage −15/28/40 %) ;
  - 🍀 Flair de collectionneur (Rares et Épiques ×1,3/1,7/2,2 au convoi).
- **Renaissance** (dès le niveau 5, 50 M puis ×5 à chaque fois) : on repart de zéro (musée, œuvres, pièces) contre un revenu ×1,5, ×2, ×2,5… pour toujours. Badge ⭐ au-dessus du musée.
- **Récompense du jour** (bouton 🎁) : la série grandit si l'on revient chaque jour ; montant indexé sur le revenu (10 à 40 min).
- **Événements du convoi** (toutes les 15 min, pendant 3 min, les mêmes pour tous) : ✨ Heure dorée (cadres ×4), 💎 Trésors rares (Rares et Épiques ×3), 🏷 Soldes (−30 %). Annoncés dans le porte-monnaie et sur les camions.
- **Quartier réorganisé :** le classement géant est au sud de la place, entre deux musées, face à la route ; le marché noir et la boutique sont entre deux musées (avant, ils barraient une allée et un point d'apparition) ; lampadaires au bord des trottoirs.
- **Façades :** vraie porte dans le portique (avant, un mur plein la barrait), travée centrale dégagée, haut du portique masqué quand on est dedans ou dessous (il cachait la vue).
- **Textures procédurales :** parquet en chevrons et damas (classique), béton ciré (moderne), grille néon (futuriste), tatami et shōji (zen). Tableaux à leurs vraies proportions, statues célèbres figuratives (Penseur, Vénus de Milo, Victoire de Samothrace, David).
- **Personnages :** 4 tenues (homme/femme, ville/costume) et apparence aléatoire (teint, cheveux, vêtements) pour les visiteurs, les passants et les collectionneurs, qui s'assoient vraiment dans la salle des ventes.
- **PNJ :** les visiteurs arrivent par le trottoir, prennent l'allée, passent la porte et les arcades ; des passants flânent sur la place (fontaine, classement, boutiques, façades) sans jamais traverser la route du convoi.

**Phase 6 — compléments du cahier des charges :**
- **Billet d'entrée :** entrer chez un rival (pour visiter ou voler) coûte 0,05 % de la valeur de son musée (20 pièces au minimum), encaissé par le propriétaire. Le billet vaut 10 min. Sans argent, on reste dehors.
- **Vol d'une Mythique :** décrochage de 20 s ; l'alarme sonne même sous brouilleur ; tout le serveur est prévenu ; n'importe quel joueur qui touche le voleur l'arrête et empoche 1 % de la valeur de l'œuvre (8 M pour la Joconde).
- **Déguisement d'employé** (marché noir, 60 s) : les gardes ignorent le voleur. Les autres joueurs voient son badge « employé ».
- **Chien de garde** (4 h) : flaire les déguisements, les gardes repèrent alors le voleur quand même.
- **Reproductions** (marché noir, 5 000) : copies des Mythiques, marquées « Reproduction ». Décoratives, sans valeur ni revenu, et les voleurs n'en veulent pas.

**Phase 5 — étages, classements, catalogue, lancement :**
- **Étages :** niveau 6 (1er étage, 600 M) et niveau 7 (2e étage, 6 Md), chacun avec 9 salles. 214 emplacements muraux au total.
  - Niveau 8 (30 Md) : toit-terrasse avec 18 socles réservés aux statues (232 emplacements). Un tableau ne va jamais sur un socle ; avant la terrasse, une statue se pose au sol devant un mur.
  - Au rez-de-chaussée, chaque salle ouverte reçoit ses emplacements (4 dans l'entrée, puis 6 par salle) ; les autres murs s'ouvrent avec le 1er étage.
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
- **Panneau admin** (`/admin/`, jeton dans la variable `SAM_ADMIN_TOKEN`, désactivé sans elle) : événements en direct (pluie d'or, convoi arc-en-ciel, super vitesse, arrêt), planning, création d'une vente admin abuse (titre, date au moins 1 h à l'avance, 1 à 8 lots avec cadre), annonce (push et bandeau en jeu), annulation, derniers lots adjugés, dernières notifications, joueurs en ligne.
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
- **Musées en sommeil :** les parcelles libres accueillent les musées de joueurs hors ligne, de valeur proche. On peut les visiter et les voler à tout moment pendant leur absence, le nombre de fois qu'on veut. Le volé l’apprend à sa reconnexion.
- **Vol :** dans un musée rival, maintenir E devant une œuvre (2,5 s pour une Commune, jusqu’à 12 s pour une Mythique). On la porte ensuite au-dessus de la tête, ralenti de 30 %, jusqu’à son propre musée. Le propriétaire présent est alerté (sirène, écran rouge, voleur marqué ⚠).
- **Arrestation :** il suffit que le propriétaire touche le voleur. L’œuvre revient, le voleur paie 10 % de sa valeur d’amende et passe 60 s en cellule : le serveur le retient devant son musée, sans pouvoir bouger, voler ni utiliser d'outil.
- **Achat au convoi :** l'œuvre achetée arrive entre les mains du joueur ; E devant un emplacement de son musée pour l'accrocher (Échap la laisse à l'emplacement attribué par le serveur).
- **Protections :** verrou des portes (laser, 60 s, recharge 3 min : personne ne franchit la porte, ni pour entrer ni pour sortir), bouclier débutant (24 h tant que le musée vaut moins de 100 000). On peut voler n’importe quel musée, le nombre de fois qu'on veut et à tout moment, quelle que soit sa valeur.
- **Le serveur décide de tout :** portée, durée, livraison, arrestation et transfert de propriété. Une œuvre en cours de vol ne rapporte plus rien. Si le serveur redémarre pendant un vol, l’œuvre revient à son propriétaire.

**Phase 1 — tranche jouable solo** (`game/`, `src/game/`) :
- **Personnage :** RobotExpressive (Quaternius, CC0), animé : repos, marche, course, saut, gestes. Commandes ZQSD / WASD, joystick tactile, caméra à la 3e personne qui passe au-dessus des murs dans le musée.
- **Quartier :** place centrale, route du convoi, fontaine, classement géant des musées les plus riches, musées rivaux, hôtel des ventes (phase 4) et tente du marché noir (ouverte en phase 3).
- **Votre musée :** un local qui s’agrandit jusqu’à 9 salles (niveaux 1 à 5), emplacements muraux, revenu affiché au-dessus de chaque œuvre, visiteurs PNJ qui viennent admirer les œuvres.
- **Économie, entièrement calculée par le serveur :**
  - **Convoi :** un camion toutes les 8 s (traversée de 40 s, cinq camions sur la route en même temps), raretés Commun / Rare / Épique, cadres dorés (×2) et diamant (×5). L’œuvre est exposée en grand dans une vitrine vitrée des deux côtés.
  - **Caisse :** elle se remplit selon le revenu, avec un plafond de 2 h ; 50 % du rythme hors ligne.
  - **Encaissement :** on marche sur le cercle doré.
  - **Agrandissement et revente :** agrandissement payant, revente à 50 %.
- **Catalogue :** 18 œuvres réelles du domaine public (Wikimedia Commons, crédits dans `public/art/credits.json`). 15 s’achètent au convoi ; les Légendaires et La Joconde (Mythique, unique) arriveront avec les enchères.
- **Sauvegarde :** sur le serveur (compte invité, jeton dans le navigateur) ; la partie reprend au rechargement.
- **Objectifs guidés :** 12 étapes, récompenses validées par le serveur. Couleur du personnage au choix. Rang au classement dans l’interface. Façade à colonnes au nom du musée.
- **Qualité graphique :** HD ou Éco (sans ombres, résolution 1×), Éco par défaut sur téléphone.
- **Équilibrage :** taux de revenu par rareté ; `node tools/simulate.mjs [minutes] [parties]` mesure le rythme de progression (voir le cahier des charges).
- **Accueil** : page de présentation à la racine du site, bouton « Jouer gratuitement » vers `/game/`.
- **Barre live** en haut du jeu (capsule), avec des chiffres réels venus du serveur : joueurs en ligne, compte à rebours de la prochaine vente (ou vente en direct), musée n°1. Le serveur compte aussi les visiteurs depuis le lancement (`/api/stats`).
- **PWA** : manifeste, icônes, service worker ; le jeu s’installe et s’ouvre hors connexion. Modèles 3D et œuvres sont servis depuis le cache puis rafraîchis en arrière-plan.

Stack : Three.js 0.170, TypeScript, Vite (serveur de développement), esbuild (build de production), serveur Node avec deux dépendances (`ws` pour le temps réel, `web-push` pour les notifications).

> ⚠️ Vite ne fonctionne pas si le chemin du projet contient un `#` (par exemple `C:\Users\#NESTOR.COM\…`).
> Gardez le projet dans un dossier comme `C:\dev\game-hub`.

## Démarrer

```bash
npm install
npm run server   # terminal 1 : API + temps réel sur http://127.0.0.1:3001
npm run dev      # terminal 2 : http://127.0.0.1:5173/game/ (redirige /api et /ws vers le serveur)
```

Production (build + un seul serveur pour le site et l'API) :

```bash
npm start        # http://127.0.0.1:3001   (variables PORT et HOST disponibles)
```

**Mise en ligne** : page d'accueil sur Vercel, jeu et API sur Render, base sur Neon, voir [docs/DEPLOIEMENT.md](docs/DEPLOIEMENT.md) (`vercel.json`, `render.yaml`, `npm run build:landing`). Serveur unique avec Docker et Caddy : [docs/LANCEMENT.md](docs/LANCEMENT.md).

`npm run build` vide `dist/`, vérifie les types, puis produit des bundles minifiés (avec source maps) : le code réservé au développement (`import.meta.env.DEV`, dont l'accès de test `window.__game`) en est retiré.

Variables utiles :

| Variable | Rôle |
| --- | --- |
| `SAM_ADMIN_TOKEN` | active le panneau `/admin/` (en mode test, le jeton vaut `dev-admin`) |
| `SAM_VAPID_SUBJECT` | contact des notifications push (une URL ou `mailto:`) |
| `SAM_TRUST_PROXY=1` | derrière un proxy (Caddy, Render) : l'adresse du joueur est la **dernière** de `X-Forwarded-For` |
| `SAM_PROXY_HOPS` | plusieurs proxys en chaîne : nombre d'adresses à ignorer en fin de `X-Forwarded-For` (1 par défaut) |
| `SAM_DATA_DIR` | dossier des données (par défaut `server/data`) ; pratique pour un serveur de test isolé |
| `SAM_API` | (développement) adresse du serveur Node pour le proxy Vite, par défaut `127.0.0.1:3001` |
| `DATABASE_URL` | PostgreSQL (Neon…) : joueurs, ventes, clés push et visiteurs en base, plus besoin de disque ; import automatique des fichiers JSON au premier démarrage sur une base vide. Sans elle : fichiers dans `server/data` |
| `SAM_PUBLIC_URL`, `BREVO_API_KEY`, `SAM_MAIL_FROM` | e-mails « mot de passe oublié » (adresse publique du jeu pour le lien, clé Brevo, expéditeur validé) |
| `SAM_CORS_ORIGINS` | domaines de la page d'accueil hébergée ailleurs (Vercel) autorisés à lire `/api/live` et `/api/stats` (`*.vercel.app` accepté) |
| `SAM_CLIENT_IP_HEADER` | en-tête de l'hébergeur portant l'adresse du client (avec `SAM_TRUST_PROXY=1`) |
| `SAM_GAME_URL` | (build de la page d'accueil seule, `npm run build:landing`) adresse du jeu, ex. `https://jouer.mondomaine.fr` |
| `SAM_ICE_SERVERS` | serveurs ICE de la voix, en JSON (ex. `[{"urls":"turn:turn.exemple.fr:3478","username":"u","credential":"p"}]`) ; par défaut un STUN public |
| `FEDAPAY_SECRET_KEY`, `FEDAPAY_ENV`, `PAYGATE_AUTH_TOKEN`, `CINETPAY_API_KEY`, `CINETPAY_SITE_ID`, `PAYPAL_CLIENT_ID`, `PAYPAL_SECRET`, `PAYPAL_ENV` | paiements des STH coins (T-Money, Flooz, cartes, PayPal) : voir [docs/PAIEMENTS.md](docs/PAIEMENTS.md) |
| `SAM_DEV=1` | mode test : routes `/api/game/dev/*`, faux prestataire de paiement « test », pas de contrôle de vitesse. **Jamais en production** |

## Commandes

| Touche | Action |
| --- | --- |
| ZQSD / WASD / flèches, Maj | courir (par défaut), marcher (Maj maintenue) |
| Espace (deux fois) | sauter, double saut |
| **F** | coup de parapluie ☂ |
| Clic gauche ou droit + souris, molette | tourner la caméra, zoomer (elle se replace aussi derrière le personnage) |
| **I** | inventaire : coffres, œuvres exposées, réserve, outils, album |
| **E** | acheter au convoi, accrocher / déplacer une œuvre, voler (maintenir), monter l'escalier, entrer (hôtel des ventes, marché noir) |
| **R** | revendre une œuvre (deux appuis), descendre l'escalier, décor de la salle |
| **T** | décor de la salle (ambiance, 5 000 pièces) |
| **G** | panneau Sécurité |
| **B** | boutique (Lucky coffres, STH coins, améliorations, récompense du jour, Renaissance) |
| **Entrée** | écrire au quartier (Échap pour fermer) |
| **V** | couper / rétablir son micro (discussion vocale activée par 🎙) |
| **1 à 6** | outils du marché noir (brouilleur, fumigène, pied-de-biche, leurre, pince, déguisement) |
| Échap | fermer un panneau, annuler un déplacement, laisser l'œuvre achetée à sa place |

## Architecture

```
index.html                 page d'accueil (src/landing/main.ts : barre live, ventes, cartels de la collection)
game/index.html            le jeu 3D (src/game/)
admin/index.html           panneau admin des ventes (src/admin/)
src/shared/                catalog.json (œuvres, prix, règles), layout.json (géométrie), live.ts (barre live, PWA), theme.css
src/game/                  client du jeu : main.ts (boucle, HUD, interactions), museumView.ts (musées), district.ts (quartier),
                           net.ts (WebSocket), api.ts (REST), guards.ts, convoy.ts, auction.ts, remote.ts…
                           premium.ts (Lucky coffres, STH coins, paiement, animation d'ouverture), inventory.ts, tutorial.ts
src/shared/changelog.json  journal des versions et feuille de route (accueil + jeu)
server/payments.mjs        paiements des STH coins (FedaPay, PayGate, CinetPay, PayPal) vérifiés serveur à serveur
tools/build-apk.mjs        APK Android (npm run android:apk)
server/index.mjs           HTTP : API, barre live (SSE), fichiers statiques
server/game.mjs            économie (le serveur fait autorité), comptes, classements
server/district.mjs        quartiers temps réel, vols, outils, verrou, billets
server/guards.mjs          intelligence des gardes
server/auctions.mjs        hôtel des ventes
server/push.mjs            notifications Web Push
server/db.mjs              persistance (JSON, PostgreSQL facultatif)
tools/gen-layout.mjs       génère src/shared/layout.json (salles, emplacements, parcelles)
tests/                     ws.mjs et auction.mjs (serveur), smoke.mjs (navigateur), pwa.mjs (build)
```

## API (serveur Node)

| Méthode | Route | Rôle |
| --- | --- | --- |
| POST | `/api/game/login` | crée un joueur invité `{ name, color, country, skin }` ou reprend une session `{ id, token }` ; renvoie l’état et le gain hors ligne |
| POST | `/api/game/register`, `/login/password`, `/password/forgot`, `/password/reset`, `/logout` | comptes : inscription `{ username, email, password }` (avec une session d'invité : son musée devient le compte), connexion, lien de réinitialisation par e-mail, nouveau mot de passe, déconnexion de l'appareil |
| GET | `/api/ping` | maintien en éveil (interroge aussi la base) |
| POST | `/api/game/login/google`, `/api/game/link/google` | retrouver ou lier son musée avec Google (si `SAM_GOOGLE_CLIENT_ID`) |
| GET | `/api/game/state`, `/api/game/convoy`, `/api/game/leaderboard?board=value\|weekly\|theft\|auction\|countries` | état du joueur (caisse à jour), camions en cours, classements (`me: true` sur la ligne du joueur connecté) |
| POST | `/api/game/buy`, `/collect`, `/expand`, `/sell`, `/move`, `/decor`, `/name`, `/claim` | actions validées par le serveur (en-têtes `x-player-id` et `x-player-token`) |
| POST | `/api/game/security` | `{ item: guards\|cameras\|lasers\|generator\|dog\|insurance\|vitrine, tier?, slot? }` : acheter une protection |
| POST | `/api/game/blackmarket` | `{ tool }` (ou `{ tool: 'repro', workId }`) : acheter un outil ou une reproduction |
| POST | `/api/game/upgrade`, `/rebirth`, `/daily` | boutique `{ id: speed\|lock\|vault\|gloves\|luck }`, Renaissance, récompense du jour |
| POST | `/api/game/store`, `/place` | inventaire : ranger une œuvre en réserve `{ uid }`, l'exposer sur le premier emplacement libre `{ uid }` (remplacer : `/move`) |
| POST | `/api/game/sth/exchange`, `/chest/buy`, `/chest/open` | STH coins contre pièces `{ sth }`, achat de coffres `{ id: simple\|rare\|epique\|legendaire, qty: 1\|5 }`, ouverture `{ id }` |
| GET/POST | `/api/pay/config`, `/api/pay/create`, `/api/pay/order?id=`, `/api/pay/notify/:prestataire` | paiements des STH : moyens disponibles et offres, commande `{ pack, method, currency, phone? }`, suivi (vérifié auprès du prestataire), notifications des prestataires |
| POST | `/api/game/push/subscribe`, `/api/game/push/prefs` | abonner un appareil aux notifications, régler les catégories |
| GET | `/api/push/key`, `/api/config` | clé publique VAPID, configuration publique (Google) |
| GET/POST/DELETE | `/api/admin/overview`, `/api/admin/sales[/:id[/announce\|/start]]`, `/api/admin/live` | panneau admin (en-tête `x-admin-token`) ; `start` seulement en mode test ; `live` : POST `{ kind: pluie\|arcenciel\|vitesse, minutes? }` lance un événement en direct, DELETE l'arrête |
| WS | `/ws` | quartier en temps réel. Client → serveur : `auth`, `pos`, `steal`, `steal-cancel`, `lock`, `tool`, `bonk`, `refresh`, `hall-enter`, `hall-leave`, `bid`, `chat`, `emote`, `voice`, `rtc` (l'authentification accepte `join` : code d'invitation). Serveur → client : `welcome`, `snap` (joueurs et gardes), `plot`, `steal`, `alarm`, `tool`, `fx`, `bonk`, `coins`, `coin-got`, `live-event`, `hall`, `won`, `sale`… Ping toutes les 30 s : une connexion morte est fermée |
| GET | `/api/live?v=<id visiteur>` | flux SSE de la barre live, envoyé toutes les 5 s ; la connexion ouverte compte comme « en ligne », plusieurs onglets comptent pour une personne |
| GET | `/api/stats` | mêmes chiffres en une requête (secours, healthcheck) |

Les données envoyées sont validées : seules les clés connues du catalogue sont acceptées (jamais `__proto__`, `constructor`…), les prix doivent être des nombres finis, le pays doit figurer au catalogue. Un anti-abus simple par IP est en place (tables purgées régulièrement).

## Tests

Avec le serveur lancé en mode test (`SAM_DEV=1`, jamais en production) :

```powershell
$env:SAM_DEV="1"; npm run server
```

Puis :

```bash
npm run test:shop   # sans navigateur : STH coins, Lucky coffres (garantie), inventaire, paiements en mode test
npm run test:server # sans navigateur :
                    #   tests/ws.mjs      vol, arrestation, cellule, verrou, musée endormi, gardes, caméras, vitrines, outils, étages,
                    #                     socles de statues, billet, Mythique, chasseur de primes, déguisement, reproductions, clés interdites
                    #   tests/auction.mjs enchères (PNJ, argent bloqué, adjudication), notifications, admin
npm test            # avec « npm run dev » lancé : parties dans le navigateur (PW_CHANNEL=chrome pour Chrome au lieu d'Edge)
                    #   achat puis accrochage, objectifs, caisse, agrandissement, revente, cambriolage à deux, sécurité,
                    #   marché noir, enchères, admin, étages, classements, mobile, barre live
npm run test:pwa    # après « npm start » : service worker, manifeste, icônes, ouverture hors connexion
```

Pour ne pas toucher aux données de `server/data`, on peut lancer un serveur de test isolé :

```powershell
$env:SAM_DEV="1"; $env:PORT="3011"; $env:SAM_DATA_DIR="$env:TEMP\sam-test"; npm run server
node tests/ws.mjs http://127.0.0.1:3011
$env:SAM_API="127.0.0.1:3011"; npx vite --port 5174   # puis : node tests/smoke.mjs http://127.0.0.1:5174
```

Les captures sont écrites dans `tests/shots/`.

## Limites connues

- Quartiers et enchères vivent en mémoire : **une seule instance** du serveur à la fois (y compris avec PostgreSQL).
- Les joueurs sont stockés en fichiers JSON dans `server/data/players/` (ou PostgreSQL si configuré). Un compte invité tient à son jeton, gardé dans le navigateur ; le lier à Google permet de le retrouver ailleurs.

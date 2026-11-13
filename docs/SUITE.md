# Suite du développement — prompt de reprise

Copier le bloc ci-dessous au début d'une nouvelle conversation pour reprendre le travail.

---

```
Projet : Steal a Masterpiece (« Le casse du siècle »), jeu de gestion multijoueur 3D dans le navigateur, PWA.
Dossier : C:\dev\game-hub (Vite refuse les chemins avec « # », donc PAS dans C:\Users\#NESTOR.COM ; une copie y est synchronisée par robocopy).
Stack : Three.js 0.170 + TypeScript + Vite (multi-pages), serveur Node (server/*.mjs) avec `ws` (temps réel) et `web-push` (notifications). Données en JSON dans server/data.
Cahier des charges : https://claude.ai/artifact/BBH5wTM39E5EP81Kin1ENS — README.md et docs/LANCEMENT.md sont à jour.

État : phases 0 à 6 terminées et testées automatiquement (solo, multijoueur et vol, sécurité et failles, enchères + notifications + admin, étages + classements + catalogue de 40 œuvres + kit de mise en ligne, compléments : billet d'entrée, Mythiques, chasseur de primes, déguisement, chien, reproductions).

Lancer :
  terminal 1 : $env:SAM_DEV="1"; npm run server      (API + WebSocket sur 3001, mode test : /api/game/dev/*, admin = « dev-admin »)
  terminal 2 : npm run dev                            (http://127.0.0.1:5173)
Tests : npm run test:server (tests/ws.mjs + tests/auction.mjs, sans navigateur) ; npm test (Playwright + Edge, lent : lancer les tests un par un avec $env:ONLY="game-multi" etc.) ; npm run test:pwa après npm start.
Pour repartir de zéro : arrêter le serveur, supprimer server/data/players et server/data/sales.json.

Règles de travail : le serveur fait autorité sur tout (argent, vols, positions, tirages des coffres, paiements) ; vérifier chaque fonctionnalité par un test automatique ; mettre à jour README.md et le paragraphe « Avancement » du cahier des charges ; À CHAQUE LIVRAISON, ajouter une version dans src/shared/changelog.json (nouveautés, améliorations, corrections, feuille de route : affichée sur la page d'accueil et dans le jeu) et augmenter versionCode/versionName dans android/app/build.gradle ; incrémenter VERSION dans public/sw.js ; terminer par build de production, test PWA et APK (npm run android:apk).
Paiements : docs/PAIEMENTS.md. Application Android : docs/MOBILE.md.

Ce qu'il reste à faire, par ordre d'utilité :
1. TEST AVEC DE VRAIS JOUEURS (jamais fait) : 3 à 5 personnes, sur téléphone, en conditions réelles : un vol, une vente aux enchères, une notification reçue. Corriger ce qui ressort (équilibrage des prix et des durées en priorité).
2. Mise en ligne en suivant docs/LANCEMENT.md : VPS + Docker + Caddy, adresse de contact dans public/confidentialite.html, SAM_ADMIN_TOKEN, SAM_VAPID_SUBJECT, puis APK Android via Bubblewrap. Docker Desktop n'a jamais été lancé ici : l'image n'a pas été construite.
3. Jamais testé avec les vrais services : connexion Google (SAM_GOOGLE_CLIENT_ID), réception d'une notification sur un vrai téléphone, APK.
4. Reste du cahier des charges non fait : toit-terrasse pour statues (pas de statues au catalogue), mode édition pour réorganiser ses œuvres (le placement est automatique), décors à débloquer par salle.
5. Faiblesses connues résolues (verrou laser côté serveur, vision/traversée des gardes en extérieur, recyclage des lots PNJ) ; reste : les données sont des fichiers JSON (prévoir PostgreSQL/Redis si le nombre de joueurs grimpe).
6. Idées du cahier des charges pour plus tard : le faussaire, classements par pays, saisons.
```

---

Tâche en cours au moment de l'écriture de ce fichier : fin de la phase 6 (suite de tests navigateur en cours, puis build de production, test PWA, synchronisation).

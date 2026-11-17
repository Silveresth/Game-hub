# Steal a Masterpiece — 1.11.0

Livré en une passe (versions 1.7.0 à 1.11.0 dans le journal). Rendu Neutral inchangé. Serveur, vols, STH et prix non touchés.

## Vu dans le navigateur

Page `http://127.0.0.1:5173/game/`, invité, palier automatique **moyen** :

- Options : Économie, Moyenne, Haute.
- Scène en jeu : personnage, façade, tapis rouge, HUD compact, tutoriel.
- `renderInfo` : 74 appels, 13 194 triangles, ombre 1024, DPR 1,25, `shadows: true`.

Le compteur d’images/s au moment de la mesure était encore en train de démarrer (onglet occupé par l’inspection). Ce n’est pas une mesure de téléphone.

## Commandes

- `npm run build` : OK (après le correctif de démarrage).
- `npm run test:server` : 1 échec sur l’attente du message de parcelle « protégé 10 min ». L’assertion suivante a bien reçu « encore 10 min ». Relance impossible : La Joconde était déjà prise dans les données de dev.
- `npm test` : non terminé. Un premier passage a révélé deux erreurs de démarrage (corrigées : personnage lu trop tôt, passants créés avant le modèle). Les passages suivants expiraient au chargement de la page, machine saturée.

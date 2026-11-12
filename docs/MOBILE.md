# Application mobile (Capacitor)

L'application Android est une coque native, plein écran, qui ouvre le jeu en ligne (le service Render).
Le jeu se met à jour sans republier l'application : seule la coque (icône, plein écran, permissions) est dans le magasin.

Ce que fait la coque :
- plein écran immersif : barres d'état et de navigation masquées (un balayage depuis le bord les fait réapparaître un instant) ;
- l'écran reste allumé pendant la partie, et l'affichage va jusque sous l'encoche de la caméra ;
- permission du micro pour la discussion vocale (demandée seulement quand le joueur touche 🎙) ;
- une page « Le musée est injoignable » si le serveur ne répond pas ;
- icône et écran de démarrage tirés du logo (`npm run android:assets` les régénère).

Fichiers : `capacitor.config.ts` (adresse du jeu, identifiant `fr.stealamasterpiece.app`), `mobile/www/` (page de repli),
`android/` (projet Android Studio), `android/app/src/main/java/fr/stealamasterpiece/app/MainActivity.java` (plein écran).

## Construire l'application Android

Prérequis : Android Studio (avec le SDK Android), et le jeu déjà en ligne sur Render.

1. Indiquez l'adresse du jeu, puis copiez la configuration dans le projet Android :
   ```powershell
   $env:SAM_GAME_URL="https://jouer.mondomaine.fr"; npm run android:sync
   ```
2. Ouvrez le projet : `npm run android:open` (Android Studio s'ouvre sur `android/`).
3. Essai : branchez un téléphone (mode développeur, débogage USB) et cliquez sur ▶ *Run*.
4. Version à publier : *Build → Generate Signed App Bundle / APK*, choisissez *Android App Bundle*, créez votre clé de signature
   (gardez-la précieusement : sans elle, impossible de publier une mise à jour), puis envoyez le fichier `.aab` sur la Google Play Console.

Refaites l'étape 1 chaque fois que l'adresse du jeu change. Pour changer l'icône ou l'écran de démarrage : modifiez
`public/icons/icon.svg` ou `public/logo.svg`, puis `npm run android:assets`.

## À savoir

- **Connexion Google** : Google refuse la connexion dans une vue web intégrée ; le bouton est donc masqué dans l'application.
  Les joueurs se connectent avec leur e-mail et leur mot de passe. Un compte créé avec Google sur le site peut ajouter
  un e-mail et un mot de passe dans « Compte », puis se connecter avec eux dans l'application.
- **iPhone** : il faut un Mac avec Xcode. `npm install --save-dev @capacitor/ios@6.2.0`, `npx cap add ios`, puis `npx cap open ios`.
  Apple refuse parfois les applications qui ne font qu'afficher un site web (règle 4.2) ; la version web installable
  (écran d'accueil de Safari) reste une alternative sans magasin.
- **Domaine** : le serveur autorise le micro pour son propre domaine (`Permissions-Policy: microphone=(self)`), ce qui couvre l'application.

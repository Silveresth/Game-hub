# Application mobile (Capacitor)

L'application Android est une coque native, plein écran, qui ouvre le jeu en ligne (le service Render).
Le jeu se met à jour sans republier l'application : seule la coque (icône, plein écran, permissions) est dans le magasin.

Ce que fait la coque :
- plein écran immersif : barres d'état et de navigation masquées (un balayage depuis le bord les fait réapparaître un instant) ;
- **écran à l'horizontale** (paysage, dans les deux sens) : joystick à gauche, actions à droite ;
- l'écran reste allumé pendant la partie, et l'affichage va jusque sous l'encoche de la caméra ;
- permission du micro pour la discussion vocale (demandée seulement quand le joueur touche 🎙) ;
- une page « Le musée est injoignable » si le serveur ne répond pas ;
- icône et écran de démarrage tirés du logo (`npm run android:assets` les régénère) ;
- les pages de paiement (FedaPay, CinetPay, PayPal) s'ouvrent dans le navigateur du téléphone ; au retour dans
  l'application, les STH coins sont crédités tout seuls.

Fichiers : `capacitor.config.ts` (adresse du jeu, identifiant `fr.stealamasterpiece.app`), `mobile/www/` (page de repli),
`android/` (projet Android Studio), `android/app/src/main/java/fr/stealamasterpiece/app/MainActivity.java` (plein écran),
`android/app/src/main/AndroidManifest.xml` (orientation paysage), `tools/build-apk.mjs` (construction).

## Construire l'APK en une commande

Prérequis (déjà présents sur ce poste) : JDK 17 (`JAVA_HOME`), SDK Android (`ANDROID_HOME`). Le jeu doit être en ligne.

```powershell
$env:SAM_GAME_URL="https://jouer.mondomaine.fr"; npm run android:apk
```

Sans `SAM_GAME_URL`, l'application ouvre `https://steal-a-masterpiece.onrender.com` (l'adresse que Render donne au
service de `render.yaml`). **Refaites la commande si l'adresse de votre jeu est différente.**

Résultat dans `dist-apk/` :
- `steal-a-masterpiece-<version>-test.apk` : version de test, à copier sur un téléphone Android et à installer
  (autoriser « sources inconnues »). Elle est signée avec la clé de débogage de cet ordinateur : les mises à jour
  suivantes construites ici s'installent par-dessus.
- avec une clé de publication (ci-dessous) : `steal-a-masterpiece-<version>.apk` et `.aab` (Google Play).

## Version à publier (clé de signature)

1. Créez votre clé **une seule fois** et gardez-la précieusement (sans elle, impossible de publier une mise à jour) :
   ```powershell
   keytool -genkeypair -v -keystore android/sam-release.jks -alias sam -keyalg RSA -keysize 2048 -validity 10000
   ```
2. Créez `android/keystore.properties` (ignoré par git) :
   ```
   storeFile=sam-release.jks
   storePassword=VOTRE_MOT_DE_PASSE
   keyAlias=sam
   keyPassword=VOTRE_MOT_DE_PASSE
   ```
3. `npm run android:apk` construit alors aussi l'APK et l'AAB signés. Envoyez le `.aab` sur la Google Play Console.

Avant chaque nouvelle publication, augmentez `versionCode` (et `versionName`) dans `android/app/build.gradle`.

## Ouvrir le projet dans Android Studio

`npm run android:sync` (après avoir changé `SAM_GAME_URL`), puis `npm run android:open`. ▶ *Run* sur un téléphone branché
(mode développeur, débogage USB).

## À savoir

- **Paiements et Google Play** : pour une application publiée sur le Play Store, Google impose son propre système de
  paiement pour les achats numériques (les STH coins). L'APK installé directement n'est pas concerné. Voir
  [PAIEMENTS.md](PAIEMENTS.md).
- **Connexion Google** : Google refuse la connexion dans une vue web intégrée ; le bouton est donc masqué dans l'application.
  Les joueurs se connectent avec leur e-mail et leur mot de passe.
- **iPhone** : il faut un Mac avec Xcode. `npm install --save-dev @capacitor/ios@6.2.0`, `npx cap add ios`, puis `npx cap open ios`.
  Apple refuse parfois les applications qui ne font qu'afficher un site web (règle 4.2) ; la version web installable
  (écran d'accueil de Safari) reste une alternative sans magasin.
- **Domaine** : le serveur autorise le micro pour son propre domaine (`Permissions-Policy: microphone=(self)`), ce qui couvre l'application.

# Mettre Steal a Masterpiece en ligne

Ce guide part d’un serveur vide jusqu’au jeu en ligne en HTTPS, puis à l’APK Android.
Tout se fait depuis Windows ; aucun Mac n’est nécessaire.

## 1. Le serveur

- Un VPS Linux suffit pour commencer (2 Go de RAM, Docker installé). Par exemple : Hetzner, OVH, Scaleway.
- Un nom de domaine dont l’enregistrement DNS `A` pointe vers l’adresse IP du VPS.
- Ports 80 et 443 ouverts.

## 2. Lancer le jeu

```bash
git clone <votre dépôt> steal-a-masterpiece && cd steal-a-masterpiece
cp .env.example .env      # puis remplir DOMAIN, SAM_ADMIN_TOKEN, SAM_VAPID_SUBJECT
docker compose up -d --build
```

Caddy obtient le certificat HTTPS tout seul. Le jeu répond ensuite sur `https://votre-domaine/`.

- **Admin :** `https://votre-domaine/admin/` avec le jeton `SAM_ADMIN_TOKEN`.
- **Données :** joueurs, ventes et clés push sont dans le volume Docker `data`. Sauvegardez-le régulièrement :
  `docker run --rm -v steal-a-masterpiece_data:/d -v $PWD:/b alpine tar czf /b/sauvegarde.tgz -C /d .`
- **Mise à jour :** `git pull && docker compose up -d --build`. Les ventes ou vols en cours sont annulés proprement (l’argent bloqué est rendu).

Ne supprimez jamais `vapid.json` dans le volume : sans lui, tous les abonnements aux notifications sont perdus.

## 2 bis. Variante sans serveur à gérer : Render

Si vous préférez ne pas administrer de VPS, Render (https://render.com) héberge le jeu à partir du `Dockerfile` et du fichier `render.yaml` du projet. Comptez 7 $/mois (palier Starter) : le palier gratuit s'endort après 15 min sans visite et n'a pas de disque persistant, donc il ne convient pas.

1. Mettez le projet sur GitHub (ou GitLab).
2. Sur Render : *New → Blueprint*, choisissez le dépôt. Render lit `render.yaml` et crée le service avec son disque de 1 Go.
3. Pendant la création, Render demande les variables marquées « à remplir » : au minimum `SAM_VAPID_SUBJECT` (par exemple `mailto:votre@adresse`). Les autres peuvent rester vides.
4. Après le premier déploiement (5 à 10 min), le jeu est sur `https://steal-a-masterpiece.onrender.com`. Le jeton admin est généré automatiquement : lisez-le dans *Environment → SAM_ADMIN_TOKEN*.
5. Pour votre propre domaine : *Settings → Custom Domains*, puis l'enregistrement DNS indiqué. Le HTTPS est automatique.

Chaque `git push` redéploie. Les données restent sur le disque. Pour les sauvegarder : *Disks → Snapshots* (Render en fait automatiquement chaque jour).

Ne changez pas `numInstances: 1` : le jeu garde les quartiers et les enchères en mémoire, il ne peut tourner qu'en un seul exemplaire.

## 3. Connexion avec Google (facultatif)

Elle permet de retrouver son musée sur un autre appareil.

1. Sur https://console.cloud.google.com, créez un projet, puis *API et services → Identifiants → Créer un identifiant → ID client OAuth*, type « Application Web ».
2. *Origines JavaScript autorisées* : `https://votre-domaine`.
3. Copiez l’identifiant client dans `SAM_GOOGLE_CLIENT_ID`, puis relancez `docker compose up -d`.

Le bouton apparaît alors à la création du musée (« Déjà un musée ? ») et dans « Renommer » (« Sauvegarder avec Google »).

## 4. APK Android (Play Store)

L’APK est une *Trusted Web Activity* : le site en plein écran dans une appli Android, générée par Bubblewrap. Bubblewrap installe lui-même le JDK et le SDK Android.

```bash
npx @bubblewrap/cli init --manifest https://votre-domaine/manifest.webmanifest
npx @bubblewrap/cli build
```

1. À l’`init`, choisissez un nom de paquet (par exemple `com.votrenom.stealamasterpiece`) et laissez Bubblewrap créer la clé de signature. Gardez-la précieusement, avec son mot de passe.
2. Récupérez l’empreinte SHA-256 de la clé :
   `keytool -list -v -keystore android.keystore` (ligne « SHA256 »).
   Si Google Play signe l’appli (*Play App Signing*), ajoutez aussi l’empreinte affichée dans la Play Console, séparée par une virgule.
3. Dans `.env` : `SAM_ANDROID_PACKAGE=…` et `SAM_ANDROID_SHA256=…`, puis `docker compose up -d`.
   Vérifiez `https://votre-domaine/.well-known/assetlinks.json` : sans ce fichier, l’appli s’ouvre avec une barre d’adresse.
4. Envoyez le fichier `app-release-bundle.aab` dans la Play Console (compte développeur : 25 $ une fois).

## 5. iPhone

Pas d’App Store sans Mac ni service de compilation en ligne. Sur iPhone, le jeu s’installe depuis Safari : *Partager → Sur l’écran d’accueil*.
Les notifications fonctionnent alors (iOS 16.4 et plus).

## 6. À vérifier avant d’annoncer le jeu

- [ ] Adresse de contact dans `public/confidentialite.html` (à la place de « [adresse de contact à compléter] »).
- [ ] `SAM_ADMIN_TOKEN` long et aléatoire.
- [ ] `SAM_VAPID_SUBJECT` avec une vraie adresse.
- [ ] Classification d’âge (questionnaire IARC de la Play Console). Le catalogue contient des nus classiques (Olympia, La Naissance de Vénus, La Grande Odalisque, La Création d’Adam) : répondez-y honnêtement.
- [ ] Un test à plusieurs, en conditions réelles, sur téléphone : un vol, une vente aux enchères, une notification reçue.
- [ ] Une vente admin abuse programmée pour le lancement, annoncée depuis le panneau admin.

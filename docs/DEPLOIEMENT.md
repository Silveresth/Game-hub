# Mise en ligne : Vercel + Render + Neon

```
Vercel   page d'accueil (fichiers statiques)            https://mondomaine.fr
Render   jeu 3D + API + temps réel (WebSocket) + admin   https://jouer.mondomaine.fr
Neon     base PostgreSQL (joueurs, ventes, clés push, visiteurs)
```

Le jeu reste sur Render avec l'API : il utilise une connexion WebSocket permanente (`/ws`) que Vercel ne sait pas relayer. La page d'accueil sur Vercel envoie vers le jeu (bouton « Jouer ») et lit les statistiques publiques du serveur Render (joueurs en ligne, planning des ventes).

Tout l'état durable est dans Neon : le serveur Render n'a besoin d'aucun disque, et un redéploiement ne perd rien.

Faites les étapes dans l'ordre : chaque service a besoin de l'adresse du précédent.

## 0. Avant de commencer

1. Le projet doit être sur GitHub (ou GitLab). Vérifiez que ces fichiers sont bien envoyés (ils étaient nouveaux) :
   `src/landing/main.ts`, `src/game/chat.ts`, `src/game/voice.ts`, `src/game/textures.ts`, `public/logo.svg`, `public/fonts/`,
   `public/models/m_casual.glb`, `public/models/f_casual.glb`, `tools/build-landing.mjs`, `vercel.json`, `render.yaml`.
2. Remplissez l'adresse de contact de `public/confidentialite.html` (paragraphe « Effacer ses données »).
3. Choisissez vos adresses. Exemple dans ce guide : `mondomaine.fr` pour l'accueil, `jouer.mondomaine.fr` pour le jeu. Sans nom de domaine, les adresses fournies par Vercel (`….vercel.app`) et Render (`….onrender.com`) fonctionnent aussi.

## 1. Neon : la base de données

1. Créez un compte sur https://neon.tech, puis **New Project**.
2. Région : **AWS Europe Central (Frankfurt)**, la même que le serveur Render (moins de latence). Version PostgreSQL : 16 ou plus.
3. Dans **Connection Details**, copiez la chaîne de connexion. Elle ressemble à :
   `postgresql://utilisateur:motdepasse@ep-xxxx.eu-central-1.aws.neon.tech/neondb?sslmode=require`
   Gardez bien `?sslmode=require` à la fin. Cette chaîne est un mot de passe : ne la mettez jamais dans le dépôt.
4. Rien d'autre à faire : les tables `players` et `kv` sont créées par le serveur au premier démarrage.

Neon met la base en veille quand personne ne joue : le premier accès qui suit prend une ou deux secondes, c'est normal.

**Reprendre des joueurs existants (facultatif).** Au premier démarrage sur une base vide, le serveur importe automatiquement les fichiers de `server/data` (joueurs, ventes, clés push, visiteurs). Pour importer vos données locales, lancez une fois sur votre ordinateur :

```powershell
$env:DATABASE_URL="postgresql://…?sslmode=require"; npm run server
```

Attention : `server/data` contient aussi les comptes créés par les tests. Pour démarrer la production avec une base propre, ne faites pas cette étape.

## 2. Render : le jeu et l'API

1. Sur https://render.com : **New → Blueprint**, choisissez le dépôt. Render lit `render.yaml` et prépare le service `steal-a-masterpiece` (Docker, région Francfort, une seule instance).
2. Render demande les variables marquées `sync: false`. Remplissez :

   | Variable | Valeur |
   | --- | --- |
   | `DATABASE_URL` | la chaîne de connexion Neon de l'étape 1 |
   | `SAM_VAPID_SUBJECT` | `mailto:votre@adresse` (contact exigé par les services de notifications) |
   | `SAM_CORS_ORIGINS` | à laisser vide pour l'instant (rempli à l'étape 4) |
   | les autres | facultatives : laissez vides |

   `SAM_ADMIN_TOKEN` est généré automatiquement et `SAM_TRUST_PROXY` vaut déjà `1`.
3. Choisissez au minimum l'offre **Starter** : l'offre gratuite s'endort après 15 minutes sans visite, ce qui coupe les quartiers et les enchères en cours.
4. Premier déploiement : 5 à 10 minutes. Dans les journaux, vous devez lire `📦 PostgreSQL connecté`.
5. Vérifiez : `https://steal-a-masterpiece.onrender.com/api/stats` doit afficher des chiffres en JSON, et `…/game/` doit ouvrir le jeu.
6. Votre domaine : **Settings → Custom Domains → Add**, `jouer.mondomaine.fr`, puis créez chez votre registraire l'enregistrement **CNAME** indiqué (vers `steal-a-masterpiece.onrender.com`). Le certificat HTTPS est automatique.
7. Le jeton du panneau d'administration se lit dans **Environment → SAM_ADMIN_TOKEN** ; le panneau est sur `https://jouer.mondomaine.fr/admin/`.

Chaque `git push` sur la branche principale redéploie le jeu.

## 3. Vercel : la page d'accueil

1. Sur https://vercel.com : **Add New → Project**, importez le même dépôt.
2. **Framework Preset** : *Other*. Les commandes et le dossier de sortie viennent de `vercel.json` : ne les changez pas.
3. **Environment Variables** : ajoutez `SAM_GAME_URL` = l'adresse du jeu, sans `/game/` ni barre finale :
   `https://jouer.mondomaine.fr` (ou `https://steal-a-masterpiece.onrender.com`). Cochez *Production* et *Preview*.
4. **Deploy**. La construction échoue volontairement avec un message clair si `SAM_GAME_URL` manque.
5. Votre domaine : **Settings → Domains**, ajoutez `mondomaine.fr` (et `www.mondomaine.fr`), puis les enregistrements DNS indiqués par Vercel.

Si l'adresse du jeu change, modifiez `SAM_GAME_URL` puis **Redeploy** : elle est inscrite dans la page au moment de la construction.

## 4. Relier les deux

La page d'accueil lit les statistiques du jeu depuis un autre domaine : le serveur doit l'y autoriser.

1. Sur Render, **Environment**, `SAM_CORS_ORIGINS` = les adresses de la page d'accueil, séparées par des virgules :
   `https://mondomaine.fr,https://www.mondomaine.fr`
   Ajoutez `*.vercel.app` pour que les aperçus Vercel affichent aussi les chiffres.
2. Enregistrez : Render redémarre le service.

Seules les routes publiques `/api/live` et `/api/stats` sont concernées ; le jeu lui-même est sur son propre domaine et n'en a pas besoin.

## 5. Options

- **Connexion Google** : dans la console Google Cloud, client OAuth « Application Web », origine JavaScript autorisée `https://jouer.mondomaine.fr` ; mettez l'identifiant dans `SAM_GOOGLE_CLIENT_ID` sur Render.
- **Discussion vocale sur des réseaux très fermés** (entreprises, certains opérateurs mobiles) : ajoutez un serveur TURN dans `SAM_ICE_SERVERS`, par exemple
  `[{"urls":"stun:stun.l.google.com:19302"},{"urls":"turn:turn.exemple.fr:3478","username":"…","credential":"…"}]`.
- **Adresse IP des joueurs** (limites anti-abus) : par défaut, la dernière adresse de `X-Forwarded-For`. Si votre hébergeur fournit un en-tête dédié avec l'adresse du client, indiquez son nom dans `SAM_CLIENT_IP_HEADER`.
- **Application Android** : `SAM_ANDROID_PACKAGE` et `SAM_ANDROID_SHA256` (voir `LANCEMENT.md`).

## 6. Vérifications après la mise en ligne

1. `https://mondomaine.fr` : la barre du haut affiche « 1 en ligne » et le planning des ventes se remplit. Si les chiffres restent vides, revoir `SAM_CORS_ORIGINS` (étape 4).
2. Bouton **Jouer gratuitement** : le jeu s'ouvre sur `https://jouer.mondomaine.fr/game/`.
3. Créez un musée, achetez une œuvre, rechargez la page : la partie reprend.
4. Sur Render, **Manual Deploy → Deploy latest commit**, puis revenez dans le jeu : votre musée est toujours là (preuve que les données sont dans Neon).
5. `https://jouer.mondomaine.fr/admin/` avec le jeton : le planning des ventes s'affiche.
6. Dans le jeu, activez les notifications (🛡 Sécurité) : l'appareil apparaît comme abonné.

## À savoir

- **Une seule instance du serveur**, même avec Neon : les quartiers et les enchères en cours vivent en mémoire. Ne changez pas `numInstances`.
- **Sauvegardes** : Neon garde un historique de la base (restauration à un instant passé, durée selon l'offre).
- **Offres** : Vercel *Hobby* est réservé aux projets non commerciaux ; Neon gratuit suffit pour démarrer (quelques centaines de Mo). Vérifiez les tarifs et limites en vigueur sur leurs sites.
- **Sans `DATABASE_URL`**, le serveur écrit dans `server/data` : sur Render sans disque, ces données disparaissent à chaque déploiement (un avertissement s'affiche dans les journaux).

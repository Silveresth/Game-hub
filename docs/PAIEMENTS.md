# Paiements : STH coins et Lucky coffres

## Ce que les joueurs achètent

Les **STH coins** sont la monnaie premium. Ils servent à acheter des **Lucky coffres** (une œuvre d'art par coffre).
On les obtient de deux façons :

1. **En argent réel** (offres ci-dessous) ;
2. **En échangeant des pièces du jeu**, à un taux volontairement très élevé : **1 000 STH = 150 M de pièces**
   (1 STH = 150 000 pièces, 10 STH minimum par échange). C'est une dépense de fin de partie.

| Offre | STH reçus | FCFA | Euro | Dollar |
|---|---|---|---|---|
| p100 | 100 | 500 | 0,99 € | 1,09 $ |
| p550 | 550 (dont 50 offerts) | 2 500 | 4,99 € | 5,49 $ |
| p1200 « Populaire » | 1 200 (dont 200 offerts) | 5 000 | 9,99 € | 10,99 $ |
| p2600 | 2 600 (dont 600 offerts) | 10 000 | 19,99 € | 21,99 $ |
| p7000 « Meilleure offre » | 7 000 (dont 2 000 offerts) | 25 000 | 49,99 € | 54,99 $ |
| p15000 | 15 000 (dont 5 000 offerts) | 50 000 | 99,99 € | 109,99 $ |

Les prix en FCFA sont un peu plus bas que la conversion exacte (1 € = 655,957 FCFA) : prix adaptés au pouvoir d'achat
de la zone FCFA. Tout se règle dans `src/shared/catalog.json` (`premium.packs`, `premium.coinsPerSth`).

| Coffre | Prix | Probabilités | Garantie |
|---|---|---|---|
| Lucky coffre | 60 STH | Commune 60 %, Rare 32 %, Épique 7 %, Légendaire 1 % | une Épique au plus tard au 12e coffre |
| Lucky coffre rare | 180 STH | Rare 70 %, Épique 25 %, Légendaire 5 % | une Légendaire au plus tard au 12e coffre |
| Lucky coffre épique | 450 STH | Épique 82 %, Légendaire 17,5 %, Mythique 0,5 % | une Légendaire au plus tard au 8e coffre |
| Lucky coffre légendaire | 1 200 STH | Légendaire 97 %, Mythique 3 % | — |

Lot de 5 coffres : −10 %. Cadres spéciaux possibles (doré ×2, diamant ×5, arc-en-ciel ×10), plus fréquents dans les
coffres chers. Une **Mythique** n'est possible que si elle est encore libre (unique sur tout le serveur) ; sinon le
tirage donne une Légendaire. Le tirage est fait par le serveur avec un générateur cryptographique, avec exactement
les probabilités affichées.

## Moyens de paiement et prestataires

| Ce que voit le joueur | Prestataire utilisé (le premier configuré) | Monnaie |
|---|---|---|
| 📱 T-Money | PayGate Global → FedaPay → CinetPay | FCFA |
| 📲 Flooz / Moov Money | PayGate Global → FedaPay → CinetPay | FCFA |
| 💳 Carte Visa / Mastercard | FedaPay → CinetPay | FCFA |
| 🅿️ PayPal | PayPal | euro ou dollar |

Un moyen de paiement n'apparaît dans le jeu que si un de ses prestataires a ses clés. **Le plus simple pour commencer :
FedaPay seul** (un compte couvre T-Money, Moov/Flooz et les cartes). Ajoutez PayGate Global ensuite si vous voulez
ses frais plus bas sur le mobile money.

Toutes les variables se mettent dans l'environnement du serveur (Render → *Environment*, ou `.env` avec Docker).
`SAM_PUBLIC_URL` doit être l'adresse publique du jeu (ex. `https://jouer.mondomaine.fr`) : elle sert aux liens de
retour et de notification envoyés aux prestataires.

### FedaPay (T-Money, Moov / Flooz, cartes)

1. Compte sur <https://fedapay.com> (entreprise ou particulier au Togo, au Bénin, en Côte d'Ivoire…), puis activation
   du compte (pièces d'identité).
2. Tableau de bord → *Paramètres* → *Clés API* : copiez la **clé secrète** (`sk_sandbox_…` pour les essais, `sk_live_…`
   ensuite).
3. Variables :
   - `FEDAPAY_SECRET_KEY=sk_live_…`
   - `FEDAPAY_ENV=live` (ou `sandbox` pour les essais ; deviné d'après la clé si absent)
4. Facultatif : *Webhooks* → ajoutez `https://jouer.mondomaine.fr/api/pay/notify/fedapay`. Le paiement est crédité plus
   vite ; sans webhook, le serveur vérifie les paiements en attente toutes les 30 s.

Le joueur est envoyé sur la page de paiement FedaPay (il y choisit T-Money, Moov ou sa carte), puis revient dans le jeu.

### PayGate Global (T-Money et Flooz, Togo)

1. Compte sur <https://paygateglobal.com> → inscription, puis activation. Frais annoncés : 2,5 % (Flooz), 3 % (T-Money).
2. Tableau de bord : copiez votre **clé API** (`auth_token`) et déclarez l'adresse de rappel
   `https://jouer.mondomaine.fr/api/pay/notify/paygate`.
3. Variable : `PAYGATE_AUTH_TOKEN=…`

Paiement direct : le joueur tape son numéro (8 chiffres) dans le jeu, reçoit la demande sur son téléphone et la valide
avec son code secret. Le jeu suit le paiement tout seul.

⚠️ Les adresses de l'API PayGate utilisées (`/api/v1/pay`, `/api/v2/status`, `/api/v1/status`) et leurs codes
(0 = réussi, 2 = en cours, 4 = expiré, 6 = annulé) viennent de leur guide d'intégration, qui n'est lisible qu'une fois
connecté : vérifiez-les dans le vôtre avant la mise en ligne (`server/payments.mjs`, objet `paygate`).

### CinetPay (mobile money et cartes)

1. Compte marchand sur <https://cinetpay.com>, puis *Intégrations* : **API key** et **Site ID**.
2. Variables : `CINETPAY_API_KEY=…`, `CINETPAY_SITE_ID=…`
3. L'adresse de notification (`/api/pay/notify/cinetpay`) est envoyée automatiquement à chaque paiement.

### PayPal

1. Compte PayPal **Business**, puis <https://developer.paypal.com> → *Apps & Credentials* → créez une application :
   **Client ID** et **Secret** (onglet *Sandbox* pour les essais, *Live* ensuite).
2. Variables : `PAYPAL_CLIENT_ID=…`, `PAYPAL_SECRET=…`, `PAYPAL_ENV=live` (ou `sandbox`).

⚠️ PayPal limite la réception de paiements dans plusieurs pays d'Afrique de l'Ouest. Vérifiez qu'un compte Business
togolais peut **recevoir** de l'argent avant d'en dépendre ; sinon, laissez ces variables vides : le bouton PayPal
n'apparaîtra pas, et les cartes passent par FedaPay ou CinetPay.

## Sécurité (ce que fait le serveur)

- Le prix vient de l'offre du catalogue, jamais du navigateur.
- Une commande n'est créditée qu'après **vérification serveur à serveur** auprès du prestataire (statut, montant,
  monnaie). Les notifications et le retour de la page de paiement ne font que déclencher cette vérification : leur
  contenu n'est jamais cru, il n'y a donc pas de signature à configurer.
- Chaque commande n'est créditée **qu'une fois** (historique `purchases` du joueur).
- Les commandes sont gardées dans la base (`kv` → `orders`) ; une commande non payée expire au bout de 48 h.
- Le panneau `/admin/` affiche les dernières commandes et le total encaissé par monnaie.

## Essayer sans argent

En mode test (`SAM_DEV=1`) sans aucune clé, un faux prestataire « test » remplace tous les moyens de paiement :
le jeu propose « Simuler le paiement réussi ». `npm run test:shop` vérifie tout (échange, coffres, garantie, inventaire,
commandes, crédit unique).

## À savoir avant d'ouvrir les paiements

- Affichez des conditions de vente (monnaie virtuelle, non remboursable) et une adresse de contact pour les réclamations.
- Les coffres payants sont considérés comme des **jeux de hasard en Belgique** (et encadrés aux Pays-Bas) : ne les
  vendez pas aux joueurs de ces pays sans avis juridique.
- Google Play impose son propre système de paiement pour les achats dans une application publiée sur le Play Store.
  L'APK installé directement (hors Play Store) n'est pas concerné ; pour le Play Store, prévoyez Google Play Billing
  ou des achats faits seulement sur le site web.

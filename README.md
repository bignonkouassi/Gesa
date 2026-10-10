# Ma Boutique : Gestion de stock multi-boutiques

Application web **100 % en français**, simple et **mobile d’abord**, pour aider un commerçant à suivre
ses stocks, ses ventes, ses bénéfices réels, ses réapprovisionnements et les crédits de ses clients :
par semaine, par mois et par année, pour une ou plusieurs boutiques (ex. « Boutique Eau »,
« Boutique Cuisine »).

## Structure des pages

| Page (onglet) | Contenu |
|---|---|
| **Tableau de bord** | Alertes (crédits en retard, stock bas/rupture), bénéfices du jour / semaine / mois / total, CA vs bénéfice vs dépenses de réappro, graphique à bascule **Semaine / Mois / Année** (+ sélecteur d’année et **bilan annuel** complet quand « Année » est choisi), bénéfice encaissé vs en attente, Top 5, valeur du stock, bouton **Télécharger la fiche** |
| **Ventes** | Saisie des ventes du jour par article (comptant / crédit), prix de vente éditable en ligne, réapprovisionnement, recherche, « Annuler la dernière vente » |
| **Crédits** | Cartes (en cours, remboursé ce mois, débiteurs, en retard), filtres, fiche client, remboursements, relance WhatsApp |
| **Historique** | 5 onglets : **Ventes**, **Réappro.**, **Crédits et remboursements**, **Mouvements de stock**, **Périodes** (liste des semaines et des mois avec CA, bénéfice, dépenses, ventes, détail au clic) + filtres (période, article, client, recherche) et tri (date, montant, bénéfice) + fiche de chaque période |
| **Boutiques** | Créer / renommer / supprimer, historique des réappro à corriger, exports, données et compte |

Navigation : **barre latérale sur ordinateur**, **5 onglets en bas sur mobile**, onglets de boutique
en haut (+ « Toutes les boutiques » qui additionne tout). Couleur principale **vert émeraude**,
**mode sombre automatique** (selon le réglage du système).

## Schéma de données

8 tables (voir [`supabase/schema.sql`](supabase/schema.sql)) : `shops`, `items`, `restocks`,
`customers`, `sales`, `credits`, `credit_payments`, `stock_movements` : plus, côté application,
`items.opening_stock` / `items.opening_cost` (stock et coût initiaux, indispensables pour
recalculer exactement après la correction d’un réappro) et `stock_movements.ref_id`.

Points clés :
- le prix de vente **et** le prix d’achat sont copiés dans chaque vente : modifier un prix plus tard
  ne change jamais l’historique ni les bénéfices passés ;
- bénéfice d’une vente = `(prix de vente − prix d’achat) × quantité`, figé au moment de la vente ;
- coût moyen pondéré recalculé à chaque réappro (remis au prix du lot si le stock est à 0) ;
- périodes calculées sur `sale_date`, `restock_date` et `payment_date`, semaines débutant le lundi.

2 tables de gouvernance en plus : `shop_members` (rôles par boutique : propriétaire, gérant,
vendeur) et `audit_log` (journal d’audit non modifiable).

Le script SQL fournit aussi **les vues et fonctions de calcul** :
- `v_sales` : chiffre d’affaires et bénéfice de chaque vente (masqués pour un vendeur) ;
- `v_credits` : reste à payer et statut recalculé (`en cours`, `partiellement payé`, `soldé`, `en retard`) ;
- `get_items()` / `get_sales()` / `get_restocks()` : lecture qui renvoie les prix d’achat `null`
  pour un vendeur (les colonnes de coût ne sont jamais accordées en clair) ;
- `compute_avg_cost(item_id)` : rejoue les réappro + ventes pour refaire le coût moyen ;
- `period_summary(date_from, date_to)` : CA, bénéfice, dépenses de réappro, nombre de ventes ;
- `check_stock_consistency()` : compare chaque stock au rejeu complet des événements
  (résultat vide = tout est cohérent).

**Opérations transactionnelles (RPC)** : une seule requête SQL par opération, avec verrouillage
de la ligne (`select … for update`) : `record_sale`, `record_restock`, `update_restock`,
`delete_restock`, `record_credit_payment`, `cancel_sale`. Le serveur revérifie stock, rôles et
montants dans la même transaction : pas de survente possible, pas de mise à jour en plusieurs
requêtes séparées.

Toutes les tables sont protégées par **Row Level Security** : lecture réservée aux membres de la
boutique, écriture selon le rôle (vendeur = ventes ; gérant+ = stock, crédits, clients), et
**aucune politique `DELETE` sur `sales`, `credits`, `credit_payments`, `items` ni `customers`**
: rien n’est définitivement supprimé. Des contraintes CHECK en base refusent en outre stock
négatif, quantités ≤ 0 et montants incohérents, même si le navigateur est compromis.

## Démarrer

```bash
npm install
npm run dev        # http://127.0.0.1:5173
npm run build      # build de production dans dist/
npm run typecheck  # vérification TypeScript
npm test           # tests unitaires (vitest) : calculs, périodes, crédits
npm run lint       # ESLint
npm run format     # mise en forme Prettier
```

Au premier lancement, l’app crée un jeu de données de démonstration :
**2 boutiques × 4 articles** (prix d’achat et prix de vente), **12 mois de ventes**, **~20
réapprovisionnements** à des dates différentes, **3 clients**, et **plusieurs crédits** (un soldé,
un partiellement payé, un en retard) + une rupture et un stock bas pour que tous les graphiques,
l’historique et le bilan annuel soient visibles dès le départ. Tout est modifiable (bouton
« Réinitialiser les données de démo »).

## Fonctionnalités

- **Boutiques** : créer / renommer / supprimer (confirmation), onglets en haut + « Toutes les boutiques ».
- **Articles** : stock, prix d’achat moyen, prix de vente, marge unitaire et %, alerte de vente à
  perte, prix de vente éditable dans la ligne, retrait avec confirmation (historique conservé),
  badges *normal / stock bas / Rupture*, recherche par nom.
- **Ventes du jour** : champ « Ventes du jour », **Comptant / Crédit**, **Valider**, date du jour
  par défaut (modifiable pour un jour passé), stock jamais négatif (message clair),
  **« Annuler la dernière vente »** (annulation douce : la vente reste en base, le stock revient,
  un crédit déjà remboursé bloque l’annulation).
- **Crédit** : client existant ou création rapide (nom + téléphone), acompte, échéance optionnelle.
- **Réapprovisionnement** : par article, à tout moment ; coût moyen pondéré ; alerte si le prix
  d’achat augmente ≥ 10 % ; correction/suppression ⇒ recalcul du stock et du coût moyen ;
  **dépenses de réappro** affichées à côté du CA et du bénéfice.
- **Bénéfices** : cartes jour / semaine / mois / total, CA vs bénéfice, comparaison à la période
  précédente, Top 5 (quantité / bénéfice / marge), bénéfice **encaissé vs en attente**, valeur du
  stock au prix d’achat et au prix de vente.
- **Crédits clients** : cartes, filtres, statuts colorés, fiche client (historique + total dû +
  PDF), remboursement plafonné au reste à payer, passage automatique **en retard**, relance
  **WhatsApp** avec message prérempli, alerte sur le tableau de bord.
- **Historique** : ventes, réapprovisionnements, crédits et remboursements, mouvements de stock
  (stock avant / après), filtres et tri, puis l’historique **par semaine et par mois** avec détail.
- **Fiches téléchargeables** (tableau de bord, bilan annuel, chaque période de l’historique) :
  **PDF** (résumé, graphique, tableau par article, top 5, stock bas, crédits, valeur du stock),
  **Excel (.xlsx)** et **CSV**, nommés par exemple `Boutique-Eau_Semaine-41-2026.pdf` ou
  `Boutique-Cuisine_Octobre-2026.xlsx`. Si une période n’a aucune vente, la fiche l’indique.
- **Bilan annuel** (onglet « Année ») : graphique des 12 mois, CA/bénéfice/dépenses/ventes annuels,
  meilleur et mois le plus faible, tableau des 12 mois avec évolution, Top 10, crédits
  (accordés / remboursés / impayés), comparaison **« 2026 vs 2025 »**, téléchargement du bilan.

## Synchronisation Supabase (optionnel)

Sans configuration, l’app fonctionne **hors ligne** (données dans le navigateur) avec le jeu de
démonstration. Pour la synchronisation multi-appareils :

1. Crée un projet sur [supabase.com](https://supabase.com) (l’offre gratuite suffit).
2. Exécute `supabase/schema.sql` dans **SQL Editor** (tables, index, RLS, vues et fonctions).
3. Copie `.env.example` en `.env` et remplis `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY`
   (Dashboard → Project Settings → API).
4. Relance `npm run dev` : l’écran de connexion e-mail/mot de passe apparaît ; crée ton compte et
   ajoute tes boutiques. Chaque utilisateur ne voit que ses données.

## Déploiement

```bash
npm run build      # génère dist/ (HTML, CSS, JS statiques)
```

`dist/` est un site 100 % statique : héberge-le sur n’importe quel hébergeur statique
(Netlify, Vercel, Cloudflare Pages, GitHub Pages, un simple serveur Nginx…) en publiant le contenu
du dossier et en définissant `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` au moment du build
si tu utilises Supabase. Aucun serveur applicatif n’est nécessaire : l’authentification et les
données passent par l’API Supabase avec les politiques RLS.

## Application mobile (PWA)

Le manifest (`public/manifest.webmanifest`) et le service worker (`public/sw.js`) rendent l’app
**installable** sur téléphone (« Ajouter à l’écran d’accueil ») et utilisable **entièrement hors
ligne** une fois ouverte : le shell est mis en cache, les données vivent dans le navigateur.
Les icônes PNG sont générées par `node scripts/generate-icons.mjs` (aucune dépendance).

## Structure du projet

```
src/
├── lib/
│   ├── types.ts       # modèle de données (tables)
│   ├── format.ts      # FCFA "12 500 F", dates fr, slugs
│   ├── calc.ts        # périodes, bénéfices, coût moyen, crédits, graphiques, bilan annuel
│   ├── fiche.ts       # génération des fiches PDF / Excel / CSV
│   ├── exports.ts      # exports complémentaires (toutes ventes, fiche stock, fiche client)
│   ├── repo.ts        # couche de données : localStorage OU Supabase (+ auth)
│   └── seed.ts        # données de démonstration (12 mois)
├── state/store.tsx    # état global + actions métier (ventes, réappro, crédits…)
├── components/        # Shell (barre latérale + onglets), bouton de fiche, primitives d’interface
├── pages/             #  Dashboard, Ventes, Crédits, Historique, Boutiques, Auth
└── App.tsx            # navigation entre les pages
scripts/
└── generate-icons.mjs # icônes PWA générées sans dépendance
supabase/schema.sql    # tables + RLS + contraintes + vues/fonctions + RPC transactionnelles
```

Lint et mise en forme : `eslint.config.js` (ESLint 9 + TypeScript + react-hooks) et
`.prettierrc`. Tests : `src/lib/calc.test.ts` (vitest).

## Règles de gestion

- Le stock ne peut jamais être négatif ; une vente à crédit exige un client.
- Une vente n’est jamais supprimée : elle s’annule en douceur (colonne `cancelled_at`),
  l’historique reste complet et les ventes annulées sortent des calculs et des écrans.
- Supprimer un article, un client ou une boutique n’efface jamais l’historique des ventes.
- Les historiques ne sont jamais effacés ; les fiches reflètent exactement les chiffres affichés.
- Les semaines commencent le lundi.

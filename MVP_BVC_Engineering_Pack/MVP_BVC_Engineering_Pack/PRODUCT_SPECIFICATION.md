# Cahier des charges — MVP de suivi et d’analyse de portefeuilles BVC

**Version :** 1.0  
**Date :** 2 août 2026  
**Statut :** spécification de référence prête pour estimation et développement  
**Nom commercial :** à définir

## 1. Vision du produit

Construire une plateforme web marocaine permettant à un investisseur de saisir ses opérations, de mesurer correctement la valeur, le rendement et le risque de son portefeuille investi à la Bourse de Casablanca, puis de comparer ses résultats au marché.

Le positionnement recherché n’est ni celui d’un courtier ni celui d’un fournisseur de recommandations personnalisées. Le produit est un outil indépendant d’information, de comptabilité de portefeuille, d’analyse et d’éducation financière, conçu pour le contexte marocain.

### Proposition de valeur

> Mesurer précisément la performance et le risque d’un portefeuille BVC, avec des calculs transparents, une donnée locale vérifiée et une expérience compréhensible.

### Inspirations fonctionnelles

- Sharesight : comptabilité des opérations et dividendes.
- Stock Rover : performance, risque et concentration.
- Simply Wall St : lisibilité visuelle des analyses.
- BourseFlow : couverture locale de la BVC.
- getquin : expérience simple et mobile-first.

Ces références servent d’inspiration fonctionnelle. Aucun contenu, code, identité graphique ou élément propriétaire ne doit être copié.

## 2. Objectifs du MVP

Le MVP doit permettre le parcours complet suivant :

> Inscription → création d’un portefeuille → saisie manuelle d’opérations → calcul des positions → valorisation quotidienne → affichage de la performance, des revenus, de l’allocation et du risque → comparaison au MASI Total Return.

### Indicateurs de réussite initiaux

- Un nouvel utilisateur peut obtenir un premier tableau de bord en moins de 10 minutes.
- Toutes les opérations saisies produisent des positions et soldes reproductibles.
- Les calculs TWR, XIRR, plus-values et dividendes passent une suite de tests financiers de référence.
- Le dernier cours valide n’est jamais remplacé silencieusement par une valeur absente ou invalide.
- Toute correction administrative ayant un effet historique est traçable et communiquée aux utilisateurs concernés.
- L’interface est pleinement utilisable sur ordinateur et mobile, en français et en arabe.

## 3. Périmètre de la version 1

### Inclus

- Comptes utilisateurs et authentification.
- Un ou plusieurs portefeuilles par utilisateur.
- Saisie, modification et annulation contrôlée des opérations.
- Achats, ventes, dépôts, retraits, dividendes, frais et impôts.
- Toutes les actions cotées à la Bourse de Casablanca.
- Cours officiels de clôture, collectés automatiquement en fin de séance.
- Historique roulant de cinq ans.
- Positions, coût de revient, liquidités et valeur totale.
- TWR comme rendement principal.
- MWR/XIRR comme rendement personnel complémentaire.
- Gains réalisés et latents.
- Revenus de dividendes nets, avec détail brut et retenue fiscale.
- Comparaison au MASI Total Return.
- Allocation, concentration, volatilité et drawdown.
- Pages synthétiques des sociétés cotées et screener de base.
- Alertes fonctionnelles et notifications liées à la qualité des données.
- Administration des instruments, cours, corrections et litiges.
- Journal d’audit.

### Hors périmètre initial

- Passage d’ordres, courtage ou exécution de transactions.
- Connexion automatique à des comptes de courtage.
- Import CSV de relevés de courtiers.
- Recommandations d’investissement personnalisées.
- Signaux explicites d’achat ou de vente.
- Obligations, OPCVM, ETF, cryptoactifs et titres non cotés.
- Intelligence sur les entreprises privées marocaines.
- Application mobile native.
- Backtesting avancé, optimisation et simulation Monte-Carlo.
- Données intraday ou temps réel.

## 4. Utilisateurs et rôles

### Investisseur

- Gère uniquement ses propres portefeuilles et opérations.
- Consulte ses calculs, alertes, notifications et dossiers de support.
- Ne peut jamais voir les données privées d’un autre utilisateur.

### Administrateur des données

- Supervise les collectes quotidiennes.
- Valide les anomalies, corrections et nouveaux instruments.
- Approuve les recalculs historiques.
- Accède aux traces nécessaires sans pouvoir modifier silencieusement l’historique.

### Administrateur support

- Traite les dossiers signalés par les utilisateurs.
- Peut demander des informations et publier une réponse motivée.
- Ne peut pas approuver seul une correction de marché sensible sauf s’il possède également le rôle « données ».

## 5. Règles de comptabilité du portefeuille

### 5.1 Types d’opérations

| Type | Effet sur titres | Effet sur trésorerie | Flux externe pour TWR |
|---|---:|---:|---:|
| Dépôt | Aucun | Augmentation | Oui |
| Retrait | Aucun | Diminution | Oui |
| Achat | Augmentation | Diminution du prix + frais + taxes | Non |
| Vente | Diminution | Augmentation du produit net | Non |
| Dividende | Aucun | Augmentation du montant net | Non |
| Frais indépendants | Aucun | Diminution | Non, sauf frais externes explicitement classés |
| Impôt indépendant | Aucun | Diminution | Non |

Chaque opération conserve la date de transaction, la date de règlement si différente, la quantité, le prix unitaire, les frais, les taxes, la devise, la source et une note facultative.

### 5.2 Dividendes

- Le dividende est un revenu, jamais un achat automatique.
- Le tableau de bord met en avant le montant net effectivement reçu après retenue fiscale.
- Le détail conserve le montant brut, l’impôt retenu, le net, la date de paiement et la société distributrice.
- Le montant net augmente la trésorerie du portefeuille.
- Un réinvestissement est enregistré comme une opération d’achat réelle et distincte.
- Les dividendes participent au rendement total mais ne sont jamais comptés deux fois.

### 5.3 Trésorerie

Décision MVP retenue : la trésorerie fait partie de la valeur totale, de l’allocation et de l’analyse du risque.

- Rendement de la trésorerie par défaut : 0 %, jusqu’à l’ajout futur d’un compte rémunéré explicite.
- La trésorerie réduit mécaniquement l’exposition actions et la volatilité du portefeuille.
- Un solde négatif est interdit dans le MVP, sauf tolérance temporaire provoquée par une correction administrative et signalée comme anomalie.

### 5.4 Coût de revient et cessions

- Méthode MVP : coût moyen pondéré par titre et par portefeuille.
- Les frais et taxes d’achat augmentent le coût de revient.
- Les frais et taxes de vente diminuent le produit net.
- Les gains réalisés reposent sur le produit net moins le coût moyen des unités cédées.
- Les gains latents reposent sur le dernier cours valide moins le coût moyen des unités détenues.
- Les opérations ne sont pas supprimées : une annulation crée une contre-écriture ou une version auditée.

## 6. Mesure de la performance

### 6.1 TWR — indicateur principal

Le Time-Weighted Return neutralise l’effet des dépôts et retraits afin de mesurer la performance des actifs et des décisions d’investissement.

Pour chaque sous-période journalière, lorsque le flux externe net est comptabilisé avant la valorisation de clôture :

\[
r_i = \frac{V_i}{V_{i-1}+F_i} - 1
\]

Puis :

\[
TWR = \prod_{i=1}^{n}(1+r_i)-1
\]

La convention intrajournalière doit être fixée dans le moteur et testée. Pour le MVP : un dépôt ou retrait est comptabilisé à sa date de règlement avant la valorisation de clôture du jour. S’il est enregistré après l’heure de coupure, il entre dans la période de valorisation suivante. Un dénominateur nul ou négatif entraîne une rupture exceptionnelle de segment plutôt qu’un rendement trompeur.

### 6.2 MWR/XIRR — indicateur secondaire

Le XIRR mesure le rendement personnel tenant compte du montant et de la date des flux. Il est calculé sur les dépôts, retraits et la valeur finale. Les opérations internes et les dividendes conservés en trésorerie ne sont pas des flux externes.

Le système doit afficher « non calculable » avec une explication lorsque les flux ne permettent pas une solution mathématique fiable.

### 6.3 Décomposition du résultat

- Variation de prix réalisée.
- Variation de prix latente.
- Revenus de dividendes nets.
- Frais et taxes.
- Rendement total.
- Apports et retraits, présentés séparément de la performance.

### 6.4 Périodes

- 1 mois, 3 mois, depuis le début de l’année, 1 an, 3 ans, 5 ans et période disponible.
- Le même filtre s’applique à la valeur, à la performance et aux dividendes.
- Chaque graphique indique la période réellement calculable et la fraîcheur des données.

## 7. Benchmark MASI Total Return

- Comparer le portefeuille au MASI Total Return, dividendes théoriquement réinvestis.
- Aligner le benchmark sur la même date de départ et les mêmes jours de valorisation que le portefeuille.
- Normaliser portefeuille et indice à 100 au début de la période affichée.
- Ne pas présenter le MASI Price Index comme équivalent au rendement total.
- Si le MASI Total Return n’est pas licencié ou disponible, masquer la comparaison plutôt que fabriquer un substitut non documenté.

## 8. Historique de cinq ans et positions antérieures

- Le lancement prend en charge un historique quotidien roulant de cinq ans.
- Une position acquise avant cette limite est importée comme position d’ouverture à la frontière des cinq ans.
- Sa quantité correspond aux actions encore détenues à cette date.
- Son prix initial analytique est le cours officiel de clôture à la date frontière.
- Si aucun cours n’existe ce jour-là, utiliser le premier cours officiel disponible après la frontière.
- Le rendement du titre et son benchmark commencent à la date réelle de ce premier cours.
- L’interface affiche « Performance calculée depuis [date] », et non « depuis l’origine ».
- Le coût d’acquisition historique peut être conservé à titre informatif, sans modifier le rendement sur cinq ans.

### Exception de cotation

- Après cinq jours de bourse consécutifs sans cours postérieur valide, une revue administrative est obligatoire.
- Pendant la revue, utiliser le dernier cours officiel antérieur à la frontière, marqué « Provisoire — revue administrative en cours ».
- Conserver sa date source exacte ; ne jamais le faire passer pour un cours de la date frontière.
- Une fois le premier cours postérieur identifié, l’administrateur vérifie la source, la date et l’instrument, puis approuve explicitement le recalcul.
- Toutes les métriques dépendantes sont recalculées et les anciennes valeurs restent dans l’audit.

## 9. Données de marché BVC

### 9.1 Contraintes approuvées

- Univers : toutes les actions cotées à la BVC.
- Fréquence : fin de journée.
- Profondeur : cinq ans.
- Collecte : automatique.
- Budget mensuel provisoire maximal : 3 000 MAD.
- Priorité : lancement public rapide avec une source techniquement fiable et légalement exploitable.

Le fournisseur doit autoriser explicitement l’accès automatisé, le stockage, le calcul dérivé et l’affichage aux utilisateurs. Une collecte techniquement possible mais non autorisée ne convient pas au lancement commercial.

### 9.2 Architecture indépendante du fournisseur

Le système doit utiliser un adaptateur de données remplaçable. Le fournisseur ne doit jamais être couplé directement au moteur de portefeuille.

Pipeline quotidien :

1. Collecte dans une zone brute immuable.
2. Normalisation des identifiants, dates, devises et valeurs.
3. Contrôles automatiques.
4. Mise en quarantaine des anomalies.
5. Validation du lot.
6. Publication de la nouvelle version de cours.
7. Recalcul des portefeuilles concernés.
8. Production d’un rapport de collecte et notification des échecs.

### 9.3 Contrôles minimums

- Couverture attendue des tickers actifs.
- Doublons instrument/date.
- Prix nul, négatif ou non numérique.
- Dates futures et données obsolètes.
- Variations anormales, contrôlées contre les opérations sur titres.
- Cohérence cours précédent, clôture et statut de cotation.
- Absence d’écrasement du dernier cours valide par une valeur manquante.
- Empreinte du fichier ou lot source et horodatage de collecte.

### 9.4 Instruments particuliers

- Nouvelle cotation : activation après validation des identifiants et du premier cours.
- Suspension : conservation dans les portefeuilles au dernier cours valide, avec badge de cours ancien/suspendu.
- Radiation : conservation de l’historique ; interdiction de nouvelles opérations d’achat après la date effective.
- Opérations sur titres : architecture préparée dès le MVP pour splits, regroupements, droits et changements de ticker, même si leur automatisation complète arrive après la première version.

## 10. Tableau de bord investisseur

### En-tête

- Valeur totale actuelle.
- Variation de valeur sur la période.
- TWR principal.
- XIRR secondaire.
- Revenus de dividendes nets.
- Date et état de fraîcheur des cours.

### Visualisations

- Évolution de la valeur du portefeuille.
- Performance normalisée face au MASI Total Return.
- Répartition par titre et secteur.
- Contribution de chaque titre au gain ou à la perte.
- Revenus de dividendes dans le temps.
- Drawdown historique.

### Positions

Pour chaque titre : quantité, cours, date du cours, valeur, poids, coût moyen, gain latent, gain réalisé, dividendes nets, contribution et état de cotation.

Les chiffres provisoires, données anciennes et métriques non calculables doivent être visibles et expliqués ; aucun avertissement important ne doit reposer uniquement sur une couleur.

## 11. Analyse du risque MVP

### Mesures

- Concentration du premier titre et des cinq premiers titres.
- Allocation sectorielle.
- Volatilité annualisée sur rendements quotidiens lorsque l’historique suffit.
- Drawdown maximal.
- Corrélation entre positions lorsque les observations sont suffisantes.
- Part de trésorerie.
- Indicateur de liquidité fondé sur les données disponibles et clairement documenté.

### Garde-fous méthodologiques

- Minimum recommandé : 60 observations valides pour volatilité et corrélation.
- Les jours sans transaction ne doivent pas être automatiquement assimilés à un rendement nul sans règle documentée.
- Toute métrique insuffisamment alimentée affiche « données insuffisantes ».
- Un éventuel score global doit afficher ses composantes et ne jamais être présenté comme un conseil personnalisé.

## 12. Sociétés cotées et screener

### Fiche société MVP

- Identité, ticker, secteur et statut de cotation.
- Dernier cours, date et évolution historique.
- Capitalisation si la donnée est disponible et licenciée.
- Dividendes historiques disponibles.
- Principaux ratios fondamentaux dont les sources et dates sont connues.
- Documents et liens vers les publications officielles lorsque disponibles.
- Mention claire de la source et de la date de mise à jour.

### Screener initial

- Recherche par nom ou ticker.
- Filtres par secteur, capitalisation, rendement du dividende, performance et disponibilité des données.
- Tri et comparaison simple.
- Aucun classement présenté comme recommandation d’achat.

## 13. Notifications, corrections et contestations

### Recalcul administratif

Après correction approuvée, l’utilisateur reçoit au prochain accès une notification affichant :

- la période et le titre concernés ;
- la raison et la date d’approbation ;
- la date de la donnée source ;
- chaque métrique modifiée avec ancienne et nouvelle valeur ;
- un lien vers l’audit permanent.

La notification reste mise en évidence jusqu’à ce que l’utilisateur ouvre le détail puis clique sur « Prendre connaissance ».

Ce clic confirme uniquement que le détail a été affiché. Il ne prouve ni compréhension ni acceptation et ne vaut pas renonciation à contester.

### Signaler un problème

- Disponible dans le détail et l’historique des notifications, avant ou après prise de connaissance.
- Création automatique d’un dossier numéroté et traçable.
- Liaison au portefeuille, recalcul, titre et audit concernés.
- Catégorie, description et pièces jointes facultatives.
- Statuts : Soumis → En cours d’examen → Informations requises → Résolu → Clos.
- Notifications tableau de bord et courriel pour les changements importants.
- Objectif opérationnel : prise en charge sous deux jours ouvrés et résolution sous cinq jours ouvrés, sans garantie contractuelle dans le MVP.
- La correction reste active mais porte la mention « Contestée par l’utilisateur ».
- Une résolution favorable déclenche un nouveau recalcul ; un rejet doit être motivé.
- Réouverture possible sous 30 jours avec un nouvel élément.

## 14. Modèle de données conceptuel

| Entité | Finalité essentielle |
|---|---|
| User | Identité, préférences linguistiques et sécurité |
| Portfolio | Propriétaire, nom, devise de référence, état |
| Transaction | Opération financière versionnée |
| Security | Instrument BVC et cycle de vie |
| SecurityIdentifier | Ticker et identifiants historiques |
| MarketPrice | Cours, date, source, version et statut |
| CorporateAction | Dividende, split, changement d’identifiant, radiation |
| CashLedgerEntry | Mouvements de trésorerie dérivés ou explicites |
| PositionSnapshot | Quantité, coût, valeur et métriques à une date |
| PortfolioSnapshot | Valeur, flux, TWR et risque à une date |
| BenchmarkPoint | Niveau du MASI Total Return et source |
| IngestionRun | Lot de collecte, contrôles et résultat |
| DataAnomaly | Anomalie détectée et résolution |
| Recalculation | Portée, anciennes/nouvelles valeurs et approbation |
| Notification | Message utilisateur et état de lecture |
| Acknowledgment | Preuve d’affichage d’un avis |
| SupportCase | Contestation, statut, échanges et pièces |
| AuditEvent | Acteur, action, objet, horodatage et justification |

Principes : montants financiers en type décimal, jamais en flottant binaire ; dates de marché distinctes des horodatages techniques ; identifiants immuables ; fuseau métier Africa/Casablanca ; MAD comme devise de référence initiale.

## 15. API et services internes

Séparer au minimum :

- authentification et profils ;
- portefeuilles et transactions ;
- ledger de trésorerie ;
- instruments et cours ;
- moteur de positions ;
- moteur de performance ;
- moteur de risque ;
- ingestion et validation ;
- notifications et support ;
- administration et audit.

Les recalculs lourds doivent être exécutés en tâche de fond, être idempotents et posséder un identifiant d’exécution. Une répétition du même lot ne doit pas créer de doublons.

## 16. Sécurité, confidentialité et conformité

- Autorisation côté serveur sur chaque ressource, fondée sur le propriétaire et le rôle.
- Séparation stricte des données entre utilisateurs.
- Chiffrement en transit et au repos selon les capacités d’hébergement.
- Authentification sécurisée, récupération de compte et protection contre les attaques répétées.
- Journalisation des opérations administratives sensibles.
- Sauvegardes et tests réguliers de restauration.
- Validation des fichiers joints, limites de taille et analyse de type.
- Secrets exclusivement dans un gestionnaire de secrets, jamais dans le dépôt.
- Minimisation des données personnelles et politique de conservation définie.
- Export et suppression de compte avec traitement séparé des traces légalement nécessaires.
- Conditions d’utilisation, politique de confidentialité, politique cookies et avertissement financier avant lancement public.
- Le produit doit indiquer qu’il fournit de l’information et de l’analyse générales, sans garantie de résultat ni conseil personnalisé.

Une revue juridique marocaine spécifique reste requise avant le lancement, notamment sur la protection des données personnelles, les formalités CNDP, les droits de données de marché, la publicité financière et la frontière avec le conseil en investissement.

## 17. Internationalisation et accessibilité

- Langues de lancement : français et arabe ; anglais préparé dans l’architecture, activable ensuite.
- Toutes les chaînes passent par le système de traduction, y compris erreurs, courriels, états vides et contenu administratif.
- Mise en page RTL complète en arabe.
- Montants en MAD et dates localisées.
- Navigation clavier, contrastes suffisants, libellés de formulaires et textes alternatifs.
- Graphiques accompagnés d’un résumé textuel ou tableau accessible.

## 18. Exigences non fonctionnelles

- Tableau de bord principal visé : affichage en moins de 2,5 secondes sur une connexion mobile correcte après mise en cache.
- Disponibilité cible initiale : 99,5 %, hors maintenance annoncée.
- Traitement quotidien relançable sans duplication.
- Calculs déterministes : mêmes entrées et même version de règles donnent les mêmes sorties.
- Observabilité : erreurs, durée des tâches, couverture des cours, anomalies et recalculs.
- Conservation des versions de formules utilisées pour chaque résultat historique.
- Export CSV des opérations et synthèse PDF ultérieurement ; l’export CSV peut être inclus si le calendrier le permet.

## 19. Critères d’acceptation critiques

1. Un achat suivi d’une hausse de cours met correctement à jour quantité, trésorerie, coût moyen, valeur et gain latent.
2. Une vente partielle conserve la bonne quantité et calcule le gain réalisé selon le coût moyen.
3. Un dividende augmente uniquement les revenus et la trésorerie, jamais les unités détenues.
4. Un dépôt ou retrait modifie le XIRR mais ne crée pas artificiellement de rendement TWR.
5. Frais et taxes ne sont comptés qu’une fois.
6. Le benchmark commence exactement à la même date analytique que le portefeuille.
7. Une donnée EOD manquante conserve le dernier cours valide et affiche sa fraîcheur.
8. Une position antérieure à cinq ans suit intégralement les règles de frontière et de revue.
9. Une correction approuvée conserve l’ancien résultat, recalcule les dépendances et notifie les utilisateurs touchés.
10. L’utilisateur ne peut accéder à aucun portefeuille qui ne lui appartient pas.
11. Chaque page et message fonctionne en français et en arabe, y compris en RTL.
12. Les résultats financiers de référence passent avec une précision explicitement définie.

## 20. Stratégie de tests

- Tests unitaires du ledger, coût moyen, TWR, XIRR, dividendes et arrondis.
- Jeux de données « golden » calculés indépendamment dans un tableur.
- Tests de propriétés : conservation des quantités et égalité entre ledger et soldes.
- Tests d’intégration du pipeline de cours et de ses reprises.
- Tests d’autorisation et d’isolement multi-utilisateur.
- Tests de bout en bout du parcours principal et du recalcul contesté.
- Tests de migration de base de données.
- Tests de charge ciblés sur les recalculs quotidiens.
- Revue visuelle responsive, RTL et accessibilité.

## 21. Feuille de route de réalisation

Estimation indicative pour une petite équipe expérimentée ; elle doit être affinée après choix de la stack et du fournisseur de données.

### Lot 0 — Validation préalable (1 semaine, en parallèle)

- Obtenir des offres de données compatibles avec le plafond de 3 000 MAD/mois.
- Vérifier les droits d’usage, stockage, calcul et affichage.
- Identifier la disponibilité du MASI Total Return et des opérations sur titres.
- Finaliser nom, identité visuelle et mentions juridiques provisoires.

**Jalon :** source utilisable identifiée ou jeu de données contractuellement limité au test privé.

### Lot 1 — Fondations et modèle financier (2 semaines)

- Architecture, base, authentification et rôles.
- Modèle des instruments, portefeuilles, opérations et ledger.
- Moteur de positions, coût moyen et trésorerie.
- Jeux de référence et tests unitaires.

**Jalon :** une suite d’opérations produit des soldes exacts et reproductibles.

### Lot 2 — Performance et valorisation (2 semaines)

- Cours historiques de test et adaptateur fournisseur.
- Valorisation quotidienne et snapshots.
- TWR, XIRR, gains, dividendes et filtres temporels.
- MASI Total Return lorsque disponible.

**Jalon :** tableau de bord chiffré validé contre le tableur de référence.

### Lot 3 — Expérience utilisateur (2 semaines)

- Inscription, création de portefeuille et saisie d’opérations.
- Tableau de bord responsive.
- Positions, transactions, graphiques et explications.
- Français, arabe et RTL.

**Jalon :** parcours complet utilisable sans intervention technique.

### Lot 4 — Risque, sociétés et screener (2 semaines)

- Allocation, concentration, volatilité et drawdown.
- Pages sociétés cotées.
- Screener initial et recherche.
- États de données insuffisantes et méthodologie.

**Jalon :** analyse utile sans produire de recommandation personnalisée.

### Lot 5 — Données de production et administration (2 semaines)

- Collecte EOD automatisée, validation et quarantaine.
- Tableau de supervision, corrections et audit.
- Règles des positions historiques et recalculs.
- Notifications, prise de connaissance et dossiers de contestation.

**Jalon :** une collecte défaillante et une correction historique sont gérées de bout en bout.

### Lot 6 — Durcissement et lancement (1 à 2 semaines)

- Audit sécurité et autorisations.
- Tests de charge, restauration et monitoring.
- Vérification juridique et contractuelle de la donnée.
- Bêta fermée, corrections, puis ouverture publique.

**Durée indicative totale :** 11 à 13 semaines, avec achats de données et revue juridique conduits en parallèle. Une seule personne peut nécessiter sensiblement plus de temps.

## 22. Priorités de backlog

### P0 — Indispensable au lancement

- Authentification et isolation des données.
- Portefeuilles, opérations, ledger et positions.
- Cours EOD licenciés et contrôlés.
- Valorisation, TWR, XIRR, dividendes et MASI TR.
- Tableau de bord, positions et historique.
- Administration des données, audit et alertes d’échec.
- Français/arabe, sécurité, sauvegardes et mentions juridiques.

### P1 — Important mais reportable après bêta

- Risque avancé, pages sociétés enrichies et screener complet.
- Contestations avec pièces jointes et délais opérationnels.
- Export CSV et courriels détaillés.

### P2 — Après validation du marché

- Import de relevés CSV.
- Connexions courtiers.
- Application mobile.
- Alertes de prix configurables.
- Backtesting et simulations.
- Données sur les entreprises privées marocaines.

## 23. Décisions encore bloquantes avant codage de production

Elles ne bloquent pas le prototype du moteur, mais doivent être closes avant le déploiement public :

1. Nom commercial et identité visuelle.
2. Fournisseur BVC et contrat de droits d’usage.
3. Accès licencié au MASI Total Return.
4. Stack technique et lieu d’hébergement.
5. Politique tarifaire du produit.
6. Entité juridique exploitante et textes juridiques.
7. Procédure CNDP applicable.

## 24. Définition de « terminé » pour le MVP

Le MVP est prêt au lancement public uniquement lorsque :

- tous les critères P0 sont livrés et testés ;
- les calculs sont rapprochés d’un référentiel indépendant ;
- la donnée de marché et le benchmark peuvent légalement être exploités ;
- les tests d’autorisation ne montrent aucune fuite inter-utilisateurs ;
- sauvegarde et restauration sont démontrées ;
- l’expérience française et arabe est complète ;
- les avertissements, conditions et politiques sont publiés ;
- l’administration peut détecter une collecte défaillante, corriger une donnée et auditer tout recalcul ;
- une bêta fermée n’a révélé aucun défaut critique non résolu.

---

Ce document constitue la référence fonctionnelle du MVP. Toute modification affectant les calculs financiers, les droits de données, la confidentialité ou le périmètre réglementaire doit être versionnée et approuvée avant développement.

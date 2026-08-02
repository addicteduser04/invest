# Plan de livraison exécutable

## Cadence proposée

- Sprints de deux semaines.
- Démonstration et validation à la fin de chaque sprint.
- Les calculs et la sécurité passent avant l’enrichissement visuel.
- Une petite équipe cible : 1 responsable produit, 1 développeur full-stack, 1 développeur backend/data et appui ponctuel UX/QA/juridique.

## Sprint 0 — Risques externes et fondations

**Résultat :** dépôt prêt, décisions critiques suivies et prototype alimenté par données synthétiques.

- Créer le monorepo, CI et environnements.
- Écrire les ADR 001–008.
- Obtenir au moins trois demandes de devis BVC ou documenter l’absence d’offre.
- Définir le jeu synthétique et le tableur golden.
- Installer PostgreSQL/Supabase local et le premier schéma.
- Créer la matrice RLS et le registre de risques.

**Gate :** CI verte, base locale reconstructible et scénario golden signé.

## Sprint 1 — Ledger et positions

**Résultat :** première tranche verticale complète avec achat.

- Authentification, profil et portefeuille.
- Dépôt, achat, validation des soldes.
- Ledger, coût moyen et position.
- Snapshot simple et dashboard minimal.
- RLS entre deux comptes.

**Gate :** invariants comptables et test E2E principal validés.

## Sprint 2 — Cycle complet des opérations

**Résultat :** achats, ventes, frais, taxes, dividendes et annulations.

- Vente partielle et gain réalisé.
- Dividende net en revenu/trésorerie.
- Versions, contre-écritures et audit.
- Détection des soldes négatifs.
- Écrans transactions et positions FR/AR.

**Gate :** aucune double comptabilisation et golden tests complets.

## Sprint 3 — Performance et benchmark

**Résultat :** TWR/XIRR et comparaison avec données synthétiques.

- Valorisation quotidienne.
- TWR et ruptures de segments.
- XIRR et cas non calculables.
- Décomposition et périodes.
- Interface de benchmark, masquée si MASI TR absent.

**Gate :** rapprochement indépendant avec tolérances documentées.

## Sprint 4 — Ingestion EOD

**Résultat :** pipeline fournisseur complet en staging.

- Adaptateur mock puis fournisseur choisi.
- Brut immuable, normalisation, contrôles et quarantaine.
- Publication atomique et conservation du dernier prix valide.
- Cron, file durable, retries, checkpoints et alertes.
- Tableau d’administration des lots.

**Gate :** trois séances consécutives traitées automatiquement sans intervention.

## Sprint 5 — Risque, société et screener

**Résultat :** analyse utile et explicable.

- Concentration, allocation, volatilité et drawdown.
- Cas de données insuffisantes et cours anciens.
- Fiches sociétés et recherche.
- Screener initial sans recommandation.

**Gate :** méthodologie affichée et résultats comparés à une référence.

## Sprint 6 — Corrections, notifications et support

**Résultat :** correction historique de bout en bout.

- Prix provisoires et revue après cinq séances.
- Approbation administrative et recalcul.
- Comparaison avant/après.
- Prise de connaissance et audit.
- Dossier contestable, pièces et statuts.

**Gate :** scénario complet exécuté sans perte de l’ancienne valeur.

## Sprint 7 — Durcissement et bêta

**Résultat :** bêta fermée prête.

- Audit autorisations, dépendances et secrets.
- Charge ciblée des recalculs.
- Sauvegarde/restauration démontrée.
- Accessibilité, responsive, RTL et performance.
- Textes juridiques provisoires et procédure incident.

**Gate :** zéro défaut P0, données sous contrat et feu vert juridique pour la bêta.

## Critères Go/No-Go public

Le lancement public est **No-Go** si un seul des points suivants manque :

- droits écrits sur les cours, historiques et benchmark affichés ;
- isolation inter-utilisateurs testée ;
- calculs golden approuvés ;
- restauration démontrée ;
- surveillance de collecte opérationnelle ;
- mentions légales et démarche CNDP définies ;
- expérience complète en français et arabe ;
- procédure de correction et audit fonctionnelle.

## Définition d’une user story terminée

- critères d’acceptation vérifiés ;
- tests adaptés ajoutés et verts ;
- autorisation/RLS vérifiée ;
- traductions FR/AR présentes ;
- accessibilité clavier contrôlée ;
- logs sans secret ni donnée excessive ;
- documentation et migration mises à jour ;
- démonstration sur preview/staging.

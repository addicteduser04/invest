# Dossier d’architecture et backlog — MVP Portefeuille BVC

**Version :** 1.0  
**Date :** 2 août 2026  
**Source fonctionnelle :** `MVP_Portfolio_BVC_Product_Specification.md`

Ce dossier transforme le cahier des charges fonctionnel en plan de réalisation exploitable par une équipe de développement.

## Contenu

- `TECHNICAL_ARCHITECTURE.md` : architecture cible, composants, flux, sécurité, données et déploiement.
- `PROJECT_STRUCTURE.md` : arborescence initiale du dépôt, responsabilités et conventions.
- `BACKLOG.csv` : backlog importable dans Linear, Jira, Asana ou un tableur.
- `DELIVERY_PLAN.md` : séquencement en sprints, jalons, dépendances et critères de passage.
- `schema/001_initial_schema.sql` : squelette SQL initial à réviser avant toute migration de production.

## Décision principale

Le MVP sera un monorepo TypeScript composé de :

1. une application web Next.js ;
2. un worker Node.js autonome pour les tâches longues ;
3. un moteur financier pur, sans dépendance à l’interface ni au fournisseur de données ;
4. PostgreSQL comme source de vérité ;
5. Supabase pour accélérer le premier lancement (Postgres, Auth, Storage et RLS), avec une architecture portable vers un PostgreSQL/VPS ultérieur.

## Ordre de démarrage recommandé

1. Fermer les éléments du Sprint 0 : fournisseur de données, benchmark MASI TR, nom et cadre juridique provisoire.
2. Créer le monorepo conformément à `PROJECT_STRUCTURE.md`.
3. Implémenter d’abord `packages/portfolio-engine` et ses jeux de référence.
4. Appliquer le schéma initial sur un environnement local uniquement.
5. Construire le parcours vertical achat → position → valorisation → tableau de bord.
6. Ne connecter une donnée BVC de production qu’après validation écrite de ses droits d’usage.

## Avertissement

Le fichier SQL est un point de départ d’ingénierie, pas une migration de production approuvée. Les politiques RLS, les index, les règles de conservation et les formalités CNDP doivent être revus avant lancement public.

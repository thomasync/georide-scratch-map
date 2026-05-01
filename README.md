# GeoRide Scratch Map

Scratch map des trajets moto GeoRide.

Visualise tous les trajets moto unifiés sur une carte. Chaque zone visitée révèle la carte, comme un scratch à gratter.

**[Voir le site](https://georide-scratch-map.thomasync.dev/)**

> Ce projet est un **POC personnel open source**, je ne suis pas affilié à GeoRide. J'utilise cette app depuis plusieurs mois en privé, mais j'ai décidé de la rendre publique en apprenant qu'ils sortent une nouvelle application en juin, c'est le bon moment pour partager l'idée.

## Confidentialité

- Aucune donnée personnelle n'est collectée ou stockée. Tout se passe localement dans le navigateur, les seules requêtes externes sont celles vers les serveurs GeoRide.
- Le mot de passe n'est jamais conservé. Seul le token de session est gardé localement dans le navigateur.

## Idées pour l'app officielle GeoRide

- Afficher une scratch map directement dans l'application
- Ajouter des lieux favoris sur la carte (coins sympas, points de vue, restaurants, stations...)
- Associer des photos à des lieux sur le trajet
- Partager sa carte ou un trajet avec d'autres riders

### Intégration légère côté serveurs

L'ensemble de la scratch map repose sur seulement 3 appels API existants : récupération de l'utilisateur, des trackers, et des trajets. Aucun nouvel endpoint n'est nécessaire. Tout le calcul (grille hexagonale H3, rendu carte) se fait côté client. L'impact sur les serveurs GeoRide est donc minimal.

## Todo

- [ ] Ajouter les départements des pays voisins
- [ ] Modale de statistiques (altitudes, vitesses, kilomètres par département...)
- [ ] Animations sur la carte
- [ ] Slider timeline pour naviguer dans le temps
- [ ] Liste des villes et villages les plus visités
- [ ] Intégrer une source de données externe pour suggérer les plus beaux cols, villages et routes à faire
- [ ] Rendre l'app PWA
- [ ] Afficher en temps réel la position de l'utilisateur (via géolocalisation navigateur)

## Stack

- [Angular](https://angular.dev/) 21
- [MapLibre GL](https://maplibre.org/) — rendu cartographique
- [H3](https://h3geo.org/) — grille hexagonale
- [polygon-clipping](https://github.com/mfogel/polygon-clipping) — opérations booléennes sur polygones (différence monde − départements)

## Lancer le projet

```bash
npm install

npm start          # Démarrer en développement
npm run start:ssl  # Démarrer en développement avec SSL
npm run build      # Build de production
npm run format     # Formater le code
```

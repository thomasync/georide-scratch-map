# Checklist IA — tests exploratoires

Scénarios exécutés par Claude via le MCP Chrome DevTools, en complément des tests Playwright (déterministes) et unitaires.

**Pré-requis** : `npm start` lancé (http://localhost:4200). Exécuter chaque scénario dans un onglet frais. Sauf mention contraire, viewport desktop 1440×900.

**Critères d'échec globaux** (valables pour tous les scénarios) :
- ❌ Une erreur dans la console (les warnings sont à signaler, pas bloquants)
- ❌ Une requête vers un domaine externe non attendu (attendus : `basemaps.cartocdn.com`, `api.georide.com` si connecté, `api.open-elevation.com` en arrière-plan)
- ❌ Un élément UI illisible (texte tronqué, chevauchement, contraste cassé)

---

## 1. Parcours démo complet

**Contexte** : `/demo`

**Étapes** :
1. Attendre le chargement complet (compteurs visibles en bas)
2. Vérifier la carte : tuiles affichées, hexagones "scratch" visibles sur les zones parcourues
3. Zoomer jusqu'au zoom ~10 sur une zone dense (Toulouse) — les hexagones s'affinent (résolution supérieure)
4. Cliquer sur un tracé de trajet → le panneau de détail s'ouvre
5. Dans le panneau : vérifier le profil d'élévation (graphique), les stats (km, durée, vitesses), le bouton Suivre
6. Fermer le panneau

**Vérifications** :
- [ ] Compteurs cohérents (136 trajets, ~26k km, 30 pays, 127 villes)
- [ ] Watermark "DEMO" visible
- [ ] Le panneau de trajet affiche un itinéraire nommé (ex. "Plovdiv → Thessalonique") et un graphique non vide
- [ ] Aucune erreur console sur tout le parcours

## 2. Modale Récapitulatif, tab par tab

**Contexte** : `/demo`, bouton `Récapitulatif`

**Étapes** : ouvrir la modale, parcourir chaque onglet (Bilan, Découverte, Distances, Vitesses, Virages, Pauses, Essence) en notant le contenu.

**Vérifications** :
- [ ] Chaque onglet affiche du contenu non vide
- [ ] Cohérence inter-onglets : le total km du Bilan = somme approx. des distances par mois (Distances) ; le record de vitesse (Bilan/Records) = top 1 de l'onglet Vitesses
- [ ] Les boutons cliquables (trajet le plus long, journée record) ouvrent le bon trajet sur la carte
- [ ] Onglet Essence : changer le type de carburant recalcule les coûts

## 3. Filtres croisés

**Contexte** : `/demo`, barre de filtres en bas

**Étapes** :
1. Cliquer "Cette année" → noter les compteurs
2. Cliquer "3 mois", "Le mois dernier", puis un jour précis via "Choisir…"
3. Depuis la modale Récapitulatif (onglet Distances), cliquer sur un mois → le filtre s'applique
4. Revenir à "Tout"

**Vérifications** :
- [ ] Chaque filtre réduit (ou égale) les compteurs, jamais d'augmentation incohérente
- [ ] La carte se redessine (hexagones restreints à la période)
- [ ] "Tout" restaure exactement l'état initial

## 4. Partage

**Contexte** : `/demo`, bouton `Partager`

**Étapes** :
1. Ouvrir le panneau de partage, tester chaque mode (départements / hexagones / trajet)
2. Générer le lien, l'ouvrir dans un NOUVEL onglet
3. Comparer visuellement le rendu partagé avec l'original

**Vérifications** :
- [ ] Le lien `/share?d=…` s'ouvre sans authentification
- [ ] Le rendu partagé correspond (mêmes zones colorées / même trajet)
- [ ] Les stats affichées sur la vue partagée correspondent aux options cochées
- [ ] Un lien corrompu (`/share?d=zzz`) affiche une erreur propre, pas un crash

## 5. Mobile (390×844)

**Contexte** : `/demo`, émulation iPhone (390×844, touch)

**Étapes** :
1. Vérifier la disposition : boutons accessibles, pas de chevauchement avec les safe-areas
2. Ouvrir la modale Récapitulatif → swiper horizontalement entre les onglets
3. Ouvrir un trajet → le panneau s'affiche en mode mobile
4. Tester le menu mobile (bouton Menu)

**Vérifications** :
- [ ] Swipe fonctionnel entre les tabs (seuil ~50 px)
- [ ] Aucun élément hors écran ou tronqué
- [ ] Le panneau trajet est scrollable et fermable

## 6. Thème clair/sombre

**Contexte** : `/demo` puis `/login`

**Étapes** :
1. Basculer le thème (bouton lune/soleil)
2. Vérifier carte + modales + panneaux dans les deux thèmes
3. Recharger la page → le thème persiste
4. Vérifier la page `/login` dans les deux thèmes

**Vérifications** :
- [ ] `data-theme` change sur `<body>`
- [ ] Le style de carte bascule (fond sombre/clair)
- [ ] Persistance après reload (localStorage)

## 7. Résilience réseau

**Contexte** : `/demo` avec blocage réseau via DevTools

**Étapes** :
1. Bloquer `basemaps.cartocdn.com` → recharger `/demo`
2. Vérifier que l'UI reste fonctionnelle (boutons, modale stats) même sans tuiles
3. Bloquer `api.open-elevation.com` → ouvrir un trajet

**Vérifications** :
- [ ] Pas de crash ni d'écran blanc : compteurs et modales fonctionnent sans tuiles
- [ ] Le panneau trajet s'ouvre même sans élévation (graphique dégradé acceptable)
- [ ] Les erreurs réseau ne génèrent pas d'erreurs console non gérées en boucle

## 8. Audit console global

**Contexte** : tous les parcours ci-dessus

**Vérifications** :
- [ ] Zéro `console.error` sur l'ensemble des scénarios 1 à 7
- [ ] Les logs applicatifs (`[Map]`, `[H3]`, …) ne révèlent pas de boucles de recalcul anormales (même calcul répété en rafale)
- [ ] Pas de requête réseau en boucle (vérifier l'onglet réseau après 30 s d'inactivité)

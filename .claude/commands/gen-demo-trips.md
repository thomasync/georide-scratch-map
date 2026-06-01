Régénère le fichier `public/demo-trips.json` en appelant l'API OSRM pour toutes les routes définies dans `.claude/scripts/gen-demo-trips.py`.

## Utilisation

Si l'utilisateur veut ajouter ou modifier des routes :
1. Éditer le tableau `ROUTES` dans `.claude/scripts/gen-demo-trips.py` (waypoints `[lat, lon]`, `dayOffset`, `startHour`)
2. Exécuter le script :

```bash
cd /Users/thomasync/Developpement/Autres/georide-scratch-map
python3 .claude/scripts/gen-demo-trips.py > public/demo-trips.json 2>/tmp/osrm_progress.txt
```

3. Vérifier la sortie : `python3 -c "import json; d=json.load(open('public/demo-trips.json')); print(len(d), 'trips')"`

## Structure d'une route

```python
{
    'start': 'Nom départ',   # label affiché
    'end':   'Nom arrivée',  # label affiché
    'dayOffset': 42,         # jours depuis aujourd'hui (0 = aujourd'hui)
    'startHour': 9,          # heure de départ (0-23)
    'wp': [[lat, lon], ...]  # waypoints [lat, lon] pour OSRM
}
```

**Trajets connectés (boucle/pauses)** : même `dayOffset`, `startHour` décalé d'au moins 3h. `isLinkedTrip` regroupe automatiquement les trajets du même jour à ≤3km de distance.

## Après génération

Le script applique automatiquement la réduction des coords (1 point sur 3, précision 4dp). Le fichier `public/demo-trips.json` est prêt à l'emploi directement.

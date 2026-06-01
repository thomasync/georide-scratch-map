#!/usr/bin/env python3
"""
Pre-compute all demo routes via OSRM and generate demo-trips.ts.
Waypoints: [lat, lon]. OSRM API expects [lon, lat] (inverted).
Output: [lat, lon] coords for H3 consistency.
"""
import json, urllib.request, urllib.error, urllib.parse, time, math, sys

OSRM = "https://router.project-osrm.org/route/v1/driving/{coords}?overview=full&geometries=geojson"
ELEVATION_BATCH = 100   # Open-Meteo elevation API max per request (hard limit)
ELEVATION_STRIDE = 5   # sample every Nth coord; interpolate rest
ELEVATION_DELAY = 0.15 # 0.15s between batches = ~6.5 req/s, well under 600/min limit

def haversine_total(coords):
    total = 0.0
    for i in range(1, len(coords)):
        lat1, lng1 = coords[i-1]
        lat2, lng2 = coords[i]
        R = 6371000
        dlat = math.radians(lat2 - lat1)
        dlng = math.radians(lng2 - lng1)
        a = math.sin(dlat/2)**2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlng/2)**2
        total += 2 * R * math.asin(math.sqrt(a))
    return total

def fetch_route(waypoints, retries=3):
    """waypoints: list of [lat, lon]"""
    coord_str = ";".join(f"{lon},{lat}" for lat, lon in waypoints)
    url = OSRM.format(coords=coord_str)
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(url, timeout=20) as r:
                data = json.loads(r.read())
            route = data["routes"][0]
            coords = [[lat, lng] for lng, lat in route["geometry"]["coordinates"]]
            return coords, route["distance"]
        except Exception as e:
            if attempt < retries - 1:
                time.sleep(2)
                continue
            print(f"  OSRM failed ({e}), using haversine fallback", file=sys.stderr)
            coords = list(waypoints)
            return coords, haversine_total(waypoints)

# ============================================================
# ALL ROUTES — dayOffset = days ago, startHour = hour of day
# Same dayOffset + same startHour = same trip segment
# Same dayOffset + different startHour = connected trips (pauses)
# ============================================================
ROUTES = [
    # === FRANCE LOCAL (Béziers / Hérault / Sud) ===
    # Recent rides for date filter coverage
    {"start":"Toulouse","end":"Carcassonne","dayOffset":0,"startHour":9,"wp":[[43.6,1.44],[43.22,2.35]]},
    {"start":"Carcassonne","end":"Perpignan","dayOffset":1,"startHour":9,"wp":[[43.22,2.35],[43.0,2.65],[42.69,2.9]]},
    {"start":"Toulouse","end":"Montpellier","dayOffset":2,"startHour":9,"wp":[[43.6,1.44],[43.42,2.8],[43.34,3.22],[43.61,3.88]]},
    {"start":"Toulouse","end":"Bayonne","dayOffset":5,"startHour":9,"wp":[[43.6,1.44],[43.47,0.67],[43.3,-0.37],[43.49,-1.48]]},
    {"start":"Toulouse","end":"Foix","dayOffset":7,"startHour":9,"wp":[[43.6,1.44],[43.3,1.44],[42.96,1.6]]},

    # Boucle Col du Cabrespine — test "Boucle suggérée" (même jour, 2 segments)
    {"start":"Béziers","end":"Col du Cabrespine","dayOffset":8,"startHour":9,"wp":[[43.34,3.22],[43.48,2.77],[43.44,2.51]]},
    {"start":"Col du Cabrespine","end":"Béziers","dayOffset":8,"startHour":14,"wp":[[43.44,2.51],[43.42,2.63],[43.34,3.22]]},

    # Boucle Grands Causses — même jour, pause à Millau
    {"start":"Béziers","end":"Millau","dayOffset":10,"startHour":9,"wp":[[43.34,3.22],[43.61,3.16],[43.93,2.15],[44.01,2.57],[44.09,2.99]]},
    {"start":"Millau","end":"Béziers","dayOffset":10,"startHour":15,"wp":[[44.09,2.99],[43.95,2.89],[43.73,3.32],[43.34,3.22]]},

    {"start":"Montpellier","end":"Marseille","dayOffset":15,"startHour":9,"wp":[[43.61,3.88],[43.83,4.36],[43.95,4.81],[43.53,5.45],[43.3,5.37]]},

    # Béziers routes locales
    {"start":"Béziers","end":"Sète","dayOffset":20,"startHour":9,"wp":[[43.34,3.22],[43.31,3.47],[43.41,3.7]]},
    {"start":"Béziers","end":"Limoux","dayOffset":22,"startHour":9,"wp":[[43.34,3.22],[43.18,3.0],[43.18,2.76],[43.05,2.22]]},
    {"start":"Béziers","end":"Roquebrun","dayOffset":25,"startHour":9,"wp":[[43.34,3.22],[43.39,3.09],[43.48,2.97]]},
    {"start":"Béziers","end":"Vailhan","dayOffset":28,"startHour":9,"wp":[[43.34,3.22],[43.44,3.3],[43.55,3.3]]},
    {"start":"Béziers","end":"Capestang","dayOffset":30,"startHour":9,"wp":[[43.34,3.22],[43.39,3.09],[43.33,2.98]]},
    {"start":"Béziers","end":"Mazamet","dayOffset":33,"startHour":9,"wp":[[43.34,3.22],[43.48,2.77],[43.6,2.24]]},
    {"start":"Béziers","end":"Saint-Affrique","dayOffset":36,"startHour":9,"wp":[[43.34,3.22],[43.61,3.16],[43.71,3.05],[43.95,2.89]]},

    # Béziers → Le Vigan + pause repas + retour Montpellier (pauses test)
    {"start":"Béziers","end":"Le Vigan","dayOffset":40,"startHour":9,"wp":[[43.34,3.22],[43.6,3.07],[43.73,3.32],[43.99,3.61]]},
    {"start":"Le Vigan","end":"Montpellier","dayOffset":40,"startHour":14,"wp":[[43.99,3.61],[43.93,3.71],[43.79,3.72],[43.61,3.88]]},

    {"start":"Lodève","end":"Avène","dayOffset":43,"startHour":9,"wp":[[43.73,3.32],[43.72,3.18],[43.71,3.03]]},
    {"start":"Bédarieux","end":"Lodève","dayOffset":45,"startHour":9,"wp":[[43.61,3.16],[43.67,3.24],[43.73,3.32]]},
    {"start":"Gignac","end":"Saint-Guilhem-le-Désert","dayOffset":48,"startHour":9,"wp":[[43.65,3.56],[43.67,3.57],[43.73,3.55]]},
    {"start":"Cessenon-sur-Orb","end":"Olargues","dayOffset":50,"startHour":9,"wp":[[43.45,3.05],[43.5,2.99],[43.55,2.91]]},
    {"start":"Béziers","end":"Clermont-l'Hérault","dayOffset":53,"startHour":9,"wp":[[43.34,3.22],[43.43,3.35],[43.47,3.48],[43.63,3.43]]},
    {"start":"Pézenas","end":"Montpellier","dayOffset":55,"startHour":9,"wp":[[43.46,3.42],[43.47,3.48],[43.44,3.63],[43.5,3.78],[43.61,3.88]]},
    {"start":"Montpellier","end":"Lunel","dayOffset":58,"startHour":9,"wp":[[43.61,3.88],[43.64,4.02],[43.68,4.13]]},
    {"start":"Montpellier","end":"Ganges","dayOffset":60,"startHour":9,"wp":[[43.61,3.88],[43.72,3.81],[43.79,3.72],[43.93,3.71]]},
    {"start":"Béziers","end":"Frontignan","dayOffset":63,"startHour":9,"wp":[[43.34,3.22],[43.38,3.43],[43.43,3.61],[43.45,3.75]]},
    {"start":"Béziers","end":"Montpellier","dayOffset":66,"startHour":9,"wp":[[43.34,3.22],[43.46,3.42],[43.65,3.56],[43.61,3.88]]},
    {"start":"Saint-Pons","end":"La Salvetat-sur-Agout","dayOffset":68,"startHour":9,"wp":[[43.48,2.77],[43.53,2.81],[43.63,2.75],[43.65,2.68]]},
    {"start":"Bordeaux","end":"Arcachon","dayOffset":70,"startHour":9,"wp":[[44.84,-0.58],[44.66,-1.17]]},
    {"start":"Agen","end":"Cahors","dayOffset":73,"startHour":9,"wp":[[44.2,0.62],[44.35,1.04],[44.44,1.44]]},
    {"start":"Bordeaux","end":"Toulouse","dayOffset":75,"startHour":9,"wp":[[44.84,-0.58],[44.57,0.25],[44.2,0.62],[43.88,1.0],[43.6,1.44]]},
    {"start":"Toulouse","end":"Montauban","dayOffset":78,"startHour":9,"wp":[[43.6,1.44],[43.76,1.35],[44.01,1.35]]},
    {"start":"Toulouse","end":"Albi","dayOffset":80,"startHour":9,"wp":[[43.6,1.44],[43.68,1.78],[43.93,2.15]]},
    {"start":"Pau","end":"Lourdes","dayOffset":83,"startHour":9,"wp":[[43.3,-0.37],[43.1,-0.05],[43.1,-0.01]]},
    {"start":"Avignon","end":"Gap","dayOffset":85,"startHour":9,"wp":[[43.95,4.81],[44.2,5.0],[44.56,6.08]]},
    {"start":"Albi","end":"Millau","dayOffset":88,"startHour":9,"wp":[[43.93,2.15],[44.01,2.57],[44.09,2.99]]},
    {"start":"Millau","end":"Mende","dayOffset":89,"startHour":9,"wp":[[44.09,2.99],[44.3,3.25],[44.52,3.5]]},

    # === PYRÉNÉES + ESPAGNE + ANDORRE ===
    {"start":"Foix","end":"Perpignan","dayOffset":95,"startHour":9,"wp":[[42.96,1.6],[42.76,2.2],[42.69,2.9]]},
    {"start":"Foix","end":"Andorra la Vella","dayOffset":100,"startHour":9,"wp":[[42.96,1.6],[42.82,1.6],[42.65,1.58],[42.51,1.52]]},
    {"start":"Perpignan","end":"Girona","dayOffset":105,"startHour":9,"wp":[[42.69,2.9],[42.42,2.87],[42.1,2.82],[41.98,2.82]]},
    {"start":"Girona","end":"Barcelona","dayOffset":106,"startHour":9,"wp":[[41.98,2.82],[41.72,2.83],[41.57,2.64],[41.39,2.16]]},
    {"start":"Barcelona","end":"Tarragona","dayOffset":107,"startHour":9,"wp":[[41.39,2.16],[41.27,1.98],[41.12,1.24]]},
    {"start":"Barcelona","end":"Lleida","dayOffset":110,"startHour":9,"wp":[[41.39,2.16],[41.53,1.83],[41.62,1.25],[41.62,0.63]]},
    {"start":"Lleida","end":"Zaragoza","dayOffset":111,"startHour":9,"wp":[[41.62,0.63],[41.53,0.03],[41.65,-0.89]]},
    {"start":"Bayonne","end":"San Sebastián","dayOffset":115,"startHour":9,"wp":[[43.49,-1.48],[43.36,-1.79],[43.32,-1.98]]},
    {"start":"San Sebastián","end":"Bilbao","dayOffset":116,"startHour":9,"wp":[[43.32,-1.98],[43.3,-2.32],[43.26,-2.93]]},
    {"start":"Bilbao","end":"Porto","dayOffset":120,"startHour":9,"wp":[[43.26,-2.93],[40.96,-5.66],[41.15,-8.61]]},

    # Portugal côte atlantique (NOUVEAU)
    {"start":"Porto","end":"Coimbra","dayOffset":121,"startHour":9,"wp":[[41.15,-8.61],[40.65,-8.64],[40.21,-8.43]]},
    {"start":"Coimbra","end":"Évora","dayOffset":122,"startHour":9,"wp":[[40.21,-8.43],[39.5,-8.0],[38.57,-7.91]]},
    {"start":"Évora","end":"Faro","dayOffset":122,"startHour":15,"wp":[[38.57,-7.91],[38.0,-7.93],[37.02,-7.93]]},
    {"start":"Faro","end":"Lisbonne","dayOffset":123,"startHour":9,"wp":[[37.02,-7.93],[37.5,-8.65],[38.01,-8.79],[38.72,-9.14]]},

    # Maroc
    {"start":"Tarragona","end":"Murcia","dayOffset":130,"startHour":9,"wp":[[41.12,1.24],[38.35,-0.48],[37.98,-1.13]]},
    {"start":"Murcia","end":"Algeciras","dayOffset":131,"startHour":9,"wp":[[37.98,-1.13],[37.39,-5.99],[36.14,-5.35]]},
    {"start":"Tanger","end":"Marrakech","dayOffset":132,"startHour":9,"wp":[[35.77,-5.8],[33.57,-7.58],[31.63,-8.0]]},

    # === ALPES + SUISSE + AUTRICHE + BALKANS ===
    # Marseille → Nice → Col d'Allos → Grenoble (pauses aux cols)
    {"start":"Marseille","end":"Nice","dayOffset":150,"startHour":9,"wp":[[43.3,5.37],[43.12,5.93],[43.43,6.74],[43.71,7.26]]},
    {"start":"Nice","end":"Monaco","dayOffset":151,"startHour":9,"wp":[[43.71,7.26],[43.73,7.32],[43.74,7.42]]},
    {"start":"Nice","end":"Col d'Allos","dayOffset":152,"startHour":9,"wp":[[43.71,7.26],[43.95,6.92],[44.24,6.61]]},
    {"start":"Col d'Allos","end":"Grenoble","dayOffset":152,"startHour":14,"wp":[[44.24,6.61],[45.22,6.19],[45.19,5.72]]},  # pause 45min
    {"start":"Nice","end":"San Remo","dayOffset":155,"startHour":9,"wp":[[43.71,7.26],[43.79,7.52],[43.82,7.78]]},
    {"start":"Grenoble","end":"Valence","dayOffset":158,"startHour":9,"wp":[[45.19,5.72],[45.0,5.1],[44.93,4.89]]},
    {"start":"Valence","end":"Avignon","dayOffset":159,"startHour":9,"wp":[[44.93,4.89],[44.3,4.81],[43.95,4.81]]},

    # Grenoble → Genève via Chartreuse + Jura
    {"start":"Grenoble","end":"Genève","dayOffset":162,"startHour":9,"wp":[[45.19,5.72],[45.37,5.82],[45.9,6.11],[46.2,6.15]]},

    # Italie nord — 3 legs même jour, pauses à Gênes et Milan
    {"start":"San Remo","end":"Gênes","dayOffset":165,"startHour":9,"wp":[[43.82,7.78],[44.41,8.93]]},
    {"start":"Gênes","end":"Milan","dayOffset":165,"startHour":12,"wp":[[44.41,8.93],[45.18,9.05],[45.46,9.19]]},
    {"start":"Milan","end":"Trente","dayOffset":165,"startHour":16,"wp":[[45.46,9.19],[45.54,10.22],[46.07,11.12]]},

    # Genève → Freiburg → Vaduz → Innsbruck (via Arlberg) → Ljubljana (via Grossglockner)
    {"start":"Genève","end":"Freiburg","dayOffset":170,"startHour":9,"wp":[[46.2,6.15],[47.56,7.59],[47.99,7.85]]},
    {"start":"Freiburg","end":"Prague","dayOffset":173,"startHour":9,"wp":[[47.99,7.85],[48.14,11.58],[50.08,14.43]]},
    {"start":"Freiburg","end":"Vaduz","dayOffset":176,"startHour":9,"wp":[[47.99,7.85],[47.5,9.0],[47.14,9.52]]},
    {"start":"Vaduz","end":"Innsbruck","dayOffset":177,"startHour":9,"wp":[[47.14,9.52],[47.13,10.22],[47.27,11.39]]},  # via Arlberg
    {"start":"Innsbruck","end":"Grossglockner","dayOffset":178,"startHour":9,"wp":[[47.27,11.39],[47.25,12.19],[47.07,12.85]]},
    {"start":"Grossglockner","end":"Ljubljana","dayOffset":178,"startHour":15,"wp":[[47.07,12.85],[46.62,13.85],[46.05,14.51]]},  # pause au Grossglockner

    # === BALKANS + EUROPE DE L'EST (été 2024 ≈ 300 jours) ===
    # Ljubljana → Zagreb via Plitvice
    {"start":"Ljubljana","end":"Zagreb","dayOffset":300,"startHour":9,"wp":[[46.05,14.51],[44.87,15.62],[45.81,15.97]]},

    # Croatie - Côte Dalmate (NOUVEAU, 3 jours)
    {"start":"Zagreb","end":"Split","dayOffset":301,"startHour":9,"wp":[[45.81,15.97],[44.55,14.99],[43.5,16.44]]},
    {"start":"Split","end":"Dubrovnik","dayOffset":302,"startHour":9,"wp":[[43.5,16.44],[43.3,17.02],[42.65,18.09]]},

    # Zagreb → Budapest via Balaton
    {"start":"Zagreb","end":"Budapest","dayOffset":305,"startHour":9,"wp":[[45.81,15.97],[46.55,16.37],[46.83,17.72],[47.5,19.04]]},

    # Budapest → Roumanie (3 étapes avec Transfăgărășan)
    {"start":"Budapest","end":"Cluj-Napoca","dayOffset":308,"startHour":9,"wp":[[47.5,19.04],[47.07,21.92],[46.77,23.59]]},
    {"start":"Cluj-Napoca","end":"Sibiu","dayOffset":309,"startHour":9,"wp":[[46.77,23.59],[46.1,23.59],[45.8,24.15]]},
    {"start":"Sibiu","end":"Transfăgărășan","dayOffset":310,"startHour":9,"wp":[[45.8,24.15],[45.55,24.63],[45.6,24.62]]},
    {"start":"Transfăgărășan","end":"Bucarest","dayOffset":310,"startHour":15,"wp":[[45.6,24.62],[45.35,25.55],[44.43,26.1]]},  # pause 45min au Lac Bâlea

    # Balkans → Grèce (Dubrovnik path)
    {"start":"Dubrovnik","end":"Tirana","dayOffset":315,"startHour":9,"wp":[[42.65,18.09],[41.33,19.83]]},
    {"start":"Tirana","end":"Ohrid","dayOffset":316,"startHour":9,"wp":[[41.33,19.83],[41.12,20.8]]},
    {"start":"Ohrid","end":"Thessalonique","dayOffset":317,"startHour":9,"wp":[[41.12,20.8],[40.64,22.94]]},

    # Bucarest → Grèce via Bulgarie
    {"start":"Bucarest","end":"Thessalonique","dayOffset":320,"startHour":9,"wp":[[44.43,26.1],[42.15,24.75],[40.93,24.4],[40.64,22.94]]},

    # Grèce (NOUVEAU)
    {"start":"Thessalonique","end":"Meteora","dayOffset":323,"startHour":9,"wp":[[40.64,22.94],[40.19,22.13],[39.72,21.63]]},
    {"start":"Meteora","end":"Athènes","dayOffset":323,"startHour":15,"wp":[[39.72,21.63],[38.9,22.43],[37.98,23.73]]},
    {"start":"Athènes","end":"Nafplio","dayOffset":325,"startHour":9,"wp":[[37.98,23.73],[37.94,22.93],[37.57,22.8]]},
    {"start":"Nafplio","end":"Kalamata","dayOffset":325,"startHour":14,"wp":[[37.57,22.8],[37.24,22.13],[37.04,22.11]]},

    # === EUROPE DU NORD (été ~500 jours) ===
    {"start":"Toulouse","end":"Bruxelles","dayOffset":490,"startHour":9,"wp":[[43.6,1.44],[47.32,5.04],[49.26,4.03],[50.85,4.35]]},
    {"start":"Bruxelles","end":"Luxembourg","dayOffset":491,"startHour":9,"wp":[[50.85,4.35],[49.61,6.13]]},
    {"start":"Bruxelles","end":"Amsterdam","dayOffset":492,"startHour":9,"wp":[[50.85,4.35],[51.92,4.48],[52.37,4.89]]},

    # Amsterdam → Scandinavie (été, dates correctes)
    {"start":"Amsterdam","end":"Copenhague","dayOffset":495,"startHour":9,"wp":[[52.37,4.89],[53.55,10.0],[55.68,12.57]]},
    {"start":"Copenhague","end":"Göteborg","dayOffset":496,"startHour":9,"wp":[[55.68,12.57],[55.61,13.0],[57.71,11.97]]},
    {"start":"Göteborg","end":"Oslo","dayOffset":497,"startHour":9,"wp":[[57.71,11.97],[58.9,11.15],[59.91,10.75]]},  # via Bohuslän

    # Norvège - Fjords (NOUVEAU, 2 jours)
    {"start":"Oslo","end":"Flåm","dayOffset":500,"startHour":9,"wp":[[59.91,10.75],[61.1,7.47],[60.86,7.12]]},
    {"start":"Flåm","end":"Bergen","dayOffset":500,"startHour":15,"wp":[[60.86,7.12],[60.63,6.41],[60.39,5.32]]},  # pause à Flåm
    {"start":"Bergen","end":"Geiranger","dayOffset":502,"startHour":9,"wp":[[60.39,5.32],[60.87,6.84],[62.1,7.2]]},
    {"start":"Geiranger","end":"Ålesund","dayOffset":502,"startHour":14,"wp":[[62.1,7.2],[62.47,7.12],[62.47,6.16]]},  # pause au fjord

    # === ROYAUME-UNI + IRLANDE ===
    {"start":"Dover","end":"London","dayOffset":550,"startHour":9,"wp":[[51.13,1.31],[51.51,-0.13]]},
    {"start":"London","end":"Birmingham","dayOffset":551,"startHour":9,"wp":[[51.51,-0.13],[52.2,0.12],[52.48,-1.9]]},
    {"start":"Birmingham","end":"Manchester","dayOffset":552,"startHour":9,"wp":[[52.48,-1.9],[52.95,-1.14],[53.48,-2.24]]},
    {"start":"Manchester","end":"Newcastle","dayOffset":553,"startHour":9,"wp":[[53.48,-2.24],[54.97,-1.61]]},
    {"start":"Bristol","end":"Cardiff","dayOffset":555,"startHour":9,"wp":[[51.45,-2.6],[51.48,-3.18]]},
    {"start":"Bristol","end":"Leeds","dayOffset":558,"startHour":9,"wp":[[51.45,-2.6],[52.95,-1.14],[53.8,-1.55]]},

    # Newcastle → Écosse
    {"start":"Newcastle","end":"Edinburgh","dayOffset":560,"startHour":9,"wp":[[54.97,-1.61],[55.56,-2.12],[55.95,-3.19]]},  # via A68

    # Edinburgh → Inverness via Glen Coe + côte ouest
    {"start":"Edinburgh","end":"Glen Coe","dayOffset":562,"startHour":9,"wp":[[55.95,-3.19],[56.4,-3.44],[56.77,-4.06]]},
    {"start":"Glen Coe","end":"Inverness","dayOffset":562,"startHour":14,"wp":[[56.77,-4.06],[57.29,-5.56],[57.48,-4.22]]},

    # NC500 (4 segments, même jour, pauses) — test pauses + boucle circulaire
    {"start":"Inverness","end":"Applecross","dayOffset":565,"startHour":9,"wp":[[57.48,-4.22],[57.44,-5.82]]},
    {"start":"Applecross","end":"Ullapool","dayOffset":565,"startHour":14,"wp":[[57.44,-5.82],[57.89,-5.16]]},  # pause 1h Applecross
    {"start":"Ullapool","end":"Durness","dayOffset":566,"startHour":9,"wp":[[57.89,-5.16],[58.26,-4.78],[58.57,-4.75]]},
    {"start":"Durness","end":"Inverness","dayOffset":566,"startHour":14,"wp":[[58.57,-4.75],[58.64,-3.07],[57.48,-4.22]]},  # via John o'Groats, pause 30min

    # Irlande
    {"start":"Dublin","end":"Cork","dayOffset":570,"startHour":9,"wp":[[53.33,-6.25],[52.26,-7.11],[51.9,-8.47]]},
    {"start":"Cork","end":"Galway","dayOffset":570,"startHour":15,"wp":[[51.9,-8.47],[52.67,-8.63],[53.27,-9.05]]},
    {"start":"Galway","end":"Donegal","dayOffset":571,"startHour":9,"wp":[[53.27,-9.05],[53.43,-7.94],[54.27,-8.47],[54.65,-8.12]]},
    {"start":"Douglas","end":"Ramsey","dayOffset":573,"startHour":9,"wp":[[54.15,-4.49],[54.25,-4.51],[54.32,-4.39],[54.42,-4.39]]},

    # === TUNISIE + ISLANDE ===
    {"start":"Tunis","end":"Zaghouan","dayOffset":600,"startHour":9,"wp":[[36.8,10.18],[36.4,10.15]]},
    {"start":"Zaghouan","end":"Sousse","dayOffset":600,"startHour":14,"wp":[[36.4,10.15],[36.0,10.3],[35.83,10.64]]},
    {"start":"Reykjavik","end":"Akureyri","dayOffset":700,"startHour":9,"wp":[[64.13,-21.94],[64.54,-21.93],[65.68,-18.09]]},
]

print(f"Total routes to compute: {len(ROUTES)}", file=sys.stderr)

# Call OSRM for each route
results = []
for i, r in enumerate(ROUTES):
    print(f"[{i+1}/{len(ROUTES)}] {r['start']} → {r['end']}...", end=' ', flush=True, file=sys.stderr)
    coords, dist = fetch_route(r['wp'])
    results.append({
        'start': r['start'],
        'end': r['end'],
        'dayOffset': r['dayOffset'],
        'startHour': r['startHour'],
        'coords': coords,
        'distanceM': round(dist),
    })
    print(f"{round(dist/1000)}km, {len(coords)} pts", file=sys.stderr)
    time.sleep(0.3)  # be nice to the public API

# Optimize: sample every 3rd coord + round to 4dp, keep first and last
for r in results:
    c = r['coords']
    sampled = c[::3] if len(c) > 6 else c
    if sampled[-1] != c[-1]:
        sampled.append(c[-1])
    r['coords'] = [[round(x[0], 4), round(x[1], 4)] for x in sampled]

# Fetch real elevations from Open-Meteo (SRTM 90m, free, no auth)
def fetch_elevations_batch(lats, lons, retries=3):
    """Fetch elevations via Open-Meteo POST. Retries on 429 with 60s backoff."""
    url = "https://api.open-meteo.com/v1/elevation"
    payload = json.dumps({
        'latitude': [round(x, 4) for x in lats],
        'longitude': [round(x, 4) for x in lons],
    }).encode('utf-8')
    req = urllib.request.Request(url, data=payload, headers={'Content-Type': 'application/json'})
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                data = json.loads(r.read())
            return [max(1, round(e)) for e in data['elevation']]
        except urllib.error.HTTPError as e:
            if e.code == 429 and attempt < retries - 1:
                print(f"  429 rate limit — waiting 60s...", file=sys.stderr)
                time.sleep(60)
                continue
            print(f"  elevation API error: {e}", file=sys.stderr)
            return [200] * len(lats)
        except Exception as e:
            print(f"  elevation API error: {e}", file=sys.stderr)
            return [200] * len(lats)

print("Fetching elevations from Open-Meteo (stride={})...".format(ELEVATION_STRIDE), file=sys.stderr)

# Collect only strided coords for API fetch
sampled_lats, sampled_lons, sampled_map = [], [], []  # map: (trip_idx, coord_idx)
for i, r in enumerate(results):
    coords = r['coords']
    indices = list(range(0, len(coords), ELEVATION_STRIDE))
    if indices[-1] != len(coords) - 1:
        indices.append(len(coords) - 1)  # always include last point
    for j in indices:
        sampled_lats.append(coords[j][0])
        sampled_lons.append(coords[j][1])
        sampled_map.append((i, j))

# Batch-fetch strided elevations
sampled_elevs = []
total = len(sampled_lats)
for start in range(0, total, ELEVATION_BATCH):
    end = min(start + ELEVATION_BATCH, total)
    batch_elevs = fetch_elevations_batch(sampled_lats[start:end], sampled_lons[start:end])
    sampled_elevs.extend(batch_elevs)
    print(f"  elevations: {end}/{total}", file=sys.stderr)
    if end < total:
        time.sleep(ELEVATION_DELAY)

# Build per-trip sampled elevation map, then linear-interpolate to fill all positions
trip_sampled = {}  # trip_idx → {coord_idx: elevation}
for elev, (i, j) in zip(sampled_elevs, sampled_map):
    trip_sampled.setdefault(i, {})[j] = elev

for i, r in enumerate(results):
    n = len(r['coords'])
    sparse = sorted(trip_sampled.get(i, {}).items())  # [(j, elev), ...]
    alts = [200] * n
    for k in range(len(sparse) - 1):
        j0, e0 = sparse[k]
        j1, e1 = sparse[k + 1]
        for j in range(j0, j1 + 1):
            t = (j - j0) / max(j1 - j0, 1)
            alts[j] = max(1, round(e0 + t * (e1 - e0)))
    r['alts'] = alts

print(f"Elevations done. Sampled {total} pts (stride={ELEVATION_STRIDE})", file=sys.stderr)

# Generate JSON (minified)
print(json.dumps(results, separators=(',', ':')))

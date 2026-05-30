# GeoRide API — Documentation complète

Base URL : `https://api.georide.com`  
Auth : header `Authorization: Bearer YOUR_TOKEN` sur tous les endpoints sauf login.

> ⚠️ Le champ `altitude` est marqué **"not supported yet"** dans la doc officielle — il est présent dans les réponses mais jamais renseigné.

---

## Authentification

### POST /user/login
Obtenir un token (valable 30 jours).

**Body**
| Champ    | Type   | Description   |
|----------|--------|---------------|
| email    | String | Email         |
| password | String | Mot de passe  |

**Réponse 200**
| Champ      | Type    | Description                              |
|------------|---------|------------------------------------------|
| id         | Number  | Id de l'utilisateur                      |
| email      | String  | Email                                    |
| isAdmin    | Boolean | Statut admin                             |
| authToken  | String  | Token à utiliser (expire après 30 jours) |
| updatedAt  | Date    | Date de dernière mise à jour             |

---

### GET /user/new-token
Régénérer un token sans repasser par /user/login.

**Réponse 200**
| Champ     | Type   | Description                              |
|-----------|--------|------------------------------------------|
| authToken | String | Nouveau token (expire après 30 jours)    |

---

### POST /user/logout
Révoquer le token courant.

---

## Utilisateur

### GET /user
Infos de l'utilisateur connecté.

**Réponse 200**
| Champ           | Type    | Description                |
|-----------------|---------|----------------------------|
| id              | Number  | Id                         |
| email           | String  | Email                      |
| firstName       | String  | Prénom                     |
| createdAt       | Date    | Date de création           |
| phoneNumber     | String  | Numéro de téléphone        |
| pushUserToken   | String  | Token push notification    |
| legal           | Boolean | Conditions acceptées       |
| dateOfBirth     | Date    | Date de naissance          |

---

### GET /user/trackers
Liste des trackers de l'utilisateur.

**Réponse 200** — tableau `trackers[]`
| Champ                    | Type      | Description                                              |
|--------------------------|-----------|----------------------------------------------------------|
| trackerId                | Number    | Id du tracker                                            |
| trackerName              | String    | Nom du tracker                                           |
| deviceButtonAction       | String    | Action bouton (`lock` ou `sos`)                          |
| vibrationLevel           | Number    | Sensibilité vibration                                    |
| positionId               | Number    | Id de la position actuelle                               |
| fixtime                  | Date      | Date de la position actuelle (GPS time)                  |
| latitude                 | Number    | Latitude actuelle (si autorisé)                          |
| longitude                | Number    | Longitude actuelle (si autorisé)                         |
| altitude                 | Number    | Altitude actuelle (not supported yet)                    |
| lockedPositionId         | Number    | Id de la position verrouillée                            |
| lockedLatitude           | Number    | Latitude de la position verrouillée                      |
| lockedLongitude          | Number    | Longitude de la position verrouillée                     |
| role                     | String    | Rôle de l'utilisateur sur ce tracker                     |
| subscriptionId           | Date      | Id abonnement                                            |
| lastPaymentDate          | Date      | Date du dernier paiement                                 |
| giftCardId               | Number    | Id carte cadeau                                          |
| expires                  | Date      | Expiration carte cadeau                                  |
| activationDate           | Date      | Date d'activation                                        |
| odometer                 | Number    | Kilométrage (en mètres)                                  |
| isLocked                 | Boolean   | Verrouillé                                               |
| isStolen                 | Boolean   | Volé                                                     |
| isCrashed                | Boolean   | Accident détecté                                         |
| crashDetectionDisabled   | Boolean   | Détection accident désactivée                            |
| speed                    | Number    | Vitesse actuelle (en nœuds)                              |
| moving                   | Boolean   | En mouvement                                             |
| canSeePosition           | Boolean   | Permission voir position                                 |
| canLock                  | Boolean   | Permission verrouiller                                   |
| canUnlock                | Boolean   | Permission déverrouiller                                 |
| canShare                 | Boolean   | Permission partager                                      |
| canUnshare               | Boolean   | Permission supprimer partage                             |
| canCheckSpeed            | Boolean   | Permission voir vitesse                                  |
| canSeeStatistics         | Boolean   | Permission voir statistiques                             |
| canSendBrokenDownSignal  | Boolean   | Permission signaler panne                                |
| canSendStolenSignal      | Boolean   | Permission signaler vol                                  |
| status                   | String    | Statut réseau (`online` ou `offline`)                    |
| isSecondGen              | Boolean   | GeoRide 3 (2ème génération)                              |
| externalBatteryVoltage   | Number    | Tension batterie externe en volts (GeoRide 3 seulement)  |
| internalBatteryVoltage   | Number    | Tension batterie interne en volts (GeoRide 3 seulement)  |
| timezone                 | String    | Fuseau horaire (basé sur la dernière position)            |
| model                    | String    | Modèle du tracker                                        |

---

## Trajets

### GET /tracker/:trackerId/trips?from=:from&to=:to
Trajets entre deux dates.

**Paramètres**
| Champ     | Type   | Description                |
|-----------|--------|----------------------------|
| trackerId | Number | Id du tracker              |
| from      | Date   | Date début (ISO 8601)      |
| to        | Date   | Date fin (ISO 8601)        |

**Réponse 200** — tableau `trips[]`
| Champ           | Type    | Description                                                        |
|-----------------|---------|--------------------------------------------------------------------|
| id              | Number  | Id du trajet (peut être null)                                      |
| trackerId       | Number  | Id du tracker                                                      |
| averageSpeed    | Number  | Vitesse moyenne (en nœuds)                                         |
| distance        | Number  | Distance (en mètres)                                               |
| duration        | Number  | Durée (en millisecondes)                                           |
| startAddress    | String  | Adresse de départ                                                  |
| niceStartAddress| String  | Nom zone autolock si le trajet commence dans une zone              |
| startLat        | Number  | Latitude de départ                                                 |
| startLon        | Number  | Longitude de départ                                                |
| endAddress      | String  | Adresse d'arrivée                                                  |
| niceEndAddress  | String  | Nom zone autolock si le trajet se termine dans une zone            |
| endLat          | Number  | Latitude d'arrivée                                                 |
| endLon          | Number  | Longitude d'arrivée                                                |
| startTime       | Date    | Date de départ                                                     |
| endTime         | Date    | Date d'arrivée                                                     |
| staticImage     | String  | URL image carte statique (remplacer WIDTH/HEIGHT et ajouter token Mapbox) |

---

### GET /tracker/:trackerId/trips/positions?from=:from&to=:to
Positions GPS sur une plage de dates. **Limite testée : 96 jours max** — retourne `{"error":"InvalidRequest"}` au-delà. Pour couvrir tout l'historique, utiliser des tranches de 60 jours (90 jours marche mais les requêtes sont longues).

**Paramètres**
| Champ     | Type   | Description           |
|-----------|--------|-----------------------|
| trackerId | Number | Id du tracker         |
| from      | Date   | Date début (ISO 8601) |
| to        | Date   | Date fin (ISO 8601)   |

**Réponse 200** — tableau `positions[]`
| Champ     | Type   | Description                         |
|-----------|--------|-------------------------------------|
| id        | Number | Id de la position                   |
| fixtime   | Date   | Date GPS                            |
| latitude  | Number | Latitude                            |
| longitude | Number | Longitude                           |
| altitude  | Number | Altitude (**not supported yet**)    |
| speed     | Number | Vitesse (en nœuds)                  |
| address   | String | Adresse                             |

---

## Actions tracker

### POST /tracker/:trackerId/toggleLock
Bascule verrouillage/déverrouillage.

**Réponse 200**
| Champ  | Type    | Description             |
|--------|---------|-------------------------|
| locked | Boolean | Nouveau statut verrou   |

### POST /tracker/:trackerId/lock
Verrouille dans un rayon de 100m (GeoRide 1 uniquement).

### POST /tracker/:trackerId/unlock
Déverrouille.

### POST /tracker/:trackerId/shutdown
Éteint le tracker (GeoRide 3 uniquement).

### POST /tracker/:trackerId/sonor-alarm/on
Déclenche l'alarme sonore. Paramètre optionnel : `delay` (durée en ms).

### POST /tracker/:trackerId/sonor-alarm/off
Coupe l'alarme sonore (GeoRide 3 uniquement).

### POST /tracker/:trackerId/eco-mode/on / /eco-mode/off
Active/désactive le mode éco (GeoRide 3 uniquement).

### POST /tracker/:trackerId/electric-mode/on / /electric-mode/off
Active/désactive le mode électrique (GeoRide 3 uniquement).

---

## Maintenance

### GET /tracker/:trackerId/maintenance
Liste des maintenances.

### POST /tracker/:trackerId/maintenance
Créer ou mettre à jour une maintenance.

**Body**
| Champ                   | Type   | Description                                        |
|-------------------------|--------|----------------------------------------------------|
| name                    | String | Nom                                                |
| lastMaintenanceDistance | Number | Kilométrage au dernier entretien (en mètres)       |
| lastMaintenanceDate     | Date   | Date du dernier entretien (ISO 8601)               |
| dateUnitType            | String | Unité (`hours`, `days`, `weeks`, `months`, `years`)|
| everyMaintenance        | Number | Intervalle (en unités ou mètres)                   |

### DELETE /tracker/:trackerId/maintenance/:maintenanceId
Supprime une maintenance.

---

## Événements

### GET /tracker/:trackerId/events?from=:from&to=:to&results=:results&page=:page
Événements d'un tracker sur une période.

**Paramètres**
| Champ   | Type   | Description              |
|---------|--------|--------------------------|
| from    | Date   | Date début (ISO 8601)    |
| to      | Date   | Date fin (ISO 8601)      |
| results | Number | Résultats par page (max 30) |
| page    | Number | Numéro de page           |

**Réponse 200**
| Champ        | Type      | Description              |
|--------------|-----------|--------------------------|
| count        | Number    | Total d'événements       |
| rows[].name  | String    | Nom de l'événement       |
| rows[].createdAt | Date  | Date de l'événement      |

---

## Partage de trajet

### POST /tracker/:trackerId/share/trip
Crée un lien de partage. Fournir `tripId` OU `from`+`to` OU `tripMergedId`.

**Réponse 200**
| Champ   | Type   | Description     |
|---------|--------|-----------------|
| url     | String | URL de partage  |
| shareId | String | Id du partage   |

### GET /trip/:shareId
Récupère un trajet partagé (pas d'auth requise).

**Réponse 200** — inclut `positions[]` complètes avec lat/lon/altitude/speed.

---

## SocketIO temps réel

Connexion à `https://socket.georide.com/` avec le token en auth.

```js
import io from 'socket.io-client'
const socket = io('https://socket.georide.com/', {
  reconnection: true,
  transports: ['websocket'],
  auth: { token: 'YOUR_TOKEN' }
})
```

**Événements reçus**
| Événement                     | Description                                      |
|-------------------------------|--------------------------------------------------|
| `message`                     | Infos d'authentification                         |
| `device`                      | Tracker ajouté au compte                         |
| `position`                    | Nouvelle position d'un tracker                   |
| `alarm`                       | Alarme déclenchée (vibration, crash, vol, etc.)  |
| `refreshTrackersInstruction`  | Liste de trackers à rafraîchir                   |
| `lockedPosition`              | Tracker verrouillé/déverrouillé                  |

Format alarme :
```json
{
  "trackerId": 1,
  "trackerName": "Husqvarna 701",
  "name": "vibration|exitZone|crash|crashParking|deviceOffline|deviceOnline|powerCut|powerUncut|batteryWarning|temperatureWarning|magnetOn|magnetOff|sonorAlarmOn",
  "date": "2019-03-28T18:43:35.266Z"
}
```

---

## Notes importantes pour ce projet

- **`staticImage`** contient un polyline encodé (format Google) dans l'URL — utilisé par `PolylineService.extractFromStaticImage()` pour récupérer les coordonnées sans appel supplémentaire
- **`altitude`** marqué "not supported yet" dans la doc = pas affiché dans l'app officielle, mais la donnée est présente dans le fichier S3
- **Endpoint non-documenté** : `GET /tracker/:trackerId/trips/positions/link?from=&to=` retourne un lien S3 presigné (`{ url, expiresAt }`) avec **toutes** les positions sur la plage donnée, au format `[{ lat, lon, alt, speed, time }]`. C'est cet endpoint qui permet de récupérer l'altitude sur une large plage sans charger trajet par trajet
- L'endpoint officiel `/trips/positions` n'accepte que les dates exactes d'un trajet individuel — retourne `{"error":"InvalidRequest"}` sinon
- Les vitesses sont en **nœuds** partout, les distances en **mètres**
- Les durées de trajets sont en **millisecondes**

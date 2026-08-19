# prospection-garages — outil de prospection Bifco

Trouver des **entreprises par zone** (OpenStreetMap gratuit, ou Google Places si une
clé est fournie), composer et envoyer des **courriels de partenariat**, suivre les
**réponses** et les **statistiques**. Données stockées localement dans `data/`.

## Démarrer
**Double-clic sur `Lancer.bat`** : installe les dépendances au premier lancement,
démarre le serveur, ouvre `http://localhost:3000`. Fermer la fenêtre noire = arrêter.
(`npm start` fait la même chose sans ouvrir le navigateur.)

## Les 13 campagnes
Garages + 3 villes (Montréal, Québec, Gatineau) × 4 niches. Chaque campagne est une
section indépendante avec ses propres réglages et sa propre adresse d'envoi.
Le cycle automatique fait l'**envoi des 13 campagnes AVANT le ratissage**, en deux
phases, pour qu'aucune campagne ne se retrouve à 0 contact le matin.

## Deux endroits où ça tourne
- **En local** sur cette machine, pour l'usage courant.
- **Sur le serveur cloud (DigitalOcean)**, pour les envois quotidiens automatiques.
  C'est là que tourne la vraie production — le local peut être en retard sur `origin/main`.

## Pièges à ne pas défaire
- **DNS forcé en IPv4** (`dnsMod.setDefaultResultOrder('ipv4first')` en haut de
  `server.js`). Le serveur DigitalOcean n'a pas de route IPv6, et Hostinger répond
  parfois en IPv6 via Cloudflare : sans ce réglage, les envois échouent avec
  `connect ENETUNREACH …:465`.
- **Écriture atomique des réglages.** Sans elle, des campagnes se réinitialisaient
  toutes seules. Le ratissage ne doit réécrire **que ses propres champs de suivi**.

## Courriel : Hostinger, pas Gmail
Les boîtes de Bifco sont chez **Hostinger** — `smtp.hostinger.com:465` (SSL) et
`imap.hostinger.com:993`, relayées par le **tunnel SIMA** (`/etc/hosts` mappe
`imap.hostinger.com` → `127.0.0.1`). C'est le défaut du code.

## Structure
| Fichier | Rôle |
|---|---|
| `server.js` | Serveur HTTP + API + envoi SMTP + lecture IMAP des réponses |
| `public/` | Interface : `index.html`, `login.html`, `app.js`, `style.css` |
| `outils/demarrer-moteurs.js` | Prépare la campagne « Entreprises » en mode *trouver seulement* (`findOnly`) : aucun envoi tant que l'adresse neuve n'est pas réchauffée. Relançable sans danger. |
| `outils/propager-cle-google.js` | Copie la clé Google Places d'une campagne vers les 12 autres, sans jamais l'afficher. |
| `outils/verifier-envois.mjs` | Tourne **sur SIMA**, pas sur le cloud : vérifie chaque jour ouvrable que les courriels sont partis, alerte sur 3 canaux sinon. Si le cloud est en panne, il ne peut pas signaler sa propre panne. |
| `GUIDE.md` | Guide utilisateur — configuration SMTP/IMAP, usage quotidien |
| `DEMARRER-NOUVEL-ORDI.md` | Réinstallation sur une autre machine |

## Endpoints utiles
- `GET /api/tableau` — récap des 13 campagnes en un seul appel (consommé par SIMA)
- `GET /api/performance` — taux de réponse par modèle de courriel et par secteur
  (les modèles supprimés sont exclus de la comparaison)

## Règles
- Les identifiants SMTP/IMAP se saisissent dans l'interface et restent **hors du dépôt**.
- Une **adresse d'envoi neuve se réchauffe** avant d'envoyer en volume : garder les
  nouvelles campagnes en `findOnly` au départ.
- Dépendances : `nodemailer` (envoi), `imapflow` + `mailparser` (lecture des réponses).

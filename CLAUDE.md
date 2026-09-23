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
- **Un seul lot d'envoi par jour, réussi ou non** (`runSendOnce`). L'ancienne
  « auto-réparation » relançait 50 courriels tous les 15 min sur échec total : le
  11 sept. 2026 ça a fait bloquer **tout le compte Hostinger** (`554 Outbound sending
  is disabled`). Après 2 échecs totaux consécutifs, la campagne passe seule en
  `findOnly` (`auto.pauseAuto`) et alerte.
- **Verrou `tickBusy` dans `autoTick`** : un passage de 15 min peut durer plus longtemps,
  sans verrou les lots s'empilaient. Ne pas retirer.
- **Erreur SMTP fatale = arrêt du lot** (`isFatalSmtpError`, `deliverToContacts`) :
  compte désactivé, identifiants refusés, `too many AUTH`… on n'insiste pas sur les
  contacts suivants, ils restent `nouveau`.
- **Plafonds DURS, appliqués à la lecture** (`PLAFOND_QUOTIDIEN = 25`,
  `PLAFOND_WARMUP = 30`, en haut de `server.js`). Les 23 campagnes ont déjà leurs
  réglages enregistrés : borner seulement les valeurs par défaut n'aurait rien changé.
  `quotaQuotidien()` et `warmupInfo()` rabotent donc à chaque lecture, et la rampe
  de réchauffement s'arrête à 30 au lieu de monter à 50.
- **MX vérifié avant CHAQUE envoi** (`verdictMx`, `deliverToContacts`). Le filtre à
  l'import ne protégeait que les contacts récents ; les milliers accumulés avant
  n'avaient jamais été vérifiés. Verdict à trois états : une panne DNS passagère
  (timeout, SERVFAIL) ne condamne **jamais** un contact — seuls `ENOTFOUND`,
  `ENODATA` et `NXDOMAIN` le marquent `invalide`.
- **Identifiants IMAP distincts** (`settings.imap.user/pass`, repli sur le SMTP si vides).
  Indispensable dès que l'envoi passe par un relais (Brevo, boîtes dédiées) : sinon la
  lecture des réponses tente de se connecter à Hostinger avec l'identifiant du relais.

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
| `DEUX-ECRANS.md` | Deux sessions Claude sur deux écrans, une copie isolée par session |
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

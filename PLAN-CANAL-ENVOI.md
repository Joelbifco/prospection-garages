# Plan — changer le canal d'envoi (on garde l'application)

*Rédigé le 11 septembre 2026, après le blocage Hostinger.*

## 1. Constat

| Mesure (serveur cloud, 4 au 11 sept.) | Valeur |
|---|---|
| Envois tentés sur 7 jours | 115 594 |
| Envois réussis sur 7 jours | 388 |
| Rebonds enregistrés (adresses invalides) | 529 |
| Courriels envoyés depuis `moteurs@bifcobifco.com` depuis le début | 24 926 |
| Boîtes Hostinger bloquées le 11 sept. | 12 sur 12 |

Trois causes se cumulent :

1. **Le canal.** Des boîtes Hostinger mutualisées ne sont pas faites pour la prospection à froid. Hostinger tolère quelques centaines de courriels par jour et par compte, et suspend dès qu'il voit des rebonds ou des plaintes.
2. **La boucle de relance.** Quand un lot échoue entièrement, l'application relance un nouveau lot de 50 dès le passage suivant, et le planificateur empile les passages sans vérifier si le précédent tourne encore. Résultat : des centaines de connexions refusées par heure, ce qui aggrave le blocage.
3. **Le volume par adresse.** Une adresse qui envoie 25 000 courriels à froid finit toujours par être coupée, chez n'importe quel hébergeur.

## 2. Cible

L'application garde tout ce qu'elle fait bien : recherche par zone (OpenStreetMap), base de contacts, modèles, relances, lecture des réponses, statistiques par niche et par modèle.

Ce qui change :

- **L'envoi** part de boîtes dédiées à la prospection, réparties sur les 12 domaines Bifco, chacune limitée à 20 à 30 courriels par jour et réchauffée avant usage.
- **La lecture des réponses** se fait sur ces mêmes boîtes, avec des identifiants IMAP distincts des identifiants SMTP.
- **Hostinger** ne sert plus qu'aux boîtes de gestion (`ventes@bifco.shop`, `partenaires@bifcoshop.com` en réception) et à l'hébergement des domaines.

## 3. Choix du fournisseur de boîtes

L'application parle SMTP et IMAP standard, donc n'importe quel fournisseur qui donne ces deux accès fonctionne sans changer l'architecture.

| Option | Pour | Contre | Coût indicatif |
|---|---|---|---|
| **Fournisseur de boîtes pour prospection** (Mailforge, Maildoso, Zapmail, Infraforge…) | Conçu pour l'envoi à froid, réchauffement inclus, SPF/DKIM/DMARC posés automatiquement, SMTP et IMAP fournis | Réputation des serveurs partagés variable, à vérifier au test | 3 à 5 $ par boîte et par mois |
| **Google Workspace** ou **Microsoft 365** | Très bonne délivrabilité, boîtes solides | Plus cher, Google coupe aussi les comptes qui prospectent trop fort, réchauffement à gérer soi-même | 8 à 10 $ par boîte et par mois |
| **Brevo pour tout** (déjà utilisé sur Gatineau Auto) | Déjà branché, envoi simple | Conditions d'utilisation interdisent la prospection à froid, suspension possible à tout moment, ne fournit pas d'IMAP pour lire les réponses | 25 $ par mois et plus |

**Recommandation : la première option.** Elle correspond à la stratégie déjà engagée avec les 10 nouveaux domaines en réchauffement, et elle coûte le moins cher pour le nombre de boîtes nécessaire.

Dimensionnement de départ : 2 boîtes par domaine sur les 12 domaines, soit 24 boîtes. À 25 courriels par jour et par boîte, on retrouve les 600 envois quotidiens visés aujourd'hui, mais répartis de façon acceptable. Coût : environ 75 à 120 $ par mois.

## 4. Modifications dans l'application

Dans l'ordre, les quatre premières **avant toute réactivation**, quel que soit le fournisseur.

> **État au 18 septembre 2026** : modifications **1 à 4 déployées** sur le cloud (commit
> `592cf5c`, c'est la version qui tourne). Modifications **5, 6 et 7 faites et testées en
> local**, pas encore déployées. Modification 8 faite. Restent les décisions de la section 7
> (fournisseur de boîtes, budget, domaines) et les étapes du tableau de la section 5 qui
> dépendent de Joel.
>
> ⚠️ **Les 23 campagnes sont à l'arrêt** : `auto.enabled = false` et `findOnly = true`
> partout, mis à la main le 12 septembre. Aucun envoi depuis. Ce n'est pas la pause
> automatique (`pauseAuto` est à false, compteurs d'échec à 0) — il faudra les réactiver
> délibérément, une à la fois, quand les nouvelles boîtes seront réchauffées.

1. **Arrêter la boucle de relance.** Un échec total marque quand même la journée comme tentée. Après 2 échecs totaux consécutifs, la campagne se met d'elle-même en pause et envoie une alerte. Fichier : `server.js`, fonction `runSendOnce`, bloc « ÉCHEC TOTAL ».
2. **Empêcher le chevauchement des passages.** Ajouter un verrou dans `autoTick` : si un passage tourne encore, le suivant est sauté. Aujourd'hui seul le ratissage a ce verrou (`autoBusy`), pas l'envoi.
3. **Couper un lot dès une erreur fatale.** Sur `554 … disabled`, `535 authentication failed` ou `450 too many AUTH`, arrêter le lot tout de suite au lieu d'essayer 50 contacts × 3 tentatives. Fonction `deliverToContacts`.
4. **Séparer les identifiants IMAP des identifiants SMTP.** Aujourd'hui `checkReplies` réutilise `smtp.user` et `smtp.pass`. Ajouter `imap.user` et `imap.pass` dans les réglages et dans l'onglet Réglages, avec repli sur les identifiants SMTP s'ils sont vides. C'est déjà cassé pour Gatineau Auto (Brevo), dont les réponses ne sont pas lues.
5. **Plafond par boîte.** Ramener `dailyLimit` à 25 et le réchauffement à un maximum de 30 par jour, par campagne. Rendre le plafond visible dans le tableau de bord.
6. **Réduire les rebonds avant l'envoi.** Vérifier que le domaine du destinataire a un serveur de courriel (enregistrement MX) avant le premier envoi, et marquer `invalide` sans envoyer sinon. Les rebonds pèsent lourd dans la réputation.
7. **Nettoyer l'onglet Réglages.** Les textes parlent encore de « Google Workspace » et de « mot de passe d'application Google ». Les rendre neutres : « Serveur SMTP », « Mot de passe de la boîte », et ajouter le bloc IMAP.
8. **Mettre à jour `GUIDE.md` et `CLAUDE.md`** pour décrire le nouveau canal.

## 5. Déroulement

| Quand | Quoi | Qui |
|---|---|---|
| Maintenant | Envoyer le message au support Hostinger (fichier `message-support-hostinger.txt`) pour rétablir la réception et les boîtes de gestion | Joel |
| Jours 1 à 2 | Modifications 1 à 4 dans l'application, tests en local, déploiement sur le cloud | Claude |
| Jour 2 | Ouvrir un compte chez le fournisseur choisi, créer 2 boîtes par domaine, brancher les DNS (SPF, DKIM, DMARC) sur les 12 domaines | Joel, guidé par Claude |
| Jours 2 à 16 | Réchauffement automatique des 24 boîtes par le fournisseur ; pendant ce temps, modifications 5 à 8 | Fournisseur, Claude |
| Jour 3 | Test d'envoi vers joel@gmail.com depuis une boîte réchauffée quelques jours, vérification de l'arrivée en boîte de réception | Joel, Claude |
| Jour 16 | Réactivation d'une seule campagne à 10 courriels par jour, surveillance 3 jours | Claude |
| Jour 19 | Montée à 25 par jour sur cette campagne, puis réactivation des autres campagnes deux par deux | Claude |
| En continu | Suivi des rebonds et des plaintes par boîte ; toute boîte qui dépasse 3 % de rebonds est mise en pause | Application |

## 6. Ce qui ne change pas

- Les contacts déjà accumulés restent en place. Ceux de la journée du 11 septembre sont restés en statut « nouveau » et repartiront normalement.
- Les modèles de courriel, les relances et les statistiques ne bougent pas.
- La conformité à la loi canadienne antipourriel reste assurée par ce que l'application fait déjà : identification claire de Bifco, adresse postale, lien de désabonnement, et adresses de destinataires publiées en lien avec leur activité.

## 7. Décisions à prendre par Joel

1. Le fournisseur de boîtes (recommandation : un fournisseur spécialisé prospection).
2. Le budget mensuel accepté pour les boîtes.
3. Si les 12 domaines actuels suffisent ou s'il faut en ajouter pour répartir davantage.

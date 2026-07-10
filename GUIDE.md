# Prospection Garages — Guide d'utilisation

Outil pour **trouver des garages** dans les zones de ton choix, **composer** des courriels de
partenariat et les **envoyer** depuis ton adresse `partenaires@bifcoshop.com`, avec des **statistiques**.

---

## 🚀 Démarrer l'application

**Double-clique sur `Lancer.bat`.**

Une fenêtre noire s'ouvre (laisse-la ouverte), puis ton navigateur ouvre l'app à
`http://localhost:3000`. Pour arrêter : ferme la fenêtre noire.

> Rien à installer : Node.js est déjà présent. Au tout premier lancement, les composants
> se téléchargent automatiquement (quelques secondes).

---

## 📝 Première configuration (à faire une seule fois)

1. Onglet **⚙️ Réglages**
2. Ton courriel `bifcoshop.com` est sur **Google Workspace (Gmail)**. Paramètres SMTP :
   - **Serveur SMTP** : `smtp.gmail.com`
   - **Port** : `465`, coche **« SSL »**
   - **Identifiant** : `partenaires@bifcoshop.com`
   - **Mot de passe** : un **mot de passe d'application** Google (voir ci-dessous), pas ton mot de passe habituel

   **Créer le mot de passe d'application** (une seule fois) :
   - Connecte-toi à `partenaires@bifcoshop.com`, puis va sur **myaccount.google.com/apppasswords**
   - (La vérification en 2 étapes doit être activée sur le compte — sinon active-la d'abord dans Sécurité.)
   - Donne un nom (ex. « App courriels ») → Google te donne un code de **16 caractères**
   - Copie ce code dans le champ **Mot de passe** de l'app.

   > ✅ SPF, DKIM et DMARC sont déjà configurés par Google sur ton domaine — rien à faire côté DNS.
3. Remplis ta **signature** et l'**adresse postale** de l'entreprise.
4. Clique **Tester la connexion**. Tu dois voir « Connexion SMTP réussie ✓ ».
5. Clique **Enregistrer**.

Le badge en haut à droite passe alors à **« SMTP prêt ✓ »**.

---

## 🔎 Trouver des garages

1. Onglet **🔎 Recherche**
2. Tape une zone : `Laval, Québec`, `Trois-Rivières`, `Rive-Sud Montréal`, un code postal…
3. Choisis un **rayon** (5 à 40 km).
4. Laisse coché **« Chercher les courriels sur les sites »** (va lire les sites web des garages
   qui n'ont pas de courriel listé).
5. **Rechercher** → la liste s'affiche.
6. Coche les garages voulus → **Ajouter aux contacts**.

> La source des données est l'annuaire public **OpenStreetMap**. Tous les garages n'ont pas de
> courriel public : l'outil récupère ceux qui sont disponibles.

---

## ✉️ Composer un courriel

1. Onglet **✉️ Courriels**
2. Un modèle par défaut existe déjà. Modifie-le ou crée-en un nouveau.
3. Utilise des **variables** qui se remplissent automatiquement pour chaque garage :
   - `{{nom}}` — nom du garage
   - `{{ville}}` — ville
   - `{{courriel}}`, `{{telephone}}`
4. **Enregistrer**, puis **Aperçu** pour voir le rendu final.

> 💡 Besoin d'un texte sur mesure ? Reviens me voir dans le chat et demande
> « rédige un courriel de partenariat pour garages » — je te le fournis, tu le colles ici.

Un **pied de page de désabonnement** et ta **signature** sont ajoutés automatiquement à chaque
envoi (recommandé pour respecter les règles anti-pourriel, ex. loi C-28 / LCAP au Canada).

---

## 📤 Envoyer

1. Onglet **📤 Envoi**
2. Choisis le **modèle** et le **filtre** (Nouveaux / Tous / Déjà contactés).
3. Coche les garages → **Envoyer aux sélectionnés**.
4. Un **délai** est appliqué entre chaque courriel (réglable dans Réglages) pour protéger la
   réputation de ton adresse. **Garde la fenêtre ouverte** pendant l'envoi.

Après l'envoi, les contacts passent automatiquement au statut **« contacté »**.

### 🌡️ Mode réchauffement (anti-pourriel)

Dans **⚙️ Réglages → Mode réchauffement**, active l'option pour une adresse neuve. L'app impose
alors un **plafond d'envois par jour qui monte tout seul** : 10/jour la semaine 1, 20 la semaine 2,
30 la semaine 3, 40 la semaine 4, puis 50 (ou le maximum que tu choisis).

- Une bannière dans l'onglet **Envoi** affiche « X / Y envoyés aujourd'hui ».
- Si tu sélectionnes plus de contacts que le plafond, l'app envoie ce qu'elle peut et **garde le
  reste pour le lendemain** — tu ne peux pas brûler ton adresse par accident.

> ⚠️ Le plus important reste d'activer **SPF, DKIM et DMARC** chez Hostinger
> (hPanel → Emails → ton domaine → vérificateur de configuration). Sans ça, même un envoi lent
> finira dans les pourriels.

---

## 🤖 Envoi automatique quotidien

Onglet **🤖 Auto**. Chaque jour, l'app trouve de nouveaux garages dans tes zones et envoie le
quota du jour, sans que tu cliques.

1. **Modèle** : choisis le courriel à envoyer automatiquement.
2. **Zones à prospecter** : une par ligne (ex. `Laval, Québec`). L'app tourne dessus l'une après
   l'autre, jour après jour, et évite les doublons.
3. **Rayon** et **Petits garages seulement** : mêmes réglages que la recherche manuelle.
4. Coche **Activer l'envoi automatique quotidien** → **Enregistrer**.
5. Bouton **▶️ Lancer maintenant** pour un test immédiat.

**Combien de courriels par jour ?** Le quota vient du **mode réchauffement** (10/jour au début,
puis 20, 30…). Si le réchauffement est désactivé, c'est le « Quota/jour » que tu choisis.

> ⚠️ **Important** : l'automatisation ne tourne **que si l'app est ouverte**. Ouvre `Lancer.bat`
> une fois par jour (ou laisse l'app ouverte) et elle enverra le quota du jour automatiquement.
> Elle ne s'exécute **qu'une seule fois par jour**, même si tu ouvres l'app plusieurs fois.

## 📊 Statistiques

Onglet **📊 Stats** : envoyés aujourd'hui / 7 jours / total, réussis vs échecs, répartition par
zone, et le **journal** détaillé de chaque envoi.

---

## 📁 Où sont mes données ?

Tout est stocké **localement** sur ton ordinateur, dans le dossier `data/` :
`contacts.json`, `templates.json`, `sends.json`, `settings.json`. Rien n'est envoyé ailleurs.
Fais-en une copie de temps en temps pour sauvegarder.

---

## ⚖️ Bon à savoir

- Contacter des entreprises par courriel pour une offre commerciale est encadré par la loi
  (au Canada : **LCAP**). Garde le pied de page de désabonnement, indique ton adresse postale,
  et retire immédiatement quiconque répond « DÉSABONNEMENT ».
- Respecte des envois raisonnables (le délai intégré aide) pour éviter d'être classé pourriel.

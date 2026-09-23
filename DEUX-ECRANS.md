# Deux écrans, deux sessions Claude

Comment travailler avec une session de Claude sur chaque écran, sans que les deux
se marchent dessus dans le code.

## D'abord, une limite à connaître
L'app de bureau Claude **n'ouvre pas de deuxième fenêtre** : il n'y a pas de
« Nouvelle fenêtre ». Tout vit dans une seule fenêtre, avec les sessions listées
dans la barre de gauche. Deux façons d'occuper quand même les deux écrans :

### A. Une fenêtre à cheval sur les deux écrans, deux volets — le plus simple
1. Étirer la fenêtre de Claude pour qu'elle couvre les deux écrans.
2. `Ctrl+N` : nouvelle session (elle s'ouvre dans le volet courant).
3. Dans la barre de gauche, **`Ctrl` + clic** sur une autre session : elle s'ouvre
   dans un **deuxième volet**, à côté de la première.
4. Glisser la séparation entre les deux volets pour qu'elle tombe pile sur la
   jointure des écrans — une session par écran.

Raccourcis : `Ctrl+Tab` passe d'une session à l'autre, `Ctrl+\` ferme le volet actif.
Un volet précis (le diff, le terminal) peut aussi être détaché dans sa propre
fenêtre à poser sur le deuxième écran.

### B. Bureau d'un côté, navigateur de l'autre
App de bureau sur l'écran 1, `claude.ai/code` dans une fenêtre de navigateur sur
l'écran 2. Ce sont deux vraies fenêtres, déplaçables séparément. À savoir : une
session ouverte dans le navigateur tourne **dans le cloud**, pas sur ce PC — elle
ne voit pas les fichiers locaux, seulement ce qui est poussé sur GitHub.

## Chaque session dans son propre dossier
À la création d'une session, à côté du nom de la branche, activer l'option
**worktree** : la session reçoit une **copie isolée du projet**, sur sa propre
branche. Les deux sessions ne peuvent alors plus s'écraser — rien ne passe de
l'une à l'autre tant que ce n'est pas commité.

- Les copies sont rangées dans `.claude/worktrees/`. Ce dossier est déjà dans le
  `.gitignore`, elles ne partent donc jamais sur GitHub.
- Emplacement et préfixe de branche : Réglages → Claude Code → « Worktree location ».
- Pour ranger une copie terminée : survoler la session, cliquer l'icône d'archive.
  L'option « archiver automatiquement après fusion ou fermeture de la PR » est dans
  les mêmes réglages.

## Pièges propres à ce projet
- **Un seul serveur sur le port 3000.** Si les deux sessions lancent l'app, la
  deuxième refuse de démarrer (port déjà occupé). Dans la deuxième, lancer plutôt :
  `set PORT=3001` puis `node server.js`, et ouvrir `http://localhost:3001`.
- **Une copie worktree démarre sans données.** `data/` et `SYNC-ONEDRIVE.txt` sont
  hors dépôt : la session en worktree travaille donc sur un `data/` vide — pas sur
  les vrais contacts, pas sur le dossier OneDrive partagé. C'est une protection :
  aucun risque d'envoyer de vrais courriels depuis une copie de test.
- **`npm install` est à refaire** dans chaque copie (`node_modules/` n'est pas copié).
  Un `Lancer.bat` double-cliqué dans la copie s'en charge tout seul.
- **La vraie production tourne sur le cloud DigitalOcean.** Deux sessions qui
  travaillent en parallèle sur ce PC ne changent rien là-bas tant que rien n'est
  poussé sur `origin/main`.

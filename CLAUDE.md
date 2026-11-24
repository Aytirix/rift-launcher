# Consignes de travail : à lire avant toute action

Ce fichier s'adresse à **Claude Code**. Il dit comment travailler sur ce dépôt et prime
sur les habitudes.

## 1. Ce qu'est ce dépôt

Le portage **Windows + Linux** (Electron) de Rift Launcher, le lanceur de jeux recomp de
TeK_Sama (MIT, <https://github.com/TeKSama/Rift-Launcher>). Le premier commit est son
interface 1.7.1 **telle quelle** : `git diff f4f6300 -- src/web` montre tout ce que le
portage y a changé.

- `src/web/` : l'interface d'origine. **On n'y touche qu'au strict minimum**, et chaque
  écart se commente dans le code. Le but est de pouvoir reprendre ses futures versions
  et de proposer ce portage à TeK_Sama.
- `src/web/portage.js` et `portage.css` : l'interface des fonctions **ajoutées** par le
  portage (catalogue, émulateurs, lanceur, versions, Steam). C'est là qu'on les fait
  évoluer ; `app.js` n'a que deux crochets (`window.riftEditeur`, `window.riftApresRendu`).
- `src/catalogue.json` : chaque entrée doit être **vérifiée sur la vraie release** (nom du
  programme dans l'archive, par système). Un portage qui ne s'installe pas seul a une
  `page` qui dit pourquoi, jamais un faux `programme`.
- `src/main/` : le moteur, qui remplace `RiftLauncher.ps1`. Les noms de commandes, le
  format de `library.json` et les dossiers de données sont **les mêmes** que la version
  PowerShell : un utilisateur Windows doit pouvoir passer de l'une à l'autre sans rien
  perdre.
- Tout écart volontaire avec le comportement de `RiftLauncher.ps1` est **déclaré** en
  commentaire (« Écart déclaré avec RiftLauncher.ps1 : … »).

## 2. Tout en français

Interface, messages, commentaires, noms de variables et de fichiers, messages de commit.

## 3. Ce qu'il faut lancer, à chaque fois

```sh
npm test
npm run lint
node scripts/fumee.js --headless     # Linux sans affichage (ici : jamais sur l'écran de Théo)
```

Pour un changement de paquet : `npm run dist:linux`, puis
`node scripts/fumee.js --headless --executable dist/linux-unpacked/rift-launcher`.

⚠️ L'affichage `:1` de cette machine est le **vrai bureau** de l'utilisateur : ne jamais y
ouvrir de fenêtre. Toujours `env -u DISPLAY … --headless`.

**Un test doit passer pour la BONNE raison.** Vérifie-le en cassant volontairement la ligne
testée : si le test reste vert, il ne prouve rien. C'est déjà arrivé ici : le test de
fumée attendait la fermeture du jeu avec une condition `async`, toujours « vraie », et
passait en ne comptant aucun temps de jeu.

## 4. Commits et push

- Les commits expliquent **pourquoi**, pas quoi. Format `type(portée): sujet`, en français.
- **`git push` ne se fait QUE sur demande explicite dans la conversation.** Un push sur
  `main` lance la CI. Un push de tag `vX.Y.Z` **publie une version** que les utilisateurs
  recevront par la mise à jour automatique. Sinon, dis « N commits en attente ».
- Ne pousse jamais sur une suite rouge.

## 5. Non vérifié, à garder en tête

- **Windows n'a jamais été lancé à la main** : seule la CI (`windows-latest`) l'exécute.
  Le lancement par `cmd`, `taskkill`, les boîtes « Parcourir » et la capture n'y sont
  prouvés que par le test de fumée.
- Le bouton Home **en plein jeu sous Windows** n'existe pas encore (la version d'origine
  lisait XInput et HID en C#). Piste : `koffi` (FFI sans compilation) pour
  `XInputGetStateEx` (ordinal 100) et `SetForegroundWindow`.
- La lecture des manettes Linux (`src/main/manettes-linux.js`) n'a été testée que sur
  des événements simulés, pas sur une vraie manette.
- La limite GitHub sans compte (60 appels/heure, partagée par la box) : les essais réels
  la consomment vite. Le cache ETag (`cache-github.json`) évite d'en reconsommer.
- « Ajouter à Steam » n'a été testé que sur des fichiers `shortcuts.vdf` construits par
  les tests, jamais dans un vrai Steam ; umu-launcher et Wine n'existent pas sur cette
  machine (lanceurs testés avec des faux).
- L'ID Discord intégré est vide (`src/main/discord.js`) : celui de TeK_Sama n'est pas
  repris sans son accord.

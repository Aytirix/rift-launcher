# Rift Launcher — Windows et Linux

Un lanceur pour tes jeux **recomp** (portages PC natifs comme TotK recomp, Zelda64Recomp,
Ship of Harkinian, SpaghettiKart…) et tes émulateurs : affiches, temps de jeu, mods,
sauvegardes, alertes de nouvelles versions, navigation complète à la manette avec un
mode **Big Picture**, et statut Discord.

Rift Launcher a été créé par **TeK_Sama** pour Windows
([TeKSama/Rift-Launcher](https://github.com/TeKSama/Rift-Launcher)). Cette version
reprend son interface telle quelle et remplace le moteur propre à Windows (script
PowerShell, fenêtre Edge, code C#) par une vraie application de bureau **Electron**,
qui marche sous **Windows et Linux**.

Rift Launcher ne contient et ne télécharge **aucun jeu, ROM ni clé**. Utilise tes propres
copies des jeux que tu possèdes.

## Télécharger

Dans la [dernière version](https://github.com/Aytirix/rift-launcher/releases/latest) :

| Système | Fichier | Installation |
|---|---|---|
| Windows 10 / 11 | `RiftLauncherSetup-x.y.z.exe` | Lance-le. Il n'est pas signé (un certificat coûte cher pour un petit projet gratuit) : à l'avertissement « Windows a protégé votre ordinateur », clique sur **Informations complémentaires → Exécuter quand même**. |
| Linux (toutes distributions) | `RiftLauncher-x.y.z-x86_64.AppImage` | `chmod +x RiftLauncher-*.AppImage` puis lance-le. Mise à jour automatique. |
| Debian, Ubuntu, Mint… | `RiftLauncher-x.y.z-amd64.deb` | `sudo apt install ./RiftLauncher-*.deb` |

## Ajouter un jeu

**+ Ajouter un jeu**, puis le fichier du jeu :

- **Windows** : le `.exe` (ou un `.bat`) du portage.
- **Linux** : le programme Linux du portage, une **AppImage** (rendue exécutable toute
  seule si besoin) ou un script `.sh`. Un **`.exe` Windows** se lance aussi, par
  [umu-launcher](https://github.com/Open-Wine-Components/umu-launcher) (Proton) s'il
  est installé, sinon par **Wine**.

Les variables d'environnement (une par ligne, `CLE=valeur`) servent par exemple à
`WINEPREFIX`, `PROTONPATH`, `DXVK_HUD` ou `MANGOHUD=1`.

### Exemple : un émulateur (Eglantine, Switch 2)

| Champ | Valeur |
|---|---|
| Fichier du jeu | `…/eglantine-linux-x86_64.AppImage` (ou `eglantine.exe` sous Windows) |
| Arguments | `-f -g "/chemin/vers/le/jeu.xci"` |

`-f` lance en plein écran, `-g` donne le jeu à charger. Une entrée par jeu.

## Ce qui marche, et où

| | Windows | Linux |
|---|---|---|
| Bibliothèque, affiches, sons, temps de jeu, mods, sauvegardes | ✅ | ✅ |
| Alertes de nouvelles versions des portages (GitHub) | ✅ | ✅ |
| Navigation à la manette, Big Picture | ✅ | ✅ |
| Bouton **Home** de la manette, **launcher au premier plan** | ✅ | ✅ |
| Bouton Home et bouton capture **en plein jeu** | ⏳ pas encore | ✅ Xbox, PlayStation, Switch Pro |
| Capture d'écran | ✅ | ✅ (sous Wayland : `grim`, `gnome-screenshot` ou `spectacle`) |
| Statut Discord | ✅ | ✅ (Discord normal, Flatpak ou Snap) |
| Mise à jour automatique de Rift Launcher | ✅ | ✅ AppImage ; .deb prévue, pas encore éprouvée (sinon la page de la version s'ouvre) |

Pour Windows, le bouton Home en plein jeu demandait du code natif (XInput, HID) que la
version d'origine compilait en C#. Il reviendra dans une prochaine version. En attendant,
il marche dès que Rift Launcher est au premier plan.

Sous **Linux Wayland**, un programme n'a pas le droit de passer une fenêtre devant une
autre : le bouton Home ramène Rift Launcher si le bureau l'accepte (GNOME peut se
contenter de signaler la fenêtre).

### Statut Discord

Le statut a besoin de l'**ID d'une application Discord**. Celui de la version d'origine
appartient à TeK_Sama et n'est pas repris sans son accord. Crée la tienne en deux
minutes sur [discord.com/developers](https://discord.com/developers/applications)
(nomme-la « Rift Launcher », ajoute une image `rift` dans *Rich Presence → Art Assets*),
puis colle son *Application ID* dans **Réglages → Discord**.

## Où sont mes données ?

| Système | Dossier |
|---|---|
| Windows | `%APPDATA%\RiftLauncher` — **le même que la version PowerShell** : ta bibliothèque, tes jaquettes et tes sons sont repris tels quels. |
| Linux | `~/.config/RiftLauncher` |

Dedans : `library.json` (tes jeux), `settings.json`, `jaquettes/`, `sons/`, `sauvegardes/`
et `logs/` (dont `logs/jeux/<jeu>.log`, ce que le jeu a écrit à son dernier lancement :
c'est souvent là qu'on comprend un plantage). Les captures vont dans `Images/Rift Launcher`.

Une bibliothèque illisible n'est jamais écrasée : elle est mise de côté
(`library.json.illisible-<date>`) avant que le préréglage ne la remplace.

## Développement

Il faut **Node.js 22** (ou 20.15 au minimum).

```sh
npm ci
npm start                          # lance l'application depuis le code
npm test                           # tests unitaires (node:test)
npm run lint                       # Biome
node scripts/fumee.js              # test de fumée : la vraie application, un vrai jeu factice
node scripts/fumee.js --headless   # idem sous Linux sans affichage
npm run dist:linux                 # AppImage + .deb dans dist/
npm run dist:win                   # installeur Windows (sur Windows)
```

| Dossier | Contenu |
|---|---|
| `src/web/` | L'interface de TeK_Sama (HTML, CSS, JS, traductions), modifiée au strict minimum |
| `src/main/` | Le moteur : bibliothèque, lancement des jeux, mods, Discord, manettes… |
| `src/preload.js` | Le seul pont entre l'interface et le moteur |
| `test/` | Tests unitaires |
| `scripts/fumee.js` | Test de bout en bout sur l'application lancée |

### Publier une version

1. Monter `version` dans `package.json` et commiter.
2. `git tag v2.0.1 && git push origin main v2.0.1`.

La CI rejoue les tests, construit l'installeur Windows sur Windows et l'AppImage et le
`.deb` sur Linux, lance chaque paquet construit, puis publie la release. Un échec sur un
seul système ne publie rien.

## Licence

MIT, voir [LICENSE](LICENSE). Rift Launcher © 2026 TeK_Sama ; portage Windows/Linux par
Aytirix. Les noms des jeux et les marques appartiennent à leurs propriétaires.

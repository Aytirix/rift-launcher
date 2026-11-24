'use strict';
// L'état partagé du launcher : dossiers, bibliothèque, jeux en cours.
// Les fonctions propres au système (fenêtres, boîtes « Parcourir »…) sont fournies
// par main.js dans `systeme` : les tests en donnent une version factice.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { creerJournal } = require('./journal');

// Même dossier que la version PowerShell sous Windows (%APPDATA%\RiftLauncher) :
// une bibliothèque existante est reprise telle quelle en passant à cette version.
function dossierDonneesParDefaut(plateforme = process.platform, env = process.env) {
  if (env.RIFT_DATA_DIR) return path.resolve(env.RIFT_DATA_DIR);
  if (plateforme === 'win32') return path.join(env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'RiftLauncher');
  return path.join(env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'RiftLauncher');
}

function creerDossiers(donnees, racineApp) {
  return {
    donnees,
    bibliotheque: path.join(donnees, 'library.json'),
    reglages: path.join(donnees, 'settings.json'),
    sauvegardes: path.join(donnees, 'sauvegardes'),
    journaux: path.join(donnees, 'logs'),
    journauxJeux: path.join(donnees, 'logs', 'jeux'),
    jaquettes: path.join(donnees, 'jaquettes'),
    sons: path.join(donnees, 'sons'),
    app: racineApp,
    web: path.join(racineApp, 'web'),
    preset: path.join(racineApp, 'preset'),
  };
}

function creerEtat({ donnees, racineApp, version, plateforme = process.platform, systeme = {}, captures }) {
  const dossiers = creerDossiers(donnees, racineApp);
  for (const d of [
    dossiers.donnees,
    dossiers.jaquettes,
    path.join(dossiers.jaquettes, 'jeux'),
    dossiers.sons,
    path.join(dossiers.sons, 'jeux'),
    dossiers.journaux,
    dossiers.journauxJeux,
  ]) {
    fs.mkdirSync(d, { recursive: true });
  }
  return {
    dossiers,
    captures: captures || path.join(os.homedir(), 'Pictures', 'Rift Launcher'),
    version,
    plateforme,
    systeme,
    journal: creerJournal(dossiers.journaux),
    jeux: [],
    enCours: new Map(), // id -> { proc, debut, dernierTick, arretDemande, fini }
    portages: new Map(), // id -> dernière version trouvée sur GitHub
    verifsPortages: new Map(), // id -> vérification en cours (promesse)
    miseAJour: null,
    capture: null, // { count, last } quand la capture d'écran est disponible
    cacheTempsDeJeu: new Map(),
    demarreLe: Date.now(),
    auChangement: () => {}, // appelé quand un jeu démarre ou s'arrête
  };
}

module.exports = { creerEtat, dossierDonneesParDefaut };

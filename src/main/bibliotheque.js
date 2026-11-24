'use strict';
// Bibliothèque des jeux (library.json), même format que la version PowerShell.
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { licenceDe, resoudreJaquette, resoudreSons, marqueVersion, estFichier } = require('./licences');
const { lirePrefs, enregistrerPrefs } = require('./reglages');
const { vuePortage } = require('./portages');
const { anciennesVersions } = require('./maj-portages');

// runner : lanceur d'un jeu Windows sous Linux ; emulator : émulateur qui lance ce jeu.
const CHAMPS_EDITION = ['name', 'exePath', 'args', 'env', 'saveDir', 'modsDir', 'version', 'repoUrl', 'franchise', 'runner', 'emulator'];

const texte = (v) => (v === undefined || v === null ? '' : String(v));

function nouveauJeu(source, garderStats) {
  const s = source && typeof source === 'object' ? source : {};
  const jeu = { id: texte(s.id) || crypto.randomUUID() };
  for (const champ of CHAMPS_EDITION) jeu[champ] = texte(s[champ]).trim();
  if (!jeu.name) jeu.name = 'Sans nom';
  jeu.cover = texte(s.cover);
  jeu.sound = texte(s.sound);
  jeu.coverRemote = texte(s.coverRemote); // adresse en ligne de la jaquette (statut Discord)
  jeu.skipVersion = texte(s.skipVersion); // version de portage quittée : pas de réinstallation automatique
  jeu.playSeconds = 0;
  jeu.lastPlayed = null;
  jeu.sessions = 0;
  if (garderStats) {
    if (Number(s.playSeconds)) jeu.playSeconds = Number(s.playSeconds);
    if (Number(s.lastPlayed)) jeu.lastPlayed = Math.trunc(Number(s.lastPlayed));
    if (Number(s.sessions)) jeu.sessions = Math.trunc(Number(s.sessions));
  }
  return jeu;
}

function trouverJeu(etat, id) {
  return etat.jeux.find((j) => j.id === id) ?? null;
}

function enregistrerBibliotheque(etat) {
  const fichier = etat.dossiers.bibliotheque;
  const tmp = `${fichier}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ games: etat.jeux }, null, 2));
  fs.renameSync(tmp, fichier);
}

// Jeux proposés au premier lancement, chemins devinés à partir du dossier de
// l'utilisateur. Le chemin de TotK est celui de la version Windows de TeK_Sama.
function jeuxParDefaut(plateforme) {
  const deviner = (relatif) => {
    const complet = path.join(os.homedir(), ...relatif.split('/'));
    return fs.existsSync(complet) ? complet : '';
  };
  const totk = {
    name: 'Zelda: Tears of the Kingdom',
    repoUrl: 'https://github.com/valentderah/totk-pc-recomp',
  };
  if (plateforme === 'win32') {
    totk.exePath = deviner('Desktop/totknatif/installfolder/totk.exe');
    totk.saveDir = deviner('Desktop/totknatif/installfolder/profile/save');
    totk.modsDir = deviner('Desktop/totknatif/installfolder/mods');
  }
  return [totk, { name: 'Zelda: Breath of the Wild' }];
}

function chargerBibliotheque(etat) {
  const { dossiers, journal } = etat;
  etat.jeux = [];
  // Reprend la bibliothèque de l'ancien « Lanceur TeK » (Windows) s'il y en a une.
  const ancien = process.env.APPDATA ? path.join(process.env.APPDATA, 'LanceurTeK', 'library.json') : '';
  if (etat.plateforme === 'win32' && !fs.existsSync(dossiers.bibliotheque) && ancien && fs.existsSync(ancien)) {
    fs.copyFileSync(ancien, dossiers.bibliotheque);
  }
  if (fs.existsSync(dossiers.bibliotheque)) {
    try {
      const lu = JSON.parse(fs.readFileSync(dossiers.bibliotheque, 'utf8'));
      for (const j of [].concat(lu?.games ?? [])) if (j) etat.jeux.push(nouveauJeu(j, true));
      return;
    } catch (err) {
      // Écart déclaré avec RiftLauncher.ps1 : il remplaçait en silence une bibliothèque
      // illisible par le préréglage, et la perdait. On la met de côté d'abord.
      const cote = `${dossiers.bibliotheque}.illisible-${Date.now()}`;
      try {
        fs.copyFileSync(dossiers.bibliotheque, cote);
      } catch {
        // la copie a échoué : on le dit dans le journal ci-dessous
      }
      journal('ERROR', `Bibliotheque illisible (${err.message}), copie mise de cote : ${cote}`);
      etat.jeux = [];
    }
  }
  // Premier lancement : préréglage fourni avec l'application (jeux sans chemins).
  const fichierPreset = path.join(dossiers.preset, 'preset.json');
  if (fs.existsSync(fichierPreset)) {
    try {
      const preset = JSON.parse(fs.readFileSync(fichierPreset, 'utf8'));
      const defauts = jeuxParDefaut(etat.plateforme);
      for (const pj of [].concat(preset.games ?? [])) {
        if (!pj) continue;
        const jeu = nouveauJeu(pj, false);
        jeu.id = crypto.randomUUID();
        const defaut = defauts.find((d) => d.name === jeu.name);
        for (const champ of ['exePath', 'saveDir', 'modsDir']) {
          if (!jeu[champ] && defaut?.[champ]) jeu[champ] = defaut[champ];
        }
        const image = texte(pj.coverFile);
        if (image) {
          const source = path.join(dossiers.preset, 'covers', image);
          if (fs.existsSync(source)) {
            const dest = path.join(dossiers.jaquettes, 'jeux', jeu.id + path.extname(source));
            fs.copyFileSync(source, dest);
            jeu.cover = dest;
          }
        }
        etat.jeux.push(jeu);
      }
      if (!fs.existsSync(dossiers.reglages) && preset.prefs) enregistrerPrefs(dossiers.reglages, preset.prefs);
      journal('INFO', `Premier lancement : preglage applique (${etat.jeux.length} jeux).`);
    } catch (err) {
      journal.erreur('Preglage', err);
      etat.jeux = [];
    }
  }
  if (etat.jeux.length === 0) for (const d of jeuxParDefaut(etat.plateforme)) etat.jeux.push(nouveauJeu(d, false));
  enregistrerBibliotheque(etat);
}

// Certains portages comptent eux-mêmes le temps de jeu (TotK recomp 0.3.12+ :
// profile/playtime.txt, « total_seconds N »). S'il existe, on l'affiche.
function fichierTempsDeJeu(jeu) {
  const candidats = [];
  if (jeu.exePath) candidats.push(path.join(path.dirname(jeu.exePath), 'profile', 'playtime.txt'));
  if (jeu.saveDir) candidats.push(path.join(path.dirname(jeu.saveDir.replace(/[\\/]+$/, '')), 'playtime.txt'));
  return candidats.find(estFichier) ?? null;
}

function lireTempsDuJeu(etat, jeu) {
  const fichier = fichierTempsDeJeu(jeu);
  if (!fichier) return null;
  try {
    const date = fs.statSync(fichier).mtimeMs;
    const cache = etat.cacheTempsDeJeu.get(fichier);
    if (cache && cache.date === date) return cache.secondes;
    const m = /^\s*total_seconds\s+(\d+)/.exec(fs.readFileSync(fichier, 'utf8'));
    if (m) {
      if (!cache) etat.journal('INFO', `Temps de jeu de ${jeu.name} lu depuis le jeu : ${fichier}`);
      const secondes = Number(m[1]);
      etat.cacheTempsDeJeu.set(fichier, { date, secondes });
      return secondes;
    }
  } catch (err) {
    etat.journal('DEBUG', `Lecture du temps de jeu impossible : ${fichier} : ${err.message}`);
  }
  return null;
}

// Ce que l'interface affiche : les jeux enrichis de leur licence, jaquette, sons…
function instantane(etat) {
  const jeux = etat.jeux.map((jeu) => {
    const v = { ...jeu };
    const licence = licenceDe(jeu);
    v.franchiseKey = licence ? licence.key : '';
    v.franchiseLabel = licence ? licence.label : '';
    const jaquette = resoudreJaquette(etat.dossiers, jeu);
    v.coverUrl = jaquette ? `/img?id=${encodeURIComponent(jeu.id)}&v=${marqueVersion(jaquette.path)}` : '';
    v.coverSource = jaquette ? jaquette.source : '';
    const sons = resoudreSons(etat.dossiers, jeu);
    v.soundUrls = sons ? sons.paths.map((p, i) => `/snd?id=${encodeURIComponent(jeu.id)}&n=${i}&v=${marqueVersion(p)}`) : [];
    v.soundUrl = v.soundUrls[0] ?? '';
    v.soundSource = sons ? sons.source : '';
    v.recomp = vuePortage(etat, jeu);
    v.previousVersions = anciennesVersions(etat, jeu).map((a) => ({ key: a.key, version: a.version }));
    v.launcherSeconds = Number(jeu.playSeconds) || 0;
    v.playSource = 'launcher';
    const propre = lireTempsDuJeu(etat, jeu);
    if (propre !== null) {
      v.playSeconds = propre;
      v.playSource = 'jeu';
    }
    return v;
  });
  return {
    games: jeux,
    running: [...etat.enCours.keys()],
    version: etat.version,
    update: etat.miseAJour,
    capture: etat.capture,
  };
}

function prefsDe(etat) {
  return lirePrefs(etat.dossiers.reglages);
}

module.exports = {
  CHAMPS_EDITION,
  nouveauJeu,
  trouverJeu,
  enregistrerBibliotheque,
  chargerBibliotheque,
  lireTempsDuJeu,
  instantane,
  prefsDe,
};

'use strict';
// Réglages (settings.json) : clé SteamGridDB, ID Discord et préférences générales.
const fs = require('node:fs');

const PREFS_PAR_DEFAUT = Object.freeze({
  volume: 80,
  uiVolume: 70,
  gameVolume: 100,
  hoverSounds: true,
  intro: true,
  debugLog: false,
  discord: true,
  recompCheck: true,
  homeToggle: true,
  captureButton: true,
  lang: 'auto',
});

const LANGUES = ['auto', 'fr', 'en', 'es', 'zh', 'hi', 'ar'];

function chargerReglages(fichier) {
  try {
    const lu = JSON.parse(fs.readFileSync(fichier, 'utf8'));
    if (lu && typeof lu === 'object') return lu;
  } catch {
    // absent ou illisible : réglages par défaut
  }
  return { sgdbKey: '' };
}

function enregistrerReglages(fichier, reglages) {
  const tmp = `${fichier}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(reglages, null, 2));
  fs.renameSync(tmp, fichier);
}

function lirePrefs(fichier) {
  const prefs = { ...PREFS_PAR_DEFAUT };
  const sauvees = chargerReglages(fichier).prefs;
  if (sauvees && typeof sauvees === 'object') {
    for (const k of Object.keys(PREFS_PAR_DEFAUT)) {
      if (sauvees[k] !== undefined && sauvees[k] !== null) prefs[k] = sauvees[k];
    }
  }
  return prefs;
}

function enregistrerPrefs(fichier, entrantes) {
  const prefs = lirePrefs(fichier);
  const e = entrantes && typeof entrantes === 'object' ? entrantes : {};
  for (const k of ['volume', 'uiVolume', 'gameVolume']) {
    if (e[k] === undefined || e[k] === null) continue;
    const n = Number(e[k]);
    if (Number.isFinite(n)) prefs[k] = Math.round(Math.max(0, Math.min(100, n)));
  }
  for (const k of ['hoverSounds', 'intro', 'debugLog', 'discord', 'recompCheck', 'homeToggle', 'captureButton']) {
    if (e[k] !== undefined && e[k] !== null) prefs[k] = Boolean(e[k]);
  }
  if (LANGUES.includes(e.lang)) prefs.lang = e.lang;
  const reglages = chargerReglages(fichier);
  reglages.prefs = prefs;
  enregistrerReglages(fichier, reglages);
  return prefs;
}

module.exports = { PREFS_PAR_DEFAUT, chargerReglages, enregistrerReglages, lirePrefs, enregistrerPrefs };

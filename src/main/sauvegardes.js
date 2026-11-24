'use strict';
// Sauvegardes : copie du dossier de sauvegarde du jeu, les 10 dernières sont gardées.
const fs = require('node:fs');
const path = require('node:path');
const { deux } = require('./journal');
const { estDossier } = require('./licences');
const { nomDeFichierSur } = require('./lancement');

const SAUVEGARDES_GARDEES = 10;

function horodatage(d = new Date()) {
  return `${d.getFullYear()}-${deux(d.getMonth() + 1)}-${deux(d.getDate())}_${deux(d.getHours())}-${deux(d.getMinutes())}-${deux(d.getSeconds())}`;
}

function dossierSauvegardesDu(etat, jeu) {
  return path.join(etat.dossiers.sauvegardes, nomDeFichierSur(jeu.name));
}

function sauvegarder(etat, id, maintenant = new Date()) {
  const jeu = etat.jeux.find((j) => j.id === id);
  if (!jeu) return { error: 'Jeu introuvable.' };
  if (!estDossier(jeu.saveDir)) return { error: "Choisis d'abord le dossier de sauvegarde du jeu dans ses paramètres." };
  const dossierJeu = dossierSauvegardesDu(etat, jeu);
  fs.mkdirSync(dossierJeu, { recursive: true });
  let dest = path.join(dossierJeu, horodatage(maintenant));
  // Deux sauvegardes dans la même seconde : la seconde ne doit pas se mêler à la première.
  for (let n = 2; fs.existsSync(dest); n++) dest = path.join(dossierJeu, `${horodatage(maintenant)}_${n}`);
  fs.cpSync(jeu.saveDir, dest, { recursive: true });
  const toutes = fs
    .readdirSync(dossierJeu, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
  for (const ancienne of toutes.slice(0, Math.max(0, toutes.length - SAUVEGARDES_GARDEES))) {
    fs.rmSync(path.join(dossierJeu, ancienne), { recursive: true, force: true });
  }
  return { ok: true, path: dest };
}

module.exports = { sauvegarder, dossierSauvegardesDu, horodatage, SAUVEGARDES_GARDEES };

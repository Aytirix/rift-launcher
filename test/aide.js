'use strict';
// Outils communs aux tests : un état de launcher sur un dossier temporaire.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { creerEtat } = require('../src/main/etat');

const RACINE_APP = path.join(__dirname, '..', 'src');

function dossierTemp(t) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'rift-test-'));
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  return d;
}

function etatDeTest(t, { plateforme = process.platform, systeme = {}, racineApp = RACINE_APP } = {}) {
  const donnees = dossierTemp(t);
  const etat = creerEtat({ donnees, racineApp, version: '2.0.0', plateforme, systeme, captures: path.join(donnees, 'captures') });
  const lignes = [];
  const journal = (niveau, message) => lignes.push(`${niveau} ${message}`);
  journal.erreur = (ou, err) => lignes.push(`ERROR ${ou} : ${err.message}`);
  journal.detaille = () => {};
  journal.tourner = () => {};
  etat.journal = journal;
  etat.lignes = lignes;
  return etat;
}

module.exports = { dossierTemp, etatDeTest, RACINE_APP };

'use strict';
// Émulateurs déclarés une fois dans les réglages (settings.json → emulateurs) :
// chaque jeu n'est ensuite qu'un fichier (ROM, .xci…) lancé par l'un d'eux.
const crypto = require('node:crypto');
const { chargerReglages, enregistrerReglages } = require('./reglages');

const texte = (v) => (v === undefined || v === null ? '' : String(v).trim());

function lireEmulateurs(fichierReglages) {
  const liste = chargerReglages(fichierReglages).emulateurs;
  return Array.isArray(liste)
    ? liste.filter((e) => e?.id).map((e) => ({ id: texte(e.id), name: texte(e.name), exePath: texte(e.exePath), args: texte(e.args) }))
    : [];
}

function enregistrerEmulateur(fichierReglages, entree) {
  const nom = texte(entree?.name);
  const exePath = texte(entree?.exePath);
  if (!nom) return { error: "Donne un nom à l'émulateur." };
  if (!exePath) return { error: "Choisis le programme de l'émulateur." };
  const reglages = chargerReglages(fichierReglages);
  const liste = lireEmulateurs(fichierReglages);
  const id = texte(entree.id) || crypto.randomUUID();
  const emulateur = { id, name: nom, exePath, args: texte(entree.args) };
  const i = liste.findIndex((e) => e.id === id);
  if (i >= 0) liste[i] = emulateur;
  else liste.push(emulateur);
  reglages.emulateurs = liste;
  enregistrerReglages(fichierReglages, reglages);
  return { ok: true, emulator: emulateur, emulators: liste };
}

// Un émulateur encore utilisé n'est pas retiré : ses jeux ne se lanceraient plus.
function supprimerEmulateur(fichierReglages, id, jeux) {
  const utilisateurs = jeux.filter((j) => j.emulator === id).map((j) => j.name);
  if (utilisateurs.length) return { error: `Cet émulateur lance encore : ${utilisateurs.join(', ')}. Change-les d'abord.` };
  const reglages = chargerReglages(fichierReglages);
  reglages.emulateurs = lireEmulateurs(fichierReglages).filter((e) => e.id !== id);
  enregistrerReglages(fichierReglages, reglages);
  return { ok: true, emulators: reglages.emulateurs };
}

module.exports = { lireEmulateurs, enregistrerEmulateur, supprimerEmulateur };

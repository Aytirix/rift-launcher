'use strict';
// Mods : un mod actif est dans le dossier des mods. Pour le couper, on le déplace
// dans le dossier voisin « <nom>_desactives » ; pour le remettre, on le ramène.
// Rien n'est jamais supprimé.
const fs = require('node:fs');
const path = require('node:path');
const { estDossier } = require('./licences');

const SUFFIXE_DESACTIVES = '_desactives';

function dossiersMods(jeu) {
  if (!jeu.modsDir) return null;
  const actifs = jeu.modsDir.replace(/[\\/]+$/, '');
  return { on: actifs, off: path.join(path.dirname(actifs), path.basename(actifs) + SUFFIXE_DESACTIVES) };
}

function listerMods(etat, id) {
  const jeu = etat.jeux.find((j) => j.id === id);
  if (!jeu) return { error: 'Jeu introuvable.' };
  const d = dossiersMods(jeu);
  if (!d) return { error: "Choisis d'abord le dossier des mods dans les paramètres du jeu." };
  if (!estDossier(d.on)) return { error: `Le dossier des mods n'existe pas : ${d.on}` };
  const mods = [];
  for (const [dossier, enabled] of [
    [d.on, true],
    [d.off, false],
  ]) {
    if (!estDossier(dossier)) continue;
    for (const e of fs.readdirSync(dossier, { withFileTypes: true })) {
      if (e.name.startsWith('.')) continue;
      let date = 0;
      try {
        date = Math.trunc(fs.statSync(path.join(dossier, e.name)).mtimeMs);
      } catch {
        // lien cassé : on l'affiche quand même, sans date
      }
      mods.push({ name: e.name, enabled, isDir: e.isDirectory(), date });
    }
  }
  mods.sort((a, b) => a.name.localeCompare(b.name));
  return { dir: d.on, mods };
}

function changerMod(etat, id, nom, activer) {
  const jeu = etat.jeux.find((j) => j.id === id);
  if (!jeu) return { error: 'Jeu introuvable.' };
  const d = dossiersMods(jeu);
  if (!d) return { error: 'Aucun dossier des mods.' };
  if (!nom || /[\\/:*?"<>|]/.test(nom) || nom === '.' || nom === '..') return { error: 'Nom de mod invalide.' };
  const [de, vers] = activer ? [d.off, d.on] : [d.on, d.off];
  const source = path.join(de, nom);
  const cible = path.join(vers, nom);
  if (!fs.existsSync(source)) return { error: 'Ce mod a été déplacé ou supprimé. Actualise la liste.' };
  if (fs.existsSync(cible)) return { error: `Un mod du même nom existe déjà de l'autre côté : ${nom}` };
  if (etat.enCours.has(id)) return { error: 'Ferme le jeu avant de changer ses mods.' };
  fs.mkdirSync(vers, { recursive: true });
  try {
    fs.renameSync(source, cible);
  } catch (err) {
    etat.journal.erreur(`Mod ${nom}`, err);
    return { error: `Impossible de déplacer le mod : ${err.message}` };
  }
  etat.journal('INFO', `Mod ${activer ? 'active' : 'desactive'} : ${nom} (${jeu.name})`);
  return { ok: true };
}

module.exports = { dossiersMods, listerMods, changerMod, SUFFIXE_DESACTIVES };

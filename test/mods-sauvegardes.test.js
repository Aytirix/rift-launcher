'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { listerMods, changerMod } = require('../src/main/mods');
const { sauvegarder, SAUVEGARDES_GARDEES } = require('../src/main/sauvegardes');
const { nouveauJeu } = require('../src/main/bibliotheque');
const { etatDeTest } = require('./aide');

function jeuAvecMods(t) {
  const etat = etatDeTest(t);
  const mods = path.join(etat.dossiers.donnees, 'jeu', 'mods');
  fs.mkdirSync(path.join(mods, 'HD textures'), { recursive: true });
  fs.writeFileSync(path.join(mods, '60fps.pak'), 'x');
  fs.writeFileSync(path.join(mods, '.cache'), 'x');
  etat.jeux.push(nouveauJeu({ id: 'm', name: 'Jeu', modsDir: `${mods}/` }, false));
  return { etat, mods };
}

test('les mods actifs et désactivés sont listés, fichiers cachés exclus', (t) => {
  const { etat, mods } = jeuAvecMods(t);
  fs.mkdirSync(`${mods}_desactives`);
  fs.writeFileSync(path.join(`${mods}_desactives`, 'ancien.pak'), 'x');
  const r = listerMods(etat, 'm');
  assert.equal(r.dir, mods);
  assert.deepEqual(
    r.mods.map((m) => [m.name, m.enabled, m.isDir]),
    [
      ['60fps.pak', true, false],
      ['ancien.pak', false, false],
      ['HD textures', true, true],
    ],
  );
});

test('désactiver puis réactiver un mod le déplace sans jamais le supprimer', (t) => {
  const { etat, mods } = jeuAvecMods(t);
  assert.deepEqual(changerMod(etat, 'm', 'HD textures', false), { ok: true });
  assert.ok(fs.existsSync(path.join(`${mods}_desactives`, 'HD textures')));
  assert.ok(!fs.existsSync(path.join(mods, 'HD textures')));
  assert.deepEqual(changerMod(etat, 'm', 'HD textures', true), { ok: true });
  assert.ok(fs.existsSync(path.join(mods, 'HD textures')));
});

test('un mod n’est pas déplacé sur un homonyme, ni pendant la partie, ni hors du dossier', (t) => {
  const { etat, mods } = jeuAvecMods(t);
  fs.mkdirSync(`${mods}_desactives`);
  fs.writeFileSync(path.join(`${mods}_desactives`, '60fps.pak'), 'autre');
  assert.match(changerMod(etat, 'm', '60fps.pak', false).error, /existe déjà/);
  fs.rmSync(path.join(`${mods}_desactives`, '60fps.pak'));
  etat.enCours.set('m', {});
  assert.match(changerMod(etat, 'm', '60fps.pak', false).error, /Ferme le jeu/);
  etat.enCours.clear();
  for (const nom of ['..', '../x', 'a/b', 'a\\b', '']) assert.equal(changerMod(etat, 'm', nom, false).error, 'Nom de mod invalide.');
  assert.ok(fs.existsSync(path.join(mods, '60fps.pak')), 'rien n’a bougé');
});

test('une sauvegarde copie le dossier, et seules les 10 dernières sont gardées', (t) => {
  const etat = etatDeTest(t);
  const saves = path.join(etat.dossiers.donnees, 'saves');
  fs.mkdirSync(path.join(saves, 'slot1'), { recursive: true });
  fs.writeFileSync(path.join(saves, 'slot1', 'progress.sav'), 'niveau 42');
  etat.jeux.push(nouveauJeu({ id: 's', name: 'Jeu: avec/accents', saveDir: saves }, false));
  let derniere;
  for (let i = 0; i < SAUVEGARDES_GARDEES + 2; i++) derniere = sauvegarder(etat, 's', new Date(2026, 0, 1, 10, 0, i));
  assert.equal(fs.readFileSync(path.join(derniere.path, 'slot1', 'progress.sav'), 'utf8'), 'niveau 42');
  const dossier = path.dirname(derniere.path);
  assert.equal(path.basename(dossier), 'Jeu_ avec_accents');
  const gardees = fs.readdirSync(dossier).sort();
  assert.equal(gardees.length, SAUVEGARDES_GARDEES);
  assert.equal(gardees[0], '2026-01-01_10-00-02', 'les deux plus anciennes sont parties');
});

test('deux sauvegardes dans la même seconde ne se mélangent pas', (t) => {
  const etat = etatDeTest(t);
  const saves = path.join(etat.dossiers.donnees, 'saves');
  fs.mkdirSync(saves);
  fs.writeFileSync(path.join(saves, 'a.sav'), '1');
  etat.jeux.push(nouveauJeu({ id: 's', name: 'J', saveDir: saves }, false));
  const quand = new Date(2026, 0, 1, 10, 0, 0);
  const a = sauvegarder(etat, 's', quand);
  fs.writeFileSync(path.join(saves, 'a.sav'), '2');
  const b = sauvegarder(etat, 's', quand);
  assert.notEqual(a.path, b.path);
  assert.equal(fs.readFileSync(path.join(a.path, 'a.sav'), 'utf8'), '1');
  assert.equal(fs.readFileSync(path.join(b.path, 'a.sav'), 'utf8'), '2');
});

test('sans dossier de sauvegarde réglé, on le dit', (t) => {
  const etat = etatDeTest(t);
  etat.jeux.push(nouveauJeu({ id: 's', name: 'J' }, false));
  assert.match(sauvegarder(etat, 's').error, /dossier de sauvegarde/);
});

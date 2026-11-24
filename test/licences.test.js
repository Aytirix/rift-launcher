'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { slug, licenceDe, cleIntegree, resoudreJaquette, resoudreSons } = require('../src/main/licences');
const { etatDeTest } = require('./aide');

test('slug retire accents et ponctuation', () => {
  assert.equal(slug('Pokémon : Épée & Bouclier!'), 'pokemon-epee-bouclier');
  assert.equal(slug('  Zelda: Tears of the Kingdom '), 'zelda-tears-of-the-kingdom');
});

test('la licence la plus précise gagne (Mario Kart avant Mario)', () => {
  assert.equal(licenceDe({ name: 'SpaghettiKart', exePath: '' }).key, 'mariokart');
  assert.equal(licenceDe({ name: 'Super Mario 64', exePath: '' }).key, 'mario');
});

test('la licence se lit aussi dans le chemin du fichier, en mot entier', () => {
  assert.equal(licenceDe({ name: 'soh', exePath: '/home/t/Jeux/ship-of-harkinian/soh.appimage' }).key, 'zelda');
  // « zelda64recomp » n'est pas le mot « zelda » (comme dans la version d'origine) :
  // ce dossier n'a que la jaquette intégrée de Majora's Mask, pas la licence.
  assert.equal(licenceDe({ name: 'Mon jeu', exePath: '/j/zelda64recomp/Zelda64Recompiled' }), null);
  // « samus » ne doit pas être trouvé dans « samusXYZ » : mot entier seulement
  assert.equal(licenceDe({ name: 'samusxyz', exePath: '' }), null);
});

test('une licence choisie à la main passe avant la détection', () => {
  assert.equal(licenceDe({ name: 'Zelda', franchise: 'kirby' }).key, 'kirby');
  assert.deepEqual(licenceDe({ name: 'Zelda', franchise: 'Ma Série' }), { key: 'ma-serie', label: 'Ma Série' });
});

test('jaquette : image du jeu > dossier jaquettes > jaquette intégrée', (t) => {
  const etat = etatDeTest(t);
  const jeu = { id: 'x', name: 'Zelda: Tears of the Kingdom', exePath: '' };
  assert.equal(cleIntegree(jeu), 'totk');
  assert.equal(resoudreJaquette(etat.dossiers, jeu).source, 'integree');
  const parLicence = path.join(etat.dossiers.jaquettes, 'Zelda.png');
  fs.writeFileSync(parLicence, 'png');
  assert.deepEqual(resoudreJaquette(etat.dossiers, jeu), { path: parLicence, source: 'dossier' });
  const parNom = path.join(etat.dossiers.jaquettes, 'zelda-tears-of-the-kingdom.jpg');
  fs.writeFileSync(parNom, 'jpg');
  assert.equal(resoudreJaquette(etat.dossiers, jeu).path, parNom, 'le nom du jeu passe avant la licence');
  const perso = path.join(etat.dossiers.donnees, 'perso.webp');
  fs.writeFileSync(perso, 'webp');
  assert.equal(resoudreJaquette(etat.dossiers, { ...jeu, cover: perso }).source, 'perso');
});

test('sons : un sous-dossier de licence donne tous ses sons, dans l’ordre', (t) => {
  const etat = etatDeTest(t);
  const dossier = path.join(etat.dossiers.sons, 'zelda');
  fs.mkdirSync(dossier);
  fs.writeFileSync(path.join(dossier, 'listen.mp3'), '');
  fs.writeFileSync(path.join(dossier, 'hey.ogg'), '');
  fs.writeFileSync(path.join(dossier, 'notes.txt'), '');
  const sons = resoudreSons(etat.dossiers, { name: 'Ocarina of Time' });
  assert.equal(sons.source, 'aleatoire');
  assert.deepEqual(
    sons.paths.map((p) => path.basename(p)),
    ['hey.ogg', 'listen.mp3'],
  );
  assert.equal(resoudreSons(etat.dossiers, { name: 'Kirby' }), null);
});

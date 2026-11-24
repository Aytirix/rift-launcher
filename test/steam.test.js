'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { lireVdf, ecrireVdf, idRaccourci, ajouterASteam } = require('../src/main/steam');
const { nouveauJeu } = require('../src/main/bibliotheque');
const { etatDeTest, dossierTemp, RACINE_APP } = require('./aide');

test('VDF binaire : relu à l’identique (tables, textes, entiers 32 et 64 bits)', () => {
  const t = { shortcuts: { 0: { appid: -123456, AppName: 'Jeu é', tags: { 0: 'A', 1: 'B' }, gros: 2n ** 40n } } };
  assert.deepEqual(lireVdf(ecrireVdf(t)), t);
  assert.throws(() => lireVdf(Buffer.from([0x00, 0x61, 0x00, 0x01])), /tronqué/);
});

function steamFactice(t, { autres } = {}) {
  const racine = dossierTemp(t);
  const config = path.join(racine, 'userdata', '12345', 'config');
  fs.mkdirSync(config, { recursive: true });
  fs.writeFileSync(path.join(config, 'localconfig.vdf'), '');
  if (autres) fs.writeFileSync(path.join(config, 'shortcuts.vdf'), ecrireVdf(autres));
  return { racines: [racine], config };
}

test('ajouter à Steam : raccourci vers Rift Launcher, les autres raccourcis gardés, original copié', (t) => {
  const etat = etatDeTest(t);
  etat.jeux.push(nouveauJeu({ id: 'j1', name: 'Zelda: Tears of the Kingdom' }, false));
  const autre = { shortcuts: { 0: { appid: 1, AppName: 'Mon émulateur', Exe: '"/e/emu"', LaunchOptions: '' } } };
  const s = steamFactice(t, { autres: autre });
  const lanceur = { exe: '/apps/Rift Launcher.AppImage', args: '' };
  const r = ajouterASteam(etat, 'j1', { lanceur, racines: s.racines, enCours: () => false });
  assert.deepEqual(r, { ok: true, updated: false });
  const lu = lireVdf(fs.readFileSync(path.join(s.config, 'shortcuts.vdf')));
  assert.equal(lu.shortcuts[0].AppName, 'Mon émulateur', 'raccourci existant intact');
  const e = lu.shortcuts[1];
  assert.deepEqual(
    [e.AppName, e.Exe, e.LaunchOptions, e.StartDir],
    ['Zelda: Tears of the Kingdom', '"/apps/Rift Launcher.AppImage"', '--jouer=j1', '"/apps"'],
  );
  assert.equal(e.appid >>> 0, idRaccourci('"/apps/Rift Launcher.AppImage"', 'Zelda: Tears of the Kingdom'));
  assert.ok(fs.existsSync(path.join(s.config, 'shortcuts.vdf.avant-rift-launcher')));
  // Deuxième ajout du même jeu : mis à jour, pas dupliqué.
  assert.deepEqual(ajouterASteam(etat, 'j1', { lanceur, racines: s.racines, enCours: () => false }), { ok: true, updated: true });
  assert.equal(Object.keys(lireVdf(fs.readFileSync(path.join(s.config, 'shortcuts.vdf'))).shortcuts).length, 2);
});

test('Steam ouvert : refus, rien n’est écrit', (t) => {
  const etat = etatDeTest(t);
  etat.jeux.push(nouveauJeu({ id: 'j1', name: 'J' }, false));
  const s = steamFactice(t);
  const r = ajouterASteam(etat, 'j1', { lanceur: { exe: '/a', args: '' }, racines: s.racines, enCours: () => true });
  assert.match(r.error, /Ferme Steam/);
  assert.ok(!fs.existsSync(path.join(s.config, 'shortcuts.vdf')));
});

test('des raccourcis Steam illisibles ne sont jamais écrasés', (t) => {
  const etat = etatDeTest(t);
  etat.jeux.push(nouveauJeu({ id: 'j1', name: 'J' }, false));
  const s = steamFactice(t);
  fs.writeFileSync(path.join(s.config, 'shortcuts.vdf'), Buffer.from([0x00, 0x73, 0x00, 0x09]));
  assert.match(
    ajouterASteam(etat, 'j1', { lanceur: { exe: '/a', args: '' }, racines: s.racines, enCours: () => false }).error,
    /illisibles/,
  );
  assert.deepEqual([...fs.readFileSync(path.join(s.config, 'shortcuts.vdf'))], [0x00, 0x73, 0x00, 0x09]);
});

test('l’affiche Steam vient de la jaquette du jeu (PNG/JPG), nommée comme Steam l’attend', (t) => {
  const etat = etatDeTest(t);
  etat.jeux.push(nouveauJeu({ id: 'j1', name: 'Mon Jeu', cover: path.join(RACINE_APP, 'icone.png') }, false));
  const s = steamFactice(t);
  ajouterASteam(etat, 'j1', { lanceur: { exe: '/a/rift', args: '"/src"' }, racines: s.racines, enCours: () => false });
  const id = idRaccourci('"/a/rift"', 'Mon Jeu');
  assert.ok(fs.existsSync(path.join(s.config, 'grid', `${id}p.png`)));
  assert.equal(lireVdf(fs.readFileSync(path.join(s.config, 'shortcuts.vdf'))).shortcuts[0].LaunchOptions, '"/src" --jouer=j1');
});

test('sans Steam installé, on le dit', (t) => {
  const etat = etatDeTest(t);
  etat.jeux.push(nouveauJeu({ id: 'j1', name: 'J' }, false));
  assert.match(
    ajouterASteam(etat, 'j1', { lanceur: { exe: '/a', args: '' }, racines: [dossierTemp(t)], enCours: () => false }).error,
    /Steam n'est pas installé/,
  );
});

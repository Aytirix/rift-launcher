'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { nouveauJeu, chargerBibliotheque, enregistrerBibliotheque, instantane } = require('../src/main/bibliotheque');
const { etatDeTest } = require('./aide');

test('nouveauJeu nettoie les champs et ne garde les statistiques que sur demande', () => {
  const source = { id: 'a', name: '  Zelda ', exePath: null, playSeconds: '12.5', sessions: 3, lastPlayed: 99, inconnu: 'x' };
  const garde = nouveauJeu(source, true);
  assert.equal(garde.name, 'Zelda');
  assert.equal(garde.exePath, '');
  assert.equal(garde.playSeconds, 12.5);
  assert.equal(garde.sessions, 3);
  assert.equal(garde.inconnu, undefined);
  const neuf = nouveauJeu(source, false);
  assert.deepEqual([neuf.playSeconds, neuf.sessions, neuf.lastPlayed], [0, 0, null]);
  assert.equal(nouveauJeu({}, false).name, 'Sans nom');
  assert.match(nouveauJeu({}, false).id, /^[0-9a-f-]{36}$/);
});

test('premier lancement : le préréglage est appliqué et enregistré', (t) => {
  const etat = etatDeTest(t);
  chargerBibliotheque(etat);
  assert.deepEqual(
    etat.jeux.map((j) => j.name),
    ['Zelda: Tears of the Kingdom', 'Zelda: Breath of the Wild', 'Splatoon 1'],
  );
  assert.equal(new Set(etat.jeux.map((j) => j.id)).size, 3);
  const surDisque = JSON.parse(fs.readFileSync(etat.dossiers.bibliotheque, 'utf8'));
  assert.equal(surDisque.games.length, 3);
});

test('une bibliothèque existante est reprise avec ses statistiques', (t) => {
  const etat = etatDeTest(t);
  fs.writeFileSync(etat.dossiers.bibliotheque, JSON.stringify({ games: [{ id: 'k', name: 'Kirby', playSeconds: 3600, sessions: 2 }] }));
  chargerBibliotheque(etat);
  assert.equal(etat.jeux.length, 1);
  assert.equal(etat.jeux[0].playSeconds, 3600);
});

test('PowerShell écrivait parfois un jeu seul au lieu d’une liste : il est relu', (t) => {
  const etat = etatDeTest(t);
  fs.writeFileSync(etat.dossiers.bibliotheque, JSON.stringify({ games: { id: 'k', name: 'Kirby' } }));
  chargerBibliotheque(etat);
  assert.deepEqual(
    etat.jeux.map((j) => j.id),
    ['k'],
  );
});

test('une bibliothèque illisible est mise de côté, jamais écrasée en silence', (t) => {
  const etat = etatDeTest(t);
  fs.writeFileSync(etat.dossiers.bibliotheque, '{ "games": [ {"name": "Mes 300 heures"');
  chargerBibliotheque(etat);
  const cote = fs.readdirSync(etat.dossiers.donnees).filter((f) => f.startsWith('library.json.illisible-'));
  assert.equal(cote.length, 1);
  assert.match(fs.readFileSync(path.join(etat.dossiers.donnees, cote[0]), 'utf8'), /Mes 300 heures/);
  assert.ok(etat.lignes.some((l) => l.startsWith('ERROR Bibliotheque illisible')));
});

test('l’enregistrement passe par un fichier temporaire (pas de fichier à moitié écrit)', (t) => {
  const etat = etatDeTest(t);
  etat.jeux.push(nouveauJeu({ name: 'A' }, false));
  enregistrerBibliotheque(etat);
  assert.ok(!fs.existsSync(`${etat.dossiers.bibliotheque}.tmp`));
  assert.equal(JSON.parse(fs.readFileSync(etat.dossiers.bibliotheque, 'utf8')).games[0].name, 'A');
});

test('instantané : temps de jeu compté par le portage lui-même quand il existe', (t) => {
  const etat = etatDeTest(t);
  const dossierJeu = path.join(etat.dossiers.donnees, 'totk');
  fs.mkdirSync(path.join(dossierJeu, 'profile'), { recursive: true });
  fs.writeFileSync(path.join(dossierJeu, 'profile', 'playtime.txt'), 'total_seconds 7200\n');
  etat.jeux.push(nouveauJeu({ id: 't', name: 'TotK', exePath: path.join(dossierJeu, 'totk'), playSeconds: 60 }, true));
  const v = instantane(etat).games[0];
  assert.deepEqual([v.playSeconds, v.launcherSeconds, v.playSource], [7200, 60, 'jeu']);
  assert.equal(v.franchiseKey, 'zelda');
  assert.match(v.coverUrl, /^\/img\?id=t&v=\d+$/);
});

test('instantané : la liste des jeux en cours vient du suivi des processus', (t) => {
  const etat = etatDeTest(t);
  etat.jeux.push(nouveauJeu({ id: 'a', name: 'A' }, false));
  etat.enCours.set('a', {});
  assert.deepEqual(instantane(etat).running, ['a']);
});

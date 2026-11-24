'use strict';
// Zip du rapport, dimensions d'image, trames Discord, boutons de manette.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { creerZip } = require('../src/main/zip');
const { dimensionsImage, avertissementImage } = require('../src/main/jaquettes');
const { trame, cheminsDiscord, StatutDiscord } = require('../src/main/discord');
const { boutonsEnfonces, BTN_MODE } = require('../src/main/manettes-linux');
const { etatDeTest, RACINE_APP } = require('./aide');

// Relit un zip entrée par entrée, comme le ferait un outil de décompression.
function lireZip(tampon) {
  const fin = tampon.length - 22;
  assert.equal(tampon.readUInt32LE(fin), 0x06054b50);
  const nombre = tampon.readUInt16LE(fin + 10);
  let central = tampon.readUInt32LE(fin + 16);
  const entrees = {};
  for (let i = 0; i < nombre; i++) {
    assert.equal(tampon.readUInt32LE(central), 0x02014b50);
    const taille = tampon.readUInt32LE(central + 20);
    const longNom = tampon.readUInt16LE(central + 28);
    const local = tampon.readUInt32LE(central + 42);
    const nom = tampon.toString('utf8', central + 46, central + 46 + longNom);
    const debut = local + 30 + tampon.readUInt16LE(local + 26);
    const donnees = zlib.inflateRawSync(tampon.subarray(debut, debut + taille));
    assert.equal(zlib.crc32(donnees), tampon.readUInt32LE(central + 16), `CRC de ${nom}`);
    entrees[nom] = donnees.toString('utf8');
    central += 46 + longNom;
  }
  return entrees;
}

test('le zip du rapport se relit, noms accentués compris', () => {
  const zip = creerZip([
    { nom: 'infos.txt', donnees: Buffer.from('Rapport') },
    { nom: 'jeux\\Zelda é.log', donnees: Buffer.from('x'.repeat(5000)) },
  ]);
  assert.deepEqual(lireZip(zip), { 'infos.txt': 'Rapport', 'jeux/Zelda é.log': 'x'.repeat(5000) });
});

test('dimensions d’image : PNG réel, JPEG, GIF', () => {
  assert.deepEqual(dimensionsImage(fs.readFileSync(path.join(RACINE_APP, 'icone.png'))), { w: 256, h: 256 });
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc0, 0, 11, 8, 0x03, 0x84, 0x02, 0x58, 3, 0, 0, 0]);
  assert.deepEqual(dimensionsImage(jpeg), { w: 600, h: 900 });
  assert.deepEqual(dimensionsImage(Buffer.from('GIF89a\x58\x02\x84\x03\0\0', 'latin1')), { w: 600, h: 900 });
  assert.equal(dimensionsImage(Buffer.from('pas une image')), null);
});

test('une jaquette carrée est signalée, une illisible ne l’est pas', () => {
  assert.match(avertissementImage(path.join(RACINE_APP, 'icone.png')), /256 x 256.*portrait 2:3/);
  assert.equal(avertissementImage(path.join(RACINE_APP, 'preload.js')), '');
});

test('trame Discord : code et longueur en petit-boutiste, puis le JSON', () => {
  const t = trame(1, { a: 'é' });
  assert.equal(t.readInt32LE(0), 1);
  assert.equal(t.readInt32LE(4), Buffer.byteLength('{"a":"é"}'));
  assert.equal(t.toString('utf8', 8), '{"a":"é"}');
});

test('Discord est cherché aux bons endroits sur chaque système', () => {
  assert.equal(cheminsDiscord('win32')[0], '\\\\?\\pipe\\discord-ipc-0');
  const linux = cheminsDiscord('linux', { XDG_RUNTIME_DIR: '/run/user/1000' });
  assert.ok(linux.includes('/run/user/1000/discord-ipc-0'));
  assert.ok(linux.includes('/run/user/1000/app/com.discordapp.Discord/discord-ipc-0'), 'Discord en Flatpak');
  assert.ok(linux.includes('/tmp/discord-ipc-9'));
});

test('Discord affiche le dernier jeu lancé, sinon les menus si la fenêtre est ouverte, sinon rien', (t) => {
  const etat = etatDeTest(t);
  let ouverte = true;
  let actif = true;
  const d = new StatutDiscord(etat, {
    prefs: () => ({ discord: actif }),
    idPerso: () => '1234567890123456789',
    fenetreOuverte: () => ouverte,
  });
  assert.equal(d.voulu(), 'menu');
  etat.enCours.set('ancien', { debut: 1 });
  etat.enCours.set('recent', { debut: 2 });
  assert.equal(d.voulu(), 'recent');
  etat.enCours.clear();
  ouverte = false;
  assert.equal(d.voulu(), '');
  ouverte = true;
  actif = false;
  assert.equal(d.voulu(), '', 'désactivé dans les réglages');
});

test('sans ID Discord valide, aucun statut n’est tenté', (t) => {
  const etat = etatDeTest(t);
  const d = new StatutDiscord(etat, { prefs: () => ({ discord: true }), idPerso: () => '12ab', fenetreOuverte: () => true });
  assert.equal(d.voulu(), '');
});

function evenement(type, code, valeur) {
  const b = Buffer.alloc(24);
  b.writeUInt16LE(type, 16);
  b.writeUInt16LE(code, 18);
  b.writeInt32LE(valeur, 20);
  return b;
}

test('manettes Linux : Home et capture à l’appui seulement, Select ignoré', () => {
  const bloc = Buffer.concat([
    evenement(1, BTN_MODE, 1), // Home enfoncé
    evenement(0, 0, 0), // synchronisation
    evenement(1, BTN_MODE, 0), // Home relâché
    evenement(1, 167, 1), // Partager (Xbox Series)
    evenement(1, 0x135, 1), // Capture (Switch Pro)
    evenement(1, 0x13a, 1), // Select / Share PlayStation : laissé au jeu
    evenement(3, BTN_MODE, 1), // un axe, pas un bouton
  ]);
  assert.deepEqual(boutonsEnfonces(bloc), ['home', 'capture', 'capture']);
});

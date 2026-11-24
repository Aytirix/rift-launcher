'use strict';
// Petit écrivain de .zip (méthode « deflate »), pour le rapport de bug : évite une
// dépendance pour une vingtaine de lignes.
const zlib = require('node:zlib');

function dateDos(d) {
  const heure = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
  const jour = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { heure, jour };
}

// entrees : [{ nom, donnees: Buffer }]
function creerZip(entrees, quand = new Date()) {
  const { heure, jour } = dateDos(quand);
  const locaux = [];
  const central = [];
  let decalage = 0;
  for (const { nom, donnees } of entrees) {
    const n = Buffer.from(nom.replace(/\\/g, '/'), 'utf8');
    const compresse = zlib.deflateRawSync(donnees);
    const crc = zlib.crc32(donnees);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // noms en UTF-8
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(heure, 10);
    local.writeUInt16LE(jour, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compresse.length, 18);
    local.writeUInt32LE(donnees.length, 22);
    local.writeUInt16LE(n.length, 26);
    locaux.push(local, n, compresse);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0);
    c.writeUInt16LE(20, 4);
    c.writeUInt16LE(20, 6);
    c.writeUInt16LE(0x0800, 8);
    c.writeUInt16LE(8, 10);
    c.writeUInt16LE(heure, 12);
    c.writeUInt16LE(jour, 14);
    c.writeUInt32LE(crc, 16);
    c.writeUInt32LE(compresse.length, 20);
    c.writeUInt32LE(donnees.length, 24);
    c.writeUInt16LE(n.length, 28);
    c.writeUInt32LE(decalage, 42);
    central.push(c, n);
    decalage += 30 + n.length + compresse.length;
  }
  const tailleCentral = central.reduce((s, b) => s + b.length, 0);
  const fin = Buffer.alloc(22);
  fin.writeUInt32LE(0x06054b50, 0);
  fin.writeUInt16LE(entrees.length, 8);
  fin.writeUInt16LE(entrees.length, 10);
  fin.writeUInt32LE(tailleCentral, 12);
  fin.writeUInt32LE(decalage, 16);
  return Buffer.concat([...locaux, ...central, fin]);
}

module.exports = { creerZip };

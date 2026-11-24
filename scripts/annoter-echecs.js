'use strict';
// CI : transforme chaque test en échec (sortie TAP de node --test) en annotation GitHub.
// Les annotations se lisent sans être administrateur du dépôt, contrairement au journal
// complet de la CI : sans elles, un échec sous Windows n'affiche que « exit code 1 ».
//
// Usage : node scripts/annoter-echecs.js tap.txt
const fs = require('node:fs');

const lignes = fs.readFileSync(process.argv[2], 'utf8').split(/\r?\n/);
const echapper = (s) => s.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
let n = 0;
for (let i = 0; i < lignes.length; i++) {
  const m = /^(\s*)not ok \d+ - (.*)$/.exec(lignes[i]);
  if (!m) continue;
  // Le détail suit, en YAML, jusqu'à la ligne « ... » de même retrait.
  const detail = [];
  for (let j = i + 1; j < lignes.length && lignes[j].trim() !== '...'; j++) detail.push(lignes[j].trim());
  // Un sous-test en échec fait aussi échouer son parent : on ne garde que les feuilles.
  if (detail.some((l) => /failureType: 'subtestsFailed'/.test(l))) continue;
  const texte = detail
    .filter((l) => !/^(---|duration_ms|type:|location:)/.test(l))
    .join('\n')
    .slice(0, 1500);
  console.log(`::error title=Test en échec : ${echapper(m[2]).replace(/[:,]/g, ' ')}::${echapper(texte)}`);
  n++;
}
console.log(`${n} test(s) en échec annoté(s)`);

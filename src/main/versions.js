'use strict';
// « v0.3.1 », « 1.2 », « build-45 », « 0.4.0-beta » : on garde le premier groupe de chiffres.
//
// Écart déclaré avec RiftLauncher.ps1 : PowerShell comparait des [version], où un
// composant absent vaut -1, si bien que « 0.3 » installée passait pour plus ancienne
// que « v0.3.0 » publiée et affichait une mise à jour fantôme. Ici un composant
// absent vaut 0 : « 0.3 » et « 0.3.0 » sont la même version.
function analyserVersion(texte) {
  const m = /\d+(\.\d+){0,3}/.exec(String(texte ?? ''));
  if (!m) return [0, 0, 0, 0];
  const parties = m[0].split('.').map((n) => Number.parseInt(n, 10));
  while (parties.length < 4) parties.push(0);
  return parties;
}

function comparerVersions(a, b) {
  const va = analyserVersion(a);
  const vb = analyserVersion(b);
  for (let i = 0; i < 4; i++) {
    if (va[i] !== vb[i]) return va[i] < vb[i] ? -1 : 1;
  }
  return 0;
}

function depotDe(url) {
  const m = /^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(\.git)?(\/.*)?$/.exec(String(url ?? ''));
  return m ? `${m[1]}/${m[2]}` : null;
}

module.exports = { analyserVersion, comparerVersions, depotDe };

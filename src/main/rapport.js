'use strict';
// Rapport de bug : « Rift Launcher - rapport <date>.zip » sur le Bureau, avec les
// journaux, la liste des jeux, les réglages (sans la clé SteamGridDB) et des infos
// système. Ni les jeux ni les sauvegardes n'y entrent.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { licenceDe, estFichier, estDossier } = require('./licences');
const { chargerReglages, lirePrefs } = require('./reglages');
const { horodatage } = require('./sauvegardes');
const { creerZip } = require('./zip');

function nomDuSysteme() {
  if (process.platform === 'linux') {
    try {
      const m = /^PRETTY_NAME="?([^"\n]+)"?/m.exec(fs.readFileSync('/etc/os-release', 'utf8'));
      if (m) return `${m[1]} (noyau ${os.release()})`;
    } catch {
      // pas de /etc/os-release
    }
  }
  return `${os.type()} ${os.release()}`;
}

function compterFichiers(dossier) {
  try {
    return fs.readdirSync(dossier, { recursive: true, withFileTypes: true }).filter((e) => e.isFile()).length;
  } catch {
    return 0;
  }
}

function creerRapport(etat, { bureau, infosPlateforme = {} }) {
  const { dossiers } = etat;
  const entrees = [];
  const ajouter = (nom, fichier) => {
    try {
      entrees.push({ nom, donnees: fs.readFileSync(fichier) });
    } catch {
      // fichier disparu entre-temps
    }
  };
  for (const f of fs
    .readdirSync(dossiers.journaux)
    .filter((f) => /^rift-.*\.log$/.test(f))
    .sort()
    .reverse()
    .slice(0, 5)) {
    ajouter(f, path.join(dossiers.journaux, f));
  }
  for (const f of fs.existsSync(dossiers.journauxJeux) ? fs.readdirSync(dossiers.journauxJeux) : []) {
    ajouter(`jeux/${f}`, path.join(dossiers.journauxJeux, f));
  }
  if (fs.existsSync(dossiers.bibliotheque)) ajouter('library.json', dossiers.bibliotheque);

  const etatChemin = (p, test) => {
    if (!p) return 'non regle';
    return test(p) ? 'OK' : 'INTROUVABLE';
  };
  const prefs = lirePrefs(dossiers.reglages);
  const lignes = [
    'RAPPORT RIFT LAUNCHER',
    `Date            : ${new Date().toISOString()}`,
    `Version         : ${etat.version}`,
    `Systeme         : ${nomDuSysteme()}`,
    ...Object.entries(infosPlateforme).map(([k, v]) => `${k.padEnd(16)}: ${v}`),
    `Dossier donnees : ${dossiers.donnees}`,
    `Reglages        : ${Object.entries(prefs)
      .map(([k, v]) => `${k}=${v}`)
      .join(', ')}`,
    `Cle SteamGridDB : ${chargerReglages(dossiers.reglages).sgdbKey ? 'oui (non incluse)' : 'non'}`,
    '',
    `JEUX (${etat.jeux.length})`,
    ...etat.jeux.map(
      (j) =>
        `- ${j.name} | licence : ${licenceDe(j)?.key ?? 'aucune'} | exe : ${etatChemin(j.exePath, estFichier)} | saves : ${etatChemin(j.saveDir, estDossier)} | mods : ${etatChemin(j.modsDir, estDossier)} | sessions : ${j.sessions}`,
    ),
    '',
    `SONS PERSO : ${compterFichiers(dossiers.sons)} fichier(s)`,
    `JAQUETTES PERSO : ${compterFichiers(dossiers.jaquettes)} fichier(s)`,
  ];
  entrees.push({ nom: 'infos.txt', donnees: Buffer.from(lignes.join(os.EOL)) });

  fs.mkdirSync(bureau, { recursive: true });
  const zip = path.join(bureau, `Rift Launcher - rapport ${horodatage()}.zip`);
  fs.writeFileSync(zip, creerZip(entrees));
  etat.journal('INFO', `Rapport cree : ${zip}`);
  return zip;
}

module.exports = { creerRapport, nomDuSysteme };

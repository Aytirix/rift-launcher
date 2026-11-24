'use strict';
// Journal : un fichier par jour dans <données>/logs, les 10 derniers sont gardés.
// Le niveau DEBUG n'est écrit que si « Journal détaillé » est activé dans les réglages.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const JOURS_GARDES = 10;

const deux = (n) => String(n).padStart(2, '0');

function jourDe(d) {
  return `${d.getFullYear()}-${deux(d.getMonth() + 1)}-${deux(d.getDate())}`;
}

function creerJournal(dossier) {
  let detaille = false;

  function ecrire(niveau, message) {
    if (niveau === 'DEBUG' && !detaille) return;
    try {
      const d = new Date();
      const heure = `${deux(d.getHours())}:${deux(d.getMinutes())}:${deux(d.getSeconds())}.${String(d.getMilliseconds()).padStart(3, '0')}`;
      const ligne = `[${jourDe(d)} ${heure}] [${niveau.padEnd(5)}] ${message}${os.EOL}`;
      fs.appendFileSync(path.join(dossier, `rift-${jourDe(d)}.log`), ligne);
    } catch {
      // Un journal qui ne peut pas s'écrire ne doit jamais arrêter le launcher.
    }
  }

  ecrire.erreur = (ou, err) => {
    const detail = err?.stack ? err.stack.replace(/\r?\n\s*/g, ' <- ') : String(err);
    ecrire('ERROR', `${ou} : ${detail}`);
  };
  ecrire.detaille = (actif) => {
    detaille = Boolean(actif);
  };
  ecrire.tourner = () => {
    try {
      const anciens = fs
        .readdirSync(dossier)
        .filter((f) => /^rift-.*\.log$/.test(f))
        .sort()
        .reverse()
        .slice(JOURS_GARDES);
      for (const f of anciens) fs.rmSync(path.join(dossier, f), { force: true });
    } catch {
      // idem : on ne bloque pas le démarrage pour un vieux journal.
    }
  };
  return ecrire;
}

module.exports = { creerJournal, jourDe, deux };

'use strict';
// Linux : boutons Home et capture des manettes, même quand le jeu est au premier plan.
// Lecture directe des événements du noyau (/dev/input/by-id/*-event-joystick), sans
// module natif. La lecture est partagée : le jeu continue de recevoir la manette.
//
// La session graphique donne à l'utilisateur connecté l'accès aux manettes
// (règle « uaccess » de systemd) : aucune permission à régler dans le cas courant.
const fs = require('node:fs');
const path = require('node:path');

const EV_KEY = 1;
const TAILLE_EVENEMENT = 24; // struct input_event en 64 bits : timeval (16) + type, code (2 + 2) + valeur (4)
const BTN_MODE = 0x13c; // bouton Xbox / PS / Home, sur xpad, hid-playstation, hid-nintendo
// Bouton capture : Partager de la manette Xbox Series (xpad : KEY_RECORD) et
// Capture de la Manette Pro Switch (hid-nintendo : BTN_Z). Le Share / Create des
// manettes PlayStation sort en BTN_SELECT, que les jeux utilisent : on n'y touche pas.
const BOUTONS_CAPTURE = new Set([167, 0x135]);

const DOSSIER = '/dev/input/by-id';

// Découpe un bloc lu en événements « bouton enfoncé ».
function boutonsEnfonces(tampon) {
  const appuis = [];
  for (let i = 0; i + TAILLE_EVENEMENT <= tampon.length; i += TAILLE_EVENEMENT) {
    const type = tampon.readUInt16LE(i + 16);
    const code = tampon.readUInt16LE(i + 18);
    const valeur = tampon.readInt32LE(i + 20);
    if (type !== EV_KEY || valeur !== 1) continue;
    if (code === BTN_MODE) appuis.push('home');
    else if (BOUTONS_CAPTURE.has(code)) appuis.push('capture');
  }
  return appuis;
}

function demarrerManettesLinux({ journal, surAppui }) {
  const ouvertes = new Map(); // chemin -> descripteur
  const refusees = new Set();
  const tampon = Buffer.alloc(TAILLE_EVENEMENT * 64);

  function chercher() {
    let noms = [];
    try {
      noms = fs.readdirSync(DOSSIER).filter((n) => n.endsWith('-event-joystick'));
    } catch {
      return; // aucune manette branchée
    }
    for (const nom of noms) {
      const chemin = path.join(DOSSIER, nom);
      if (ouvertes.has(chemin) || refusees.has(chemin)) continue;
      try {
        const fd = fs.openSync(chemin, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK);
        ouvertes.set(chemin, fd);
        journal('INFO', `[manette] suivie pour Home et capture : ${nom}`);
      } catch (err) {
        refusees.add(chemin);
        journal(
          'WARN',
          `[manette] lecture impossible (${err.code}) : ${nom}. Le bouton Home ne marchera qu'avec Rift Launcher au premier plan.`,
        );
      }
    }
  }

  function lire() {
    for (const [chemin, fd] of ouvertes) {
      for (;;) {
        let n;
        try {
          n = fs.readSync(fd, tampon, 0, tampon.length, null);
        } catch (err) {
          if (err.code === 'EAGAIN' || err.code === 'EWOULDBLOCK') break;
          // Manette débranchée : on la reprendra si elle revient.
          try {
            fs.closeSync(fd);
          } catch {
            // déjà fermée
          }
          ouvertes.delete(chemin);
          journal('INFO', `[manette] deconnectee : ${path.basename(chemin)}`);
          break;
        }
        if (!n) break;
        for (const appui of boutonsEnfonces(tampon.subarray(0, n))) surAppui(appui);
      }
    }
  }

  chercher();
  const lecture = setInterval(lire, 25);
  const recherche = setInterval(chercher, 3000);
  return () => {
    clearInterval(lecture);
    clearInterval(recherche);
    for (const fd of ouvertes.values()) {
      try {
        fs.closeSync(fd);
      } catch {
        // déjà fermée
      }
    }
    ouvertes.clear();
  };
}

module.exports = { demarrerManettesLinux, boutonsEnfonces, BTN_MODE };

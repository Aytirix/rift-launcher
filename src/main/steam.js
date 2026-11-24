'use strict';
// « Ajouter à Steam » : un raccourci non-Steam qui lance le jeu PAR Rift Launcher
// (--jouer=<id>), pour jouer depuis le Big Picture de Steam ou un Steam Deck tout en
// gardant temps de jeu et statut Discord. Les raccourcis sont dans
// userdata/<compte>/config/shortcuts.vdf, au format VDF binaire de Valve.
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { estFichier } = require('./licences');
const { resoudreJaquette } = require('./licences');

// ---------------------------------------------------------------- VDF binaire
// 0x00 : table, 0x01 : texte, 0x02 : entier 32 bits, 0x07 : entier 64 bits, 0x08 : fin.
function lireVdf(tampon) {
  let p = 0;
  const lireTexte = () => {
    const fin = tampon.indexOf(0, p);
    if (fin < 0) throw new Error('fichier VDF tronqué');
    const t = tampon.toString('utf8', p, fin);
    p = fin + 1;
    return t;
  };
  const lireTable = () => {
    const table = {};
    for (;;) {
      if (p >= tampon.length) throw new Error('fichier VDF tronqué');
      const type = tampon[p++];
      if (type === 0x08) return table;
      const cle = lireTexte();
      if (type === 0x00) table[cle] = lireTable();
      else if (type === 0x01) table[cle] = lireTexte();
      else if (type === 0x02) {
        table[cle] = tampon.readInt32LE(p);
        p += 4;
      } else if (type === 0x07) {
        table[cle] = tampon.readBigUInt64LE(p);
        p += 8;
      } else throw new Error(`type VDF inconnu : ${type}`);
    }
  };
  return lireTable();
}

function ecrireVdf(table) {
  const morceaux = [];
  const texte = (t) => morceaux.push(Buffer.from(`${t}\0`, 'utf8'));
  const ecrireTable = (t) => {
    for (const [cle, valeur] of Object.entries(t)) {
      if (typeof valeur === 'object' && valeur !== null) {
        morceaux.push(Buffer.from([0x00]));
        texte(cle);
        ecrireTable(valeur);
      } else if (typeof valeur === 'number') {
        const b = Buffer.alloc(4);
        b.writeInt32LE(valeur | 0);
        morceaux.push(Buffer.from([0x02]));
        texte(cle);
        morceaux.push(b);
      } else if (typeof valeur === 'bigint') {
        const b = Buffer.alloc(8);
        b.writeBigUInt64LE(valeur);
        morceaux.push(Buffer.from([0x07]));
        texte(cle);
        morceaux.push(b);
      } else {
        morceaux.push(Buffer.from([0x01]));
        texte(cle);
        texte(String(valeur ?? ''));
      }
    }
    morceaux.push(Buffer.from([0x08]));
  };
  ecrireTable(table);
  return Buffer.concat(morceaux);
}

// ---------------------------------------------------------------- où est Steam
function racinesSteam(plateforme) {
  if (plateforme === 'win32') {
    const racines = [];
    try {
      const sortie = execFileSync('reg', ['query', 'HKCU\\Software\\Valve\\Steam', '/v', 'SteamPath'], { encoding: 'utf8' });
      const m = /SteamPath\s+REG_SZ\s+(.+)/.exec(sortie);
      if (m) racines.push(m[1].trim().replace(/\//g, '\\'));
    } catch {
      // pas de clé : Steam absent ou installé ailleurs
    }
    racines.push('C:\\Program Files (x86)\\Steam');
    return racines;
  }
  const maison = os.homedir();
  return ['.steam/steam', '.local/share/Steam', '.var/app/com.valvesoftware.Steam/.local/share/Steam'].map((r) => path.join(maison, r));
}

// Le compte Steam utilisé en dernier : celui dont la configuration a bougé en dernier.
function compteSteam(racines) {
  let meilleur = null;
  const vus = new Set();
  for (const racine of racines) {
    const userdata = path.join(racine, 'userdata');
    let comptes = [];
    try {
      comptes = fs.readdirSync(userdata).filter((n) => /^\d+$/.test(n) && n !== '0');
    } catch {
      continue;
    }
    for (const compte of comptes) {
      const config = path.join(userdata, compte, 'config');
      let reel = config;
      try {
        reel = fs.realpathSync(config);
      } catch {
        continue;
      }
      if (vus.has(reel)) continue;
      vus.add(reel);
      let date = 0;
      try {
        date = fs.statSync(path.join(config, 'localconfig.vdf')).mtimeMs;
      } catch {
        // compte jamais utilisé sur ce poste
      }
      if (!meilleur || date > meilleur.date) meilleur = { config, date };
    }
  }
  return meilleur?.config ?? null;
}

function steamEnCours(plateforme) {
  try {
    if (plateforme === 'win32') {
      return /steam\.exe/i.test(execFileSync('tasklist', ['/FI', 'IMAGENAME eq steam.exe', '/NH'], { encoding: 'utf8' }));
    }
    execFileSync('pgrep', ['-x', 'steam']);
    return true;
  } catch {
    return false;
  }
}

// Identifiant d'un raccourci non-Steam : celui que Steam calcule lui-même, ce qui
// lui fait retrouver l'affiche copiée dans grid/<id>p.png.
function idRaccourci(exe, nom) {
  return (zlib.crc32(Buffer.from(exe + nom, 'utf8')) | 0x80000000) >>> 0;
}

// lanceur : { exe, args } = la commande qui ouvre Rift Launcher.
function ajouterASteam(etat, id, { lanceur, racines = racinesSteam(etat.plateforme), enCours = () => steamEnCours(etat.plateforme) }) {
  const jeu = etat.jeux.find((j) => j.id === id);
  if (!jeu) return { error: 'Jeu introuvable.' };
  const config = compteSteam(racines);
  if (!config) return { error: "Steam n'est pas installé, ou ne s'est jamais ouvert sur ce compte." };
  // Steam réécrit ses raccourcis en quittant : ouvert, il effacerait celui-ci.
  if (enCours())
    return { error: 'Ferme Steam complètement (menu Steam → Quitter), puis recommence : sinon il effacerait le raccourci en se fermant.' };
  const fichier = path.join(config, 'shortcuts.vdf');
  let racine = { shortcuts: {} };
  if (fs.existsSync(fichier)) {
    try {
      racine = lireVdf(fs.readFileSync(fichier));
    } catch (err) {
      return { error: `Les raccourcis Steam sont illisibles (${err.message}) : je n'y touche pas.` };
    }
    // Une copie de l'original, une seule fois, avant la toute première modification.
    const copie = `${fichier}.avant-rift-launcher`;
    if (!fs.existsSync(copie)) fs.copyFileSync(fichier, copie);
  }
  const raccourcis = racine.shortcuts ?? {};
  const exe = `"${lanceur.exe}"`;
  const options = `${lanceur.args ? `${lanceur.args} ` : ''}--jouer=${id}`;
  const appid = idRaccourci(exe, jeu.name);
  const entree = {
    appid: appid | 0,
    AppName: jeu.name,
    Exe: exe,
    StartDir: `"${path.dirname(lanceur.exe)}"`,
    icon: '',
    ShortcutPath: '',
    LaunchOptions: options,
    IsHidden: 0,
    AllowDesktopConfig: 1,
    AllowOverlay: 1,
    OpenVR: 0,
    Devkit: 0,
    DevkitGameID: '',
    DevkitOverrideAppID: 0,
    LastPlayTime: 0,
    FlatpakAppID: '',
    tags: { 0: 'Rift Launcher' },
  };
  // Déjà ajouté (même jeu) : on met à jour le raccourci au lieu d'en créer un second.
  const existante = Object.keys(raccourcis).find((k) => String(raccourcis[k]?.LaunchOptions ?? '').includes(`--jouer=${id}`));
  const cle = existante ?? String(Object.keys(raccourcis).length);
  raccourcis[cle] = entree;
  racine.shortcuts = raccourcis;
  fs.writeFileSync(`${fichier}.tmp`, ecrireVdf(racine));
  fs.renameSync(`${fichier}.tmp`, fichier);
  // Affiche portrait (capsule de bibliothèque) depuis la jaquette du jeu.
  const jaquette = resoudreJaquette(etat.dossiers, jeu);
  const ext = jaquette ? path.extname(jaquette.path).toLowerCase() : '';
  if (jaquette && ['.png', '.jpg', '.jpeg'].includes(ext) && estFichier(jaquette.path)) {
    const grille = path.join(config, 'grid');
    fs.mkdirSync(grille, { recursive: true });
    fs.copyFileSync(jaquette.path, path.join(grille, `${appid}p${ext === '.jpeg' ? '.jpg' : ext}`));
  }
  etat.journal('INFO', `Raccourci Steam ${existante ? 'mis a jour' : 'ajoute'} : ${jeu.name} (${fichier})`);
  return { ok: true, updated: Boolean(existante) };
}

module.exports = { lireVdf, ecrireVdf, idRaccourci, compteSteam, ajouterASteam };

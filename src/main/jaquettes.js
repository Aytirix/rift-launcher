'use strict';
// Jaquettes et sons choisis pour un jeu, et recherche en ligne sur SteamGridDB
// (base communautaire de jaquettes, clé API gratuite sur steamgriddb.com).
const fs = require('node:fs');
const path = require('node:path');
const { EXT_IMAGES } = require('./licences');
const { chargerReglages } = require('./reglages');

const Mo = 1024 * 1024;

function retirerFichiersDuJeu(dossier, id) {
  try {
    for (const f of fs.readdirSync(dossier)) if (path.parse(f).name === id) fs.rmSync(path.join(dossier, f), { force: true });
  } catch {
    // dossier absent : rien à retirer
  }
}

// Dimensions d'une image sans bibliothèque : PNG, JPEG, GIF et WebP.
function dimensionsImage(tampon) {
  const b = tampon;
  if (b.length > 24 && b.readUInt32BE(0) === 0x89504e47) return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
  if (b.length > 10 && b.toString('ascii', 0, 3) === 'GIF') return { w: b.readUInt16LE(6), h: b.readUInt16LE(8) };
  if (b.length > 30 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') {
    const format = b.toString('ascii', 12, 16);
    if (format === 'VP8 ') return { w: b.readUInt16LE(26) & 0x3fff, h: b.readUInt16LE(28) & 0x3fff };
    if (format === 'VP8L') {
      const v = b.readUInt32LE(21);
      return { w: (v & 0x3fff) + 1, h: ((v >> 14) & 0x3fff) + 1 };
    }
    if (format === 'VP8X') return { w: b.readUIntLE(24, 3) + 1, h: b.readUIntLE(27, 3) + 1 };
  }
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) return null;
      const marqueur = b[i + 1];
      const longueur = b.readUInt16BE(i + 2);
      // SOF0..SOF15 sauf DHT (C4), JPG (C8) et DAC (CC)
      if (marqueur >= 0xc0 && marqueur <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marqueur)) {
        return { w: b.readUInt16BE(i + 7), h: b.readUInt16BE(i + 5) };
      }
      i += 2 + longueur;
    }
  }
  return null;
}

function avertissementImage(fichier) {
  try {
    const dim = dimensionsImage(fs.readFileSync(fichier));
    if (!dim?.w || !dim.h) return '';
    if (Math.abs(dim.w / dim.h - 2 / 3) > 0.06) {
      return `Ton image fait ${dim.w} x ${dim.h} : elle n'est pas au format portrait 2:3, elle sera recadrée au centre.`;
    }
    if (dim.w < 400) return `Ton image fait ${dim.w} x ${dim.h} : elle risque d'être floue (conseillé : 600 x 900).`;
  } catch {
    // image illisible : pas d'avertissement plutôt qu'un faux
  }
  return '';
}

function copierPourLeJeu(etat, id, source, sousDossier) {
  const dossier = path.join(etat.dossiers[sousDossier], 'jeux');
  retirerFichiersDuJeu(dossier, id);
  const dest = path.join(dossier, id + path.extname(source).toLowerCase());
  fs.copyFileSync(source, dest);
  return dest;
}

async function choisirJaquette(etat, id, enregistrer) {
  const jeu = etat.jeux.find((j) => j.id === id);
  if (!jeu) return { error: 'Jeu introuvable.' };
  const fichier = await etat.systeme.choisirFichier({
    titre: 'Choisir une jaquette (portrait 600 x 900 conseillé)',
    filtres: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif'] }],
  });
  if (!fichier) return { ok: false };
  if (fs.statSync(fichier).size > 10 * Mo) return { error: "L'image dépasse 10 Mo." };
  jeu.cover = copierPourLeJeu(etat, id, fichier, 'jaquettes');
  jeu.coverRemote = '';
  enregistrer();
  return { ok: true, warning: avertissementImage(jeu.cover) };
}

async function choisirSon(etat, id, enregistrer) {
  const jeu = etat.jeux.find((j) => j.id === id);
  if (!jeu) return { error: 'Jeu introuvable.' };
  const fichier = await etat.systeme.choisirFichier({
    titre: 'Choisir un son (1 à 3 secondes conseillé)',
    filtres: [{ name: 'Sons', extensions: ['mp3', 'wav', 'ogg', 'm4a'] }],
  });
  if (!fichier) return { ok: false };
  if (fs.statSync(fichier).size > 2 * Mo) return { error: 'Le son dépasse 2 Mo : prends un extrait plus court.' };
  jeu.sound = copierPourLeJeu(etat, id, fichier, 'sons');
  enregistrer();
  return { ok: true };
}

function effacer(etat, id, type, enregistrer) {
  const jeu = etat.jeux.find((j) => j.id === id);
  if (!jeu) return { error: 'Jeu introuvable.' };
  if (type === 'sound') {
    retirerFichiersDuJeu(path.join(etat.dossiers.sons, 'jeux'), id);
    jeu.sound = '';
  } else {
    retirerFichiersDuJeu(path.join(etat.dossiers.jaquettes, 'jeux'), id);
    jeu.cover = '';
    jeu.coverRemote = '';
  }
  enregistrer();
  return { ok: true };
}

class ErreurCle extends Error {}

async function steamGridDb(etat, chemin) {
  const cle = String(chargerReglages(etat.dossiers.reglages).sgdbKey ?? '');
  if (!cle) throw new ErreurCle('NOKEY');
  const chercher = etat.systeme.fetch ?? globalThis.fetch;
  let reponse;
  try {
    reponse = await chercher(`https://www.steamgriddb.com/api/v2${chemin}`, {
      headers: { Authorization: `Bearer ${cle}` },
      signal: AbortSignal.timeout(20000),
    });
  } catch (err) {
    throw new Error(`Recherche impossible : ${err.message}`);
  }
  if (reponse.status === 401 || reponse.status === 403) throw new ErreurCle('BADKEY');
  if (!reponse.ok) throw new Error(`Recherche impossible : SteamGridDB a répondu ${reponse.status}`);
  const corps = await reponse.json();
  return [].concat(corps?.data ?? corps ?? []);
}

async function chercherJaquettes(etat, terme, idSgdb) {
  try {
    let jeux = [];
    if (terme) {
      jeux = (await steamGridDb(etat, `/search/autocomplete/${encodeURIComponent(terme)}`))
        .slice(0, 8)
        .map((j) => ({ id: String(j.id), name: String(j.name) }));
    }
    let id = idSgdb;
    if (!id && jeux.length) id = jeux[0].id;
    let grids = [];
    if (id) {
      grids = (await steamGridDb(etat, `/grids/game/${encodeURIComponent(id)}?dimensions=600x900,1200x1800&types=static`))
        .slice(0, 36)
        .map((g) => ({ thumb: String(g.thumb), url: String(g.url) }));
    }
    return { games: jeux, gameId: String(id ?? ''), grids };
  } catch (err) {
    if (err.message === 'NOKEY') return { error: 'NOKEY' };
    if (err.message === 'BADKEY') {
      etat.journal('WARN', 'SteamGridDB : cle refusee');
      return { error: 'Ta clé SteamGridDB est refusée. Vérifie-la dans les réglages.' };
    }
    etat.journal('WARN', `SteamGridDB : ${err.message}`);
    return { error: err.message };
  }
}

async function telechargerJaquette(etat, id, url, enregistrer) {
  const jeu = etat.jeux.find((j) => j.id === id);
  if (!jeu) return { error: 'Jeu introuvable.' };
  if (!/^https:\/\/[a-z0-9.-]*steamgriddb\.com\//.test(String(url))) return { error: "Adresse d'image refusée." };
  let ext = path.extname(new URL(url).pathname).toLowerCase();
  if (!EXT_IMAGES.includes(ext)) ext = '.png';
  const chercher = etat.systeme.fetch ?? globalThis.fetch;
  let donnees;
  try {
    const reponse = await chercher(url, { signal: AbortSignal.timeout(60000) });
    if (!reponse.ok) throw new Error(`le serveur a répondu ${reponse.status}`);
    donnees = Buffer.from(await reponse.arrayBuffer());
  } catch (err) {
    etat.journal.erreur(`Telechargement de jaquette ${url}`, err);
    return { error: `Téléchargement impossible : ${err.message}` };
  }
  if (donnees.length > 15 * Mo) return { error: 'Image trop lourde.' };
  etat.journal('INFO', `Jaquette en ligne choisie pour ${jeu.name} : ${url}`);
  const dossier = path.join(etat.dossiers.jaquettes, 'jeux');
  retirerFichiersDuJeu(dossier, id);
  const dest = path.join(dossier, id + ext);
  fs.writeFileSync(dest, donnees);
  jeu.cover = dest;
  jeu.coverRemote = url;
  enregistrer();
  return { ok: true };
}

module.exports = {
  dimensionsImage,
  avertissementImage,
  choisirJaquette,
  choisirSon,
  effacer,
  chercherJaquettes,
  telechargerJaquette,
};

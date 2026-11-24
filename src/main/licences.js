'use strict';
// Licences, jaquettes et sons : reconnus par mots-clés dans le nom du jeu et le
// chemin de son fichier. Repris tel quel de RiftLauncher.ps1.
const fs = require('node:fs');
const path = require('node:path');

// L'ordre compte : le plus précis d'abord (« mario kart » avant « mario »).
const LICENCES = [
  { key: 'mariokart', label: 'Mario Kart', words: ['mario kart', 'mariokart', 'spaghettikart', 'spaghetti kart', 'mk64'] },
  { key: 'drmario', label: 'Dr. Mario', words: ['dr. mario', 'dr mario', 'drmario'] },
  {
    key: 'zelda',
    label: 'Zelda',
    words: [
      'zelda',
      'hyrule',
      'ocarina',
      'majora',
      'harkinian',
      'breath of the wild',
      'botw',
      'tears of the kingdom',
      'totk',
      'totknatif',
      'twilight princess',
      'wind waker',
      'savage wind',
      'savagewind',
      'skyward sword',
    ],
  },
  { key: 'mario', label: 'Mario', words: ['mario', 'sm64', 'peach', 'luigi', 'yoshi'] },
  { key: 'splatoon', label: 'Splatoon', words: ['splatoon', 'splatpc'] },
  { key: 'metroid', label: 'Metroid', words: ['metroid', 'samus'] },
  { key: 'kirby', label: 'Kirby', words: ['kirby'] },
  { key: 'starfox', label: 'Star Fox', words: ['star fox', 'starfox', 'starship', 'sf64'] },
  { key: 'sonic', label: 'Sonic', words: ['sonic'] },
  { key: 'banjo', label: 'Banjo-Kazooie', words: ['banjo', 'kazooie', 'tooie'] },
  { key: 'perfectdark', label: 'Perfect Dark', words: ['perfect dark', 'perfectdark'] },
  { key: 'goemon', label: 'Goemon', words: ['goemon', 'mystical ninja'] },
  { key: 'donkeykong', label: 'Donkey Kong', words: ['donkey kong', 'dk64'] },
  { key: 'pokemon', label: 'Pokémon', words: ['pokemon', 'pokémon'] },
  { key: 'smash', label: 'Smash Bros.', words: ['smash'] },
  { key: 'fzero', label: 'F-Zero', words: ['f zero', 'fzero'] },
  { key: 'animalcrossing', label: 'Animal Crossing', words: ['animal crossing'] },
  { key: 'fireemblem', label: 'Fire Emblem', words: ['fire emblem'] },
  { key: 'xenoblade', label: 'Xenoblade', words: ['xenoblade'] },
];

// Les 15 jaquettes intégrées (dossier web/covers).
const JAQUETTES_INTEGREES = [
  { key: 'mk64', words: ['mario kart', 'mariokart', 'spaghettikart', 'spaghetti kart', 'mk64'] },
  { key: 'drmario', words: ['dr. mario', 'dr mario', 'drmario'] },
  { key: 'botw', words: ['breath of the wild', 'botw', 'savage wind', 'savagewind'] },
  { key: 'totk', words: ['tears of the kingdom', 'totk', 'totknatif'] },
  { key: 'oot', words: ['ocarina', 'ship of harkinian'] },
  { key: 'mm', words: ['majora', '2 ship', '2ship', 'zelda64recomp'] },
  { key: 'tp', words: ['twilight princess', 'dusk'] },
  { key: 'ww', words: ['wind waker'] },
  { key: 'sm64', words: ['mario 64', 'super mario 64', 'sm64'] },
  { key: 'sf64', words: ['star fox', 'starfox', 'starship', 'sf64'] },
  { key: 'splatoon', words: ['splatoon', 'splatpc'] },
  { key: 'sonicu', words: ['unleashed'] },
  { key: 'banjo', words: ['banjo', 'kazooie'] },
  { key: 'pd', words: ['perfect dark', 'perfectdark'] },
  { key: 'goemon', words: ['goemon', 'mystical ninja'] },
];

const EXT_IMAGES = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.svg'];
const EXT_SONS = ['.mp3', '.wav', '.ogg', '.m4a'];
const TYPES_MIME = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',
};

function slug(texte) {
  return String(texte ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Mn}/gu, '') // retire les accents
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// Nom du jeu + chemin de son fichier (noms de dossiers), en minuscules.
function botteDeFoin(jeu) {
  return ` ${jeu.name ?? ''} ${jeu.exePath ?? ''} `.toLowerCase().replace(/[_\-\\/]+/g, ' ');
}

const echapper = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function contientMot(foin, mots) {
  return mots.some((m) => new RegExp(`(^|[^a-z0-9])${echapper(m)}($|[^a-z0-9])`).test(foin));
}

function licenceDe(jeu) {
  if (jeu.franchise) {
    const connue = LICENCES.find((l) => l.key === jeu.franchise);
    return connue ?? { key: slug(jeu.franchise), label: jeu.franchise };
  }
  const foin = botteDeFoin(jeu);
  return LICENCES.find((l) => contientMot(foin, l.words)) ?? null;
}

function cleIntegree(jeu) {
  const foin = botteDeFoin(jeu);
  return JAQUETTES_INTEGREES.find((c) => contientMot(foin, c.words))?.key ?? null;
}

function nomsRecherches(jeu) {
  const licence = licenceDe(jeu);
  const noms = [slug(jeu.name), cleIntegree(jeu)];
  if (licence) noms.push(licence.key);
  return noms;
}

function fichiersDe(dossier, extensions) {
  try {
    return fs
      .readdirSync(dossier, { withFileTypes: true })
      .filter((e) => e.isFile() && extensions.includes(path.extname(e.name).toLowerCase()))
      .map((e) => e.name)
      .sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
}

// Cherche dans un dossier un fichier dont le nom correspond à l'un des noms donnés.
function trouverFichier(dossier, noms, extensions) {
  const fichiers = fichiersDe(dossier, extensions);
  for (const nom of noms) {
    if (!nom) continue;
    const trouve = fichiers.find((f) => slug(path.parse(f).name) === nom);
    if (trouve) return path.join(dossier, trouve);
  }
  return null;
}

const estFichier = (p) => {
  try {
    return Boolean(p) && fs.statSync(p).isFile();
  } catch {
    return false;
  }
};

const estDossier = (p) => {
  try {
    return Boolean(p) && fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
};

// Ordre : image choisie pour ce jeu > dossier « jaquettes » (nom du jeu, puis licence) > jaquette intégrée.
function resoudreJaquette(dossiers, jeu) {
  if (estFichier(jeu.cover)) return { path: jeu.cover, source: 'perso' };
  const trouve = trouverFichier(dossiers.jaquettes, nomsRecherches(jeu), EXT_IMAGES);
  if (trouve) return { path: trouve, source: 'dossier' };
  const cle = cleIntegree(jeu);
  if (cle) {
    const integree = path.join(dossiers.web, 'covers', `${cle}.svg`);
    if (estFichier(integree)) return { path: integree, source: 'integree' };
  }
  return null;
}

// Sons : fichier choisi pour le jeu > sous-dossier (un son au hasard parmi ceux
// du dossier) > fichier seul (ex. sons/zelda.mp3).
function resoudreSons(dossiers, jeu) {
  if (estFichier(jeu.sound)) return { paths: [jeu.sound], source: 'perso' };
  const noms = nomsRecherches(jeu);
  let sousDossiers = [];
  try {
    sousDossiers = fs
      .readdirSync(dossiers.sons, { withFileTypes: true })
      .filter((e) => e.isDirectory() && e.name !== 'jeux')
      .map((e) => e.name)
      .sort((a, b) => a.localeCompare(b));
  } catch {
    // pas de dossier de sons : on passe aux fichiers seuls
  }
  for (const nom of noms) {
    if (!nom) continue;
    for (const d of sousDossiers) {
      if (slug(d) !== nom) continue;
      const fichiers = fichiersDe(path.join(dossiers.sons, d), EXT_SONS).map((f) => path.join(dossiers.sons, d, f));
      if (fichiers.length) return { paths: fichiers, source: 'aleatoire' };
    }
  }
  const trouve = trouverFichier(dossiers.sons, noms, EXT_SONS);
  return trouve ? { paths: [trouve], source: 'dossier' } : null;
}

function marqueVersion(fichier) {
  try {
    return String(Math.trunc(fs.statSync(fichier).mtimeMs));
  } catch {
    return '0';
  }
}

function ecrireLisezmoi(dossiers) {
  const cles = LICENCES.map((l) => `  ${l.key}   (${l.label})`).join('\n');
  const sep = path.sep;
  const aideJaquettes = `JAQUETTES DE RIFT LAUNCHER
==========================

Format conseillé : portrait 600 x 900 pixels (rapport 2:3), en JPG, PNG ou WebP.
Une image plus grande (1200 x 1800) marche aussi. Taille maximum : 10 Mo.
Une image d'un autre format sera recadrée au centre.

Comment ça marche :
- Nomme l'image comme une licence pour l'appliquer à tous ses jeux.
  Exemple : zelda.png s'affiche sur tous les jeux Zelda.
- Ou nomme-la comme le jeu pour un seul jeu.
  Exemple : zelda-tears-of-the-kingdom.jpg
- Une image choisie dans les paramètres d'un jeu passe avant ce dossier.

Noms de licences reconnus :
${cles}
`;
  const aideSons = `SONS DE RIFT LAUNCHER
=====================

Le son est joué quand tu sélectionnes un jeu et quand tu le lances.

Format conseillé : MP3, WAV ou OGG, 1 à 3 secondes, 2 Mo maximum.

Comment ça marche :
- Nomme le son comme une licence pour tous ses jeux. Exemple : zelda.mp3
- Plusieurs sons au hasard : crée un dossier au nom de la licence et mets-y
  tous les sons. Exemple : sons${sep}zelda${sep}hey.mp3, sons${sep}zelda${sep}listen.mp3...
  Un son différent est tiré au hasard à chaque fois.
- Ou nomme-le comme le jeu pour un seul jeu. Exemple : zelda-tears-of-the-kingdom.mp3
- Un son choisi dans les paramètres d'un jeu passe avant ce dossier.
- Sans fichier, Rift Launcher joue son propre petit son pour la licence.

Noms de licences reconnus :
${cles}
`;
  const lisezmoiJaquettes = path.join(dossiers.jaquettes, 'LISEZMOI.txt');
  if (!fs.existsSync(lisezmoiJaquettes)) fs.writeFileSync(lisezmoiJaquettes, aideJaquettes);
  fs.writeFileSync(path.join(dossiers.sons, 'LISEZMOI.txt'), aideSons); // toujours à jour
}

module.exports = {
  LICENCES,
  EXT_IMAGES,
  EXT_SONS,
  TYPES_MIME,
  slug,
  licenceDe,
  cleIntegree,
  resoudreJaquette,
  resoudreSons,
  marqueVersion,
  ecrireLisezmoi,
  estFichier,
  estDossier,
};

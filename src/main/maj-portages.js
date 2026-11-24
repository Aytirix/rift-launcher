'use strict';
// Mise à jour automatique d'un portage (recomp) depuis sa release GitHub :
// choisir le bon fichier, le télécharger, le vérifier et l'installer à la place de
// la version du joueur, SANS jamais rien perdre :
//   - les sauvegardes du jeu sont copiées d'abord (si leur dossier est réglé) ;
//   - l'ancienne version est déplacée dans <données>/anciennes-versions, pas supprimée ;
//   - une archive est copiée PAR-DESSUS le dossier du jeu : ce qu'elle ne contient pas
//     (configuration, mods, sauvegardes rangées à côté du jeu) reste en place ;
//   - si l'archive ne contient pas le programme du jeu, rien n'est touché.
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { estFichier, estDossier } = require('./licences');
const { nomDeFichierSur } = require('./lancement');
const { sauvegarder } = require('./sauvegardes');

const VERSIONS_GARDEES = 2;
// Dans chaque ancienne version : comment la remettre (type, programme, version).
const FICHE = '.rift-version.json';

// ---------------------------------------------------------------- choix du fichier
const EXCLUS = /(mac|macos|osx|darwin|\.dmg$|flatpak|source|\.sha256$|\.sig$|\.asc$|debug|symbols|\.pdb$|\.blockmap$|\.ya?ml$)/;
const ARM = /(arm64|aarch64|armv7|armhf|\barm\b)/;
const MOT_WINDOWS = /(windows|win64|win32|\bwin\b|-win\b|_win\b)/;
const MOT_LINUX = /(linux|appimage)/;

function typeDeFichier(nom) {
  const n = nom.toLowerCase();
  if (n.endsWith('.appimage')) return 'appimage';
  if (n.endsWith('.zip')) return 'zip';
  if (n.endsWith('.tar.gz') || n.endsWith('.tgz')) return 'targz';
  return null;
}

// Renvoie { fichier } ou { raison } : jamais de choix au hasard entre deux candidats.
function choisirFichier(fichiers, { plateforme, arch, exePath }) {
  const actuel = path.basename(String(exePath ?? '')).toLowerCase();
  const veutAppImage = actuel.endsWith('.appimage');
  const veutPgo = actuel.includes('pgo');
  // Un jeu Windows lancé sous Linux par Wine ou Proton se met à jour avec le fichier Windows.
  const windowsVoulu = plateforme === 'win32' || /\.(exe|bat|cmd)$/.test(actuel);
  const candidats = [];
  for (const f of fichiers ?? []) {
    const n = String(f.name ?? '').toLowerCase();
    const type = typeDeFichier(n);
    if (!type || EXCLUS.test(n)) continue;
    if (ARM.test(n) !== (arch === 'arm64')) continue;
    const windows = MOT_WINDOWS.test(n);
    const linux = MOT_LINUX.test(n);
    if (windowsVoulu && (linux || type === 'appimage' || type === 'targz')) continue;
    if (!windowsVoulu && windows) continue;
    let score = windows || linux ? 10 : 0; // le système est écrit dans le nom
    if (!windowsVoulu) score += (type === 'appimage') === veutAppImage ? 5 : 0;
    score += n.includes('pgo') === veutPgo ? 2 : 0;
    candidats.push({ fichier: f, type, score });
  }
  if (!candidats.length) return { raison: 'Aucun fichier de cette version ne correspond à ton système.' };
  candidats.sort((a, b) => b.score - a.score);
  if (candidats.length > 1 && candidats[0].score === candidats[1].score) {
    return { raison: `Plusieurs fichiers possibles (${candidats[0].fichier.name}, ${candidats[1].fichier.name}) : choisis toi-même.` };
  }
  return { fichier: candidats[0].fichier, type: candidats[0].type };
}

// ---------------------------------------------------------------- archives
function cheminSur(racine, nom) {
  const relatif = nom.replace(/\\/g, '/');
  if (relatif.startsWith('/') || /^[a-zA-Z]:/.test(relatif) || relatif.split('/').includes('..')) {
    throw new Error(`Archive refusée : chemin dangereux « ${nom} ».`);
  }
  return path.join(racine, ...relatif.split('/').filter(Boolean));
}

function extraireZip(tampon, dest) {
  let fin = -1;
  for (let i = tampon.length - 22; i >= Math.max(0, tampon.length - 65557); i--) {
    if (tampon.readUInt32LE(i) === 0x06054b50) {
      fin = i;
      break;
    }
  }
  if (fin < 0) throw new Error('Archive .zip illisible.');
  const nombre = tampon.readUInt16LE(fin + 10);
  let p = tampon.readUInt32LE(fin + 16);
  if (p === 0xffffffff || nombre === 0xffff) throw new Error('Archive .zip trop grande (zip64), non gérée.');
  for (let i = 0; i < nombre; i++) {
    if (tampon.readUInt32LE(p) !== 0x02014b50) throw new Error('Archive .zip abîmée.');
    const creePar = tampon.readUInt16LE(p + 4) >> 8;
    const methode = tampon.readUInt16LE(p + 10);
    const tailleComp = tampon.readUInt32LE(p + 20);
    const longNom = tampon.readUInt16LE(p + 28);
    const longExtra = tampon.readUInt16LE(p + 30);
    const longCom = tampon.readUInt16LE(p + 32);
    const attributs = tampon.readUInt32LE(p + 38);
    const local = tampon.readUInt32LE(p + 42);
    const nom = tampon.toString('utf8', p + 46, p + 46 + longNom);
    p += 46 + longNom + longExtra + longCom;
    const cible = cheminSur(dest, nom);
    if (nom.endsWith('/')) {
      fs.mkdirSync(cible, { recursive: true });
      continue;
    }
    const debut = local + 30 + tampon.readUInt16LE(local + 26) + tampon.readUInt16LE(local + 28);
    const brut = tampon.subarray(debut, debut + tailleComp);
    let donnees;
    if (methode === 0) donnees = brut;
    else if (methode === 8) donnees = zlib.inflateRawSync(brut);
    else throw new Error(`Archive .zip : compression ${methode} non gérée.`);
    fs.mkdirSync(path.dirname(cible), { recursive: true });
    fs.writeFileSync(cible, donnees);
    // Droits Unix (exécutable) quand l'archive a été faite sous Linux ou macOS.
    const mode = (attributs >>> 16) & 0o777;
    if (creePar === 3 && mode) fs.chmodSync(cible, mode);
  }
}

function extraireTarGz(tampon, dest) {
  const tar = zlib.gunzipSync(tampon);
  let p = 0;
  let nomLong = null;
  const texte = (debut, longueur) => tar.toString('utf8', debut, debut + longueur).replace(/\0.*$/s, '');
  const octal = (debut, longueur) => Number.parseInt(texte(debut, longueur).trim() || '0', 8);
  while (p + 512 <= tar.length) {
    if (tar.subarray(p, p + 512).every((o) => o === 0)) break;
    const entete = p;
    const taille = octal(p + 124, 12);
    const type = String.fromCharCode(tar[p + 156] || 48);
    const prefixe = texte(p + 345, 155);
    let nom = nomLong ?? (prefixe ? `${prefixe}/${texte(p, 100)}` : texte(p, 100));
    nomLong = null;
    const mode = octal(p + 100, 8) & 0o777;
    const contenu = tar.subarray(p + 512, p + 512 + taille);
    p += 512 + Math.ceil(taille / 512) * 512;
    if (type === 'L') {
      nomLong = contenu.toString('utf8').replace(/\0.*$/s, '');
      continue;
    }
    if (type === 'x') {
      const m = /\d+ path=([^\n]*)\n/.exec(contenu.toString('utf8'));
      if (m) nomLong = m[1];
      continue;
    }
    if (type === 'g') continue;
    nom = nom.replace(/^\.\//, '');
    if (!nom) continue;
    const cible = cheminSur(dest, nom);
    if (type === '5') {
      fs.mkdirSync(cible, { recursive: true });
    } else if (type === '0' || type === '7') {
      fs.mkdirSync(path.dirname(cible), { recursive: true });
      fs.writeFileSync(cible, contenu);
      if (mode) fs.chmodSync(cible, mode);
    } else if (type === '2') {
      // Lien symbolique : seulement vers l'intérieur de l'archive, sinon ignoré.
      const lien = texte(entete + 157, 100);
      if (!path.isAbsolute(lien) && path.resolve(path.dirname(cible), lien).startsWith(dest + path.sep)) {
        fs.mkdirSync(path.dirname(cible), { recursive: true });
        fs.rmSync(cible, { force: true });
        fs.symlinkSync(lien, cible);
      }
    }
  }
}

function extraire(type, tampon, dest) {
  if (type === 'zip') extraireZip(tampon, dest);
  else extraireTarGz(tampon, dest);
}

// Beaucoup de releases emballent deux fois (GitHub Actions) : Zelda64Recomp met un
// .tar.gz seul dans son .zip. Une archive seule dans l'archive est donc déballée à
// son tour, sur deux niveaux au plus.
function extraireTout(type, tampon, dest) {
  extraire(type, tampon, dest);
  for (let niveau = 0; niveau < 2; niveau++) {
    const contenu = fs.readdirSync(dest);
    const seul = contenu.length === 1 ? path.join(dest, contenu[0]) : null;
    const typeInterne = seul ? typeDeFichier(contenu[0]) : null;
    if (!seul || !estFichier(seul) || !typeInterne || typeInterne === 'appimage') return;
    const interne = fs.readFileSync(seul);
    fs.rmSync(seul);
    extraire(typeInterne, interne, dest);
  }
}

// ---------------------------------------------------------------- installation
// « Zelda64Recompiled-v1.2.2.AppImage » et « Zelda64Recompiled-v1.2.1.AppImage » : même programme.
const sansVersion = (nom) =>
  nom
    .toLowerCase()
    .replace(/v?\d+([._-]\d+)*/g, '')
    .replace(/[-_. ]+/g, '');

function trouverProgramme(dossier, exePath) {
  const voulu = path.basename(exePath);
  const fichiers = fs
    .readdirSync(dossier, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile() || e.isSymbolicLink())
    .map((e) => path.join(e.parentPath ?? e.path, e.name));
  return (
    fichiers.find((f) => path.basename(f) === voulu) ??
    fichiers.find(
      (f) => path.extname(f).toLowerCase() === path.extname(voulu).toLowerCase() && sansVersion(path.basename(f)) === sansVersion(voulu),
    ) ??
    null
  );
}

function deplacer(source, cible) {
  fs.mkdirSync(path.dirname(cible), { recursive: true });
  try {
    fs.renameSync(source, cible);
  } catch (err) {
    if (err.code !== 'EXDEV') throw err;
    fs.cpSync(source, cible, { recursive: true }); // autre disque : copie puis suppression
    fs.rmSync(source, { recursive: true, force: true });
  }
}

function dossierAnciennesDu(etat, jeu) {
  return path.join(etat.dossiers.donnees, 'anciennes-versions', nomDeFichierSur(jeu.name));
}

// Range la version installée (AppImage seule, ou copie du dossier du jeu) et note
// dans sa fiche comment la remettre.
function rangerAncienneVersion(etat, jeu, type) {
  const dossier = dossierAnciennesDu(etat, jeu);
  let cible = path.join(dossier, nomDeFichierSur(jeu.version || 'inconnue'));
  for (let n = 2; fs.existsSync(cible); n++) cible = path.join(dossier, `${nomDeFichierSur(jeu.version || 'inconnue')}_${n}`);
  fs.mkdirSync(cible, { recursive: true });
  if (type === 'appimage') {
    deplacer(jeu.exePath, path.join(cible, path.basename(jeu.exePath)));
  } else {
    fs.cpSync(path.dirname(jeu.exePath), cible, { recursive: true, verbatimSymlinks: true });
  }
  const fiche = { version: jeu.version, type, exePath: jeu.exePath, date: Date.now() };
  fs.writeFileSync(path.join(cible, FICHE), JSON.stringify(fiche, null, 2));
  return { dossier, cible };
}

// Versions gardées, de la plus récente à la plus ancienne.
function anciennesVersions(etat, jeu) {
  const dossier = dossierAnciennesDu(etat, jeu);
  let noms = [];
  try {
    noms = fs.readdirSync(dossier);
  } catch {
    return [];
  }
  const liste = [];
  for (const nom of noms) {
    try {
      const fiche = JSON.parse(fs.readFileSync(path.join(dossier, nom, FICHE), 'utf8'));
      liste.push({
        key: nom,
        version: String(fiche.version ?? ''),
        type: fiche.type,
        exePath: String(fiche.exePath ?? ''),
        date: Number(fiche.date) || 0,
      });
    } catch {
      // dossier sans fiche (rangé à la main, ou d'avant les fiches) : pas proposé
    }
  }
  return liste.sort((a, b) => b.date - a.date);
}

function nettoyerAnciennesVersions(dossier) {
  const toutes = fs
    .readdirSync(dossier, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => ({ nom: e.name, date: fs.statSync(path.join(dossier, e.name)).mtimeMs }))
    .sort((a, b) => a.date - b.date);
  for (const v of toutes.slice(0, Math.max(0, toutes.length - VERSIONS_GARDEES))) {
    fs.rmSync(path.join(dossier, v.nom), { recursive: true, force: true });
  }
}

// Un jeu posé directement dans le dossier personnel, le Bureau ou les Téléchargements :
// « garder l'ancienne version » copierait tout le dossier. On refuse plutôt.
function dossierPropreAuJeu(dossier) {
  const interdits = [
    os.homedir(),
    path.parse(dossier).root,
    ...['Desktop', 'Bureau', 'Downloads', 'Téléchargements', 'Documents'].map((d) => path.join(os.homedir(), d)),
  ];
  if (interdits.some((d) => path.resolve(d) === path.resolve(dossier))) return false;
  let n = 0;
  for (const _ of fs.readdirSync(dossier, { recursive: true })) if (++n > 20000) return false;
  return true;
}

async function telecharger(etat, fichier, dest, suivre) {
  const chercher = etat.systeme.fetch ?? globalThis.fetch;
  const reponse = await chercher(fichier.url, { headers: { 'User-Agent': `RiftLauncher/${etat.version}` } });
  if (!reponse.ok) throw new Error(`GitHub a répondu ${reponse.status}`);
  const total = Number(fichier.size) || Number(reponse.headers.get('content-length')) || 0;
  const empreinte = crypto.createHash('sha256');
  const fd = fs.openSync(dest, 'w');
  let recu = 0;
  try {
    const lecteur = reponse.body.getReader();
    for (;;) {
      const { done, value } = await lecteur.read();
      if (done) break;
      fs.writeSync(fd, value);
      empreinte.update(value);
      recu += value.length;
      if (total) suivre(Math.min(99, Math.floor((recu * 100) / total)));
    }
  } finally {
    fs.closeSync(fd);
  }
  if (total && recu !== total) throw new Error(`téléchargement incomplet (${recu} octets sur ${total})`);
  const attendue = /^sha256:([0-9a-f]{64})$/i.exec(String(fichier.digest ?? ''))?.[1];
  if (attendue && empreinte.digest('hex') !== attendue.toLowerCase()) {
    throw new Error('le fichier téléchargé ne correspond pas à son empreinte SHA-256 publiée');
  }
}

async function installerPortage(etat, id, { enregistrer, arch = process.arch }) {
  const jeu = etat.jeux.find((j) => j.id === id);
  if (!jeu) return { error: 'Jeu introuvable.' };
  const info = etat.portages.get(id);
  if (!info) return { error: 'Aucune version trouvée pour ce jeu.' };
  if (etat.enCours.has(id)) return { error: 'Ferme le jeu avant de le mettre à jour.' };
  if (etat.installations.get(id)?.enCours) return { error: 'La mise à jour de ce jeu est déjà en cours.' };
  if (!estFichier(jeu.exePath)) return { error: "Règle d'abord le fichier du jeu : la mise à jour s'installe à côté de lui." };
  const choix = choisirFichier(info.assets, { plateforme: etat.plateforme, arch, exePath: jeu.exePath });
  if (!choix.fichier) return { error: choix.raison, ouvrirPage: true };
  if (choix.type !== 'appimage' && !dossierPropreAuJeu(path.dirname(jeu.exePath))) {
    return { error: 'Le jeu doit être rangé dans son propre dossier pour être mis à jour automatiquement.', ouvrirPage: true };
  }

  const suivi = { enCours: true, etape: 'telechargement', pourcentage: 0, fichier: choix.fichier.name };
  etat.installations.set(id, suivi);
  const temporaire = path.join(etat.dossiers.donnees, 'telechargements');
  const telecharge = path.join(temporaire, `${id}.part`);
  const extrait = path.join(temporaire, `${id}-extrait`);
  fs.rmSync(extrait, { recursive: true, force: true });
  fs.mkdirSync(temporaire, { recursive: true });
  const nomLog = `${jeu.name} ${jeu.version || '?'} -> ${info.latest}`;
  try {
    etat.journal('INFO', `Mise a jour du portage : ${nomLog} | ${choix.fichier.name}`);
    await telecharger(etat, choix.fichier, telecharge, (p) => {
      suivi.pourcentage = p;
    });
    suivi.etape = 'installation';
    suivi.pourcentage = 100;

    let programme;
    let sourceDossier = null;
    if (choix.type === 'appimage') {
      programme = telecharge;
    } else {
      fs.mkdirSync(extrait);
      extraireTout(choix.type, fs.readFileSync(telecharge), extrait);
      programme = trouverProgramme(extrait, jeu.exePath);
      // Rien n'a encore été touché chez le joueur : on peut renoncer sans dégât.
      if (!programme) {
        return {
          error: `L'archive ne contient pas « ${path.basename(jeu.exePath)} » : je ne sais pas l'installer toute seule. Rien n'a été modifié.`,
          ouvrirPage: true,
        };
      }
      sourceDossier = path.dirname(programme);
    }

    // Les sauvegardes d'abord : si la nouvelle version les abîme, la copie reste.
    if (estDossier(jeu.saveDir)) {
      const s = sauvegarder(etat, id);
      if (s.ok) etat.journal('INFO', `Sauvegarde avant mise a jour : ${s.path}`);
    }

    const dossierJeu = path.dirname(jeu.exePath);
    const { dossier: dossierAnciennes, cible: ancienne } = rangerAncienneVersion(
      etat,
      jeu,
      choix.type === 'appimage' ? 'appimage' : 'dossier',
    );
    if (choix.type === 'appimage') {
      const nouveau = path.join(dossierJeu, choix.fichier.name);
      deplacer(telecharge, nouveau);
      fs.chmodSync(nouveau, 0o755);
      jeu.exePath = nouveau;
    } else {
      // La version actuelle est copiée (ci-dessus), puis la nouvelle par-dessus.
      fs.cpSync(sourceDossier, dossierJeu, { recursive: true, force: true, verbatimSymlinks: true });
      const relatif = path.relative(sourceDossier, programme);
      jeu.exePath = path.join(dossierJeu, relatif);
    }
    nettoyerAnciennesVersions(dossierAnciennes);
    jeu.version = info.latest.replace(/^[vV](?=\d)/, '');
    jeu.skipVersion = '';
    enregistrer();
    etat.journal('INFO', `Portage mis a jour : ${nomLog} | ancienne version dans ${ancienne}`);
    etat.installations.delete(id);
    return { ok: true, version: jeu.version, ancienne };
  } catch (err) {
    etat.journal.erreur(`Mise a jour du portage ${nomLog}`, err);
    return { error: `Mise à jour impossible : ${err.message}`, ouvrirPage: true };
  } finally {
    etat.installations.delete(id);
    fs.rmSync(telecharge, { force: true });
    fs.rmSync(extrait, { recursive: true, force: true });
  }
}

// Remet une version gardée. La version actuelle est d'abord rangée à son tour : on
// peut revenir dans les deux sens. La version quittée n'est plus réinstallée par la
// mise à jour automatique (skipVersion), puisque le joueur vient de la refuser.
function revenirVersion(etat, id, cle, { enregistrer }) {
  const jeu = etat.jeux.find((j) => j.id === id);
  if (!jeu) return { error: 'Jeu introuvable.' };
  if (etat.enCours.has(id)) return { error: 'Ferme le jeu avant de changer de version.' };
  if (etat.installations.get(id)?.enCours) return { error: 'Une mise à jour de ce jeu est en cours.' };
  const voulue = anciennesVersions(etat, jeu).find((v) => v.key === cle);
  if (!voulue) return { error: "Cette version n'est plus gardée." };
  const source = path.join(dossierAnciennesDu(etat, jeu), voulue.key);
  if (voulue.type === 'appimage' && !estFichier(path.join(source, path.basename(voulue.exePath)))) {
    return { error: 'Le fichier de cette version a disparu.' };
  }
  if (!estFichier(jeu.exePath)) return { error: 'Le fichier du jeu actuel est introuvable : règle-le avant de changer de version.' };
  try {
    if (estDossier(jeu.saveDir)) sauvegarder(etat, id);
    const quittee = jeu.version;
    rangerAncienneVersion(etat, jeu, voulue.type === 'appimage' ? 'appimage' : 'dossier');
    if (voulue.type === 'appimage') {
      deplacer(path.join(source, path.basename(voulue.exePath)), voulue.exePath);
      fs.chmodSync(voulue.exePath, 0o755);
    } else {
      fs.cpSync(source, path.dirname(voulue.exePath), {
        recursive: true,
        force: true,
        verbatimSymlinks: true,
        filter: (f) => path.basename(f) !== FICHE,
      });
    }
    fs.rmSync(source, { recursive: true, force: true });
    jeu.exePath = voulue.exePath;
    jeu.version = voulue.version;
    jeu.skipVersion = etat.portages.get(id)?.latest ?? quittee;
    enregistrer();
    etat.journal('INFO', `Retour a la version ${voulue.version} de ${jeu.name} (quittee : ${quittee})`);
    return { ok: true, version: voulue.version };
  } catch (err) {
    etat.journal.erreur(`Retour de version de ${jeu.name}`, err);
    return { error: `Changement de version impossible : ${err.message}` };
  }
}

module.exports = {
  revenirVersion,
  anciennesVersions,
  choisirFichier,
  extraireZip,
  extraireTarGz,
  trouverProgramme,
  installerPortage,
  typeDeFichier,
};

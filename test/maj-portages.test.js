'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { choisirFichier, extraireZip, extraireTarGz, installerPortage } = require('../src/main/maj-portages');
const { creerZip } = require('../src/main/zip');
const { nouveauJeu } = require('../src/main/bibliotheque');
const { demarrerJeu } = require('../src/main/lancement');
const { creerApi } = require('../src/main/api');
const { vuePortage } = require('../src/main/portages');
const { etatDeTest, dossierTemp } = require('./aide');

const linux = process.platform !== 'win32';
const fichiers = (...noms) => noms.map((name) => ({ name }));
// Les vraies releases relevées le 24/11/2026.
const TOTK = fichiers('TotK-Setup-0.5.0-windows.zip', 'TotK-Setup-0.5.0-x86_64-pgo.AppImage', 'TotK-Setup-0.5.0-x86_64.AppImage');
const Z64 = fichiers(
  'Zelda64Recompiled-v1.2.2-Linux-ARM64.zip',
  'Zelda64Recompiled-v1.2.2-Linux-Flatpak-X64.zip',
  'Zelda64Recompiled-v1.2.2-Linux-X64.zip',
  'Zelda64Recompiled-v1.2.2-macOS.zip',
  'Zelda64Recompiled-v1.2.2-Windows.zip',
);
const SOH = fichiers('SoH-Dewey-Bravo-Mac.zip', 'SoH-Dewey-Bravo-Win64.zip', 'SoH-Dewey-Bravo.appimage');
const EGLANTINE = fichiers(
  'eglantine-linux-aarch64-pgo.AppImage',
  'eglantine-linux-aarch64.AppImage',
  'eglantine-linux-x86_64-pgo.AppImage',
  'eglantine-linux-x86_64-pgo.tar.gz',
  'eglantine-linux-x86_64.AppImage',
  'eglantine-linux-x86_64.tar.gz',
  'eglantine-macos-arm64.dmg',
  'eglantine-windows-x86_64-pgo.zip',
  'eglantine-windows-x86_64.zip',
);
const choix = (liste, plateforme, exePath, arch = 'x64') => choisirFichier(liste, { plateforme, arch, exePath }).fichier?.name;

test('le bon fichier pour chaque système, sur de vraies releases', () => {
  assert.equal(choix(TOTK, 'linux', '/j/TotK-Setup-0.4.0-x86_64.AppImage'), 'TotK-Setup-0.5.0-x86_64.AppImage');
  assert.equal(
    choix(TOTK, 'linux', '/j/TotK-Setup-0.4.0-x86_64-pgo.AppImage'),
    'TotK-Setup-0.5.0-x86_64-pgo.AppImage',
    'garde la variante pgo',
  );
  assert.equal(choix(TOTK, 'win32', 'C:\\j\\totk.exe'), 'TotK-Setup-0.5.0-windows.zip');
  assert.equal(choix(Z64, 'linux', '/j/Zelda64Recompiled'), 'Zelda64Recompiled-v1.2.2-Linux-X64.zip', 'ni ARM, ni Flatpak, ni macOS');
  assert.equal(choix(Z64, 'linux', '/j/Zelda64Recompiled', 'arm64'), 'Zelda64Recompiled-v1.2.2-Linux-ARM64.zip');
  assert.equal(choix(Z64, 'win32', 'C:\\j\\Zelda64Recompiled.exe'), 'Zelda64Recompiled-v1.2.2-Windows.zip');
  assert.equal(choix(SOH, 'linux', '/j/soh.appimage'), 'SoH-Dewey-Bravo.appimage');
  assert.equal(choix(SOH, 'win32', 'C:\\j\\soh.exe'), 'SoH-Dewey-Bravo-Win64.zip');
  assert.equal(choix(EGLANTINE, 'linux', '/j/eglantine-linux-x86_64.AppImage'), 'eglantine-linux-x86_64.AppImage');
  assert.equal(
    choix(EGLANTINE, 'linux', '/j/eglantine/eglantine'),
    'eglantine-linux-x86_64.tar.gz',
    'installé depuis l’archive : l’archive',
  );
  assert.equal(choix(EGLANTINE, 'win32', 'C:\\j\\eglantine.exe'), 'eglantine-windows-x86_64.zip');
});

test('un jeu Windows lancé sous Linux par Wine se met à jour avec le fichier Windows', () => {
  assert.equal(choix(Z64, 'linux', '/j/z64/Zelda64Recompiled.exe'), 'Zelda64Recompiled-v1.2.2-Windows.zip');
});

test('pas de choix au hasard : deux candidats égaux, ou aucun, donnent une raison', () => {
  assert.match(
    choisirFichier(fichiers('jeu-linux-a.zip', 'jeu-linux-b.zip'), { plateforme: 'linux', arch: 'x64', exePath: '/j/jeu' }).raison,
    /Plusieurs/,
  );
  assert.match(
    choisirFichier(fichiers('jeu-macos.zip', 'installer.exe'), { plateforme: 'linux', arch: 'x64', exePath: '/j/jeu' }).raison,
    /Aucun fichier/,
  );
  assert.match(choisirFichier([], { plateforme: 'win32', arch: 'x64', exePath: 'C:\\j.exe' }).raison, /Aucun fichier/);
});

// Marque l'entrée n d'un zip comme faite sous Unix avec ce mode.
function avecMode(zip, n, mode) {
  let p = zip.readUInt32LE(zip.length - 22 + 16);
  for (let i = 0; i < n; i++) p += 46 + zip.readUInt16LE(p + 28);
  zip.writeUInt16LE((3 << 8) | 20, p + 4);
  zip.writeUInt32LE(((0o100000 | mode) << 16) >>> 0, p + 38);
  return zip;
}

test('zip : extraction fidèle, droit d’exécution compris', { skip: !linux }, (t) => {
  const dest = dossierTemp(t);
  const zip = avecMode(
    creerZip([
      { nom: 'Jeu/Jeu', donnees: Buffer.from('#!/bin/sh\n') },
      { nom: 'Jeu/data/niveau.pak', donnees: Buffer.from('x'.repeat(10000)) },
    ]),
    0,
    0o755,
  );
  extraireZip(zip, dest);
  assert.equal(fs.readFileSync(path.join(dest, 'Jeu', 'data', 'niveau.pak'), 'utf8'), 'x'.repeat(10000));
  assert.equal(fs.statSync(path.join(dest, 'Jeu', 'Jeu')).mode & 0o777, 0o755);
});

test('zip : un chemin qui sort du dossier est refusé', (t) => {
  // Dossier d'extraction DANS un dossier neuf : ce qui s'en évaderait y serait vu,
  // sans dépendre de ce qui traîne dans le dossier temporaire du système.
  const dest = path.join(dossierTemp(t), 'dans');
  fs.mkdirSync(dest);
  for (const nom of ['../evade.txt', 'a/../../evade.txt', '/etc/evade', 'C:/evade']) {
    assert.throws(() => extraireZip(creerZip([{ nom, donnees: Buffer.from('x') }]), dest), /chemin dangereux/, nom);
  }
  assert.ok(!fs.existsSync(path.join(path.dirname(dest), 'evade.txt')));
});

function entreeTar(nom, contenu, { type = '0', mode = 0o644, lien = '' } = {}) {
  const h = Buffer.alloc(512);
  h.write(nom, 0, 'utf8');
  h.write(mode.toString(8).padStart(7, '0'), 100);
  h.write(contenu.length.toString(8).padStart(11, '0'), 124);
  h.write(type, 156);
  h.write(lien, 157);
  h.write('ustar', 257);
  const corps = Buffer.alloc(Math.ceil(contenu.length / 512) * 512);
  contenu.copy(corps);
  return Buffer.concat([h, corps]);
}

test('tar.gz : fichiers, droits, liens internes ; lien vers l’extérieur ignoré', { skip: !linux }, (t) => {
  const dest = dossierTemp(t);
  const tar = Buffer.concat([
    entreeTar('./eglantine/', Buffer.alloc(0), { type: '5' }),
    entreeTar('./eglantine/eglantine', Buffer.from('ELF'), { mode: 0o755 }),
    entreeTar('./eglantine/lib.so', Buffer.from('lib'), { type: '2', lien: 'eglantine' }),
    entreeTar('./eglantine/fuite', Buffer.alloc(0), { type: '2', lien: '../../etc/passwd' }),
    Buffer.alloc(1024),
  ]);
  extraireTarGz(zlib.gzipSync(tar), dest);
  assert.equal(fs.statSync(path.join(dest, 'eglantine', 'eglantine')).mode & 0o777, 0o755);
  assert.equal(fs.readlinkSync(path.join(dest, 'eglantine', 'lib.so')), 'eglantine');
  assert.ok(!fs.existsSync(path.join(dest, 'eglantine', 'fuite')));
});

// ---------------------------------------------------------------- installation complète
function fauxGitHub(contenus) {
  const appels = [];
  return {
    appels,
    fetch: async (url) => {
      appels.push(url);
      const c = contenus[url];
      if (!c) return new Response('absent', { status: 404 });
      return new Response(c, { status: 200, headers: { 'content-length': String(c.length) } });
    },
  };
}

const sha = (b) => `sha256:${crypto.createHash('sha256').update(b).digest('hex')}`;

function jeuInstalle(t, { exe, version = '1.0', assets, contenus }) {
  const gh = fauxGitHub(contenus);
  const etat = etatDeTest(t, { plateforme: 'linux', systeme: { fetch: gh.fetch, ouvrirLien: (u) => gh.appels.push(`ouvert ${u}`) } });
  const racine = dossierTemp(t);
  const dossierJeu = path.join(racine, 'MonJeu');
  const saves = path.join(racine, 'saves');
  fs.mkdirSync(dossierJeu);
  fs.mkdirSync(saves);
  fs.writeFileSync(path.join(saves, 'slot.sav'), 'progression');
  const exePath = path.join(dossierJeu, exe);
  fs.writeFileSync(exePath, 'ancienne version', { mode: 0o755 });
  etat.jeux.push(nouveauJeu({ id: 'j', name: 'Mon Jeu', exePath, saveDir: saves, version, repoUrl: 'https://github.com/a/b' }, false));
  etat.portages.set('j', { repo: 'a/b', latest: 'v1.1', url: 'https://github.com/a/b/releases/tag/v1.1', date: '', title: '', assets });
  let enregistre = 0;
  return { etat, gh, dossierJeu, exePath, enregistrer: () => enregistre++, enregistres: () => enregistre };
}

test('AppImage : la nouvelle remplace l’ancienne, gardée de côté, sauvegarde faite d’abord', { skip: !linux }, async (t) => {
  const neuve = Buffer.from('nouvelle version AppImage');
  const url = 'https://gh/Jeu-1.1-x86_64.AppImage';
  const j = jeuInstalle(t, {
    exe: 'Jeu-1.0-x86_64.AppImage',
    assets: [{ name: 'Jeu-1.1-x86_64.AppImage', url, size: neuve.length, digest: sha(neuve) }],
    contenus: { [url]: neuve },
  });
  const r = await installerPortage(j.etat, 'j', { enregistrer: j.enregistrer, arch: 'x64' });
  assert.equal(r.ok, true, JSON.stringify(r));
  const jeu = j.etat.jeux[0];
  assert.equal(jeu.version, '1.1');
  assert.equal(jeu.exePath, path.join(j.dossierJeu, 'Jeu-1.1-x86_64.AppImage'));
  assert.equal(fs.readFileSync(jeu.exePath, 'utf8'), 'nouvelle version AppImage');
  assert.equal(fs.statSync(jeu.exePath).mode & 0o111, 0o111, 'exécutable');
  assert.ok(!fs.existsSync(j.exePath), 'l’ancienne n’est plus à sa place…');
  assert.equal(fs.readFileSync(path.join(r.ancienne, 'Jeu-1.0-x86_64.AppImage'), 'utf8'), 'ancienne version', '…mais gardée');
  const copies = fs.readdirSync(path.join(j.etat.dossiers.sauvegardes, 'Mon Jeu'));
  assert.equal(copies.length, 1, 'sauvegarde des parties avant la mise à jour');
  assert.equal(j.enregistres(), 1);
  assert.equal(j.etat.installations.size, 0);
  assert.deepEqual(fs.readdirSync(path.join(j.etat.dossiers.donnees, 'telechargements')), [], 'rien ne traîne');
});

test('une empreinte SHA-256 fausse arrête tout avant de toucher au jeu', { skip: !linux }, async (t) => {
  const url = 'https://gh/Jeu-1.1-x86_64.AppImage';
  const j = jeuInstalle(t, {
    exe: 'Jeu-1.0-x86_64.AppImage',
    assets: [{ name: 'Jeu-1.1-x86_64.AppImage', url, size: 8, digest: sha(Buffer.from('autre chose')) }],
    contenus: { [url]: Buffer.from('piratée') },
  });
  const r = await installerPortage(j.etat, 'j', { enregistrer: j.enregistrer, arch: 'x64' });
  assert.match(r.error, /incomplet|empreinte/);
  assert.equal(fs.readFileSync(j.exePath, 'utf8'), 'ancienne version');
  assert.equal(j.etat.jeux[0].version, '1.0');
  assert.equal(j.enregistres(), 0);
});

test('archive : copiée par-dessus le jeu, les fichiers du joueur restent, l’ancienne version est gardée', { skip: !linux }, async (t) => {
  const zip = creerZip([
    { nom: 'MonJeu-v1.1/MonJeu', donnees: Buffer.from('nouveau programme') },
    { nom: 'MonJeu-v1.1/data.pak', donnees: Buffer.from('nouvelles données') },
  ]);
  const url = 'https://gh/monjeu-linux-x64.zip';
  const j = jeuInstalle(t, { exe: 'MonJeu', assets: [{ name: 'monjeu-linux-x64.zip', url, size: zip.length }], contenus: { [url]: zip } });
  fs.writeFileSync(path.join(j.dossierJeu, 'data.pak'), 'anciennes données');
  fs.writeFileSync(path.join(j.dossierJeu, 'config.ini'), 'mes réglages');
  const r = await installerPortage(j.etat, 'j', { enregistrer: j.enregistrer, arch: 'x64' });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(fs.readFileSync(j.exePath, 'utf8'), 'nouveau programme');
  assert.equal(fs.readFileSync(path.join(j.dossierJeu, 'data.pak'), 'utf8'), 'nouvelles données');
  assert.equal(fs.readFileSync(path.join(j.dossierJeu, 'config.ini'), 'utf8'), 'mes réglages', 'absent de l’archive : intact');
  assert.equal(fs.readFileSync(path.join(r.ancienne, 'data.pak'), 'utf8'), 'anciennes données');
  assert.equal(j.etat.jeux[0].exePath, j.exePath);
});

test('archive dans l’archive (comme Zelda64Recomp : un .tar.gz seul dans le .zip)', { skip: !linux }, async (t) => {
  const tar = Buffer.concat([
    entreeTar('MonJeu', Buffer.from('programme 1.1'), { mode: 0o755 }),
    entreeTar('assets/', Buffer.alloc(0), { type: '5' }),
    entreeTar('assets/menu.rml', Buffer.from('menu')),
    Buffer.alloc(1024),
  ]);
  const zip = creerZip([{ nom: 'MonJeu.tar.gz', donnees: zlib.gzipSync(tar) }]);
  const url = 'https://gh/MonJeu-v1.1-Linux-X64.zip';
  const j = jeuInstalle(t, {
    exe: 'MonJeu',
    assets: [{ name: 'MonJeu-v1.1-Linux-X64.zip', url, size: zip.length }],
    contenus: { [url]: zip },
  });
  const r = await installerPortage(j.etat, 'j', { enregistrer: j.enregistrer, arch: 'x64' });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(fs.readFileSync(j.exePath, 'utf8'), 'programme 1.1');
  assert.equal(fs.statSync(j.exePath).mode & 0o777, 0o755);
  assert.equal(fs.readFileSync(path.join(j.dossierJeu, 'assets', 'menu.rml'), 'utf8'), 'menu');
  assert.ok(!fs.existsSync(path.join(j.dossierJeu, 'MonJeu.tar.gz')), 'l’archive interne n’est pas copiée chez le joueur');
});

test('archive sans le programme du jeu : rien n’est modifié, la page s’ouvre', { skip: !linux }, async (t) => {
  const zip = creerZip([{ nom: 'Installeur/setup.bin', donnees: Buffer.from('?') }]);
  const url = 'https://gh/monjeu-linux-x64.zip';
  const j = jeuInstalle(t, { exe: 'MonJeu', assets: [{ name: 'monjeu-linux-x64.zip', url, size: zip.length }], contenus: { [url]: zip } });
  const appeler = creerApi(j.etat);
  const r = await appeler('recompInstall', { id: 'j' });
  assert.match(r.error, /ne contient pas « MonJeu ».*Rien n'a été modifié.*page de la version s'ouvre/);
  assert.ok(j.gh.appels.includes('ouvert https://github.com/a/b/releases/tag/v1.1'));
  assert.equal(fs.readFileSync(j.exePath, 'utf8'), 'ancienne version');
  assert.equal(j.etat.jeux[0].version, '1.0');
  assert.ok(!fs.existsSync(path.join(j.etat.dossiers.donnees, 'anciennes-versions')), 'pas même une copie');
  assert.ok(!fs.existsSync(path.join(j.etat.dossiers.sauvegardes, 'Mon Jeu')), 'ni une sauvegarde inutile');
});

test('pas de mise à jour pendant la partie, pas de partie pendant la mise à jour', async (t) => {
  const j = jeuInstalle(t, { exe: 'MonJeu', assets: [], contenus: {} });
  j.etat.enCours.set('j', {});
  assert.match((await installerPortage(j.etat, 'j', { enregistrer: j.enregistrer })).error, /Ferme le jeu/);
  j.etat.enCours.clear();
  j.etat.installations.set('j', { enCours: true });
  assert.match((await demarrerJeu(j.etat, 'j')).error, /en train de se mettre à jour/);
});

test('le bandeau sait si la mise à jour automatique est possible, et montre la progression', (t) => {
  const j = jeuInstalle(t, { exe: 'Jeu-1.0-x86_64.AppImage', assets: fichiers('Jeu-1.1-x86_64.AppImage'), contenus: {} });
  const jeu = j.etat.jeux[0];
  assert.deepEqual([vuePortage(j.etat, jeu).auto, vuePortage(j.etat, jeu).autoFile], [true, 'Jeu-1.1-x86_64.AppImage']);
  j.etat.installations.set('j', { etape: 'telechargement', pourcentage: 42, fichier: 'Jeu-1.1-x86_64.AppImage' });
  assert.deepEqual(vuePortage(j.etat, jeu).installing, { step: 'telechargement', percent: 42, file: 'Jeu-1.1-x86_64.AppImage' });
  j.etat.portages.get('j').assets = fichiers('Jeu-1.1-macos.zip');
  assert.equal(vuePortage(j.etat, jeu).auto, false);
});

test('vérification GitHub en échec : nouvel essai dans 15 min, pas dans 6 h', async (t) => {
  const { lancerVerifications, INTERVALLE_MS, REESSAI_MS } = require('../src/main/portages');
  const limite = async () => new Response('{}', { status: 403, headers: { 'x-ratelimit-remaining': '0' } });
  const etat = require('./aide').etatDeTest(t, { systeme: { fetch: limite } });
  etat.jeux.push(nouveauJeu({ id: 'g', name: 'G', repoUrl: 'https://github.com/a/b' }, false));
  const avant = Date.now();
  await Promise.all(lancerVerifications(etat, true, { recompCheck: true }));
  assert.ok(etat.prochaineVerifPortages <= Date.now() + REESSAI_MS, 'réessai rapproché');
  assert.ok(etat.prochaineVerifPortages < avant + INTERVALLE_MS);
  assert.ok(etat.lignes.some((l) => l.includes("limite d'appels GitHub atteinte")));
});

test('ETag : une release inchangée est relue du cache (304, appel non compté), même après redémarrage', async (t) => {
  const { lireGitHub } = require('../src/main/portages');
  const { creerEtat } = require('../src/main/etat');
  const vus = [];
  const github = async (_url, { headers }) => {
    vus.push(headers['If-None-Match'] ?? null);
    if (headers['If-None-Match'] === '"v1"') return new Response(null, { status: 304 });
    return new Response(JSON.stringify({ tag_name: 'v1.1' }), { status: 200, headers: { etag: '"v1"' } });
  };
  const etat = require('./aide').etatDeTest(t, { systeme: { fetch: github } });
  assert.deepEqual(await lireGitHub(etat, '/repos/a/b/releases/latest'), { tag_name: 'v1.1' });
  assert.deepEqual(await lireGitHub(etat, '/repos/a/b/releases/latest'), { tag_name: 'v1.1' });
  // « Redémarrage » : nouvel état sur le même dossier de données.
  const apres = creerEtat({ donnees: etat.dossiers.donnees, racineApp: etat.dossiers.app, version: 't', systeme: { fetch: github } });
  assert.deepEqual(await lireGitHub(apres, '/repos/a/b/releases/latest'), { tag_name: 'v1.1' });
  assert.deepEqual(vus, [null, '"v1"', '"v1"']);
});

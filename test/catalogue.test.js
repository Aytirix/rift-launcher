'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { lireCatalogue, vueCatalogue, installerDepuisCatalogue } = require('../src/main/catalogue');
const { lireEmulateurs } = require('../src/main/emulateurs');
const { enregistrerReglages } = require('../src/main/reglages');
const { creerZip } = require('../src/main/zip');
const { etatDeTest, dossierTemp } = require('./aide');

const linux = process.platform !== 'win32';

test('chaque entrée du catalogue est complète, pour Linux comme pour Windows', (t) => {
  const etat = etatDeTest(t);
  const entrees = lireCatalogue(etat);
  assert.ok(entrees.length >= 6);
  assert.equal(new Set(entrees.map((e) => e.id)).size, entrees.length, 'identifiants uniques');
  for (const e of entrees) {
    for (const champ of ['id', 'name', 'repo', 'dossier', 'description', 'besoin']) assert.ok(e[champ], `${e.id} : ${champ}`);
    assert.match(e.repo, /^[\w.-]+\/[\w.-]+$/, e.id);
    assert.ok(['jeu', 'emulateur'].includes(e.type), e.id);
    for (const systeme of ['linux', 'win32']) {
      assert.ok(
        Boolean(e.programme?.[systeme]) !== Boolean(e.page?.[systeme]),
        `${e.id} : il faut un programme OU une page pour ${systeme}`,
      );
    }
    if (e.type === 'emulateur') assert.ok(e.args?.includes('{jeu}'), `${e.id} : arguments sans {jeu}`);
  }
});

function catalogueDeTest(t, releases) {
  const appels = [];
  const fetch = async (url) => {
    appels.push(url);
    const r = releases[url];
    if (!r) return new Response('absent', { status: 404 });
    if (Buffer.isBuffer(r)) return new Response(r, { status: 200, headers: { 'content-length': String(r.length) } });
    return new Response(JSON.stringify(r), { status: 200 });
  };
  const ouverts = [];
  const etat = etatDeTest(t, { plateforme: 'linux', systeme: { fetch, ouvrirLien: (u) => ouverts.push(u) } });
  const jeux = dossierTemp(t);
  enregistrerReglages(etat.dossiers.reglages, { dossierJeux: jeux });
  return { etat, jeux, appels, ouverts, enregistrer: () => {} };
}

const api = (repo) => `https://api.github.com/repos/${repo}/releases/latest`;

test('AppImage du catalogue : installée dans le dossier de jeux, fiche toute réglée', { skip: !linux }, async (t) => {
  const appimage = Buffer.from('soh');
  const c = catalogueDeTest(t, {
    [api('HarbourMasters/Shipwright')]: {
      tag_name: '9.3.1',
      assets: [
        { name: 'SoH-Dewey-Bravo-Win64.zip', size: 1, browser_download_url: 'https://gh/win' },
        { name: 'SoH-Dewey-Bravo.appimage', size: appimage.length, browser_download_url: 'https://gh/soh' },
      ],
    },
    'https://gh/soh': appimage,
  });
  const r = await installerDepuisCatalogue(c.etat, 'shipwright', { enregistrer: c.enregistrer, arch: 'x64' });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.match(r.need, /ROM d'Ocarina of Time/);
  const jeu = c.etat.jeux.at(-1);
  assert.deepEqual(
    [jeu.name, jeu.version, jeu.repoUrl, jeu.franchise],
    ['Zelda: Ocarina of Time (Ship of Harkinian)', '9.3.1', 'https://github.com/HarbourMasters/Shipwright', 'zelda'],
  );
  assert.equal(jeu.exePath, path.join(c.jeux, 'Ship of Harkinian', 'SoH-Dewey-Bravo.appimage'));
  assert.equal(fs.statSync(jeu.exePath).mode & 0o111, 0o111);
  assert.ok(!c.appels.includes('https://gh/win'), 'le fichier Windows n’est pas téléchargé');
  assert.equal(vueCatalogue(c.etat).find((e) => e.id === 'shipwright').installed, true);
});

test('zip qui contient une AppImage (comme 2 Ship 2 Harkinian)', { skip: !linux }, async (t) => {
  const zip = creerZip([
    { nom: '2ship.appimage', donnees: Buffer.from('2ship') },
    { nom: 'readme.txt', donnees: Buffer.from('lis-moi') },
  ]);
  const c = catalogueDeTest(t, {
    [api('HarbourMasters/2ship2harkinian')]: {
      tag_name: '5.0.1',
      assets: [
        { name: '2Ship-Battler-Bravo-Linux.zip', size: zip.length, browser_download_url: 'https://gh/2ship' },
        { name: '2Ship-Battler-Bravo-Mac.zip', size: 1, browser_download_url: 'https://gh/mac' },
      ],
    },
    'https://gh/2ship': zip,
  });
  const r = await installerDepuisCatalogue(c.etat, '2ship2harkinian', { enregistrer: c.enregistrer, arch: 'x64' });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.exePath, path.join(c.jeux, '2 Ship 2 Harkinian', '2ship.appimage'));
  assert.equal(fs.readFileSync(path.join(c.jeux, '2 Ship 2 Harkinian', 'readme.txt'), 'utf8'), 'lis-moi');
});

test('émulateur du catalogue : déclaré dans les émulateurs, pas dans les jeux', { skip: !linux }, async (t) => {
  const app = Buffer.from('eglantine');
  const c = catalogueDeTest(t, {
    [api('Eglantine-Community/Eglantine')]: {
      tag_name: 'v0.1.0-rc4',
      assets: [
        { name: 'eglantine-linux-x86_64-pgo.AppImage', size: 1, browser_download_url: 'https://gh/pgo' },
        { name: 'eglantine-linux-x86_64.AppImage', size: app.length, browser_download_url: 'https://gh/egl' },
        { name: 'eglantine-linux-aarch64.AppImage', size: 1, browser_download_url: 'https://gh/arm' },
      ],
    },
    'https://gh/egl': app,
  });
  const avant = c.etat.jeux.length;
  const r = await installerDepuisCatalogue(c.etat, 'eglantine', { enregistrer: c.enregistrer, arch: 'x64' });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(c.etat.jeux.length, avant);
  const [emu] = lireEmulateurs(c.etat.dossiers.reglages);
  assert.deepEqual([emu.name, emu.args, path.basename(emu.exePath)], ['Eglantine', '-f -g "{jeu}"', 'eglantine-linux-x86_64.AppImage']);
  assert.equal(vueCatalogue(c.etat).find((e) => e.id === 'eglantine').installed, true);
});

test('un dossier déjà rempli n’est jamais écrasé ; rien n’est téléchargé', { skip: !linux }, async (t) => {
  const c = catalogueDeTest(t, {});
  fs.mkdirSync(path.join(c.jeux, 'Starship'));
  fs.writeFileSync(path.join(c.jeux, 'Starship', 'ma-sauvegarde.sav'), 'précieux');
  const r = await installerDepuisCatalogue(c.etat, 'starship', { enregistrer: c.enregistrer, arch: 'x64' });
  assert.match(r.error, /existe déjà/);
  assert.deepEqual(c.appels, []);
  assert.equal(fs.readFileSync(path.join(c.jeux, 'Starship', 'ma-sauvegarde.sav'), 'utf8'), 'précieux');
});

test('un portage qui ne s’installe pas seul (assistant, Flatpak) ouvre sa page sans rien créer', { skip: !linux }, async (t) => {
  const c = catalogueDeTest(t, {});
  const { creerApi } = require('../src/main/api');
  const r = await creerApi(c.etat)('catalogInstall', { id: 'totk-pc-recomp' });
  assert.match(r.error, /assistant.*La page du portage s'ouvre/);
  assert.deepEqual(c.ouverts, ['https://github.com/valentderah/totk-pc-recomp/releases/latest']);
  assert.deepEqual(fs.readdirSync(c.jeux), []);
  assert.match(vueCatalogue(c.etat).find((e) => e.id === 'unleashedrecomp').manual, /Flatpak/);
});

test('archive sans le programme attendu : pas de dossier créé', { skip: !linux }, async (t) => {
  const zip = creerZip([{ nom: 'autre-chose.bin', donnees: Buffer.from('?') }]);
  const c = catalogueDeTest(t, {
    [api('HarbourMasters/SpaghettiKart')]: {
      tag_name: '1.0.0',
      assets: [{ name: 'spaghetti-linux.zip', size: zip.length, browser_download_url: 'https://gh/sk' }],
    },
    'https://gh/sk': zip,
  });
  const r = await installerDepuisCatalogue(c.etat, 'spaghettikart', { enregistrer: c.enregistrer, arch: 'x64' });
  assert.match(r.error, /ne contient pas « spaghetti.appimage »/);
  assert.deepEqual(fs.readdirSync(c.jeux), []);
});

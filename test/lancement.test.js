'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  analyserEnv,
  decouperArguments,
  commandeDeLancement,
  environnementDuJeu,
  demarrerJeu,
  arreterJeu,
  suivreJeux,
} = require('../src/main/lancement');
const { nouveauJeu } = require('../src/main/bibliotheque');
const { etatDeTest, dossierTemp } = require('./aide');

const outils = (disponibles = [], executables = []) => ({
  trouver: (noms) => noms.map((n) => (disponibles.includes(n) ? `/usr/bin/${n}` : null)).find(Boolean) ?? null,
  executable: (p) => executables.includes(p),
});

test('analyserEnv : une variable par ligne, commentaires et lignes vides ignorés', () => {
  assert.deepEqual(analyserEnv('# commentaire\nDXVK_HUD=fps\r\n\n  MANGOHUD = 1 \n=sansnom\nPROTON_LOG=a=b'), {
    DXVK_HUD: 'fps',
    MANGOHUD: '1',
    PROTON_LOG: 'a=b',
  });
});

test('decouperArguments suit les règles d’un shell', () => {
  assert.deepEqual(decouperArguments('-f -g "/home/t/Mes Jeux/mk.xci"'), ['-f', '-g', '/home/t/Mes Jeux/mk.xci']);
  assert.deepEqual(decouperArguments('--nom \'a b\' c\\ d ""'), ['--nom', 'a b', 'c d', '']);
  assert.deepEqual(decouperArguments('"il dit \\"oui\\""'), ['il dit "oui"']);
  assert.deepEqual(decouperArguments('   '), []);
  assert.throws(() => decouperArguments('"pas fermé'), /Guillemet non fermé/);
});

test('Windows : un .exe reçoit ses arguments tels qu’écrits, chemin entre guillemets', () => {
  const c = commandeDeLancement({
    exePath: 'C:\\Jeux\\Mon Jeu\\jeu.exe',
    args: '-f -g "D:\\a b.xci"',
    plateforme: 'win32',
    outils: outils(),
  });
  assert.equal(c.fichier, 'C:\\Jeux\\Mon Jeu\\jeu.exe');
  assert.deepEqual(c.arguments, ['-f -g "D:\\a b.xci"']);
  assert.deepEqual(c.options, { windowsVerbatimArguments: true, argv0: '"C:\\Jeux\\Mon Jeu\\jeu.exe"' });
});

test('Windows : un .bat passe par cmd', () => {
  const c = commandeDeLancement({
    exePath: 'C:\\x y\\go.bat',
    args: '',
    plateforme: 'win32',
    outils: { ...outils(), comspec: 'C:\\W\\cmd.exe' },
  });
  assert.equal(c.fichier, 'C:\\W\\cmd.exe');
  assert.deepEqual(c.arguments, ['/d', '/s', '/c', '""C:\\x y\\go.bat""']);
});

test('Linux : un .exe passe par Proton (umu) avant Wine, et refuse sans aucun des deux', () => {
  const exe = '/home/t/totk/totk.exe';
  assert.deepEqual(commandeDeLancement({ exePath: exe, args: '-x', plateforme: 'linux', outils: outils(['wine', 'umu-run']) }).arguments, [
    exe,
    '-x',
  ]);
  assert.equal(
    commandeDeLancement({ exePath: exe, args: '', plateforme: 'linux', outils: outils(['wine', 'umu-run']) }).fichier,
    '/usr/bin/umu-run',
  );
  assert.equal(commandeDeLancement({ exePath: exe, args: '', plateforme: 'linux', outils: outils(['wine']) }).fichier, '/usr/bin/wine');
  assert.match(commandeDeLancement({ exePath: exe, args: '', plateforme: 'linux', outils: outils([]) }).erreur, /Installe Wine/);
});

test('Linux : une AppImage sans droit d’exécution est rendue exécutable, pas un programme qui l’a déjà', () => {
  const app = '/home/t/eglantine-linux-x86_64.AppImage';
  const c = commandeDeLancement({ exePath: app, args: '-f -g "/j/mk w.xci"', plateforme: 'linux', outils: outils() });
  assert.deepEqual(c, { fichier: app, arguments: ['-f', '-g', '/j/mk w.xci'], options: {}, rendreExecutable: true });
  assert.equal(commandeDeLancement({ exePath: app, args: '', plateforme: 'linux', outils: outils([], [app]) }).rendreExecutable, false);
});

test('Linux : un script .sh sans droit d’exécution passe par bash', () => {
  const c = commandeDeLancement({ exePath: '/j/lance.sh', args: 'a', plateforme: 'linux', outils: outils(['bash']) });
  assert.deepEqual([c.fichier, c.arguments], ['/usr/bin/bash', ['/j/lance.sh', 'a']]);
});

test('les variables de l’AppImage du launcher ne passent pas au jeu sous Linux', () => {
  const base = { PATH: '/usr/bin', APPIMAGE: '/a.AppImage', APPDIR: '/tmp/.mount', ARGV0: 'x', OWD: '/' };
  assert.deepEqual(environnementDuJeu(base, { DXVK_HUD: 'fps' }, 'linux'), { PATH: '/usr/bin', DXVK_HUD: 'fps' });
  assert.equal(environnementDuJeu(base, {}, 'win32').APPIMAGE, '/a.AppImage');
});

test('un jeu introuvable ou un fichier manquant est refusé avec un message clair', async (t) => {
  const etat = etatDeTest(t);
  assert.deepEqual(await demarrerJeu(etat, 'nope'), { error: 'Jeu introuvable.' });
  etat.jeux.push(nouveauJeu({ id: 'j', name: 'J', exePath: '/n/existe/pas' }, false));
  assert.match((await demarrerJeu(etat, 'j')).error, /introuvable/);
});

test('un programme de lancement absent renvoie une erreur au lieu de laisser croire au lancement', {
  skip: process.platform === 'win32',
}, async (t) => {
  const etat = etatDeTest(t, { plateforme: 'linux' });
  const dossier = dossierTemp(t);
  const exe = path.join(dossier, 'jeu.exe');
  fs.writeFileSync(exe, 'MZ');
  etat.jeux.push(nouveauJeu({ id: 'w', name: 'Win', exePath: exe }, false));
  const r = await demarrerJeu(etat, 'w', { outils: { trouver: () => '/nulle/part/umu-run', executable: () => false } });
  assert.match(r.error, /Impossible de lancer le jeu/);
  assert.equal(etat.enCours.size, 0);
});

test('lancer, compter le temps, arrêter tout le groupe de processus', { skip: process.platform === 'win32' }, async (t) => {
  const etat = etatDeTest(t, { plateforme: 'linux' });
  const dossier = dossierTemp(t);
  const exe = path.join(dossier, 'jeu.sh');
  // Le script lance un enfant : l'arrêt doit le fermer aussi.
  fs.writeFileSync(exe, `#!/bin/sh\necho "$MA_VAR" > "${dossier}/env.txt"\nsleep 30 &\nwait\n`, { mode: 0o644 });
  etat.jeux.push(nouveauJeu({ id: 'g', name: 'Groupe', exePath: exe, env: 'MA_VAR=bonjour' }, false));
  let enregistrements = 0;
  const r = await demarrerJeu(etat, 'g', { enregistrer: () => enregistrements++ });
  assert.deepEqual(r, { ok: true });
  assert.equal(etat.jeux[0].sessions, 1);
  assert.equal(enregistrements, 1);
  assert.deepEqual(await demarrerJeu(etat, 'g'), { error: 'Ce jeu est déjà lancé.' });
  const pid = etat.enCours.get('g').proc.pid;
  await new Promise((res) => setTimeout(res, 300));
  assert.equal(fs.readFileSync(path.join(dossier, 'env.txt'), 'utf8').trim(), 'bonjour', 'variable passée au jeu');
  arreterJeu(etat, 'g');
  for (let i = 0; i < 50 && !etat.enCours.get('g').fini; i++) await new Promise((res) => setTimeout(res, 100));
  suivreJeux(etat, () => enregistrements++);
  assert.equal(etat.enCours.size, 0);
  assert.ok(etat.jeux[0].playSeconds > 0.2, `temps compté : ${etat.jeux[0].playSeconds}`);
  assert.ok(etat.lignes.some((l) => l.includes('arrete depuis Rift Launcher')));
  // Plus aucun processus du groupe : le « sleep 30 » enfant est fermé lui aussi.
  assert.throws(() => process.kill(-pid, 0), { code: 'ESRCH' });
});

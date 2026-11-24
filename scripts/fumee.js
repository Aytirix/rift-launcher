'use strict';
// Test de fumée : lance la VRAIE application (Electron) sur un dossier de données
// neuf et exige deux preuves indépendantes :
//   1. l'interface a affiché les jeux du préréglage, ce qui prouve que la page s'est
//      exécutée ET que le pont vers le launcher (window.rift) a répondu ;
//   2. un jeu factice lancé depuis l'interface apparaît « en cours », puis son temps
//      de jeu est compté à sa fermeture : le lancement de vrais processus marche.
// Sans la deuxième preuve, une interface qui s'affiche sur un launcher incapable de
// lancer quoi que ce soit passerait au vert.
//
// Usage : node scripts/fumee.js [--headless] [--executable <chemin>]
//   --headless   : Linux sans affichage
//   --executable : l'application empaquetée (AppImage, linux-unpacked, win-unpacked…)
//                  au lieu du code source
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright-core');

const RACINE = path.join(__dirname, '..');
const headless = process.argv.includes('--headless');
const iExecutable = process.argv.indexOf('--executable');
const executable = iExecutable > 0 ? path.resolve(process.argv[iExecutable + 1]) : null;

function jeuFactice(dossier) {
  if (process.platform === 'win32') {
    const f = path.join(dossier, 'jeu factice.cmd');
    fs.writeFileSync(f, '@echo off\r\nping -n 3 127.0.0.1 >nul\r\n');
    return f;
  }
  const f = path.join(dossier, 'jeu factice.sh');
  fs.writeFileSync(f, '#!/bin/sh\nsleep 2\n', { mode: 0o755 });
  return f;
}

async function principal() {
  const donnees = fs.mkdtempSync(path.join(os.tmpdir(), 'rift-fumee-'));
  const erreurs = [];
  const args = executable ? [] : [RACINE];
  if (headless) args.push('--ozone-platform=headless');
  const appli = await electron.launch({
    args,
    ...(executable ? { executablePath: executable } : {}),
    env: { ...process.env, RIFT_DATA_DIR: donnees },
    timeout: 60000,
  });
  console.log(`application : ${executable ?? 'code source'}`);
  try {
    const page = await appli.firstWindow();
    page.on('pageerror', (e) => erreurs.push(`page : ${e.message}`));
    page.on('console', (m) => {
      if (m.type() === 'error') erreurs.push(`console : ${m.text()}`);
    });
    // Preuve 1 : les 3 jeux du préréglage sont affichés.
    await page.waitForFunction(() => document.querySelectorAll('#grid > *').length === 3, null, { timeout: 30000 });
    const titre = await appli.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getTitle());
    console.log(`fenêtre « ${titre} », ${await page.locator('#grid > *').count()} jeux affichés`);

    // Preuve 2 : un jeu factice, ajouté et lancé par le pont de l'interface.
    const fichier = jeuFactice(donnees);
    const lib = await page.evaluate((exePath) => window.rift.appeler('save', { name: 'Jeu factice', exePath }), fichier);
    const id = lib.games.find((g) => g.name === 'Jeu factice').id;
    const lance = await page.evaluate((i) => window.rift.appeler('play', { id: i }), id);
    if (!lance.ok) throw new Error(`lancement refusé : ${JSON.stringify(lance)}`);
    const enCours = await page.evaluate(() => window.rift.appeler('library', {}));
    if (!enCours.running.includes(id)) throw new Error('le jeu lancé n’apparaît pas « en cours »');
    console.log('jeu factice lancé et vu « en cours »');
    // L'attente se fait ici, côté Node : une condition `async` passée à waitForFunction
    // renvoie une promesse, toujours « vraie », et le test passait sans rien attendre.
    let final = null;
    for (const limite = Date.now() + 20000; Date.now() < limite; await new Promise((r) => setTimeout(r, 500))) {
      const l = await page.evaluate(() => window.rift.appeler('library', {}));
      if (!l.running.includes(id)) {
        final = l.games.find((g) => g.id === id);
        break;
      }
    }
    if (!final) throw new Error('le jeu factice ne s’est jamais fermé aux yeux du launcher');
    // Le jeu dure 2 s : moins d'une seconde comptée voudrait dire que le temps n'est pas suivi.
    if (!(final.playSeconds >= 1)) throw new Error(`temps de jeu non compté : ${final.playSeconds} s`);
    if (final.sessions !== 1) throw new Error(`sessions : ${final.sessions} au lieu de 1`);
    console.log(`jeu factice fermé : ${final.playSeconds.toFixed(1)} s comptées, ${final.sessions} session`);

    fs.mkdirSync(path.join(RACINE, 'dist'), { recursive: true });
    // Passe l'intro pour que la capture montre la bibliothèque.
    if (await page.locator('#splash').isVisible()) await page.locator('#splash').click();
    await page.waitForFunction(() => !document.getElementById('splash'), null, { timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(RACINE, 'dist', 'fumee.png') });
    // Le jeu factice, sans jaquette, est celui mis en avant : la version d'origine
    // affichait alors « null » à côté de son affiche.
    const enAvant = await page.locator('#hero').innerText();
    if (!enAvant.includes('Jeu factice')) throw new Error('le jeu factice n’est pas celui mis en avant');
    if (/\bnull\b/.test(enAvant)) throw new Error('« null » affiché dans le jeu mis en avant');
    if (erreurs.length) throw new Error(`erreurs dans l'interface :\n${erreurs.join('\n')}`);
    await appli.close();

    // Preuve 3 : le mode « raccourci Steam ». Relancé avec --jouer=<id>, Rift Launcher
    // n'ouvre AUCUNE fenêtre, lance le jeu, compte son temps et se ferme avec lui.
    const avant = final.playSeconds;
    const steam = await electron.launch({
      args: [...args, `--jouer=${id}`],
      ...(executable ? { executablePath: executable } : {}),
      env: { ...process.env, RIFT_DATA_DIR: donnees },
      timeout: 60000,
    });
    let fenetres = 0;
    steam.on('window', () => fenetres++);
    const ferme = new Promise((r) => steam.process().once('exit', r));
    const delai = new Promise((_, rej) =>
      setTimeout(() => rej(new Error('Rift Launcher ne s’est pas fermé après la partie (mode Steam)')), 30000),
    );
    await Promise.race([ferme, delai]);
    if (fenetres) throw new Error(`mode Steam : ${fenetres} fenêtre(s) ouverte(s) au lieu d'aucune`);
    const relu = JSON.parse(fs.readFileSync(path.join(donnees, 'library.json'), 'utf8')).games.find((g) => g.id === id);
    if (!(relu.playSeconds >= avant + 1) || relu.sessions !== 2) {
      throw new Error(`mode Steam : partie non comptée (${relu.playSeconds} s, ${relu.sessions} sessions)`);
    }
    console.log(`mode Steam : aucune fenêtre, jeu lancé puis fermé, ${relu.sessions} sessions`);

    // Preuve 4 : un raccourci vers un jeu disparu ne doit pas échouer en silence.
    const perdu = await electron.launch({
      args: [...args, '--jouer=jeu-disparu'],
      ...(executable ? { executablePath: executable } : {}),
      env: { ...process.env, RIFT_DATA_DIR: donnees },
      timeout: 60000,
    });
    try {
      await perdu.firstWindow({ timeout: 15000 });
      console.log('raccourci vers un jeu disparu : la fenêtre s’ouvre pour le dire');
    } catch {
      throw new Error('raccourci vers un jeu disparu : aucune fenêtre, l’erreur passe inaperçue');
    } finally {
      await perdu.close().catch(() => {});
    }
    console.log('FUMÉE OK');
  } finally {
    await appli.close().catch(() => {});
    fs.rmSync(donnees, { recursive: true, force: true });
  }
}

principal().catch((err) => {
  console.error(`FUMÉE EN ÉCHEC : ${err.message}`);
  process.exit(1);
});

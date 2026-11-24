'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { creerApi, fichierRessource } = require('../src/main/api');
const { chargerBibliotheque, nouveauJeu } = require('../src/main/bibliotheque');
const { etatDeTest } = require('./aide');

function api(t, systeme = {}) {
  const etat = etatDeTest(t, { systeme: { ouvrirDossier: () => {}, montrerFichier: () => {}, ouvrirLien: () => {}, ...systeme } });
  chargerBibliotheque(etat);
  return { etat, appeler: creerApi(etat) };
}

test('ajouter puis modifier un jeu, sans toucher à ses statistiques', async (t) => {
  const { etat, appeler } = api(t);
  assert.deepEqual(await appeler('save', { name: '   ' }), { error: 'Donne un nom au jeu.' });
  const apres = await appeler('save', { name: ' Eglantine ', exePath: '/j/eglantine.AppImage', args: '-f' });
  const jeu = apres.games.find((g) => g.name === 'Eglantine');
  assert.equal(jeu.exePath, '/j/eglantine.AppImage');
  etat.jeux.find((j) => j.id === jeu.id).playSeconds = 500;
  const modifie = await appeler('save', { id: jeu.id, name: 'Eglantine', exePath: '/j/autre.AppImage' });
  const relu = modifie.games.find((g) => g.id === jeu.id);
  assert.equal(relu.exePath, '/j/autre.AppImage');
  assert.equal(relu.args, '', 'un champ vidé dans le formulaire est vidé');
  assert.equal(relu.playSeconds, 500);
  assert.equal(modifie.games.length, 4);
});

test('un jeu en cours ne peut pas être retiré', async (t) => {
  const { etat, appeler } = api(t);
  const id = etat.jeux[0].id;
  etat.enCours.set(id, {});
  assert.deepEqual(await appeler('delete', { id }), { error: 'Ferme le jeu avant de le retirer.' });
  etat.enCours.clear();
  assert.equal((await appeler('delete', { id })).games.length, 2);
});

test('réglages : ID Discord vérifié, clé SteamGridDB jamais renvoyée en clair', async (t) => {
  const { appeler } = api(t);
  assert.match((await appeler('settingsSave', { discordId: 'abc' })).error, /ID Discord/);
  assert.deepEqual(await appeler('settingsSave', { sgdbKey: ' cle-secrete ', discordId: '1234567890123456789' }), {
    ok: true,
    hasKey: true,
  });
  const s = await appeler('settings');
  assert.equal(s.hasKey, true);
  assert.ok(!JSON.stringify(s).includes('cle-secrete'));
  assert.equal(s.discordId, '1234567890123456789');
  assert.equal(s.franchises.length, 19);
});

test('préférences : volumes bornés, langue inconnue refusée', async (t) => {
  const { appeler } = api(t);
  const { prefs } = await appeler('prefsSave', { prefs: { volume: 250, uiVolume: -4, lang: 'klingon', intro: 0 } });
  assert.deepEqual([prefs.volume, prefs.uiVolume, prefs.lang, prefs.intro], [100, 0, 'auto', false]);
  assert.equal((await appeler('prefsSave', { prefs: { lang: 'en' } })).prefs.lang, 'en');
});

test('une commande inconnue, même héritée d’Object, est refusée', async (t) => {
  const { appeler } = api(t);
  assert.deepEqual(await appeler('constructor', {}), { error: 'not found' });
  assert.deepEqual(await appeler('rienDuTout', {}), { error: 'not found' });
});

test('une erreur imprévue revient à l’interface au lieu de tout arrêter', async (t) => {
  const { appeler } = api(t, { verifierMaj: () => Promise.reject(new Error('réseau coupé')) });
  assert.deepEqual(await appeler('updateCheck', {}), { error: 'réseau coupé' });
});

test('les messages de l’interface sont écrits au journal, tronqués à 2000 caractères', async (t) => {
  const { etat, appeler } = api(t);
  await appeler('log', { level: 'PIRATE', message: 'x'.repeat(3000), stack: 'a\nb' });
  const ligne = etat.lignes.at(-1);
  assert.ok(ligne.startsWith('ERROR [interface] '));
  assert.ok(ligne.endsWith('...'));
  assert.ok(ligne.length < 2100);
});

test('le choix du fichier du jeu propose les bons filtres selon le système', async (t) => {
  let filtres;
  const { appeler } = api(t, {
    choisirFichier: async (o) => {
      filtres = o.filtres;
      return '/j/jeu.AppImage';
    },
  });
  assert.deepEqual(await appeler('pick', { kind: 'exe' }), { path: '/j/jeu.AppImage' });
  assert.ok(filtres.length >= 2);
});

test('mise à jour refusée pendant une partie', async (t) => {
  const { etat, appeler } = api(t, { installerMaj: () => ({ ok: true }) });
  etat.enCours.set('x', {});
  assert.match((await appeler('updateInstall', {})).error, /Ferme ton jeu/);
});

test('« Je l’ai installée » prend la dernière version publiée, sans le v', async (t) => {
  const { etat, appeler } = api(t);
  const jeu = etat.jeux[0];
  etat.portages.set(jeu.id, { repo: 'valentderah/totk-pc-recomp', latest: 'v0.5.0', url: 'https://github.com/x', date: '', title: '' });
  assert.deepEqual(await appeler('recompDone', { id: jeu.id }), { ok: true });
  assert.equal(jeu.version, '0.5.0');
  assert.match((await appeler('recompDone', { id: etat.jeux[1].id })).error, /Aucune version/);
});

test('/img et /snd ne servent que les fichiers des jeux, avec un index borné', (t) => {
  const etat = etatDeTest(t);
  const son = path.join(etat.dossiers.donnees, 'a.mp3');
  fs.writeFileSync(son, '');
  etat.jeux.push(nouveauJeu({ id: 'z', name: 'Zelda: Tears of the Kingdom', sound: son }, false));
  const p = (s) => new URLSearchParams(s);
  assert.match(fichierRessource(etat, '/img', p('id=z')), /totk\.svg$/);
  assert.equal(fichierRessource(etat, '/snd', p('id=z&n=0')), son);
  assert.equal(fichierRessource(etat, '/snd', p('id=z&n=1')), null);
  assert.equal(fichierRessource(etat, '/snd', p('id=z&n=-1')), null);
  assert.equal(fichierRessource(etat, '/img', p('id=inconnu')), null);
});

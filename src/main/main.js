'use strict';
// Rift Launcher : application de bureau Windows et Linux (Electron).
// Interface d'origine de TeK_Sama ; ce fichier remplace le serveur PowerShell,
// la fenêtre Edge et le code C# des manettes de la version Windows.
const { execFile } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow, desktopCapturer, dialog, ipcMain, Notification, protocol, screen, shell } = require('electron');
const { creerEtat, dossierDonneesParDefaut } = require('./etat');
const { chargerBibliotheque, enregistrerBibliotheque, prefsDe } = require('./bibliotheque');
const { ecrireLisezmoi, estFichier, TYPES_MIME } = require('./licences');
const { chargerReglages } = require('./reglages');
const { creerApi, fichierRessource } = require('./api');
const { suivreJeux, ajouterTemps, dernierJeuLance, nomDeFichierSur, outilsDuSysteme } = require('./lancement');
const { lancerVerifications } = require('./portages');
const { majAutomatiques } = require('./maj-portages');
const { StatutDiscord, ID_DISCORD_INTEGRE } = require('./discord');
const { horodatage } = require('./sauvegardes');
const { comparerVersions } = require('./versions');
const { nomDuSysteme } = require('./rapport');

const SCHEMA = 'rift';
const ORIGINE = `${SCHEMA}://app`;
const RACINE = path.join(__dirname, '..');
const PAGE_DES_VERSIONS = 'https://github.com/Aytirix/rift-launcher/releases';

// Une AppImage ne peut pas installer le bac à sable de Chromium (il demande d'être
// « setuid root ») et plusieurs distributions bloquent l'autre méthode : sans cette
// option, l'AppImage ne s'ouvre pas du tout. L'interface ne charge que des fichiers
// locaux de l'application, jamais de page web.
if (process.platform === 'linux' && process.env.APPIMAGE) app.commandLine.appendSwitch('no-sandbox');
// Les sons de l'intro jouent sans clic.
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

protocol.registerSchemesAsPrivileged([
  { scheme: SCHEMA, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

const DONNEES = dossierDonneesParDefaut();
// Le cache de Chromium reste à part, dans un sous-dossier des données.
app.setPath('userData', path.join(DONNEES, 'electron'));

let etat = null;
let fenetre = null;
let discord = null;
let arreterManettes = () => {};
let dernierBasculement = 0;

const TYPES_FICHIERS = {
  ...TYPES_MIME,
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.ico': 'image/x-icon',
};

function reponseFichier(fichier) {
  const type = TYPES_FICHIERS[path.extname(fichier).toLowerCase()] ?? 'application/octet-stream';
  return new Response(fs.readFileSync(fichier), { headers: { 'Content-Type': type, 'Cache-Control': 'no-store' } });
}

function servir(requete) {
  const url = new URL(requete.url);
  const introuvable = () => new Response('introuvable', { status: 404 });
  if (url.host !== 'app') return introuvable();
  let chemin = decodeURIComponent(url.pathname);
  if (chemin === '/img' || chemin === '/snd') {
    const fichier = fichierRessource(etat, chemin, url.searchParams);
    return fichier && estFichier(fichier) ? reponseFichier(fichier) : introuvable();
  }
  if (chemin === '/') chemin = '/index.html';
  const web = etat.dossiers.web;
  const fichier = path.normalize(path.join(web, chemin));
  if (!fichier.startsWith(web + path.sep) || !estFichier(fichier)) return introuvable();
  return reponseFichier(fichier);
}

// ---------------------------------------------------------------- fenêtre
function creerFenetre() {
  fenetre = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'Rift Launcher',
    icon: path.join(RACINE, 'icone.png'),
    backgroundColor: '#0e0f13',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(RACINE, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      // Garde la page « visible » quand la fenêtre est réduite : l'interface continue
      // de lire la manette (bouton Home) pendant que le jeu est devant.
      backgroundThrottling: false,
    },
  });
  fenetre.removeMenu();
  fenetre.once('ready-to-show', () => fenetre?.show());
  fenetre.on('closed', () => {
    fenetre = null;
    discord?.tick();
  });
  fenetre.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  fenetre.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(`${ORIGINE}/`)) e.preventDefault();
  });
  fenetre.loadURL(`${ORIGINE}/index.html`);
}

function mettreDevant() {
  if (!fenetre) {
    creerFenetre();
    return;
  }
  if (fenetre.isMinimized()) fenetre.restore();
  fenetre.show();
  // Windows refuse souvent de passer devant le jeu : « toujours au-dessus » un instant.
  fenetre.setAlwaysOnTop(true);
  fenetre.focus();
  setTimeout(() => fenetre?.setAlwaysOnTop(false), 400);
}

// Launcher devant -> retour au jeu ; sinon -> launcher devant.
function basculer() {
  const maintenant = Date.now();
  // L'interface et la lecture directe de la manette voient le même appui.
  if (maintenant - dernierBasculement < 450) return 'ignore';
  dernierBasculement = maintenant;
  if (!fenetre) {
    etat.journal('INFO', 'Bouton Home : reouverture de la fenetre');
    creerFenetre();
    return 'fenetre';
  }
  const devant = fenetre.isVisible() && !fenetre.isMinimized() && fenetre.isFocused();
  if (devant) {
    if (!dernierJeuLance(etat)) return 'aucun jeu';
    // Réduire la fenêtre rend la main à la fenêtre d'avant : le jeu.
    fenetre.minimize();
    return 'jeu';
  }
  mettreDevant();
  return 'launcher';
}

// ---------------------------------------------------------------- capture d'écran
const outils = outilsDuSysteme(process.platform);

function executer(fichier, args) {
  return new Promise((resolve) => execFile(fichier, args, { timeout: 15000 }, (err) => resolve(!err)));
}

// Sous Wayland, la capture de Chromium demande à chaque fois l'autorisation :
// on passe d'abord par l'outil de capture du bureau.
async function captureParOutil(fichier) {
  const essais = [
    ['grim', [fichier]],
    ['gnome-screenshot', ['-f', fichier]],
    ['spectacle', ['-b', '-n', '-f', '-o', fichier]],
    ['scrot', ['-o', fichier]],
  ];
  for (const [nom, args] of essais) {
    const outil = outils.trouver([nom]);
    if (outil && (await executer(outil, args)) && estFichier(fichier)) return true;
  }
  return false;
}

async function captureParChromium(fichier) {
  const ecran = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const taille = {
    width: Math.round(ecran.size.width * ecran.scaleFactor),
    height: Math.round(ecran.size.height * ecran.scaleFactor),
  };
  const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: taille });
  const source = sources.find((s) => s.display_id === String(ecran.id)) ?? sources[0];
  const png = source?.thumbnail?.toPNG();
  if (!png?.length) return false;
  fs.writeFileSync(fichier, png);
  return true;
}

async function capturer() {
  const id = dernierJeuLance(etat);
  const jeu = id ? etat.jeux.find((j) => j.id === id) : null;
  const nom = nomDeFichierSur(jeu ? jeu.name : 'Rift Launcher').replace(/\.+$/, '');
  const dossier = path.join(etat.captures, nom);
  fs.mkdirSync(dossier, { recursive: true });
  const fichier = path.join(dossier, `${nom} ${horodatage()}.png`);
  let ok = false;
  try {
    const wayland = process.platform === 'linux' && process.env.XDG_SESSION_TYPE === 'wayland';
    if (wayland) ok = await captureParOutil(fichier);
    if (!ok) ok = await captureParChromium(fichier);
    if (!ok && process.platform === 'linux' && !wayland) ok = await captureParOutil(fichier);
  } catch (err) {
    etat.journal.erreur("Capture d'ecran", err);
  }
  if (!ok) {
    etat.journal('WARN', "Capture d'ecran impossible");
    return '';
  }
  etat.capture = { count: (etat.capture?.count ?? 0) + 1, last: path.basename(fichier) };
  etat.journal('INFO', `Capture : ${fichier}`);
  return fichier;
}

// ---------------------------------------------------------------- mises à jour de Rift Launcher
let majPrete = null;

function mettreAJourDispo() {
  if (!app.isPackaged) return null;
  if (!majPrete) {
    const { autoUpdater } = require('electron-updater');
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = false;
    autoUpdater.logger = {
      info: (m) => etat.journal('DEBUG', `[maj] ${m}`),
      warn: (m) => etat.journal('WARN', `[maj] ${m}`),
      error: (m) => etat.journal('WARN', `[maj] ${m}`),
      debug: () => {},
    };
    majPrete = autoUpdater;
  }
  return majPrete;
}

function notesEnTexte(notes) {
  const brut = Array.isArray(notes) ? notes.map((n) => n.note ?? '').join('\n') : String(notes ?? '');
  const texte = brut
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return texte.length > 300 ? `${texte.slice(0, 299)}…` : texte;
}

async function verifierMaj() {
  const maj = mettreAJourDispo();
  if (!maj) return { ok: true, current: etat.version, update: null };
  try {
    const r = await maj.checkForUpdates();
    const info = r?.updateInfo;
    if (info && comparerVersions(info.version, etat.version) > 0) {
      etat.miseAJour = {
        version: info.version,
        notes: notesEnTexte(info.releaseNotes),
        date: String(info.releaseDate ?? ''),
        url: `${PAGE_DES_VERSIONS}/tag/v${info.version}`,
      };
      etat.journal('INFO', `Mise a jour disponible : ${etat.version} -> ${info.version}`);
    } else {
      etat.miseAJour = null;
    }
    return { ok: true, current: etat.version, update: etat.miseAJour };
  } catch (err) {
    etat.journal('WARN', `Verification des mises a jour impossible : ${err.message}`);
    return { error: 'Impossible de vérifier les mises à jour (pas de connexion ?).' };
  }
}

async function installerMaj() {
  const u = etat.miseAJour;
  if (!u) return { error: 'Aucune mise à jour à installer.' };
  const maj = mettreAJourDispo();
  try {
    etat.journal('INFO', `Telechargement de la mise a jour ${u.version}`);
    await maj.downloadUpdate();
    etat.journal('INFO', `Installation de ${u.version}, redemarrage de Rift Launcher.`);
    setTimeout(() => maj.quitAndInstall(false, true), 800);
    return { ok: true, version: u.version };
  } catch (err) {
    // Paquet que la mise à jour automatique ne sait pas remplacer : page des versions.
    etat.journal('WARN', `Mise a jour automatique impossible : ${err.message}`);
    shell.openExternal(u.url);
    return { error: 'Mise à jour automatique impossible ici : la page de la nouvelle version vient de s’ouvrir.' };
  }
}

// ---------------------------------------------------------------- démarrage
function fonctionsSysteme() {
  return {
    choisirFichier: async ({ titre, filtres }) => {
      const r = await dialog.showOpenDialog(fenetre ?? undefined, { title: titre, properties: ['openFile'], filters: filtres });
      return r.canceled ? null : (r.filePaths[0] ?? null);
    },
    choisirDossier: async ({ titre }) => {
      const r = await dialog.showOpenDialog(fenetre ?? undefined, { title: titre, properties: ['openDirectory', 'createDirectory'] });
      return r.canceled ? null : (r.filePaths[0] ?? null);
    },
    ouvrirDossier: (dossier) => {
      shell.openPath(dossier).then((erreur) => {
        if (erreur) etat.journal('WARN', `Ouverture du dossier impossible : ${dossier} : ${erreur}`);
      });
    },
    montrerFichier: (fichier) => shell.showItemInFolder(fichier),
    ouvrirLien: (url) => {
      if (/^https:\/\//.test(url)) shell.openExternal(url);
    },
    basculer,
    capturer,
    pleinEcran: (actif) => {
      if (!fenetre) return 'pas de fenetre';
      fenetre.setFullScreen(actif);
      return 'ok';
    },
    verifierMaj,
    installerMaj,
    bureau: () => app.getPath('desktop'),
    infos: () => ({
      Electron: process.versions.electron,
      Chromium: process.versions.chrome,
      Paquet: process.env.APPIMAGE ? 'AppImage' : app.isPackaged ? 'installe' : 'developpement',
      Session: process.env.XDG_SESSION_TYPE || process.platform,
    }),
    idDiscordIntegre: () => ID_DISCORD_INTEGRE,
    discordConnecte: () => Boolean(discord?.connecte()),
    surIdDiscord: () => {
      discord?.fermer('');
      discord?.tick();
    },
    surPrefs: () => discord?.tick(),
  };
}

let arretEnCours = false;
function quitter() {
  // La boucle de chaque seconde et la fermeture de la fenêtre peuvent arriver ensemble.
  if (arretEnCours) return;
  arretEnCours = true;
  if (!etat) return app.quit();
  for (const id of etat.enCours.keys()) ajouterTemps(etat, id);
  enregistrerBibliotheque(etat);
  discord?.fermer('');
  arreterManettes();
  etat.journal('INFO', 'Arret de Rift Launcher.');
  app.quit();
}

function demarrer() {
  etat = creerEtat({
    donnees: DONNEES,
    racineApp: RACINE,
    version: app.getVersion(),
    systeme: fonctionsSysteme(),
    captures: path.join(app.getPath('pictures'), 'Rift Launcher'),
  });
  const { journal } = etat;
  journal.tourner();
  journal.detaille(prefsDe(etat).debugLog);
  journal('INFO', `===== Rift Launcher ${etat.version} demarre =====`);
  journal(
    'INFO',
    `Systeme : ${nomDuSysteme()} | Electron ${process.versions.electron} | session ${process.env.XDG_SESSION_TYPE || process.platform}`,
  );
  journal('INFO', `Appli : ${RACINE} | Donnees : ${DONNEES}`);
  chargerBibliotheque(etat);
  ecrireLisezmoi(etat.dossiers);
  journal('INFO', `Bibliotheque : ${etat.jeux.length} jeu(x) : ${etat.jeux.map((j) => j.name).join(', ')}`);

  const appeler = creerApi(etat);
  protocol.handle(SCHEMA, (requete) => {
    try {
      return servir(requete);
    } catch (err) {
      journal.erreur(`Requete ${requete.url}`, err);
      return new Response('erreur', { status: 500 });
    }
  });
  ipcMain.handle('rift:api', (evenement, nom, corps) => {
    // Seule l'interface de l'application peut piloter le launcher.
    if (!String(evenement.senderFrame?.url ?? '').startsWith(`${ORIGINE}/`)) return { error: 'forbidden' };
    return appeler(String(nom), corps);
  });

  discord = new StatutDiscord(etat, {
    prefs: () => prefsDe(etat),
    idPerso: () => chargerReglages(etat.dossiers.reglages).discordId,
    fenetreOuverte: () => Boolean(fenetre),
  });
  etat.auChangement = () => discord.tick();

  if (process.platform === 'linux') {
    const { demarrerManettesLinux } = require('./manettes-linux');
    arreterManettes = demarrerManettesLinux({
      journal,
      surAppui: (bouton) => {
        const prefs = prefsDe(etat);
        if (bouton === 'home' && prefs.homeToggle) journal('INFO', `[manette] Home : ${basculer()}`);
        if (bouton === 'capture' && prefs.captureButton) capturer();
      },
    });
  }

  creerFenetre();
  lancerVerifications(etat, false, prefsDe(etat));
  verifierMaj();

  // Mises à jour automatiques des portages (si activées) : au plus une passe par minute.
  let majAutoEnCours = false;
  let derniereMajAuto = 0;
  const passeMajAuto = () => {
    if (majAutoEnCours || Date.now() - derniereMajAuto < 60000) return;
    derniereMajAuto = Date.now();
    majAutoEnCours = true;
    majAutomatiques(etat, prefsDe(etat), {
      enregistrer: () => enregistrerBibliotheque(etat),
      annoncer: (jeu, version) => {
        if (Notification.isSupported()) {
          new Notification({
            title: 'Rift Launcher',
            body: `${jeu.name} est à jour : v${version}`,
            icon: path.join(RACINE, 'icone.png'),
          }).show();
        }
      },
    })
      .catch((err) => journal.erreur('Mises a jour automatiques', err))
      .finally(() => {
        majAutoEnCours = false;
      });
  };

  setInterval(() => {
    suivreJeux(etat, () => enregistrerBibliotheque(etat));
    passeMajAuto();
    discord.tick();
    if (Date.now() > (etat.prochaineVerifPortages ?? 0)) lancerVerifications(etat, true, prefsDe(etat));
    // Fenêtre fermée et plus aucun jeu en cours : on s'arrête.
    if (!fenetre && etat.enCours.size === 0) quitter();
  }, 1000);
}

if (app.requestSingleInstanceLock()) {
  app.on('second-instance', () => etat && mettreDevant());
  // Fenêtre fermée pendant une partie : on reste ouvert pour compter le temps de jeu.
  app.on('window-all-closed', () => {
    if (!etat || etat.enCours.size === 0) quitter();
  });
  app.whenReady().then(demarrer);
} else {
  app.quit();
}

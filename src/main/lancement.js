'use strict';
// Lancement des jeux, suivi du temps de jeu et arrêt.
const { spawn, execFile } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { estFichier } = require('./licences');
const { lireEmulateurs } = require('./emulateurs');

// Variables d'environnement du jeu : une par ligne, CLE=valeur, # pour commenter.
function analyserEnv(texte) {
  const vars = {};
  for (const brute of String(texte ?? '').split(/\r?\n/)) {
    const ligne = brute.trim();
    if (!ligne || ligne.startsWith('#')) continue;
    const egal = ligne.indexOf('=');
    if (egal <= 0) continue;
    vars[ligne.slice(0, egal).trim()] = ligne.slice(egal + 1).trim();
  }
  return vars;
}

// Arguments sous Linux, découpés comme le ferait un shell : guillemets simples
// et doubles, barre oblique inverse pour échapper un caractère.
function decouperArguments(texte) {
  const args = [];
  let courant = '';
  let enCours = false;
  let guillemet = null;
  const s = String(texte ?? '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (guillemet === "'") {
      if (c === "'") guillemet = null;
      else courant += c;
      continue;
    }
    if (guillemet === '"') {
      if (c === '"') guillemet = null;
      else if (c === '\\' && i + 1 < s.length && '"\\$`'.includes(s[i + 1])) courant += s[++i];
      else courant += c;
      continue;
    }
    if (c === "'" || c === '"') {
      guillemet = c;
      enCours = true;
    } else if (c === '\\' && i + 1 < s.length) {
      courant += s[++i];
      enCours = true;
    } else if (/\s/.test(c)) {
      if (enCours) args.push(courant);
      courant = '';
      enCours = false;
    } else {
      courant += c;
      enCours = true;
    }
  }
  if (guillemet) throw new Error('Guillemet non fermé dans les arguments de lancement.');
  if (enCours) args.push(courant);
  return args;
}

// Arguments d'un émulateur : {jeu} est remplacé par le fichier du jeu (ROM, .xci…),
// ajouté à la fin s'il n'apparaît pas. Les arguments propres au jeu suivent.
function argumentsEmulateurLinux(modele, fichierJeu, argsJeu) {
  const jetons = decouperArguments(modele);
  const avecJeu = jetons.some((j) => j.includes('{jeu}'));
  const liste = jetons.map((j) => j.replaceAll('{jeu}', fichierJeu));
  if (!avecJeu) liste.push(fichierJeu);
  return [...liste, ...decouperArguments(argsJeu)];
}

function argumentsEmulateurWindows(modele, fichierJeu, argsJeu) {
  let texte = String(modele ?? '').trim();
  if (texte.includes('{jeu}')) texte = texte.replaceAll('"{jeu}"', `"${fichierJeu}"`).replaceAll('{jeu}', `"${fichierJeu}"`);
  else texte = `${texte} "${fichierJeu}"`.trim();
  return [texte, String(argsJeu ?? '').trim()].filter(Boolean).join(' ');
}

// Lanceurs possibles d'un jeu Windows sous Linux : '' (automatique), 'wine', 'umu'
// (Proton GE le plus récent, téléchargé par umu-launcher) ou 'proton:<dossier>'
// (une version de Proton déjà installée, Steam ou GE).
function lanceurWindowsSousLinux(lanceur, ext, outils) {
  if (ext !== '.exe') {
    const wine = outils.trouver(['wine']);
    return wine ? { fichier: wine, avant: ['cmd', '/c'], env: {} } : { erreur: 'Un .bat ou un .cmd a besoin de Wine : installe-le.' };
  }
  if (lanceur === 'wine') {
    const wine = outils.trouver(['wine']);
    return wine
      ? { fichier: wine, avant: [], env: {} }
      : { erreur: "Wine n'est pas installé : installe-le, ou choisis Proton pour ce jeu." };
  }
  if (lanceur === 'umu' || lanceur.startsWith('proton:')) {
    const umu = outils.trouver(['umu-run']);
    if (!umu) return { erreur: "Proton se lance avec umu-launcher, qui n'est pas installé : installe-le, ou choisis Wine pour ce jeu." };
    const env = { GAMEID: 'umu-default' };
    if (lanceur.startsWith('proton:')) env.PROTONPATH = lanceur.slice('proton:'.length);
    return { fichier: umu, avant: [], env };
  }
  // Automatique : Proton par umu-launcher s'il est là, sinon Wine.
  const umu = outils.trouver(['umu-run']);
  if (umu) return { fichier: umu, avant: [], env: { GAMEID: 'umu-default' } };
  const wine = outils.trouver(['wine']);
  if (wine) return { fichier: wine, avant: [], env: {} };
  return {
    erreur:
      'Ce jeu est un programme Windows. Installe Wine (ou umu-launcher pour Proton) pour le lancer sous Linux, ou prends la version Linux du portage.',
  };
}

// Ce qu'il faut exécuter pour lancer ce fichier, selon le système. Fonction pure :
// `outils.trouver(noms)` renvoie le premier programme disponible, `outils.executable(p)`
// dit si le fichier a le droit d'exécution. Avec un émulateur, `exePath` est le fichier
// du jeu (ROM, .xci…) et c'est l'émulateur qui est lancé.
function commandeDeLancement({ exePath, args, plateforme, outils, lanceur = '', emulateur = null }) {
  const programme = emulateur ? emulateur.exePath : exePath;
  const ext = path.extname(programme).toLowerCase();
  if (plateforme === 'win32') {
    // Les arguments sont passés tels qu'écrits, comme le faisait Start-Process.
    const brut = emulateur ? argumentsEmulateurWindows(emulateur.args, exePath, args) : String(args ?? '').trim();
    if (ext === '.bat' || ext === '.cmd') {
      return {
        fichier: outils.comspec || 'cmd.exe',
        arguments: ['/d', '/s', '/c', `""${programme}"${brut ? ` ${brut}` : ''}"`],
        options: { windowsVerbatimArguments: true },
        env: {},
      };
    }
    return {
      fichier: programme,
      arguments: brut ? [brut] : [],
      options: { windowsVerbatimArguments: true, argv0: `"${programme}"` },
      env: {},
    };
  }
  const liste = emulateur ? argumentsEmulateurLinux(emulateur.args, exePath, args) : decouperArguments(args);
  if (ext === '.exe' || ext === '.bat' || ext === '.cmd') {
    const l = lanceurWindowsSousLinux(String(lanceur ?? ''), ext, outils);
    if (l.erreur) return { erreur: l.erreur };
    return { fichier: l.fichier, arguments: [...l.avant, programme, ...liste], options: {}, env: l.env };
  }
  if (ext === '.sh' && !outils.executable(programme)) {
    return { fichier: outils.trouver(['bash', 'sh']) || 'sh', arguments: [programme, ...liste], options: {}, env: {} };
  }
  // Une AppImage téléchargée n'a jamais le droit d'exécution : on le lui donne.
  return { fichier: programme, arguments: liste, options: {}, env: {}, rendreExecutable: !outils.executable(programme) };
}

// Versions de Proton installées (Steam, GE-Proton, umu), pour le choix par jeu.
function protonsInstalles(maison = require('node:os').homedir()) {
  const racines = [
    '.steam/steam/compatibilitytools.d',
    '.steam/root/compatibilitytools.d',
    '.local/share/Steam/compatibilitytools.d',
    '.var/app/com.valvesoftware.Steam/data/Steam/compatibilitytools.d',
    '.steam/steam/steamapps/common',
    '.local/share/Steam/steamapps/common',
  ].map((r) => path.join(maison, r));
  const vus = new Map();
  for (const racine of racines) {
    let noms = [];
    try {
      noms = fs.readdirSync(racine);
    } catch {
      continue;
    }
    for (const nom of noms) {
      const dossier = path.join(racine, nom);
      if (!estFichier(path.join(dossier, 'proton'))) continue;
      let reel = dossier;
      try {
        reel = fs.realpathSync(dossier);
      } catch {
        // lien cassé : on garde le chemin tel quel
      }
      if (!vus.has(reel)) vus.set(reel, { nom, dossier });
    }
  }
  return [...vus.values()].sort((a, b) => b.nom.localeCompare(a.nom, undefined, { numeric: true }));
}

// Sous Linux, le launcher lui-même peut tourner en AppImage : ses variables ne
// doivent pas passer au jeu (une autre AppImage les confondrait avec les siennes).
function environnementDuJeu(base, vars, plateforme) {
  const env = { ...base };
  if (plateforme !== 'win32') for (const k of ['APPDIR', 'APPIMAGE', 'ARGV0', 'OWD']) delete env[k];
  return Object.assign(env, vars);
}

function outilsDuSysteme(plateforme) {
  const dossiers = String(process.env.PATH ?? '')
    .split(path.delimiter)
    .filter(Boolean);
  const executable = (p) => {
    try {
      fs.accessSync(p, fs.constants.X_OK);
      return true;
    } catch {
      return false;
    }
  };
  return {
    comspec: process.env.ComSpec,
    executable,
    trouver: (noms) => {
      for (const nom of noms) {
        for (const d of dossiers) {
          const complet = path.join(d, nom + (plateforme === 'win32' ? '.exe' : ''));
          if (estFichier(complet) && (plateforme === 'win32' || executable(complet))) return complet;
        }
      }
      return null;
    },
  };
}

function ajouterTemps(etat, id) {
  const r = etat.enCours.get(id);
  const jeu = etat.jeux.find((j) => j.id === id);
  if (!r || !jeu) return;
  const maintenant = Date.now();
  jeu.playSeconds = (Number(jeu.playSeconds) || 0) + (maintenant - r.dernierTick) / 1000;
  r.dernierTick = maintenant;
  jeu.lastPlayed = maintenant;
}

function nomDeFichierSur(nom) {
  const n = String(nom ?? '')
    // biome-ignore lint/suspicious/noControlCharactersInRegex: les caractères de contrôle sont justement à retirer
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .trim();
  return n || 'jeu';
}

async function demarrerJeu(etat, id, { enregistrer, outils = outilsDuSysteme(etat.plateforme), lancer = spawn } = {}) {
  const jeu = etat.jeux.find((j) => j.id === id);
  if (!jeu) return { error: 'Jeu introuvable.' };
  if (etat.enCours.has(id)) return { error: 'Ce jeu est déjà lancé.' };
  if (etat.installations?.has(id)) return { error: 'Ce jeu est en train de se mettre à jour : attends la fin.' };
  if (!estFichier(jeu.exePath)) {
    etat.journal('WARN', `Lancement impossible, fichier introuvable : ${jeu.name} | "${jeu.exePath}"`);
    return { error: 'Le fichier du jeu est introuvable. Règle son emplacement dans les paramètres du jeu.' };
  }
  // Jeu lancé par un émulateur déclaré dans les réglages.
  let emulateur = null;
  if (jeu.emulator) {
    emulateur = lireEmulateurs(etat.dossiers.reglages).find((e) => e.id === jeu.emulator) ?? null;
    if (!emulateur) return { error: "L'émulateur choisi pour ce jeu n'existe plus. Choisis-en un autre dans ses paramètres." };
    if (!estFichier(emulateur.exePath)) {
      return { error: `Le programme de l'émulateur ${emulateur.name} est introuvable. Règle-le dans Réglages → Émulateurs.` };
    }
  }
  let commande;
  try {
    commande = commandeDeLancement({
      exePath: jeu.exePath,
      args: jeu.args,
      plateforme: etat.plateforme,
      outils,
      lanceur: jeu.runner,
      emulateur,
    });
  } catch (err) {
    return { error: err.message };
  }
  if (commande.erreur) return { error: commande.erreur };
  if (commande.rendreExecutable) {
    try {
      fs.chmodSync(commande.fichier, fs.statSync(commande.fichier).mode | 0o100);
      etat.journal('INFO', `Droit d'execution donne a ${commande.fichier}`);
    } catch (err) {
      return { error: `Le fichier du jeu n'est pas exécutable et je ne peux pas le rendre exécutable : ${err.message}` };
    }
  }
  const vars = analyserEnv(jeu.env);
  // La sortie du jeu va dans logs/jeux/<nom>.log : c'est souvent là qu'on comprend un plantage.
  let sortie = 'ignore';
  try {
    sortie = fs.openSync(path.join(etat.dossiers.journauxJeux, `${nomDeFichierSur(jeu.name)}.log`), 'w');
  } catch {
    // pas de journal du jeu : on lance quand même
  }
  let proc;
  try {
    proc = lancer(commande.fichier, commande.arguments, {
      cwd: path.dirname(emulateur ? emulateur.exePath : jeu.exePath),
      env: environnementDuJeu(process.env, { ...commande.env, ...vars }, etat.plateforme),
      detached: etat.plateforme !== 'win32', // groupe de processus à part, pour tout arrêter d'un coup
      stdio: ['ignore', sortie, sortie],
      ...commande.options,
    });
  } catch (err) {
    if (typeof sortie === 'number') fs.closeSync(sortie);
    etat.journal.erreur(`Lancement de ${jeu.name}`, err);
    return { error: `Impossible de lancer le jeu : ${err.message}` };
  }
  if (typeof sortie === 'number') fs.closeSync(sortie);
  // Un programme introuvable ne lève pas d'exception : il signale l'erreur juste après.
  if (proc.pid === undefined) {
    const err = await new Promise((resolve) => {
      proc.once('error', resolve);
      setTimeout(() => resolve(new Error('le système a refusé de le démarrer')), 2000);
    });
    etat.journal('ERROR', `Lancement de ${jeu.name} : ${err.message}`);
    return { error: `Impossible de lancer le jeu : ${err.message}` };
  }
  const maintenant = Date.now();
  const suivi = { proc, debut: maintenant, dernierTick: maintenant, arretDemande: false, fini: null };
  proc.on('error', (err) => etat.journal('WARN', `${jeu.name} : ${err.message}`));
  proc.on('exit', (code, signal) => {
    suivi.fini = { code, signal };
  });
  etat.enCours.set(id, suivi);
  const lignes = [`"${jeu.exePath}"`, `arguments : ${jeu.args}`, `variables : ${Object.keys(vars).join(', ')}`, `PID ${proc.pid}`];
  if (commande.fichier !== jeu.exePath) lignes.unshift(`via ${commande.fichier}`);
  etat.journal('INFO', `Lancement : ${jeu.name} | ${lignes.join(' | ')}`);
  jeu.sessions = (Number(jeu.sessions) || 0) + 1;
  jeu.lastPlayed = maintenant;
  enregistrer?.();
  etat.auChangement();
  return { ok: true };
}

function arreterJeu(etat, id) {
  const r = etat.enCours.get(id);
  if (!r || r.fini) return { ok: true };
  r.arretDemande = true;
  const nom = etat.jeux.find((j) => j.id === id)?.name;
  etat.journal('INFO', `Arret demande par l'utilisateur : ${nom}`);
  if (etat.plateforme === 'win32') {
    // /T ferme aussi les processus enfants (jeu lancé par un .bat)
    execFile('taskkill.exe', ['/PID', String(r.proc.pid), '/T', '/F'], () => {});
    return { ok: true };
  }
  const signaler = (signal) => {
    try {
      process.kill(-r.proc.pid, signal); // tout le groupe : Wine, scripts, enfants
    } catch {
      try {
        r.proc.kill(signal);
      } catch {
        // déjà fermé
      }
    }
  };
  signaler('SIGTERM');
  setTimeout(() => {
    if (!r.fini) signaler('SIGKILL');
  }, 5000).unref?.();
  return { ok: true };
}

// Appelée chaque seconde : repère les jeux fermés et enregistre le temps de jeu.
function suivreJeux(etat, enregistrer) {
  let change = false;
  let termine = false;
  for (const [id, r] of [...etat.enCours]) {
    const jeu = etat.jeux.find((j) => j.id === id);
    if (r.fini) {
      ajouterTemps(etat, id);
      const secondes = Math.round((Date.now() - r.debut) / 1000);
      const code = r.fini.code ?? (r.fini.signal || '?');
      if (r.arretDemande) {
        etat.journal('INFO', `Fermeture : ${jeu?.name} | arrete depuis Rift Launcher | ${secondes} s de jeu`);
      } else {
        etat.journal('INFO', `Fermeture : ${jeu?.name} | code de sortie ${code} | ${secondes} s de jeu`);
        if (code !== 0 && code !== '?') {
          etat.journal('WARN', `${jeu?.name} s'est ferme avec le code ${code} (erreur ou plantage du jeu ?)`);
        }
        if (secondes < 10) {
          etat.journal('WARN', `${jeu?.name} s'est ferme ${secondes} s apres le lancement : plantage au demarrage possible.`);
        }
      }
      etat.enCours.delete(id);
      change = true;
      termine = true;
    } else if (Date.now() - r.dernierTick >= 30000) {
      ajouterTemps(etat, id); // enregistré régulièrement en cas de plantage
      change = true;
    }
  }
  if (change) enregistrer();
  if (termine) etat.auChangement();
}

// Le jeu lancé le plus récemment (pour Discord et le bouton Home).
function dernierJeuLance(etat) {
  let meilleur = null;
  for (const [id, r] of etat.enCours) if (!meilleur || r.debut > meilleur.debut) meilleur = { id, debut: r.debut };
  return meilleur?.id ?? '';
}

module.exports = {
  analyserEnv,
  decouperArguments,
  commandeDeLancement,
  environnementDuJeu,
  outilsDuSysteme,
  demarrerJeu,
  arreterJeu,
  suivreJeux,
  ajouterTemps,
  dernierJeuLance,
  nomDeFichierSur,
  protonsInstalles,
};

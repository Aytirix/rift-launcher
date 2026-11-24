'use strict';
// Lancement des jeux, suivi du temps de jeu et arrêt.
const { spawn, execFile } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { estFichier } = require('./licences');

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

// Ce qu'il faut exécuter pour lancer ce fichier, selon le système. Fonction pure :
// `outils.trouver(noms)` renvoie le premier programme disponible, `outils.executable(p)`
// dit si le fichier a le droit d'exécution.
function commandeDeLancement({ exePath, args, plateforme, outils }) {
  const ext = path.extname(exePath).toLowerCase();
  const brut = String(args ?? '').trim();
  if (plateforme === 'win32') {
    // Les arguments sont passés tels qu'écrits, comme le faisait Start-Process.
    if (ext === '.bat' || ext === '.cmd') {
      return {
        fichier: outils.comspec || 'cmd.exe',
        arguments: ['/d', '/s', '/c', `""${exePath}"${brut ? ` ${brut}` : ''}"`],
        options: { windowsVerbatimArguments: true },
      };
    }
    return {
      fichier: exePath,
      arguments: brut ? [brut] : [],
      options: { windowsVerbatimArguments: true, argv0: `"${exePath}"` },
    };
  }
  const liste = decouperArguments(brut);
  if (ext === '.exe' || ext === '.bat' || ext === '.cmd') {
    // Jeu Windows sous Linux : Proton par umu-launcher s'il est là, sinon Wine.
    const lanceur = ext === '.exe' ? outils.trouver(['umu-run', 'wine']) : outils.trouver(['wine']);
    if (!lanceur) {
      return {
        erreur:
          'Ce jeu est un programme Windows. Installe Wine (ou umu-launcher pour Proton) pour le lancer sous Linux, ou prends la version Linux du portage.',
      };
    }
    if (ext === '.exe') return { fichier: lanceur, arguments: [exePath, ...liste], options: {} };
    return { fichier: lanceur, arguments: ['cmd', '/c', exePath, ...liste], options: {} };
  }
  if (ext === '.sh' && !outils.executable(exePath)) {
    return { fichier: outils.trouver(['bash', 'sh']) || 'sh', arguments: [exePath, ...liste], options: {} };
  }
  // Une AppImage téléchargée n'a jamais le droit d'exécution : on le lui donne.
  return { fichier: exePath, arguments: liste, options: {}, rendreExecutable: !outils.executable(exePath) };
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
  if (!estFichier(jeu.exePath)) {
    etat.journal('WARN', `Lancement impossible, fichier introuvable : ${jeu.name} | "${jeu.exePath}"`);
    return { error: 'Le fichier du jeu est introuvable. Règle son emplacement dans les paramètres du jeu.' };
  }
  let commande;
  try {
    commande = commandeDeLancement({ exePath: jeu.exePath, args: jeu.args, plateforme: etat.plateforme, outils });
  } catch (err) {
    return { error: err.message };
  }
  if (commande.erreur) return { error: commande.erreur };
  if (commande.rendreExecutable) {
    try {
      fs.chmodSync(jeu.exePath, fs.statSync(jeu.exePath).mode | 0o100);
      etat.journal('INFO', `Droit d'execution donne a ${jeu.exePath}`);
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
      cwd: path.dirname(jeu.exePath),
      env: environnementDuJeu(process.env, vars, etat.plateforme),
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
};

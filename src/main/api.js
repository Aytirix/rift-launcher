'use strict';
// Les commandes appelées par l'interface (les mêmes noms que les routes /api/... de
// RiftLauncher.ps1). Tout ce qui touche au système passe par `etat.systeme`.
const fs = require('node:fs');
const path = require('node:path');
const { CHAMPS_EDITION, nouveauJeu, trouverJeu, enregistrerBibliotheque, instantane, prefsDe } = require('./bibliotheque');
const { LICENCES, resoudreJaquette, resoudreSons, estFichier, estDossier } = require('./licences');
const { chargerReglages, enregistrerReglages, enregistrerPrefs } = require('./reglages');
const { demarrerJeu, arreterJeu, nomDeFichierSur } = require('./lancement');
const { sauvegarder, dossierSauvegardesDu } = require('./sauvegardes');
const { listerMods, changerMod } = require('./mods');
const jaquettes = require('./jaquettes');
const { lancerVerifications, verifierMaintenant, vuePortage } = require('./portages');
const { creerRapport } = require('./rapport');
const { installerPortage, revenirVersion } = require('./maj-portages');

const texte = (v) => (v === undefined || v === null ? '' : String(v));

function filtresJeu(plateforme) {
  if (plateforme === 'win32') {
    return [
      { name: 'Jeux (*.exe;*.bat;*.cmd)', extensions: ['exe', 'bat', 'cmd'] },
      { name: 'Tous les fichiers', extensions: ['*'] },
    ];
  }
  // Sous Linux, un programme n'a souvent pas d'extension : « Tous » d'abord.
  return [
    { name: 'Tous les fichiers', extensions: ['*'] },
    { name: 'AppImage, scripts et jeux Windows', extensions: ['AppImage', 'appimage', 'sh', 'x86_64', 'exe', 'bat'] },
  ];
}

// Fichier à servir pour /img?id=… et /snd?id=…&n=…
function fichierRessource(etat, chemin, params) {
  const jeu = trouverJeu(etat, texte(params.get('id')));
  if (!jeu) return null;
  if (chemin === '/img') return resoudreJaquette(etat.dossiers, jeu)?.path ?? null;
  if (chemin === '/snd') {
    const sons = resoudreSons(etat.dossiers, jeu);
    const n = Number.parseInt(texte(params.get('n')), 10) || 0;
    return sons && n >= 0 && n < sons.paths.length ? sons.paths[n] : null;
  }
  return null;
}

function creerApi(etat) {
  const sys = etat.systeme;
  const enregistrer = () => enregistrerBibliotheque(etat);
  const jeuDe = (corps) => trouverJeu(etat, texte(corps?.id));

  const commandes = {
    library: () => instantane(etat),

    save: (c) => {
      const nom = texte(c.name).trim();
      if (!nom) return { error: 'Donne un nom au jeu.' };
      const existant = c.id ? trouverJeu(etat, texte(c.id)) : null;
      if (existant) {
        for (const champ of CHAMPS_EDITION) existant[champ] = texte(c[champ]).trim();
      } else {
        const frais = {};
        for (const champ of CHAMPS_EDITION) frais[champ] = c[champ];
        etat.jeux.push(nouveauJeu(frais, false));
      }
      enregistrer();
      lancerVerifications(etat, false, prefsDe(etat));
      return instantane(etat);
    },

    delete: (c) => {
      if (etat.enCours.has(texte(c.id))) return { error: 'Ferme le jeu avant de le retirer.' };
      const jeu = jeuDe(c);
      if (jeu) {
        etat.jeux.splice(etat.jeux.indexOf(jeu), 1);
        enregistrer();
      }
      return instantane(etat);
    },

    play: (c) => demarrerJeu(etat, texte(c.id), { enregistrer }),
    stop: (c) => arreterJeu(etat, texte(c.id)),

    backup: (c) => {
      try {
        const r = sauvegarder(etat, texte(c.id));
        etat.journal(r.ok ? 'INFO' : 'WARN', `Sauvegarde : ${r.ok ? r.path : r.error}`);
        return r;
      } catch (err) {
        etat.journal.erreur('Sauvegarde', err);
        return { error: err.message };
      }
    },

    openBackups: (c) => {
      const jeu = jeuDe(c);
      if (jeu) {
        const dossier = dossierSauvegardesDu(etat, jeu);
        fs.mkdirSync(dossier, { recursive: true });
        sys.ouvrirDossier(dossier);
      }
      return { ok: true };
    },

    openFolder: (c) => {
      const jeu = jeuDe(c);
      if (jeu && estFichier(jeu.exePath)) sys.montrerFichier(jeu.exePath);
      return { ok: true };
    },

    openRepo: (c) => {
      const jeu = jeuDe(c);
      if (jeu && /^https:\/\//.test(jeu.repoUrl)) sys.ouvrirLien(jeu.repoUrl);
      return { ok: true };
    },

    mods: (c) => listerMods(etat, texte(c.id)),
    modSet: (c) => changerMod(etat, texte(c.id), texte(c.name), Boolean(c.enabled)),
    openMods: (c) => {
      const jeu = jeuDe(c);
      if (jeu && estDossier(jeu.modsDir)) sys.ouvrirDossier(jeu.modsDir);
      return { ok: true };
    },

    pick: async (c) => {
      if (c.kind === 'exe') {
        return { path: await sys.choisirFichier({ titre: 'Choisir le jeu', filtres: filtresJeu(etat.plateforme) }) };
      }
      const titre = c.kind === 'mods' ? 'Choisir le dossier des mods du jeu' : 'Choisir le dossier de sauvegarde du jeu';
      return { path: await sys.choisirDossier({ titre }) };
    },

    coverPick: (c) => jaquettes.choisirJaquette(etat, texte(c.id), enregistrer),
    soundPick: (c) => jaquettes.choisirSon(etat, texte(c.id), enregistrer),
    assetClear: (c) => jaquettes.effacer(etat, texte(c.id), texte(c.kind), enregistrer),
    coverSearch: (c) => jaquettes.chercherJaquettes(etat, texte(c.term), texte(c.sgdbId)),
    coverDownload: (c) => jaquettes.telechargerJaquette(etat, texte(c.id), texte(c.url), enregistrer),

    settings: () => {
      const reglages = chargerReglages(etat.dossiers.reglages);
      const integre = sys.idDiscordIntegre?.() ?? '';
      return {
        appVersion: etat.version,
        logDir: etat.dossiers.journaux,
        prefs: prefsDe(etat),
        hasKey: Boolean(reglages.sgdbKey),
        discordId: texte(reglages.discordId),
        discordBuiltin: Boolean(integre),
        discordBuiltinId: integre,
        discordConnected: Boolean(sys.discordConnecte?.()),
        coverDir: etat.dossiers.jaquettes,
        soundDir: etat.dossiers.sons,
        franchises: LICENCES.map((l) => ({ key: l.key, label: l.label })),
      };
    },

    settingsSave: (c) => {
      const reglages = chargerReglages(etat.dossiers.reglages);
      if (c.sgdbKey !== undefined && c.sgdbKey !== null) reglages.sgdbKey = texte(c.sgdbKey).trim();
      let idDiscord = null;
      if (c.discordId !== undefined && c.discordId !== null) {
        idDiscord = texte(c.discordId).trim();
        if (idDiscord && !/^\d{15,22}$/.test(idDiscord)) return { error: "L'ID Discord est un nombre de 17 à 20 chiffres." };
        reglages.discordId = idDiscord;
      }
      enregistrerReglages(etat.dossiers.reglages, reglages);
      if (idDiscord !== null) sys.surIdDiscord?.();
      return { ok: true, hasKey: Boolean(reglages.sgdbKey) };
    },

    prefsSave: (c) => {
      const avant = prefsDe(etat);
      const prefs = enregistrerPrefs(etat.dossiers.reglages, c.prefs);
      etat.journal.detaille(prefs.debugLog);
      if (prefs.recompCheck && !avant.recompCheck) lancerVerifications(etat, false, prefs);
      sys.surPrefs?.(prefs, avant);
      etat.journal(
        'INFO',
        `Reglages : ${Object.entries(prefs)
          .map(([k, v]) => `${k}=${v}`)
          .join(', ')}`,
      );
      return { ok: true, prefs };
    },

    log: (c) => {
      const niveau = ['INFO', 'WARN', 'ERROR'].includes(c.level) ? c.level : 'ERROR';
      let message = texte(c.message);
      if (c.stack) message += ` | ${texte(c.stack).replace(/\r?\n/g, ' <- ')}`;
      if (message.length > 2000) message = `${message.slice(0, 2000)}...`;
      etat.journal(niveau, `[interface] ${message}`);
      return { ok: true };
    },

    report: () => {
      try {
        const zip = creerRapport(etat, { bureau: sys.bureau(), infosPlateforme: sys.infos?.() ?? {} });
        sys.montrerFichier(zip);
        return { ok: true, path: zip };
      } catch (err) {
        etat.journal.erreur('Creation du rapport', err);
        return { error: `Impossible de créer le rapport : ${err.message}` };
      }
    },

    version: () => ({ version: etat.version }),
    updateCheck: () => sys.verifierMaj(),
    updateInstall: () => {
      if (etat.enCours.size) return { error: 'Ferme ton jeu avant de mettre à jour Rift Launcher.' };
      return sys.installerMaj();
    },
    recompCheck: () => verifierMaintenant(etat, prefsDe(etat)),

    toggleFocus: () => ({ ok: true, result: sys.basculer() }),
    capture: async () => {
      const fichier = await sys.capturer();
      return { ok: Boolean(fichier), file: fichier ? path.basename(fichier) : '' };
    },
    openCaptures: (c) => {
      let dossier = etat.captures;
      const jeu = c.id ? jeuDe(c) : null;
      if (jeu) dossier = path.join(etat.captures, nomDeFichierSur(jeu.name).replace(/\.+$/, ''));
      fs.mkdirSync(dossier, { recursive: true });
      sys.ouvrirDossier(dossier);
      return { ok: true };
    },
    fullscreen: (c) => {
      const r = sys.pleinEcran(Boolean(c.on));
      etat.journal('INFO', `Plein ecran (Big Picture, ${c.on ? 'entree' : 'sortie'}) : ${r}`);
      return { ok: true, result: r };
    },

    recompDone: (c) => {
      const jeu = jeuDe(c);
      const vue = jeu ? vuePortage(etat, jeu) : null;
      if (!vue) return { error: 'Aucune version trouvée pour ce jeu.' };
      jeu.version = vue.latest.replace(/^[vV](?=\d)/, '');
      enregistrer();
      etat.journal('INFO', `Portage de ${jeu.name} marque a jour : ${jeu.version}`);
      return { ok: true };
    },
    recompInstall: async (c) => {
      const jeu = jeuDe(c);
      const r = await installerPortage(etat, texte(c.id), { enregistrer });
      // Quand l'installation automatique renonce, la page de la version s'ouvre :
      // le joueur peut la faire à la main.
      if (r.ouvrirPage) {
        const vue = jeu ? vuePortage(etat, jeu) : null;
        if (vue && /^https:\/\/github\.com\//.test(vue.url)) sys.ouvrirLien(vue.url);
        return { error: `${r.error} La page de la version s'ouvre pour l'installer à la main.` };
      }
      return r;
    },
    recompRollback: (c) => revenirVersion(etat, texte(c.id), texte(c.key), { enregistrer }),
    recompOpen: (c) => {
      const jeu = jeuDe(c);
      const vue = jeu ? vuePortage(etat, jeu) : null;
      if (vue && /^https:\/\/github\.com\//.test(vue.url)) sys.ouvrirLien(vue.url);
      return { ok: Boolean(vue) };
    },

    openLogs: () => {
      sys.ouvrirDossier(etat.dossiers.journaux);
      return { ok: true };
    },
    openAssets: (c) => {
      sys.ouvrirDossier(c.kind === 'sounds' ? etat.dossiers.sons : etat.dossiers.jaquettes);
      return { ok: true };
    },
    bye: () => ({ ok: true }),
  };

  return async function appeler(nom, corps) {
    const commande = Object.hasOwn(commandes, nom) ? commandes[nom] : null;
    if (!commande) return { error: 'not found' };
    const c = corps && typeof corps === 'object' ? corps : {};
    if (nom !== 'library' && nom !== 'log') {
      etat.journal('DEBUG', `API ${nom}${c.id ? ` (jeu ${c.id})` : ''}`);
    }
    try {
      return await commande(c);
    } catch (err) {
      etat.journal.erreur(`Commande ${nom}`, err);
      return { error: err.message };
    }
  };
}

module.exports = { creerApi, fichierRessource, filtresJeu };

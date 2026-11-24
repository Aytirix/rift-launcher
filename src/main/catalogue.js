'use strict';
// Catalogue « Installer un portage » : le joueur choisit dans une liste de portages
// et d'émulateurs connus ; Rift Launcher télécharge la dernière version, l'installe
// dans son dossier de jeux et crée la fiche toute réglée (programme, page GitHub,
// version, licence). Les données du catalogue sont dans src/catalogue.json.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { nouveauJeu } = require('./bibliotheque');
const { lireEmulateurs, enregistrerEmulateur } = require('./emulateurs');
const { estFichier } = require('./licences');
const { choisirFichier, telecharger, extraireTout, trouverProgramme, deplacer, typeDeFichier } = require('./maj-portages');
const { lireGitHub } = require('./portages');
const { chargerReglages, enregistrerReglages } = require('./reglages');
const { depotDe } = require('./versions');

function lireCatalogue(etat) {
  try {
    return JSON.parse(fs.readFileSync(path.join(etat.dossiers.app, 'catalogue.json'), 'utf8')).entrees ?? [];
  } catch (err) {
    etat.journal('ERROR', `Catalogue illisible : ${err.message}`);
    return [];
  }
}

function dossierJeux(etat) {
  const choisi = String(chargerReglages(etat.dossiers.reglages).dossierJeux ?? '');
  return choisi || path.join(os.homedir(), 'Jeux');
}

function changerDossierJeux(etat, dossier) {
  const reglages = chargerReglages(etat.dossiers.reglages);
  reglages.dossierJeux = dossier;
  enregistrerReglages(etat.dossiers.reglages, reglages);
}

const cleInstallation = (id) => `catalogue:${id}`;

function vueCatalogue(etat) {
  const emulateurs = lireEmulateurs(etat.dossiers.reglages);
  const base = dossierJeux(etat);
  return lireCatalogue(etat).map((e) => {
    const installe =
      e.type === 'emulateur'
        ? emulateurs.some((m) => m.exePath.startsWith(path.join(base, e.dossier) + path.sep) || m.name === (e.nomCourt ?? e.name))
        : etat.jeux.some((j) => depotDe(j.repoUrl) === e.repo);
    const suivi = etat.installations.get(cleInstallation(e.id));
    return {
      id: e.id,
      name: e.name,
      type: e.type,
      franchise: e.franchise ?? '',
      description: e.description,
      need: e.besoin,
      installed: installe,
      manual: e.programme?.[etat.plateforme] ? '' : (e.page?.[etat.plateforme] ?? 'Pas de version pour ton système.'),
      installing: suivi ? { step: suivi.etape, percent: suivi.pourcentage, file: suivi.fichier } : null,
      url: `https://github.com/${e.repo}`,
    };
  });
}

async function installerDepuisCatalogue(etat, id, { enregistrer, arch = process.arch }) {
  const entree = lireCatalogue(etat).find((e) => e.id === id);
  if (!entree) return { error: 'Ce portage n’est pas dans le catalogue.' };
  // Sans programme pour ce système, sa « page » dit pourquoi (assistant, Flatpak…).
  const voulu = entree.programme?.[etat.plateforme];
  if (!voulu) return { error: entree.page?.[etat.plateforme] || 'Pas de version de ce portage pour ton système.', ouvrirPage: true };
  const cle = cleInstallation(id);
  if (etat.installations.has(cle)) return { error: 'Installation déjà en cours.' };
  const dest = path.join(dossierJeux(etat), entree.dossier);
  // On n'installe jamais par-dessus un dossier existant : il peut contenir une
  // installation faite à la main, avec ses sauvegardes.
  if (fs.existsSync(dest) && fs.readdirSync(dest).length) {
    return {
      error: `Le dossier « ${dest} » existe déjà et n'est pas vide : ajoute ce jeu à la main, ou choisis un autre dossier de jeux.`,
    };
  }
  const suivi = { enCours: true, etape: 'recherche', pourcentage: 0, fichier: '' };
  etat.installations.set(cle, suivi);
  const temporaire = path.join(etat.dossiers.donnees, 'telechargements');
  const telecharge = path.join(temporaire, `${cle.replace(':', '-')}.part`);
  const extrait = path.join(temporaire, `${cle.replace(':', '-')}-extrait`);
  fs.mkdirSync(temporaire, { recursive: true });
  fs.rmSync(extrait, { recursive: true, force: true });
  let cree = false;
  try {
    const release = await lireGitHub(etat, `/repos/${entree.repo}/releases/latest`);
    if (!release) return { error: "Ce portage n'a publié aucune version.", ouvrirPage: true };
    const fichiers = [].concat(release.assets ?? []).map((a) => ({
      name: String(a.name ?? ''),
      size: Number(a.size) || 0,
      url: String(a.browser_download_url ?? ''),
      digest: String(a.digest ?? ''),
    }));
    const choix = choisirFichier(fichiers, { plateforme: etat.plateforme, arch, exePath: voulu });
    if (!choix.fichier) return { error: choix.raison, ouvrirPage: true };
    suivi.etape = 'telechargement';
    suivi.fichier = choix.fichier.name;
    etat.journal('INFO', `Catalogue : installation de ${entree.name} ${release.tag_name} | ${choix.fichier.name} -> ${dest}`);
    await telecharger(etat, choix.fichier, telecharge, (p) => {
      suivi.pourcentage = p;
    });
    suivi.etape = 'installation';
    suivi.pourcentage = 100;
    let exePath;
    if (choix.type === 'appimage') {
      fs.mkdirSync(dest, { recursive: true });
      cree = true;
      exePath = path.join(dest, choix.fichier.name);
      deplacer(telecharge, exePath);
    } else {
      fs.mkdirSync(extrait);
      extraireTout(choix.type, fs.readFileSync(telecharge), extrait);
      const programme = trouverProgramme(extrait, voulu);
      if (!programme) return { error: `La version publiée ne contient pas « ${voulu} » : installe-la à la main.`, ouvrirPage: true };
      fs.mkdirSync(dest, { recursive: true });
      cree = true;
      fs.cpSync(path.dirname(programme), dest, { recursive: true, verbatimSymlinks: true });
      exePath = path.join(dest, path.relative(path.dirname(programme), programme));
    }
    if (etat.plateforme !== 'win32' && estFichier(exePath)) fs.chmodSync(exePath, fs.statSync(exePath).mode | 0o755);
    const version = String(release.tag_name ?? '').replace(/^[vV](?=\d)/, '');
    if (entree.type === 'emulateur') {
      enregistrerEmulateur(etat.dossiers.reglages, { name: entree.nomCourt ?? entree.name, exePath, args: entree.args ?? '' });
    } else {
      etat.jeux.push(
        nouveauJeu(
          { name: entree.name, exePath, repoUrl: `https://github.com/${entree.repo}`, version, franchise: entree.franchise ?? '' },
          false,
        ),
      );
      enregistrer();
    }
    etat.journal('INFO', `Catalogue : ${entree.name} installe (${exePath})`);
    return {
      ok: true,
      type: entree.type,
      name: entree.name,
      version,
      exePath,
      need: entree.besoin,
      typeFichier: typeDeFichier(choix.fichier.name),
    };
  } catch (err) {
    etat.journal.erreur(`Catalogue : installation de ${entree.name}`, err);
    // Une installation ratée ne laisse pas un dossier à moitié rempli.
    if (cree) fs.rmSync(dest, { recursive: true, force: true });
    return { error: `Installation impossible : ${err.message}`, ouvrirPage: true };
  } finally {
    etat.installations.delete(cle);
    fs.rmSync(telecharge, { force: true });
    fs.rmSync(extrait, { recursive: true, force: true });
  }
}

module.exports = { lireCatalogue, vueCatalogue, installerDepuisCatalogue, dossierJeux, changerDossierJeux };

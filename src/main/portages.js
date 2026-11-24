'use strict';
// Mises à jour des portages (recomps) : pour chaque jeu dont la « page du projet »
// est un dépôt GitHub, on lit sa dernière release (ou son dernier tag) et on la
// compare à la version indiquée pour le jeu.
const fs = require('node:fs');
const path = require('node:path');
const { comparerVersions, depotDe } = require('./versions');
const { choisirFichier } = require('./maj-portages');

const INTERVALLE_MS = 6 * 3600 * 1000;
// Après un échec (réseau coupé, limite d'appels GitHub atteinte), on réessaie bien plus
// tôt : attendre 6 h laisserait le bandeau des nouvelles versions absent tout ce temps.
const REESSAI_MS = 15 * 60 * 1000;

function vuePortage(etat, jeu) {
  const info = etat.portages.get(jeu.id);
  if (!info || info.repo !== depotDe(jeu.repoUrl)) return null;
  const isNew = Boolean(jeu.version) && comparerVersions(info.latest, jeu.version) > 0;
  const vue = { latest: info.latest, url: info.url, date: info.date, title: info.title, isNew };
  // Mise à jour automatique possible : un fichier de la release convient à ce jeu.
  const choix = jeu.exePath ? choisirFichier(info.assets, { plateforme: etat.plateforme, arch: process.arch, exePath: jeu.exePath }) : {};
  vue.auto = Boolean(choix.fichier);
  vue.autoFile = choix.fichier ? choix.fichier.name : '';
  const installation = etat.installations.get(jeu.id);
  vue.installing = installation ? { step: installation.etape, percent: installation.pourcentage, file: installation.fichier } : null;
  return vue;
}

// Cache des réponses GitHub, gardé sur disque : une question déjà posée est reposée
// avec son ETag (« quoi de neuf depuis ? »). Si rien n'a changé, GitHub répond 304
// SANS compter l'appel dans la limite de 60 par heure, même après un redémarrage.
function cacheGitHub(etat) {
  if (!etat.cacheGitHub) {
    etat.cacheGitHub = new Map();
    try {
      const lu = JSON.parse(fs.readFileSync(path.join(etat.dossiers.donnees, 'cache-github.json'), 'utf8'));
      for (const [k, v] of Object.entries(lu)) if (v?.etag) etat.cacheGitHub.set(k, v);
    } catch {
      // pas encore de cache
    }
  }
  return etat.cacheGitHub;
}

function enregistrerCache(etat) {
  try {
    const fichier = path.join(etat.dossiers.donnees, 'cache-github.json');
    fs.writeFileSync(`${fichier}.tmp`, JSON.stringify(Object.fromEntries(etat.cacheGitHub)));
    fs.renameSync(`${fichier}.tmp`, fichier);
  } catch {
    // un cache perdu ne coûte que des appels
  }
}

async function lireGitHub(etat, chemin) {
  const chercher = etat.systeme.fetch ?? globalThis.fetch;
  const cache = cacheGitHub(etat);
  const connu = cache.get(chemin);
  const headers = { 'User-Agent': `RiftLauncher/${etat.version}`, Accept: 'application/vnd.github+json' };
  if (connu) headers['If-None-Match'] = connu.etag;
  const reponse = await chercher(`https://api.github.com${chemin}`, { headers, signal: AbortSignal.timeout(20000) });
  if (reponse.status === 304 && connu) return connu.corps;
  if (reponse.status === 404) return null;
  if (reponse.status === 403 || reponse.status === 429) {
    if (reponse.headers.get('x-ratelimit-remaining') === '0') throw new Error("limite d'appels GitHub atteinte (60 par heure sans compte)");
  }
  if (!reponse.ok) throw new Error(`GitHub a répondu ${reponse.status}`);
  const corps = await reponse.json();
  const etag = reponse.headers.get('etag');
  if (etag) {
    cache.set(chemin, { etag, corps });
    enregistrerCache(etat);
  }
  return corps;
}

async function verifierPortage(etat, id, repo) {
  const jeu = () => etat.jeux.find((j) => j.id === id);
  try {
    let info = null;
    const release = await lireGitHub(etat, `/repos/${repo}/releases/latest`);
    if (release) {
      info = {
        repo,
        latest: String(release.tag_name ?? ''),
        url: String(release.html_url ?? ''),
        date: String(release.published_at ?? ''),
        title: String(release.name ?? ''),
        assets: [].concat(release.assets ?? []).map((a) => ({
          name: String(a.name ?? ''),
          size: Number(a.size) || 0,
          url: String(a.browser_download_url ?? ''),
          digest: String(a.digest ?? ''),
        })),
      };
    } else {
      // Pas de release publiée : on regarde les tags.
      const tags = await lireGitHub(etat, `/repos/${repo}/tags?per_page=1`);
      const premier = Array.isArray(tags) ? tags[0] : null;
      if (!premier) {
        etat.journal('DEBUG', `Portage ${repo} : aucune version publiee`);
        return;
      }
      info = { repo, latest: String(premier.name ?? ''), url: `https://github.com/${repo}/tags`, date: '', title: '', assets: [] };
    }
    if (!info.latest) return;
    if (!/^https:\/\/github\.com\//.test(info.url)) info.url = `https://github.com/${repo}/releases`;
    const j = jeu();
    if (!j) return;
    etat.portages.set(id, info);
    const vue = vuePortage(etat, j);
    if (vue?.isNew) {
      etat.journal('INFO', `Nouvelle version du portage de ${j.name} : ${info.latest} (installee : ${j.version})`);
    } else {
      etat.journal('DEBUG', `Portage de ${j.name} : derniere version ${info.latest}`);
    }
  } catch (err) {
    etat.journal('WARN', `Verification du portage ${repo} impossible : ${err.message}. Nouvel essai dans 15 min.`);
    etat.prochaineVerifPortages = Math.min(etat.prochaineVerifPortages ?? Number.POSITIVE_INFINITY, Date.now() + REESSAI_MS);
  }
}

function lancerVerifications(etat, forcer, prefs) {
  etat.prochaineVerifPortages = Date.now() + INTERVALLE_MS;
  if (!prefs.recompCheck) return [];
  const lancees = [];
  for (const jeu of etat.jeux) {
    const repo = depotDe(jeu.repoUrl);
    if (!repo) {
      etat.portages.delete(jeu.id);
      continue;
    }
    const connu = etat.portages.get(jeu.id);
    if (!forcer && connu && connu.repo === repo) continue;
    if (etat.verifsPortages.has(jeu.id)) {
      lancees.push(etat.verifsPortages.get(jeu.id));
      continue;
    }
    const promesse = verifierPortage(etat, jeu.id, repo).finally(() => etat.verifsPortages.delete(jeu.id));
    etat.verifsPortages.set(jeu.id, promesse);
    lancees.push(promesse);
  }
  return lancees;
}

// Vérification immédiate (bouton des réglages) : attend les réponses 10 s maximum.
async function verifierMaintenant(etat, prefs) {
  etat.portages.clear();
  const lancees = lancerVerifications(etat, true, prefs);
  await Promise.race([Promise.allSettled(lancees), new Promise((r) => setTimeout(r, 10000))]);
  const updates = etat.jeux.filter((j) => vuePortage(etat, j)?.isNew).map((j) => j.name);
  const checked = etat.jeux.filter((j) => depotDe(j.repoUrl)).length;
  return { ok: true, checked, updates };
}

module.exports = { vuePortage, lancerVerifications, verifierMaintenant, lireGitHub, INTERVALLE_MS, REESSAI_MS };

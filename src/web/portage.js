'use strict';
// Rift Launcher, portage Windows/Linux : interface des fonctions ajoutées au portage
// (catalogue, émulateurs, lanceur par jeu, retour de version, « Ajouter à Steam »,
// mises à jour automatiques). Chargé après app.js, dont il réutilise h(), t(), toast(),
// sfx, state, refreshLibrary() ; l'interface d'origine n'appelle que deux crochets :
// window.riftEditeur (ouverture des paramètres d'un jeu) et window.riftApresRendu.
(() => {
  const appeler = (nom, corps) => window.rift.appeler(nom, corps || {});
  const plateforme = window.rift.plateforme;
  const option = (valeur, texte) => {
    const o = document.createElement('option');
    o.value = valeur;
    o.textContent = texte;
    return o;
  };

  // ---------- Paramètres d'un jeu ----------
  window.riftEditeur = async (game) => {
    // Exemples de chemins à la mode du système (l'original montrait C:\…).
    if (plateforme !== 'win32') {
      const f = document.getElementById('form');
      f.elements.exePath.placeholder = '…/jeu.AppImage, …/jeu.exe, …/jeu.xci';
      f.elements.saveDir.placeholder = '~/…/save';
      f.elements.modsDir.placeholder = '~/…/mods';
    }
    // Émulateurs : la ligne n'apparaît que s'il y en a (ou si ce jeu en a un).
    const { emulators = [] } = await appeler('emulators');
    const sel = document.getElementById('emulator-select');
    sel.replaceChildren(option('', t('Le fichier lui-même')), ...emulators.map((e) => option(e.id, e.name)));
    sel.value = (game && game.emulator) || '';
    document.getElementById('emulator-row').hidden = !emulators.length && !(game && game.emulator);

    // Lanceur des jeux Windows sous Linux.
    const ligne = document.getElementById('runner-row');
    if (plateforme === 'win32') {
      ligne.hidden = true;
    } else {
      const r = await appeler('runners');
      const choix = document.getElementById('runner-select');
      choix.replaceChildren(...(r.options || []).map((o) => option(o.value, t(o.label) + (o.ok ? '' : ` — ${t('non installé')}`))));
      choix.value = (game && game.runner) || '';
      ligne.hidden = false;
    }

    // Versions gardées et « Ajouter à Steam » : pour un jeu déjà enregistré.
    const extra = document.getElementById('editor-extra');
    extra.replaceChildren();
    if (!game) return;
    const versions = game.previousVersions || [];
    if (versions.length) {
      extra.append(h('div', { class: 'rl-row' },
        h('span', { class: 'rl-label' }, 'Versions gardées du portage'),
        ...versions.map((v) => h('button', { type: 'button', class: 'btn btn-small', onclick: () => revenir(game, v) }, t('Revenir à la v{v}', { v: v.version })))));
    }
    extra.append(h('div', { class: 'rl-row' },
      h('button', { type: 'button', class: 'btn btn-small', onclick: () => ajouterASteam(game) }, 'Ajouter à Steam'),
      h('small', {}, 'Raccourci dans Steam (Big Picture, Steam Deck) qui lance le jeu par Rift Launcher.')));
  };

  async function revenir(game, v) {
    sfx.select();
    const r = await appeler('recompRollback', { id: game.id, key: v.key });
    if (r.error) { toast(tMsg(r.error), 'error'); return; }
    document.getElementById('editor').close();
    toast(t('{name} est revenu à la v{v}. La version quittée est gardée.', { name: game.name, v: r.version }));
    sfx.save();
    await refreshLibrary();
  }

  async function ajouterASteam(game) {
    sfx.select();
    const r = await appeler('steamAdd', { id: game.id });
    if (r.error) { toast(tMsg(r.error), 'error'); return; }
    toast(t(r.updated ? 'Raccourci Steam de {name} mis à jour. Rouvre Steam pour le voir.' : '{name} est ajouté à Steam. Rouvre Steam pour le voir.', { name: game.name }));
    sfx.save();
  }

  // ---------- Réglages → Émulateurs ----------
  let emuEnEdition = null;
  async function peindreEmulateurs() {
    const { emulators = [] } = await appeler('emulators');
    const liste = document.getElementById('emu-list');
    liste.replaceChildren(...emulators.map((e) => h('li', { class: 'rl-emu' },
      h('div', { class: 'rl-emu-info' },
        h('strong', {}, document.createTextNode(e.name)),
        h('span', {}, document.createTextNode(e.exePath)),
        h('code', {}, document.createTextNode(e.args || '{jeu}'))),
      h('button', { class: 'btn btn-small btn-ghost', onclick: () => editerEmulateur(e) }, 'Modifier'),
      h('button', { class: 'btn btn-small btn-danger', onclick: () => retirerEmulateur(e) }, 'Retirer'))));
    if (!emulators.length) liste.append(h('li', { class: 'rl-vide' }, 'Aucun émulateur pour l’instant. Le catalogue « Installer un portage » peut en installer un.'));
  }
  function editerEmulateur(e) {
    emuEnEdition = e ? e.id : null;
    document.getElementById('emu-name').value = e ? e.name : '';
    document.getElementById('emu-exe').value = e ? e.exePath : '';
    document.getElementById('emu-args').value = e ? e.args : '';
    document.getElementById('emu-save').textContent = t(e ? 'Enregistrer' : "Ajouter l'émulateur");
    document.getElementById('emu-cancel').hidden = !e;
    if (e) document.getElementById('emu-name').focus();
  }
  async function retirerEmulateur(e) {
    const r = await appeler('emulatorDelete', { id: e.id });
    if (r.error) { toast(tMsg(r.error), 'error'); return; }
    sfx.modOff();
    peindreEmulateurs();
  }
  document.getElementById('emu-pick').addEventListener('click', async () => {
    const p = await api.pickExe();
    if (p) document.getElementById('emu-exe').value = p;
  });
  document.getElementById('emu-cancel').addEventListener('click', () => editerEmulateur(null));
  document.getElementById('emu-save').addEventListener('click', async () => {
    const r = await appeler('emulatorSave', {
      id: emuEnEdition,
      name: document.getElementById('emu-name').value,
      exePath: document.getElementById('emu-exe').value,
      args: document.getElementById('emu-args').value,
    });
    if (r.error) { toast(tMsg(r.error), 'error'); return; }
    sfx.save();
    editerEmulateur(null);
    peindreEmulateurs();
  });
  document.querySelector('.set-tab[data-tab="emulateurs"]').addEventListener('click', peindreEmulateurs);
  new MutationObserver(() => { if (document.getElementById('settings').open) peindreEmulateurs(); })
    .observe(document.getElementById('settings'), { attributes: true, attributeFilter: ['open'] });

  // ---------- Catalogue « Installer un portage » ----------
  const catalogue = document.getElementById('catalog');
  let suivi = null;
  async function peindreCatalogue() {
    const c = await appeler('catalog');
    document.getElementById('catalog-folder').textContent = c.folder;
    let actif = false;
    const lignes = (c.entries || []).map((e) => {
      let droite;
      if (e.installing) {
        actif = true;
        droite = h('span', { class: 'rl-etat' }, e.installing.step === 'telechargement'
          ? t('Téléchargement : {p} %', { p: e.installing.percent })
          : t(e.installing.step === 'installation' ? 'Installation…' : 'Recherche de la dernière version…'));
      } else if (e.installed) {
        droite = h('span', { class: 'rl-badge' }, e.type === 'emulateur' ? 'Émulateur installé' : 'Dans ta bibliothèque');
      } else if (e.manual) {
        droite = h('button', { class: 'btn btn-small btn-ghost', title: e.manual, onclick: () => installer(e) }, 'Voir la page');
      } else {
        droite = h('button', { class: 'btn btn-small btn-primary', onclick: () => installer(e) }, 'Installer');
      }
      return h('li', { class: 'rl-portage' + (e.installed ? ' is-on' : '') },
        h('div', { class: 'rl-portage-info' },
          h('strong', {}, document.createTextNode(e.name)),
          h('span', {}, t(e.description)),
          h('small', {}, e.manual ? t(e.manual) : t('À fournir : {need}', { need: t(e.need) }))),
        droite);
    });
    document.getElementById('catalog-list').replaceChildren(...lignes);
    // Rafraîchi chaque seconde tant qu'une installation avance et que la fenêtre est ouverte.
    clearTimeout(suivi);
    if (actif && catalogue.open) suivi = setTimeout(peindreCatalogue, 1000);
  }
  async function installer(e) {
    sfx.select();
    const attente = appeler('catalogInstall', { id: e.id });
    setTimeout(peindreCatalogue, 300);
    const r = await attente.catch((err) => ({ error: String(err) }));
    await peindreCatalogue();
    if (r.error) { toast(tMsg(r.error), e.manual ? undefined : 'error'); return; }
    sfx.sparkle();
    toast(t(r.type === 'emulateur'
      ? '{name} est installé. Ajoute tes jeux et choisis « Lancé par : {name} ».'
      : '{name} est installé dans ta bibliothèque.', { name: r.type === 'emulateur' ? e.name.split(' (')[0] : r.name }));
    if (r.need) setTimeout(() => toast(t('À fournir : {need}', { need: t(r.need) })), 1200);
    await refreshLibrary();
  }
  document.getElementById('catalog-open').addEventListener('click', () => {
    sfx.select();
    catalogue.showModal();
    peindreCatalogue();
  });
  document.getElementById('catalog-close').addEventListener('click', () => catalogue.close());
  document.getElementById('catalog-folder-change').addEventListener('click', async () => {
    const r = await appeler('catalogFolder');
    document.getElementById('catalog-folder').textContent = r.folder;
  });

  // ---------- Mises à jour automatiques faites ----------
  let majVues = null;
  window.riftApresRendu = () => {
    const a = state.autoUpdates;
    if (!a) return;
    if (majVues === null) { majVues = a.count; return; }
    if (a.count > majVues) {
      majVues = a.count;
      toast(t('{name} est à jour : v{v}. L’ancienne version est gardée.', { name: a.last.name, v: a.last.version }));
      sfx.sparkle();
    }
  };
})();

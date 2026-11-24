'use strict';
// Statut Discord (Rich Presence) par la connexion locale de Discord, sans bibliothèque.
// Trame : code (int32) + longueur (int32) + JSON. 0 = poignée de main, 1 = commande.
// Windows : tube nommé \\?\pipe\discord-ipc-N. Linux : socket dans XDG_RUNTIME_DIR,
// y compris les versions Flatpak et Snap de Discord.
const crypto = require('node:crypto');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const { dernierJeuLance } = require('./lancement');

const ID_DISCORD_INTEGRE = ''; // à remplir avec l'ID de l'application Discord « Rift Launcher »
const PREFIXES_LINUX = ['', 'app/com.discordapp.Discord', 'app/com.discordapp.DiscordCanary', 'snap.discord', 'snap.discord-canary'];

function cheminsDiscord(plateforme, env = process.env) {
  const chemins = [];
  for (let i = 0; i < 10; i++) {
    if (plateforme === 'win32') {
      chemins.push(`\\\\?\\pipe\\discord-ipc-${i}`);
      continue;
    }
    for (const base of [env.XDG_RUNTIME_DIR, env.TMPDIR, env.TMP, env.TEMP, '/tmp']) {
      if (!base) continue;
      for (const sous of PREFIXES_LINUX) chemins.push(path.join(base, sous, `discord-ipc-${i}`));
    }
  }
  return [...new Set(chemins)];
}

function trame(code, objet) {
  const json = Buffer.from(JSON.stringify(objet));
  const entete = Buffer.alloc(8);
  entete.writeInt32LE(code, 0);
  entete.writeInt32LE(json.length, 4);
  return Buffer.concat([entete, json]);
}

const couper = (t, max) => {
  let s = String(t ?? '');
  if (s.length < 2) s = `${s}  `;
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
};

class StatutDiscord {
  constructor(etat, { prefs, idPerso, fenetreOuverte }) {
    this.etat = etat;
    this.prefs = prefs;
    this.idPerso = idPerso;
    this.fenetreOuverte = fenetreOuverte;
    this.socket = null;
    this.affiche = '';
    this.prochainEssai = 0;
    this.absenceNotee = false;
    this.occupe = false;
  }

  id() {
    const perso = String(this.idPerso() ?? '');
    return /^\d{15,22}$/.test(perso) ? perso : ID_DISCORD_INTEGRE;
  }

  connecte() {
    return Boolean(this.socket && !this.socket.destroyed);
  }

  // Ce qu'il faut afficher : le dernier jeu lancé, sinon « dans les menus » tant que
  // la fenêtre est ouverte, sinon rien.
  voulu() {
    if (!this.prefs().discord || !this.id()) return '';
    const jeu = dernierJeuLance(this.etat);
    if (jeu) return jeu;
    return this.fenetreOuverte() ? 'menu' : '';
  }

  fermer(raison) {
    if (!this.socket) return;
    try {
      this.socket.destroy();
    } catch {
      // déjà fermé
    }
    this.socket = null;
    this.affiche = '';
    if (raison) this.etat.journal('DEBUG', `Discord deconnecte : ${raison}`);
  }

  essayer(chemin, client) {
    return new Promise((resolve) => {
      const s = net.connect(chemin);
      let tampon = Buffer.alloc(0);
      const fin = (ok) => {
        clearTimeout(minuterie);
        if (!ok) s.destroy();
        resolve(ok ? s : null);
      };
      const minuterie = setTimeout(() => fin(false), 2000);
      s.once('error', () => fin(false));
      s.once('connect', () => s.write(trame(0, { v: 1, client_id: client })));
      s.on('data', (morceau) => {
        tampon = Buffer.concat([tampon, morceau]);
        while (tampon.length >= 8) {
          const code = tampon.readInt32LE(0);
          const longueur = tampon.readInt32LE(4);
          if (tampon.length < 8 + longueur) break;
          const texte = tampon.toString('utf8', 8, 8 + longueur);
          tampon = tampon.subarray(8 + longueur);
          if (code === 2) {
            this.etat.journal('WARN', `Discord refuse le statut : ${texte}`);
            if (this.socket === s) this.fermer('refus');
            else fin(false);
          } else if (texte.includes('"evt":"READY"')) {
            this.etat.journal('INFO', 'Discord : connexion acceptee');
            fin(true);
          } else if (texte.includes('"evt":"ERROR"')) {
            this.etat.journal('WARN', `Discord : ${texte}`);
          }
        }
      });
      s.once('close', () => {
        if (this.socket === s) this.fermer('Discord a ferme la connexion');
      });
    });
  }

  async connecter() {
    if (this.connecte()) return true;
    this.fermer('');
    const client = this.id();
    if (!client) return false;
    for (const chemin of cheminsDiscord(this.etat.plateforme)) {
      if (this.etat.plateforme !== 'win32' && !fs.existsSync(chemin)) continue;
      const s = await this.essayer(chemin, client);
      if (s) {
        this.socket = s;
        this.etat.journal('INFO', `Discord trouve (${chemin})`);
        this.absenceNotee = false;
        return true;
      }
    }
    if (!this.absenceNotee) {
      this.etat.journal('INFO', 'Discord introuvable : statut non affiche (Discord est-il ouvert ?). Nouvel essai toutes les 60 s.');
    }
    this.absenceNotee = true;
    return false;
  }

  async mettreAJour() {
    const voulu = this.voulu();
    if (!voulu) {
      this.fermer(this.socket ? 'rien a afficher' : '');
      return;
    }
    this.prochainEssai = Date.now() + 60000;
    if (!(await this.connecter())) return;
    let activite;
    let libelle;
    if (voulu === 'menu') {
      activite = {
        details: 'Navigue dans les menus',
        timestamps: { start: this.etat.demarreLe },
        assets: { large_image: 'rift', large_text: 'Rift Launcher' },
      };
      libelle = 'menus';
    } else {
      const jeu = this.etat.jeux.find((j) => j.id === voulu);
      const suivi = this.etat.enCours.get(voulu);
      if (!jeu || !suivi) return;
      let assets = { large_image: 'rift', large_text: 'Rift Launcher' };
      if (/^https:\/\//.test(jeu.coverRemote)) {
        assets = { large_image: jeu.coverRemote, large_text: couper(jeu.name, 128), small_image: 'rift', small_text: 'Rift Launcher' };
      }
      activite = { details: couper(jeu.name, 128), state: 'via Rift Launcher', timestamps: { start: suivi.debut }, assets };
      libelle = jeu.name;
    }
    try {
      this.socket.write(trame(1, { cmd: 'SET_ACTIVITY', args: { pid: process.pid, activity: activite }, nonce: crypto.randomUUID() }));
      if (this.affiche !== voulu) this.etat.journal('INFO', `Statut Discord : ${libelle}`);
      this.affiche = voulu;
    } catch (err) {
      this.etat.journal('WARN', `Statut Discord impossible : ${err.message}`);
      this.fermer('');
    }
  }

  // Appelée chaque seconde : suit menus / jeu, et retente toutes les 60 s si Discord
  // a été ouvert après Rift Launcher.
  async tick() {
    if (this.occupe) return;
    const voulu = this.voulu();
    if (voulu === this.affiche && (this.connecte() || !voulu)) return;
    if (!this.connecte() && voulu && Date.now() < this.prochainEssai) return;
    this.occupe = true;
    try {
      await this.mettreAJour();
    } finally {
      this.occupe = false;
    }
  }
}

module.exports = { StatutDiscord, cheminsDiscord, trame, ID_DISCORD_INTEGRE };

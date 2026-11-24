'use strict';
// Seul pont entre l'interface et le launcher : une fonction pour appeler une commande.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('rift', {
  appeler: (nom, corps) => ipcRenderer.invoke('rift:api', nom, corps),
  plateforme: process.platform,
});

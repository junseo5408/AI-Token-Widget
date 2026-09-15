'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('widget', {
  fetchUsage: () => ipcRenderer.invoke('usage:fetch'),
  getConfig: () => ipcRenderer.invoke('config:get'),
  setConfig: (patch) => ipcRenderer.invoke('config:set', patch),
  onUsage: (cb) => ipcRenderer.on('usage:push', (_e, payload) => cb(payload)),
  onConfig: (cb) => ipcRenderer.on('config:push', (_e, payload) => cb(payload)),

  // 설정 마법사
  setupDetect: () => ipcRenderer.invoke('setup:detect'),
  setupInstall: (id) => ipcRenderer.invoke('setup:install', id),
  setupLogin: (id) => ipcRenderer.invoke('setup:login', id),
  setupFinish: (selection) => ipcRenderer.invoke('setup:finish', selection),
  onSetupLog: (cb) => ipcRenderer.on('setup:log', (_e, payload) => cb(payload)),

  hide: () => ipcRenderer.send('window:hide'),
  quit: () => ipcRenderer.send('window:quit'),
  openExternal: (url) => ipcRenderer.send('shell:open', url),
});

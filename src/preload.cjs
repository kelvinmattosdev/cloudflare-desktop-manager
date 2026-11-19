const { contextBridge, ipcRenderer } = require('electron');

const methods = ['settings', 'connect', 'resume', 'demo', 'disconnect', 'forget', 'help',
  'zones', 'records', 'write', 'remove', 'themeStatus', 'setTheme', 'updateStatus', 'checkUpdate', 'installUpdate', 'openRelease',
  'updateNotes', 'dismissUpdateNotes'];
const api = Object.fromEntries(methods.map(name => [
  name, (...args) => ipcRenderer.invoke(`dns:${name}`, ...args)
]));
api.onUpdate = callback => {
  ipcRenderer.on('dns:updateChanged', (_event, state) => callback(state));
};
contextBridge.exposeInMainWorld('dns', api);

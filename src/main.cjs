const { app, BrowserWindow, ipcMain, Menu, safeStorage, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { cloudflare, payload, id } = require('./api.cjs');
const { createUpdater, packageKind } = require('./updater.cjs');
const demo = require('./demo.cjs');

const index = path.join(__dirname, 'index.html');
const indexUrl = pathToFileURL(index).href;
const keyFile = () => path.join(app.getPath('userData'), 'cloudflare-token.enc');
// The synchronous API reports its actual Linux backend, so we can reject plaintext fallback.
const canStore = () => safeStorage.isEncryptionAvailable() &&
  ['gnome_libsecret', 'kwallet', 'kwallet5', 'kwallet6'].includes(safeStorage.getSelectedStorageBackend());
let win, session, updater;
let busy = false;
app.disableHardwareAcceleration();

function clearKey() { fs.rmSync(keyFile(), { force: true }); }

async function connect(client, mode, onReady) {
  if (busy) throw new Error('Outra operação está em andamento.');
  busy = true;
  try {
    const zones = await client.zones();
    onReady?.();
    session = { mode, client, zones };
    return zones;
  } finally { busy = false; }
}

const handlers = {
  settings: () => ({ canStore: canStore(), remembered: fs.existsSync(keyFile()) }),
  connect: (token, remember) => connect(cloudflare(token), 'live', () => {
    if (!remember) return clearKey();
    if (!canStore()) throw new Error('Cofre do sistema indisponível. Desmarque “Lembrar token”.');
    const temp = `${keyFile()}.tmp`;
    try {
      fs.writeFileSync(temp, safeStorage.encryptString(token.trim()), { mode: 0o600 });
      fs.renameSync(temp, keyFile());
    } finally { fs.rmSync(temp, { force: true }); }
  }),
  resume: () => {
    if (!canStore()) throw new Error('Desbloqueie o cofre do sistema ou informe um token.');
    let token;
    try { token = safeStorage.decryptString(fs.readFileSync(keyFile())); }
    catch { throw new Error('Não foi possível abrir o token salvo. Informe um token novamente.'); }
    return connect(cloudflare(token), 'live');
  },
  demo: () => connect(demo(), 'demo'),
  disconnect: () => {
    if (busy) throw new Error('Aguarde a operação em andamento.');
    if (session?.mode === 'live') clearKey();
    session = null;
  },
  forget: () => clearKey(),
  help: () => shell.openExternal('https://dash.cloudflare.com/profile/api-tokens/'),
  updateStatus: () => updater.status(),
  checkUpdate: () => updater.check(),
  installUpdate: expected => updater.install(expected),
  zones: async () => {
    const current = session;
    if (!current) throw new Error('Conecte-se à Cloudflare primeiro.');
    current.zones = await current.client.zones();
    return current.zones;
  },
  records: zone => scoped(zone, current => current.client.records(zone)),
  write: (zone, record, input) => scoped(zone, (current, selected) =>
    current.client.write(zone, record == null ? null : id(record), payload(input, selected.name))),
  remove: (zone, record) => scoped(zone, current => current.client.remove(zone, id(record)))
};

async function scoped(zone, run) {
  const current = session;
  const selected = current?.zones.find(z => z.id === id(zone));
  if (!selected) throw new Error('Domínio fora da sessão atual.');
  return run(current, selected);
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (win?.isMinimized()) win.restore(); win?.focus(); });
  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    updater = createUpdater({
      currentVersion: require('../package.json').version,
      kind: packageKind({ packaged: app.isPackaged, platform: process.platform, arch: process.arch,
        image: process.env.APPIMAGE, execPath: process.execPath }),
      image: process.env.APPIMAGE,
      emit: state => { if (win && !win.isDestroyed()) win.webContents.send('dns:updateChanged', state); },
      restart: image => {
        if (image) app.relaunch({ execPath: image, args: [] });
        else app.relaunch();
        app.quit();
      }
    });
    win = new BrowserWindow({
      title: 'NimboDesk', width: 1280, height: 850, minWidth: 780, minHeight: 590,
      backgroundColor: '#ffffff', show: false, autoHideMenuBar: true, icon: path.join(__dirname, 'icon.svg'),
      webPreferences: { preload: path.join(__dirname, 'preload.cjs'),
        sandbox: true, contextIsolation: true, nodeIntegration: false, devTools: !app.isPackaged }
    });
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', event => event.preventDefault());
    win.on('close', event => { if (updater.blocksQuit()) event.preventDefault(); });
    win.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    win.webContents.session.setPermissionCheckHandler(() => false);
    for (const [name, handler] of Object.entries(handlers)) {
      ipcMain.handle(`dns:${name}`, async (event, ...args) => {
        if (event.sender !== win.webContents || event.senderFrame?.url !== indexUrl ||
            event.senderFrame?.parent) return { error: 'Origem não permitida.' };
        try { return { value: await handler(...args) }; }
        catch (e) { return { error: e instanceof Error && !e.code ? e.message : 'Não foi possível concluir a operação local.' }; }
      });
    }
    win.webContents.once('did-finish-load', () => { void updater.check(); });
    win.once('ready-to-show', () => win.show());
    win.loadFile(index);
  });
}
app.on('before-quit', event => { if (updater?.blocksQuit()) event.preventDefault(); });
app.on('window-all-closed', () => app.quit());

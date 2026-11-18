const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');

const profile = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'dns-console-test-'));
app.setPath('userData', profile);
app.setPath('sessionData', profile);
const updaterPath = require.resolve('../src/updater.cjs');
const actualUpdater = require(updaterPath);
let checks = 0;
require.cache[updaterPath].exports = {
  ...actualUpdater,
  packageKind: () => 'deb',
  createUpdater: options => actualUpdater.createUpdater({
    ...options,
    lookup: async () => ++checks === 1 ? { version: options.currentVersion, asset: {} } :
      { version: '99.0.0', asset: {} },
    apply: async (_release, _kind, _image, progress, installing) => {
      progress(42);
      await new Promise(resolve => setTimeout(resolve, 150));
      installing();
      throw new Error('A autorização da instalação foi cancelada.');
    }
  })
};
require('../src/main.cjs');

const timeout = setTimeout(() => { console.error('O teste desktop excedeu 25 segundos.'); app.exit(1); }, 25_000);
app.whenReady().then(async () => {
  const win = BrowserWindow.getAllWindows()[0];
  assert.ok(win);
  const contents = win.webContents;
  const errors = [];
  contents.on('console-message', event => {
    if (event.level === 'error') errors.push(event.message);
  });
  if (contents.isLoadingMainFrame()) await once(contents, 'did-finish-load');
  const run = js => contents.executeJavaScript(js);
  async function wait(condition) {
    for (let i = 0; i < 100; i++) {
      if (await run(`Boolean(${condition})`)) return;
      await new Promise(resolve => setTimeout(resolve, 40));
    }
    throw new Error(`Condição não atingida: ${condition}\n${errors.join('\n')}`);
  }
  await wait('window.dns && !document.getElementById("login").hidden');
  assert.equal(await run('typeof require'), 'undefined');
  await wait('document.getElementById("update-label").textContent.startsWith("Atualizado v")');
  await run('document.getElementById("check-update").click()');
  await wait('!document.getElementById("install-update").hidden');
  assert.equal(await run('document.getElementById("install-update").textContent'), 'Atualizar para v99.0.0');
  await run('document.getElementById("install-update").click()');
  await wait('document.querySelector(".shell").inert');
  await wait('!document.querySelector(".shell").inert && !document.getElementById("update-notice").hidden');
  assert.match(await run('document.getElementById("update-notice").textContent'), /cancelada/);
  await run('document.getElementById("check-update").click()');
  await wait('document.getElementById("update-notice").hidden && !document.getElementById("install-update").hidden');
  await run('document.getElementById("try-demo").click()');
  await wait('document.querySelectorAll("#records .type-pill").length === 8');
  assert.equal(await run('document.querySelectorAll(".zone-item").length'), 3);
  if (process.env.DNS_SMOKE_SCREENSHOT) {
    fs.writeFileSync(process.env.DNS_SMOKE_SCREENSHOT, (await contents.capturePage()).toPNG());
  }
  await run(`document.getElementById('zone-filter').value = 'dev';
    document.getElementById('zone-filter').dispatchEvent(new Event('input'));
    document.querySelector('.zone-item').click();`);
  await wait('document.getElementById("zone-title").textContent.includes("dev.example") && document.querySelectorAll("#records .type-pill").length === 8');
  await run(`document.getElementById('add').click();
    document.getElementById('record-name').value = 'teste';
    document.getElementById('content').value = '::1';
    document.getElementById('save').click();`);
  await wait('document.getElementById("editor-error").textContent.includes("IPv4")');
  await run(`document.getElementById('content').value = '192.0.2.11'; document.getElementById('save').click();`);
  await wait('!document.getElementById("editor").open && document.querySelectorAll("#records .type-pill").length === 9');
  await run(`document.getElementById('record-filter').value = 'teste';
    document.getElementById('record-filter').dispatchEvent(new Event('input'));
    document.querySelector('.row-action').click();
    document.getElementById('content').value = '192.0.2.12';
    document.getElementById('save').click();`);
  await wait('!document.getElementById("editor").open && document.getElementById("records").textContent.includes("192.0.2.12")');
  await run(`document.querySelector('.row-action.del').click(); document.querySelector('#deletion .cancel').click();`);
  assert.equal(await run('document.querySelectorAll("#records .type-pill").length'), 1);
  await run(`document.querySelector('.row-action.del').click(); document.getElementById('confirm-delete').click();`);
  await wait('!document.getElementById("deletion").open && document.getElementById("records").textContent.includes("Nenhum registro corresponde")');
  await run('document.getElementById("disconnect").click()');
  await wait('!document.getElementById("login").hidden');
  assert.deepEqual(errors, []);
  console.log('Desktop: checagem automática/manual e atualização simulada; conexão demo, troca de domínio e CRUD passaram.');
  clearTimeout(timeout);
  app.quit();
}).catch(error => { console.error(error); app.exit(1); });
app.on('quit', () => fs.rmSync(profile, { recursive: true, force: true }));

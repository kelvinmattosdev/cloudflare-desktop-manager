const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');

const profile = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'dns-console-test-'));
app.setPath('userData', profile);
app.setPath('sessionData', profile);
const themeFile = path.join(profile, 'ui-theme');
const initialTheme = process.env.DNS_SMOKE_START_THEME === 'dark' ? 'dark' : 'system';
if (initialTheme !== 'system') fs.writeFileSync(themeFile, `${initialTheme}\n`);
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
  assert.equal(await run('document.title'), 'NimboDesk');
  await wait('!document.getElementById("theme").disabled && document.querySelector(".brand img").naturalWidth > 0');
  assert.equal(await run('document.getElementById("theme").value'), initialTheme);
  assert.equal(await run('document.querySelector(".top select") === null'), true);
  assert.equal(await run('document.getElementById("settings-dialog").open'), false);
  if (initialTheme === 'dark') {
    assert.equal(await run('getComputedStyle(document.documentElement).colorScheme'), 'dark');
  }
  const openSettings = async () => {
    await run(`document.getElementById('open-settings').focus(); document.getElementById('open-settings').click()`);
    await wait('document.getElementById("settings-dialog").open && document.activeElement.id === "theme"');
  };
  const closeSettings = async () => {
    await run(`document.getElementById('close-settings').click()`);
    await wait('!document.getElementById("settings-dialog").open && document.activeElement.id === "open-settings"');
  };
  const chooseTheme = async theme => {
    await openSettings();
    await run(`document.getElementById('theme').value = ${JSON.stringify(theme)};
      document.getElementById('theme').dispatchEvent(new Event('change'));`);
    await wait(`window.matchMedia('(prefers-color-scheme: ${theme})').matches`);
    assert.equal(fs.readFileSync(themeFile, 'utf8').trim(), theme);
    assert.equal(await run('getComputedStyle(document.documentElement).colorScheme'), theme);
    await closeSettings();
  };
  await chooseTheme('light');
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
    await run('new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)))');
    fs.writeFileSync(process.env.DNS_SMOKE_SCREENSHOT, (await contents.capturePage()).toPNG());
  }
  await chooseTheme('dark');
  if (process.env.DNS_SMOKE_DARK_SCREENSHOT) {
    await run('new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)))');
    await run('Promise.allSettled(document.getAnimations().map(animation => animation.finished))');
    fs.writeFileSync(process.env.DNS_SMOKE_DARK_SCREENSHOT, (await contents.capturePage()).toPNG());
  }
  win.setContentSize(780, 650);
  await wait('window.innerWidth === 780');
  assert.equal(await run('document.querySelector(".top").scrollWidth <= window.innerWidth'), true);
  await openSettings();
  assert.equal(await run('getComputedStyle(document.getElementById("settings-dialog")).backgroundColor'), 'rgb(34, 43, 58)');
  if (process.env.DNS_SMOKE_SETTINGS_SCREENSHOT) {
    await run('new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)))');
    fs.writeFileSync(process.env.DNS_SMOKE_SETTINGS_SCREENSHOT, (await contents.capturePage()).toPNG());
  }
  win.focus();
  contents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
  contents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
  await wait('!document.getElementById("settings-dialog").open && document.activeElement.id === "open-settings"');
  await run(`document.getElementById('zone-filter').value = 'dev';
    document.getElementById('zone-filter').dispatchEvent(new Event('input'));
    document.querySelector('.zone-item').click();`);
  await wait('document.getElementById("zone-title").textContent.includes("dev.example") && document.querySelectorAll("#records .type-pill").length === 8');
  await run(`document.getElementById('add').click();
    document.getElementById('record-name').value = 'teste';
    document.getElementById('content').value = '::1';
    document.getElementById('save').click();`);
  await wait('document.getElementById("editor-error").textContent.includes("IPv4")');
  assert.equal(await run('getComputedStyle(document.getElementById("editor")).backgroundColor'), 'rgb(34, 43, 58)');
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
  contents.reload();
  await wait('!document.getElementById("theme").disabled && document.getElementById("theme").value === "dark"');
  assert.equal(await run('getComputedStyle(document.documentElement).colorScheme'), 'dark');
  assert.deepEqual(errors, []);
  console.log('Desktop: temas e persistência, atualização simulada, conexão demo, troca de domínio e CRUD passaram.');
  clearTimeout(timeout);
  app.quit();
}).catch(error => { console.error(error); app.exit(1); });
app.on('quit', () => fs.rmSync(profile, { recursive: true, force: true }));

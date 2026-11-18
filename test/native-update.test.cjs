const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createHash } = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { signedMacApp, nativeUpdater } = require('../src/native-update.cjs');

test('macOS requires a Developer ID identity and will not update in a mounted DMG', async () => {
  const run = async (cmd, args) => {
    assert.equal(cmd, '/usr/bin/codesign');
    assert.equal(args.at(-1), '/Applications/NimboDesk.app');
    return { stderr: 'Authority=Developer ID Application: Fixture\nTeamIdentifier=AB12345678\n' };
  };
  assert.equal(await signedMacApp('/Applications/NimboDesk.app/Contents/MacOS/NimboDesk', run), true);
  assert.equal(await signedMacApp('/Volumes/NimboDesk/NimboDesk.app/Contents/MacOS/NimboDesk', run), false);
  assert.equal(await signedMacApp('/Applications/NimboDesk.app/Contents/MacOS/NimboDesk',
    async () => ({ stderr: 'TeamIdentifier=not set\n' })), false);
});

test('native update verifies version and GitHub digest before allowing the installer to run', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'nimbodesk-native-test-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const asset = { name: 'nimbodesk_1.1.0_x64.exe', size: 6,
    sha256: createHash('sha256').update('update').digest('hex') };
  const file = path.join(dir, asset.name);
  const release = { version: '1.1.0', asset };
  await fs.writeFile(file, 'update');
  const events = [];
  const updater = Object.assign(new EventEmitter(), {
    checkForUpdates: async () => ({ isUpdateAvailable: true, updateInfo: { version: release.version,
      files: [{ url: asset.name, size: asset.size }] } }),
    downloadUpdate: async () => {
      updater.emit('download-progress', { percent: 60.3 });
      return [file];
    },
    quitAndInstall: (...args) => events.push(args)
  });
  const prepare = nativeUpdater(updater);
  assert.equal(updater.autoDownload, false);
  assert.equal(updater.autoInstallOnAppQuit, false);
  const install = await prepare(release, 'win', null, n => events.push(n), () => events.push('ready'));
  assert.deepEqual(events, [60, 'ready']);
  install();
  assert.deepEqual(events.at(-1), [false, true]);
  await fs.writeFile(file, 'wrong!');
  await assert.rejects(prepare(release, 'win', null, () => {}, () => assert.fail()), /Não foi possível/);
  await assert.rejects(prepare({ ...release, version: '1.2.0' }, 'win', null, () => {}, () => assert.fail()),
    /Não foi possível/);
});

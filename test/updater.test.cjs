const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { compareVersions, createUpdater, latestRelease, downloadAsset,
  installDeb, installImage, packageKind } = require('../src/updater.cjs');

const repo = 'https://github.com/kelvinmattosdev/dns-console';
const tag = 'v1.10.2';
const body = Buffer.from('demo update');
const sha256 = createHash('sha256').update(body).digest('hex');
const name = 'dns-console_1.10.2_amd64.deb';
const asset = { name, size: body.length, sha256, url: `${repo}/releases/download/${tag}/${name}` };
const release = { version: '1.10.2', asset };
const metadata = { draft: false, prerelease: false, tag_name: tag, assets: [
  { name, size: body.length, digest: `sha256:${sha256}`, browser_download_url: asset.url, state: 'uploaded' }
] };

async function temp(t) {
  const work = await fs.mkdtemp(path.join(os.tmpdir(), 'updater-test-'));
  t.after(() => fs.rm(work, { recursive: true, force: true }));
  return work;
}

test('only stable version numbers are supported, major/minor/patch compared numerically', () => {
  assert.equal(compareVersions('1.9.9', 'v1.10.0'), -1);
  assert.equal(compareVersions('v2.0.0', '1.99.99'), 1);
  assert.equal(compareVersions('v1.0.0', '1.0.0'), 0);
  assert.throws(() => compareVersions('v1.0.0-beta', '1.0.0'), /formato/);
});

test('latest release uses only the fixed repo and package format with required SHA-256 metadata', async () => {
  const lookup = (kind, data) => latestRelease(kind, async (url, options) => {
    assert.equal(url, 'https://api.github.com/repos/kelvinmattosdev/dns-console/releases/latest');
    assert.equal(options.redirect, 'error');
    assert.equal(options.headers.Authorization, undefined);
    return Response.json(data);
  });
  assert.deepEqual(await lookup('deb', metadata), release);
  assert.equal((await lookup('image', metadata)).asset, null);
  const imageName = 'dns-console_1.10.2_amd64.AppImage';
  const imageUrl = `${repo}/releases/download/${tag}/${imageName}`;
  assert.equal((await lookup('image', { ...metadata,
    assets: [{ ...metadata.assets[0], name: imageName, browser_download_url: imageUrl }] })).asset.url, imageUrl);
  for (const invalid of [
    { digest: undefined }, { size: 0 }, { size: 300_000_000 }, { state: 'new' },
    { browser_download_url: asset.url.replace('kelvinmattosdev', 'untrusted') }
  ]) {
    assert.equal((await lookup('deb', { ...metadata, assets: [{ ...metadata.assets[0], ...invalid }] })).asset, null);
  }
  await assert.rejects(lookup('deb', { ...metadata, prerelease: true }), /estável/);
});

test('distinguishes missing public release, rate limit and connectivity failure', async () => {
  assert.equal(await latestRelease('deb', async () => new Response(null, { status: 404 })), null);
  await assert.rejects(latestRelease('deb', async () =>
    new Response(null, { status: 403, headers: { 'x-ratelimit-remaining': '0' } })), /limite/);
  await assert.rejects(latestRelease('deb', async () => { throw new Error('network'); }), /conexão/);
});

test('download follows only GitHub asset redirects and confirms bytes and hash before installation', async t => {
  const dir = await temp(t);
  const output = path.join(dir, 'update.deb');
  const redirected = 'https://release-assets.githubusercontent.com/file?signature=fixture';
  const percentages = [];
  await downloadAsset(asset, output, percent => percentages.push(percent), async (url, options) => {
    assert.equal(options.redirect, 'manual');
    if (url === asset.url) return Response.redirect(redirected);
    assert.equal(url, redirected);
    return new Response(body);
  });
  assert.deepEqual(await fs.readFile(output), body);
  assert.equal(percentages.at(-1), 100);
  let requests = 0;
  await assert.rejects(downloadAsset(asset, path.join(dir, 'wrong'), () => {}, async () => {
    requests++;
    return Response.redirect('https://untrusted.example/update');
  }), /verificar/);
  assert.equal(requests, 1);
  await assert.rejects(downloadAsset({ ...asset, sha256: '0'.repeat(64) }, path.join(dir, 'hash'), () => {},
    async () => new Response(body)), /verificar/);
  await assert.rejects(downloadAsset({ ...asset, size: 1 }, path.join(dir, 'oversize'), () => {},
    async () => new Response(body)), /verificar/);
});

test('Debian installer validates metadata before requesting privilege and handles cancellation', async () => {
  const commands = [];
  const file = '/tmp/example/test.deb';
  const run = async (bin, args) => {
    commands.push([bin, ...args]);
    if (bin === '/usr/bin/dpkg-deb') return { stdout: 'dns-console\n1.10.2\namd64\n' };
    throw Object.assign(new Error(), { code: 126 });
  };
  await assert.rejects(installDeb(file, '1.10.2', run), /cancelada/);
  assert.deepEqual(commands[1], ['/usr/bin/pkexec', '/usr/bin/apt-get', 'install', '--yes', '--no-install-recommends', file]);
  commands.length = 0;
  await assert.rejects(installDeb(file, '1.0.0', run), /instalador válido/);
  assert.equal(commands.length, 1);
});

test('AppImage update replaces the file in place, preserves any shortcut target and rejects bad formats', async t => {
  const dir = await temp(t);
  const old = path.join(dir, 'Custom name.AppImage');
  const shortcut = path.join(dir, 'link.AppImage');
  const replacement = path.join(dir, 'candidate');
  const image = Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0, 0, 0, 0, 0x41, 0x49, 2, 120]);
  await fs.writeFile(old, 'installed');
  await fs.symlink(old, shortcut);
  await fs.writeFile(replacement, 'invalid');
  await assert.rejects(installImage(replacement, shortcut), /substituir/);
  assert.equal(await fs.readFile(old, 'utf8'), 'installed');
  await fs.writeFile(replacement, image);
  assert.equal(await installImage(replacement, shortcut), shortcut);
  assert.deepEqual(await fs.readFile(shortcut), image);
  assert.equal((await fs.stat(old)).mode & 0o777, 0o755);
});

test('updater enables only for the installed .deb and a launched AppImage', () => {
  const base = { packaged: true, platform: 'linux', arch: 'x64' };
  assert.equal(packageKind({ ...base, image: '/home/test/DNS Console.AppImage' }), 'image');
  assert.equal(packageKind({ ...base, execPath: '/opt/DNS Console/dns-console' }), 'deb');
  assert.equal(packageKind({ ...base, execPath: '/tmp/other/dns-console' }), null);
  assert.equal(packageKind({ ...base, packaged: false, image: '/tmp/DNS.AppImage' }), null);
});

test('startup and manual checks never install; clicking the exact expected version is required', async () => {
  const statuses = [], actions = [];
  let next = { version: '0.9.0', asset };
  const updater = createUpdater({
    currentVersion: '1.0.0', kind: 'image', emit: state => statuses.push(state),
    lookup: async () => next,
    apply: async (input, _kind, _image, progress, install) => {
      actions.push(input.version);
      progress(76); install();
      assert.equal(updater.blocksQuit(), true);
      return '/home/test/DNS.AppImage';
    },
    restart: image => actions.push(image)
  });
  assert.equal((await updater.check()).status, 'current');
  next = null;
  assert.equal((await updater.check()).status, 'unpublished');
  next = { version: release.version, asset: null };
  assert.equal((await updater.check()).status, 'no-package');
  next = release;
  assert.equal((await updater.check()).status, 'available');
  assert.deepEqual(actions, []);
  await updater.install('1.1.0');
  assert.deepEqual(actions, []);
  const state = await updater.install(release.version);
  assert.equal(state.status, 'restarting');
  assert.deepEqual(actions, [release.version, '/home/test/DNS.AppImage']);
  assert.ok(statuses.some(item => item.percent === 76));
});

test('failed install leaves a retry button; concurrent clicks do not start another install', async () => {
  let installs = 0, resolve;
  const updater = createUpdater({
    currentVersion: '1.0.0', kind: 'deb', lookup: async () => release,
    apply: async () => {
      installs++;
      await new Promise(done => { resolve = done; });
      throw new Error('Cancelada');
    }
  });
  await updater.check();
  const pending = updater.install(release.version);
  assert.equal((await updater.install(release.version)).status, 'downloading');
  assert.equal((await updater.check()).status, 'downloading');
  resolve();
  const state = await pending;
  assert.equal(installs, 1);
  assert.equal(state.status, 'available');
  assert.equal(state.admin, true);
  assert.equal(state.message, 'Cancelada');
});

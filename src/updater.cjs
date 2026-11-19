const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { Readable, Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { createWriteStream } = require('node:fs');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const runFile = promisify(execFile);
const repository = 'kelvinmattosdev/cloudflare-desktop-manager';
const releases = `https://api.github.com/repos/${repository}/releases/latest`;
const assets = `https://github.com/${repository}/releases/download/`;
const redirectHosts = new Set(['release-assets.githubusercontent.com', 'objects.githubusercontent.com']);
const suffix = { deb: 'amd64.deb', image: 'amd64.AppImage', win: 'x64.exe', mac: 'universal.zip' };
const manifest = { win: 'latest.yml', mac: 'latest-mac.yml' };
const releasePage = `https://github.com/${repository}/releases/latest`;

function parseVersion(tag) {
  const clean = typeof tag === 'string' ? tag.replace(/^v/, '') : '';
  if (!/^(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})$/.test(clean)) {
    throw new Error('A versão publicada no GitHub não está no formato esperado (vX.Y.Z).');
  }
  return clean;
}
function compareVersions(left, right) {
  const a = parseVersion(left).split('.').map(Number);
  const b = parseVersion(right).split('.').map(Number);
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return Math.sign(a[i] - b[i]);
  return 0;
}

function packageKind({ packaged, platform, arch, image, execPath }) {
  if (!packaged) return null;
  if (platform === 'win32' && arch === 'x64') return 'win';
  if (platform === 'darwin' && ['x64', 'arm64'].includes(arch)) return 'mac';
  if (platform !== 'linux' || arch !== 'x64') return null;
  if (image && path.isAbsolute(image)) return 'image';
  if (execPath === '/opt/DNS Console/nimbodesk' || execPath === '/opt/DNS Console/dns-console') return 'deb';
  return null;
}

async function latestRelease(kind, fetcher = fetch) {
  let response;
  try {
    response = await fetcher(releases, {
      redirect: 'error',
      signal: AbortSignal.timeout(12_000),
      headers: { Accept: 'application/vnd.github+json', 'Cache-Control': 'no-cache',
        'User-Agent': 'NimboDesk' }
    });
  } catch {
    throw new Error('Não foi possível conectar ao GitHub. Confira a conexão e tente checar novamente.');
  }
  if (response.status === 404) return null;
  if (response.status === 429 || (response.status === 403 && response.headers.get('x-ratelimit-remaining') === '0')) {
    throw new Error('O GitHub atingiu o limite de consultas. Aguarde um pouco antes de checar novamente.');
  }
  if (!response.ok) throw new Error(`Não foi possível consultar as versões no GitHub (HTTP ${response.status}).`);
  const release = await response.json().catch(() => null);
  if (release?.draft !== false || release?.prerelease !== false) {
    throw new Error('O GitHub não retornou uma versão estável válida.');
  }
  const version = parseVersion(release.tag_name);
  const name = `nimbodesk_${version}_${suffix[kind]}`;
  const url = `${assets}${release.tag_name}/${name}`;
  const entries = Array.isArray(release.assets) ? release.assets : [];
  const entry = entries.find(file => file?.name === name);
  const hasManifest = !manifest[kind] || entries.some(file => file?.state === 'uploaded' &&
    file.name === manifest[kind] && file.browser_download_url === `${assets}${release.tag_name}/${manifest[kind]}`);
  const sha256 = typeof entry?.digest === 'string' ? entry.digest.match(/^sha256:([a-f0-9]{64})$/i)?.[1].toLowerCase() : null;
  const size = entry?.size;
  const maxBytes = (kind === 'mac' ? 512 : 256) * 1024 * 1024;
  const asset = hasManifest && entry?.state === 'uploaded' && entry.browser_download_url === url &&
    /^[0-9a-f]{64}$/.test(sha256 || '') && Number.isSafeInteger(size) && size > 0 && size <= maxBytes ?
    { name, url, sha256, size } : null;
  return { version, asset };
}

async function downloadAsset(asset, output, progress, fetcher = fetch) {
  const signal = AbortSignal.timeout(300_000);
  try {
    let url = new URL(asset.url);
    if (!url.href.startsWith(assets)) throw new Error('Origem de download inválida.');
    let response;
    for (let i = 0; i < 4; i++) {
      response = await fetcher(url.href, { redirect: 'manual', signal });
      if (response.status < 300 || response.status > 399) break;
      const location = response.headers.get('location');
      await response.body?.cancel();
      if (!location) throw new Error('Redirecionamento inválido.');
      url = new URL(location, url);
      if (url.protocol !== 'https:' || url.port || url.username || url.password || !redirectHosts.has(url.hostname)) {
        throw new Error('Origem de download inválida.');
      }
    }
    if (!response?.ok || !response.body) throw new Error('Download indisponível.');
    const hash = createHash('sha256');
    let written = 0;
    const check = new Transform({
      transform(chunk, _, done) {
        written += chunk.length;
        if (written > asset.size) return done(new Error('Tamanho do pacote inválido.'));
        hash.update(chunk);
        progress(Math.floor(written * 100 / asset.size));
        done(null, chunk);
      }
    });
    await pipeline(Readable.fromWeb(response.body), check,
      createWriteStream(output, { flags: 'wx', mode: 0o600 }), { signal });
    if (written !== asset.size || hash.digest('hex') !== asset.sha256) throw new Error('Integridade inválida.');
  } catch {
    throw new Error('Não foi possível baixar ou verificar o instalador. Nenhuma atualização foi aplicada.');
  }
}

async function installDeb(file, version, run = runFile) {
  try {
    const { stdout } = await run('/usr/bin/dpkg-deb', [
      '--show', '--showformat=${Package}\\n${Version}\\n${Architecture}\\n', file
    ], { timeout: 10_000 });
    if (stdout.trim() !== `dns-console\n${version}\namd64`) throw new Error('Pacote incompatível.');
  } catch {
    throw new Error('O pacote baixado não é um instalador válido desta versão do NimboDesk.');
  }
  try {
    await run('/usr/bin/pkexec', ['/usr/bin/apt-get', 'install', '--yes', '--no-install-recommends', file]);
  } catch (error) {
    if (error.code === 126) throw new Error('A autorização da instalação foi cancelada.');
    if (error.code === 127 || error.code === 'ENOENT') {
      throw new Error('Não foi possível obter autorização de administrador para instalar.');
    }
    throw new Error('O instalador do Zorin não concluiu a atualização. Confira se há outra instalação em andamento e tente novamente.');
  }
}

async function installImage(file, currentImage) {
  let destination, staged;
  try {
    const input = await fs.open(file, 'r');
    try {
      const header = Buffer.alloc(11);
      await input.read(header, 0, header.length, 0);
      if (!header.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46])) ||
          !header.subarray(8, 11).equals(Buffer.from([0x41, 0x49, 0x02]))) {
        throw new Error('Formato de AppImage inválido.');
      }
    } finally { await input.close(); }
    destination = await fs.realpath(currentImage);
    const stat = await fs.lstat(destination);
    if (!stat.isFile() || stat.uid !== process.getuid()) throw new Error('AppImage não pertence ao usuário.');
    staged = path.join(path.dirname(destination), `.dns-console-update-${randomUUID()}`);
    await fs.copyFile(file, staged, fs.constants.COPYFILE_EXCL);
    await fs.chmod(staged, 0o755);
    await fs.rename(staged, destination);
    staged = null;
    return currentImage;
  } catch {
    throw new Error('Não foi possível substituir o AppImage. Mova-o para uma pasta sua, como Downloads, e tente novamente.');
  } finally {
    if (staged) await fs.rm(staged, { force: true }).catch(() => {});
  }
}

async function applyRelease(release, kind, image, onProgress, onInstall) {
  const work = await fs.mkdtemp(path.join(os.tmpdir(), 'dns-console-atualizacao-'));
  try {
    const file = path.join(work, release.asset.name);
    await downloadAsset(release.asset, file, onProgress);
    onInstall();
    if (kind === 'deb') return await installDeb(file, release.version);
    if (kind === 'image') return await installImage(file, image);
    throw new Error('Este formato de instalação não oferece atualização pelo app.');
  } finally { await fs.rm(work, { recursive: true, force: true }).catch(() => {}); }
}

function createUpdater({ currentVersion, kind, image, manual = false, emit, restart, stageNotes, discardNotes,
  lookup = latestRelease, apply = applyRelease }) {
  const current = parseVersion(currentVersion);
  let state = { status: kind ? 'idle' : 'disabled', current, seq: 0 };
  let candidate = null;
  let stagedVersion;
  const set = (status, extra) => {
    state = { status, current, seq: state.seq + 1, ...extra };
    emit?.(state);
  };
  const busy = () => ['checking', 'downloading', 'installing', 'restarting'].includes(state.status);
  const clearNotes = () => {
    if (!stagedVersion) return;
    try { discardNotes?.(current, stagedVersion); } catch { /* History does not block updates. */ }
    stagedVersion = undefined;
  };
  function restartFailed() {
    if (state.status !== 'restarting') return;
    if (kind === 'win' || kind === 'mac') {
      clearNotes();
      set('error', { message: 'O instalador não abriu. Cheque novamente ou baixe o arquivo na página de releases.' });
    } else {
      set('installed', { latest: state.latest, message: 'Atualização instalada. Feche e abra o NimboDesk para usar a nova versão.' });
    }
  }
  return {
    status: () => state,
    blocksQuit: () => state.status === 'installing',
    restartFailed,
    async check() {
      if (!kind || busy()) return state;
      candidate = null;
      set('checking');
      try {
        const release = await lookup(kind);
        if (!release) set('unpublished');
        else if (compareVersions(release.version, current) <= 0) set('current', { latest: release.version });
        else if (manual) set('manual', { latest: release.version,
          message: 'Nesta instalação do macOS, baixe a nova versão e mova o app para a pasta Aplicativos.' });
        else if (!release.asset) set('no-package', { latest: release.version });
        else { candidate = release; set('available', { latest: release.version, admin: kind === 'deb' }); }
      } catch (error) { set('error', { message: error.message }); }
      return state;
    },
    async install(expected) {
      if (!candidate || busy() || expected !== candidate.version) return state;
      const release = candidate;
      const latest = release.version;
      const admin = kind === 'deb';
      candidate = null;
      set('downloading', { latest, percent: 0, admin });
      let imagePath;
      try {
        imagePath = await apply(release, kind, image, percent => {
          if (percent !== state.percent) set('downloading', { latest, percent, admin });
        }, () => {
          try { stageNotes?.(current, latest); stagedVersion = latest; } catch { /* History does not block updates. */ }
          set('installing', { latest, admin });
        });
      } catch (error) {
        clearNotes();
        candidate = release;
        set('available', { latest, admin, message: error.message });
        return state;
      }
      set('restarting', { latest, admin });
      try { restart(imagePath); }
      catch { restartFailed(); }
      return state;
    }
  };
}

module.exports = { createUpdater, parseVersion, compareVersions, latestRelease, downloadAsset, installDeb, installImage, packageKind, releasePage, repository };

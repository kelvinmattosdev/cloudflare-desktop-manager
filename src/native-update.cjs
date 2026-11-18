const { createHash } = require('node:crypto');
const { createReadStream } = require('node:fs');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const path = require('node:path');

async function signedMacApp(execPath, run = promisify(execFile)) {
  const bundle = path.posix.resolve(execPath, '../../..');
  if (!bundle.endsWith('.app') || bundle.startsWith('/Volumes/')) return false;
  try {
    const { stderr } = await run('/usr/bin/codesign', ['-dv', '--verbose=4', bundle], { timeout: 5000 });
    return /^Authority=Developer ID Application:/m.test(stderr) && /^TeamIdentifier=[A-Z0-9]{10}$/m.test(stderr);
  } catch { return false; }
}

async function verifyFile(file, asset) {
  let count = 0;
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) {
    count += chunk.length;
    if (count > asset.size) return false;
    hash.update(chunk);
  }
  return count === asset.size && hash.digest('hex') === asset.sha256;
}

function nativeUpdater(updater, onError = () => {}) {
  updater.autoDownload = false;
  updater.autoInstallOnAppQuit = false;
  updater.autoRunAppAfterInstall = true;
  updater.allowPrerelease = false;
  updater.allowDowngrade = false;
  updater.disableWebInstaller = true;
  updater.disableDifferentialDownload = true;
  updater.logger = null;
  // The returned promises report failures in the UI. Keep the EventEmitter error path handled too.
  updater.on('error', onError);

  return async (release, _kind, _image, onProgress, onInstall) => {
    const listener = state => {
      if (Number.isFinite(state.percent)) onProgress(Math.min(100, Math.max(0, Math.floor(state.percent))));
    };
    updater.on('download-progress', listener);
    try {
      const check = await updater.checkForUpdates();
      const files = check?.updateInfo?.files;
      if (!check?.isUpdateAvailable || check.updateInfo.version !== release.version ||
          !files?.some(file => file.url === release.asset.name && file.size === release.asset.size)) {
        throw new Error('Manifesto incompatível.');
      }
      const [downloaded] = await updater.downloadUpdate();
      if (!downloaded || !await verifyFile(downloaded, release.asset)) throw new Error('Integridade inválida.');
      onInstall();
      return () => updater.quitAndInstall(false, true);
    } catch {
      throw new Error('Não foi possível preparar a atualização. Cheque novamente ou baixe o instalador na página de releases.');
    } finally {
      updater.removeListener('download-progress', listener);
    }
  };
}

module.exports = { signedMacApp, nativeUpdater };

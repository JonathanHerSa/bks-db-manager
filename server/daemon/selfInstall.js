import fs from 'fs';
import os from 'os';
import path from 'path';
import { getPaths } from './paths.js';
import { getServiceModule } from './service.js';
import { waitForDaemon } from './statusCheck.js';

/**
 * Copies the currently-running binary to its permanent install location and
 * registers it as a background service. Idempotent: safe to call again on
 * an update (it stops the old instance first) or when already installed
 * (copying a file onto itself is skipped).
 */
export async function selfInstall({ execPath = process.execPath, version = '0.0.0' } = {}) {
  const platform = os.platform();
  const svc = getServiceModule(platform);
  if (!svc) {
    return { success: false, error: `Unsupported platform: ${platform}` };
  }

  const paths = getPaths(platform);

  // Stop any previous instance first — required on Windows, where an
  // executable can't be overwritten while it's running.
  if (svc.isRegistered(paths)) {
    svc.stop(paths);
  }

  fs.mkdirSync(paths.binDir, { recursive: true });

  const alreadyInPlace = path.resolve(execPath) === path.resolve(paths.binPath);
  if (!alreadyInPlace) {
    fs.copyFileSync(execPath, paths.binPath);
    if (platform !== 'win32') {
      fs.chmodSync(paths.binPath, 0o755);
    }
  }

  fs.writeFileSync(paths.versionFile, version, 'utf-8');

  svc.register({
    ...paths,
    execCommand: `"${paths.binPath}" --serve`,
    programArguments: [paths.binPath, '--serve'],
  });

  const status = await waitForDaemon();
  return { success: Boolean(status?.ok), status, paths };
}

export function selfUninstall() {
  const platform = os.platform();
  const svc = getServiceModule(platform);
  if (!svc) {
    return { success: false, error: `Unsupported platform: ${platform}` };
  }

  const paths = getPaths(platform);
  svc.unregister(paths);

  try {
    if (fs.existsSync(paths.dataDir)) {
      fs.rmSync(paths.dataDir, { recursive: true, force: true });
    }
  } catch {
    // Non-fatal: the service is already unregistered, a leftover directory
    // (e.g. a file still locked on Windows) doesn't affect correctness.
  }

  return { success: true };
}

export function getInstallInfo() {
  const platform = os.platform();
  const svc = getServiceModule(platform);
  const paths = getPaths(platform);
  const installedVersion = fs.existsSync(paths.versionFile)
    ? fs.readFileSync(paths.versionFile, 'utf-8').trim()
    : null;

  return {
    platform,
    paths,
    binExists: fs.existsSync(paths.binPath),
    registered: svc ? svc.isRegistered(paths) : false,
    installedVersion,
  };
}

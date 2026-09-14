import path from 'path';
import os from 'os';

/**
 * Resolves every filesystem location the companion installer touches, for
 * the current platform. No path here requires elevated privileges (no
 * sudo/UAC) and none of them live inside a Downloads folder or the cloned
 * repo, so the installed binary survives the user deleting either.
 *
 * NOTE: this must build correct Windows-style paths even when this code
 * itself runs on Linux/macOS (unit tests, or a future cross-compilation
 * step) — plain `path.join` resolves to whichever flavor the *host* OS is,
 * not the target `platform` argument, so Windows paths are built with
 * `path.win32` explicitly rather than the ambient `path` import.
 */
export function getPaths(platform = os.platform(), home = os.homedir()) {
  const isWindows = platform === 'win32';
  const p = isWindows ? path.win32 : path.posix;
  const binName = isWindows ? 'bks-db-manager-companion.exe' : 'bks-db-manager-companion';

  let dataDir;
  let logDir;
  let servicePath;

  if (platform === 'darwin') {
    dataDir = p.join(home, 'Library', 'Application Support', 'bks-db-manager');
    logDir = p.join(home, 'Library', 'Logs', 'bks-db-manager');
    servicePath = p.join(home, 'Library', 'LaunchAgents', 'com.t3zcadev.bks-db-manager.plist');
  } else if (isWindows) {
    const base = process.env.LOCALAPPDATA || p.join(home, 'AppData', 'Local');
    dataDir = p.join(base, 'bks-db-manager');
    logDir = p.join(dataDir, 'logs');
    servicePath = p.join(
      process.env.APPDATA || p.join(home, 'AppData', 'Roaming'),
      'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', 'bks-db-manager.vbs'
    );
  } else {
    // Linux and other XDG-following platforms.
    const xdgData = process.env.XDG_DATA_HOME || p.join(home, '.local', 'share');
    dataDir = p.join(xdgData, 'bks-db-manager');
    logDir = p.join(dataDir, 'logs');
    servicePath = p.join(home, '.config', 'systemd', 'user', 'bks-db-manager.service');
  }

  const binDir = p.join(dataDir, 'bin');

  return {
    platform,
    isWindows,
    dataDir,
    binDir,
    binName,
    binPath: p.join(binDir, binName),
    logDir,
    servicePath,
    versionFile: p.join(dataDir, 'version.txt'),
  };
}

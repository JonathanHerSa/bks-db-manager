import * as linux from './service.linux.js';
import * as macos from './service.macos.js';
import * as windows from './service.windows.js';

/** Picks the platform-specific service module, all sharing the same interface:
 * register(paths), unregister(paths), isRegistered(paths), start(paths), stop(paths). */
export function getServiceModule(platform) {
  if (platform === 'darwin') return macos;
  if (platform === 'win32') return windows;
  if (platform === 'linux') return linux;
  return null;
}

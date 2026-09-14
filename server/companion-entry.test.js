// Tests the argv dispatch in server/companion-entry.js (the SEA companion
// binary's entry point) without ever touching a real filesystem/service —
// every daemon/* module it calls is mocked.
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';

const startServer = vi.fn();
const selfInstall = vi.fn();
const selfUninstall = vi.fn();
const getInstallInfo = vi.fn();
const getServiceModule = vi.fn();
const checkDaemonStatus = vi.fn();
const waitForDaemon = vi.fn();
const notifyUser = vi.fn();

vi.mock('./index.js', () => ({
  startServer: (...a) => startServer(...a),
  COMPANION_VERSION: '1.2.3',
}));
vi.mock('./daemon/selfInstall.js', () => ({
  selfInstall: (...a) => selfInstall(...a),
  selfUninstall: (...a) => selfUninstall(...a),
  getInstallInfo: (...a) => getInstallInfo(...a),
}));
vi.mock('./daemon/service.js', () => ({
  getServiceModule: (...a) => getServiceModule(...a),
}));
vi.mock('./daemon/statusCheck.js', () => ({
  checkDaemonStatus: (...a) => checkDaemonStatus(...a),
  waitForDaemon: (...a) => waitForDaemon(...a),
}));
vi.mock('./daemon/notify.js', () => ({
  notifyUser: (...a) => notifyUser(...a),
}));

const { main } = await import('./companion-entry.js');

const ORIGINAL_ARGV = process.argv;

beforeEach(() => {
  vi.clearAllMocks();
  selfInstall.mockResolvedValue({ success: true, status: { ok: true } });
  selfUninstall.mockReturnValue({ success: true });
  getInstallInfo.mockReturnValue({
    platform: 'linux',
    paths: {},
    binExists: false,
    registered: false,
    installedVersion: null,
  });
  getServiceModule.mockReturnValue({ start: vi.fn(), stop: vi.fn() });
  checkDaemonStatus.mockResolvedValue(null);
  waitForDaemon.mockResolvedValue({ ok: true, version: '1.2.3', tools: {} });
});

afterEach(() => {
  process.argv = ORIGINAL_ARGV;
});

/** Runs main() with the given CLI args, capturing the exit code instead of
 * actually killing the test process. */
async function run(...args) {
  process.argv = ['/path/to/bks-db-manager-companion', './bks-db-manager-companion', ...args];
  let exitCode;
  const exitSpy = vi.spyOn(process, 'exit').mockImplementation((code) => {
    exitCode = code;
    throw new Error('__process_exit__');
  });
  try {
    await main();
  } catch (err) {
    if (err.message !== '__process_exit__') throw err;
  }
  exitSpy.mockRestore();
  return exitCode;
}

describe('companion-entry dispatch', () => {
  test('--serve starts the server and does not exit the process', async () => {
    process.argv = ['/path/to/bks-db-manager-companion', './bks-db-manager-companion', '--serve'];
    await main();
    expect(startServer).toHaveBeenCalledTimes(1);
  });

  test('--install runs selfInstall and exits 0 on success', async () => {
    const code = await run('--install');
    expect(selfInstall).toHaveBeenCalledWith({ execPath: process.execPath, version: '1.2.3' });
    expect(code).toBe(0);
  });

  test('--install exits 1 when selfInstall reports failure', async () => {
    selfInstall.mockResolvedValue({ success: false, error: 'boom' });
    const code = await run('--install');
    expect(code).toBe(1);
  });

  test('--uninstall runs selfUninstall and exits 0 on success', async () => {
    const code = await run('--uninstall');
    expect(selfUninstall).toHaveBeenCalledTimes(1);
    expect(code).toBe(0);
  });

  test('--version prints COMPANION_VERSION and exits 0', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const code = await run('--version');
    expect(logSpy).toHaveBeenCalledWith('1.2.3');
    expect(code).toBe(0);
    logSpy.mockRestore();
  });

  test('an unknown command exits 1', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const code = await run('--bogus');
    expect(code).toBe(1);
    errSpy.mockRestore();
  });

  describe('no-args double-click flow', () => {
    test('when already installed, registered and up to date, just confirms and exits 0', async () => {
      getInstallInfo.mockReturnValue({
        platform: 'linux', paths: {}, binExists: true, registered: true, installedVersion: '1.2.3',
      });
      checkDaemonStatus.mockResolvedValue({ ok: true, version: '1.2.3' });
      const code = await run();
      expect(selfInstall).not.toHaveBeenCalled();
      expect(notifyUser).toHaveBeenCalled();
      expect(code).toBe(0);
    });

    test('when installed but not responding, starts the service instead of reinstalling', async () => {
      getInstallInfo.mockReturnValue({
        platform: 'linux', paths: { some: 'paths' }, binExists: true, registered: true, installedVersion: '1.2.3',
      });
      checkDaemonStatus.mockResolvedValue(null);
      const startFn = vi.fn();
      getServiceModule.mockReturnValue({ start: startFn, stop: vi.fn() });
      waitForDaemon.mockResolvedValue({ ok: true });

      const code = await run();

      expect(startFn).toHaveBeenCalledWith({ some: 'paths' });
      expect(selfInstall).not.toHaveBeenCalled();
      expect(code).toBe(0);
    });

    test('when not installed at all, runs a full self-install', async () => {
      const code = await run();
      expect(selfInstall).toHaveBeenCalledTimes(1);
      expect(code).toBe(0);
    });

    test('when the version on disk differs, reinstalls instead of just confirming', async () => {
      getInstallInfo.mockReturnValue({
        platform: 'linux', paths: {}, binExists: true, registered: true, installedVersion: '0.9.0',
      });
      const code = await run();
      expect(selfInstall).toHaveBeenCalledTimes(1);
      expect(code).toBe(0);
    });
  });
});

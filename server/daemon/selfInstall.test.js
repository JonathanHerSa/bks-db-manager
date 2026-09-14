import { describe, test, expect, vi, beforeEach } from 'vitest';

vi.mock('fs', () => {
  const existsSync = vi.fn(() => false);
  const mkdirSync = vi.fn(() => undefined);
  const copyFileSync = vi.fn(() => undefined);
  const chmodSync = vi.fn(() => undefined);
  const writeFileSync = vi.fn(() => undefined);
  const readFileSync = vi.fn(() => '');
  const rmSync = vi.fn(() => undefined);
  const api = { existsSync, mkdirSync, copyFileSync, chmodSync, writeFileSync, readFileSync, rmSync };
  return { ...api, default: api };
});

const getPaths = vi.fn();
const getServiceModule = vi.fn();
const waitForDaemon = vi.fn();

vi.mock('./paths.js', () => ({ getPaths: (...a) => getPaths(...a) }));
vi.mock('./service.js', () => ({ getServiceModule: (...a) => getServiceModule(...a) }));
vi.mock('./statusCheck.js', () => ({ waitForDaemon: (...a) => waitForDaemon(...a) }));

const fs = (await import('fs')).default;
const { selfInstall, selfUninstall, getInstallInfo } = await import('./selfInstall.js');

const FAKE_PATHS = {
  platform: 'linux',
  binDir: '/home/alice/.local/share/bks-db-manager/bin',
  binPath: '/home/alice/.local/share/bks-db-manager/bin/bks-db-manager-companion',
  dataDir: '/home/alice/.local/share/bks-db-manager',
  versionFile: '/home/alice/.local/share/bks-db-manager/version.txt',
  servicePath: '/home/alice/.config/systemd/user/bks-db-manager.service',
};

beforeEach(() => {
  vi.clearAllMocks();
  fs.existsSync.mockReturnValue(false);
  getPaths.mockReturnValue(FAKE_PATHS);
  waitForDaemon.mockResolvedValue({ ok: true, version: '1.1.0' });
});

describe('selfInstall', () => {
  test('stops a previously registered instance before overwriting the binary (required on Windows)', async () => {
    const callOrder = [];
    const stop = vi.fn(() => callOrder.push('stop'));
    const register = vi.fn(() => callOrder.push('register'));
    const isRegistered = vi.fn().mockReturnValue(true);
    getServiceModule.mockReturnValue({ stop, register, isRegistered });
    fs.copyFileSync.mockImplementation(() => callOrder.push('copy'));

    await selfInstall({ execPath: '/downloads/companion-new', version: '1.1.0' });

    expect(callOrder).toEqual(['stop', 'copy', 'register']);
  });

  test('copies the running binary to the permanent install path and marks it executable', async () => {
    const register = vi.fn();
    getServiceModule.mockReturnValue({ stop: vi.fn(), register, isRegistered: () => false });

    await selfInstall({ execPath: '/downloads/companion-new', version: '1.1.0' });

    expect(fs.copyFileSync).toHaveBeenCalledWith('/downloads/companion-new', FAKE_PATHS.binPath);
    expect(fs.chmodSync).toHaveBeenCalledWith(FAKE_PATHS.binPath, 0o755);
    expect(fs.writeFileSync).toHaveBeenCalledWith(FAKE_PATHS.versionFile, '1.1.0', 'utf-8');
  });

  test('skips copying when already running from the installed location (re-running the installed binary itself)', async () => {
    getServiceModule.mockReturnValue({ stop: vi.fn(), register: vi.fn(), isRegistered: () => false });

    await selfInstall({ execPath: FAKE_PATHS.binPath, version: '1.1.0' });

    expect(fs.copyFileSync).not.toHaveBeenCalled();
  });

  test('registers with an execCommand and programArguments pointing at the installed binary + --serve', async () => {
    const register = vi.fn();
    getServiceModule.mockReturnValue({ stop: vi.fn(), register, isRegistered: () => false });

    await selfInstall({ execPath: '/downloads/companion-new', version: '1.1.0' });

    const call = register.mock.calls[0][0];
    expect(call.execCommand).toBe(`"${FAKE_PATHS.binPath}" --serve`);
    expect(call.programArguments).toEqual([FAKE_PATHS.binPath, '--serve']);
  });

  test('reports failure (without throwing) when the daemon never comes up after install', async () => {
    getServiceModule.mockReturnValue({ stop: vi.fn(), register: vi.fn(), isRegistered: () => false });
    waitForDaemon.mockResolvedValue(null);

    const result = await selfInstall({ execPath: '/downloads/companion-new', version: '1.1.0' });

    expect(result.success).toBe(false);
  });

  test('reports failure for an unsupported platform without throwing', async () => {
    getServiceModule.mockReturnValue(null);
    const result = await selfInstall({ execPath: '/x', version: '1.0.0' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('Unsupported platform');
  });
});

describe('selfUninstall', () => {
  test('unregisters and removes the data directory', () => {
    const unregister = vi.fn();
    getServiceModule.mockReturnValue({ unregister });
    fs.existsSync.mockReturnValue(true);

    const result = selfUninstall();

    expect(unregister).toHaveBeenCalledWith(FAKE_PATHS);
    expect(fs.rmSync).toHaveBeenCalledWith(FAKE_PATHS.dataDir, { recursive: true, force: true });
    expect(result.success).toBe(true);
  });

  test('still reports success even if removing the data directory fails (service is already gone)', () => {
    const unregister = vi.fn();
    getServiceModule.mockReturnValue({ unregister });
    fs.existsSync.mockReturnValue(true);
    fs.rmSync.mockImplementation(() => { throw new Error('locked'); });

    const result = selfUninstall();

    expect(result.success).toBe(true);
  });
});

describe('getInstallInfo', () => {
  test('reports whether the binary exists, is registered, and its recorded version', () => {
    fs.existsSync.mockImplementation((p) => p === FAKE_PATHS.binPath || p === FAKE_PATHS.versionFile);
    fs.readFileSync.mockReturnValue('1.1.0\n');
    getServiceModule.mockReturnValue({ isRegistered: () => true });

    const info = getInstallInfo();

    expect(info.binExists).toBe(true);
    expect(info.registered).toBe(true);
    expect(info.installedVersion).toBe('1.1.0');
  });

  test('returns null installedVersion when no version file exists yet', () => {
    fs.existsSync.mockReturnValue(false);
    getServiceModule.mockReturnValue({ isRegistered: () => false });

    const info = getInstallInfo();

    expect(info.installedVersion).toBeNull();
  });
});

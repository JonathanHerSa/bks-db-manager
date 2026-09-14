import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { getPaths } from './paths.js';

// getPaths() intentionally honors XDG_DATA_HOME/APPDATA/LOCALAPPDATA when
// set, so these tests must isolate themselves from whatever the actual host
// running the test suite happens to have exported (e.g. XDG_DATA_HOME is set
// on most modern Linux desktop sessions) rather than asserting on real env.
const ORIGINAL_ENV = {
  XDG_DATA_HOME: process.env.XDG_DATA_HOME,
  LOCALAPPDATA: process.env.LOCALAPPDATA,
  APPDATA: process.env.APPDATA,
};

beforeEach(() => {
  delete process.env.XDG_DATA_HOME;
  delete process.env.LOCALAPPDATA;
  delete process.env.APPDATA;
});

afterEach(() => {
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe('getPaths', () => {
  test('linux: uses XDG data dir and a systemd --user unit path', () => {
    const p = getPaths('linux', '/home/alice');
    expect(p.dataDir).toBe('/home/alice/.local/share/bks-db-manager');
    expect(p.binDir).toBe('/home/alice/.local/share/bks-db-manager/bin');
    expect(p.binName).toBe('bks-db-manager-companion');
    expect(p.binPath).toBe('/home/alice/.local/share/bks-db-manager/bin/bks-db-manager-companion');
    expect(p.servicePath).toBe('/home/alice/.config/systemd/user/bks-db-manager.service');
    expect(p.isWindows).toBe(false);
  });

  test('darwin: uses Application Support and a LaunchAgents plist path', () => {
    const p = getPaths('darwin', '/Users/alice');
    expect(p.dataDir).toBe('/Users/alice/Library/Application Support/bks-db-manager');
    expect(p.logDir).toBe('/Users/alice/Library/Logs/bks-db-manager');
    expect(p.servicePath).toBe('/Users/alice/Library/LaunchAgents/com.t3zcadev.bks-db-manager.plist');
  });

  test('win32: uses a .exe binary name and a Startup-folder .vbs path', () => {
    const p = getPaths('win32', 'C:\\Users\\alice');
    expect(p.binName).toBe('bks-db-manager-companion.exe');
    expect(p.isWindows).toBe(true);
    expect(p.servicePath).toContain('Startup');
    expect(p.servicePath.endsWith('bks-db-manager.vbs')).toBe(true);
  });

  test('every platform keeps the install location outside of the repo/Downloads', () => {
    for (const platform of ['linux', 'darwin', 'win32']) {
      const p = getPaths(platform, platform === 'win32' ? 'C:\\Users\\alice' : '/home/alice');
      expect(p.binDir).not.toContain('Downloads');
      expect(p.binDir).not.toContain('bks-db-manager-repo');
    }
  });
});

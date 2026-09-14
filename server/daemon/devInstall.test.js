import { describe, test, expect, vi, beforeEach } from 'vitest';

const getPaths = vi.fn();
const getServiceModule = vi.fn();
const waitForDaemon = vi.fn();

vi.mock('./paths.js', () => ({ getPaths: (...a) => getPaths(...a) }));
vi.mock('./service.js', () => ({ getServiceModule: (...a) => getServiceModule(...a) }));
vi.mock('./statusCheck.js', () => ({ waitForDaemon: (...a) => waitForDaemon(...a) }));

const { devInstall, devUninstall } = await import('./devInstall.js');

const FAKE_PATHS = { servicePath: '/x/bks-db-manager.service', binName: 'node' };

beforeEach(() => {
  vi.clearAllMocks();
  getPaths.mockReturnValue(FAKE_PATHS);
  waitForDaemon.mockResolvedValue({ ok: true });
});

describe('devInstall', () => {
  test('stops a previously registered instance before re-registering, so a changed exec command actually takes effect', async () => {
    const callOrder = [];
    const stop = vi.fn(() => callOrder.push('stop'));
    const register = vi.fn(() => callOrder.push('register'));
    const isRegistered = vi.fn().mockReturnValue(true);
    getServiceModule.mockReturnValue({ stop, register, isRegistered });

    await devInstall({ nodeBin: '/usr/bin/node', serverScript: '/repo/server/serve.js' });

    expect(callOrder).toEqual(['stop', 'register']);
  });

  test('does not call stop when nothing was registered yet (fresh install)', async () => {
    const stop = vi.fn();
    const register = vi.fn();
    const isRegistered = vi.fn().mockReturnValue(false);
    getServiceModule.mockReturnValue({ stop, register, isRegistered });

    await devInstall({ nodeBin: '/usr/bin/node', serverScript: '/repo/server/serve.js' });

    expect(stop).not.toHaveBeenCalled();
    expect(register).toHaveBeenCalledTimes(1);
  });

  test('registers with an execCommand pointing at node + the server script, never a self-copied binary', async () => {
    const register = vi.fn();
    getServiceModule.mockReturnValue({ stop: vi.fn(), register, isRegistered: () => false });

    await devInstall({ nodeBin: '/usr/bin/node', serverScript: '/repo/server/serve.js' });

    const call = register.mock.calls[0][0];
    expect(call.execCommand).toBe('"/usr/bin/node" "/repo/server/serve.js"');
    expect(call.programArguments).toEqual(['/usr/bin/node', '/repo/server/serve.js']);
  });

  test('reports failure for an unsupported platform without throwing', async () => {
    getServiceModule.mockReturnValue(null);
    const result = await devInstall({ nodeBin: 'node', serverScript: 'x' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('Unsupported platform');
  });
});

describe('devUninstall', () => {
  test('unregisters using the resolved paths', () => {
    const unregister = vi.fn();
    getServiceModule.mockReturnValue({ unregister });

    const result = devUninstall();

    expect(unregister).toHaveBeenCalledWith(FAKE_PATHS);
    expect(result.success).toBe(true);
  });
});

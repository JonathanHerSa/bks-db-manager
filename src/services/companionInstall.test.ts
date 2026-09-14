import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';

const openExternal = vi.fn();

vi.mock('@beekeeperstudio/plugin', () => ({
  openExternal: (...a: any[]) => openExternal(...a)
}));

const { detectPlatform, downloadUrl, openDownload, releasesPageUrl } = await import('./companionInstall');

const ORIGINAL_NAVIGATOR = { ...navigator };

function setNavigator(overrides: Partial<Navigator> & { userAgentData?: any }) {
  Object.defineProperty(window, 'navigator', {
    value: { ...ORIGINAL_NAVIGATOR, ...overrides },
    configurable: true
  });
}

beforeEach(() => {
  openExternal.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  Object.defineProperty(window, 'navigator', { value: ORIGINAL_NAVIGATOR, configurable: true });
});

describe('detectPlatform', () => {
  test('detects Windows from navigator.platform', () => {
    setNavigator({ platform: 'Win32', userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' });
    expect(detectPlatform()).toBe('win-x64');
  });

  test('detects macOS and defaults to Apple Silicon', () => {
    setNavigator({ platform: 'MacIntel', userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' });
    expect(detectPlatform()).toBe('darwin-arm64');
  });

  test('detects Linux x64 by default', () => {
    setNavigator({ platform: 'Linux x86_64', userAgent: 'Mozilla/5.0 (X11; Linux x86_64)' });
    expect(detectPlatform()).toBe('linux-x64');
  });

  test('detects Linux ARM64 when the user agent mentions aarch64', () => {
    setNavigator({ platform: 'Linux aarch64', userAgent: 'Mozilla/5.0 (X11; Linux aarch64)' });
    expect(detectPlatform()).toBe('linux-arm64');
  });

  test('prefers navigator.userAgentData.platform when present', () => {
    setNavigator({ userAgentData: { platform: 'Windows' }, platform: '', userAgent: '' });
    expect(detectPlatform()).toBe('win-x64');
  });

  test('returns "unknown" instead of guessing when there is no usable signal', () => {
    setNavigator({ platform: '', userAgent: '', userAgentData: undefined });
    expect(detectPlatform()).toBe('unknown');
  });
});

describe('downloadUrl', () => {
  test('builds a /releases/latest/download/ URL with the exact CI asset name', () => {
    expect(downloadUrl('win-x64')).toBe(
      'https://github.com/JonathanHerSa/bks-db-manager/releases/latest/download/bks-db-manager-companion-win-x64.zip'
    );
    expect(downloadUrl('darwin-arm64')).toContain('bks-db-manager-companion-darwin-arm64.tar.gz');
  });
});

describe('openDownload', () => {
  test('opens the platform-specific asset URL via the SDK', async () => {
    await openDownload('linux-x64');
    expect(openExternal).toHaveBeenCalledWith(downloadUrl('linux-x64'));
  });

  test('opens the releases page itself when the platform is unknown, never a broken asset link', async () => {
    await openDownload('unknown');
    expect(openExternal).toHaveBeenCalledWith(releasesPageUrl());
  });

  test('falls back to window.open when openExternal is unavailable/throws', async () => {
    openExternal.mockRejectedValue(new Error('not available in this view'));
    const windowOpenSpy = vi.spyOn(window, 'open').mockImplementation(() => null);

    await openDownload('win-x64');

    expect(windowOpenSpy).toHaveBeenCalledWith(downloadUrl('win-x64'), '_blank', 'noopener');
    windowOpenSpy.mockRestore();
  });

  test('never throws even if both openExternal and window.open fail', async () => {
    openExternal.mockRejectedValue(new Error('nope'));
    const windowOpenSpy = vi.spyOn(window, 'open').mockImplementation(() => { throw new Error('blocked'); });

    await expect(openDownload('win-x64')).resolves.toBeUndefined();

    windowOpenSpy.mockRestore();
  });
});

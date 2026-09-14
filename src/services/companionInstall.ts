import { openExternal } from '@beekeeperstudio/plugin';

const REPO = 'JonathanHerSa/bks-db-manager';
const RELEASE_BASE = `https://github.com/${REPO}/releases/latest/download`;
const RELEASES_PAGE = `https://github.com/${REPO}/releases/latest`;
const DOCS_URL = `https://github.com/${REPO}/blob/main/docs/COMPANION.md`;

// NOTE: 'darwin-x64' (Intel Mac) is intentionally not offered as a download
// target right now — `node --build-sea` output segfaults on every
// invocation on Intel macOS, a confirmed open Node.js bug
// (https://github.com/nodejs/node/issues/62893), so
// .github/workflows/release.yml does not build or publish that asset.
// Re-add it here once that's fixed upstream and the workflow ships it again.
export type CompanionPlatform = 'linux-x64' | 'linux-arm64' | 'darwin-arm64' | 'win-x64' | 'unknown';

// Must match the asset names produced by .github/workflows/release.yml.
const ASSET_NAMES: Record<Exclude<CompanionPlatform, 'unknown'>, string> = {
  'linux-x64': 'bks-db-manager-companion-linux-x64.tar.gz',
  'linux-arm64': 'bks-db-manager-companion-linux-arm64.tar.gz',
  'darwin-arm64': 'bks-db-manager-companion-darwin-arm64.tar.gz',
  'win-x64': 'bks-db-manager-companion-win-x64.zip'
};

export const COMPANION_PLATFORM_LABELS: Record<Exclude<CompanionPlatform, 'unknown'>, string> = {
  'linux-x64': 'Linux (x64)',
  'linux-arm64': 'Linux (ARM64)',
  'darwin-arm64': 'macOS (Apple Silicon)',
  'win-x64': 'Windows (x64)'
};

/**
 * Best-effort, synchronous OS/arch detection from the sandboxed plugin
 * webview. NOT confirmed reliable inside Beekeeper Studio's `plugin://`
 * iframe (navigator.userAgentData may not exist there) — this must never be
 * the only way to pick a download: callers always also offer the manual
 * list from COMPANION_PLATFORM_LABELS instead of blocking on this.
 */
export function detectPlatform(): CompanionPlatform {
  try {
    const uaData = (navigator as any)?.userAgentData;
    const raw = String(uaData?.platform || navigator.platform || navigator.userAgent || '').toLowerCase();
    const ua = String(navigator.userAgent || '').toLowerCase();

    if (raw.includes('win')) return 'win-x64';
    if (raw.includes('mac')) {
      // Only Apple Silicon is currently published (see the NOTE above for
      // why Intel Mac isn't offered yet) — Apple Silicon has also been the
      // default new Mac since 2020, so this guess is right for most users.
      return 'darwin-arm64';
    }
    if (raw.includes('linux')) {
      return /arm|aarch64/.test(ua) ? 'linux-arm64' : 'linux-x64';
    }
  } catch {
    // `navigator` may not behave as expected inside the plugin sandbox —
    // fall through to 'unknown' rather than guess further.
  }
  return 'unknown';
}

export function downloadUrl(platform: Exclude<CompanionPlatform, 'unknown'>): string {
  return `${RELEASE_BASE}/${ASSET_NAMES[platform]}`;
}

/**
 * Opens an external URL using the SDK's openExternal — falling back to
 * window.open in case openExternal isn't actually usable from a plugin view
 * (unverified in this project; see docs/COMPANION.md's open risks section).
 */
export async function openUrl(url: string): Promise<void> {
  try {
    await openExternal(url);
  } catch {
    try {
      window.open(url, '_blank', 'noopener');
    } catch {
      // Nothing more we can do — the caller's UI should also render the URL
      // as a plain link so it's never a dead end.
    }
  }
}

/** Opens the download for the given platform, or the releases page itself
 * when the platform is 'unknown' so it's never a broken/guessed link. */
export function openDownload(platform: CompanionPlatform): Promise<void> {
  return openUrl(platform === 'unknown' ? RELEASES_PAGE : downloadUrl(platform));
}

export function releasesPageUrl(): string {
  return RELEASES_PAGE;
}

export function docsUrl(): string {
  return DOCS_URL;
}

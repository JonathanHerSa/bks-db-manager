import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const LABEL = 'com.t3zcadev.bks-db-manager';

/**
 * Pure so it can be unit-tested without touching launchd.
 * `programArguments` is the argv array launchd should exec directly (no
 * shell involved): either `[binPath, '--serve']` (production self-install)
 * or `[nodeBin, serverScript]` (dev, via scripts/setup-daemon.js).
 */
export function buildPlistContent({ programArguments, logDir }) {
  const argsXml = programArguments.map((arg) => `        <string>${escapeXml(arg)}</string>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${LABEL}</string>
    <key>ProgramArguments</key>
    <array>
${argsXml}
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>EnvironmentVariables</key>
    <dict>
        <key>BKS_DB_MANAGER_PORT</key>
        <string>58765</string>
    </dict>
    <key>StandardOutPath</key>
    <string>${path.join(logDir, 'out.log')}</string>
    <key>StandardErrorPath</key>
    <string>${path.join(logDir, 'err.log')}</string>
</dict>
</plist>
`;
}

function escapeXml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function domainTarget() {
  return `gui/${process.getuid ? process.getuid() : 0}`;
}

export function register({ programArguments, servicePath, logDir, binPath }) {
  fs.mkdirSync(path.dirname(servicePath), { recursive: true });
  fs.mkdirSync(logDir, { recursive: true });
  if (binPath) {
    // Binaries copied from a downloaded file carry a quarantine flag;
    // launchd refuses to run a quarantined executable even after the user
    // has opened it once manually. Not applicable in dev mode, where the
    // exec target is the system `node` binary.
    try { execSync(`xattr -dr com.apple.quarantine "${binPath}"`); } catch {}
  }
  fs.writeFileSync(servicePath, buildPlistContent({ programArguments, logDir }), 'utf-8');
  try {
    execSync(`launchctl bootstrap ${domainTarget()} "${servicePath}"`);
  } catch {
    execSync(`launchctl load -w "${servicePath}"`);
  }
}

export function unregister({ servicePath }) {
  try { execSync(`launchctl bootout ${domainTarget()}/${LABEL} 2>/dev/null || true`); } catch {}
  try { execSync(`launchctl unload -w "${servicePath}" 2>/dev/null || true`); } catch {}
  if (fs.existsSync(servicePath)) fs.unlinkSync(servicePath);
}

export function isRegistered({ servicePath }) {
  return fs.existsSync(servicePath);
}

export function stop() {
  try { execSync(`launchctl kickstart -k ${domainTarget()}/${LABEL} 2>/dev/null || true`); } catch {}
}

export function start({ servicePath }) {
  try {
    execSync(`launchctl kickstart -k ${domainTarget()}/${LABEL}`);
  } catch {
    execSync(`launchctl load -w "${servicePath}"`);
  }
}

import fs from 'fs';
import path from 'path';
import { execSync, spawn } from 'child_process';

/**
 * Pure so it can be unit-tested without touching the real Startup folder.
 * Not a true Windows Service (that needs an elevated install via sc.exe /
 * NSSM) — a Startup-folder script is the zero-admin-rights equivalent of
 * systemd --user / a LaunchAgent, matching how scripts/setup-daemon.js
 * already did this for the npm-based install.
 *
 * `execCommand` is the fully-quoted command line to pass to
 * `WshShell.Run(...)`: either `"<binPath>" --serve` (production
 * self-install) or `"<node>" "<repo>/server/serve.js"` (dev).
 */
export function buildVbsContent({ execCommand }) {
  return `Set WshShell = CreateObject("WScript.Shell")
WshShell.Run "${execCommand.replace(/\\/g, '\\\\')}", 0, False
`;
}

export function register({ execCommand, servicePath }) {
  fs.mkdirSync(path.dirname(servicePath), { recursive: true });
  fs.writeFileSync(servicePath, buildVbsContent({ execCommand }), 'utf-8');
  start({ servicePath });
}

export function unregister({ servicePath, binName }) {
  stop({ binName });
  if (fs.existsSync(servicePath)) fs.unlinkSync(servicePath);
}

export function isRegistered({ servicePath }) {
  return fs.existsSync(servicePath);
}

export function stop({ binName }) {
  if (!binName) return;
  try { execSync(`taskkill /IM "${binName}" /F`); } catch {}
}

export function start({ servicePath }) {
  // Runs the Startup script immediately instead of waiting for the next
  // login, detached so it doesn't keep this process alive.
  spawn('wscript', [servicePath], { detached: true, stdio: 'ignore' }).unref();
}

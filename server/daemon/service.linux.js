import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

/**
 * Pure so it can be unit-tested without touching systemd.
 * `execCommand` is the full, already-quoted command line for `ExecStart=`:
 * either `"<installed-binary>" --serve` (production self-install) or
 * `"<node>" "<repo>/server/serve.js"` (dev, via scripts/setup-daemon.js).
 */
export function buildUnitContent({ execCommand }) {
  return `[Unit]
Description=DB Manager Pro Companion Daemon for Beekeeper Studio
After=network.target

[Service]
Type=simple
ExecStart=${execCommand}
Restart=on-failure
RestartSec=5s
Environment=BKS_DB_MANAGER_PORT=58765
Environment=NODE_ENV=production

[Install]
WantedBy=default.target
`;
}

export function register({ execCommand, servicePath }) {
  fs.mkdirSync(path.dirname(servicePath), { recursive: true });
  fs.writeFileSync(servicePath, buildUnitContent({ execCommand }), 'utf-8');
  execSync('systemctl --user daemon-reload');
  execSync('systemctl --user enable --now bks-db-manager.service');
}

export function unregister({ servicePath }) {
  try { execSync('systemctl --user stop bks-db-manager.service 2>/dev/null || true'); } catch {}
  try { execSync('systemctl --user disable bks-db-manager.service 2>/dev/null || true'); } catch {}
  if (fs.existsSync(servicePath)) fs.unlinkSync(servicePath);
  try { execSync('systemctl --user daemon-reload 2>/dev/null || true'); } catch {}
}

export function isRegistered({ servicePath }) {
  return fs.existsSync(servicePath);
}

export function stop() {
  try { execSync('systemctl --user stop bks-db-manager.service 2>/dev/null || true'); } catch {}
}

export function start() {
  execSync('systemctl --user start bks-db-manager.service');
}

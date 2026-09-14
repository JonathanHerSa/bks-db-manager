// Entry point bundled into the SEA companion binary (see
// scripts/build-companion.mjs). Dispatches subcommands; running the binary
// with NO arguments (a double-click) triggers the self-install/self-heal
// flow in runDoubleClickFlow() below, which is the whole point of shipping
// this as a binary instead of an npm script — no terminal required.
import os from 'os';
import { startServer, COMPANION_VERSION } from './index.js';
import { selfInstall, selfUninstall, getInstallInfo } from './daemon/selfInstall.js';
import { getServiceModule } from './daemon/service.js';
import { checkDaemonStatus, waitForDaemon } from './daemon/statusCheck.js';
import { notifyUser } from './daemon/notify.js';

// Empirically verified on Linux (see the build-companion.mjs verification
// run): a SEA binary's process.argv is shaped exactly like a normal
// `node script.js ...args` invocation — [execPath, "however it was
// invoked on the command line", ...realArgs] — even though there's no
// actual script file. `process.argv[1]` is NOT reliably equal to
// process.execPath (it preserves the relative/absolute form the user typed,
// e.g. "./companion" vs the resolved absolute execPath), so comparing
// against it is wrong; slicing by position is correct and matches Node's
// own convention.
function getArgs() {
  return process.argv.slice(2);
}

function printHelp() {
  console.log(`DB Manager Pro Companion v${COMPANION_VERSION}

Usage:
  bks-db-manager-companion            Install (first run) or verify the background service, then exit.
  bks-db-manager-companion --serve    Run the daemon in the foreground (used internally by the service).
  bks-db-manager-companion --install  (Re)install and start the background service.
  bks-db-manager-companion --uninstall  Stop and remove the background service.
  bks-db-manager-companion --status   Show install status, daemon status and detected DB tools.
  bks-db-manager-companion --version  Print the version.
  bks-db-manager-companion --help     Show this help.
`);
}

async function printStatus() {
  const info = getInstallInfo();
  console.log(`Platform: ${info.platform}`);
  console.log(`Installed binary: ${info.binExists ? info.paths.binPath : '(not installed)'}`);
  console.log(`Service registered: ${info.registered ? 'yes' : 'no'}`);
  console.log(`Installed version: ${info.installedVersion || '(unknown)'}`);

  const status = await checkDaemonStatus();
  if (status?.ok) {
    console.log(`Daemon: ACTIVE on http://127.0.0.1:58765 (v${status.version})`);
    const missing = Object.entries(status.tools || {}).filter(([, ok]) => !ok).map(([name]) => name);
    if (missing.length) {
      console.log(`Missing DB tools (features needing them won't work): ${missing.join(', ')}`);
    }
  } else {
    console.log('Daemon: NOT RESPONDING on http://127.0.0.1:58765');
  }
}

async function runInstall() {
  const result = await selfInstall({ execPath: process.execPath, version: COMPANION_VERSION });
  if (result.success) {
    console.log(`✔ Companion installed and running (v${COMPANION_VERSION}).`);
    notifyUser('DB Manager Companion', `Installed and running (v${COMPANION_VERSION}). You can close this window.`);
  } else {
    console.error(`✘ Install failed: ${result.error || 'the daemon did not respond after starting the service.'}`);
  }
  return result.success;
}

function runUninstall() {
  const result = selfUninstall();
  if (result.success) {
    console.log('✔ Companion service removed.');
  } else {
    console.error(`✘ Uninstall failed: ${result.error}`);
  }
  return result.success;
}

/** Double-click flow: install if missing/outdated, heal if installed-but-down,
 * confirm if already fine. Never leaves a foreground `listen()` running —
 * the daemon only ever runs inside the background service, started with
 * `--serve`. */
async function runDoubleClickFlow() {
  const info = getInstallInfo();
  const upToDate = info.binExists && info.registered && info.installedVersion === COMPANION_VERSION;

  if (upToDate) {
    const status = await checkDaemonStatus();
    if (status?.ok) {
      console.log(`DB Manager Companion is already installed and running (v${COMPANION_VERSION}).`);
      notifyUser('DB Manager Companion', 'Already installed and running. You can close this window.');
      return true;
    }
    console.log('Installed but not responding — starting it...');
    const svc = getServiceModule(info.platform);
    svc?.start(info.paths);
    const started = await waitForDaemon();
    if (started?.ok) {
      console.log('✔ Started.');
      notifyUser('DB Manager Companion', 'Started. You can close this window.');
      return true;
    }
    console.log('Could not start the existing install — reinstalling...');
  }

  return runInstall();
}

export async function main() {
  const args = getArgs();
  const command = args[0];

  let ok = true;
  if (!command) {
    ok = await runDoubleClickFlow();
  } else if (command === '--serve' || command === 'serve') {
    await startServer();
    return; // keep the process alive
  } else if (command === '--install' || command === 'install') {
    ok = await runInstall();
  } else if (command === '--uninstall' || command === 'uninstall') {
    ok = runUninstall();
  } else if (command === '--status' || command === 'status') {
    await printStatus();
  } else if (command === '--version' || command === '-v') {
    console.log(COMPANION_VERSION);
  } else if (command === '--help' || command === '-h') {
    printHelp();
  } else {
    console.error(`Unknown command: ${command}`);
    printHelp();
    ok = false;
  }

  // Windows: a double-clicked console app closes its window instantly on
  // exit, before the user can read the output. Give them a moment (or let
  // them dismiss it early with Enter) only for the no-args double-click path.
  if (!command && os.platform() === 'win32') {
    await new Promise((resolve) => {
      console.log('\nThis window will close automatically in a few seconds (press Enter to close now)...');
      const timer = setTimeout(resolve, 8000);
      process.stdin.once('data', () => { clearTimeout(timer); resolve(); });
      process.stdin.resume();
    });
  }

  process.exit(ok ? 0 : 1);
}


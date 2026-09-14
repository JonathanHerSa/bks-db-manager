// Dev-mode counterpart to selfInstall.js: registers the same background
// service, but pointing at the live cloned repo via the system `node`
// binary + server/serve.js, instead of copying a self-contained SEA binary
// anywhere. Used by scripts/setup-daemon.js (npm run daemon:install, and the
// `postinstall` hook) — never by the production companion binary.
import os from 'os';
import { getPaths } from './paths.js';
import { getServiceModule } from './service.js';
import { waitForDaemon } from './statusCheck.js';

export async function devInstall({ nodeBin, serverScript }) {
  const platform = os.platform();
  const svc = getServiceModule(platform);
  if (!svc) return { success: false, error: `Unsupported platform: ${platform}` };

  const paths = getPaths(platform);

  // Stop any previously running instance first: on all 3 platforms,
  // re-registering an already-active service does NOT make it pick up a
  // changed ExecStart/ProgramArguments on its own (systemd's `enable --now`,
  // launchd's `bootstrap`/`load -w`, and the Windows Startup script are all
  // no-ops on an already-running instance) — it would keep running the code
  // it already loaded into memory. Explicitly stopping first guarantees
  // `register()`'s own start-up actually launches the new command line.
  if (svc.isRegistered(paths)) {
    svc.stop(paths);
  }

  svc.register({
    ...paths,
    execCommand: `"${nodeBin}" "${serverScript}"`,
    programArguments: [nodeBin, serverScript],
  });

  const status = await waitForDaemon();
  return { success: Boolean(status?.ok), status, paths };
}

export function devUninstall() {
  const platform = os.platform();
  const svc = getServiceModule(platform);
  if (!svc) return { success: false, error: `Unsupported platform: ${platform}` };

  svc.unregister(getPaths(platform));
  return { success: true };
}

#!/usr/bin/env node
// Thin dev-mode shim: registers the companion as a background service
// pointing at this cloned repo's `node server/serve.js`, via the same
// daemon/service.* modules the production SEA binary uses (see
// server/daemon/devInstall.js and server/companion-entry.js). Kept for
// `npm run daemon:install/uninstall/status` and the `postinstall` hook —
// someone who clones the repo and runs `npm install` still gets the
// exact same autostart behavior as before, just implemented once instead
// of twice.
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import { devInstall, devUninstall } from '../server/daemon/devInstall.js';
import { checkDaemonStatus } from '../server/daemon/statusCheck.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const serverScript = path.join(projectRoot, 'server', 'serve.js');
const nodeBin = process.execPath;
const platform = os.platform();

const action = process.argv[2] || 'install';

function log(msg) {
  console.log(`[bks-daemon] ${msg}`);
}

async function checkStatus() {
  log(`Sistema Operativo detectado: ${platform}`);
  log(`Ruta del proyecto: ${projectRoot}`);
  log(`Ruta de Node.js: ${nodeBin}`);

  const status = await checkDaemonStatus();
  if (status?.ok) {
    log('✔ El daemon companion está ACTIVO y respondiendo en http://127.0.0.1:58765');
  } else {
    log('⚪ El daemon companion NO está respondiendo actualmente en http://127.0.0.1:58765');
  }
}

// NOTE: this runs automatically as an npm "postinstall" hook (see
// package.json) so that autostart is configured with zero extra commands
// for every person who installs the plugin by cloning the repo (`npm
// install` is already unavoidable per the README's setup steps). It must
// therefore NEVER throw or exit non-zero — doing so would make `npm
// install` itself fail for every user/contributor.
const isPostinstall = process.env.npm_lifecycle_event === 'postinstall';
const isCI = Boolean(process.env.CI);

try {
  switch (action) {
    case 'install':
    case 'setup': {
      if (isPostinstall && isCI) {
        log('Entorno de CI detectado - se omite el autoarranque del daemon (no aplica en pipelines).');
        break;
      }
      log(`Configurando servicio de inicio automático (modo desarrollo) para: ${platform}...`);
      const result = await devInstall({ nodeBin, serverScript });
      if (result.success) {
        log('✔ Servicio habilitado e iniciado automáticamente.');
      } else {
        log(`Aviso: no se pudo habilitar el servicio automáticamente (${result.error || 'el daemon no respondió tras arrancar'}).`);
      }
      await checkStatus();
      break;
    }

    case 'uninstall':
    case 'remove': {
      log(`Desinstalando servicio de inicio automático para: ${platform}...`);
      const result = devUninstall();
      if (result.success) {
        log('✔ Servicio desinstalado.');
      } else {
        log(`Aviso: ${result.error}`);
      }
      break;
    }

    case 'status':
      await checkStatus();
      break;

    default:
      console.log('Uso: node scripts/setup-daemon.js [install|uninstall|status]');
      if (!isPostinstall) process.exit(1);
  }
} catch (err) {
  log(`Aviso: no se pudo configurar el autoarranque automáticamente (${err.message}). Puedes intentarlo manualmente con: npm run daemon:install`);
  if (!isPostinstall) process.exit(1);
}

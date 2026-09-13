#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const serverScript = path.join(projectRoot, 'server', 'index.js');
const nodeBin = process.execPath;
const platform = os.platform(); // 'linux', 'darwin', 'win32'
const homeDir = os.homedir();

const action = process.argv[2] || 'install';

function log(msg) {
  console.log(`[bks-daemon] ${msg}`);
}

function installLinux() {
  const serviceDir = path.join(homeDir, '.config', 'systemd', 'user');
  fs.mkdirSync(serviceDir, { recursive: true });
  const servicePath = path.join(serviceDir, 'bks-db-manager.service');

  const unitContent = `[Unit]
Description=DB Manager Pro Companion Daemon for Beekeeper Studio
After=network.target

[Service]
Type=simple
WorkingDirectory=${projectRoot}
ExecStart="${nodeBin}" "${serverScript}"
Restart=on-failure
RestartSec=5s
Environment=BKS_DB_MANAGER_PORT=58765
Environment=NODE_ENV=production

[Install]
WantedBy=default.target
`;

  fs.writeFileSync(servicePath, unitContent, 'utf-8');
  log(`Archivo de servicio systemd creado en: ${servicePath}`);

  try {
    execSync('systemctl --user daemon-reload');
    execSync('systemctl --user enable --now bks-db-manager.service');
    log('✔ Servicio habilitado e iniciado automáticamente con systemd --user.');
  } catch (err) {
    log(`Aviso: No se pudo habilitar systemctl automáticamente: ${err.message}`);
  }
}

function uninstallLinux() {
  const servicePath = path.join(homeDir, '.config', 'systemd', 'user', 'bks-db-manager.service');
  try {
    execSync('systemctl --user stop bks-db-manager.service 2>/dev/null || true');
    execSync('systemctl --user disable bks-db-manager.service 2>/dev/null || true');
  } catch (_) {}
  if (fs.existsSync(servicePath)) {
    fs.unlinkSync(servicePath);
    log(`Servicio eliminado de: ${servicePath}`);
  }
  try {
    execSync('systemctl --user daemon-reload 2>/dev/null || true');
  } catch (_) {}
  log('✔ Servicio desinstalado de systemd.');
}

function installMac() {
  const launchDir = path.join(homeDir, 'Library', 'LaunchAgents');
  fs.mkdirSync(launchDir, { recursive: true });
  const plistPath = path.join(launchDir, 'com.t3zcadev.bks-db-manager.plist');

  const plistContent = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.t3zcadev.bks-db-manager</string>
    <key>ProgramArguments</key>
    <array>
        <string>${nodeBin}</string>
        <string>${serverScript}</string>
    </array>
    <key>WorkingDirectory</key>
    <string>${projectRoot}</string>
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
    <string>/tmp/bks-db-manager.out.log</string>
    <key>StandardErrorPath</key>
    <string>/tmp/bks-db-manager.err.log</string>
</dict>
</plist>
`;

  fs.writeFileSync(plistPath, plistContent, 'utf-8');
  log(`Archivo LaunchAgent creado en: ${plistPath}`);

  try {
    execSync(`launchctl load -w "${plistPath}"`);
    log('✔ LaunchAgent cargado e iniciado automáticamente.');
  } catch (err) {
    log(`Aviso al cargar launchctl: ${err.message}`);
  }
}

function uninstallMac() {
  const plistPath = path.join(homeDir, 'Library', 'LaunchAgents', 'com.t3zcadev.bks-db-manager.plist');
  if (fs.existsSync(plistPath)) {
    try {
      execSync(`launchctl unload -w "${plistPath}" 2>/dev/null || true`);
    } catch (_) {}
    fs.unlinkSync(plistPath);
    log(`LaunchAgent eliminado de: ${plistPath}`);
  }
  log('✔ Servicio desinstalado de macOS LaunchAgents.');
}

function installWindows() {
  const startupDir = path.join(
    process.env.APPDATA || path.join(homeDir, 'AppData', 'Roaming'),
    'Microsoft',
    'Windows',
    'Start Menu',
    'Programs',
    'Startup'
  );
  fs.mkdirSync(startupDir, { recursive: true });
  const vbsPath = path.join(startupDir, 'bks-db-manager.vbs');

  const vbsContent = `Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = "${projectRoot.replace(/\\/g, '\\\\')}"
WshShell.Run """${nodeBin.replace(/\\/g, '\\\\')}"" ""${serverScript.replace(/\\/g, '\\\\')}""", 0, False
`;

  fs.writeFileSync(vbsPath, vbsContent, 'utf-8');
  log(`Acceso de inicio automático creado en: ${vbsPath}`);
  log('✔ El servicio se iniciará automáticamente en segundo plano al iniciar sesión en Windows.');

  try {
    execSync(`wscript "${vbsPath}"`);
    log('✔ Servicio iniciado en segundo plano.');
  } catch (_) {}
}

function uninstallWindows() {
  const vbsPath = path.join(
    process.env.APPDATA || path.join(homeDir, 'AppData', 'Roaming'),
    'Microsoft',
    'Windows',
    'Start Menu',
    'Programs',
    'Startup',
    'bks-db-manager.vbs'
  );
  if (fs.existsSync(vbsPath)) {
    fs.unlinkSync(vbsPath);
    log(`Acceso de inicio eliminado de: ${vbsPath}`);
  }
  log('✔ Servicio de inicio desinstalado en Windows.');
}

function checkStatus() {
  log(`Sistema Operativo detectado: ${platform}`);
  log(`Ruta del proyecto: ${projectRoot}`);
  log(`Ruta de Node.js: ${nodeBin}`);

  try {
    const res = execSync('curl -s -m 2 http://127.0.0.1:58765/api/status', { encoding: 'utf-8' });
    const data = JSON.parse(res);
    if (data.ok) {
      log('✔ El daemon companion está ACTIVO y respondiendo en http://127.0.0.1:58765');
      return;
    }
  } catch (_) {}

  log('⚪ El daemon companion NO está respondiendo actualmente en http://127.0.0.1:58765');
}

switch (action) {
  case 'install':
  case 'setup':
    log(`Configurando servicio de inicio automático para: ${platform}...`);
    if (platform === 'linux') installLinux();
    else if (platform === 'darwin') installMac();
    else if (platform === 'win32') installWindows();
    else log(`Plataforma no soportada directamente: ${platform}`);
    checkStatus();
    break;

  case 'uninstall':
  case 'remove':
    log(`Desinstalando servicio de inicio automático para: ${platform}...`);
    if (platform === 'linux') uninstallLinux();
    else if (platform === 'darwin') uninstallMac();
    else if (platform === 'win32') uninstallWindows();
    break;

  case 'status':
    checkStatus();
    break;

  default:
    console.log('Uso: node scripts/setup-daemon.js [install|uninstall|status]');
    process.exit(1);
}

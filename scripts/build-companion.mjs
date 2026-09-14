#!/usr/bin/env node
// Builds the companion daemon into a single, self-contained native
// executable for the current platform (Node "Single Executable
// Applications" — no Node.js install required by the end user).
//
// server/index.js and server/engines/*.js have zero native (N-API/node-gyp)
// dependencies — only `express`, `cors` and Node built-ins — so SEA is a
// clean fit with no cross-compilation of native addons to worry about.
// SEA does NOT cross-compile between platforms on its own: this script must
// run once per target OS (see .github/workflows/release.yml's build matrix).
//
// Requires Node >=25.5 on the machine running this script (for the
// one-step `--build-sea` flag); the runtime embedded in the resulting
// binary is whatever Node this script itself ran under.
import { execFileSync } from 'child_process';
import { createHash } from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import * as esbuild from 'esbuild';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const buildDir = path.join(projectRoot, 'build');

const pkg = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf-8'));
const version = pkg.version;

const platform = os.platform();
const isWindows = platform === 'win32';
const outName = isWindows ? 'companion.exe' : 'companion';
const bundlePath = path.join(buildDir, 'companion.cjs');
const seaConfigPath = path.join(buildDir, 'sea-config.json');
const outputPath = path.join(buildDir, outName);

fs.rmSync(buildDir, { recursive: true, force: true });
fs.mkdirSync(buildDir, { recursive: true });

console.log(`Bundling server/companion-bin.js (version ${version}) with esbuild...`);
await esbuild.build({
  entryPoints: [path.join(projectRoot, 'server', 'companion-bin.js')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node24',
  outfile: bundlePath,
  define: { __COMPANION_VERSION__: JSON.stringify(version) },
});

// NOTE (verified empirically on Linux/Node 26.1.0, see git history for the
// build log): `output` in the SEA config is the FINAL, directly-runnable
// executable path — `--build-sea` already includes copying the Node binary
// and injecting the bundle, it is not an intermediate blob that needs a
// separate `postject` injection step.
fs.writeFileSync(seaConfigPath, JSON.stringify({
  main: bundlePath,
  output: outputPath,
  mainFormat: 'commonjs',
  disableExperimentalSEAWarning: true,
  useSnapshot: false,
  // Confirmed via a real GitHub Actions run: with useCodeCache:true, the
  // macos-15-intel build segfaulted on its very first invocation
  // (`--version`), even with an otherwise-correct native build (no
  // cross-compilation, no code signing). The embedded V8 code cache is
  // apparently sensitive to specifics of that runner's CPU that this
  // project doesn't need to chase down — this is a background daemon
  // invoked rarely, not a hot CLI, so the small startup-time cost of
  // skipping the cache is a trivial trade for correctness everywhere.
  useCodeCache: false,
}, null, 2), 'utf-8');

console.log('Building the single executable application (node --build-sea)...');
execFileSync(process.execPath, [`--build-sea=${seaConfigPath}`], {
  cwd: buildDir,
  stdio: 'inherit',
});

if (!fs.existsSync(outputPath)) {
  throw new Error(`node --build-sea did not produce ${outputPath}`);
}
if (!isWindows) fs.chmodSync(outputPath, 0o755);

// NOTE: confirmed by a real macos-15-intel CI run — ad-hoc signing an x64
// SEA binary corrupts it (segfaults on the very first invocation), so this
// must be gated on arch, not just platform. Apple Silicon refuses to run
// ANY unsigned executable at all (even ad-hoc-signed ones satisfy it),
// while Intel Mac runs unsigned binaries fine and re-signing after
// `--build-sea`'s blob injection is actively harmful there.
if (platform === 'darwin' && os.arch() === 'arm64') {
  console.log('Applying ad-hoc code signature (required on Apple Silicon)...');
  execFileSync('codesign', ['--force', '--sign', '-', outputPath]);
}

const sha256 = createHash('sha256').update(fs.readFileSync(outputPath)).digest('hex');
fs.writeFileSync(`${outputPath}.sha256`, `${sha256}  ${outName}\n`, 'utf-8');

console.log(`\n✔ Built ${outputPath}`);
console.log(`  sha256: ${sha256}`);

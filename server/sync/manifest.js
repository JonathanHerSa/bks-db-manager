import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { getPaths } from '../daemon/paths.js';

/**
 * Per (source -> destination) sync manifest.
 *
 * The manifest is the only state the incremental clone needs: for every table
 * it remembers the fingerprint observed the last time the table was copied
 * successfully. On the next run the planner compares the current fingerprint
 * against it and copies only what changed.
 *
 * It intentionally lives outside the plugin/repo (in the companion data dir)
 * so it survives plugin updates and never ends up in a git diff. No
 * credentials are stored here — only table names, checksums, row counts and
 * the source server identity.
 */
export const MANIFEST_VERSION = 1;

export function getSyncDir() {
  if (process.env.BKS_SYNC_DIR) return process.env.BKS_SYNC_DIR;
  return path.join(getPaths().dataDir, 'sync');
}

export function manifestKey({ srcHost, srcPort, srcDb, dstHost, dstPort, dstDb }) {
  const raw = [srcHost, srcPort, srcDb, dstHost, dstPort, dstDb]
    .map((value) => String(value ?? ''))
    .join('|');
  return crypto.createHash('sha256').update(raw).digest('hex').slice(0, 40);
}

export function manifestPath(key) {
  return path.join(getSyncDir(), `${key}.json`);
}

export function loadManifest(key) {
  try {
    const file = manifestPath(key);
    if (!fs.existsSync(file)) return null;
    const parsed = JSON.parse(fs.readFileSync(file, 'utf-8'));
    if (!parsed || parsed.version !== MANIFEST_VERSION) return null;
    return parsed;
  } catch {
    // A corrupt/truncated manifest must never break a clone: treating it as
    // "no manifest" simply downgrades the next run to a full copy.
    return null;
  }
}

export function saveManifest(key, manifest) {
  const dir = getSyncDir();
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = manifestPath(key);
  const tmp = `${file}.${process.pid}.tmp`;
  const payload = {
    ...manifest,
    version: MANIFEST_VERSION,
    key,
    updatedAt: new Date().toISOString()
  };
  // Atomic write: a crash mid-save leaves the previous manifest intact
  // instead of a half-written JSON file that would force a full copy.
  fs.writeFileSync(tmp, JSON.stringify(payload, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, file);
  return payload;
}

export function deleteManifest(key) {
  try {
    fs.unlinkSync(manifestPath(key));
    return true;
  } catch {
    return false;
  }
}

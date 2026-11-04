import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  MANIFEST_VERSION,
  deleteManifest,
  loadManifest,
  manifestKey,
  saveManifest
} from './manifest.js';

const BASE_DIR = '/tmp/opencode';
let dir;

beforeEach(() => {
  fs.mkdirSync(BASE_DIR, { recursive: true });
  dir = fs.mkdtempSync(path.join(BASE_DIR, 'bks-sync-'));
  process.env.BKS_SYNC_DIR = dir;
});

afterEach(() => {
  delete process.env.BKS_SYNC_DIR;
  fs.rmSync(dir, { recursive: true, force: true });
});

const pair = {
  srcHost: '127.0.0.1',
  srcPort: 3307,
  srcDb: 'finanzas',
  dstHost: '127.0.0.1',
  dstPort: 3308,
  dstDb: 'finanzas'
};

describe('sync manifest', () => {
  test('manifestKey is stable and changes with the destination database', () => {
    const a = manifestKey(pair);
    const b = manifestKey({ ...pair });
    const c = manifestKey({ ...pair, dstDb: 'finanzas_dev' });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toMatch(/^[a-f0-9]{40}$/);
  });

  test('round-trips a manifest through disk', () => {
    const key = manifestKey(pair);
    saveManifest(key, {
      source: { host: pair.srcHost, port: pair.srcPort, db: pair.srcDb, serverUuid: 'uuid-1', version: '8.0.26' },
      dest: { host: pair.dstHost, port: pair.dstPort, db: pair.dstDb },
      tables: { users: { checksum: '123', rows: 10, mode: 'full' } }
    });

    const loaded = loadManifest(key);
    expect(loaded.version).toBe(MANIFEST_VERSION);
    expect(loaded.source.serverUuid).toBe('uuid-1');
    expect(loaded.tables.users.checksum).toBe('123');
    expect(loaded.updatedAt).toBeTruthy();
  });

  test('a corrupt manifest is treated as missing instead of breaking the clone', () => {
    const key = manifestKey(pair);
    fs.writeFileSync(path.join(dir, `${key}.json`), '{not-json');
    expect(loadManifest(key)).toBeNull();
  });

  test('deleteManifest removes the file', () => {
    const key = manifestKey(pair);
    saveManifest(key, { tables: {} });
    expect(loadManifest(key)).not.toBeNull();
    expect(deleteManifest(key)).toBe(true);
    expect(loadManifest(key)).toBeNull();
    expect(deleteManifest(key)).toBe(false);
  });
});

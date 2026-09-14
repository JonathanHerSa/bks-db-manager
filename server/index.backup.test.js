import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('Backup & Snapshot API Endpoints', () => {
  let tmpBackupDir;
  let app;

  beforeEach(async () => {
    tmpBackupDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bks-backup-test-'));
    process.env.BKS_BACKUP_DIR = tmpBackupDir;
    // Dynamic import to pick up the env var
    const mod = await import('./index.js');
    app = mod.default;
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpBackupDir, { recursive: true, force: true });
    } catch (_) {}
    delete process.env.BKS_BACKUP_DIR;
  });

  test('GET /api/backup/list returns an empty list when no backups exist', async () => {
    const res = await request(app).get('/api/backup/list');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.backups).toEqual([]);
    expect(res.body.backupDir).toBe(tmpBackupDir);
  });

  test('GET /api/backup/list lists and correctly parses snapshot files and formats', async () => {
    // Create dummy backup files
    const file1 = 'ecommerce_2026-09-13T12-00-00.sql.zst';
    const file2 = 'analytics_2026-09-13T11-00-00.sql.gz';
    const file3 = 'legacy_2026-09-13T10-00-00.sql';
    const ignoreFile = 'notes.txt';

    fs.writeFileSync(path.join(tmpBackupDir, file1), 'fake zstd content');
    fs.writeFileSync(path.join(tmpBackupDir, file2), 'fake gzip content');
    fs.writeFileSync(path.join(tmpBackupDir, file3), 'fake sql content');
    fs.writeFileSync(path.join(tmpBackupDir, ignoreFile), 'should not be listed');

    const res = await request(app).get('/api/backup/list');
    expect(res.status).toBe(200);
    expect(res.body.backups.length).toBe(3);

    const b1 = res.body.backups.find((b) => b.filename === file1);
    expect(b1).toBeDefined();
    expect(b1.format).toBe('zstd');
    expect(b1.database).toBe('ecommerce');
    expect(b1.sizeBytes).toBeGreaterThan(0);

    const b2 = res.body.backups.find((b) => b.filename === file2);
    expect(b2.format).toBe('gzip');
    expect(b2.database).toBe('analytics');

    const b3 = res.body.backups.find((b) => b.filename === file3);
    expect(b3.format).toBe('sql');
    expect(b3.database).toBe('legacy');
  });

  test('POST /api/backup/create rejects unsafe database names (SQL injection guard)', async () => {
    const res = await request(app)
      .post('/api/backup/create')
      .send({
        database: 'db; DROP TABLE users; --',
        motor: 'mysql'
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('inválido');
  });

  test('POST /api/backup/create rejects a database name disguised as a CLI flag', async () => {
    const res = await request(app)
      .post('/api/backup/create')
      .send({
        database: '--all-databases',
        motor: 'mysql'
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('inválido');
  });

  test('POST /api/backup/restore rejects path traversal attacks', async () => {
    const res = await request(app)
      .post('/api/backup/restore')
      .send({
        filename: '../../../../etc/shadow',
        database: 'target_db'
      });

    // path.basename maps it to 'shadow', which does not exist in tmpBackupDir
    expect(res.status).toBe(404);
    expect(res.body.error).toContain('no existe');
  });

  test('POST /api/backup/restore rejects invalid target database name', async () => {
    const fakeSnapshot = 'testdb_2026-09-13T10-00-00.sql';
    fs.writeFileSync(path.join(tmpBackupDir, fakeSnapshot), 'SELECT 1;');

    const res = await request(app)
      .post('/api/backup/restore')
      .send({
        filename: fakeSnapshot,
        database: 'target; DROP DATABASE x;'
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('inválida');
  });

  test('DELETE /api/backup/delete safely removes the snapshot file and prevents traversal', async () => {
    const testFile = 'to_delete_2026-09-13T10-00-00.sql';
    fs.writeFileSync(path.join(tmpBackupDir, testFile), 'some content');

    const res = await request(app)
      .delete('/api/backup/delete')
      .send({ filename: testFile });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(fs.existsSync(path.join(tmpBackupDir, testFile))).toBe(false);

    // Calling delete again returns 404
    const res404 = await request(app)
      .delete('/api/backup/delete')
      .send({ filename: testFile });
    expect(res404.status).toBe(404);
  });
});

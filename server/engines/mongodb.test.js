import { describe, test, expect, vi, beforeEach } from 'vitest';

vi.mock('child_process', async () => {
  const { promisify } = await import('node:util');

  const execFile = vi.fn((file, args, options, callback) => {
    callback(new Error(`execFile not mocked for: ${file}`));
  });
  execFile[promisify.custom] = (file, args, options) => new Promise((resolve, reject) => {
    execFile(file, args, options, (err, stdout, stderr) => {
      if (err) { err.stdout = stdout; err.stderr = stderr; reject(err); }
      else resolve({ stdout: stdout || '', stderr: stderr || '' });
    });
  });

  const spawn = vi.fn(() => ({ mocked: true }));

  return { exec: vi.fn(), execFile, spawn, default: { execFile, spawn } };
});

const { execFile, spawn } = await import('child_process');
const mongodb = (await import('./mongodb.js')).default;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('mongodb.listDatabases', () => {
  test('runs mongosh with a URI (single argv element) and filters system databases', async () => {
    execFile.mockImplementation((file, args, options, callback) => callback(null, 'app_db\nadmin\nlocal\n', ''));
    const result = await mongodb.listDatabases({ host: 'h', port: 27017, user: 'root', pass: 'x' });
    expect(result).toEqual(['app_db']);
    const [bin, args] = execFile.mock.calls[0];
    expect(bin).toBe('mongosh');
    expect(args[0]).toContain('mongodb://');
    expect(args).toContain('--quiet');
  });

  test('percent-encodes special characters in user/password inside the URI', async () => {
    execFile.mockImplementation((file, args, options, callback) => callback(null, '', ''));
    await mongodb.listDatabases({ host: 'h', port: 27017, user: 'us@er', pass: 'p:a/ss' });
    const [, args] = execFile.mock.calls[0];
    const uri = args[0];
    expect(uri).toContain(encodeURIComponent('us@er'));
    expect(uri).toContain(encodeURIComponent('p:a/ss'));
    // the raw unencoded special characters must not leak into the URI's auth section
    expect(uri.split('@').length).toBe(2); // exactly one unescaped '@' - the auth/host separator
  });
});

describe('mongodb.listTables', () => {
  test('lists collection names, one per line', async () => {
    execFile.mockImplementation((file, args, options, callback) => callback(null, 'users\norders\n', ''));
    const result = await mongodb.listTables({ host: 'h', port: 27017, user: 'root', pass: 'x', database: 'app_db' });
    expect(result).toEqual(['users', 'orders']);
    const [, args] = execFile.mock.calls[0];
    expect(args[0]).toContain(encodeURIComponent('app_db') === 'app_db' ? '/app_db' : encodeURIComponent('app_db'));
  });
});

describe('mongodb.getDatabaseInfo', () => {
  test('parses "mb tables" from the eval output', async () => {
    execFile.mockImplementation((file, args, options, callback) => callback(null, '5.5 3\n', ''));
    const result = await mongodb.getDatabaseInfo({ host: 'h', port: 27017, user: 'root', pass: 'x', database: 'app_db' });
    expect(result).toEqual({ mb: 5.5, tables: 3 });
  });
});

describe('mongodb.inspectSchema', () => {
  test('parses the tab-separated best-effort field inference output', async () => {
    execFile.mockImplementation((file, args, options, callback) =>
      callback(null, 'users\t_id\tobject\tYES\tNULL\nusers\temail\tstring\tYES\tNULL\n', ''));
    const result = await mongodb.inspectSchema({ host: 'h', port: 27017, user: 'root', pass: 'x', database: 'app_db' });
    expect(result).toEqual([
      { table: 'users', column: '_id', type: 'object', nullable: 'YES', defaultVal: null },
      { table: 'users', column: 'email', type: 'string', nullable: 'YES', defaultVal: null }
    ]);
  });
});

describe('mongodb.ensureDatabase', () => {
  test('is a no-op that resolves without shelling out (Mongo creates DBs implicitly)', async () => {
    await expect(mongodb.ensureDatabase({ host: 'h', port: 27017, user: 'root', pass: 'x', database: 'db' })).resolves.toBeUndefined();
    expect(execFile).not.toHaveBeenCalled();
  });
});

describe('mongodb.spawnDump / spawnRestore', () => {
  test('spawnDump invokes mongodump with --archive (stdout streaming) and --excludeCollection per excluded table', () => {
    mongodb.spawnDump({ host: 'h', port: 27017, user: 'root', pass: 'x', database: 'app_db', excludeTables: ['logs'] });
    const [bin, args] = spawn.mock.calls[0];
    expect(bin).toBe('mongodump');
    expect(args).toContain('--archive');
    expect(args).toContain('--excludeCollection=logs');
    expect(args.find((a) => typeof a === 'string' && a.startsWith('mongodb://'))).toBeTruthy();
  });

  test('spawnRestore invokes mongorestore with --archive (stdin streaming) and --drop', () => {
    mongodb.spawnRestore({ host: 'h', port: 27017, user: 'root', pass: 'y', database: 'dst_db' });
    const [bin, args] = spawn.mock.calls[0];
    expect(bin).toBe('mongorestore');
    expect(args).toContain('--archive');
    expect(args).toContain('--drop');
  });
});

describe('mongodb flags', () => {
  test('declares clone-stream support but a NON-textual (binary) dump format', () => {
    expect(mongodb.supportsCloneStream).toBe(true);
    expect(mongodb.textualDumpFormat).toBe(false);
  });
});

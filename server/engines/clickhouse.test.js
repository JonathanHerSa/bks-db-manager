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

  return { exec: vi.fn(), execFile, spawn: vi.fn(), default: { execFile } };
});

const { execFile } = await import('child_process');
const clickhouse = (await import('./clickhouse.js')).default;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('clickhouse.listDatabases', () => {
  test('runs clickhouse-client and filters out system databases', async () => {
    execFile.mockImplementation((file, args, options, callback) => callback(null, 'app_db\nsystem\ndefault\n', ''));
    const result = await clickhouse.listDatabases({ host: 'h', port: 9000, user: 'default', pass: 'x' });
    expect(result).toEqual(['app_db']);
    const [bin, args] = execFile.mock.calls[0];
    expect(bin).toBe('clickhouse-client');
    expect(args).toContain('--password');
    expect(args).toContain('x');
  });
});

describe('clickhouse.listTables', () => {
  test('scopes SHOW TABLES to the given database', async () => {
    execFile.mockImplementation((file, args, options, callback) => callback(null, 'users\norders\n', ''));
    const result = await clickhouse.listTables({ host: 'h', port: 9000, user: 'default', pass: 'x', database: 'app_db' });
    expect(result).toEqual(['users', 'orders']);
    const [, args] = execFile.mock.calls[0];
    expect(args).toContain('--database');
    expect(args).toContain('app_db');
  });
});

describe('clickhouse.getDatabaseInfo', () => {
  test('parses "mb tables" and escapes a malicious database name', async () => {
    execFile.mockImplementation((file, args, options, callback) => callback(null, '3.2 5\n', ''));
    const result = await clickhouse.getDatabaseInfo({ host: 'h', port: 9000, user: 'default', pass: 'x', database: "db' OR '1'='1" });
    expect(result).toEqual({ mb: 3.2, tables: 5 });
    const [, args] = execFile.mock.calls[0];
    const sqlArg = args[args.length - 1];
    expect(sqlArg).toContain("db'' OR ''1''=''1");
  });
});

describe('clickhouse.inspectSchema', () => {
  test('parses TSV-formatted column metadata', async () => {
    execFile.mockImplementation((file, args, options, callback) =>
      callback(null, 'users\tid\tUInt64\tYES\tNULL\nusers\temail\tString\tYES\tNULL\n', ''));
    const result = await clickhouse.inspectSchema({ host: 'h', port: 9000, user: 'default', pass: 'x', database: 'app_db' });
    expect(result).toEqual([
      { table: 'users', column: 'id', type: 'UInt64', nullable: 'YES', defaultVal: null },
      { table: 'users', column: 'email', type: 'String', nullable: 'YES', defaultVal: null }
    ]);
  });
});

describe('clickhouse flags', () => {
  test('does not support clone streaming', () => {
    expect(clickhouse.supportsCloneStream).toBe(false);
    expect(clickhouse.spawnDump).toBeUndefined();
  });
});

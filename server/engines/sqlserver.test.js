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
const sqlserver = (await import('./sqlserver.js')).default;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('sqlserver.listDatabases', () => {
  test('runs sqlcmd with host,port as -S and password via SQLCMDPASSWORD env, never argv', async () => {
    execFile.mockImplementation((file, args, options, callback) => callback(null, 'app_db\n', ''));
    const result = await sqlserver.listDatabases({ host: 'h', port: 1433, user: 'sa', pass: 'secret' });
    expect(result).toEqual(['app_db']);
    const [bin, args, options] = execFile.mock.calls[0];
    expect(bin).toBe('sqlcmd');
    expect(args).toContain('h,1433');
    expect(args).not.toContain('secret');
    expect(options.env.SQLCMDPASSWORD).toBe('secret');
  });
});

describe('sqlserver.listTables', () => {
  test('includes the database via -d and lists base tables', async () => {
    execFile.mockImplementation((file, args, options, callback) => callback(null, 'users\norders\n', ''));
    const result = await sqlserver.listTables({ host: 'h', port: 1433, user: 'sa', pass: 'x', database: 'app_db' });
    expect(result).toEqual(['users', 'orders']);
    const [, args] = execFile.mock.calls[0];
    expect(args).toContain('-d');
    expect(args).toContain('app_db');
  });
});

describe('sqlserver.getDatabaseInfo', () => {
  test('parses "mb tables" and escapes a malicious database name in the SQL text', async () => {
    execFile.mockImplementation((file, args, options, callback) => callback(null, '10.25 4\n', ''));
    const result = await sqlserver.getDatabaseInfo({ host: 'h', port: 1433, user: 'sa', pass: 'x', database: "db' OR '1'='1" });
    expect(result).toEqual({ mb: 10.25, tables: 4 });
    const [, args] = execFile.mock.calls[0];
    const sqlArg = args[args.length - 1];
    expect(sqlArg).toContain("db'' OR ''1''=''1");
  });
});

describe('sqlserver.inspectSchema', () => {
  test('parses the tab-separated concatenated column metadata', async () => {
    execFile.mockImplementation((file, args, options, callback) =>
      callback(null, 'users\tid\tint\tNO\tNULL\nusers\temail\tvarchar\tYES\tNULL\n', ''));
    const result = await sqlserver.inspectSchema({ host: 'h', port: 1433, user: 'sa', pass: 'x', database: 'app_db' });
    expect(result).toEqual([
      { table: 'users', column: 'id', type: 'int', nullable: 'NO', defaultVal: null },
      { table: 'users', column: 'email', type: 'varchar', nullable: 'YES', defaultVal: null }
    ]);
  });
});

describe('sqlserver flags', () => {
  test('does not support clone streaming and has no dump/restore methods', () => {
    expect(sqlserver.supportsCloneStream).toBe(false);
    expect(sqlserver.spawnDump).toBeUndefined();
    expect(sqlserver.spawnRestore).toBeUndefined();
    expect(sqlserver.ensureDatabase).toBeUndefined();
  });
});

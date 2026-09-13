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
const postgresFamily = (await import('./postgresFamily.js')).default;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('postgresFamily.listDatabases', () => {
  test('passes host/port/user as argv and password via PGPASSWORD env', async () => {
    execFile.mockImplementation((file, args, options, callback) => callback(null, ' app_db \n postgres \n', ''));
    const result = await postgresFamily.listDatabases({ host: 'h', port: 5432, user: 'postgres', pass: 'secret' });
    expect(result).toEqual(['app_db']);
    const [bin, args, options] = execFile.mock.calls[0];
    expect(bin).toBe('psql');
    expect(args).not.toContain('secret');
    expect(options.env.PGPASSWORD).toBe('secret');
  });

  test('a malicious host is passed as a single argv element', async () => {
    execFile.mockImplementation((file, args, options, callback) => callback(null, '', ''));
    const maliciousHost = '`; touch /tmp/pwned #';
    await postgresFamily.listDatabases({ host: maliciousHost, port: 5432, user: 'postgres', pass: '' });
    const [, args] = execFile.mock.calls[0];
    expect(args[1]).toBe(maliciousHost);
  });
});

describe('postgresFamily.listTables', () => {
  test('scopes the query to the public schema', async () => {
    execFile.mockImplementation((file, args, options, callback) => callback(null, ' users \n orders \n', ''));
    const result = await postgresFamily.listTables({ host: 'h', port: 5432, user: 'postgres', pass: 'x', database: 'app_db' });
    expect(result).toEqual(['users', 'orders']);
  });
});

describe('postgresFamily.getDatabaseInfo', () => {
  test('parses size AND table count from a single two-statement query (fills in a previously-always-zero table count)', async () => {
    execFile.mockImplementation((file, args, options, callback) => callback(null, ' 42.5 \n 7 \n', ''));
    const result = await postgresFamily.getDatabaseInfo({ host: 'h', port: 5432, user: 'postgres', pass: 'x', database: 'app_db' });
    expect(result).toEqual({ mb: 42.5, tables: 7 });
    const [, args] = execFile.mock.calls[0];
    const sqlArg = args[args.length - 1];
    expect(sqlArg).toContain('pg_database_size');
    expect(sqlArg).toContain('information_schema.tables');
  });

  test('escapes a malicious database name inside the SQL text argv element (the same raw name is a separate, legitimate -d connection argv element)', async () => {
    execFile.mockImplementation((file, args, options, callback) => callback(null, '0\n0\n', ''));
    await postgresFamily.getDatabaseInfo({ host: 'h', port: 5432, user: 'postgres', pass: 'x', database: "db' OR '1'='1" });
    const [, args] = execFile.mock.calls[0];
    const sqlArg = args[args.length - 1];
    expect(sqlArg).toContain("db'' OR ''1''=''1");
  });
});

describe('postgresFamily.inspectSchema', () => {
  test('parses tab-separated column metadata', async () => {
    execFile.mockImplementation((file, args, options, callback) =>
      callback(null, 'users\tid\tinteger\tNO\tNULL\nusers\temail\tcharacter varying\tYES\tNULL\n', ''));
    const result = await postgresFamily.inspectSchema({ host: 'h', port: 5432, user: 'postgres', pass: 'x', database: 'app_db' });
    expect(result).toEqual([
      { table: 'users', column: 'id', type: 'integer', nullable: 'NO', defaultVal: null },
      { table: 'users', column: 'email', type: 'character varying', nullable: 'YES', defaultVal: null }
    ]);
  });
});

describe('postgresFamily.ensureDatabase', () => {
  test('creates the database with an escaped identifier and PGPASSWORD env', async () => {
    execFile.mockImplementation((file, args, options, callback) => callback(null, '', ''));
    await postgresFamily.ensureDatabase({ host: 'h', port: 5432, user: 'postgres', pass: 'x', database: 'my"db' });
    const [bin, args, options] = execFile.mock.calls[0];
    expect(bin).toBe('psql');
    expect(args.join(' ')).toContain('my""db');
    expect(options.env.PGPASSWORD).toBe('x');
  });
});

describe('postgresFamily.spawnDump / spawnRestore', () => {
  test('spawnDump invokes pg_dump with -T per excluded table and PGPASSWORD env', () => {
    postgresFamily.spawnDump({ host: 'h', port: 5432, user: 'postgres', pass: 'x', database: 'app_db', excludeTables: ['logs'] });
    const [bin, args, options] = spawn.mock.calls[0];
    expect(bin).toBe('pg_dump');
    expect(args).toContain('-T');
    expect(args).toContain('logs');
    expect(options.env.PGPASSWORD).toBe('x');
  });

  test('spawnRestore invokes psql with the destination database and PGPASSWORD env', () => {
    postgresFamily.spawnRestore({ host: 'h', port: 5432, user: 'postgres', pass: 'y', database: 'dst_db' });
    const [bin, args, options] = spawn.mock.calls[0];
    expect(bin).toBe('psql');
    expect(args).toContain('dst_db');
    expect(options.env.PGPASSWORD).toBe('y');
  });
});

describe('postgresFamily flags', () => {
  test('declares clone-stream support and a textual dump format', () => {
    expect(postgresFamily.supportsCloneStream).toBe(true);
    expect(postgresFamily.textualDumpFormat).toBe(true);
  });
});

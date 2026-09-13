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
const mysqlFamily = (await import('./mysqlFamily.js')).default;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('mysqlFamily.listDatabases', () => {
  test('passes host/port/user as argv and password via MYSQL_PWD env, never in argv', async () => {
    execFile.mockImplementation((file, args, options, callback) => callback(null, 'app_db\ninformation_schema\n', ''));

    const result = await mysqlFamily.listDatabases({ host: 'h', port: 3306, user: 'root', pass: 'secret' });

    expect(result).toEqual(['app_db']);
    const [bin, args, options] = execFile.mock.calls[0];
    expect(bin).toBe('mysql');
    expect(Array.isArray(args)).toBe(true);
    expect(args).not.toContain('secret');
    expect(options.env.MYSQL_PWD).toBe('secret');
  });

  test('filters out system databases', async () => {
    execFile.mockImplementation((file, args, options, callback) =>
      callback(null, 'app_db\nmysql\nperformance_schema\nsys\ninformation_schema\n', ''));
    const result = await mysqlFamily.listDatabases({ host: 'h', port: 3306, user: 'root', pass: '' });
    expect(result).toEqual(['app_db']);
  });

  test('a malicious host is passed as a single argv element (no shell involved)', async () => {
    execFile.mockImplementation((file, args, options, callback) => callback(null, '', ''));
    const maliciousHost = '`; touch /tmp/pwned #';
    await mysqlFamily.listDatabases({ host: maliciousHost, port: 3306, user: 'root', pass: '' });
    const [, args] = execFile.mock.calls[0];
    expect(args[1]).toBe(maliciousHost);
  });
});

describe('mysqlFamily.listTables', () => {
  test('scopes the query to the given database and trims blank lines', async () => {
    execFile.mockImplementation((file, args, options, callback) => callback(null, 'users\n\norders\n', ''));
    const result = await mysqlFamily.listTables({ host: 'h', port: 3306, user: 'root', pass: 'x', database: 'app_db' });
    expect(result).toEqual(['users', 'orders']);
    const [, args] = execFile.mock.calls[0];
    expect(args).toContain('app_db');
  });
});

describe('mysqlFamily.getDatabaseInfo', () => {
  test('parses "mb tables" from stdout and escapes the database name in the SQL text', async () => {
    execFile.mockImplementation((file, args, options, callback) => callback(null, '12.5\t3\n', ''));
    const result = await mysqlFamily.getDatabaseInfo({ host: 'h', port: 3306, user: 'root', pass: 'x', database: "db' OR '1'='1" });
    expect(result).toEqual({ mb: 12.5, tables: 3 });
    const [, args] = execFile.mock.calls[0];
    const sqlArg = args[args.length - 1];
    expect(sqlArg).toContain("db'' OR ''1''=''1");
    expect(args).not.toContain("db' OR '1'='1");
  });

  test('returns zeros for unparseable output', async () => {
    execFile.mockImplementation((file, args, options, callback) => callback(null, '', ''));
    const result = await mysqlFamily.getDatabaseInfo({ host: 'h', port: 3306, user: 'root', pass: 'x', database: 'db' });
    expect(result).toEqual({ mb: 0, tables: 0 });
  });
});

describe('mysqlFamily.inspectSchema', () => {
  test('parses tab-separated column metadata, mapping the NULL sentinel to null', async () => {
    execFile.mockImplementation((file, args, options, callback) =>
      callback(null, 'users\tid\tint(11)\tNO\tNULL\nusers\temail\tvarchar(255)\tYES\t\'none\'\n', ''));
    const result = await mysqlFamily.inspectSchema({ host: 'h', port: 3306, user: 'root', pass: 'x', database: 'app_db' });
    expect(result).toEqual([
      { table: 'users', column: 'id', type: 'int(11)', nullable: 'NO', defaultVal: null },
      { table: 'users', column: 'email', type: 'varchar(255)', nullable: 'YES', defaultVal: "'none'" }
    ]);
  });

  test('embeds an escaped database name, never a raw one, in the query argv element', async () => {
    execFile.mockImplementation((file, args, options, callback) => callback(null, '', ''));
    await mysqlFamily.inspectSchema({ host: 'h', port: 3306, user: 'root', pass: 'x', database: "db' OR '1'='1" });
    const [, args] = execFile.mock.calls[0];
    const sqlArg = args[args.length - 1];
    expect(sqlArg).toContain("db'' OR ''1''=''1");
  });
});

describe('mysqlFamily.ensureDatabase', () => {
  test('creates the database with an escaped identifier and MYSQL_PWD env', async () => {
    execFile.mockImplementation((file, args, options, callback) => callback(null, '', ''));
    await mysqlFamily.ensureDatabase({ host: 'h', port: 3306, user: 'root', pass: 'x', database: 'my`db' });
    const [, args, options] = execFile.mock.calls[0];
    expect(args.join(' ')).toContain('my``db');
    expect(options.env.MYSQL_PWD).toBe('x');
  });

  test('retries with a simpler statement if the max_allowed_packet variant fails', async () => {
    let call = 0;
    execFile.mockImplementation((file, args, options, callback) => {
      call += 1;
      if (call === 1) return callback(new Error('permission denied for SET GLOBAL'));
      callback(null, '', '');
    });
    await expect(mysqlFamily.ensureDatabase({ host: 'h', port: 3306, user: 'root', pass: 'x', database: 'db' })).resolves.toBeUndefined();
    expect(execFile).toHaveBeenCalledTimes(2);
  });
});

describe('mysqlFamily.spawnDump / spawnRestore', () => {
  test('spawnDump invokes mysqldump with --ignore-table per excluded table and MYSQL_PWD env', () => {
    mysqlFamily.spawnDump({ host: 'h', port: 3306, user: 'root', pass: 'x', database: 'app_db', excludeTables: ['logs', 'sessions'] });
    const [bin, args, options] = spawn.mock.calls[0];
    expect(bin).toBe('mysqldump');
    expect(args).toContain('--ignore-table=app_db.logs');
    expect(args).toContain('--ignore-table=app_db.sessions');
    expect(options.env.MYSQL_PWD).toBe('x');
  });

  test('spawnRestore invokes mysql with the destination database and MYSQL_PWD env', () => {
    mysqlFamily.spawnRestore({ host: 'h', port: 3306, user: 'root', pass: 'y', database: 'dst_db' });
    const [bin, args, options] = spawn.mock.calls[0];
    expect(bin).toBe('mysql');
    expect(args).toContain('dst_db');
    expect(options.env.MYSQL_PWD).toBe('y');
  });
});

describe('mysqlFamily flags', () => {
  test('declares clone-stream support and a textual dump format', () => {
    expect(mysqlFamily.supportsCloneStream).toBe(true);
    expect(mysqlFamily.textualDumpFormat).toBe(true);
  });
});

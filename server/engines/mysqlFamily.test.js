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

  test('never mutates server-wide settings (no SET GLOBAL) and only needs a single call', async () => {
    execFile.mockImplementation((file, args, options, callback) => callback(null, '', ''));
    await expect(mysqlFamily.ensureDatabase({ host: 'h', port: 3306, user: 'root', pass: 'x', database: 'db' })).resolves.toBeUndefined();
    expect(execFile).toHaveBeenCalledTimes(1);
    const [, args] = execFile.mock.calls[0];
    const sqlArg = args[args.length - 1];
    expect(sqlArg).not.toContain('SET GLOBAL');
    expect(sqlArg).toContain('CREATE DATABASE IF NOT EXISTS');
  });

  test('drops and recreates the database when cleanDest is true', async () => {
    execFile.mockImplementation((file, args, options, callback) => callback(null, '', ''));
    await mysqlFamily.ensureDatabase({ host: 'h', port: 3306, user: 'root', pass: 'x', database: 'clean_db', cleanDest: true });
    const [, args] = execFile.mock.calls[0];
    const sqlArg = args[args.length - 1];
    expect(sqlArg).toContain('DROP DATABASE IF EXISTS `clean_db`');
    expect(sqlArg).toContain('CREATE DATABASE `clean_db`');
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

describe('mysqlFamily incremental sync primitives', () => {
  test('getTableFingerprints uses Performance Schema counters instead of scanning rows', async () => {
    execFile.mockImplementation((file, args, options, callback) => {
      callback(
        null,
        'users\t11\t2026-11-04 10:00:00\t100\t80\t15\t5\n' +
        'orders\t21\t2026-11-04 10:05:00\t200\t150\t30\t20\n',
        ''
      );
    });

    const result = await mysqlFamily.getTableFingerprints(
      { host: 'h', port: 3306, user: 'root', pass: 'x', database: 'app_db' },
      ['users', 'orders']
    );

    expect(result.users.token).toBe('ps:100:80:15:5:11:2026-11-04 10:00:00');
    expect(result.orders.token).toBe('ps:200:150:30:20:21:2026-11-04 10:05:00');
    const [, args] = execFile.mock.calls[0];
    expect(args[args.length - 1]).toContain('performance_schema.table_io_waits_summary_by_table');
    expect(args[args.length - 1]).not.toContain('CHECKSUM TABLE');
  });

  test('getTableFingerprints falls back to InnoDB metadata when Performance Schema is off', async () => {
    execFile.mockImplementation((file, args, options, callback) => {
      const sql = String(args[args.length - 1]);
      if (sql.includes('performance_schema')) return callback(new Error('denied'), '', 'denied');
      if (sql.includes('mysql.innodb_table_stats')) {
        return callback(null, 'users\t11\t10\t1024\t0\t2026-11-04 10:00:00\n', '');
      }
      return callback(new Error(`unexpected SQL: ${sql}`));
    });

    const result = await mysqlFamily.getTableFingerprints(
      { host: 'h', port: 3306, user: 'root', pass: 'x', database: 'app_db' },
      ['users']
    );

    expect(result.users).toEqual({
      token: 'meta:11:10:1024:0:2026-11-04 10:00:00',
      rows: null
    });
    expect(
      execFile.mock.calls.some(([, args]) => String(args[args.length - 1]).includes('CHECKSUM TABLE'))
    ).toBe(false);
  });

  test('getTableFingerprints uses metadata for a table with no Performance Schema counter row', async () => {
    execFile.mockImplementation((file, args, options, callback) => {
      const sql = String(args[args.length - 1]);
      if (sql.includes('performance_schema')) {
        return callback(null, 'users\t11\t2026-11-04 10:00:00\tNULL\tNULL\tNULL\tNULL\n', '');
      }
      if (sql.includes('mysql.innodb_table_stats')) {
        return callback(null, 'users\t11\t10\t1024\t0\t2026-11-04 10:00:00\n', '');
      }
      return callback(new Error(`unexpected SQL: ${sql}`));
    });

    const result = await mysqlFamily.getTableFingerprints(
      { host: 'h', port: 3306, user: 'root', pass: 'x', database: 'app_db' },
      ['users']
    );

    expect(result.users.token).toBe('meta:11:10:1024:0:2026-11-04 10:00:00');
  });

  test('getTableChecksums is the explicit slow verification path', async () => {
    execFile.mockImplementation((file, args, options, callback) => {
      const sql = String(args[args.length - 1]);
      if (sql.includes('CHECKSUM TABLE')) return callback(null, 'app_db.users\t123\n', '');
      return callback(new Error(`unexpected SQL: ${sql}`));
    });

    const result = await mysqlFamily.getTableChecksums(
      { host: 'h', port: 3306, user: 'root', pass: 'x', database: 'app_db' },
      ['users']
    );

    expect(result.users).toEqual({ token: '123', rows: null });
  });

  test('spawnTableDump dataOnly emits no DDL, no locks and a key range', () => {
    mysqlFamily.spawnTableDump(
      { host: 'h', port: 3306, user: 'root', pass: 'x', database: 'app_db' },
      { table: 'big', dataOnly: true, keyColumn: 'id', keyAfter: '100' }
    );

    const [bin, args, options] = spawn.mock.calls[0];
    expect(bin).toBe('mysqldump');
    expect(args).toContain('--no-create-info');
    expect(args).toContain('--skip-add-locks');
    expect(args).toContain('--where=`id` > 100');
    expect(args).toContain('big');
    expect(options.env.MYSQL_PWD).toBe('x');
  });

  test('spawnCdcReplay filters by database, skips GTIDs and dedupes the same file', () => {
    mysqlFamily.spawnCdcReplay(
      { host: 'h', port: 3306, user: 'root', pass: 'x', database: 'app_db' },
      {
        from: { file: 'binlog.000001', position: 4 },
        to: { file: 'binlog.000001', position: 120 },
        binlogs: ['binlog.000001']
      }
    );

    const [bin, args] = spawn.mock.calls[0];
    expect(bin).toBe('mysqlbinlog');
    expect(args).toContain('--database');
    expect(args).toContain('app_db');
    expect(args).toContain('--skip-gtids');
    expect(args.filter((arg) => arg === 'binlog.000001')).toHaveLength(1);
  });

  test('spawnRestore omits --force in strict mode', () => {
    mysqlFamily.spawnRestore(
      { host: 'h', port: 3306, user: 'root', pass: 'x', database: 'app_db' },
      { strict: true }
    );

    const [, args] = spawn.mock.calls[0];
    expect(args).not.toContain('--force');
  });

  test('getCdcCapabilities reports the current binlog position', async () => {
    execFile.mockImplementation((file, args, options, callback) => {
      if (file === 'mysqlbinlog') {
        return callback(null, 'mysqlbinlog  Ver 8.0.46 for Linux\n', '');
      }
      const sql = String(args[args.length - 1]);
      if (sql.includes('SHOW VARIABLES')) {
        return callback(null, 'log_bin\tON\nbinlog_format\tROW\nbinlog_row_image\tFULL\ngtid_mode\tON\nbinlog_expire_logs_seconds\t2592000\n', '');
      }
      if (sql.includes('SELECT VERSION()')) {
        return callback(null, '8.0.46\n', '');
      }
      if (sql.includes('SHOW MASTER STATUS')) {
        return callback(null, 'binlog.000001\t120\t\t\tuuid:1-2\n', '');
      }
      if (sql.includes('SHOW BINARY LOGS')) {
        return callback(null, 'binlog.000001\t1000\t\n', '');
      }
      return callback(new Error(`unexpected SQL: ${sql}`));
    });

    const caps = await mysqlFamily.getCdcCapabilities({ host: 'h', port: 3306, user: 'root', pass: 'x' });

    expect(caps.available).toBe(true);
    expect(caps.position).toEqual({ file: 'binlog.000001', position: 120, gtid: 'uuid:1-2' });
    expect(caps.binlogs).toEqual(['binlog.000001']);
  });
});

describe('mysqlFamily flags', () => {
  test('declares clone-stream support and a textual dump format', () => {
    expect(mysqlFamily.supportsCloneStream).toBe(true);
    expect(mysqlFamily.textualDumpFormat).toBe(true);
  });
});

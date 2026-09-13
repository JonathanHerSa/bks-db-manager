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
const redis = (await import('./redis.js')).default;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('redis.listDatabases', () => {
  test('parses numbered DB indices out of INFO keyspace, passing the password via REDISCLI_AUTH env', async () => {
    execFile.mockImplementation((file, args, options, callback) =>
      callback(null, '# Keyspace\r\ndb0:keys=5,expires=0,avg_ttl=0\r\ndb2:keys=1,expires=0,avg_ttl=0\r\n', ''));
    const result = await redis.listDatabases({ host: 'h', port: 6379, user: '', pass: 'secret' });
    expect(result).toEqual(['0', '2']);
    const [bin, args, options] = execFile.mock.calls[0];
    expect(bin).toBe('redis-cli');
    expect(args).not.toContain('secret');
    expect(options.env.REDISCLI_AUTH).toBe('secret');
  });

  test('falls back to DB "0" when the keyspace is empty', async () => {
    execFile.mockImplementation((file, args, options, callback) => callback(null, '# Keyspace\r\n', ''));
    const result = await redis.listDatabases({ host: 'h', port: 6379, user: '', pass: '' });
    expect(result).toEqual(['0']);
  });
});

describe('redis.listTables', () => {
  test('scopes --scan to the requested numbered DB via -n', async () => {
    execFile.mockImplementation((file, args, options, callback) => callback(null, 'user:1\nuser:2\n', ''));
    const result = await redis.listTables({ host: 'h', port: 6379, user: '', pass: 'x', database: '2' });
    expect(result).toEqual(['user:1', 'user:2']);
    const [, args] = execFile.mock.calls[0];
    expect(args).toContain('-n');
    expect(args).toContain('2');
    expect(args).toContain('--scan');
  });

  test('defaults to DB 0 for a non-numeric database value', async () => {
    execFile.mockImplementation((file, args, options, callback) => callback(null, '', ''));
    await redis.listTables({ host: 'h', port: 6379, user: '', pass: 'x', database: undefined });
    const [, args] = execFile.mock.calls[0];
    expect(args).toContain('0');
  });
});

describe('redis.getDatabaseInfo', () => {
  test('combines DBSIZE (as "tables") and used_memory from INFO memory (as an instance-wide "mb" approximation)', async () => {
    execFile.mockImplementation((file, args, options, callback) => {
      if (args.includes('DBSIZE')) return callback(null, '42\n', '');
      return callback(null, 'used_memory:1048576\r\nused_memory_human:1.00M\r\n', '');
    });
    const result = await redis.getDatabaseInfo({ host: 'h', port: 6379, user: '', pass: 'x', database: '0' });
    expect(result).toEqual({ mb: 1, tables: 42 });
  });
});

describe('redis.inspectSchema', () => {
  test('always returns an empty array without shelling out (Redis has no columns)', async () => {
    const result = await redis.inspectSchema({ host: 'h', port: 6379, user: '', pass: 'x', database: '0' });
    expect(result).toEqual([]);
    expect(execFile).not.toHaveBeenCalled();
  });
});

describe('redis flags', () => {
  test('does not support clone streaming', () => {
    expect(redis.supportsCloneStream).toBe(false);
    expect(redis.spawnDump).toBeUndefined();
  });
});

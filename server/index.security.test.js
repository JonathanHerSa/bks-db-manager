// Regression tests for the security audit fixes:
// - CORS no longer reflects an arbitrary Origin (CSRF/SSRF from any web page
//   against this unauthenticated localhost daemon).
// - isSafeDbName rejects a leading "-" (e.g. "--all-databases"), which used
//   to be accepted and could make mysql/mysqldump treat a "database name" as
//   a CLI flag instead of a positional argument.
// - resolvePassword no longer falls back to "any saved password for this
//   host:port", which could leak a different account's credentials.
// - POST /api/clone/stream validates srcDb/dstDb/excludeTables the same way
//   the backup routes already validate `database`.
import { describe, test, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

vi.mock('os', () => {
  const homedir = () => '/tmp/fake-home-bks-test';
  return { homedir, default: { homedir } };
});

vi.mock('fs', () => {
  const existsSync = vi.fn(() => false);
  const mkdirSync = vi.fn(() => undefined);
  const readFileSync = vi.fn(() => '');
  const writeFileSync = vi.fn(() => undefined);
  const appendFileSync = vi.fn(() => undefined);
  const chmodSync = vi.fn(() => undefined);
  const statSync = vi.fn(() => ({ size: 100 }));
  const openSync = vi.fn(() => 1);
  const readSync = vi.fn(() => 0);
  const closeSync = vi.fn(() => undefined);
  const readdirSync = vi.fn(() => []);
  const api = {
    existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync,
    chmodSync, statSync, openSync, readSync, closeSync, readdirSync,
  };
  return { ...api, default: api };
});

vi.mock('child_process', async () => {
  const { promisify } = await import('node:util');

  const exec = vi.fn((command, options, callback) => {
    callback(new Error(`exec not mocked for: ${command}`));
  });
  exec[promisify.custom] = (command, options) => new Promise((resolve, reject) => {
    exec(command, options, (err, stdout, stderr) => {
      if (err) { err.stdout = stdout; err.stderr = stderr; reject(err); }
      else resolve({ stdout: stdout || '', stderr: stderr || '' });
    });
  });

  const execFile = vi.fn((file, args, options, callback) => {
    callback(new Error(`execFile not mocked for: ${file}`));
  });
  execFile[promisify.custom] = (file, args, options) => new Promise((resolve, reject) => {
    execFile(file, args, options, (err, stdout, stderr) => {
      if (err) { err.stdout = stdout; err.stderr = stderr; reject(err); }
      else resolve({ stdout: stdout || '', stderr: stderr || '' });
    });
  });

  const spawn = vi.fn(() => { throw new Error('spawn not mocked'); });

  return { exec, execFile, spawn, default: { exec, execFile, spawn } };
});

const fs = (await import('fs')).default;
const { exec, execFile } = await import('child_process');
const { isSafeDbName } = await import('./index.js');
const app = (await import('./index.js')).default;

beforeEach(() => {
  vi.clearAllMocks();
  fs.existsSync.mockImplementation(() => false);
  fs.readFileSync.mockImplementation(() => '');
  exec.mockImplementation((command, options, callback) => {
    callback(new Error(`exec not mocked for: ${command}`));
  });
  execFile.mockImplementation((file, args, options, callback) => {
    callback(new Error(`execFile not mocked for: ${file}`));
  });
});

describe('isSafeDbName', () => {
  test('rejects a leading hyphen (e.g. a CLI flag disguised as a database name)', () => {
    expect(isSafeDbName('--all-databases')).toBe(false);
    expect(isSafeDbName('-f')).toBe(false);
  });

  test('still accepts ordinary identifiers, including internal hyphens/dots', () => {
    expect(isSafeDbName('app_db')).toBe(true);
    expect(isSafeDbName('app-db.v2')).toBe(true);
  });
});

describe('CORS policy', () => {
  test('does not reflect an arbitrary third-party Origin', async () => {
    const res = await request(app)
      .get('/api/status')
      .set('Origin', 'https://evil.example.com');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  test('allows requests with no Origin header (native/CLI clients)', async () => {
    const res = await request(app).get('/api/status');
    expect(res.status).toBe(200);
  });

  test('allows the Vite dev server origin', async () => {
    const res = await request(app)
      .get('/api/status')
      .set('Origin', 'http://localhost:5173');
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');
  });
});

describe('resolvePassword cross-account fix (via POST /api/databases)', () => {
  const CONNS_FILE = '/tmp/fake-home-bks-test/.db_manager_conns.list';

  test('never resolves a different user\'s saved password for the same host:port', async () => {
    fs.existsSync.mockImplementation((p) => p === CONNS_FILE);
    fs.readFileSync.mockImplementation((p) => {
      if (p === CONNS_FILE) return 'Root Conn|mysql|dbhost|3306|root|root-secret';
      return '';
    });
    execFile.mockImplementation((file, args, options, callback) => callback(null, 'app_db\n', ''));

    await request(app).post('/api/databases').send({
      motor: 'mysql', host: 'dbhost', port: 3306, user: 'readonly', pass: '',
    });

    const [, , options] = execFile.mock.calls[0];
    expect(options.env.MYSQL_PWD).toBe('');
  });

  test('still resolves the password for an exact host:port:user match', async () => {
    fs.existsSync.mockImplementation((p) => p === CONNS_FILE);
    fs.readFileSync.mockImplementation((p) => {
      if (p === CONNS_FILE) return 'Root Conn|mysql|dbhost|3306|root|root-secret';
      return '';
    });
    execFile.mockImplementation((file, args, options, callback) => callback(null, 'app_db\n', ''));

    await request(app).post('/api/databases').send({
      motor: 'mysql', host: 'dbhost', port: 3306, user: 'root', pass: '',
    });

    const [, , options] = execFile.mock.calls[0];
    expect(options.env.MYSQL_PWD).toBe('root-secret');
  });
});

describe('POST /api/clone/stream input validation', () => {
  test('rejects an unsafe srcDb', async () => {
    const res = await request(app).post('/api/clone/stream').send({
      motor: 'mysql',
      srcHost: 'h', srcPort: 1, srcUser: 'u', srcDb: '--all-databases',
      dstHost: 'h', dstPort: 1, dstUser: 'u', dstDb: 'b',
    });
    expect(res.status).toBe(400);
  });

  test('rejects an unsafe dstDb', async () => {
    const res = await request(app).post('/api/clone/stream').send({
      motor: 'mysql',
      srcHost: 'h', srcPort: 1, srcUser: 'u', srcDb: 'a',
      dstHost: 'h', dstPort: 1, dstUser: 'u', dstDb: 'db; DROP DATABASE x;',
    });
    expect(res.status).toBe(400);
  });

  test('rejects an unsafe excludeTables entry', async () => {
    const res = await request(app).post('/api/clone/stream').send({
      motor: 'mysql',
      srcHost: 'h', srcPort: 1, srcUser: 'u', srcDb: 'a',
      dstHost: 'h', dstPort: 1, dstUser: 'u', dstDb: 'b',
      excludeTables: ['logs', '--verbose'],
    });
    expect(res.status).toBe(400);
  });
});

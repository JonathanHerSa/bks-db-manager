// Tests for /api/databases, /api/tables, /api/database/info and
// /api/schema/inspect: the command-injection fix. These endpoints used to be
// (or could easily regress into being) vulnerable if host/user/database were
// ever interpolated into a shell string run via `exec`. The server now uses
// `execFile`/`execFileAsync` exclusively, passing each value as its own argv
// array element (no shell involved), and passwords are passed via env vars
// (MYSQL_PWD / PGPASSWORD) rather than argv. These tests assert that shape
// directly: a malicious host string must show up as a single, untouched
// argv element to `execFile`, and `exec` (the shell-invoking function) must
// never be called at all by these routes.
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

const { exec, execFile } = await import('child_process');
const app = (await import('./index.js')).default;

beforeEach(() => {
  vi.clearAllMocks();
  exec.mockImplementation((command, options, callback) => {
    callback(new Error(`exec not mocked for: ${command}`));
  });
  execFile.mockImplementation((file, args, options, callback) => {
    callback(new Error(`execFile not mocked for: ${file}`));
  });
});

const MALICIOUS_HOST = '`; touch /tmp/pwned #';

describe('POST /api/databases', () => {
  test('passes a malicious host as a single argv element to execFile (mysql), never via a shell exec', async () => {
    execFile.mockImplementation((file, args, options, callback) => callback(null, 'mydb\n', ''));

    const res = await request(app).post('/api/databases').send({
      motor: 'mysql', host: MALICIOUS_HOST, port: 3306, user: 'root', pass: 'x',
    });

    expect(res.status).toBe(200);
    expect(exec).not.toHaveBeenCalled();
    expect(execFile).toHaveBeenCalledTimes(1);
    const [bin, args, options] = execFile.mock.calls[0];
    expect(bin).toBe('mysql');
    expect(Array.isArray(args)).toBe(true);
    expect(args[1]).toBe(MALICIOUS_HOST);
    expect(options.env.MYSQL_PWD).toBe('x');
    expect(args).not.toContain('x');
  });
});

describe('POST /api/tables', () => {
  test('passes a malicious host as a single argv element to execFile (postgres), never via a shell exec', async () => {
    execFile.mockImplementation((file, args, options, callback) => callback(null, 'users\n', ''));

    const res = await request(app).post('/api/tables').send({
      motor: 'pg', host: MALICIOUS_HOST, port: 5432, user: 'postgres', pass: 'x', database: 'd',
    });

    expect(res.status).toBe(200);
    expect(exec).not.toHaveBeenCalled();
    expect(execFile).toHaveBeenCalledTimes(1);
    const [bin, args, options] = execFile.mock.calls[0];
    expect(bin).toBe('psql');
    expect(args[1]).toBe(MALICIOUS_HOST);
    expect(options.env.PGPASSWORD).toBe('x');
  });
});

describe('POST /api/database/info', () => {
  test('escapes a malicious database name inside the SQL text argv element (mysql), still as one array element', async () => {
    execFile.mockImplementation((file, args, options, callback) => callback(null, '12.5 3\n', ''));
    const maliciousDb = "db' OR '1'='1";

    const res = await request(app).post('/api/database/info').send({
      motor: 'mysql', host: 'h', port: 3306, user: 'root', pass: 'x', database: maliciousDb,
    });

    expect(res.status).toBe(200);
    expect(exec).not.toHaveBeenCalled();
    const [bin, args] = execFile.mock.calls[0];
    expect(bin).toBe('mysql');
    const sqlArg = args[args.length - 1];
    expect(sqlArg).toContain("db'' OR ''1''=''1");
    expect(args).not.toContain(maliciousDb);
  });
});

describe('POST /api/schema/inspect', () => {
  test('passes a malicious host as a single argv element to execFile (postgres)', async () => {
    execFile.mockImplementation((file, args, options, callback) => callback(null, '', ''));

    const res = await request(app).post('/api/schema/inspect').send({
      motor: 'pg', host: MALICIOUS_HOST, port: 5432, user: 'postgres', pass: 'x', database: 'd',
    });

    expect(res.status).toBe(200);
    expect(exec).not.toHaveBeenCalled();
    const [bin, args, options] = execFile.mock.calls[0];
    expect(bin).toBe('psql');
    expect(args[1]).toBe(MALICIOUS_HOST);
    expect(options.env.PGPASSWORD).toBe('x');
  });

  test('escapes a malicious database name (mysql) inside the SQL text argv element', async () => {
    execFile.mockImplementation((file, args, options, callback) => callback(null, '', ''));
    const maliciousDb = "db' OR '1'='1";

    const res = await request(app).post('/api/schema/inspect').send({
      motor: 'mysql', host: 'h', port: 3306, user: 'root', pass: 'x', database: maliciousDb,
    });

    expect(res.status).toBe(200);
    const [, args] = execFile.mock.calls[0];
    const sqlArg = args[args.length - 1];
    expect(sqlArg).toContain("db'' OR ''1''=''1");
  });
});

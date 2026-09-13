// Tests for GET /api/conns and POST /api/conns/save.
//
// Covers: merging Beekeeper Studio's saved_connection table (read via
// `sqlite3` through execFile) with ~/.db_manager_conns.list, dedup by
// host/port/user, the SQL-injection fix in `normalizeMotor`/`escSqlStr` when
// saving a connection with an unrecognized/malicious `motor` value, the
// 0o600 permission fix on ~/.db_manager_passwords, and the fix that stops
// raw sqlite3 error output (which can contain the plaintext password) from
// ever reaching the HTTP client.
import { describe, test, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import path from 'node:path';

const FAKE_HOME = '/tmp/fake-home-bks-test';
const BEEKEEPER_DB_PATH = path.join(FAKE_HOME, '.config', 'beekeeper-studio', 'app.db');
const CONNS_FILE = path.join(FAKE_HOME, '.db_manager_conns.list');
const PASS_FILE = path.join(FAKE_HOME, '.db_manager_passwords');

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
const app = (await import('./index.js')).default;

beforeEach(() => {
  vi.clearAllMocks();
  fs.existsSync.mockImplementation(() => false);
  fs.mkdirSync.mockImplementation(() => undefined);
  fs.readFileSync.mockImplementation(() => '');
  fs.appendFileSync.mockImplementation(() => undefined);
  fs.chmodSync.mockImplementation(() => undefined);
  exec.mockImplementation((command, options, callback) => {
    callback(new Error(`exec not mocked for: ${command}`));
  });
  execFile.mockImplementation((file, args, options, callback) => {
    callback(new Error(`execFile not mocked for: ${file}`));
  });
});

describe('GET /api/conns', () => {
  test('lists Beekeeper saved connections with the expected shape', async () => {
    fs.existsSync.mockImplementation((p) => p === BEEKEEPER_DB_PATH);
    const row = ['1', 'My DB', 'mysql', 'dbhost', '3306', 'root', 'mydb', '', ''].join('|');
    execFile.mockImplementation((file, args, options, callback) => callback(null, `${row}\n`, ''));

    const res = await request(app).get('/api/conns');

    expect(res.status).toBe(200);
    expect(res.body.conns).toHaveLength(1);
    expect(res.body.conns[0]).toMatchObject({
      id: 'bks-1',
      name: 'My DB',
      motor: 'mysql',
      host: 'dbhost',
      port: 3306,
      user: 'root',
      hasPassword: false,
      isBeekeeper: true,
    });
    // Security fix: GET /api/conns never returns the resolved plaintext
    // password (the daemon has no auth and wide-open CORS), only whether one
    // is known.
    expect(res.body.conns[0]).not.toHaveProperty('password');
  });

  test('merges ~/.db_manager_conns.list entries and dedupes by host/port/user', async () => {
    fs.existsSync.mockImplementation((p) => p === BEEKEEPER_DB_PATH || p === CONNS_FILE);
    const bksRow = ['1', 'Prod', 'mysql', 'dbhost', '3306', 'root', 'mydb', '', ''].join('|');
    execFile.mockImplementation((file, args, options, callback) => callback(null, `${bksRow}\n`, ''));
    fs.readFileSync.mockImplementation((p) => {
      if (p === CONNS_FILE) {
        return [
          'Prod Dup|mysql|dbhost|3306|root|secret',
          'Local Redis|redis|127.0.0.1|6379|default|',
        ].join('\n');
      }
      return '';
    });

    const res = await request(app).get('/api/conns');

    expect(res.status).toBe(200);
    expect(res.body.conns).toHaveLength(2);
    const names = res.body.conns.map((c) => c.name);
    expect(names).toContain('Prod');
    expect(names).toContain('Local Redis');
    expect(names).not.toContain('Prod Dup');
  });

  test('never crashes and returns a safe error when reading connections fails', async () => {
    fs.existsSync.mockImplementation(() => { throw new Error('boom /home/real-user/secret-path'); });
    const res = await request(app).get('/api/conns');
    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain('secret-path');
  });
});

describe('POST /api/conns/save', () => {
  test('saves a new connection, escaping an unrecognized/malicious motor string safely (SQL injection fix)', async () => {
    fs.existsSync.mockImplementation((p) => p === BEEKEEPER_DB_PATH);
    execFile
      .mockImplementationOnce((file, args, options, callback) => callback(null, '', '')) // check: not found
      .mockImplementationOnce((file, args, options, callback) => callback(null, '', '')); // insert ok

    const res = await request(app).post('/api/conns/save').send({
      name: 'Weird',
      motor: "x' OR '1'='1",
      host: 'localhost',
      port: 3306,
      user: 'root',
      password: '',
      database: 'mydb',
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: true,
      alreadyExists: false,
      message: '¡Conexión guardada exitosamente en Beekeeper Studio!',
    });

    expect(execFile).toHaveBeenCalledTimes(2);
    const insertCall = execFile.mock.calls[1];
    expect(insertCall[0]).toBe('sqlite3');
    const insertSql = insertCall[1][1];
    // normalizeMotor lowercases unknown engines and returns them verbatim;
    // escSqlStr must have doubled every single quote so the statement stays
    // well-formed instead of breaking out of the string literal.
    expect(insertSql).toContain("x'' or ''1''=''1");
  });

  test('returns alreadyExists:true without inserting when the connection is already saved', async () => {
    fs.existsSync.mockImplementation((p) => p === BEEKEEPER_DB_PATH);
    execFile.mockImplementationOnce((file, args, options, callback) => callback(null, '5\n', ''));

    const res = await request(app).post('/api/conns/save').send({
      motor: 'mysql', host: 'h', port: 3306, user: 'root', database: 'd',
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: true,
      alreadyExists: true,
      message: 'Esta conexión ya existe guardada en Beekeeper Studio.',
    });
    expect(execFile).toHaveBeenCalledTimes(1);
  });

  test('responds 404 when the Beekeeper app.db file does not exist', async () => {
    fs.existsSync.mockImplementation(() => false);
    const res = await request(app).post('/api/conns/save').send({ motor: 'mysql', host: 'h' });
    expect(res.status).toBe(404);
    expect(execFile).not.toHaveBeenCalled();
  });

  test('stores the password file with 0o600 permissions when saving a non-empty password', async () => {
    fs.existsSync.mockImplementation((p) => p === BEEKEEPER_DB_PATH);
    execFile
      .mockImplementationOnce((file, args, options, callback) => callback(null, '', ''))
      .mockImplementationOnce((file, args, options, callback) => callback(null, '', ''));

    await request(app).post('/api/conns/save').send({
      motor: 'mysql', host: 'h', port: 3306, user: 'root', password: 'S3cret!', database: 'd',
    });

    expect(fs.appendFileSync).toHaveBeenCalledTimes(1);
    const [filePath, content, options] = fs.appendFileSync.mock.calls[0];
    expect(filePath).toBe(PASS_FILE);
    expect(content).toContain('S3cret!');
    expect(options).toEqual({ mode: 0o600 });
    expect(fs.chmodSync).toHaveBeenCalledWith(PASS_FILE, 0o600);
  });

  test('never leaks the raw sqlite3 error output or the plaintext password on a 500', async () => {
    fs.existsSync.mockImplementation((p) => p === BEEKEEPER_DB_PATH);
    const secretErr = new Error(
      "Command failed: sqlite3 /fake/app.db INSERT INTO saved_connection (...) VALUES (..., 'TOP_SECRET_PASSWORD', ...)"
    );
    secretErr.stderr = "near syntax error, password='TOP_SECRET_PASSWORD'";
    execFile
      .mockImplementationOnce((file, args, options, callback) => callback(null, '', '')) // check
      .mockImplementationOnce((file, args, options, callback) => callback(secretErr)); // insert fails

    const res = await request(app).post('/api/conns/save').send({
      motor: 'mysql', host: 'h', port: 3306, user: 'root', password: 'TOP_SECRET_PASSWORD', database: 'd',
    });

    expect(res.status).toBe(500);
    const raw = JSON.stringify(res.body);
    expect(raw).not.toContain('TOP_SECRET_PASSWORD');
    expect(raw).not.toContain('sqlite3');
    expect(res.body).toEqual({ error: 'No se pudo guardar la conexión en Beekeeper Studio.' });
  });
});

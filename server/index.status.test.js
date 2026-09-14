// Tests for GET /api/status, GET /api/docker and the global error handler
// of the companion daemon (server/index.js).
//
// server/index.js touches the real filesystem, HOME directory and spawns
// system commands as soon as it is imported (top-level `app.get/post(...)`
// registration plus a synchronous `fs.mkdirSync` for BACKUP_DIR). We mock
// `os`, `fs` and `child_process` BEFORE importing the module so none of that
// ever touches the real machine, and so we can script command output.
import { describe, test, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import pkg from '../package.json' with { type: 'json' };

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

// exec/execFile are only ever used through `promisify(exec)` /
// `promisify(execFile)` in server/index.js, so we attach a real
// `util.promisify.custom` implementation to our mocks: this is required so
// `promisify()` resolves to `{ stdout, stderr }` (Node's real exec/execFile
// have a custom promisify implementation; a bare callback-style mock would
// otherwise make `promisify` resolve with just the first callback arg).
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
  fs.statSync.mockImplementation(() => ({ size: 100 }));
  fs.readdirSync.mockImplementation(() => []);
  exec.mockImplementation((command, options, callback) => {
    callback(new Error(`exec not mocked for: ${command}`));
  });
  execFile.mockImplementation((file, args, options, callback) => {
    callback(new Error(`execFile not mocked for: ${file}`));
  });
});

describe('GET /api/status', () => {
  test('returns tools as an object keyed by tool name (not an array), reflecting which "which <tool>" calls succeed', async () => {
    exec.mockImplementation((command, options, callback) => {
      if (/which mysql\b/.test(command)) callback(null, '/usr/bin/mysql\n', '');
      else callback(new Error('not found'));
    });

    const res = await request(app).get('/api/status');

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.version).toBe(pkg.version);
    expect(Array.isArray(res.body.tools)).toBe(false);
    expect(res.body.tools).toEqual({
      mysql: true,
      mysqldump: false,
      psql: false,
      pg_dump: false,
      mongodump: false,
      zstd: false,
      docker: false,
      pv: false,
    });
  });

  test('reports every tool as false when none of the "which" lookups succeed', async () => {
    const res = await request(app).get('/api/status');
    expect(res.status).toBe(200);
    expect(res.body.tools).toEqual({
      mysql: false,
      mysqldump: false,
      psql: false,
      pg_dump: false,
      mongodump: false,
      zstd: false,
      docker: false,
      pv: false,
    });
  });
});

describe('GET /api/docker', () => {
  test('maps a recognized mysql container, including a mapped host port', async () => {
    const line = JSON.stringify({
      ID: 'abc123',
      Names: 'my-mysql',
      Image: 'mysql:8',
      Status: 'Up 2 hours',
      Ports: '0.0.0.0:3307->3306/tcp',
    });
    exec.mockImplementation((command, options, callback) => callback(null, `${line}\n`, ''));

    const res = await request(app).get('/api/docker');

    expect(res.status).toBe(200);
    expect(res.body.containers).toHaveLength(1);
    expect(res.body.containers[0]).toMatchObject({
      id: 'abc123',
      name: 'my-mysql',
      image: 'mysql:8',
      motor: 'mysql',
      hostPort: 3307,
      internalPort: 3306,
    });
    expect(res.body.containers[0].connUrl).toContain('mysql://root@127.0.0.1:3307');
  });

  test('returns an empty containers array when docker ps has no output', async () => {
    exec.mockImplementation((command, options, callback) => callback(null, '', ''));
    const res = await request(app).get('/api/docker');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ containers: [] });
  });

  test('skips lines for images/names that do not match any known engine', async () => {
    const line = JSON.stringify({
      ID: 'zzz999',
      Names: 'random-app',
      Image: 'nginx:latest',
      Status: 'Up',
      Ports: '0.0.0.0:8080->80/tcp',
    });
    exec.mockImplementation((command, options, callback) => callback(null, `${line}\n`, ''));
    const res = await request(app).get('/api/docker');
    expect(res.status).toBe(200);
    expect(res.body.containers).toEqual([]);
  });
});

describe('global error handler', () => {
  // express.json() invokes next(err) synchronously when the body is
  // malformed, which is a natural (no monkey-patching needed) way to drive
  // an error into the catch-all `app.use((err, req, res, next) => ...)`
  // handler registered at the bottom of server/index.js.
  test('responds with a generic 500 and no stack trace / internal details for unexpected errors', async () => {
    const res = await request(app)
      .post('/api/databases')
      .set('Content-Type', 'application/json')
      .send('{ this is not valid json');

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Error interno del companion daemon.' });
    const raw = JSON.stringify(res.body);
    expect(raw).not.toMatch(/at\s+\S+:\d+:\d+/);
    expect(raw.toLowerCase()).not.toContain('syntaxerror');
  });
});

// Tests for GET /api/discovery/projects: the `path` query-param type
// validation fix (a nested object like `path[a]=1` used to crash with a
// TypeError before it was validated) and the `depth` clamp fix (unbounded
// recursion depth from an unauthenticated caller was a local DoS vector,
// now clamped to [0, 12]).
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
const app = (await import('./index.js')).default;

beforeEach(() => {
  vi.clearAllMocks();
  fs.existsSync.mockImplementation(() => false);
  fs.mkdirSync.mockImplementation(() => undefined);
  fs.readFileSync.mockImplementation(() => '');
  fs.statSync.mockImplementation(() => ({ size: 100 }));
  fs.readdirSync.mockImplementation(() => []);
});

describe('GET /api/discovery/projects - path validation', () => {
  test('responds 400 (not a crash) when "path" is a nested object instead of a string', async () => {
    const res = await request(app).get('/api/discovery/projects?path[a]=1');
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Parámetro "path" inválido.' });
  });

  test('accepts a plain string path', async () => {
    fs.existsSync.mockImplementation(() => true);
    fs.readdirSync.mockImplementation(() => []);
    const res = await request(app).get('/api/discovery/projects').query({ path: '/fake/root' });
    expect(res.status).toBe(200);
    expect(res.body.scannedDir).toBe('/fake/root');
  });
});

describe('GET /api/discovery/projects - depth clamp', () => {
  // Simulate an infinitely-nested directory tree: every directory contains
  // exactly one subdirectory, so without a clamp `scanDir` would recurse as
  // many times as the caller-supplied `depth` value.
  function makeInfiniteNestingMocks() {
    fs.existsSync.mockImplementation(() => true);
    fs.readdirSync.mockImplementation(() => [
      { name: 'nested', isDirectory: () => true, isFile: () => false },
    ]);
  }

  test('clamps an oversized depth (999) down to the maximum of 12', async () => {
    makeInfiniteNestingMocks();
    const res = await request(app)
      .get('/api/discovery/projects')
      .query({ path: '/fake/root', depth: 999 });

    expect(res.status).toBe(200);
    expect(res.body.maxDepth).toBe(12);
    // scanDir is called once per depth level (0..maxDepth inclusive) before
    // the `depth > maxDepth` guard stops recursion.
    expect(fs.readdirSync).toHaveBeenCalledTimes(13);
  }, 10000);

  test('clamps a negative depth (-5) up to the minimum of 0', async () => {
    makeInfiniteNestingMocks();
    const res = await request(app)
      .get('/api/discovery/projects')
      .query({ path: '/fake/root', depth: -5 });

    expect(res.status).toBe(200);
    expect(res.body.maxDepth).toBe(0);
    expect(fs.readdirSync).toHaveBeenCalledTimes(1);
  });

  test('defaults to a maxDepth of 6 when depth is not provided', async () => {
    makeInfiniteNestingMocks();
    const res = await request(app)
      .get('/api/discovery/projects')
      .query({ path: '/fake/root' });

    expect(res.status).toBe(200);
    expect(res.body.maxDepth).toBe(6);
    expect(fs.readdirSync).toHaveBeenCalledTimes(7);
  });
});

describe('GET /api/discovery/projects - .env parsing', () => {
  test('detects a DATABASE_URL in a .env file and reports the parsed connection', async () => {
    fs.existsSync.mockImplementation(() => true);
    fs.readdirSync.mockImplementation(() => [
      { name: '.env', isFile: () => true, isDirectory: () => false },
    ]);
    fs.readFileSync.mockImplementation((filePath) => {
      if (String(filePath).endsWith('.env')) {
        return 'DATABASE_URL=mysql://root:secret@localhost:3306/mydb\n';
      }
      return '';
    });

    const res = await request(app)
      .get('/api/discovery/projects')
      .query({ path: '/fake/proj', depth: 2 });

    expect(res.status).toBe(200);
    expect(res.body.scannedDir).toBe('/fake/proj');
    expect(res.body.maxDepth).toBe(2);
    expect(res.body.projects).toHaveLength(1);
    expect(res.body.projects[0]).toMatchObject({
      motor: 'mysql',
      database: 'mydb',
      host: 'localhost',
      port: 3306,
      username: 'root',
      hasPassword: true,
      fileName: '.env',
    });
  });
});

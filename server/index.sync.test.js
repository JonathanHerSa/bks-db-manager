// Endpoint-level guards for the incremental clone. The planner itself is
// covered by server/sync/planner.test.js; here we only assert that invalid
// motors/identifiers are rejected before any engine command is spawned.
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
  const api = { existsSync, mkdirSync, readFileSync };
  return { ...api, default: api };
});

vi.mock('child_process', async () => {
  const { promisify } = await import('node:util');
  const exec = vi.fn((command, options, callback) => callback(new Error('exec not mocked')));
  exec[promisify.custom] = () => Promise.reject(new Error('exec not mocked'));
  const execFile = vi.fn((file, args, options, callback) => callback(new Error('execFile not mocked')));
  execFile[promisify.custom] = () => Promise.reject(new Error('execFile not mocked'));
  const spawn = vi.fn(() => { throw new Error('spawn not mocked'); });
  return { exec, execFile, spawn, default: { exec, execFile, spawn } };
});

const { default: app, AUTH_TOKEN } = await import('./index.js');

beforeEach(() => {
  vi.clearAllMocks();
});

const base = {
  srcHost: '127.0.0.1',
  srcPort: 3307,
  srcUser: 'root',
  srcDb: 'finanzas',
  dstHost: '127.0.0.1',
  dstPort: 3308,
  dstUser: 'root',
  dstDb: 'finanzas'
};

describe('POST /api/clone/sync/plan validation', () => {
  test.each(['sqlserver', 'clickhouse', 'redis'])(
    'rejects %s with 400 because it has no clone-stream adapter',
    async (motor) => {
      const res = await request(app)
        .post('/api/clone/sync/plan')
        .set('X-Companion-Token', AUTH_TOKEN)
        .send({ ...base, motor });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain(motor);
    }
  );

  test('rejects a database name that could escape the CLI argument', async () => {
    const res = await request(app)
      .post('/api/clone/sync/plan')
      .set('X-Companion-Token', AUTH_TOKEN)
      .send({ ...base, srcDb: '--all-databases' });

    expect(res.status).toBe(400);
  });

  test('rejects unsafe append-only table names', async () => {
    const res = await request(app)
      .post('/api/clone/sync/plan')
      .set('X-Companion-Token', AUTH_TOKEN)
      .send({ ...base, appendOnlyTables: ['users; DROP TABLE users'] });

    expect(res.status).toBe(400);
  });

  test('rejects an unknown sync mode', async () => {
    const res = await request(app)
      .post('/api/clone/sync/plan')
      .set('X-Companion-Token', AUTH_TOKEN)
      .send({ ...base, mode: 'magic' });

    expect(res.status).toBe(400);
  });
});

describe('POST /api/clone/sync/apply', () => {
  test('returns 404 for an unknown or expired plan id', async () => {
    const res = await request(app)
      .post('/api/clone/sync/apply')
      .set('X-Companion-Token', AUTH_TOKEN)
      .send({ planId: 'does-not-exist' });

    expect(res.status).toBe(404);
  });
});

describe('POST /api/clone/cdc/status', () => {
  test('rejects unsupported engines with 400', async () => {
    const res = await request(app)
      .post('/api/clone/cdc/status')
      .set('X-Companion-Token', AUTH_TOKEN)
      .send({ ...base, motor: 'redis' });

    expect(res.status).toBe(400);
  });
});

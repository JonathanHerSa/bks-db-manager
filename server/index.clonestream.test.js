// Tests for POST /api/clone/stream's up-front engine-support guard: this
// project's multi-motor refactor (server/engines/*.js, a Strategy adapter
// per DB family) narrows clone streaming to engines with a real pipe-based
// dump/restore tool (CLONE_STREAM_ENGINES in shared/dbEngines.js). Engines
// that only support introspection (SQL Server, ClickHouse, Redis) must be
// rejected with a clear 400 *before* the SSE response starts, rather than
// silently hanging or emitting a generic "unsupported" event mid-stream.
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

const app = (await import('./index.js')).default;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('POST /api/clone/stream engine-support guard', () => {
  test.each(['sqlserver', 'clickhouse', 'redis'])(
    'rejects %s with 400 before starting the SSE stream',
    async (motor) => {
      const res = await request(app).post('/api/clone/stream').send({
        motor,
        srcHost: 'h', srcPort: 1, srcUser: 'u', srcDb: 'a',
        dstHost: 'h', dstPort: 1, dstUser: 'u', dstDb: 'b',
      });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain(motor);
    }
  );

  test('rejects an unknown motor with 400', async () => {
    const res = await request(app).post('/api/clone/stream').send({
      motor: 'oracle',
      srcHost: 'h', srcPort: 1, srcUser: 'u', srcDb: 'a',
      dstHost: 'h', dstPort: 1, dstUser: 'u', dstDb: 'b',
    });
    expect(res.status).toBe(400);
  });
});

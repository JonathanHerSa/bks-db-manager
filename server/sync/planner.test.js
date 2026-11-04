import { describe, test, expect } from 'vitest';
import { buildSyncPlan, canAppendByKey, compareKeys } from './planner.js';

const IDENTITY = { serverUuid: 'uuid-1', version: '8.0.26' };

function table(name, overrides = {}) {
  return {
    name,
    type: 'table',
    rows: 10,
    bytes: 1024,
    primaryKey: null,
    primaryKeyType: null,
    autoIncrement: false,
    ...overrides
  };
}

function makeEngine({
  srcTables = [],
  dstTables = null,
  schemaHashes = {},
  fingerprints = {},
  appendStates = {},
  newRows = 0,
  cdc = { available: false, reason: 'no binlog' },
  identity = IDENTITY
} = {}) {
  return {
    id: 'mysql',
    syncCapabilities: () => ({
      fingerprint: 'checksum',
      appendOnlyByKey: true,
      parallelTableDump: true,
      cdc: 'binlog'
    }),
    getServerIdentity: async () => identity,
    listTablesWithMeta: async (conn) => (conn.database === 'dst' ? (dstTables || srcTables) : srcTables),
    getTableSchemaHashes: async () => schemaHashes,
    getTableFingerprints: async () => fingerprints,
    getTableAppendStates: async () => appendStates,
    countRowsAfterKey: async () => newRows,
    getCdcCapabilities: async () => cdc
  };
}

function manifestWith(tables, extra = {}) {
  return {
    version: 1,
    source: { ...IDENTITY, host: '127.0.0.1', port: 3307, db: 'src' },
    dest: { host: '127.0.0.1', port: 3308, db: 'dst' },
    tables,
    ...extra
  };
}

const src = { host: '127.0.0.1', port: 3307, database: 'src' };
const dst = { host: '127.0.0.1', port: 3308, database: 'dst' };

describe('sync planner', () => {
  test('without a manifest every table is a new full copy', async () => {
    const engine = makeEngine({
      srcTables: [table('users')],
      schemaHashes: { users: 'h-users' },
      fingerprints: { users: { token: 'c1', rows: null } }
    });

    const plan = await buildSyncPlan({ engine, src, dst, manifest: null });

    expect(plan.tables).toHaveLength(1);
    expect(plan.tables[0].action).toBe('full');
    expect(plan.tables[0].reason).toBe('new');
    expect(plan.summary.newTables).toBe(1);
    expect(plan.summary.bytesToCopy).toBe(1024);
  });

  test('an unchanged checksum is skipped', async () => {
    const engine = makeEngine({
      srcTables: [table('users')],
      schemaHashes: { users: 'h-users' },
      fingerprints: { users: { token: 'c1', rows: null } }
    });

    const plan = await buildSyncPlan({
      engine,
      src,
      dst,
      manifest: manifestWith({
        users: { schemaHash: 'h-users', checksum: 'c1', rows: null, mode: 'full' }
      })
    });

    expect(plan.tables[0].action).toBe('skip');
    expect(plan.summary.unchanged).toBe(1);
    expect(plan.summary.bytesSkipped).toBe(1024);
  });

  test('a changed checksum triggers a full copy', async () => {
    const engine = makeEngine({
      srcTables: [table('users')],
      schemaHashes: { users: 'h-users' },
      fingerprints: { users: { token: 'c2', rows: null } }
    });

    const plan = await buildSyncPlan({
      engine,
      src,
      dst,
      manifest: manifestWith({
        users: { schemaHash: 'h-users', checksum: 'c1', rows: null, mode: 'full' }
      })
    });

    expect(plan.tables[0].action).toBe('full');
    expect(plan.tables[0].reason).toBe('changed');
  });

  test('a schema change wins over an unchanged checksum', async () => {
    const engine = makeEngine({
      srcTables: [table('users')],
      schemaHashes: { users: 'h-new' },
      fingerprints: { users: { token: 'c1', rows: null } }
    });

    const plan = await buildSyncPlan({
      engine,
      src,
      dst,
      manifest: manifestWith({
        users: { schemaHash: 'h-old', checksum: 'c1', rows: null, mode: 'full' }
      })
    });

    expect(plan.tables[0].action).toBe('full');
    expect(plan.tables[0].reason).toBe('schema-changed');
    expect(plan.summary.schemaChanged).toBe(1);
  });

  test('a replaced source server invalidates the manifest', async () => {
    const engine = makeEngine({
      srcTables: [table('users')],
      schemaHashes: { users: 'h-users' },
      fingerprints: { users: { token: 'c1', rows: null } },
      identity: { serverUuid: 'uuid-2', version: '8.0.26' }
    });

    const plan = await buildSyncPlan({
      engine,
      src,
      dst,
      manifest: manifestWith({
        users: { schemaHash: 'h-users', checksum: 'c1', rows: null, mode: 'full' }
      })
    });

    expect(plan.tables[0].action).toBe('full');
    expect(plan.tables[0].reason).toBe('new');
  });

  test('append-only table copies only rows above the last max key', async () => {
    const big = table('analisis_financiero_jsons', {
      rows: 100,
      bytes: 4 * 1024 * 1024,
      primaryKey: 'id',
      primaryKeyType: 'bigint',
      autoIncrement: true
    });
    const engine = makeEngine({
      srcTables: [big],
      schemaHashes: { analisis_financiero_jsons: 'h-big' },
      appendStates: { analisis_financiero_jsons: { rows: 110, maxKey: '110' } },
      newRows: 10
    });

    const plan = await buildSyncPlan({
      engine,
      src,
      dst,
      appendOnlyTables: ['analisis_financiero_jsons'],
      manifest: manifestWith({
        analisis_financiero_jsons: {
          schemaHash: 'h-big',
          checksum: null,
          rows: 100,
          maxKey: '100',
          mode: 'append'
        }
      })
    });

    expect(plan.tables[0].action).toBe('append');
    expect(plan.tables[0].appendFrom).toEqual({ column: 'id', value: '100' });
    expect(plan.tables[0].appendRows).toBe(10);
    expect(plan.tables[0].nextMode).toBe('append');
    expect(plan.summary.appendOnly).toBe(1);
  });

  test('marking an unchanged table append-only switches it to append mode without copying', async () => {
    const big = table('big', {
      rows: 100,
      primaryKey: 'id',
      primaryKeyType: 'bigint',
      autoIncrement: true
    });
    const engine = makeEngine({
      srcTables: [big],
      schemaHashes: { big: 'h-big' },
      fingerprints: { big: { token: 'c-big', rows: null } },
      appendStates: { big: { rows: 100, maxKey: '100' } }
    });

    const plan = await buildSyncPlan({
      engine,
      src,
      dst,
      appendOnlyTables: ['big'],
      manifest: manifestWith({
        big: { schemaHash: 'h-big', checksum: 'c-big', rows: 100, maxKey: null, mode: 'full' }
      })
    });

    expect(plan.tables[0].action).toBe('skip');
    expect(plan.tables[0].nextMode).toBe('append');
    expect(plan.tables[0].maxKey).toBe('100');
  });

  test('marking a changed table append-only still does a full copy first', async () => {
    const big = table('big', {
      rows: 100,
      primaryKey: 'id',
      primaryKeyType: 'bigint',
      autoIncrement: true
    });
    const engine = makeEngine({
      srcTables: [big],
      schemaHashes: { big: 'h-big' },
      fingerprints: { big: { token: 'c-new', rows: null } },
      appendStates: { big: { rows: 100, maxKey: '100' } }
    });

    const plan = await buildSyncPlan({
      engine,
      src,
      dst,
      appendOnlyTables: ['big'],
      manifest: manifestWith({
        big: { schemaHash: 'h-big', checksum: 'c-old', rows: 100, maxKey: null, mode: 'full' }
      })
    });

    expect(plan.tables[0].action).toBe('full');
    expect(plan.tables[0].reason).toBe('changed');
    expect(plan.tables[0].nextMode).toBe('append');
  });

  test('append mode is sticky from the manifest even without re-marking it', async () => {
    const big = table('big', {
      rows: 100,
      primaryKey: 'id',
      primaryKeyType: 'bigint',
      autoIncrement: true
    });
    const engine = makeEngine({
      srcTables: [big],
      schemaHashes: { big: 'h-big' },
      appendStates: { big: { rows: 105, maxKey: '105' } },
      newRows: 5
    });

    const plan = await buildSyncPlan({
      engine,
      src,
      dst,
      manifest: manifestWith({
        big: { schemaHash: 'h-big', checksum: null, rows: 100, maxKey: '100', mode: 'append' }
      })
    });

    expect(plan.tables[0].action).toBe('append');
    expect(plan.tables[0].appendOnly).toBe(true);
  });

  test('forceFullTables removes a sticky append table from append mode', async () => {
    const big = table('big', {
      rows: 100,
      primaryKey: 'id',
      primaryKeyType: 'bigint',
      autoIncrement: true
    });
    const engine = makeEngine({
      srcTables: [big],
      schemaHashes: { big: 'h-big' },
      fingerprints: { big: { token: 'c-big', rows: null } }
    });

    const plan = await buildSyncPlan({
      engine,
      src,
      dst,
      forceFullTables: ['big'],
      manifest: manifestWith({
        big: { schemaHash: 'h-big', checksum: 'c-big', rows: 100, maxKey: '100', mode: 'append' }
      })
    });

    expect(plan.tables[0].action).toBe('skip');
    expect(plan.tables[0].appendOnly).toBe(false);
    expect(plan.tables[0].nextMode).toBe('full');
  });

  test('a row-count gap falls back to a full copy and leaves append mode', async () => {
    const big = table('analisis_financiero_jsons', {
      rows: 100,
      primaryKey: 'id',
      primaryKeyType: 'bigint',
      autoIncrement: true
    });
    const engine = makeEngine({
      srcTables: [big],
      schemaHashes: { analisis_financiero_jsons: 'h-big' },
      appendStates: { analisis_financiero_jsons: { rows: 110, maxKey: '110' } },
      fingerprints: { analisis_financiero_jsons: { token: 'c-big', rows: null } },
      newRows: 5
    });

    const plan = await buildSyncPlan({
      engine,
      src,
      dst,
      appendOnlyTables: ['analisis_financiero_jsons'],
      manifest: manifestWith({
        analisis_financiero_jsons: {
          schemaHash: 'h-big',
          checksum: null,
          rows: 100,
          maxKey: '100',
          mode: 'append'
        }
      })
    });

    expect(plan.tables[0].action).toBe('full');
    expect(plan.tables[0].reason).toBe('append-gap');
    expect(plan.tables[0].nextMode).toBe('full');
  });

  test('mirror mode plans destination-only tables for drop', async () => {
    const engine = makeEngine({
      srcTables: [table('users')],
      dstTables: [table('users'), table('old_table')],
      schemaHashes: { users: 'h-users' },
      fingerprints: { users: { token: 'c1', rows: null } }
    });

    const plan = await buildSyncPlan({ engine, src, dst, mirror: true });

    const dropped = plan.tables.find((item) => item.name === 'old_table');
    expect(dropped.action).toBe('drop');
    expect(plan.summary.dropped).toBe(1);
  });

  test('CDC mode reports unavailable engines instead of pretending to work', async () => {
    const engine = makeEngine({
      srcTables: [table('users')],
      cdc: { available: false, reason: 'binlog disabled' }
    });

    const plan = await buildSyncPlan({ engine, src, dst, mode: 'cdc' });

    expect(plan.mode).toBe('cdc');
    expect(plan.cdc.available).toBe(false);
    expect(plan.cdc.reason).toBe('binlog disabled');
  });

  test('CDC mode plans a replay window when a position exists', async () => {
    const engine = makeEngine({
      srcTables: [table('users')],
      cdc: {
        available: true,
        engine: 'binlog',
        position: { file: 'binlog.000002', position: 120 }
      }
    });

    const plan = await buildSyncPlan({
      engine,
      src: { ...src, database: 'finanzas' },
      dst: { ...dst, database: 'finanzas' },
      mode: 'cdc',
      manifest: manifestWith({}, {
        cdc: { position: { file: 'binlog.000001', position: 4 } }
      })
    });

    expect(plan.cdc.from).toEqual({ file: 'binlog.000001', position: 4 });
    expect(plan.cdc.to).toEqual({ file: 'binlog.000002', position: 120 });
  });
});

describe('planner helpers', () => {
  test('canAppendByKey requires a single numeric auto-increment key', () => {
    expect(canAppendByKey({
      type: 'table',
      primaryKey: 'id',
      primaryKeyType: 'bigint',
      autoIncrement: true
    })).toBe(true);

    expect(canAppendByKey({
      type: 'table',
      primaryKey: 'id',
      primaryKeyType: 'uuid',
      autoIncrement: false
    })).toBe(false);

    expect(canAppendByKey({
      type: 'view',
      primaryKey: 'id',
      primaryKeyType: 'bigint',
      autoIncrement: true
    })).toBe(false);
  });

  test('compareKeys handles bigint values without losing precision', () => {
    expect(compareKeys('9007199254740993', '9007199254740992')).toBe(1);
    expect(compareKeys('100', '100')).toBe(0);
    expect(compareKeys(null, '100')).toBeNull();
  });
});

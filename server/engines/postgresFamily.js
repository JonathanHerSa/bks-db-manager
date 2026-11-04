import crypto from 'crypto';
import { execFile, spawn } from 'child_process';
import { promisify } from 'util';
import { escSqlStr, escPgIdent } from './escaping.js';

const execFileAsync = promisify(execFile);

const IGNORE_DATABASES = ['postgres', 'template0', 'template1'];

function runEnv(pass) {
  return { ...process.env, PGPASSWORD: pass || '' };
}

function baseArgs({ host, port, user }) {
  return ['-h', String(host), '-p', String(port), '-U', String(user)];
}

function safeColumn(name) {
  return typeof name === 'string' && /^[A-Za-z0-9_]+$/.test(name);
}

function numericLiteral(value) {
  const text = String(value);
  if (!/^-?\d+$/.test(text)) throw new Error('La clave de sincronización incremental debe ser un entero.');
  return text;
}

function quoteIdent(name) {
  return `"${escPgIdent(name)}"`;
}

function hashLines(lines) {
  return crypto.createHash('sha256').update(lines.join('\n')).digest('hex');
}

async function psql({ host, port, user, pass }, database, sql, { tuples = true } = {}) {
  const args = [...baseArgs({ host, port, user }), '-d', String(database)];
  if (tuples) args.push('-t', '-A', '-F', '\t');
  args.push('-c', sql);
  return execFileAsync('psql', args, { env: runEnv(pass) });
}

/**
 * Adapter for postgres-wire-compatible engines (PostgreSQL, CockroachDB,
 * Redshift). Uses `psql`/`pg_dump` via execFile/spawn, password via the
 * PGPASSWORD env var.
 */
export default {
  id: 'postgres',
  supportsCloneStream: true,
  // Dump output is plain SQL text, so the DEFINER/USE/CREATE-DATABASE
  // sanitizer and email-masking regex in server/index.js are safe to apply.
  textualDumpFormat: true,
  // Append dumps are CSV (COPY ... TO STDOUT), not SQL: running the SQL
  // sanitizer over them would corrupt values that contain SQL-looking text.
  appendFormat: 'csv',
  // COUNT(*) is a full scan in Postgres; skip the post-copy row-count check
  // by default (the dump/restore exit code is the primary signal).
  verifyRowCounts: false,

  syncCapabilities() {
    return {
      fingerprint: 'stats',
      appendOnlyByKey: true,
      parallelTableDump: true,
      cdc: 'logical'
    };
  },

  async listDatabases({ host, port, user, pass }) {
    const { stdout } = await psql({ host, port, user, pass }, 'postgres', 'SELECT datname FROM pg_database WHERE datistemplate = false;');
    return stdout.split('\n').map((s) => s.trim()).filter((s) => s && !IGNORE_DATABASES.includes(s));
  },

  async listTables({ host, port, user, pass, database }) {
    const { stdout } = await psql({ host, port, user, pass }, database, "SELECT tablename FROM pg_tables WHERE schemaname = 'public';");
    return stdout.split('\n').map((s) => s.trim()).filter(Boolean);
  },

  async getDatabaseInfo({ host, port, user, pass, database }) {
    const safeDb = escSqlStr(database || '');
    const sql = `SELECT ROUND(pg_database_size('${safeDb}') / (1024.0 * 1024.0), 2); SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE';`;
    const { stdout } = await psql({ host, port, user, pass }, database, sql);
    const parts = stdout.trim().split(/\s+/).filter(Boolean);
    return { mb: parseFloat(parts[0]) || 0, tables: parseInt(parts[1]) || 0 };
  },

  async inspectSchema({ host, port, user, pass, database }) {
    const sql = `SELECT table_name, column_name, data_type, is_nullable, COALESCE(column_default, 'NULL') FROM information_schema.columns WHERE table_schema = 'public' ORDER BY table_name, ordinal_position;`;
    const { stdout } = await psql({ host, port, user, pass }, database, sql);
    const lines = stdout.trim().split('\n').filter(Boolean);
    const columns = [];
    for (const line of lines) {
      const parts = line.split('\t');
      if (parts.length >= 3) {
        columns.push({
          table: parts[0],
          column: parts[1],
          type: parts[2],
          nullable: parts[3] || 'YES',
          defaultVal: parts[4] === 'NULL' ? null : parts[4]
        });
      }
    }
    return columns;
  },

  async ensureDatabase({ host, port, user, pass, database, cleanDest = false }) {
    const ident = escPgIdent(database || '');
    if (cleanDest) {
      try {
        await psql({ host, port, user, pass }, 'postgres', `DROP DATABASE IF EXISTS "${ident}";`);
      } catch {}
    }
    try {
      await psql({ host, port, user, pass }, 'postgres', `CREATE DATABASE "${ident}";`);
    } catch (err) {
      // 42P04 duplicate_database: the destination already exists, which is
      // exactly the "reuse the existing database" path incremental sync wants.
      const detail = String(err?.stderr || err?.message || '');
      if (!detail.includes('already exists')) throw err;
    }
  },

  // ---------------------------------------------------------------------
  // Incremental sync primitives
  // ---------------------------------------------------------------------

  async getServerIdentity({ host, port, user, pass }) {
    try {
      const { stdout } = await psql(
        { host, port, user, pass },
        'postgres',
        'SELECT system_identifier, version() FROM pg_control_system();'
      );
      const [identifier, version] = stdout.trim().split('\t');
      return { serverUuid: identifier ? `pg:${identifier}` : null, version: version || null };
    } catch {
      const { stdout } = await psql(
        { host, port, user, pass },
        'postgres',
        "SELECT current_setting('server_version_num'), version();"
      );
      const [versionNum, version] = stdout.trim().split('\t');
      return {
        serverUuid: versionNum ? `pg-version:${versionNum}` : null,
        version: version || null
      };
    }
  },

  async listTablesWithMeta({ host, port, user, pass, database }) {
    const sql = `SELECT c.relname, c.relkind, c.reltuples::bigint, pg_total_relation_size(c.oid)
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m')
      ORDER BY c.relname;`;
    const { stdout } = await psql({ host, port, user, pass }, database, sql);
    const tables = [];
    for (const line of stdout.split('\n')) {
      if (!line.trim()) continue;
      const [name, relkind, rows, bytes] = line.split('\t');
      tables.push({
        name,
        type: relkind === 'v' ? 'view' : 'table',
        rows: parseInt(rows, 10) || 0,
        bytes: parseInt(bytes, 10) || 0,
        primaryKey: null,
        primaryKeyType: null,
        autoIncrement: false
      });
    }

    const pkSql = `SELECT tc.table_name, kcu.column_name, kcu.ordinal_position, c.data_type, c.is_identity, COALESCE(c.column_default, '')
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON kcu.constraint_name = tc.constraint_name
       AND kcu.table_schema = tc.table_schema
       AND kcu.table_name = tc.table_name
      JOIN information_schema.columns c
        ON c.table_schema = tc.table_schema
       AND c.table_name = tc.table_name
       AND c.column_name = kcu.column_name
      WHERE tc.constraint_type='PRIMARY KEY' AND tc.table_schema='public'
      ORDER BY tc.table_name, kcu.ordinal_position;`;
    const pkResult = await psql({ host, port, user, pass }, database, pkSql);
    const pkByTable = new Map();
    for (const line of pkResult.stdout.split('\n')) {
      if (!line.trim()) continue;
      const [table, column, position, dataType, isIdentity, defaultValue] = line.split('\t');
      const entry = pkByTable.get(table) || [];
      entry.push({ column, position: parseInt(position, 10) || 0, dataType, isIdentity, defaultValue });
      pkByTable.set(table, entry);
    }
    for (const table of tables) {
      const pk = pkByTable.get(table.name);
      if (pk && pk.length === 1 && pk[0].position === 1) {
        table.primaryKey = pk[0].column;
        table.primaryKeyType = pk[0].dataType;
        table.autoIncrement = pk[0].isIdentity === 'YES' || pk[0].defaultValue.startsWith('nextval(');
      }
    }
    return tables;
  },

  async getTableSchemaHashes({ host, port, user, pass, database }, tables = []) {
    const wanted = new Set(tables);
    const byTable = new Map();
    const linesFor = (name) => {
      if (!byTable.has(name)) byTable.set(name, []);
      return byTable.get(name);
    };

    const columns = await psql(
      { host, port, user, pass },
      database,
      `SELECT table_name, column_name, data_type, is_nullable, COALESCE(column_default, ''), is_identity, COALESCE(collation_name, '')
       FROM information_schema.columns WHERE table_schema='public' ORDER BY table_name, ordinal_position;`
    );
    for (const line of columns.stdout.split('\n')) {
      if (!line.trim()) continue;
      const [table, column, type, nullable, defaultValue, isIdentity, collation] = line.split('\t');
      if (!wanted.has(table)) continue;
      linesFor(table).push(`col:${column}:${type}:${nullable}:${defaultValue}:${isIdentity}:${collation}`);
    }

    const indexes = await psql(
      { host, port, user, pass },
      database,
      `SELECT tablename, indexname, indexdef FROM pg_indexes WHERE schemaname='public' ORDER BY tablename, indexname;`
    );
    for (const line of indexes.stdout.split('\n')) {
      if (!line.trim()) continue;
      const [table, index, definition] = line.split('\t');
      if (!wanted.has(table)) continue;
      linesFor(table).push(`idx:${index}:${definition}`);
    }

    const constraints = await psql(
      { host, port, user, pass },
      database,
      `SELECT tc.table_name, tc.constraint_name, tc.constraint_type, COALESCE(kcu.column_name, '')
       FROM information_schema.table_constraints tc
       LEFT JOIN information_schema.key_column_usage kcu
         ON kcu.constraint_name = tc.constraint_name
        AND kcu.table_schema = tc.table_schema
        AND kcu.table_name = tc.table_name
       WHERE tc.table_schema='public'
       ORDER BY tc.table_name, tc.constraint_name, kcu.ordinal_position;`
    );
    for (const line of constraints.stdout.split('\n')) {
      if (!line.trim()) continue;
      const [table, constraint, type, column] = line.split('\t');
      if (!wanted.has(table)) continue;
      linesFor(table).push(`con:${constraint}:${type}:${column}`);
    }

    const views = await psql(
      { host, port, user, pass },
      database,
      `SELECT table_name, COALESCE(view_definition, '') FROM information_schema.views WHERE table_schema='public' ORDER BY table_name;`
    );
    for (const line of views.stdout.split('\n')) {
      if (!line.trim()) continue;
      const [table, definition] = line.split('\t');
      if (!wanted.has(table)) continue;
      linesFor(table).push(`view:${definition}`);
    }

    const hashes = {};
    for (const table of tables) {
      hashes[table] = hashLines(byTable.get(table) || []);
    }
    return hashes;
  },

  async getTableFingerprints({ host, port, user, pass, database }, tables = []) {
    // relpages/reltuples are included so a TRUNCATE (which does not bump the
    // cumulative n_tup_* counters) still changes the token.
    const { stdout } = await psql(
      { host, port, user, pass },
      database,
      `SELECT s.relname, s.n_tup_ins, s.n_tup_upd, s.n_tup_del, c.relpages, c.reltuples::bigint
       FROM pg_stat_user_tables s
       JOIN pg_class c ON c.oid = s.relid
       WHERE s.schemaname='public';`
    );
    const byName = new Map();
    for (const line of stdout.split('\n')) {
      if (!line.trim()) continue;
      const [name, inserts, updates, deletes, pages, tuples] = line.split('\t');
      byName.set(name, { inserts, updates, deletes, pages, tuples });
    }
    const result = {};
    for (const table of tables) {
      const stats = byName.get(table);
      result[table] = stats
        ? {
            token: `${stats.inserts}:${stats.updates}:${stats.deletes}:${stats.pages}:${stats.tuples}`,
            rows: null
          }
        : { token: null, rows: null };
    }
    return result;
  },

  async getTableAppendStates({ host, port, user, pass, database }, tables = []) {
    const result = {};
    for (const { table, column } of tables) {
      if (!safeColumn(column)) continue;
      const { stdout } = await psql(
        { host, port, user, pass },
        database,
        `SELECT COUNT(*), MAX(${quoteIdent(column)}) FROM "public".${quoteIdent(table)};`
      );
      const [rows, maxKey] = stdout.trim().split('\t');
      result[table] = {
        rows: parseInt(rows, 10) || 0,
        maxKey: maxKey === '' || maxKey === undefined ? null : maxKey
      };
    }
    return result;
  },

  async countRowsAfterKey({ host, port, user, pass, database }, table, column, value) {
    if (!safeColumn(column)) throw new Error('Columna de clave inválida.');
    const { stdout } = await psql(
      { host, port, user, pass },
      database,
      `SELECT COUNT(*) FROM "public".${quoteIdent(table)} WHERE ${quoteIdent(column)} > ${numericLiteral(value)};`
    );
    return parseInt(stdout.trim(), 10) || 0;
  },

  async getTableRowCount({ host, port, user, pass, database }, table) {
    const { stdout } = await psql(
      { host, port, user, pass },
      database,
      `SELECT COUNT(*) FROM "public".${quoteIdent(table)};`
    );
    return parseInt(stdout.trim(), 10) || 0;
  },

  async dropTable({ host, port, user, pass, database }, table, { view = false } = {}) {
    const keyword = view ? 'VIEW' : 'TABLE';
    await psql(
      { host, port, user, pass },
      database,
      `DROP ${keyword} IF EXISTS "public".${quoteIdent(table)};`
    );
  },

  async getCdcCapabilities({ host, port, user, pass }) {
    try {
      const { stdout } = await psql({ host, port, user, pass }, 'postgres', 'SHOW wal_level;');
      const level = stdout.trim();
      if (level !== 'logical') {
        return {
          available: false,
          engine: 'logical',
          reason: `wal_level=${level}; se requiere logical para replicación lógica.`
        };
      }
    } catch {}
    return {
      available: false,
      engine: 'logical',
      reason: 'Logical decoding detectado, pero el replay de CDC para PostgreSQL aún no está implementado. Usa el modo incremental por tablas.'
    };
  },

  // ---------------------------------------------------------------------
  // Full-database and single-table dump/restore
  // ---------------------------------------------------------------------

  spawnDump({ host, port, user, pass, database, excludeTables }) {
    const dumpArgs = [
      '-h', host, '-p', String(port), '-U', user, '-d', database,
      '--format=p', '--no-owner', '--no-privileges',
      // NOTE (atomicity): emit DROP ... IF EXISTS before each CREATE so
      // restoring over a non-empty destination replaces objects cleanly
      // instead of failing "already exists" mid-script (see spawnRestore).
      '--clean', '--if-exists'
    ];
    if (Array.isArray(excludeTables)) {
      for (const t of excludeTables) {
        dumpArgs.push('-T', t);
      }
    }
    return spawn('pg_dump', dumpArgs, { env: { ...process.env, PGPASSWORD: pass } });
  },

  spawnTableDump({ host, port, user, pass, database }, { table, dataOnly = false, keyColumn = null, keyAfter = null, view = false } = {}) {
    if (dataOnly) {
      if (!safeColumn(keyColumn)) throw new Error('Columna de clave inválida.');
      const sql = `COPY (SELECT * FROM "public".${quoteIdent(table)} WHERE ${quoteIdent(keyColumn)} > ${numericLiteral(keyAfter)}) TO STDOUT WITH (FORMAT csv);`;
      // -q suppresses psql's "COPY N" status line, which would otherwise be
      // appended to the CSV stream and restored as a bogus row.
      return spawn('psql', [
        ...baseArgs({ host, port, user }), '-d', String(database), '-q', '-c', sql
      ], { env: runEnv(pass) });
    }
    const args = [
      '-h', host, '-p', String(port), '-U', user, '-d', database,
      '--format=p', '--no-owner', '--no-privileges',
      '--clean', '--if-exists',
      '-t', String(table)
    ];
    if (view) args.push('--schema-only');
    return spawn('pg_dump', args, { env: runEnv(pass) });
  },

  spawnRestore({ host, port, user, pass, database }, options = {}) {
    const dstArgs = [
      '-h', host, '-p', String(port), '-U', user, '-d', database,
      // NOTE (atomicity): without these, psql keeps executing after a failed
      // statement and still exits 0, leaving the destination half-restored
      // with no error surfaced to the caller. --single-transaction wraps the
      // whole script in one BEGIN/COMMIT and ON_ERROR_STOP=1 aborts (and rolls
      // back) on the first real error instead of limping through the rest.
      '--single-transaction', '-v', 'ON_ERROR_STOP=1'
    ];
    void options;
    return spawn('psql', dstArgs, { env: runEnv(pass) });
  },

  spawnTableRestore({ host, port, user, pass, database }, { table, dataOnly = false } = {}) {
    if (!dataOnly) return this.spawnRestore({ host, port, user, pass, database });
    const sql = `COPY "public".${quoteIdent(table)} FROM STDIN WITH (FORMAT csv);`;
    return spawn('psql', [
      ...baseArgs({ host, port, user }), '-d', String(database), '-q', '-v', 'ON_ERROR_STOP=1', '-c', sql
    ], { env: runEnv(pass) });
  }
};

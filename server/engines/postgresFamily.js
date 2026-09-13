import { execFile, spawn } from 'child_process';
import { promisify } from 'util';
import { escSqlStr, escPgIdent } from './escaping.js';

const execFileAsync = promisify(execFile);

const IGNORE_DATABASES = ['postgres', 'template0', 'template1'];

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

  async listDatabases({ host, port, user, pass }) {
    const env = { ...process.env, PGPASSWORD: pass };
    const args = ['-h', String(host), '-p', String(port), '-U', String(user), '-t', '-c', 'SELECT datname FROM pg_database WHERE datistemplate = false;', 'postgres'];
    const { stdout } = await execFileAsync('psql', args, { env });
    return stdout.split('\n').map((s) => s.trim()).filter((s) => s && !IGNORE_DATABASES.includes(s));
  },

  async listTables({ host, port, user, pass, database }) {
    const env = { ...process.env, PGPASSWORD: pass };
    const args = ['-h', String(host), '-p', String(port), '-U', String(user), '-d', String(database), '-t', '-c', "SELECT tablename FROM pg_tables WHERE schemaname = 'public';"];
    const { stdout } = await execFileAsync('psql', args, { env });
    return stdout.split('\n').map((s) => s.trim()).filter(Boolean);
  },

  async getDatabaseInfo({ host, port, user, pass, database }) {
    const env = { ...process.env, PGPASSWORD: pass };
    const safeDb = escSqlStr(database || '');
    // Two statements in one -c: size, then table count (the original version
    // of this query only ever fetched the size, silently leaving `tables` at
    // 0 for Postgres — filled in here since we're already connected to the
    // right database context).
    const sql = `SELECT ROUND(pg_database_size('${safeDb}') / (1024.0 * 1024.0), 2); SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE';`;
    const args = ['-h', String(host), '-p', String(port), '-U', String(user), '-d', String(database), '-t', '-c', sql];
    const { stdout } = await execFileAsync('psql', args, { env });
    const parts = stdout.trim().split(/\s+/).filter(Boolean);
    return { mb: parseFloat(parts[0]) || 0, tables: parseInt(parts[1]) || 0 };
  },

  async inspectSchema({ host, port, user, pass, database }) {
    const env = { ...process.env, PGPASSWORD: pass };
    const sql = `SELECT table_name, column_name, data_type, is_nullable, COALESCE(column_default, 'NULL') FROM information_schema.columns WHERE table_schema = 'public' ORDER BY table_name, ordinal_position;`;
    const args = ['-h', String(host), '-p', String(port), '-U', String(user), '-d', String(database), '-t', '-A', '-F', '\t', '-c', sql];
    const { stdout } = await execFileAsync('psql', args, { env });
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

  async ensureDatabase({ host, port, user, pass, database }) {
    const env = { ...process.env, PGPASSWORD: pass || '' };
    const ident = escPgIdent(database || '');
    await execFileAsync('psql', [
      '-h', String(host), '-p', String(port), '-U', String(user), 'postgres',
      '-c', `CREATE DATABASE "${ident}";`
    ], { env });
  },

  spawnDump({ host, port, user, pass, database, excludeTables }) {
    const dumpArgs = [
      '-h', host, '-p', String(port), '-U', user, '-d', database,
      '--format=p', '--no-owner', '--no-privileges'
    ];
    if (Array.isArray(excludeTables)) {
      for (const t of excludeTables) {
        dumpArgs.push('-T', t);
      }
    }
    return spawn('pg_dump', dumpArgs, { env: { ...process.env, PGPASSWORD: pass } });
  },

  spawnRestore({ host, port, user, pass, database }) {
    const dstArgs = ['-h', host, '-p', String(port), '-U', user, '-d', database];
    return spawn('psql', dstArgs, { env: { ...process.env, PGPASSWORD: pass } });
  }
};

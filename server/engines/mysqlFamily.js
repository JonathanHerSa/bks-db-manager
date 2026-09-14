import { execFile, spawn } from 'child_process';
import { promisify } from 'util';
import { escMysqlSqlStr, escMysqlIdent } from './escaping.js';

const execFileAsync = promisify(execFile);

const IGNORE_DATABASES = ['information_schema', 'performance_schema', 'mysql', 'sys'];

/**
 * Adapter for mysql-wire-compatible engines (MySQL, MariaDB, TiDB). Uses the
 * `mysql`/`mysqldump` CLIs via execFile/spawn (never a shell), password
 * passed through the MYSQL_PWD env var so it never appears in argv or in
 * command-failure error text.
 */
export default {
  id: 'mysql',
  supportsCloneStream: true,
  // Dump output is plain SQL text, so the DEFINER/USE/CREATE-DATABASE
  // sanitizer and email-masking regex in server/index.js are safe to apply.
  textualDumpFormat: true,

  async listDatabases({ host, port, user, pass }) {
    const env = { ...process.env, MYSQL_PWD: pass };
    const args = ['-h', String(host), '-P', String(port), '-u', String(user), '-N', '-s', '-e', 'SHOW DATABASES;'];
    const { stdout } = await execFileAsync('mysql', args, { env });
    return stdout.split('\n').map((s) => s.trim()).filter((s) => s && !IGNORE_DATABASES.includes(s));
  },

  async listTables({ host, port, user, pass, database }) {
    const env = { ...process.env, MYSQL_PWD: pass };
    // NOTE (security): `database` is the mysql CLI's bare positional db_name
    // argument, so it must come after a `--` separator — otherwise a value
    // like "--all-databases" would be parsed as an option instead of a
    // database name, letting a caller escape the intended scope.
    const args = ['-h', String(host), '-P', String(port), '-u', String(user), '-N', '-s', '-e', 'SHOW TABLES;', '--', String(database)];
    const { stdout } = await execFileAsync('mysql', args, { env });
    return stdout.split('\n').map((s) => s.trim()).filter(Boolean);
  },

  async getDatabaseInfo({ host, port, user, pass, database }) {
    const env = { ...process.env, MYSQL_PWD: pass };
    const safeDb = escMysqlSqlStr(database || '');
    const sql = `SELECT ROUND(SUM(data_length + index_length) / (1024 * 1024), 2) AS mb, COUNT(*) AS tables FROM information_schema.TABLES WHERE table_schema='${safeDb}';`;
    const args = ['-h', String(host), '-P', String(port), '-u', String(user), '-N', '-s', '-e', sql];
    const { stdout } = await execFileAsync('mysql', args, { env });
    const parts = stdout.trim().split(/\s+/);
    return { mb: parseFloat(parts[0]) || 0, tables: parseInt(parts[1]) || 0 };
  },

  async inspectSchema({ host, port, user, pass, database }) {
    const env = { ...process.env, MYSQL_PWD: pass };
    const sql = `SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, IFNULL(COLUMN_DEFAULT, 'NULL') FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = '${escMysqlSqlStr(database || '')}' ORDER BY TABLE_NAME, ORDINAL_POSITION;`;
    const args = ['-h', String(host), '-P', String(port), '-u', String(user), '-N', '-s', '-e', sql];
    const { stdout } = await execFileAsync('mysql', args, { env });
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
    const env = { ...process.env, MYSQL_PWD: pass || '' };
    const ident = escMysqlIdent(database || '');
    // NOTE (security): this used to also run `SET GLOBAL max_allowed_packet=...`
    // here. That mutates server-wide state affecting every other connection to
    // the instance (not just this session), requires SUPER/SYSTEM_VARIABLES_ADMIN,
    // and fails outright on managed services like RDS/Aurora. The per-session
    // `--max-allowed-packet=512M` flag already passed to spawnDump/spawnRestore
    // is sufficient, so this only ever needs the idempotent CREATE DATABASE.
    await execFileAsync('mysql', [
      '-h', String(host), '-P', String(port), '-u', String(user),
      '-e', `CREATE DATABASE IF NOT EXISTS \`${ident}\` CHARACTER SET utf8mb4;`
    ], { env });
  },

  spawnDump({ host, port, user, pass, database, excludeTables }) {
    const dumpArgs = [
      `-h${host}`, `-P${port}`, `-u${user}`,
      '--compress',
      '--single-transaction',
      '--quick',
      '--hex-blob',
      '--default-character-set=utf8mb4',
      '--max-allowed-packet=512M',
      '--net-buffer-length=32768',
      '--no-tablespaces',
      '--routines',
      '--triggers'
    ];
    if (Array.isArray(excludeTables)) {
      for (const t of excludeTables) {
        dumpArgs.push(`--ignore-table=${database}.${t}`);
      }
    }
    // NOTE (security): `database` is mysqldump's bare positional db_name
    // argument. It must be the last argv element, after a `--` separator and
    // after every `--ignore-table=` option, so a value like "--all-databases"
    // can never be parsed as a flag instead of a database name.
    dumpArgs.push('--', database);
    return spawn('mysqldump', dumpArgs, { env: { ...process.env, MYSQL_PWD: pass } });
  },

  spawnRestore({ host, port, user, pass, database }) {
    const dstArgs = [
      `-h${host}`,
      `-P${port}`,
      `-u${user}`,
      '--binary-mode',
      '--batch',
      '--default-character-set=utf8mb4',
      '--max-allowed-packet=512M',
      '--init-command=SET SESSION foreign_key_checks=0; SET SESSION unique_checks=0; SET SESSION sql_log_bin=0;',
      '--force',
      '--',
      database
    ];
    return spawn('mysql', dstArgs, { env: { ...process.env, MYSQL_PWD: pass } });
  }
};

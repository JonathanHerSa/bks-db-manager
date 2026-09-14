import { execFile } from 'child_process';
import { promisify } from 'util';
import { escMysqlSqlStr } from './escaping.js';

const execFileAsync = promisify(execFile);

const IGNORE_DATABASES = ['system', 'INFORMATION_SCHEMA', 'information_schema', 'default'];

/**
 * Adapter for ClickHouse. Introspection only — no single pipe-based
 * dump/restore CLI tool ships with ClickHouse (per-table SELECT ... FORMAT
 * Native exports exist, but a whole-database "dump" would need per-table
 * orchestration this project does not attempt to wrap yet).
 *
 * NOTE: `clickhouse-client` speaks the native protocol (default port 9000),
 * while this project's suggested default port for "clickhouse" is 8123 (the
 * HTTP interface, used elsewhere for connUrl display). If the native client
 * can't connect on the configured port, try 9000.
 *
 * NOTE (security): unlike MYSQL_PWD/PGPASSWORD/SQLCMDPASSWORD, there is no
 * verified-reliable env var for the ClickHouse client password across
 * versions, so it is passed via `--password` (still execFile argv, never a
 * shell — no injection risk, but visible to other local processes via `ps`,
 * same inherent CLI-tool limitation as MongoDB).
 */
function baseArgs({ host, port, user }) {
  return ['--host', String(host), '--port', String(port), '--user', String(user)];
}

export default {
  id: 'clickhouse',
  supportsCloneStream: false,

  async listDatabases({ host, port, user, pass }) {
    const args = [...baseArgs({ host, port, user }), '--password', pass || '', '--query', 'SHOW DATABASES'];
    const { stdout } = await execFileAsync('clickhouse-client', args);
    return stdout.split('\n').map((s) => s.trim()).filter((s) => s && !IGNORE_DATABASES.includes(s));
  },

  async listTables({ host, port, user, pass, database }) {
    const args = [...baseArgs({ host, port, user }), '--password', pass || '', '--database', String(database), '--query', 'SHOW TABLES'];
    const { stdout } = await execFileAsync('clickhouse-client', args);
    return stdout.split('\n').map((s) => s.trim()).filter(Boolean);
  },

  async getDatabaseInfo({ host, port, user, pass, database }) {
    const safeDb = escMysqlSqlStr(database || '');
    const sql = `SELECT ROUND(SUM(bytes_on_disk) / (1024 * 1024), 2), COUNT(DISTINCT table) FROM system.parts WHERE database = '${safeDb}' AND active`;
    const args = [...baseArgs({ host, port, user }), '--password', pass || '', '--query', sql];
    const { stdout } = await execFileAsync('clickhouse-client', args);
    const parts = stdout.trim().split(/\s+/).filter(Boolean);
    return { mb: parseFloat(parts[0]) || 0, tables: parseInt(parts[1]) || 0 };
  },

  async inspectSchema({ host, port, user, pass, database }) {
    const safeDb = escMysqlSqlStr(database || '');
    const sql = `SELECT table, name, type, 'YES', ifNull(default_expression, 'NULL') FROM system.columns WHERE database = '${safeDb}' ORDER BY table, position FORMAT TSV`;
    const args = [...baseArgs({ host, port, user }), '--password', pass || '', '--query', sql];
    const { stdout } = await execFileAsync('clickhouse-client', args);
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
  }
};

import { execFile } from 'child_process';
import { promisify } from 'util';
import { escSqlStr } from './escaping.js';

const execFileAsync = promisify(execFile);

/**
 * Adapter for SQL Server. Introspection only (see supportsCloneStream=false
 * in shared/dbEngines.js CLONE_STREAM_ENGINES) — there is no single `sqlcmd`
 * pipe-based dump/restore tool equivalent to mysqldump|mysql; a real backup
 * needs BACPAC/bcp tooling this project does not attempt to wrap.
 *
 * `sqlcmd` reads the password from the SQLCMDPASSWORD env var, avoiding
 * argv exposure (same rationale as MYSQL_PWD/PGPASSWORD).
 */
function baseArgs({ host, port, user, database }) {
  const args = ['-S', `${host},${port}`, '-U', String(user), '-h', '-1', '-W'];
  if (database) args.push('-d', String(database));
  return args;
}

function runEnv(pass) {
  return { ...process.env, SQLCMDPASSWORD: pass || '' };
}

export default {
  id: 'sqlserver',
  supportsCloneStream: false,

  async listDatabases({ host, port, user, pass }) {
    const args = [...baseArgs({ host, port, user }), '-Q', 'SET NOCOUNT ON; SELECT name FROM sys.databases WHERE database_id > 4;'];
    const { stdout } = await execFileAsync('sqlcmd', args, { env: runEnv(pass) });
    return stdout.split('\n').map((s) => s.trim()).filter(Boolean);
  },

  async listTables({ host, port, user, pass, database }) {
    const args = [...baseArgs({ host, port, user, database }), '-Q', "SET NOCOUNT ON; SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_TYPE='BASE TABLE';"];
    const { stdout } = await execFileAsync('sqlcmd', args, { env: runEnv(pass) });
    return stdout.split('\n').map((s) => s.trim()).filter(Boolean);
  },

  async getDatabaseInfo({ host, port, user, pass, database }) {
    const safeDb = escSqlStr(database || '');
    const sql = `SET NOCOUNT ON; SELECT CAST(ROUND(SUM(CAST(size AS BIGINT)) * 8.0 / 1024, 2) AS DECIMAL(10,2)) FROM sys.master_files WHERE database_id = DB_ID('${safeDb}'); SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_TYPE='BASE TABLE';`;
    const args = [...baseArgs({ host, port, user, database }), '-Q', sql];
    const { stdout } = await execFileAsync('sqlcmd', args, { env: runEnv(pass) });
    const parts = stdout.trim().split(/\s+/).filter(Boolean);
    return { mb: parseFloat(parts[0]) || 0, tables: parseInt(parts[1]) || 0 };
  },

  async inspectSchema({ host, port, user, pass, database }) {
    const sql = "SET NOCOUNT ON; SELECT TABLE_NAME + '\t' + COLUMN_NAME + '\t' + DATA_TYPE + '\t' + IS_NULLABLE + '\t' + ISNULL(COLUMN_DEFAULT, 'NULL') FROM INFORMATION_SCHEMA.COLUMNS ORDER BY TABLE_NAME, ORDINAL_POSITION;";
    const args = [...baseArgs({ host, port, user, database }), '-Q', sql];
    const { stdout } = await execFileAsync('sqlcmd', args, { env: runEnv(pass) });
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

  // No ensureDatabase/spawnDump/spawnRestore: clone streaming isn't offered
  // for this engine (see supportsCloneStream above). server/index.js checks
  // supportsCloneStream before calling those, so their absence here is safe.
};

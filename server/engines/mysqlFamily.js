import crypto from 'crypto';
import { execFile, spawn } from 'child_process';
import { promisify } from 'util';
import { escMysqlSqlStr, escMysqlIdent } from './escaping.js';

const execFileAsync = promisify(execFile);

const IGNORE_DATABASES = ['information_schema', 'performance_schema', 'mysql', 'sys'];

function baseArgs({ host, port, user }) {
  return ['-h', String(host), '-P', String(port), '-u', String(user)];
}

function runEnv(pass) {
  return { ...process.env, MYSQL_PWD: pass || '' };
}

function safeColumn(name) {
  return typeof name === 'string' && /^[A-Za-z0-9_]+$/.test(name);
}

function numericLiteral(value) {
  const text = String(value);
  if (!/^-?\d+$/.test(text)) {
    throw new Error('La clave de sincronización incremental debe ser un entero.');
  }
  return text;
}

function quoteIdent(name) {
  return `\`${String(name).replace(/`/g, '``')}\``;
}

function chunk(list, size) {
  const chunks = [];
  for (let i = 0; i < list.length; i += size) chunks.push(list.slice(i, i + size));
  return chunks;
}

function hashLines(lines) {
  return crypto.createHash('sha256').update(lines.join('\n')).digest('hex');
}

/**
 * Slow fallback: read every row of the table. Only used when Performance
 * Schema has no counter row for a table (disabled instrumentation, no SELECT
 * grant, never-accessed table, etc.).
 */
/**
 * Fast fallback when Performance Schema is OFF or inaccessible: InnoDB's
 * persistent stats + information_schema metadata. It does not read table data,
 * but it is a heuristic (a small UPDATE may not move last_update), so the UI
 * offers an explicit full-checksum verification mode.
 */
async function metadataTableFingerprints({ host, port, user, pass, database }, tables = []) {
  const env = runEnv(pass);
  const safeDb = escMysqlSqlStr(database || '');
  const wanted = new Set(tables);
  let stdout;

  try {
    const sql = `SELECT t.TABLE_NAME,
        IFNULL(t.AUTO_INCREMENT, ''),
        IFNULL(t.TABLE_ROWS, 0),
        IFNULL(t.DATA_LENGTH, 0),
        IFNULL(t.INDEX_LENGTH, 0),
        IFNULL(s.last_update, '')
      FROM information_schema.TABLES t
      LEFT JOIN mysql.innodb_table_stats s
        ON s.database_name = t.TABLE_SCHEMA AND s.table_name = t.TABLE_NAME
      WHERE t.TABLE_SCHEMA = '${safeDb}' AND t.TABLE_TYPE = 'BASE TABLE';`;
    const result = await execFileAsync('mysql', [
      ...baseArgs({ host, port, user }), '-N', '-s', '-e', sql
    ], { env });
    stdout = result.stdout;
  } catch {
    // No access to mysql.innodb_table_stats: keep the information_schema-only
    // metadata (still cheap, weaker update detection).
    const sql = `SELECT TABLE_NAME,
        IFNULL(AUTO_INCREMENT, ''),
        IFNULL(TABLE_ROWS, 0),
        IFNULL(DATA_LENGTH, 0),
        IFNULL(INDEX_LENGTH, 0)
      FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = '${safeDb}' AND TABLE_TYPE = 'BASE TABLE';`;
    const result = await execFileAsync('mysql', [
      ...baseArgs({ host, port, user }), '-N', '-s', '-e', sql
    ], { env });
    stdout = result.stdout;
  }

  const fingerprints = {};
  for (const line of stdout.split('\n')) {
    if (!line.trim()) continue;
    const [name, autoIncrement, tableRows, dataLength, indexLength, lastUpdate] = line.split('\t');
    if (!wanted.has(name)) continue;
    fingerprints[name] = {
      token: `meta:${autoIncrement}:${tableRows}:${dataLength}:${indexLength}:${lastUpdate || ''}`,
      rows: null
    };
  }
  for (const table of tables) {
    if (!fingerprints[table]) fingerprints[table] = { token: null, rows: null };
  }
  return fingerprints;
}

async function checksumTableFingerprints({ host, port, user, pass, database }, tables = []) {
  const env = runEnv(pass);
  const db = quoteIdent(database);
  const result = {};
  for (const batch of chunk(tables, 40)) {
    // CHECKSUM TABLE needs qualified names: the mysql CLI connection used
    // here has no default database selected.
    const list = batch.map((table) => `${db}.${quoteIdent(table)}`).join(', ');
    const sql = `CHECKSUM TABLE ${list};`;
    const { stdout } = await execFileAsync('mysql', [
      ...baseArgs({ host, port, user }), '-N', '-s', '-e', sql
    ], { env });
    for (const line of stdout.split('\n')) {
      if (!line.trim()) continue;
      const [qualified, checksum] = line.split('\t');
      const prefix = `${database}.`;
      const table = String(qualified).startsWith(prefix)
        ? String(qualified).slice(prefix.length)
        : qualified;
      result[table] = {
        token: checksum === 'NULL' ? null : checksum,
        rows: null
      };
    }
  }
  for (const table of tables) {
    if (!result[table]) result[table] = { token: null, rows: null };
  }
  return result;
}

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
  // Append dumps are INSERT statements, so the SQL sanitizer is safe.
  appendFormat: 'sql',

  syncCapabilities() {
    return {
      // Primary fingerprint: Performance Schema write counters + metadata.
      // CHECKSUM TABLE is only a fallback for tables with no counter row.
      fingerprint: 'stats',
      appendOnlyByKey: true,
      parallelTableDump: true,
      cdc: 'binlog'
    };
  },

  async listDatabases({ host, port, user, pass }) {
    const env = runEnv(pass);
    const args = ['-h', String(host), '-P', String(port), '-u', String(user), '-N', '-s', '-e', 'SHOW DATABASES;'];
    const { stdout } = await execFileAsync('mysql', args, { env });
    return stdout.split('\n').map((s) => s.trim()).filter((s) => s && !IGNORE_DATABASES.includes(s));
  },

  async listTables({ host, port, user, pass, database }) {
    const env = runEnv(pass);
    // NOTE (security): `database` is the mysql CLI's bare positional db_name
    // argument, so it must come after a `--` separator — otherwise a value
    // like "--all-databases" would be parsed as an option instead of a
    // database name, letting a caller escape the intended scope.
    const args = ['-h', String(host), '-P', String(port), '-u', String(user), '-N', '-s', '-e', 'SHOW TABLES;', '--', String(database)];
    const { stdout } = await execFileAsync('mysql', args, { env });
    return stdout.split('\n').map((s) => s.trim()).filter(Boolean);
  },

  async getDatabaseInfo({ host, port, user, pass, database }) {
    const env = runEnv(pass);
    const safeDb = escMysqlSqlStr(database || '');
    const sql = `SELECT ROUND(SUM(data_length + index_length) / (1024 * 1024), 2) AS mb, COUNT(*) AS tables FROM information_schema.TABLES WHERE table_schema='${safeDb}';`;
    const args = ['-h', String(host), '-P', String(port), '-u', String(user), '-N', '-s', '-e', sql];
    const { stdout } = await execFileAsync('mysql', args, { env });
    const parts = stdout.trim().split(/\s+/);
    return { mb: parseFloat(parts[0]) || 0, tables: parseInt(parts[1]) || 0 };
  },

  async inspectSchema({ host, port, user, pass, database }) {
    const env = runEnv(pass);
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

  async ensureDatabase({ host, port, user, pass, database, cleanDest = false }) {
    const env = runEnv(pass);
    const ident = escMysqlIdent(database || '');
    // NOTE (security): this used to also run `SET GLOBAL max_allowed_packet=...`
    // here. That mutates server-wide state affecting every other connection to
    // the instance (not just this session), requires SUPER/SYSTEM_VARIABLES_ADMIN,
    // and fails outright on managed services like RDS/Aurora. The per-session
    // `--max-allowed-packet=512M` flag already passed to spawnDump/spawnRestore
    // is sufficient, so this only ever needs the idempotent CREATE DATABASE.
    const sql = cleanDest
      ? `DROP DATABASE IF EXISTS \`${ident}\`; CREATE DATABASE \`${ident}\` CHARACTER SET utf8mb4;`
      : `CREATE DATABASE IF NOT EXISTS \`${ident}\` CHARACTER SET utf8mb4;`;
    await execFileAsync('mysql', [
      '-h', String(host), '-P', String(port), '-u', String(user),
      '-e', sql
    ], { env });
  },

  // ---------------------------------------------------------------------
  // Incremental sync primitives
  // ---------------------------------------------------------------------

  async getServerIdentity({ host, port, user, pass }) {
    const env = runEnv(pass);
    const args = [...baseArgs({ host, port, user }), '-N', '-s', '-e', 'SELECT @@server_uuid, VERSION();'];
    try {
      const { stdout } = await execFileAsync('mysql', args, { env });
      const [serverUuid, version] = stdout.trim().split('\t');
      return { serverUuid: serverUuid || null, version: version || null };
    } catch {
      // MariaDB has no @@server_uuid; fall back to server_id (not globally
      // unique, but combined with host/port/db it is stable enough to detect
      // a replaced server).
      const fallback = await execFileAsync('mysql', [
        ...baseArgs({ host, port, user }), '-N', '-s', '-e', 'SELECT @@server_id, VERSION();'
      ], { env });
      const [serverId, version] = fallback.stdout.trim().split('\t');
      return { serverUuid: serverId ? `server-id:${serverId}` : null, version: version || null };
    }
  },

  async listTablesWithMeta({ host, port, user, pass, database }) {
    const env = runEnv(pass);
    const safeDb = escMysqlSqlStr(database || '');
    const tablesSql = `SELECT TABLE_NAME, TABLE_TYPE, ENGINE, TABLE_COLLATION, TABLE_ROWS, DATA_LENGTH, INDEX_LENGTH FROM information_schema.TABLES WHERE TABLE_SCHEMA='${safeDb}' ORDER BY TABLE_NAME;`;
    const { stdout } = await execFileAsync('mysql', [
      ...baseArgs({ host, port, user }), '-N', '-s', '-e', tablesSql
    ], { env });

    const tables = [];
    for (const line of stdout.split('\n')) {
      if (!line.trim()) continue;
      const [name, tableType, engine, collation, rows, dataLength, indexLength] = line.split('\t');
      tables.push({
        name,
        type: tableType === 'VIEW' ? 'view' : 'table',
        engine: engine || null,
        collation: collation || null,
        rows: parseInt(rows, 10) || 0,
        bytes: (parseInt(dataLength, 10) || 0) + (parseInt(indexLength, 10) || 0),
        primaryKey: null,
        primaryKeyType: null,
        autoIncrement: false
      });
    }

    const pkSql = `SELECT s.TABLE_NAME, s.COLUMN_NAME, s.SEQ_IN_INDEX, c.DATA_TYPE, c.EXTRA
      FROM information_schema.STATISTICS s
      JOIN information_schema.COLUMNS c
        ON c.TABLE_SCHEMA = s.TABLE_SCHEMA
       AND c.TABLE_NAME = s.TABLE_NAME
       AND c.COLUMN_NAME = s.COLUMN_NAME
      WHERE s.TABLE_SCHEMA='${safeDb}' AND s.INDEX_NAME='PRIMARY'
      ORDER BY s.TABLE_NAME, s.SEQ_IN_INDEX;`;
    const pkResult = await execFileAsync('mysql', [
      ...baseArgs({ host, port, user }), '-N', '-s', '-e', pkSql
    ], { env });

    const pkByTable = new Map();
    for (const line of pkResult.stdout.split('\n')) {
      if (!line.trim()) continue;
      const [table, column, seq, dataType, extra] = line.split('\t');
      const entry = pkByTable.get(table) || [];
      entry.push({ column, seq: parseInt(seq, 10) || 0, dataType, extra: extra || '' });
      pkByTable.set(table, entry);
    }

    for (const table of tables) {
      const pk = pkByTable.get(table.name);
      // Composite primary keys are deliberately not treated as append-only
      // candidates: a single monotonic key is required for `key > lastMax`.
      if (pk && pk.length === 1 && pk[0].seq === 1) {
        table.primaryKey = pk[0].column;
        table.primaryKeyType = pk[0].dataType;
        table.autoIncrement = pk[0].extra.includes('auto_increment');
      }
    }

    return tables;
  },

  async getTableSchemaHashes({ host, port, user, pass, database }, tables = []) {
    const env = runEnv(pass);
    const safeDb = escMysqlSqlStr(database || '');
    const wanted = new Set(tables);
    const byTable = new Map();
    const linesFor = (name) => {
      if (!byTable.has(name)) byTable.set(name, []);
      return byTable.get(name);
    };

    // Defaults, generated expressions, trigger bodies and view definitions can
    // contain tabs/newlines; flatten them so the tab-separated CLI output
    // cannot shift columns and produce a bogus hash.
    const tableOptionsSql = `SELECT TABLE_NAME, IFNULL(ENGINE, ''), IFNULL(TABLE_COLLATION, '')
      FROM information_schema.TABLES WHERE TABLE_SCHEMA='${safeDb}' ORDER BY TABLE_NAME;`;
    const tableOptions = await execFileAsync('mysql', [
      ...baseArgs({ host, port, user }), '-N', '-s', '-e', tableOptionsSql
    ], { env });
    for (const line of tableOptions.stdout.split('\n')) {
      if (!line.trim()) continue;
      const [table, engine, collation] = line.split('\t');
      if (!wanted.has(table)) continue;
      linesFor(table).push(`tbl:${engine}:${collation}`);
    }

    const columnsSql = `SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE,
        REPLACE(REPLACE(IFNULL(COLUMN_DEFAULT, 'NULL'), CHAR(9), ' '), CHAR(10), ' '),
        EXTRA, IFNULL(COLLATION_NAME, ''),
        REPLACE(REPLACE(IFNULL(GENERATION_EXPRESSION, ''), CHAR(9), ' '), CHAR(10), ' ')
      FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='${safeDb}' ORDER BY TABLE_NAME, ORDINAL_POSITION;`;
    const columns = await execFileAsync('mysql', [
      ...baseArgs({ host, port, user }), '-N', '-s', '-e', columnsSql
    ], { env });
    for (const line of columns.stdout.split('\n')) {
      if (!line.trim()) continue;
      const parts = line.split('\t');
      const [table, column, type, nullable, defaultValue, extra, collation, generation] = parts;
      if (!wanted.has(table)) continue;
      linesFor(table).push(`col:${column}:${type}:${nullable}:${defaultValue}:${extra}:${collation}:${generation}`);
    }

    const indexesSql = `SELECT TABLE_NAME, INDEX_NAME, NON_UNIQUE, SEQ_IN_INDEX, COLUMN_NAME, IFNULL(SUB_PART, ''), INDEX_TYPE
      FROM information_schema.STATISTICS WHERE TABLE_SCHEMA='${safeDb}' ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX;`;
    const indexes = await execFileAsync('mysql', [
      ...baseArgs({ host, port, user }), '-N', '-s', '-e', indexesSql
    ], { env });
    for (const line of indexes.stdout.split('\n')) {
      if (!line.trim()) continue;
      const parts = line.split('\t');
      const [table, index, nonUnique, seq, column, subPart, indexType] = parts;
      if (!wanted.has(table)) continue;
      linesFor(table).push(`idx:${index}:${nonUnique}:${seq}:${column}:${subPart}:${indexType}`);
    }

    const triggersSql = `SELECT EVENT_OBJECT_TABLE, TRIGGER_NAME, ACTION_TIMING, EVENT_MANIPULATION,
        REPLACE(REPLACE(ACTION_STATEMENT, CHAR(9), ' '), CHAR(10), ' ')
      FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA='${safeDb}' ORDER BY EVENT_OBJECT_TABLE, TRIGGER_NAME;`;
    const triggers = await execFileAsync('mysql', [
      ...baseArgs({ host, port, user }), '-N', '-s', '-e', triggersSql
    ], { env });
    for (const line of triggers.stdout.split('\n')) {
      if (!line.trim()) continue;
      const parts = line.split('\t');
      const [table, trigger, timing, event, statement] = parts;
      if (!wanted.has(table)) continue;
      linesFor(table).push(`trg:${trigger}:${timing}:${event}:${statement}`);
    }

    const viewsSql = `SELECT TABLE_NAME,
        REPLACE(REPLACE(IFNULL(VIEW_DEFINITION, ''), CHAR(9), ' '), CHAR(10), ' ')
      FROM information_schema.VIEWS WHERE TABLE_SCHEMA='${safeDb}' ORDER BY TABLE_NAME;`;
    const views = await execFileAsync('mysql', [
      ...baseArgs({ host, port, user }), '-N', '-s', '-e', viewsSql
    ], { env });
    for (const line of views.stdout.split('\n')) {
      if (!line.trim()) continue;
      const parts = line.split('\t');
      const [table, definition] = parts;
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
    const env = runEnv(pass);
    const safeDb = escMysqlSqlStr(database || '');
    const wanted = new Set(tables);
    let stdout;

    // Cheap path: per-table write counters from Performance Schema plus the
    // auto-increment/update metadata. This is O(number of tables), not
    // O(table size), so a 14 GiB database is analyzed in the same time as a
    // 14 MB one.
    try {
      const sql = `SELECT t.TABLE_NAME,
          IFNULL(t.AUTO_INCREMENT, ''),
          IFNULL(t.UPDATE_TIME, ''),
          p.COUNT_WRITE, p.COUNT_INSERT, p.COUNT_UPDATE, p.COUNT_DELETE
        FROM information_schema.TABLES t
        LEFT JOIN performance_schema.table_io_waits_summary_by_table p
          ON p.OBJECT_SCHEMA = t.TABLE_SCHEMA
         AND p.OBJECT_NAME = t.TABLE_NAME
         AND p.OBJECT_TYPE = 'TABLE'
        WHERE t.TABLE_SCHEMA = '${safeDb}' AND t.TABLE_TYPE = 'BASE TABLE';`;
      const result = await execFileAsync('mysql', [
        ...baseArgs({ host, port, user }), '-N', '-s', '-e', sql
      ], { env });
      stdout = result.stdout;
    } catch {
      // Performance Schema unavailable (disabled, no SELECT grant, MariaDB
      // without instrumentation, etc.): use InnoDB metadata instead of
      // reading the table data. The UI warns that this mode is heuristic and
      // offers an explicit full-checksum verification.
      this.lastFingerprintMode = 'metadata';
      return metadataTableFingerprints({ host, port, user, pass, database }, tables);
    }
    this.lastFingerprintMode = 'stats';

    const fingerprints = {};
    const missing = [];
    for (const line of stdout.split('\n')) {
      if (!line.trim()) continue;
      const [
        name,
        autoIncrement,
        updateTime,
        countWrite,
        countInsert,
        countUpdate,
        countDelete
      ] = line.split('\t');
      if (!wanted.has(name)) continue;
      if (countWrite === 'NULL' || countWrite === undefined) {
        // No counter row for this table (never accessed or instrumentation
        // disabled): use metadata for it instead of scanning the table.
        missing.push(name);
        continue;
      }
      fingerprints[name] = {
        token: `ps:${countWrite}:${countInsert}:${countUpdate}:${countDelete}:${autoIncrement}:${updateTime}`,
        rows: null
      };
    }

    if (missing.length > 0) {
      const fallback = await metadataTableFingerprints(
        { host, port, user, pass, database },
        missing
      );
      Object.assign(fingerprints, fallback);
      // PS is off (or has no rows for these tables): the result is a fast but
      // heuristic metadata comparison. The UI warns and offers full checksums.
      this.lastFingerprintMode = missing.length === tables.length ? 'metadata' : 'mixed';
    }

    for (const table of tables) {
      if (!fingerprints[table]) fingerprints[table] = { token: null, rows: null };
    }
    return fingerprints;
  },

  async getTableChecksums({ host, port, user, pass, database }, tables = []) {
    // Explicit "full verification" mode: exact but reads every row.
    this.lastFingerprintMode = 'checksum';
    return checksumTableFingerprints({ host, port, user, pass, database }, tables);
  },

  async getTableAppendStates({ host, port, user, pass, database }, tables = []) {
    const env = runEnv(pass);
    const result = {};
    for (const { table, column } of tables) {
      if (!safeColumn(column)) continue;
      const sql = `SELECT COUNT(*), MAX(${quoteIdent(column)}) FROM ${quoteIdent(database)}.${quoteIdent(table)};`;
      const { stdout } = await execFileAsync('mysql', [
        ...baseArgs({ host, port, user }), '-N', '-s', '-e', sql
      ], { env });
      const [rows, maxKey] = stdout.trim().split('\t');
      result[table] = {
        rows: parseInt(rows, 10) || 0,
        maxKey: maxKey === 'NULL' || maxKey === undefined ? null : maxKey
      };
    }
    return result;
  },

  async countRowsAfterKey({ host, port, user, pass, database }, table, column, value) {
    if (!safeColumn(column)) throw new Error('Columna de clave inválida.');
    const env = runEnv(pass);
    const sql = `SELECT COUNT(*) FROM ${quoteIdent(database)}.${quoteIdent(table)} WHERE ${quoteIdent(column)} > ${numericLiteral(value)};`;
    const { stdout } = await execFileAsync('mysql', [
      ...baseArgs({ host, port, user }), '-N', '-s', '-e', sql
    ], { env });
    return parseInt(stdout.trim(), 10) || 0;
  },

  async getTableRowCount({ host, port, user, pass, database }, table) {
    const env = runEnv(pass);
    const sql = `SELECT COUNT(*) FROM ${quoteIdent(database)}.${quoteIdent(table)};`;
    const { stdout } = await execFileAsync('mysql', [
      ...baseArgs({ host, port, user }), '-N', '-s', '-e', sql
    ], { env });
    return parseInt(stdout.trim(), 10) || 0;
  },

  async dropTable({ host, port, user, pass, database }, table, { view = false } = {}) {
    const env = runEnv(pass);
    const keyword = view ? 'VIEW' : 'TABLE';
    const sql = `DROP ${keyword} IF EXISTS ${quoteIdent(database)}.${quoteIdent(table)};`;
    await execFileAsync('mysql', [
      ...baseArgs({ host, port, user }), '-e', sql
    ], { env });
  },

  async getCdcCapabilities({ host, port, user, pass }) {
    const env = runEnv(pass);
    const varsSql = "SHOW VARIABLES WHERE Variable_name IN ('log_bin','binlog_format','binlog_row_image','gtid_mode','binlog_expire_logs_seconds');";
    const { stdout } = await execFileAsync('mysql', [
      ...baseArgs({ host, port, user }), '-N', '-s', '-e', varsSql
    ], { env });

    const vars = {};
    for (const line of stdout.split('\n')) {
      if (!line.trim()) continue;
      const [name, value] = line.split('\t');
      vars[name] = value;
    }

    // mysqlbinlog must match the source flavor: MariaDB's binary cannot parse
    // MySQL 8.x binlogs and vice versa.
    let mysqlbinlogFlavor = null;
    try {
      const binlogVersion = await execFileAsync('mysqlbinlog', ['--version']);
      mysqlbinlogFlavor = /mariadb/i.test(binlogVersion.stdout) ? 'mariadb' : 'mysql';
    } catch {
      return {
        available: false,
        engine: 'binlog',
        reason: 'mysqlbinlog no está instalado en el equipo del companion.'
      };
    }

    const { stdout: versionOut } = await execFileAsync('mysql', [
      ...baseArgs({ host, port, user }), '-N', '-s', '-e', 'SELECT VERSION();'
    ], { env });
    const sourceVersion = versionOut.trim();
    const sourceFlavor = /mariadb/i.test(sourceVersion) ? 'mariadb' : 'mysql';
    if (sourceFlavor !== mysqlbinlogFlavor) {
      return {
        available: false,
        engine: 'binlog',
        reason: `El origen es ${sourceFlavor} (${sourceVersion}) y el mysqlbinlog instalado es de ${mysqlbinlogFlavor}; deben coincidir para leer el binlog.`
      };
    }
    this._mysqlbinlogFlavor = mysqlbinlogFlavor;

    if (String(vars.log_bin).toUpperCase() !== 'ON') {
      return { available: false, engine: 'binlog', reason: 'El binlog no está habilitado en el origen.' };
    }
    if (String(vars.binlog_format).toUpperCase() !== 'ROW') {
      return { available: false, engine: 'binlog', reason: `binlog_format=${vars.binlog_format}; se requiere ROW.` };
    }
    if (String(vars.binlog_row_image).toUpperCase() !== 'FULL') {
      return { available: false, engine: 'binlog', reason: `binlog_row_image=${vars.binlog_row_image}; se requiere FULL.` };
    }

    let position = null;
    try {
      const status = await execFileAsync('mysql', [
        ...baseArgs({ host, port, user }), '-N', '-s', '-e', 'SHOW MASTER STATUS;'
      ], { env });
      const line = status.stdout.split('\n').find((item) => item.trim());
      if (line) {
        const [file, pos, , , gtid] = line.split('\t');
        position = { file, position: parseInt(pos, 10) || 0, gtid: gtid || null };
      }
    } catch {
      // MySQL 8.4 renamed the statement; fall back to the new name.
      try {
        const status = await execFileAsync('mysql', [
          ...baseArgs({ host, port, user }), '-N', '-s', '-e', 'SHOW BINARY LOG STATUS;'
        ], { env });
        const line = status.stdout.split('\n').find((item) => item.trim());
        if (line) {
          const [file, pos, , , gtid] = line.split('\t');
          position = { file, position: parseInt(pos, 10) || 0, gtid: gtid || null };
        }
      } catch {}
    }

    if (!position) {
      return { available: false, engine: 'binlog', reason: 'El origen no expone una posición de binlog (¿es un replica?).' };
    }

    let binlogs = [];
    try {
      const logs = await execFileAsync('mysql', [
        ...baseArgs({ host, port, user }), '-N', '-s', '-e', 'SHOW BINARY LOGS;'
      ], { env });
      binlogs = logs.stdout.split('\n')
        .map((line) => line.split('\t')[0]?.trim())
        .filter(Boolean);
    } catch {
      // Replay will still work for the single-file case; the command builder
      // falls back to [from.file, to.file] when no list is available.
    }

    return {
      available: true,
      engine: 'binlog',
      format: vars.binlog_format,
      rowImage: vars.binlog_row_image,
      gtidMode: vars.gtid_mode,
      retentionSeconds: parseInt(vars.binlog_expire_logs_seconds, 10) || null,
      mysqlbinlogFlavor,
      position,
      binlogs
    };
  },

  spawnCdcReplay({ host, port, user, pass, database }, { from, to, binlogs = [] }) {
    if (!from?.file || !to?.file) throw new Error('Posición de binlog incompleta.');
    const env = runEnv(pass);

    // Include every binlog file between the stored position and the current
    // one. If the server did not expose the list, fall back to the two known
    // endpoints (works when both positions are in the same file or adjacent
    // files).
    let files = [String(from.file), String(to.file)];
    if (Array.isArray(binlogs) && binlogs.length > 0) {
      const startIndex = binlogs.indexOf(from.file);
      const endIndex = binlogs.indexOf(to.file);
      if (startIndex >= 0 && endIndex >= startIndex) {
        files = binlogs.slice(startIndex, endIndex + 1);
      }
    }
    // mysqlbinlog processes the same file twice if it appears twice in argv,
    // which would replay every event in it twice.
    if (files.length > 1 && files[0] === files[files.length - 1]) {
      files = [files[0]];
    }

    const args = [
      '--read-from-remote-server',
      '--host', String(host),
      '--port', String(port),
      '--user', String(user)
    ];
    // MySQL's mysqlbinlog supports --skip-gtids; MariaDB's does not.
    if (this._mysqlbinlogFlavor !== 'mariadb') args.push('--skip-gtids');
    // Filter out events from other databases on the same instance. The
    // destination must use the same database name (enforced by the planner).
    args.push('--database', String(database), '--start-position', String(from.position || 4));
    if (to.position) args.push('--stop-position', String(to.position));
    args.push(...files);
    return spawn('mysqlbinlog', args, { env });
  },

  // ---------------------------------------------------------------------
  // Full-database and single-table dump/restore
  // ---------------------------------------------------------------------

  spawnDump({ host, port, user, pass, database, excludeTables }) {
    const dumpArgs = [
      `-h${host}`, `-P${port}`, `-u${user}`,
      '--single-transaction',
      '--quick',
      '--hex-blob',
      '--default-character-set=utf8mb4',
      '--max-allowed-packet=512M',
      '--net-buffer-length=1048576',
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

  spawnTableDump({ host, port, user, pass, database }, { table, dataOnly = false, keyColumn = null, keyAfter = null } = {}) {
    const dumpArgs = [
      `-h${host}`, `-P${port}`, `-u${user}`,
      '--single-transaction',
      '--quick',
      '--hex-blob',
      '--default-character-set=utf8mb4',
      '--max-allowed-packet=512M',
      '--net-buffer-length=1048576',
      '--no-tablespaces',
      '--triggers'
    ];
    if (dataOnly) {
      dumpArgs.push('--no-create-info', '--skip-triggers', '--skip-add-drop-table', '--skip-add-locks');
      if (keyColumn && keyAfter !== null && keyAfter !== undefined) {
        if (!safeColumn(keyColumn)) throw new Error('Columna de clave inválida.');
        dumpArgs.push(`--where=${quoteIdent(keyColumn)} > ${numericLiteral(keyAfter)}`);
      }
    }
    dumpArgs.push('--', String(database), String(table));
    return spawn('mysqldump', dumpArgs, { env: { ...process.env, MYSQL_PWD: pass } });
  },

  spawnRestore({ host, port, user, pass, database }, options = {}) {
    const dstArgs = [
      `-h${host}`,
      `-P${port}`,
      `-u${user}`,
      '--binary-mode',
      '--batch',
      '--default-character-set=utf8mb4',
      '--max-allowed-packet=512M',
      '--init-command=SET SESSION autocommit=0; SET SESSION foreign_key_checks=0; SET SESSION unique_checks=0; SET SESSION sql_log_bin=0;',
      '--',
      database
    ];
    // CDC replay and incremental appends must fail loudly on the first
    // conflict: `--force` would keep going and silently diverge the copy.
    if (!options.strict) dstArgs.splice(dstArgs.length - 2, 0, '--force');
    return spawn('mysql', dstArgs, { env: { ...process.env, MYSQL_PWD: pass } });
  },

  spawnTableRestore(params, options = {}) {
    return this.spawnRestore(params, options);
  }
};

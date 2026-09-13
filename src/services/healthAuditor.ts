import { executeQuery, isSafeIdentifier } from './beekeeper';

export interface HealthReport {
  database: string;
  dialect: 'mysql' | 'postgres';
  score: number;
  tablesWithoutPk: string[];
  duplicateIndexes: Array<{
    table: string;
    index1: string;
    index2: string;
    columns: string;
    reason: string;
  }>;
  storageBreakdown: Array<{
    table: string;
    rows: number;
    dataSizeMb: number;
    indexSizeMb: number;
    totalSizeMb: number;
  }>;
  totalSizeMb: number;
  longRunningQueriesCount: number;
  summary: {
    totalTables: number;
    healthyTablesCount: number;
    issuesCount: number;
  };
}

export interface ProcessItem {
  id: number;
  user: string;
  host: string;
  db: string;
  command: string;
  time: number;
  state: string;
  info: string;
}

export function calculateHealthScore(
  tablesWithoutPkCount: number,
  duplicateIndexesCount: number,
  longRunningCount: number
): number {
  let score = 100;
  score -= Math.min(tablesWithoutPkCount * 15, 60);
  score -= Math.min(duplicateIndexesCount * 5, 25);
  score -= Math.min(longRunningCount * 10, 15);
  return Math.max(0, score);
}

export function detectDuplicateIndexes(
  rawIndexes: Array<{ table: string; indexName: string; columns: string }>
): Array<{ table: string; index1: string; index2: string; columns: string; reason: string }> {
  const duplicates: Array<{ table: string; index1: string; index2: string; columns: string; reason: string }> = [];
  const byTable = new Map<string, Array<{ indexName: string; columns: string }>>();

  for (const idx of rawIndexes) {
    if (!byTable.has(idx.table)) {
      byTable.set(idx.table, []);
    }
    byTable.get(idx.table)!.push(idx);
  }

  for (const [table, indexes] of byTable.entries()) {
    for (let i = 0; i < indexes.length; i++) {
      for (let j = i + 1; j < indexes.length; j++) {
        const idx1 = indexes[i];
        const idx2 = indexes[j];
        if (idx1.indexName.toLowerCase() === idx2.indexName.toLowerCase()) continue;

        const cols1 = idx1.columns.toLowerCase();
        const cols2 = idx2.columns.toLowerCase();

        if (cols1 === cols2) {
          duplicates.push({
            table,
            index1: idx1.indexName,
            index2: idx2.indexName,
            columns: idx1.columns,
            reason: 'Índices exactamente duplicados con las mismas columnas'
          });
        } else if (cols1.startsWith(cols2 + ',') || cols1 === cols2) {
          duplicates.push({
            table,
            index1: idx1.indexName,
            index2: idx2.indexName,
            columns: idx2.columns,
            reason: `El índice '${idx2.indexName}' es un prefijo redundante de '${idx1.indexName}'`
          });
        } else if (cols2.startsWith(cols1 + ',') || cols2 === cols1) {
          duplicates.push({
            table,
            index1: idx2.indexName,
            index2: idx1.indexName,
            columns: idx1.columns,
            reason: `El índice '${idx1.indexName}' es un prefijo redundante de '${idx2.indexName}'`
          });
        }
      }
    }
  }

  return duplicates;
}

export async function auditHealth(
  dbName: string,
  dialect: 'mysql' | 'postgres' = 'mysql'
): Promise<HealthReport> {
  if (!isSafeIdentifier(dbName)) {
    throw new Error(`Nombre de base de datos no seguro: ${dbName}`);
  }

  const tablesWithoutPk: string[] = [];
  let rawIndexes: Array<{ table: string; indexName: string; columns: string }> = [];
  const storageBreakdown: Array<{
    table: string;
    rows: number;
    dataSizeMb: number;
    indexSizeMb: number;
    totalSizeMb: number;
  }> = [];

  if (dialect === 'postgres') {
    // 1. Tables without PK in PostgreSQL
    try {
      const qPk = `
        SELECT c.relname AS table_name
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relkind = 'r'
          AND n.nspname = 'public'
          AND NOT EXISTS (
            SELECT 1 FROM pg_constraint con
            WHERE con.conrelid = c.oid AND con.contype = 'p'
          )
        ORDER BY c.relname;
      `;
      const resPk = await executeQuery(qPk);
      const rows = resPk?.results?.[0]?.rows || [];
      for (const r of rows) {
        const name = r.table_name || r.TABLE_NAME || Object.values(r)[0];
        if (name) tablesWithoutPk.push(String(name));
      }
    } catch (e) {
      console.warn('Error fetching tables without PK (postgres):', e);
    }

    // 2. Storage breakdown in PostgreSQL
    try {
      const qStorage = `
        SELECT c.relname AS table_name,
               COALESCE(c.reltuples::bigint, 0) AS table_rows,
               COALESCE(pg_relation_size(c.oid), 0) AS data_length,
               COALESCE(pg_indexes_size(c.oid), 0) AS index_length,
               COALESCE(pg_total_relation_size(c.oid), 0) AS total_length
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relkind = 'r' AND n.nspname = 'public'
        ORDER BY total_length DESC;
      `;
      const resStorage = await executeQuery(qStorage);
      const rows = resStorage?.results?.[0]?.rows || [];
      for (const r of rows) {
        const table = String(r.table_name || r.TABLE_NAME || '');
        const rowsCount = Number(r.table_rows || 0);
        const dataBytes = Number(r.data_length || 0);
        const indexBytes = Number(r.index_length || 0);
        const totalBytes = Number(r.total_length || 0);
        if (table) {
          storageBreakdown.push({
            table,
            rows: rowsCount,
            dataSizeMb: Number((dataBytes / (1024 * 1024)).toFixed(2)),
            indexSizeMb: Number((indexBytes / (1024 * 1024)).toFixed(2)),
            totalSizeMb: Number((totalBytes / (1024 * 1024)).toFixed(2))
          });
        }
      }
    } catch (e) {
      console.warn('Error fetching storage breakdown (postgres):', e);
    }
  } else {
    // MySQL / MariaDB

    // 1. Tables without PK
    try {
      const qPk = `
        SELECT t.TABLE_NAME
        FROM information_schema.TABLES t
        LEFT JOIN information_schema.TABLE_CONSTRAINTS tc
          ON t.TABLE_SCHEMA = tc.TABLE_SCHEMA
         AND t.TABLE_NAME = tc.TABLE_NAME
         AND tc.CONSTRAINT_TYPE = 'PRIMARY KEY'
        WHERE t.TABLE_SCHEMA = '${dbName}'
          AND t.TABLE_TYPE = 'BASE TABLE'
          AND tc.CONSTRAINT_NAME IS NULL
        ORDER BY t.TABLE_NAME;
      `;
      const resPk = await executeQuery(qPk);
      const rows = resPk?.results?.[0]?.rows || [];
      for (const r of rows) {
        const name = r.TABLE_NAME || r.table_name || Object.values(r)[0];
        if (name) tablesWithoutPk.push(String(name));
      }
    } catch (e) {
      console.warn('Error fetching tables without PK (mysql):', e);
    }

    // 2. Indexes for duplicate detection
    try {
      const qIdx = `
        SELECT TABLE_NAME, INDEX_NAME,
               GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS COLUMNS
        FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA = '${dbName}'
        GROUP BY TABLE_NAME, INDEX_NAME;
      `;
      const resIdx = await executeQuery(qIdx);
      const rows = resIdx?.results?.[0]?.rows || [];
      rawIndexes = rows.map((r: any) => ({
        table: String(r.TABLE_NAME || r.table_name || ''),
        indexName: String(r.INDEX_NAME || r.index_name || ''),
        columns: String(r.COLUMNS || r.columns || '')
      })).filter((x: any) => x.table && x.indexName && x.columns);
    } catch (e) {
      console.warn('Error fetching indexes for duplicate scan (mysql):', e);
    }

    // 3. Storage breakdown
    try {
      const qStorage = `
        SELECT TABLE_NAME,
               COALESCE(TABLE_ROWS, 0) AS TABLE_ROWS,
               COALESCE(DATA_LENGTH, 0) AS DATA_LENGTH,
               COALESCE(INDEX_LENGTH, 0) AS INDEX_LENGTH,
               COALESCE(DATA_LENGTH + INDEX_LENGTH, 0) AS TOTAL_LENGTH
        FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = '${dbName}'
          AND TABLE_TYPE = 'BASE TABLE'
        ORDER BY TOTAL_LENGTH DESC;
      `;
      const resStorage = await executeQuery(qStorage);
      const rows = resStorage?.results?.[0]?.rows || [];
      for (const r of rows) {
        const table = String(r.TABLE_NAME || r.table_name || '');
        const rowsCount = Number(r.TABLE_ROWS || r.table_rows || 0);
        const dataBytes = Number(r.DATA_LENGTH || r.data_length || 0);
        const indexBytes = Number(r.INDEX_LENGTH || r.index_length || 0);
        const totalBytes = Number(r.TOTAL_LENGTH || r.total_length || (dataBytes + indexBytes));
        if (table) {
          storageBreakdown.push({
            table,
            rows: rowsCount,
            dataSizeMb: Number((dataBytes / (1024 * 1024)).toFixed(2)),
            indexSizeMb: Number((indexBytes / (1024 * 1024)).toFixed(2)),
            totalSizeMb: Number((totalBytes / (1024 * 1024)).toFixed(2))
          });
        }
      }
    } catch (e) {
      console.warn('Error fetching storage breakdown (mysql):', e);
    }
  }

  const duplicateIndexes = detectDuplicateIndexes(rawIndexes);
  const totalTables = storageBreakdown.length || tablesWithoutPk.length;
  const issuesCount = tablesWithoutPk.length + duplicateIndexes.length;
  const healthyTablesCount = Math.max(0, totalTables - tablesWithoutPk.length);
  const totalSizeMb = Number(storageBreakdown.reduce((sum, t) => sum + t.totalSizeMb, 0).toFixed(2));
  const score = calculateHealthScore(tablesWithoutPk.length, duplicateIndexes.length, 0);

  return {
    database: dbName,
    dialect,
    score,
    tablesWithoutPk,
    duplicateIndexes,
    storageBreakdown,
    totalSizeMb,
    longRunningQueriesCount: 0,
    summary: {
      totalTables,
      healthyTablesCount,
      issuesCount
    }
  };
}

export async function fetchProcesslist(
  dialect: 'mysql' | 'postgres' = 'mysql'
): Promise<ProcessItem[]> {
  const processes: ProcessItem[] = [];

  if (dialect === 'postgres') {
    try {
      const q = `
        SELECT pid AS "id",
               usename AS "user",
               COALESCE(client_addr::text, 'local') AS "host",
               datname AS "db",
               state AS "command",
               COALESCE(EXTRACT(EPOCH FROM (clock_timestamp() - query_start))::int, 0) AS "time",
               state AS "state",
               COALESCE(query, '') AS "info"
        FROM pg_stat_activity
        WHERE pid <> pg_backend_pid()
        ORDER BY "time" DESC;
      `;
      const res = await executeQuery(q);
      const rows = res?.results?.[0]?.rows || [];
      for (const r of rows) {
        processes.push({
          id: Number(r.id || r.Id || 0),
          user: String(r.user || r.User || ''),
          host: String(r.host || r.Host || ''),
          db: String(r.db || ''),
          command: String(r.command || r.Command || ''),
          time: Number(r.time || r.Time || 0),
          state: String(r.state || r.State || ''),
          info: String(r.info || r.Info || '')
        });
      }
    } catch (err) {
      console.warn('Error fetching postgres processlist:', err);
    }
  } else {
    try {
      const q = 'SHOW FULL PROCESSLIST;';
      const res = await executeQuery(q);
      const rows = res?.results?.[0]?.rows || [];
      for (const r of rows) {
        processes.push({
          id: Number(r.Id || r.id || 0),
          user: String(r.User || r.user || ''),
          host: String(r.Host || r.host || ''),
          db: String(r.db || r.Db || ''),
          command: String(r.Command || r.command || ''),
          time: Number(r.Time || r.time || 0),
          state: String(r.State || r.state || ''),
          info: String(r.Info || r.info || '')
        });
      }
    } catch (err) {
      console.warn('Error fetching mysql processlist:', err);
    }
  }

  return processes;
}

export async function killProcess(
  id: number | string,
  dialect: 'mysql' | 'postgres' = 'mysql'
): Promise<{ success: boolean; message: string }> {
  const numId = Number(id);
  if (isNaN(numId) || numId <= 0 || !Number.isInteger(numId)) {
    throw new Error(`ID de proceso inválido: ${id}`);
  }

  if (dialect === 'postgres') {
    const q = `SELECT pg_cancel_backend(${numId});`;
    await executeQuery(q);
    return {
      success: true,
      message: `Consulta del proceso ${numId} cancelada exitosamente en PostgreSQL.`
    };
  } else {
    const q = `KILL QUERY ${numId};`;
    await executeQuery(q);
    return {
      success: true,
      message: `Consulta del thread ${numId} detenida exitosamente (KILL QUERY).`
    };
  }
}

import {
  fetchTablesForDatabase,
  executeQuery,
  exportToFile,
  showNotification,
  isSafeIdentifier
} from './beekeeper';

const COMPANION_URL = 'http://127.0.0.1:58765';

export interface SnapshotInfo {
  filename: string;
  filePath: string;
  sizeBytes: number;
  mtime: string;
  createdAt: string;
  format: 'zstd' | 'gzip' | 'sql';
  database: string;
}

export interface CreateSnapshotOptions {
  database: string;
  motor?: string;
  host?: string;
  port?: number;
  user?: string;
  pass?: string;
  compressWith?: 'zstd' | 'gzip' | 'none';
}

export interface RestoreSnapshotOptions {
  filename: string;
  database: string;
  motor?: string;
  host?: string;
  port?: number;
  user?: string;
  pass?: string;
}

export function formatBytes(bytes: number): string {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

export async function checkCompanionStatus(): Promise<boolean> {
  try {
    const res = await fetch(`${COMPANION_URL}/api/status`, { signal: AbortSignal.timeout(1500) });
    const data = await res.json();
    return Boolean(data?.ok);
  } catch {
    return false;
  }
}

export async function fetchSnapshots(): Promise<{ ok: boolean; backups: SnapshotInfo[]; backupDir?: string }> {
  try {
    const res = await fetch(`${COMPANION_URL}/api/backup/list`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err: any) {
    return { ok: false, backups: [] };
  }
}

export async function createSnapshot(options: CreateSnapshotOptions): Promise<{ ok: boolean; snapshot?: SnapshotInfo; error?: string }> {
  try {
    const res = await fetch(`${COMPANION_URL}/api/backup/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(options),
      signal: AbortSignal.timeout(30000)
    });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      throw new Error(data.error || `HTTP ${res.status}`);
    }
    return { ok: true, snapshot: data };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
}

export async function restoreSnapshot(options: RestoreSnapshotOptions): Promise<{ ok: boolean; message?: string; error?: string }> {
  try {
    const res = await fetch(`${COMPANION_URL}/api/backup/restore`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(options),
      signal: AbortSignal.timeout(60000)
    });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      throw new Error(data.error || `HTTP ${res.status}`);
    }
    return { ok: true, message: data.message };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
}

export async function deleteSnapshot(filename: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`${COMPANION_URL}/api/backup/delete`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename }),
      signal: AbortSignal.timeout(3000)
    });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      throw new Error(data.error || `HTTP ${res.status}`);
    }
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
}

/**
 * 100% Native in-app snapshot generator.
 * Queries DDL and table data in batches directly through Beekeeper's SQL driver.
 * Works on Windows, macOS, and Linux without any daemon or CLI tools.
 */
export async function createNativeSnapshot(
  database: string,
  onProgress?: (msg: string) => void
): Promise<boolean> {
  if (!isSafeIdentifier(database)) {
    showNotification('Nombre de base de datos inválido.', 'error');
    return false;
  }

  onProgress?.('Inspeccionando tablas...');
  const tables = await fetchTablesForDatabase(database);
  if (tables.length === 0) {
    showNotification(`La base de datos ${database} no contiene tablas.`, 'warning');
    return false;
  }

  const chunks: string[] = [
    `-- ========================================================`,
    `-- DB Manager Pro Native Snapshot`,
    `-- Database: ${database}`,
    `-- Date: ${new Date().toISOString()}`,
    `-- ========================================================\n\n`,
    `SET FOREIGN_KEY_CHECKS = 0;\n\n`
  ];

  for (let i = 0; i < tables.length; i++) {
    const tbl = tables[i].name;
    if (!isSafeIdentifier(tbl)) continue;

    onProgress?.(`Exportando DDL de ${tbl} (${i + 1}/${tables.length})...`);
    chunks.push(`-- Table structure for: \`${tbl}\`\n`);
    chunks.push(`DROP TABLE IF EXISTS \`${tbl}\`;\n`);

    try {
      const showRes = await executeQuery(`SHOW CREATE TABLE \`${database}\`.\`${tbl}\`;`);
      const showRows = showRes?.results?.[0]?.rows || showRes?.rows || [];
      const createSql = showRows[0]?.['Create Table'] || showRows[0]?.['create table'];
      if (createSql) {
        chunks.push(`${createSql};\n\n`);
      }
    } catch {
      chunks.push(`-- Notice: Could not retrieve SHOW CREATE TABLE for ${tbl}\n\n`);
    }

    onProgress?.(`Exportando datos de ${tbl} (${i + 1}/${tables.length})...`);
    try {
      const dataRes = await executeQuery(`SELECT * FROM \`${database}\`.\`${tbl}\` LIMIT 5000;`);
      const dataRows = dataRes?.results?.[0]?.rows || dataRes?.rows || [];
      const fields: Array<{ name: string }> =
        dataRes?.results?.[0]?.fields ||
        (dataRows.length > 0 ? Object.keys(dataRows[0]).map((k) => ({ name: k })) : []);

      if (dataRows.length > 0 && fields.length > 0) {
        const cols = fields.map((f: { name: string }) => `\`${f.name}\``).join(', ');
        chunks.push(`-- Dumping data for: \`${tbl}\`\n`);

        for (const row of dataRows) {
          const vals = fields.map((f: { name: string }) => {
            const v = row[f.name];
            if (v === null || v === undefined) return 'NULL';
            if (typeof v === 'number') return String(v);
            if (typeof v === 'boolean') return v ? '1' : '0';
            return `'${String(v).replace(/'/g, "''").replace(/\\/g, '\\\\')}'`;
          }).join(', ');
          chunks.push(`INSERT INTO \`${tbl}\` (${cols}) VALUES (${vals});\n`);
        }
        chunks.push('\n');
      }
    } catch (err: any) {
      console.warn(`Error reading rows from ${tbl}:`, err.message);
    }
  }

  chunks.push(`SET FOREIGN_KEY_CHECKS = 1;\n`);
  const fullSql = chunks.join('');

  onProgress?.('Guardando archivo de snapshot...');
  const dateStr = new Date().toISOString().slice(0, 10);
  const defaultName = `snapshot_${database}_${dateStr}.sql`;

  const saved = await exportToFile(fullSql, defaultName, [
    { name: 'SQL Snapshot (*.sql)', extensions: ['sql', 'txt'] }
  ]);

  if (saved) {
    showNotification(`✔ Snapshot nativo de ${database} guardado con éxito.`, 'success');
    return true;
  }
  return false;
}

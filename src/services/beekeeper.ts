import {
  getConnectionInfo,
  getSchemas,
  getTables,
  getColumns,
  getTableKeys,
  runQuery,
  getAppInfo,
  addNotificationListener,
  clipboard,
  noty,
  openTab,
  requestFileSave,
  confirm as pluginConfirm,
  getViewContext
} from '@beekeeperstudio/plugin';

export interface ColumnInfo {
  name: string;
  type: string;
}

/**
 * Valida que un valor sea un identificador seguro (nombre de BD/esquema/tabla)
 * antes de interpolarlo en un fallback SQL crudo (el SDK del plugin no expone
 * prepared statements). En vez de intentar escapar el identificador, se
 * rechaza si contiene comillas, backticks, backslash o punto y coma: los
 * nombres de tabla/BD reales casi nunca usan esos caracteres, así que es una
 * restricción de bajo impacto que evita romper la sentencia SQL.
 */
export function isSafeIdentifier(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && !/['"`;\\]/.test(value);
}

export interface TableInfo {
  name: string;
  schema?: string;
}

export interface ConnectionData {
  connectionName: string;
  databaseName: string;
  databaseType: string;
}

export async function fetchCurrentConnection(): Promise<ConnectionData | null> {
  try {
    const info = await getConnectionInfo();
    return {
      connectionName: info.connectionName || 'Conexión Actual',
      databaseName: info.databaseName || '',
      databaseType: info.databaseType || 'mysql'
    };
  } catch (err) {
    console.warn('No active connection from Beekeeper SDK:', err);
    return null;
  }
}

export async function fetchDatabases(): Promise<string[]> {
  try {
    // 1. Try getSchemas()
    try {
      const schemas = await getSchemas();
      if (Array.isArray(schemas) && schemas.length > 0) {
        const ignore = ['information_schema', 'performance_schema', 'mysql', 'sys'];
        const valid = schemas.filter(s => s && typeof s === 'string' && !ignore.includes(s.toLowerCase()));
        if (valid.length > 0) return valid;
      }
    } catch {
      // getSchemas might not be supported or error out on some engines
    }

    // 2. Try SHOW DATABASES; (MySQL / MariaDB)
    try {
      const res = await runQuery('SHOW DATABASES;');
      const rows = res?.results?.[0]?.rows || [];
      const ignore = ['information_schema', 'performance_schema', 'mysql', 'sys'];
      const dbs: string[] = [];
      for (const row of rows) {
        const val = row.Database || row.database || Object.values(row)[0];
        if (val && typeof val === 'string' && !ignore.includes(val.toLowerCase())) {
          dbs.push(val);
        }
      }
      if (dbs.length > 0) return dbs;
    } catch {
      // not mysql
    }

    // 3. Try PostgreSQL pg_database
    try {
      const res = await runQuery("SELECT datname FROM pg_database WHERE datistemplate = false;");
      const rows = res?.results?.[0]?.rows || [];
      const dbs: string[] = [];
      for (const row of rows) {
        const val = row.datname || Object.values(row)[0];
        if (val && typeof val === 'string' && val.toLowerCase() !== 'postgres') {
          dbs.push(val);
        }
      }
      if (dbs.length > 0) return dbs;
    } catch {
      // not postgres
    }

    return [];
  } catch (err) {
    console.warn('Error fetching databases from Beekeeper SDK:', err);
    return [];
  }
}

export async function fetchTables(schema?: string): Promise<TableInfo[]> {
  try {
    return await getTables(schema);
  } catch (err) {
    console.warn('Error fetching tables from Beekeeper SDK:', err);
    return [];
  }
}

export async function fetchTablesForDatabase(databaseName?: string): Promise<TableInfo[]> {
  try {
    if (!databaseName) {
      return await getTables();
    }
    if (!isSafeIdentifier(databaseName)) {
      console.warn(`Nombre de base de datos con caracteres no permitidos, se omite fallback SQL: ${databaseName}`);
      return await getTables(databaseName);
    }
    const q = `SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = '${databaseName}' AND TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_NAME ASC;`;
    const res = await runQuery(q);
    const rows = res?.results?.[0]?.rows || [];
    if (rows.length > 0) {
      return rows.map((r: any) => ({
        name: String(r.TABLE_NAME || r.table_name || Object.values(r)[0]),
        schema: databaseName
      }));
    }
    return await getTables(databaseName);
  } catch {
    return await getTables(databaseName);
  }
}

export async function fetchColumns(tableName: string, schema?: string): Promise<ColumnInfo[]> {
  try {
    const cols = await getColumns(tableName, schema);
    if (Array.isArray(cols) && cols.length > 0) return cols;
    if (!schema) return cols || [];
  } catch (err) {
    console.warn(`Error fetching columns for ${tableName} via SDK, falling back to SQL:`, err);
  }

  if (!schema) return [];

  if (!isSafeIdentifier(schema) || !isSafeIdentifier(tableName)) {
    console.warn(`Esquema o tabla con caracteres no permitidos, se omite fallback SQL: ${schema}.${tableName}`);
    return [];
  }

  try {
    const q = `SELECT COLUMN_NAME, COLUMN_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = '${schema}' AND TABLE_NAME = '${tableName}' ORDER BY ORDINAL_POSITION ASC;`;
    const res = await runQuery(q);
    const rows = res?.results?.[0]?.rows || [];
    return rows.map((r: any) => ({
      name: String(r.COLUMN_NAME || r.column_name || Object.values(r)[0]),
      type: String(r.COLUMN_TYPE || r.column_type || Object.values(r)[1] || '')
    }));
  } catch (err) {
    console.warn(`Error fetching columns for ${tableName} via SQL fallback:`, err);
    return [];
  }
}

export async function fetchForeignKeys(tableName: string, schema?: string): Promise<any[]> {
  try {
    return await getTableKeys(tableName, schema);
  } catch (err) {
    console.warn(`Error fetching keys for ${tableName}:`, err);
    return [];
  }
}

export interface ForeignKeyInfo {
  columnName: string;
  referencedTable: string;
  referencedColumn: string;
  referencedSchema?: string;
}

export async function fetchTableForeignKeys(tableName: string, schema?: string): Promise<ForeignKeyInfo[]> {
  try {
    const keys = await getTableKeys(tableName, schema);
    if (Array.isArray(keys) && keys.length > 0) {
      return keys.map((k: any) => ({
        columnName: String(Array.isArray(k.fromColumn) ? k.fromColumn[0] : (k.fromColumn || k.columnName || '')),
        referencedTable: String(k.toTable || k.referencedTable || ''),
        referencedColumn: String(Array.isArray(k.toColumn) ? k.toColumn[0] : (k.toColumn || k.referencedColumn || 'id')),
        referencedSchema: k.toSchema || schema
      })).filter(k => k.columnName && k.referencedTable);
    }
  } catch (err) {
    console.warn(`Error fetching table keys via SDK for ${tableName}:`, err);
  }

  // Fallback SQL for MySQL / MariaDB information_schema
  if (schema && isSafeIdentifier(schema) && isSafeIdentifier(tableName)) {
    try {
      const q = `SELECT COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME, REFERENCED_TABLE_SCHEMA
                 FROM information_schema.KEY_COLUMN_USAGE
                 WHERE TABLE_SCHEMA = '${schema}'
                   AND TABLE_NAME = '${tableName}'
                   AND REFERENCED_TABLE_NAME IS NOT NULL;`;
      const res = await runQuery(q);
      const rows = res?.results?.[0]?.rows || [];
      if (rows.length > 0) {
        return rows.map((r: any) => ({
          columnName: String(r.COLUMN_NAME || r.column_name || ''),
          referencedTable: String(r.REFERENCED_TABLE_NAME || r.referenced_table_name || ''),
          referencedColumn: String(r.REFERENCED_COLUMN_NAME || r.referenced_column_name || 'id'),
          referencedSchema: r.REFERENCED_TABLE_SCHEMA || r.referenced_table_schema || schema
        })).filter(k => k.columnName && k.referencedTable);
      }
    } catch (err) {
      console.warn(`Error fetching foreign keys via SQL for ${tableName}:`, err);
    }
  }

  return [];
}

/**
 * Runs a query built against MySQL-style backtick-quoted identifiers first,
 * retrying with Postgres-style double-quote-quoted identifiers if that
 * throws — the plugin SDK gives no reliable way to ask which SQL dialect the
 * active connection speaks ahead of time. Centralizes a fallback that used
 * to be copy-pasted near-verbatim across fetchTableColumnValues,
 * fetchTableRowCount and fetchTableMaxId (the same shape of duplication that
 * once let a real bug drift between near-identical isMysql/isPg blocks
 * elsewhere in this project).
 */
async function queryWithDialectFallback<T>(
  buildQuery: (quoteIdent: (id: string) => string) => string,
  extractRows: (rows: any[]) => T
): Promise<T> {
  const dialectQuotes = [(id: string) => `\`${id}\``, (id: string) => `"${id}"`];
  for (const quoteIdent of dialectQuotes) {
    try {
      const res = await runQuery(buildQuery(quoteIdent));
      return extractRows(res?.results?.[0]?.rows || []);
    } catch {
      // try the next dialect
    }
  }
  return extractRows([]);
}

export async function fetchTableColumnValues(
  tableName: string,
  columnName: string = 'id',
  schema?: string,
  limit: number = 200
): Promise<any[]> {
  if (!isSafeIdentifier(tableName) || !isSafeIdentifier(columnName) || (schema && !isSafeIdentifier(schema))) {
    return [];
  }
  const safeLimit = Math.max(1, Math.min(1000, Number(limit) || 200));
  return queryWithDialectFallback(
    (q) => {
      const target = schema ? `${q(schema)}.${q(tableName)}` : q(tableName);
      return `SELECT ${q(columnName)} FROM ${target} WHERE ${q(columnName)} IS NOT NULL LIMIT ${safeLimit};`;
    },
    (rows) => rows
      .map((r: any) => (r[columnName] !== undefined ? r[columnName] : Object.values(r)[0]))
      .filter((v: any) => v !== null && v !== undefined)
  );
}

export async function fetchTableRowCount(tableName: string, schema?: string): Promise<number> {
  if (!isSafeIdentifier(tableName) || (schema && !isSafeIdentifier(schema))) {
    return 0;
  }
  return queryWithDialectFallback(
    (q) => {
      const target = schema ? `${q(schema)}.${q(tableName)}` : q(tableName);
      return `SELECT COUNT(*) as cnt FROM ${target};`;
    },
    (rows) => {
      if (rows.length === 0) return 0;
      const val = rows[0].cnt ?? rows[0].count ?? Object.values(rows[0])[0];
      const num = Number(val);
      return isNaN(num) ? 0 : num;
    }
  );
}

export async function fetchTableMaxId(
  tableName: string,
  columnName: string = 'id',
  schema?: string
): Promise<number> {
  if (!isSafeIdentifier(tableName) || !isSafeIdentifier(columnName) || (schema && !isSafeIdentifier(schema))) {
    return 0;
  }
  return queryWithDialectFallback(
    (q) => {
      const target = schema ? `${q(schema)}.${q(tableName)}` : q(tableName);
      return `SELECT MAX(${q(columnName)}) as max_id FROM ${target};`;
    },
    (rows) => {
      if (rows.length === 0) return 0;
      const val = rows[0].max_id ?? Object.values(rows[0])[0];
      const num = Number(val);
      return isNaN(num) ? 0 : num;
    }
  );
}

export function findMatchingTable(columnName: string, tableNames: string[]): string | null {
  if (!columnName || !Array.isArray(tableNames) || tableNames.length === 0) return null;

  const col = columnName.toLowerCase().trim();
  let base = '';
  if (col.endsWith('_id')) {
    base = col.slice(0, -3);
  } else if (col.endsWith('_fk')) {
    base = col.slice(0, -3);
  } else if (col.startsWith('id_')) {
    base = col.slice(3);
  } else {
    return null;
  }

  if (!base) return null;

  // 1. Exact match (case-insensitive)
  const exact = tableNames.find((t) => t.toLowerCase() === base);
  if (exact) return exact;

  // 2. Candidate plurals ("+es" is tried unconditionally since it's the
  // correct form for sibilant endings like s/x/z/ch/sh; a spurious "+es"
  // guess for other endings is harmless noise filtered out by the table
  // lookup below, not an incorrect match).
  const candidates: string[] = [
    base + 's',
    base + 'es',
    base.endsWith('y') ? base.slice(0, -1) + 'ies' : '',
    base.endsWith('z') ? base.slice(0, -1) + 'ces' : ''
  ].filter(Boolean);

  if (base.includes('_')) {
    const parts = base.split('_');
    const lastPart = parts[parts.length - 1];
    const rest = parts.slice(0, -1).join('_');
    candidates.push(`${rest}_${lastPart}s`);
    candidates.push(`${rest}_${lastPart}es`);
    if (lastPart.endsWith('y')) candidates.push(`${rest}_${lastPart.slice(0, -1)}ies`);
    if (lastPart.endsWith('z')) candidates.push(`${rest}_${lastPart.slice(0, -1)}ces`);
    candidates.push(parts.map((p) => p + 's').join('_'));
  }

  for (const cand of candidates) {
    const match = tableNames.find((t) => t.toLowerCase() === cand);
    if (match) return match;
  }

  // 3. Suffix match: e.g. tb_saldo_ventas
  const suffixMatch = tableNames.find((t) => {
    const tl = t.toLowerCase();
    return (
      tl.endsWith(`_${base}`) ||
      tl.endsWith(`_${base}s`) ||
      tl.endsWith(`_${base}es`)
    );
  });
  if (suffixMatch) return suffixMatch;

  return null;
}

/**
 * Genera un UUID versión 7 (RFC 9562) ordenable cronológicamente.
 * Los primeros 48 bits corresponden al timestamp en milisegundos Unix,
 * seguido por 4 bits de versión (0111), 12 bits aleatorios,
 * 2 bits de variante RFC 4122 (10) y 62 bits aleatorios.
 */
export function generateUuidV7(): string {
  const bytes = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }

  const now = Date.now();
  // 48-bit timestamp en big-endian
  bytes[0] = (now / 0x10000000000) & 0xff;
  bytes[1] = (now / 0x100000000) & 0xff;
  bytes[2] = (now / 0x1000000) & 0xff;
  bytes[3] = (now / 0x10000) & 0xff;
  bytes[4] = (now / 0x100) & 0xff;
  bytes[5] = now & 0xff;

  // Versión 7: 0111 en los 4 bits más significativos (0x70)
  bytes[6] = (bytes[6] & 0x0f) | 0x70;
  // Variante RFC 4122 / 9562: 10 en los 2 bits más significativos (0x80)
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32)
  ].join('-');
}

export async function executeQuery(query: string): Promise<any> {
  return await runQuery(query);
}

export async function setupThemeSync(): Promise<void> {
  try {
    const appInfo = await getAppInfo();
    applyTheme(appInfo.theme?.cssString);

    addNotificationListener('themeChanged', (theme: any) => {
      applyTheme(theme?.cssString);
    });
  } catch (err) {
    console.warn('Theme sync error (running outside Beekeeper?):', err);
  }
}

function applyTheme(cssString?: string) {
  if (!cssString) return;
  let styleEl = document.getElementById('app-theme');
  if (!styleEl) {
    styleEl = document.createElement('style');
    styleEl.id = 'app-theme';
    document.head.appendChild(styleEl);
  }
  styleEl.textContent = cssString;
}

export function showNotification(message: string, type: 'info' | 'error' | 'success' | 'warning' = 'info') {
  try {
    if (type === 'success') noty.success(message);
    else if (type === 'error') noty.error(message);
    else if (type === 'warning') noty.warning(message);
    else noty.info(message);
  } catch {
    console.log(`[${type.toUpperCase()}] ${message}`);
  }
}

export async function copyToSystemClipboard(text: string): Promise<boolean> {
  // 1. Try Beekeeper Studio plugin native clipboard bridge (Electron main process)
  try {
    if (clipboard && typeof clipboard.writeText === 'function') {
      await clipboard.writeText(text);
      return true;
    }
  } catch (err) {
    console.warn('Beekeeper SDK clipboard.writeText error:', err);
  }

  // 2. Try modern Web navigator.clipboard
  if (navigator?.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (err) {
      console.warn('navigator.clipboard.writeText failed:', err);
    }
  }

  // 3. Fallback to document.execCommand('copy') via temporary textarea
  try {
    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.style.position = 'fixed';
    textArea.style.left = '-9999px';
    textArea.style.top = '-9999px';
    textArea.setAttribute('readonly', '');
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    const successful = document.execCommand('copy');
    document.body.removeChild(textArea);
    if (successful) return true;
  } catch (err) {
    console.error('execCommand copy fallback failed:', err);
  }

  return false;
}

/**
 * Abre una nueva pestaña de consulta SQL en Beekeeper Studio con el script proporcionado.
 */
export async function openQueryInBeekeeper(query: string): Promise<boolean> {
  try {
    if (typeof openTab === 'function') {
      await openTab({ type: 'query', query });
      return true;
    }
  } catch (err) {
    console.warn('Error al abrir query tab en Beekeeper:', err);
  }
  return false;
}

/**
 * Abre la vista de datos de una tabla específica en Beekeeper Studio.
 */
export async function openTableInBeekeeper(table: string, schema?: string, database?: string): Promise<boolean> {
  try {
    if (typeof openTab === 'function') {
      await openTab({ type: 'tableTable', table, schema, database });
      return true;
    }
  } catch (err) {
    console.warn('Error al abrir tableTable tab en Beekeeper:', err);
  }
  return false;
}

/**
 * Muestra un diálogo de confirmación nativo usando el SDK de Beekeeper Studio,
 * o recurre a window.confirm si se ejecuta fuera de Beekeeper.
 */
export async function confirmAction(message: string, title: string = 'Confirmar acción'): Promise<boolean> {
  try {
    if (typeof pluginConfirm === 'function') {
      const res = await pluginConfirm({
        title,
        message,
        options: { confirmLabel: 'Continuar', cancelLabel: 'Cancelar' }
      });
      return Boolean(res);
    }
  } catch (err) {
    console.warn('Error en pluginConfirm, recurriendo a window.confirm:', err);
  }

  if (typeof window !== 'undefined' && typeof window.confirm === 'function') {
    return window.confirm(`${title ? title + '\n\n' : ''}${message}`);
  }
  return true;
}

/**
 * Guarda datos en disco abriendo el cuadro de diálogo nativo de Beekeeper Studio (requestFileSave)
 * o recurre a descarga directa de Blob en el navegador.
 */
export async function exportToFile(
  data: string,
  fileName: string,
  filters?: Array<{ name: string; extensions: string[] }>
): Promise<boolean> {
  // 1. Intenta requestFileSave nativo de Beekeeper Studio
  try {
    if (typeof requestFileSave === 'function') {
      await requestFileSave({
        data,
        fileName,
        encoding: 'utf8',
        filters: filters || [{ name: 'All Files', extensions: ['*'] }]
      });
      return true;
    }
  } catch (err) {
    console.warn('requestFileSave no disponible o falló, recurriendo a descarga Blob:', err);
  }

  // 2. Fallback mediante descarga directa de Blob en el navegador
  try {
    if (typeof document !== 'undefined') {
      const blob = new Blob([data], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      return true;
    }
  } catch (err) {
    console.error('Error en descarga Blob fallback:', err);
  }

  return false;
}

/**
 * Obtiene el contexto de vista desde Beekeeper Studio (ej. cuando se abre desde el menú contextual).
 */
export async function fetchViewContext(): Promise<any | null> {
  try {
    if (typeof getViewContext === 'function') {
      return await getViewContext();
    }
  } catch (err) {
    console.warn('No se pudo obtener viewContext de Beekeeper:', err);
  }
  return null;
}

/**
 * Extrae el nombre de la tabla si el plugin fue abierto desde un menú contextual sobre una tabla.
 */
export function extractTableFromViewContext(context: any): string | null {
  if (!context) return null;
  const p = context.params;
  if (typeof p === 'string' && p.trim()) return p.trim();
  if (p?.table && typeof p.table === 'string') return p.table.trim();
  if (p?.tableName && typeof p.tableName === 'string') return p.tableName.trim();
  if (p?.target?.table && typeof p.target.table === 'string') return p.target.table.trim();
  if (p?.target?.type === 'table' && typeof p.target.name === 'string') return p.target.name.trim();
  return null;
}


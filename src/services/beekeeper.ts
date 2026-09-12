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
  noty
} from '@beekeeperstudio/plugin';

export interface ColumnInfo {
  name: string;
  type: string;
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
    return await getColumns(tableName, schema);
  } catch (err) {
    console.warn(`Error fetching columns for ${tableName}:`, err);
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

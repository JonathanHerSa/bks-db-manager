import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const getConnectionInfo = vi.fn()
const getSchemas = vi.fn()
const getTables = vi.fn()
const getColumns = vi.fn()
const getTableKeys = vi.fn()
const runQuery = vi.fn()
const getAppInfo = vi.fn()
const addNotificationListener = vi.fn()
const clipboardWriteText = vi.fn()
const notySuccess = vi.fn()
const notyError = vi.fn()
const notyWarning = vi.fn()
const notyInfo = vi.fn()
const openTab = vi.fn()
const requestFileSave = vi.fn()
const confirmMock = vi.fn()
const getViewContext = vi.fn()

vi.mock('@beekeeperstudio/plugin', () => ({
  getConnectionInfo: (...a: any[]) => getConnectionInfo(...a),
  getSchemas: (...a: any[]) => getSchemas(...a),
  getTables: (...a: any[]) => getTables(...a),
  getColumns: (...a: any[]) => getColumns(...a),
  getTableKeys: (...a: any[]) => getTableKeys(...a),
  runQuery: (...a: any[]) => runQuery(...a),
  getAppInfo: (...a: any[]) => getAppInfo(...a),
  addNotificationListener: (...a: any[]) => addNotificationListener(...a),
  clipboard: { writeText: (...a: any[]) => clipboardWriteText(...a) },
  noty: {
    success: (...a: any[]) => notySuccess(...a),
    error: (...a: any[]) => notyError(...a),
    warning: (...a: any[]) => notyWarning(...a),
    info: (...a: any[]) => notyInfo(...a)
  },
  openTab: (...a: any[]) => openTab(...a),
  requestFileSave: (...a: any[]) => requestFileSave(...a),
  confirm: (...a: any[]) => confirmMock(...a),
  getViewContext: (...a: any[]) => getViewContext(...a)
}))

import {
  isSafeIdentifier,
  fetchCurrentConnection,
  fetchDatabases,
  fetchTables,
  fetchTablesForDatabase,
  fetchColumns,
  fetchForeignKeys,
  fetchTableForeignKeys,
  fetchTableColumnValues,
  fetchTableRowCount,
  fetchTableMaxId,
  findMatchingTable,
  generateUuidV7,
  executeQuery,
  showNotification,
  copyToSystemClipboard,
  openQueryInBeekeeper,
  openTableInBeekeeper,
  confirmAction,
  exportToFile,
  fetchViewContext,
  extractTableFromViewContext
} from './beekeeper'

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('isSafeIdentifier', () => {
  it('accepts plain alphanumeric/underscore identifiers', () => {
    expect(isSafeIdentifier('users')).toBe(true)
    expect(isSafeIdentifier('app_db_2024')).toBe(true)
  })

  it.each([
    ["users`; DROP TABLE users;--"],
    ["o'brien_db"],
    ['db"name'],
    ['back\\slash'],
    ['semi;colon']
  ])('rejects identifiers containing dangerous characters: %s', (value) => {
    expect(isSafeIdentifier(value)).toBe(false)
  })

  it('rejects empty strings and non-strings', () => {
    expect(isSafeIdentifier('')).toBe(false)
    expect(isSafeIdentifier(undefined)).toBe(false)
    expect(isSafeIdentifier(null)).toBe(false)
    expect(isSafeIdentifier(42)).toBe(false)
  })
})

describe('fetchCurrentConnection', () => {
  it('maps the SDK response into ConnectionData', async () => {
    getConnectionInfo.mockResolvedValue({ connectionName: 'Docker', databaseName: 'app_db', databaseType: 'mysql' })
    const result = await fetchCurrentConnection()
    expect(result).toEqual({ connectionName: 'Docker', databaseName: 'app_db', databaseType: 'mysql' })
  })

  it('returns null when the SDK throws (running outside Beekeeper)', async () => {
    getConnectionInfo.mockRejectedValue(new Error('no host'))
    expect(await fetchCurrentConnection()).toBeNull()
  })
})

describe('fetchDatabases', () => {
  it('uses getSchemas() when it returns valid schemas', async () => {
    getSchemas.mockResolvedValue(['app_db', 'information_schema', 'sys'])
    const result = await fetchDatabases()
    expect(result).toEqual(['app_db'])
    expect(runQuery).not.toHaveBeenCalled()
  })

  it('falls back to SHOW DATABASES when getSchemas is unsupported', async () => {
    getSchemas.mockRejectedValue(new Error('not supported'))
    runQuery.mockResolvedValueOnce({ results: [{ rows: [{ Database: 'app_db' }, { Database: 'mysql' }] }] })
    const result = await fetchDatabases()
    expect(result).toEqual(['app_db'])
  })

  it('falls back to pg_database for Postgres when SHOW DATABASES fails', async () => {
    getSchemas.mockRejectedValue(new Error('not supported'))
    runQuery.mockRejectedValueOnce(new Error('syntax error'))
    runQuery.mockResolvedValueOnce({ results: [{ rows: [{ datname: 'app_db' }, { datname: 'postgres' }] }] })
    const result = await fetchDatabases()
    expect(result).toEqual(['app_db'])
  })

  it('returns an empty array when every strategy fails', async () => {
    getSchemas.mockRejectedValue(new Error('x'))
    runQuery.mockRejectedValue(new Error('x'))
    expect(await fetchDatabases()).toEqual([])
  })
})

describe('fetchTables', () => {
  it('delegates to getTables and returns [] on error', async () => {
    getTables.mockResolvedValue([{ name: 'users' }])
    expect(await fetchTables('app_db')).toEqual([{ name: 'users' }])

    getTables.mockRejectedValue(new Error('boom'))
    expect(await fetchTables('app_db')).toEqual([])
  })
})

describe('fetchTablesForDatabase', () => {
  it('calls getTables() with no schema when databaseName is empty', async () => {
    getTables.mockResolvedValue([{ name: 'users' }])
    const result = await fetchTablesForDatabase()
    expect(result).toEqual([{ name: 'users' }])
    expect(getTables).toHaveBeenCalledWith()
  })

  it('queries information_schema.TABLES for a safe database name', async () => {
    runQuery.mockResolvedValue({ results: [{ rows: [{ TABLE_NAME: 'users' }, { TABLE_NAME: 'orders' }] }] })
    const result = await fetchTablesForDatabase('app_db')
    expect(runQuery).toHaveBeenCalledWith(expect.stringContaining("TABLE_SCHEMA = 'app_db'"))
    expect(result).toEqual([
      { name: 'users', schema: 'app_db' },
      { name: 'orders', schema: 'app_db' }
    ])
  })

  it('falls back to getTables(schema) when the SQL query returns no rows', async () => {
    runQuery.mockResolvedValue({ results: [{ rows: [] }] })
    getTables.mockResolvedValue([{ name: 'fallback_table' }])
    const result = await fetchTablesForDatabase('app_db')
    expect(result).toEqual([{ name: 'fallback_table' }])
  })

  it('never runs raw SQL for an unsafe database name (SQL injection guard)', async () => {
    getTables.mockResolvedValue([])
    await fetchTablesForDatabase("app_db'; DROP TABLE users;--")
    expect(runQuery).not.toHaveBeenCalled()
    expect(getTables).toHaveBeenCalledWith("app_db'; DROP TABLE users;--")
  })

  it('falls back to getTables(schema) when runQuery throws', async () => {
    runQuery.mockRejectedValue(new Error('syntax error'))
    getTables.mockResolvedValue([{ name: 'fallback_table' }])
    const result = await fetchTablesForDatabase('app_db')
    expect(result).toEqual([{ name: 'fallback_table' }])
  })
})

describe('fetchColumns', () => {
  it('returns columns from the SDK when available', async () => {
    getColumns.mockResolvedValue([{ name: 'id', type: 'int' }])
    const result = await fetchColumns('users', 'app_db')
    expect(result).toEqual([{ name: 'id', type: 'int' }])
    expect(runQuery).not.toHaveBeenCalled()
  })

  it('falls back to information_schema.COLUMNS when the SDK returns nothing and schema is safe', async () => {
    getColumns.mockResolvedValue([])
    runQuery.mockResolvedValue({
      results: [{ rows: [{ COLUMN_NAME: 'id', COLUMN_TYPE: 'int(11)' }] }]
    })
    const result = await fetchColumns('users', 'app_db')
    expect(runQuery).toHaveBeenCalledWith(expect.stringContaining("TABLE_SCHEMA = 'app_db'"))
    expect(runQuery).toHaveBeenCalledWith(expect.stringContaining("TABLE_NAME = 'users'"))
    expect(result).toEqual([{ name: 'id', type: 'int(11)' }])
  })

  it('returns [] without querying SQL when no schema is provided and the SDK is empty', async () => {
    getColumns.mockResolvedValue([])
    const result = await fetchColumns('users')
    expect(result).toEqual([])
    expect(runQuery).not.toHaveBeenCalled()
  })

  it('never runs raw SQL for an unsafe schema or table name (SQL injection guard)', async () => {
    getColumns.mockResolvedValue([])
    const result = await fetchColumns("users`; DROP TABLE users;--", 'app_db')
    expect(runQuery).not.toHaveBeenCalled()
    expect(result).toEqual([])
  })

  it('falls back to SQL when the SDK throws, for a safe schema/table', async () => {
    getColumns.mockRejectedValue(new Error('not supported'))
    runQuery.mockResolvedValue({ results: [{ rows: [{ COLUMN_NAME: 'email', COLUMN_TYPE: 'varchar(255)' }] }] })
    const result = await fetchColumns('users', 'app_db')
    expect(result).toEqual([{ name: 'email', type: 'varchar(255)' }])
  })

  it('returns [] when both the SDK and the SQL fallback fail', async () => {
    getColumns.mockRejectedValue(new Error('x'))
    runQuery.mockRejectedValue(new Error('x'))
    expect(await fetchColumns('users', 'app_db')).toEqual([])
  })
})

describe('fetchForeignKeys', () => {
  it('delegates to getTableKeys and returns [] on error', async () => {
    getTableKeys.mockResolvedValue([{ toTable: 'orders' }])
    expect(await fetchForeignKeys('users')).toEqual([{ toTable: 'orders' }])

    getTableKeys.mockRejectedValue(new Error('boom'))
    expect(await fetchForeignKeys('users')).toEqual([])
  })
})

describe('executeQuery', () => {
  it('delegates directly to runQuery', async () => {
    runQuery.mockResolvedValue({ results: [{ rows: [] }] })
    await executeQuery('SELECT 1;')
    expect(runQuery).toHaveBeenCalledWith('SELECT 1;')
  })
})

describe('showNotification', () => {
  it.each([
    ['success', notySuccess],
    ['error', notyError],
    ['warning', notyWarning],
    ['info', notyInfo]
  ] as const)('routes %s notifications to the matching noty method', (type, spy) => {
    showNotification('hello', type)
    expect(spy).toHaveBeenCalledWith('hello')
  })

  it('falls back to console.log when noty throws', () => {
    notyInfo.mockImplementation(() => { throw new Error('no noty in this context') })
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    showNotification('hello')
    expect(logSpy).toHaveBeenCalledWith('[INFO] hello')
    logSpy.mockRestore()
  })
})

describe('copyToSystemClipboard', () => {
  it('uses the Beekeeper SDK clipboard bridge first', async () => {
    clipboardWriteText.mockResolvedValue(undefined)
    const result = await copyToSystemClipboard('hello')
    expect(result).toBe(true)
    expect(clipboardWriteText).toHaveBeenCalledWith('hello')
  })

  it('falls back to navigator.clipboard when the SDK bridge fails', async () => {
    clipboardWriteText.mockRejectedValue(new Error('not available'))
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    const result = await copyToSystemClipboard('hello')
    expect(result).toBe(true)
    expect(writeText).toHaveBeenCalledWith('hello')
  })

  it('falls back to document.execCommand when both other strategies fail', async () => {
    clipboardWriteText.mockRejectedValue(new Error('not available'))
    vi.stubGlobal('navigator', {})
    const execSpy = vi.fn().mockReturnValue(true)
    ;(document as any).execCommand = execSpy
    const result = await copyToSystemClipboard('hello')
    expect(result).toBe(true)
    expect(execSpy).toHaveBeenCalledWith('copy')
  })

  it('returns false when every clipboard strategy fails', async () => {
    clipboardWriteText.mockRejectedValue(new Error('not available'))
    vi.stubGlobal('navigator', {})
    ;(document as any).execCommand = vi.fn().mockReturnValue(false)
    const result = await copyToSystemClipboard('hello')
    expect(result).toBe(false)
  })
})

describe('fetchTableForeignKeys', () => {
  it('maps SDK TableKeys to ForeignKeyInfo', async () => {
    getTableKeys.mockResolvedValue([
      { fromColumn: 'saldo_venta_id', toTable: 'saldo_ventas', toColumn: 'id', toSchema: 'app_db' }
    ])
    const result = await fetchTableForeignKeys('ventas_detalles', 'app_db')
    expect(result).toEqual([
      {
        columnName: 'saldo_venta_id',
        referencedTable: 'saldo_ventas',
        referencedColumn: 'id',
        referencedSchema: 'app_db'
      }
    ])
  })

  it('falls back to information_schema when SDK returns empty array', async () => {
    getTableKeys.mockResolvedValue([])
    runQuery.mockResolvedValue({
      results: [
        {
          rows: [
            {
              COLUMN_NAME: 'acre_venta_id',
              REFERENCED_TABLE_NAME: 'acre_ventas',
              REFERENCED_COLUMN_NAME: 'id',
              REFERENCED_TABLE_SCHEMA: 'app_db'
            }
          ]
        }
      ]
    })
    const result = await fetchTableForeignKeys('ventas_detalles', 'app_db')
    expect(runQuery).toHaveBeenCalledWith(expect.stringContaining('information_schema.KEY_COLUMN_USAGE'))
    expect(result).toEqual([
      {
        columnName: 'acre_venta_id',
        referencedTable: 'acre_ventas',
        referencedColumn: 'id',
        referencedSchema: 'app_db'
      }
    ])
  })

  it('returns [] when both SDK and SQL fallback error', async () => {
    getTableKeys.mockRejectedValue(new Error('no sdk'))
    runQuery.mockRejectedValue(new Error('no sql'))
    const result = await fetchTableForeignKeys('users', 'app_db')
    expect(result).toEqual([])
  })
})

describe('fetchTableColumnValues', () => {
  it('queries column values and filters out nulls', async () => {
    runQuery.mockResolvedValue({
      results: [{ rows: [{ id: 1 }, { id: 2 }, { id: null }] }]
    })
    const values = await fetchTableColumnValues('saldo_ventas', 'id', 'app_db')
    expect(values).toEqual([1, 2])
    expect(runQuery).toHaveBeenCalledWith(expect.stringContaining('SELECT `id` FROM `app_db`.`saldo_ventas`'))
  })

  it('returns [] for unsafe identifiers without running SQL', async () => {
    const values = await fetchTableColumnValues("users; DROP TABLE users;--", 'id')
    expect(values).toEqual([])
    expect(runQuery).not.toHaveBeenCalled()
  })

  it('retries with Postgres-style double-quoted identifiers when the MySQL-style query throws', async () => {
    runQuery
      .mockRejectedValueOnce(new Error('syntax error near `'))
      .mockResolvedValueOnce({ results: [{ rows: [{ id: 7 }] }] })
    const values = await fetchTableColumnValues('orders', 'id', 'app_db')
    expect(values).toEqual([7])
    expect(runQuery).toHaveBeenCalledTimes(2)
    expect(runQuery).toHaveBeenNthCalledWith(2, expect.stringContaining('SELECT "id" FROM "app_db"."orders"'))
  })

  it('clamps an out-of-range limit instead of interpolating it verbatim', async () => {
    runQuery.mockResolvedValue({ results: [{ rows: [] }] })
    await fetchTableColumnValues('orders', 'id', 'app_db', 999999)
    expect(runQuery).toHaveBeenCalledWith(expect.stringContaining('LIMIT 1000'))
  })
})

describe('fetchTableRowCount', () => {
  it('queries and parses count from table', async () => {
    runQuery.mockResolvedValue({
      results: [{ rows: [{ cnt: 42 }] }]
    })
    const count = await fetchTableRowCount('users', 'app_db')
    expect(count).toBe(42)
  })

  it('returns 0 when query fails or identifier is unsafe', async () => {
    expect(await fetchTableRowCount("bad;table")).toBe(0)
    runQuery.mockRejectedValue(new Error('fail'))
    expect(await fetchTableRowCount('users', 'app_db')).toBe(0)
  })

  it('retries with Postgres-style quoting when the MySQL-style query throws', async () => {
    runQuery
      .mockRejectedValueOnce(new Error('syntax error near `'))
      .mockResolvedValueOnce({ results: [{ rows: [{ cnt: 9 }] }] })
    expect(await fetchTableRowCount('orders', 'app_db')).toBe(9)
    expect(runQuery).toHaveBeenNthCalledWith(2, expect.stringContaining('"app_db"."orders"'))
  })
})

describe('fetchTableMaxId', () => {
  it('queries and returns max ID', async () => {
    runQuery.mockResolvedValue({
      results: [{ rows: [{ max_id: 150 }] }]
    })
    const max = await fetchTableMaxId('orders', 'id', 'app_db')
    expect(max).toBe(150)
  })

  it('retries with Postgres-style quoting when the MySQL-style query throws', async () => {
    runQuery
      .mockRejectedValueOnce(new Error('syntax error near `'))
      .mockResolvedValueOnce({ results: [{ rows: [{ max_id: 88 }] }] })
    expect(await fetchTableMaxId('orders', 'id', 'app_db')).toBe(88)
    expect(runQuery).toHaveBeenNthCalledWith(2, expect.stringContaining('MAX("id")'))
  })

  it('returns 0 for unsafe identifiers or failed queries', async () => {
    expect(await fetchTableMaxId("bad;table")).toBe(0)
    runQuery.mockRejectedValue(new Error('fail'))
    expect(await fetchTableMaxId('orders')).toBe(0)
  })
})

describe('findMatchingTable', () => {
  const tables = ['saldo_ventas', 'acre_ventas', 'users', 'categories', 'ciudades', 'productos']

  it.each([
    ['saldo_venta_id', 'saldo_ventas'],
    ['acre_venta_id', 'acre_ventas'],
    ['user_id', 'users'],
    ['category_id', 'categories'],
    ['ciudad_id', 'ciudades'],
    ['producto_id', 'productos']
  ])('matches %s to %s', (column, expected) => {
    expect(findMatchingTable(column, tables)).toBe(expected)
  })

  it('returns null for non-id columns or unknown tables', async () => {
    expect(findMatchingTable('email', tables)).toBeNull()
    expect(findMatchingTable('created_at', tables)).toBeNull()
    expect(findMatchingTable('inexistent_id', tables)).toBeNull()
  })
})

describe('generateUuidV7', () => {
  it('generates a valid RFC 9562 UUIDv7 string', () => {
    const uuid = generateUuidV7()
    expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  })

  it('generates chronologically sortable UUIDs when time advances', async () => {
    const id1 = generateUuidV7()
    // Small delay to ensure timestamp difference
    await new Promise((r) => setTimeout(r, 5))
    const id2 = generateUuidV7()
    expect(id1 < id2).toBe(true)
  })

  it('works with fallback when crypto.getRandomValues is undefined', () => {
    const originalCrypto = globalThis.crypto
    try {
      // @ts-ignore
      delete globalThis.crypto
      const uuid = generateUuidV7()
      expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    } finally {
      globalThis.crypto = originalCrypto
    }
  })
})

describe('openQueryInBeekeeper', () => {
  it('calls openTab with type "query" and the provided SQL', async () => {
    openTab.mockResolvedValue(undefined)
    const result = await openQueryInBeekeeper('SELECT * FROM users;')
    expect(result).toBe(true)
    expect(openTab).toHaveBeenCalledWith('query', { query: 'SELECT * FROM users;' })
  })

  it('returns false when openTab throws', async () => {
    openTab.mockRejectedValue(new Error('failed to open tab'))
    const result = await openQueryInBeekeeper('SELECT 1;')
    expect(result).toBe(false)
  })
})

describe('openTableInBeekeeper', () => {
  it('calls openTab with type "tableTable" and table info', async () => {
    openTab.mockResolvedValue(undefined)
    const result = await openTableInBeekeeper('users', 'public', 'mydb')
    expect(result).toBe(true)
    expect(openTab).toHaveBeenCalledWith('tableTable', { table: 'users', schema: 'public', database: 'mydb' })
  })

  it('returns false on error', async () => {
    openTab.mockRejectedValue(new Error('fail'))
    const result = await openTableInBeekeeper('users')
    expect(result).toBe(false)
  })
})

describe('confirmAction', () => {
  it('uses Beekeeper SDK confirm method when available', async () => {
    confirmMock.mockResolvedValue(true)
    const res = await confirmAction('¿Continuar?', 'Alerta')
    expect(res).toBe(true)
    expect(confirmMock).toHaveBeenCalledWith('Alerta', '¿Continuar?', {
      confirmLabel: 'Continuar',
      cancelLabel: 'Cancelar'
    })
  })

  it('falls back to window.confirm when SDK confirm throws or fails', async () => {
    confirmMock.mockRejectedValue(new Error('no sdk confirm'))
    const winConfirm = vi.fn().mockReturnValue(true)
    vi.stubGlobal('confirm', winConfirm)
    const res = await confirmAction('¿Seguro?')
    expect(res).toBe(true)
    expect(winConfirm).toHaveBeenCalledWith(expect.stringContaining('¿Seguro?'))
  })
})

describe('exportToFile', () => {
  it('uses requestFileSave when available', async () => {
    requestFileSave.mockResolvedValue(undefined)
    const res = await exportToFile('SELECT 1;', 'test.sql', [{ name: 'SQL Files', extensions: ['sql'] }])
    expect(res).toBe(true)
    expect(requestFileSave).toHaveBeenCalledWith({
      data: 'SELECT 1;',
      fileName: 'test.sql',
      encoding: 'utf8',
      filters: [{ name: 'SQL Files', extensions: ['sql'] }]
    })
  })

  it('falls back to DOM Blob download when requestFileSave fails', async () => {
    requestFileSave.mockRejectedValue(new Error('not in beekeeper'))
    const clickSpy = vi.fn()
    const appendSpy = vi.spyOn(document.body, 'appendChild').mockImplementation((node: any) => node)
    const removeSpy = vi.spyOn(document.body, 'removeChild').mockImplementation((node: any) => node)
    const createElementSpy = vi.spyOn(document, 'createElement').mockReturnValue({
      click: clickSpy,
      setAttribute: vi.fn(),
      style: {}
    } as any)

    const res = await exportToFile('data content', 'test.csv')
    expect(res).toBe(true)
    expect(clickSpy).toHaveBeenCalled()

    appendSpy.mockRestore()
    removeSpy.mockRestore()
    createElementSpy.mockRestore()
  })
})

describe('fetchViewContext & extractTableFromViewContext', () => {
  it('fetches view context from SDK', async () => {
    getViewContext.mockResolvedValue({ command: 'open-db-manager-table', params: { table: 'customers' } })
    const ctx = await fetchViewContext()
    expect(ctx).toEqual({ command: 'open-db-manager-table', params: { table: 'customers' } })
  })

  it('returns null when getViewContext throws', async () => {
    getViewContext.mockRejectedValue(new Error('fail'))
    expect(await fetchViewContext()).toBeNull()
  })

  it.each([
    [{ params: { table: 'orders' } }, 'orders'],
    [{ params: { tableName: 'products' } }, 'products'],
    [{ params: { target: { table: 'users' } } }, 'users'],
    [{ params: { target: { type: 'table', name: 'invoices' } } }, 'invoices'],
    [{ params: 'customers' }, 'customers'],
    [null, null],
    [{}, null],
    [{ params: {} }, null]
  ])('extractTableFromViewContext parses %j into %s', (ctx, expected) => {
    expect(extractTableFromViewContext(ctx)).toBe(expected)
  })
})



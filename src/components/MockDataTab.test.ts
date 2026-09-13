import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'

const fetchDatabases = vi.fn()
const fetchTables = vi.fn()
const fetchTablesForDatabase = vi.fn()
const fetchColumns = vi.fn()
const fetchCurrentConnection = vi.fn()
const fetchTableForeignKeys = vi.fn()
const fetchTableMaxId = vi.fn()
const fetchTableRowCount = vi.fn()
const fetchTableColumnValues = vi.fn()
const executeQuery = vi.fn()
const showNotification = vi.fn()
const confirmAction = vi.fn()
const openQueryInBeekeeper = vi.fn()
const exportToFile = vi.fn()

vi.mock('../services/beekeeper', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/beekeeper')>()
  return {
    ...actual,
    fetchDatabases: (...args: any[]) => fetchDatabases(...args),
    fetchTables: (...args: any[]) => fetchTables(...args),
    fetchTablesForDatabase: (...args: any[]) => fetchTablesForDatabase(...args),
    fetchColumns: (...args: any[]) => fetchColumns(...args),
    fetchCurrentConnection: (...args: any[]) => fetchCurrentConnection(...args),
    fetchTableForeignKeys: (...args: any[]) => fetchTableForeignKeys(...args),
    fetchTableMaxId: (...args: any[]) => fetchTableMaxId(...args),
    fetchTableRowCount: (...args: any[]) => fetchTableRowCount(...args),
    fetchTableColumnValues: (...args: any[]) => fetchTableColumnValues(...args),
    executeQuery: (...args: any[]) => executeQuery(...args),
    showNotification: (...args: any[]) => showNotification(...args),
    confirmAction: (...args: any[]) => confirmAction(...args),
    openQueryInBeekeeper: (...args: any[]) => openQueryInBeekeeper(...args),
    exportToFile: (...args: any[]) => exportToFile(...args)
  }
})

import MockDataTab from './MockDataTab.vue'

let wrapper: VueWrapper<any> | null = null

const idColumn = { name: 'id', type: 'int(11) auto_increment' }
const emailColumn = { name: 'email', type: 'varchar(255)' }
const nameColumn = { name: 'first_name', type: 'varchar(255)' }

beforeEach(() => {
  fetchDatabases.mockReset().mockResolvedValue(['app_db', 'other_db'])
  fetchTables.mockReset().mockResolvedValue([])
  fetchTablesForDatabase.mockReset().mockResolvedValue([
    { name: 'users', schema: 'app_db' },
    { name: 'saldo_ventas', schema: 'app_db' },
    { name: 'ventas', schema: 'app_db' }
  ])
  fetchColumns.mockReset().mockResolvedValue([idColumn, emailColumn, nameColumn])
  fetchCurrentConnection.mockReset().mockResolvedValue({ connectionName: 'Docker', databaseName: 'app_db', databaseType: 'mysql' })
  fetchTableForeignKeys.mockReset().mockResolvedValue([])
  fetchTableMaxId.mockReset().mockResolvedValue(0)
  fetchTableRowCount.mockReset().mockResolvedValue(0)
  fetchTableColumnValues.mockReset().mockResolvedValue([])
  executeQuery.mockReset().mockResolvedValue({ results: [{ rows: [] }] })
  showNotification.mockReset()
  confirmAction.mockReset().mockResolvedValue(true)
  openQueryInBeekeeper.mockReset().mockResolvedValue(true)
  exportToFile.mockReset().mockResolvedValue(true)
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
})

async function mountTab() {
  wrapper = mount(MockDataTab)
  for (let i = 0; i < 10; i++) {
    await flushPromises()
  }
  return wrapper
}

describe('MockDataTab', () => {
  it('loads databases and auto-selects the first table with its columns on mount', async () => {
    await mountTab()
    expect(fetchDatabases).toHaveBeenCalled()
    expect(fetchTablesForDatabase).toHaveBeenCalledWith('app_db')
    expect(fetchColumns).toHaveBeenCalledWith('users', 'app_db')
    expect(wrapper!.text()).toContain('Columnas detectadas (3)')
    expect(wrapper!.text()).toContain('id')
    expect(wrapper!.text()).toContain('email')
  })

  it('infers sequential IDs for id column and appropriate faker generators for other columns', async () => {
    await mountTab()
    expect(wrapper!.text()).toContain('ID Secuencial')
    expect(wrapper!.text()).toContain('faker.email')
    expect(wrapper!.text()).toContain('faker.firstName')
  })

  it('generates the requested number of preview rows with sequential IDs', async () => {
    await mountTab()
    const rowCountInput = wrapper!.find('input[type="number"]')
    await rowCountInput.setValue(5)

    const previewBtn = wrapper!.findAll('button').find((b) => b.text().includes('Previsualizar'))
    await previewBtn!.trigger('click')
    await flushPromises()

    expect(wrapper!.text()).toContain('Previsualización (5 filas generadas)')
    const rows = wrapper!.findAll('tbody tr')
    expect(rows).toHaveLength(5)

    // id column is generated sequentially starting at 1
    const firstRowCells = rows[0].findAll('td')
    expect(firstRowCells[0].text()).toBe('1')
    expect(firstRowCells[1].text()).toContain('@')
  })

  it('generates plausible-looking emails for an email column', async () => {
    await mountTab()
    const previewBtn = wrapper!.findAll('button').find((b) => b.text().includes('Previsualizar'))
    await previewBtn!.trigger('click')
    await flushPromises()

    const firstRowCells = wrapper!.findAll('tbody tr')[0].findAll('td')
    expect(firstRowCells[1].text()).toContain('@')
  })

  it('inserts the generated rows via executeQuery with generated IDs and columns', async () => {
    await mountTab()
    const previewBtn = wrapper!.findAll('button').find((b) => b.text().includes('Previsualizar'))
    await previewBtn!.trigger('click')
    await flushPromises()

    const insertBtn = wrapper!.findAll('button').find((b) => b.text().includes('Insertar en Base de Datos'))
    await insertBtn!.trigger('click')
    await flushPromises()

    expect(executeQuery).toHaveBeenCalledTimes(1)
    const query = executeQuery.mock.calls[0][0] as string
    expect(query).toContain('INSERT INTO `app_db`.`users`')
    expect(query).toContain('`id`')
    expect(query).toContain('`email`')
    expect(query).toContain('`first_name`')
    expect(showNotification).toHaveBeenCalledWith(expect.stringContaining('éxito'), 'success')
  })

  it('omits id column when generator is switched to db_auto', async () => {
    await mountTab()
    // Change id generator select to db_auto
    const selects = wrapper!.findAll('select')
    const idGenSelect = selects[0]
    await idGenSelect.setValue('db_auto')
    await flushPromises()

    const previewBtn = wrapper!.findAll('button').find((b) => b.text().includes('Previsualizar'))
    await previewBtn!.trigger('click')
    await flushPromises()

    const insertBtn = wrapper!.findAll('button').find((b) => b.text().includes('Insertar en Base de Datos'))
    await insertBtn!.trigger('click')
    await flushPromises()

    const query = executeQuery.mock.calls[0][0] as string
    expect(query).not.toContain('`id`')
  })

  it('detects foreign key columns and auto-suggests the matching referenced table', async () => {
    fetchColumns.mockResolvedValue([
      { name: 'id', type: 'bigint unsigned' },
      { name: 'saldo_venta_id', type: 'bigint unsigned' },
      { name: 'cantidad', type: 'double(10,2)' }
    ])
    fetchTableRowCount.mockResolvedValue(15)
    fetchTableColumnValues.mockResolvedValue([101, 102, 103])

    await mountTab()

    // saldo_venta_id should be inferred as foreign_key with target saldo_ventas
    expect(wrapper!.text()).toContain('Clave Foránea (FK)')
    expect(wrapper!.text()).toContain('saldo_ventas')
    expect(wrapper!.text()).toContain('15 filas')
    expect(wrapper!.text()).toContain('faker.decimal')
  })

  it('warns when a foreign key table has 0 rows and offers a button to populate it', async () => {
    fetchColumns.mockResolvedValue([
      { name: 'id', type: 'bigint unsigned' },
      { name: 'saldo_venta_id', type: 'bigint unsigned' }
    ])
    fetchTableRowCount.mockResolvedValue(0)
    fetchTableColumnValues.mockResolvedValue([])

    await mountTab()

    expect(wrapper!.text()).toContain('Tablas relacionadas vacías detectadas')
    expect(wrapper!.text()).toContain('Poblar "saldo_ventas"')

    // Clicking populate switches table to saldo_ventas
    const populateBtn = wrapper!.findAll('button').find((b) => b.text().includes('Poblar "saldo_ventas"'))
    await populateBtn!.trigger('click')
    await flushPromises()

    expect(wrapper!.text()).toContain('Poblando tabla padre saldo_ventas')
    expect(wrapper!.text()).toContain('Volver a users')
  })

  it('unwinds a nested empty-FK chain one level at a time (users -> saldo_ventas -> ventas -> back -> back)', async () => {
    // users.saldo_venta_id -> saldo_ventas (empty); saldo_ventas.venta_id -> ventas (empty); ventas has no FKs.
    fetchColumns.mockImplementation((tableName: string) => {
      if (tableName === 'users') {
        return Promise.resolve([{ name: 'id', type: 'bigint unsigned' }, { name: 'saldo_venta_id', type: 'bigint unsigned' }])
      }
      if (tableName === 'saldo_ventas') {
        return Promise.resolve([{ name: 'id', type: 'bigint unsigned' }, { name: 'venta_id', type: 'bigint unsigned' }])
      }
      return Promise.resolve([{ name: 'id', type: 'bigint unsigned' }])
    })
    // fetchTableRowCount/fetchTableColumnValues keep the beforeEach default
    // (0 rows, no values) for every table, so each level of the chain is
    // detected as an empty FK — the point of this test is unwinding the
    // navigation stack, not the FK-emptiness detection itself.

    await mountTab()

    // Level 1: users -> saldo_ventas
    let populateBtn = wrapper!.findAll('button').find((b) => b.text().includes('Poblar "saldo_ventas"'))
    await populateBtn!.trigger('click')
    await flushPromises()
    expect(wrapper!.text()).toContain('Volver a users')

    // Level 2: saldo_ventas -> ventas
    populateBtn = wrapper!.findAll('button').find((b) => b.text().includes('Poblar "ventas"'))
    await populateBtn!.trigger('click')
    await flushPromises()
    expect(wrapper!.text()).toContain('Volver a saldo_ventas')

    // Unwind level 2: back to saldo_ventas (not straight to users)
    let backBtn = wrapper!.findAll('button').find((b) => b.text().includes('Volver a saldo_ventas'))
    await backBtn!.trigger('click')
    await flushPromises()
    expect(wrapper!.text()).toContain('Volver a users')
    expect(wrapper!.text()).not.toContain('Volver a saldo_ventas')

    // Unwind level 1: back to users, nothing left to return to
    backBtn = wrapper!.findAll('button').find((b) => b.text().includes('Volver a users'))
    await backBtn!.trigger('click')
    await flushPromises()
    expect(wrapper!.text()).not.toContain('Volver a')
  })

  it('handles a branching FK tree (users -> {clientes, productos}, clientes -> ciudades, productos -> categorias)', async () => {
    fetchTablesForDatabase.mockResolvedValue([
      { name: 'users', schema: 'app_db' },
      { name: 'clientes', schema: 'app_db' },
      { name: 'productos', schema: 'app_db' },
      { name: 'ciudades', schema: 'app_db' },
      { name: 'categorias', schema: 'app_db' }
    ])
    fetchColumns.mockImplementation((tableName: string) => {
      if (tableName === 'users') {
        return Promise.resolve([
          { name: 'id', type: 'bigint unsigned' },
          { name: 'cliente_id', type: 'bigint unsigned' },
          { name: 'producto_id', type: 'bigint unsigned' }
        ])
      }
      if (tableName === 'clientes') {
        return Promise.resolve([{ name: 'id', type: 'bigint unsigned' }, { name: 'ciudad_id', type: 'bigint unsigned' }])
      }
      if (tableName === 'productos') {
        return Promise.resolve([{ name: 'id', type: 'bigint unsigned' }, { name: 'categoria_id', type: 'bigint unsigned' }])
      }
      return Promise.resolve([{ name: 'id', type: 'bigint unsigned' }])
    })
    // Every table reports 0 rows (beforeEach default): nothing is ever
    // actually inserted in this test, so every FK on every table stays
    // "empty" for as long as it remains unvisited/untouched.

    await mountTab()

    // At the root (users), BOTH empty FKs must be surfaced at once.
    expect(wrapper!.text()).toContain('Poblar "clientes"')
    expect(wrapper!.text()).toContain('Poblar "productos"')

    // --- Branch 1: users -> clientes -> ciudades -> back -> back ---
    let btn = wrapper!.findAll('button').find((b) => b.text().includes('Poblar "clientes"'))
    await btn!.trigger('click')
    await flushPromises()
    expect(wrapper!.text()).toContain('Volver a users')
    expect(wrapper!.text()).toContain('Poblar "ciudades"')

    btn = wrapper!.findAll('button').find((b) => b.text().includes('Poblar "ciudades"'))
    await btn!.trigger('click')
    await flushPromises()
    expect(wrapper!.text()).toContain('Volver a clientes')

    btn = wrapper!.findAll('button').find((b) => b.text().includes('Volver a clientes'))
    await btn!.trigger('click')
    await flushPromises()
    expect(wrapper!.text()).toContain('Volver a users')

    btn = wrapper!.findAll('button').find((b) => b.text().includes('Volver a users'))
    await btn!.trigger('click')
    await flushPromises()

    // Back at the root: the untouched second branch (productos) must still
    // be offered — landing back on a table always re-scans ALL of its FK
    // columns fresh, not just the one that originated the trip just taken.
    expect(wrapper!.text()).not.toContain('Volver a')
    expect(wrapper!.text()).toContain('Poblar "clientes"')
    expect(wrapper!.text()).toContain('Poblar "productos"')

    // --- Branch 2: users -> productos -> categorias -> back -> back ---
    btn = wrapper!.findAll('button').find((b) => b.text().includes('Poblar "productos"'))
    await btn!.trigger('click')
    await flushPromises()
    expect(wrapper!.text()).toContain('Volver a users')
    expect(wrapper!.text()).toContain('Poblar "categorias"')

    btn = wrapper!.findAll('button').find((b) => b.text().includes('Poblar "categorias"'))
    await btn!.trigger('click')
    await flushPromises()
    expect(wrapper!.text()).toContain('Volver a productos')

    btn = wrapper!.findAll('button').find((b) => b.text().includes('Volver a productos'))
    await btn!.trigger('click')
    await flushPromises()
    expect(wrapper!.text()).toContain('Volver a users')

    btn = wrapper!.findAll('button').find((b) => b.text().includes('Volver a users'))
    await btn!.trigger('click')
    await flushPromises()
    expect(wrapper!.text()).not.toContain('Volver a')
  })

  it('guards against a circular required-FK dependency (users -> clientes -> users) instead of looping forever', async () => {
    fetchTablesForDatabase.mockResolvedValue([
      { name: 'users', schema: 'app_db' },
      { name: 'clientes', schema: 'app_db' }
    ])
    fetchColumns.mockImplementation((tableName: string) => {
      if (tableName === 'users') {
        return Promise.resolve([{ name: 'id', type: 'bigint unsigned' }, { name: 'cliente_id', type: 'bigint unsigned' }])
      }
      // clientes.user_id -> users: a required FK back to the table that got us here.
      return Promise.resolve([{ name: 'id', type: 'bigint unsigned' }, { name: 'user_id', type: 'bigint unsigned' }])
    })

    await mountTab()

    // users -> clientes
    let btn = wrapper!.findAll('button').find((b) => b.text().includes('Poblar "clientes"'))
    await btn!.trigger('click')
    await flushPromises()
    expect(wrapper!.text()).toContain('Volver a users')

    // clientes' own FK back to "users" is on the current path: the button
    // must be disabled and flagged as a cycle instead of offered normally.
    // A real disabled <button> never dispatches a click at all (browser and
    // jsdom both block it), so the UI-level disable IS the enforcement here;
    // there is nothing left to click.
    const cycleBtn = wrapper!.findAll('button').find((b) => b.text().includes('Poblar "users"'))
    expect(cycleBtn).toBeTruthy()
    expect(cycleBtn!.attributes('disabled')).toBeDefined()
    expect(cycleBtn!.attributes('title')).toContain('Dependencia circular')
    expect(wrapper!.text()).toContain('(ciclo)')
    expect(wrapper!.text()).not.toContain('Volver a clientes')
  })

  it('refuses to insert and shows an error when the table name is unsafe (SQL injection guard)', async () => {
    fetchTablesForDatabase.mockResolvedValue([{ name: "users`; DROP TABLE users;--", schema: 'app_db' }])
    await mountTab()

    const previewBtn = wrapper!.findAll('button').find((b) => b.text().includes('Previsualizar'))
    await previewBtn!.trigger('click')
    await flushPromises()

    const insertBtn = wrapper!.findAll('button').find((b) => b.text().includes('Insertar en Base de Datos'))
    await insertBtn!.trigger('click')
    await flushPromises()

    expect(executeQuery).not.toHaveBeenCalled()
    expect(showNotification).toHaveBeenCalledWith(expect.stringContaining('inválido'), 'error')
  })

  it('shows an error notification when the insert query fails', async () => {
    executeQuery.mockRejectedValue(new Error('Access denied'))
    await mountTab()

    const previewBtn = wrapper!.findAll('button').find((b) => b.text().includes('Previsualizar'))
    await previewBtn!.trigger('click')
    await flushPromises()

    const insertBtn = wrapper!.findAll('button').find((b) => b.text().includes('Insertar en Base de Datos'))
    await insertBtn!.trigger('click')
    await flushPromises()

    expect(showNotification).toHaveBeenCalledWith(expect.stringContaining('Access denied'), 'error')
  })

  it('reloads tables for the newly selected database when the DB selector changes', async () => {
    await mountTab()
    fetchTablesForDatabase.mockResolvedValue([{ name: 'orders', schema: 'other_db' }])

    const dbInput = wrapper!.findAll('input')[0]
    await dbInput.trigger('focus')
    await dbInput.setValue('other_db')
    await dbInput.trigger('keydown', { key: 'Enter' })
    await flushPromises()

    expect(fetchTablesForDatabase).toHaveBeenLastCalledWith('other_db')
  })

  it('disables the preview button until a table is selected', async () => {
    fetchTablesForDatabase.mockResolvedValue([])
    await mountTab()
    const previewBtn = wrapper!.findAll('button').find((b) => b.text().includes('Previsualizar'))
    expect(previewBtn!.attributes('disabled')).toBeDefined()
  })

  it('infers and generates UUIDv7 for UUID / char(36) ID columns', async () => {
    fetchColumns.mockResolvedValue([
      { name: 'id', type: 'char(36)' },
      { name: 'session_uuid', type: 'varchar(36)' },
      { name: 'name', type: 'varchar(100)' }
    ])

    await mountTab()

    expect(wrapper!.text()).toContain('UUID (v7 - Temporal)')

    const previewBtn = wrapper!.findAll('button').find((b) => b.text().includes('Previsualizar'))
    await previewBtn!.trigger('click')
    await flushPromises()

    const firstRowCells = wrapper!.findAll('tbody tr')[0].findAll('td')
    const idVal = firstRowCells[0].text()
    const sessionUuidVal = firstRowCells[1].text()

    // RFC 9562 UUIDv7 format with 7 in the version nibble
    expect(idVal).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(sessionUuidVal).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  })

  it('cancels insertion when user rejects the confirmation dialog', async () => {
    confirmAction.mockResolvedValue(false)
    await mountTab()

    const previewBtn = wrapper!.findAll('button').find((b) => b.text().includes('Previsualizar'))
    await previewBtn!.trigger('click')
    await flushPromises()

    const insertBtn = wrapper!.findAll('button').find((b) => b.text().includes('Insertar en Base de Datos'))
    await insertBtn!.trigger('click')
    await flushPromises()

    expect(confirmAction).toHaveBeenCalled()
    expect(executeQuery).not.toHaveBeenCalled()
  })

  it('opens generated INSERT SQL in Beekeeper editor', async () => {
    await mountTab()
    const previewBtn = wrapper!.findAll('button').find((b) => b.text().includes('Previsualizar'))
    await previewBtn!.trigger('click')
    await flushPromises()

    const openBtn = wrapper!.findAll('button').find((b) => b.text().includes('Abrir SQL en Editor'))
    expect(openBtn?.exists()).toBe(true)
    await openBtn!.trigger('click')
    await flushPromises()

    expect(openQueryInBeekeeper).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO `app_db`.`users`'))
    expect(showNotification).toHaveBeenCalledWith(expect.stringContaining('abierto en el editor'), 'success')
  })

  it('exports generated mock data as SQL, CSV and JSON files', async () => {
    await mountTab()
    const previewBtn = wrapper!.findAll('button').find((b) => b.text().includes('Previsualizar'))
    await previewBtn!.trigger('click')
    await flushPromises()

    // Export SQL
    const sqlBtn = wrapper!.findAll('button').find((b) => b.text().includes('Exportar .sql'))
    expect(sqlBtn?.exists()).toBe(true)
    await sqlBtn!.trigger('click')
    await flushPromises()
    expect(exportToFile).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO'),
      expect.stringContaining('seed_users_10rows.sql'),
      expect.any(Array)
    )

    // Export CSV
    const csvBtn = wrapper!.findAll('button').find((b) => b.text().includes('CSV'))
    expect(csvBtn?.exists()).toBe(true)
    await csvBtn!.trigger('click')
    await flushPromises()
    expect(exportToFile).toHaveBeenCalledWith(
      expect.stringContaining('id,email,first_name'),
      expect.stringContaining('mock_users_10rows.csv'),
      expect.any(Array)
    )

    // Export JSON
    const jsonBtn = wrapper!.findAll('button').find((b) => b.text().includes('JSON'))
    expect(jsonBtn?.exists()).toBe(true)
    await jsonBtn!.trigger('click')
    await flushPromises()
    expect(exportToFile).toHaveBeenCalledWith(
      expect.stringContaining('"id":'),
      expect.stringContaining('mock_users_10rows.json'),
      expect.any(Array)
    )
  })

  it('automatically selects initialTable when passed as prop', async () => {
    wrapper = mount(MockDataTab, {
      props: {
        initialTable: 'ventas'
      }
    })
    for (let i = 0; i < 10; i++) {
      await flushPromises()
    }

    const select = wrapper.findAllComponents({ name: 'SearchableSelect' })[1]
    expect(select.props('modelValue')).toBe('ventas')
  })
})



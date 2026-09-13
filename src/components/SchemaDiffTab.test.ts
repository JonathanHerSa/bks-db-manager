import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'

const getSavedConnections = vi.fn()
const getDatabasesList = vi.fn()
const inspectSchema = vi.fn()

const fetchDatabases = vi.fn()
const fetchCurrentConnection = vi.fn()
const executeQuery = vi.fn()
const copyToSystemClipboard = vi.fn()
const openQueryInBeekeeper = vi.fn()
const exportToFile = vi.fn()
const showNotification = vi.fn()

vi.mock('../services/companion', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/companion')>()
  return {
    ...actual,
    getSavedConnections: (...a: any[]) => getSavedConnections(...a),
    getDatabasesList: (...a: any[]) => getDatabasesList(...a),
    inspectSchema: (...a: any[]) => inspectSchema(...a)
  }
})

vi.mock('../services/beekeeper', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/beekeeper')>()
  return {
    ...actual,
    fetchDatabases: (...a: any[]) => fetchDatabases(...a),
    fetchCurrentConnection: (...a: any[]) => fetchCurrentConnection(...a),
    executeQuery: (...a: any[]) => executeQuery(...a),
    copyToSystemClipboard: (...a: any[]) => copyToSystemClipboard(...a),
    openQueryInBeekeeper: (...a: any[]) => openQueryInBeekeeper(...a),
    exportToFile: (...a: any[]) => exportToFile(...a),
    showNotification: (...a: any[]) => showNotification(...a)
  }
})

import SchemaDiffTab from './SchemaDiffTab.vue'

let wrapper: VueWrapper<any> | null = null

const dockerConn = { id: 1, name: 'Docker', motor: 'mysql', host: '127.0.0.1', port: 3307, user: 'root', hasPassword: false, isBeekeeper: true }
const prodConn = { id: 2, name: 'Produccion', motor: 'mysql', host: '10.0.0.5', port: 3306, user: 'root', hasPassword: true }

beforeEach(() => {
  getSavedConnections.mockReset().mockResolvedValue([dockerConn, prodConn])
  getDatabasesList.mockReset().mockResolvedValue(['app_db'])
  inspectSchema.mockReset().mockResolvedValue([])
  fetchDatabases.mockReset().mockResolvedValue(['app_db'])
  fetchCurrentConnection.mockReset().mockResolvedValue({ connectionName: 'Docker', databaseName: 'app_db', databaseType: 'mysql' })
  executeQuery.mockReset().mockResolvedValue({ results: [{ rows: [] }] })
  copyToSystemClipboard.mockReset().mockResolvedValue(true)
  openQueryInBeekeeper.mockReset().mockResolvedValue(true)
  exportToFile.mockReset().mockResolvedValue(true)
  showNotification.mockReset()
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
})

async function mountTab() {
  wrapper = mount(SchemaDiffTab)
  await flushPromises()
  return wrapper
}

describe('SchemaDiffTab', () => {
  it('loads saved connections and auto-selects source/target databases on mount', async () => {
    await mountTab()
    expect(getSavedConnections).toHaveBeenCalled()
    expect(fetchCurrentConnection).toHaveBeenCalled()
    // source uses the SDK-first path since Docker matches the active connection
    expect(fetchDatabases).toHaveBeenCalled()
  })

  it('reports missing tables, missing columns and type mismatches', async () => {
    inspectSchema
      .mockResolvedValueOnce([
        { table: 'users', column: 'id', type: 'int', nullable: 'NO', defaultVal: null },
        { table: 'users', column: 'email', type: 'varchar(255)', nullable: 'NO', defaultVal: null },
        { table: 'orders', column: 'id', type: 'int', nullable: 'NO', defaultVal: null }
      ])
      .mockResolvedValueOnce([
        { table: 'users', column: 'id', type: 'int', nullable: 'NO', defaultVal: null }
      ])

    await mountTab()
    const compareBtn = wrapper!.findAll('button').find((b) => b.text().includes('Comparar Esquemas'))
    await compareBtn!.trigger('click')
    await flushPromises()

    expect(wrapper!.text()).toContain('Tablas Faltantes en Destino')
    expect(wrapper!.text()).toContain('Tabla: ')
    expect(wrapper!.text()).toContain('orders')
    expect(wrapper!.text()).toContain('users.')
    expect(wrapper!.text()).toContain('email')
  })

  it('generates an ALTER TABLE script for missing columns', async () => {
    inspectSchema
      .mockResolvedValueOnce([
        { table: 'users', column: 'id', type: 'int', nullable: 'NO', defaultVal: null },
        { table: 'users', column: 'phone', type: 'varchar(20)', nullable: 'YES', defaultVal: null }
      ])
      .mockResolvedValueOnce([
        { table: 'users', column: 'id', type: 'int', nullable: 'NO', defaultVal: null }
      ])

    await mountTab()
    const compareBtn = wrapper!.findAll('button').find((b) => b.text().includes('Comparar Esquemas'))
    await compareBtn!.trigger('click')
    await flushPromises()

    expect(wrapper!.text()).toContain('ADD COLUMN `phone`')
  })

  it('shows a "schemas are identical" message when there is no diff', async () => {
    inspectSchema.mockResolvedValue([
      { table: 'users', column: 'id', type: 'int', nullable: 'NO', defaultVal: null }
    ])

    await mountTab()
    const compareBtn = wrapper!.findAll('button').find((b) => b.text().includes('Comparar Esquemas'))
    await compareBtn!.trigger('click')
    await flushPromises()

    expect(wrapper!.text()).toContain('Ambos esquemas son completamente idénticos')
  })

  it('refuses to compare when the source database name is unsafe (SQL injection guard)', async () => {
    getDatabasesList.mockResolvedValue(["app_db'; DROP TABLE users;--"])
    fetchDatabases.mockResolvedValue([])
    await mountTab()

    // sourceDb was auto-selected to the unsafe value; force the compare click
    const compareBtn = wrapper!.findAll('button').find((b) => b.text().includes('Comparar'))
    await compareBtn!.trigger('click')
    await flushPromises()

    expect(inspectSchema).not.toHaveBeenCalled()
    expect(executeQuery).not.toHaveBeenCalled()
  })

  it('swaps source and target connections/databases', async () => {
    await mountTab()
    const selects = wrapper!.findAll('select')
    // both selects should currently point at different connections after mount logic
    const beforeSrc = (selects[0].element as HTMLSelectElement).selectedIndex
    const beforeDst = (selects[1].element as HTMLSelectElement).selectedIndex

    const swapBtn = wrapper!.findAll('button').find((b) => b.text().includes('Intercambiar'))
    await swapBtn!.trigger('click')
    await flushPromises()

    const afterSrc = (selects[0].element as HTMLSelectElement).selectedIndex
    const afterDst = (selects[1].element as HTMLSelectElement).selectedIndex
    expect(afterSrc).toBe(beforeDst)
    expect(afterDst).toBe(beforeSrc)
  })

  it('copies the generated SQL to the clipboard', async () => {
    inspectSchema
      .mockResolvedValueOnce([{ table: 'users', column: 'id', type: 'int', nullable: 'NO', defaultVal: null }])
      .mockResolvedValueOnce([])

    await mountTab()
    const compareBtn = wrapper!.findAll('button').find((b) => b.text().includes('Comparar Esquemas'))
    await compareBtn!.trigger('click')
    await flushPromises()

    const copyBtn = wrapper!.findAll('button').find((b) => b.text().includes('Copiar SQL'))
    await copyBtn!.trigger('click')
    await flushPromises()

    expect(copyToSystemClipboard).toHaveBeenCalledWith(expect.stringContaining('CREATE TABLE'))
  })

  it('opens the generated migration SQL in Beekeeper editor', async () => {
    inspectSchema
      .mockResolvedValueOnce([{ table: 'users', column: 'id', type: 'int', nullable: 'NO', defaultVal: null }])
      .mockResolvedValueOnce([])

    await mountTab()
    const compareBtn = wrapper!.findAll('button').find((b) => b.text().includes('Comparar Esquemas'))
    await compareBtn!.trigger('click')
    await flushPromises()

    const openBtn = wrapper!.findAll('button').find((b) => b.text().includes('Abrir en Editor'))
    expect(openBtn?.exists()).toBe(true)
    await openBtn!.trigger('click')
    await flushPromises()

    expect(openQueryInBeekeeper).toHaveBeenCalledWith(expect.stringContaining('CREATE TABLE'))
    expect(showNotification).toHaveBeenCalledWith(expect.stringContaining('abierto en una nueva pestaña'), 'success')
  })

  it('saves the generated migration SQL to a file using exportToFile', async () => {
    inspectSchema
      .mockResolvedValueOnce([{ table: 'users', column: 'id', type: 'int', nullable: 'NO', defaultVal: null }])
      .mockResolvedValueOnce([])

    await mountTab()
    const compareBtn = wrapper!.findAll('button').find((b) => b.text().includes('Comparar Esquemas'))
    await compareBtn!.trigger('click')
    await flushPromises()

    const saveBtn = wrapper!.findAll('button').find((b) => b.text().includes('Guardar .sql'))
    expect(saveBtn?.exists()).toBe(true)
    await saveBtn!.trigger('click')
    await flushPromises()

    expect(exportToFile).toHaveBeenCalledWith(
      expect.stringContaining('CREATE TABLE'),
      expect.stringContaining('.sql'),
      expect.any(Array)
    )
    expect(showNotification).toHaveBeenCalledWith(expect.stringContaining('exportado correctamente'), 'success')
  })

  it('switches dialect to PostgreSQL and regenerates Postgres DDL', async () => {
    inspectSchema
      .mockResolvedValueOnce([
        { table: 'users', column: 'id', type: 'int', nullable: 'NO', defaultVal: null },
        { table: 'users', column: 'bio', type: 'text', nullable: 'YES', defaultVal: null }
      ])
      .mockResolvedValueOnce([
        { table: 'users', column: 'id', type: 'int', nullable: 'NO', defaultVal: null }
      ])

    await mountTab()
    const compareBtn = wrapper!.findAll('button').find((b) => b.text().includes('Comparar Esquemas'))
    await compareBtn!.trigger('click')
    await flushPromises()

    // Switch dialect button to PostgreSQL
    const pgBtn = wrapper!.findAll('button').find((b) => b.text().includes('PostgreSQL'))
    expect(pgBtn?.exists()).toBe(true)
    await pgBtn!.trigger('click')
    await flushPromises()

    expect(wrapper!.text()).toContain('ALTER TABLE "users" ADD COLUMN "bio" text NULL;')
  })

  it('switches to Laravel Migration view and exports .php file', async () => {
    inspectSchema
      .mockResolvedValueOnce([
        { table: 'users', column: 'id', type: 'int', nullable: 'NO', defaultVal: null },
        { table: 'users', column: 'email', type: 'varchar(255)', nullable: 'NO', defaultVal: null }
      ])
      .mockResolvedValueOnce([
        { table: 'users', column: 'id', type: 'int', nullable: 'NO', defaultVal: null }
      ])

    await mountTab()
    const compareBtn = wrapper!.findAll('button').find((b) => b.text().includes('Comparar Esquemas'))
    await compareBtn!.trigger('click')
    await flushPromises()

    // Toggle Laravel Migration tab
    const laravelTabBtn = wrapper!.findAll('button').find((b) => b.text().includes('Laravel Migration'))
    expect(laravelTabBtn?.exists()).toBe(true)
    await laravelTabBtn!.trigger('click')
    await flushPromises()

    expect(wrapper!.text()).toContain('Blueprint')
    expect(wrapper!.text()).toContain("Schema::table('users'")
    expect(wrapper!.text()).toContain("string('email')")

    // Save as .php
    const savePhpBtn = wrapper!.findAll('button').find((b) => b.text().includes('Guardar .php'))
    expect(savePhpBtn?.exists()).toBe(true)
    await savePhpBtn!.trigger('click')
    await flushPromises()

    expect(exportToFile).toHaveBeenCalledWith(
      expect.stringContaining('Illuminate\\Database\\Migrations\\Migration'),
      expect.stringContaining('.php'),
      expect.any(Array)
    )
  })
})


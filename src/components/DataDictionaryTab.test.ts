import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'

const fetchDatabases = vi.fn()
const fetchCurrentConnection = vi.fn()
const fetchTablesForDatabase = vi.fn()
const fetchColumns = vi.fn()
const fetchTableForeignKeys = vi.fn()
const fetchTableRowCount = vi.fn()
const copyToSystemClipboard = vi.fn()
const exportToFile = vi.fn()
const showNotification = vi.fn()
const openTableInBeekeeper = vi.fn()

vi.mock('../services/beekeeper', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/beekeeper')>()
  return {
    ...actual,
    fetchDatabases: (...a: any[]) => fetchDatabases(...a),
    fetchCurrentConnection: (...a: any[]) => fetchCurrentConnection(...a),
    fetchTablesForDatabase: (...a: any[]) => fetchTablesForDatabase(...a),
    fetchColumns: (...a: any[]) => fetchColumns(...a),
    fetchTableForeignKeys: (...a: any[]) => fetchTableForeignKeys(...a),
    fetchTableRowCount: (...a: any[]) => fetchTableRowCount(...a),
    copyToSystemClipboard: (...a: any[]) => copyToSystemClipboard(...a),
    exportToFile: (...a: any[]) => exportToFile(...a),
    showNotification: (...a: any[]) => showNotification(...a),
    openTableInBeekeeper: (...a: any[]) => openTableInBeekeeper(...a)
  }
})

import DataDictionaryTab from './DataDictionaryTab.vue'

let wrapper: VueWrapper<any> | null = null

beforeEach(() => {
  fetchDatabases.mockReset().mockResolvedValue(['ecommerce_db', 'analytics_db'])
  fetchCurrentConnection.mockReset().mockResolvedValue({
    connectionName: 'Local MySQL',
    databaseName: 'ecommerce_db',
    databaseType: 'mysql'
  })
  fetchTablesForDatabase.mockReset().mockResolvedValue([
    { name: 'users' },
    { name: 'orders' }
  ])
  fetchColumns.mockReset().mockImplementation((tbl: string) => {
    if (tbl === 'users') {
      return Promise.resolve([
        { name: 'id', type: 'int' },
        { name: 'email', type: 'varchar(255)' }
      ])
    }
    return Promise.resolve([
      { name: 'id', type: 'int' },
      { name: 'user_id', type: 'int' },
      { name: 'total', type: 'decimal(10,2)' }
    ])
  })
  fetchTableForeignKeys.mockReset().mockImplementation((tbl: string) => {
    if (tbl === 'orders') {
      return Promise.resolve([
        { columnName: 'user_id', referencedTable: 'users', referencedColumn: 'id' }
      ])
    }
    return Promise.resolve([])
  })
  fetchTableRowCount.mockReset().mockImplementation((tbl: string) => {
    return Promise.resolve(tbl === 'users' ? 120 : 450)
  })
  copyToSystemClipboard.mockReset().mockResolvedValue(true)
  exportToFile.mockReset().mockResolvedValue(true)
  showNotification.mockReset()
  openTableInBeekeeper.mockReset().mockResolvedValue(true)
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
})

async function mountTab() {
  wrapper = mount(DataDictionaryTab)
  await flushPromises()
  return wrapper
}

describe('DataDictionaryTab', () => {
  it('mounts and analyzes the active database automatically', async () => {
    const w = await mountTab()
    expect(fetchDatabases).toHaveBeenCalled()
    expect(fetchTablesForDatabase).toHaveBeenCalledWith('ecommerce_db')
    const dbInput = w.find('input')
    expect((dbInput.element as HTMLInputElement).value).toBe('ecommerce_db')
    expect(w.text()).toContain('users')
    expect(w.text()).toContain('orders')
  })

  it('renders correct summary metrics for tables, columns and foreign keys', async () => {
    const w = await mountTab()
    // 2 tables, 5 columns (2 in users + 3 in orders), 1 FK
    expect(w.text()).toContain('2')
    expect(w.text()).toContain('5')
    expect(w.text()).toContain('1')
  })

  it('generates Mermaid ERD code including entities, types, and relations', async () => {
    const w = await mountTab()
    const mermaidPre = w.find('pre')
    expect(mermaidPre.exists()).toBe(true)
    const code = mermaidPre.text()
    expect(code).toContain('erDiagram')
    expect(code).toContain('users {')
    expect(code).toContain('orders {')
    expect(code).toContain('users ||--o{ orders : "user_id"')
  })

  it('switches between ERD, Dictionary, and Markdown views', async () => {
    const w = await mountTab()
    const buttons = w.findAll('button')

    // Find "Diccionario de Tablas" button
    const dictBtn = buttons.find((b) => b.text().includes('Diccionario de Tablas'))
    expect(dictBtn?.exists()).toBe(true)
    await dictBtn?.trigger('click')
    await flushPromises()

    expect(w.text()).toContain('Mostrando 2 de 2 tablas')
    expect(w.text()).toContain('PK (Clave Primaria)')
    expect(w.text()).toContain('FK ➔ users.id')

    // Find "Documento Markdown" button
    const mdBtn = w.findAll('button').find((b) => b.text().includes('Documento Markdown'))
    await mdBtn?.trigger('click')
    await flushPromises()

    expect(w.find('pre').text()).toContain('# 📖 Diccionario de Datos: `ecommerce_db`')
  })

  it('copies Mermaid code to clipboard when "Copiar Mermaid" is clicked', async () => {
    const w = await mountTab()
    const copyBtn = w.findAll('button').find((b) => b.text().includes('Copiar Mermaid'))
    expect(copyBtn?.exists()).toBe(true)
    await copyBtn?.trigger('click')
    await flushPromises()

    expect(copyToSystemClipboard).toHaveBeenCalledWith(expect.stringContaining('erDiagram'))
  })

  it('exports documentation using exportToFile', async () => {
    const w = await mountTab()
    const exportBtn = w.findAll('button').find((b) => b.text().includes('Exportar Markdown'))
    expect(exportBtn?.exists()).toBe(true)
    await exportBtn?.trigger('click')
    await flushPromises()

    expect(exportToFile).toHaveBeenCalledWith(
      expect.stringContaining('# 📖 Diccionario de Datos: `ecommerce_db`'),
      expect.stringContaining('DATA_DICTIONARY_ecommerce_db.md'),
      expect.any(Array)
    )
    expect(showNotification).toHaveBeenCalledWith(expect.stringContaining('exportado con éxito'), 'success')
  })

  it('calls openTableInBeekeeper when "Ver en Beekeeper" is clicked', async () => {
    const w = await mountTab()
    // Switch to dictionary view
    const dictBtn = w.findAll('button').find((b) => b.text().includes('Diccionario de Tablas'))
    await dictBtn?.trigger('click')
    await flushPromises()

    const openBtn = w.findAll('button').find((b) => b.text().includes('Ver en Beekeeper'))
    expect(openBtn?.exists()).toBe(true)
    await openBtn?.trigger('click')
    await flushPromises()

    expect(openTableInBeekeeper).toHaveBeenCalledWith('users', undefined, 'ecommerce_db')
  })
})

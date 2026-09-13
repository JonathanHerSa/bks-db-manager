import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'

const fetchCurrentConnection = vi.fn()
const fetchViewContext = vi.fn()
const extractTableFromViewContext = vi.fn()

vi.mock('./services/beekeeper', () => ({
  fetchCurrentConnection: (...args: any[]) => fetchCurrentConnection(...args),
  fetchViewContext: (...args: any[]) => fetchViewContext(...args),
  extractTableFromViewContext: (...args: any[]) => extractTableFromViewContext(...args)
}))

import App from './App.vue'

let wrapper: VueWrapper<any> | null = null

beforeEach(() => {
  fetchCurrentConnection.mockReset().mockResolvedValue({
    connectionName: 'Docker',
    databaseName: 'coorsamexico_finanzas',
    databaseType: 'mysql'
  })
  fetchViewContext.mockReset().mockResolvedValue(null)
  extractTableFromViewContext.mockReset().mockReturnValue(null)
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
})

// The tab components pull in the companion/beekeeper services and heavy
// dependencies (faker) that aren't relevant to App.vue's own responsibility
// (tab switching + showing the active connection), so stub them out via
// VTU's `stubs` option rather than mocking the .vue files directly, which
// doesn't play well with defineAsyncComponent's dynamic import().
async function mountApp() {
  wrapper = mount(App, {
    global: {
      stubs: {
        CloneStreamTab: { template: '<div>CloneStreamTab stub</div>' },
        SchemaDiffTab: { template: '<div>SchemaDiffTab stub</div>' },
        DiscoveryTab: { template: '<div>DiscoveryTab stub</div>' },
        MockDataTab: { template: '<div>MockDataTab stub</div>' },
        DataDictionaryTab: { template: '<div>DataDictionaryTab stub</div>' }
      }
    }
  })
  await flushPromises()
  return wrapper
}

describe('App', () => {
  it('shows the clone tab by default', async () => {
    await mountApp()
    expect(wrapper!.text()).toContain('CloneStreamTab stub')
  })

  it('displays the active Beekeeper connection once loaded', async () => {
    await mountApp()
    expect(wrapper!.text()).toContain('Docker')
    expect(wrapper!.text()).toContain('coorsamexico_finanzas')
  })

  it('shows "Detectando..." while the connection is not yet resolved', () => {
    fetchCurrentConnection.mockReturnValue(new Promise(() => {}))
    wrapper = mount(App, {
      global: {
        stubs: {
          CloneStreamTab: { template: '<div>CloneStreamTab stub</div>' },
          SchemaDiffTab: { template: '<div>SchemaDiffTab stub</div>' },
          DiscoveryTab: { template: '<div>DiscoveryTab stub</div>' },
          MockDataTab: { template: '<div>MockDataTab stub</div>' }
        }
      }
    })
    expect(wrapper.text()).toContain('Detectando...')
  })

  it('switches to the Schema Diff tab when clicked', async () => {
    await mountApp()
    const tabBtn = wrapper!.findAll('button').find((b) => b.text().includes('Schema Diff & Migraciones'))
    await tabBtn!.trigger('click')
    await flushPromises()
    expect(wrapper!.text()).toContain('SchemaDiffTab stub')
    expect(wrapper!.text()).not.toContain('CloneStreamTab stub')
  })

  it('switches to the Mock Data tab when clicked', async () => {
    await mountApp()
    const tabBtn = wrapper!.findAll('button').find((b) => b.text().includes('Mock Data Generator'))
    await tabBtn!.trigger('click')
    await flushPromises()
    expect(wrapper!.text()).toContain('MockDataTab stub')
  })

  it('switches to the Auto-Discovery tab when clicked', async () => {
    await mountApp()
    const tabBtn = wrapper!.findAll('button').find((b) => b.text().includes('Auto-Discovery (Docker & .env)'))
    await tabBtn!.trigger('click')
    await flushPromises()
    expect(wrapper!.text()).toContain('DiscoveryTab stub')
  })

  it('switches to the Diccionario de Datos tab when clicked', async () => {
    await mountApp()
    const tabBtn = wrapper!.findAll('button').find((b) => b.text().includes('Diccionario de Datos & ERD'))
    await tabBtn!.trigger('click')
    await flushPromises()
    expect(wrapper!.text()).toContain('DataDictionaryTab stub')
  })

  it('automatically opens Mock Data tab when launched from context menu with a table', async () => {
    fetchViewContext.mockResolvedValue({ command: 'open-db-manager-table', params: { table: 'invoices' } })
    extractTableFromViewContext.mockReturnValue('invoices')
    await mountApp()
    expect(wrapper!.text()).toContain('MockDataTab stub')
  })
})

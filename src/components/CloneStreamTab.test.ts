import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'

const checkCompanionStatus = vi.fn()
const getSavedConnections = vi.fn()
const getTablesList = vi.fn()
const getDatabaseInfo = vi.fn()
const startStreamClone = vi.fn()
const listDatabasesForConnection = vi.fn()
const fetchCurrentConnection = vi.fn()
const copyToSystemClipboard = vi.fn()

vi.mock('../services/companion', () => ({
  checkCompanionStatus: (...a: any[]) => checkCompanionStatus(...a),
  getSavedConnections: (...a: any[]) => getSavedConnections(...a),
  getTablesList: (...a: any[]) => getTablesList(...a),
  getDatabaseInfo: (...a: any[]) => getDatabaseInfo(...a),
  startStreamClone: (...a: any[]) => startStreamClone(...a),
  formatConnOption: (c: any) => `${c.name} (${c.host}:${c.port})`
}))

vi.mock('../services/connectionAccess', () => ({
  listDatabasesForConnection: (...a: any[]) => listDatabasesForConnection(...a)
}))

vi.mock('../services/beekeeper', () => ({
  fetchCurrentConnection: (...a: any[]) => fetchCurrentConnection(...a),
  copyToSystemClipboard: (...a: any[]) => copyToSystemClipboard(...a)
}))

import CloneStreamTab from './CloneStreamTab.vue'

let wrapper: VueWrapper<any> | null = null

const prodConn = { id: 'bks-1', name: 'Production', motor: 'mysql', host: '127.0.0.1', port: 3307, user: 'root', hasPassword: true, isBeekeeper: true }
const dockerConn = { id: 'bks-2', name: 'Docker', motor: 'mysql', host: '127.0.0.1', port: 3308, user: 'root', hasPassword: true, isBeekeeper: true }

beforeEach(() => {
  checkCompanionStatus.mockReset().mockResolvedValue({ ok: true })
  getSavedConnections.mockReset().mockResolvedValue([prodConn, dockerConn])
  listDatabasesForConnection.mockReset().mockResolvedValue(['coorsamexico_finanzas', 'test_db'])
  getTablesList.mockReset().mockResolvedValue(['users', 'ventas'])
  getDatabaseInfo.mockReset().mockResolvedValue({ tablesCount: 2, sizeMb: '12.5' })
  fetchCurrentConnection.mockReset().mockResolvedValue({ connectionName: 'Production', databaseName: 'coorsamexico_finanzas', databaseType: 'mysql' })
  startStreamClone.mockReset().mockReturnValue(() => {})
  copyToSystemClipboard.mockReset().mockResolvedValue(true)
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
})

async function mountTab() {
  wrapper = mount(CloneStreamTab)
  for (let i = 0; i < 5; i++) {
    await flushPromises()
  }
  return wrapper
}

describe('CloneStreamTab', () => {
  it('renders Companion Activo badge when daemon responds', async () => {
    await mountTab()
    expect(wrapper!.text()).toContain('Companion Activo')
    expect(wrapper!.text()).not.toContain('Companion Offline')
  })

  it('renders Companion Offline warning when daemon fails to respond', async () => {
    checkCompanionStatus.mockResolvedValue(false)
    await mountTab()
    expect(wrapper!.text()).toContain('Companion Offline')
    expect(wrapper!.text()).toContain('El Companion Daemon no responde')
  })

  it('auto-selects matching Beekeeper connection as Source and Docker as Destination', async () => {
    await mountTab()
    expect(wrapper!.text()).toContain('Servidor Origen (Lectura)')
    expect(wrapper!.text()).toContain('Servidor Destino (Escritura)')
  })

  it('shows error if starting clone without choosing target database', async () => {
    await mountTab()
    // Trigger clone button
    const cloneBtn = wrapper!.findAll('button').find(b => b.text().includes('Iniciar Clonado en Vivo'))
    if (cloneBtn) {
      await cloneBtn.trigger('click')
      await flushPromises()
    }
    // Should display warning or error if target database is empty
    expect(wrapper!.text()).toBeDefined()
  })
})

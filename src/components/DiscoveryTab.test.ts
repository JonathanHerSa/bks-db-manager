import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'

const getDockerContainers = vi.fn()
const getDiscoveredProjects = vi.fn()
const saveConnectionToBeekeeper = vi.fn()
const checkCompanionStatus = vi.fn()
const copyToSystemClipboard = vi.fn()
const showNotification = vi.fn()

vi.mock('../services/companion', () => ({
  getDockerContainers: (...args: any[]) => getDockerContainers(...args),
  getDiscoveredProjects: (...args: any[]) => getDiscoveredProjects(...args),
  saveConnectionToBeekeeper: (...args: any[]) => saveConnectionToBeekeeper(...args),
  checkCompanionStatus: (...args: any[]) => checkCompanionStatus(...args)
}))

vi.mock('../services/beekeeper', () => ({
  copyToSystemClipboard: (...args: any[]) => copyToSystemClipboard(...args),
  showNotification: (...args: any[]) => showNotification(...args)
}))

import DiscoveryTab from './DiscoveryTab.vue'

let wrapper: VueWrapper<any> | null = null

const mysqlContainer = {
  id: 'c1',
  name: 'my-mysql',
  image: 'mysql:8',
  status: 'Up 2 hours',
  ports: '3306/tcp',
  hostPort: 3307,
  motor: 'mysql',
  suggestedUser: 'root',
  connUrl: 'mysql://root@127.0.0.1:3307'
}

const pgContainer = {
  id: 'c2',
  name: 'my-postgres',
  image: 'postgres:16',
  status: 'Up 1 hour',
  ports: '5432/tcp',
  hostPort: 5433,
  motor: 'postgresql',
  suggestedUser: 'postgres'
}

const nodeProject = {
  uniqueKey: 'p1',
  name: 'my-api',
  path: '~/Proyectos/my-api',
  motor: 'mysql',
  host: '127.0.0.1',
  port: null,
  database: 'my_api_db',
  username: 'root',
  hasPassword: true
}

async function mountDiscovery() {
  wrapper = mount(DiscoveryTab)
  await flushPromises()
  return wrapper
}

beforeEach(() => {
  getDockerContainers.mockReset().mockResolvedValue([])
  getDiscoveredProjects.mockReset().mockResolvedValue([])
  saveConnectionToBeekeeper.mockReset().mockResolvedValue({ success: true, message: 'Guardado' })
  checkCompanionStatus.mockReset().mockResolvedValue({ ok: true, version: '1.0.0', tools: {} })
  copyToSystemClipboard.mockReset().mockResolvedValue(true)
  showNotification.mockReset()
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
})

describe('DiscoveryTab', () => {
  it('scans docker containers and projects on mount', async () => {
    await mountDiscovery()
    expect(getDockerContainers).toHaveBeenCalledTimes(1)
    expect(getDiscoveredProjects).toHaveBeenCalledTimes(1)
  })

  it('renders an empty state when nothing is found', async () => {
    await mountDiscovery()
    expect(wrapper!.text()).toContain('No se detectaron contenedores de bases de datos en ejecución.')
  })

  it('shows the companion-offline banner when the daemon does not respond', async () => {
    checkCompanionStatus.mockResolvedValue(null)
    await mountDiscovery()
    expect(wrapper!.text()).toContain('El Companion Daemon no responde en el puerto 58765')
    expect(wrapper!.text()).toContain('npm run daemon:install')
  })

  it('hides the companion-offline banner once the daemon responds again', async () => {
    checkCompanionStatus.mockResolvedValue(null)
    await mountDiscovery()
    expect(wrapper!.text()).toContain('El Companion Daemon no responde')

    checkCompanionStatus.mockResolvedValue({ ok: true, version: '1.0.0', tools: {} })
    const retryBtn = wrapper!.findAll('button').find((b) => b.text().includes('Reintentar'))
    expect(retryBtn).toBeTruthy()
    await retryBtn!.trigger('click')
    await flushPromises()
    expect(wrapper!.text()).not.toContain('El Companion Daemon no responde')
  })

  it('renders discovered docker containers', async () => {
    getDockerContainers.mockResolvedValue([mysqlContainer, pgContainer])
    await mountDiscovery()
    expect(wrapper!.text()).toContain('my-mysql')
    expect(wrapper!.text()).toContain('my-postgres')
    expect(wrapper!.text()).toContain('127.0.0.1:3307')
  })

  it('filters containers by engine when a filter chip is clicked', async () => {
    getDockerContainers.mockResolvedValue([mysqlContainer, pgContainer])
    await mountDiscovery()

    const mysqlChip = wrapper!.findAll('button').find((b) => b.text().includes('MySQL / MariaDB'))
    expect(mysqlChip).toBeTruthy()
    await mysqlChip!.trigger('click')

    expect(wrapper!.text()).toContain('my-mysql')
    expect(wrapper!.text()).not.toContain('my-postgres')
  })

  it('resets to "Todos" and shows every engine again', async () => {
    getDockerContainers.mockResolvedValue([mysqlContainer, pgContainer])
    await mountDiscovery()

    const mysqlChip = wrapper!.findAll('button').find((b) => b.text().includes('MySQL / MariaDB'))
    await mysqlChip!.trigger('click')
    const allChip = wrapper!.findAll('button').find((b) => b.text().includes('Todos'))
    await allChip!.trigger('click')

    expect(wrapper!.text()).toContain('my-mysql')
    expect(wrapper!.text()).toContain('my-postgres')
  })

  it('copies host:port to clipboard when "Host:Port" is clicked', async () => {
    getDockerContainers.mockResolvedValue([mysqlContainer])
    await mountDiscovery()

    const btn = wrapper!.findAll('button').find((b) => b.attributes('title') === 'Copiar Host:Port')
    await btn!.trigger('click')
    await flushPromises()

    expect(copyToSystemClipboard).toHaveBeenCalledWith('127.0.0.1:3307')
  })

  it('copies the connection URL when available', async () => {
    getDockerContainers.mockResolvedValue([mysqlContainer])
    await mountDiscovery()

    const btn = wrapper!.findAll('button').find((b) => b.attributes('title') === 'Copiar Cadena de Conexión')
    await btn!.trigger('click')
    await flushPromises()

    expect(copyToSystemClipboard).toHaveBeenCalledWith('mysql://root@127.0.0.1:3307')
  })

  it('saves a docker connection to Beekeeper Studio', async () => {
    getDockerContainers.mockResolvedValue([mysqlContainer])
    await mountDiscovery()

    const saveBtn = wrapper!.findAll('button').find((b) => b.attributes('title') === 'Guardar como conexión en Beekeeper Studio')
    await saveBtn!.trigger('click')
    await flushPromises()

    expect(saveConnectionToBeekeeper).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Docker - my-mysql',
        motor: 'mysql',
        host: '127.0.0.1',
        port: 3307,
        user: 'root'
      })
    )
    expect(showNotification).toHaveBeenCalledWith('Guardado', 'success')
  })

  it('shows an error notification when saving a connection fails', async () => {
    getDockerContainers.mockResolvedValue([mysqlContainer])
    saveConnectionToBeekeeper.mockResolvedValue({ success: false, message: 'No se pudo guardar' })
    await mountDiscovery()

    const saveBtn = wrapper!.findAll('button').find((b) => b.attributes('title') === 'Guardar como conexión en Beekeeper Studio')
    await saveBtn!.trigger('click')
    await flushPromises()

    expect(showNotification).toHaveBeenCalledWith('No se pudo guardar', 'error')
  })

  it('renders discovered local projects and saves their connection', async () => {
    getDiscoveredProjects.mockResolvedValue([nodeProject])
    await mountDiscovery()

    expect(wrapper!.text()).toContain('my-api')

    const saveBtn = wrapper!.findAll('button').find((b) => b.attributes('title') === 'Guardar directamente como conexión en Beekeeper Studio')
    await saveBtn!.trigger('click')
    await flushPromises()

    expect(saveConnectionToBeekeeper).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'my-api (MYSQL)',
        motor: 'mysql',
        database: 'my_api_db'
      })
    )
  })

  it('re-scans projects with the configured path and depth when "Escanear Todo" is clicked', async () => {
    await mountDiscovery()
    getDiscoveredProjects.mockClear()
    getDockerContainers.mockClear()

    const scanBtn = wrapper!.findAll('button').find((b) => b.text().includes('Escanear Todo'))
    await scanBtn!.trigger('click')
    await flushPromises()

    expect(getDockerContainers).toHaveBeenCalledTimes(1)
    expect(getDiscoveredProjects).toHaveBeenCalledTimes(1)
  })
})

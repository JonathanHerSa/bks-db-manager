import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  saveConnectionToBeekeeper,
  checkCompanionStatus,
  getSavedConnections,
  getDockerContainers,
  getDiscoveredProjects,
  getDatabasesList,
  getTablesList,
  getDatabaseInfo,
  inspectSchema,
  startStreamClone,
  formatConnOption,
  type SavedConnection
} from './companion'

function jsonResponse(body: any, ok = true, status = 200) {
  return {
    ok,
    status,
    statusText: ok ? 'OK' : 'Error',
    json: async () => body
  } as Response
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn())
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('saveConnectionToBeekeeper', () => {
  it('POSTs to /api/conns/save and returns the parsed response', async () => {
    ;(fetch as any).mockResolvedValue(jsonResponse({ success: true, message: 'Guardado' }))

    const result = await saveConnectionToBeekeeper({ name: 'Test', motor: 'mysql' })

    expect(fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:58765/api/conns/save',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Test', motor: 'mysql' })
      })
    )
    expect(result).toEqual({ success: true, message: 'Guardado' })
  })

  it('returns a failure result when the companion daemon is unreachable', async () => {
    ;(fetch as any).mockRejectedValue(new Error('fetch failed'))

    const result = await saveConnectionToBeekeeper({ name: 'Test', motor: 'mysql' })

    expect(result.success).toBe(false)
    expect(result.message).toContain('fetch failed')
  })
})

describe('checkCompanionStatus', () => {
  it('returns the status payload on success', async () => {
    ;(fetch as any).mockResolvedValue(jsonResponse({ ok: true, version: '1.0.0', tools: {} }))
    const result = await checkCompanionStatus()
    expect(result).toEqual({ ok: true, version: '1.0.0', tools: {} })
  })

  it('returns null when the daemon responds with a non-OK status', async () => {
    ;(fetch as any).mockResolvedValue(jsonResponse({}, false, 500))
    const result = await checkCompanionStatus()
    expect(result).toBeNull()
  })

  it('returns null when the request throws (daemon not running)', async () => {
    ;(fetch as any).mockRejectedValue(new Error('ECONNREFUSED'))
    const result = await checkCompanionStatus()
    expect(result).toBeNull()
  })
})

describe('getSavedConnections / getDockerContainers / getDiscoveredProjects', () => {
  it('returns the conns array from the response', async () => {
    ;(fetch as any).mockResolvedValue(jsonResponse({ conns: [{ id: 1 }] }))
    expect(await getSavedConnections()).toEqual([{ id: 1 }])
  })

  it('returns an empty array when conns is missing', async () => {
    ;(fetch as any).mockResolvedValue(jsonResponse({}))
    expect(await getSavedConnections()).toEqual([])
  })

  it('returns an empty array when the request fails', async () => {
    ;(fetch as any).mockRejectedValue(new Error('network error'))
    expect(await getSavedConnections()).toEqual([])
  })

  it('returns the containers array from the response', async () => {
    ;(fetch as any).mockResolvedValue(jsonResponse({ containers: [{ id: 'c1' }] }))
    expect(await getDockerContainers()).toEqual([{ id: 'c1' }])
  })

  it('returns the projects array and forwards path/depth as query params', async () => {
    ;(fetch as any).mockResolvedValue(jsonResponse({ projects: [{ name: 'p1' }] }))
    const result = await getDiscoveredProjects({ path: '~/code', depth: 3 })
    expect(result).toEqual([{ name: 'p1' }])
    expect(fetch).toHaveBeenCalledWith('http://127.0.0.1:58765/api/discovery/projects?path=%7E%2Fcode&depth=3')
  })

  it('omits query params when none are provided', async () => {
    ;(fetch as any).mockResolvedValue(jsonResponse({ projects: [] }))
    await getDiscoveredProjects()
    expect(fetch).toHaveBeenCalledWith('http://127.0.0.1:58765/api/discovery/projects')
  })
})

describe('getDatabasesList / getTablesList', () => {
  it('returns the databases array', async () => {
    ;(fetch as any).mockResolvedValue(jsonResponse({ databases: ['a', 'b'] }))
    const result = await getDatabasesList({ motor: 'mysql', host: '127.0.0.1', port: 3306, user: 'root' })
    expect(result).toEqual(['a', 'b'])
  })

  it('returns an empty array on failure', async () => {
    ;(fetch as any).mockRejectedValue(new Error('boom'))
    expect(await getDatabasesList({ motor: 'mysql', host: '127.0.0.1', port: 3306, user: 'root' })).toEqual([])
  })

  it('returns the tables array', async () => {
    ;(fetch as any).mockResolvedValue(jsonResponse({ tables: ['users'] }))
    const result = await getTablesList({ motor: 'mysql', host: '127.0.0.1', port: 3306, user: 'root', database: 'db1' })
    expect(result).toEqual(['users'])
  })
})

describe('getDatabaseInfo', () => {
  it('normalizes missing numeric fields to 0', async () => {
    ;(fetch as any).mockResolvedValue(jsonResponse({}))
    const result = await getDatabaseInfo({ motor: 'mysql', host: '127.0.0.1', port: 3306, user: 'root', database: 'db1' })
    expect(result).toEqual({ mb: 0, tables: 0, sqlMb: 0 })
  })

  it('returns zeroed info on failure instead of throwing', async () => {
    ;(fetch as any).mockRejectedValue(new Error('boom'))
    const result = await getDatabaseInfo({ motor: 'mysql', host: '127.0.0.1', port: 3306, user: 'root', database: 'db1' })
    expect(result).toEqual({ mb: 0, tables: 0, sqlMb: 0 })
  })
})

describe('inspectSchema', () => {
  it('returns the columns array', async () => {
    ;(fetch as any).mockResolvedValue(
      jsonResponse({ columns: [{ table: 't1', column: 'id', type: 'int', nullable: 'NO', defaultVal: null }] })
    )
    const result = await inspectSchema({ host: '127.0.0.1', port: 3306, user: 'root', database: 'db1' })
    expect(result).toHaveLength(1)
  })

  it('returns an empty array on failure', async () => {
    ;(fetch as any).mockRejectedValue(new Error('boom'))
    expect(await inspectSchema({ host: '127.0.0.1', port: 3306, user: 'root', database: 'db1' })).toEqual([])
  })
})

describe('startStreamClone', () => {
  function sseResponse(events: string[]) {
    const encoder = new TextEncoder()
    let i = 0
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      body: {
        getReader() {
          return {
            async read() {
              if (i < events.length) {
                const chunk = encoder.encode(events[i])
                i++
                return { done: false, value: chunk }
              }
              return { done: true, value: undefined }
            }
          }
        }
      }
    } as unknown as Response
  }

  it('parses log, progress and complete SSE events and invokes the matching callbacks', async () => {
    const events = [
      'event: log\ndata: {"message":"iniciando"}\n\n',
      'event: progress\ndata: {"bytes":1024,"mb":"0.01","speedMb":"1.0","elapsedSec":1}\n\n',
      'event: complete\ndata: {"message":"listo","bytes":2048,"seconds":"2"}\n\n'
    ]
    ;(fetch as any).mockResolvedValue(sseResponse(events))

    const onLog = vi.fn()
    const onProgress = vi.fn()
    const onComplete = vi.fn()
    const onError = vi.fn()

    startStreamClone(
      {
        srcHost: 'a', srcPort: 3306, srcUser: 'root', srcDb: 'a',
        dstHost: 'b', dstPort: 3306, dstUser: 'root', dstDb: 'b'
      },
      { onLog, onProgress, onComplete, onError }
    )

    await vi.waitFor(() => expect(onComplete).toHaveBeenCalled())

    expect(onLog).toHaveBeenCalledWith('iniciando')
    expect(onProgress).toHaveBeenCalledWith(expect.objectContaining({ bytes: 1024 }))
    expect(onComplete).toHaveBeenCalledWith(expect.objectContaining({ message: 'listo' }))
    expect(onError).not.toHaveBeenCalled()
  })

  it('invokes onError for a non-OK HTTP response', async () => {
    ;(fetch as any).mockResolvedValue({ ok: false, status: 500, statusText: 'Internal Server Error' })

    const onError = vi.fn()
    startStreamClone(
      {
        srcHost: 'a', srcPort: 3306, srcUser: 'root', srcDb: 'a',
        dstHost: 'b', dstPort: 3306, dstUser: 'root', dstDb: 'b'
      },
      { onLog: vi.fn(), onProgress: vi.fn(), onComplete: vi.fn(), onError }
    )

    await vi.waitFor(() => expect(onError).toHaveBeenCalled())
    expect(onError).toHaveBeenCalledWith(expect.stringContaining('500'))
  })

  it('invokes onError when the server emits an error event', async () => {
    const events = ['event: error\ndata: {"message":"algo salió mal"}\n\n']
    ;(fetch as any).mockResolvedValue(sseResponse(events))

    const onError = vi.fn()
    startStreamClone(
      {
        srcHost: 'a', srcPort: 3306, srcUser: 'root', srcDb: 'a',
        dstHost: 'b', dstPort: 3306, dstUser: 'root', dstDb: 'b'
      },
      { onLog: vi.fn(), onProgress: vi.fn(), onComplete: vi.fn(), onError }
    )

    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith('algo salió mal'))
  })

  it('returns an abort function that cancels the underlying request', () => {
    ;(fetch as any).mockImplementation((_url: string, opts: any) => new Promise((_resolve, reject) => {
      opts.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
    }))

    const stop = startStreamClone(
      {
        srcHost: 'a', srcPort: 3306, srcUser: 'root', srcDb: 'a',
        dstHost: 'b', dstPort: 3306, dstUser: 'root', dstDb: 'b'
      },
      { onLog: vi.fn(), onProgress: vi.fn(), onComplete: vi.fn(), onError: vi.fn() }
    )

    expect(() => stop()).not.toThrow()
  })
})

describe('formatConnOption', () => {
  const dockerConn: SavedConnection = {
    id: 1, name: 'Docker', motor: 'mysql', host: '127.0.0.1', port: 3307, user: 'root',
    hasPassword: true, isBeekeeper: true
  }
  const customConn: SavedConnection = {
    id: 'custom-1', name: 'Homelab', motor: 'postgresql', host: '10.0.0.5', port: 5432, user: 'postgres',
    hasPassword: false, isBeekeeper: false
  }

  it('formats a Beekeeper connection with the 🗄️ icon and motor, no port', () => {
    expect(formatConnOption(dockerConn, [dockerConn])).toBe('🗄️ Docker (MYSQL)')
  })

  it('formats a custom (non-Beekeeper) connection with the ⚡ icon', () => {
    expect(formatConnOption(customConn, [customConn])).toBe('⚡ Homelab (POSTGRESQL)')
  })

  it('appends the port when multiple connections share the same name (case-insensitive, trimmed)', () => {
    const duplicate: SavedConnection = { ...dockerConn, id: 2, port: 3308 };
    const allConns = [dockerConn, duplicate];
    expect(formatConnOption(dockerConn, allConns)).toBe('🗄️ Docker (MYSQL :3307)');
    expect(formatConnOption(duplicate, allConns)).toBe('🗄️ Docker (MYSQL :3308)');
  })

  it('does not append the port when names differ', () => {
    expect(formatConnOption(dockerConn, [dockerConn, customConn])).toBe('🗄️ Docker (MYSQL)')
  })
})

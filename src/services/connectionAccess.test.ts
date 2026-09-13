import { describe, it, expect, vi, beforeEach } from 'vitest'

const fetchDatabases = vi.fn()
const getDatabasesList = vi.fn()

vi.mock('./beekeeper', () => ({
  fetchDatabases: (...a: any[]) => fetchDatabases(...a)
}))

vi.mock('./companion', () => ({
  getDatabasesList: (...a: any[]) => getDatabasesList(...a)
}))

import { listDatabasesForConnection } from './connectionAccess'

beforeEach(() => {
  fetchDatabases.mockReset()
  getDatabasesList.mockReset()
})

describe('listDatabasesForConnection', () => {
  it('uses the Beekeeper SDK when isCurrentActive is true and it returns results', async () => {
    fetchDatabases.mockResolvedValue(['app_db'])
    const result = await listDatabasesForConnection({
      motor: 'mysql', host: '127.0.0.1', port: 3306, user: 'root', isCurrentActive: true
    })
    expect(result).toEqual(['app_db'])
    expect(getDatabasesList).not.toHaveBeenCalled()
  })

  it('falls back to the companion daemon when the SDK returns an empty list', async () => {
    fetchDatabases.mockResolvedValue([])
    getDatabasesList.mockResolvedValue(['from_companion'])
    const result = await listDatabasesForConnection({
      motor: 'postgresql', host: 'h', port: 5432, user: 'u', isCurrentActive: true
    })
    expect(result).toEqual(['from_companion'])
    expect(getDatabasesList).toHaveBeenCalledWith({ motor: 'postgresql', host: 'h', port: 5432, user: 'u', pass: undefined })
  })

  it('falls back to the companion daemon when the SDK throws', async () => {
    fetchDatabases.mockRejectedValue(new Error('no active connection'))
    getDatabasesList.mockResolvedValue(['from_companion'])
    const result = await listDatabasesForConnection({
      motor: 'mysql', host: 'h', port: 3306, user: 'u', isCurrentActive: true
    })
    expect(result).toEqual(['from_companion'])
  })

  it('skips the SDK entirely when isCurrentActive is false', async () => {
    getDatabasesList.mockResolvedValue(['mongo_db'])
    const result = await listDatabasesForConnection({
      motor: 'mongodb', host: 'h', port: 27017, user: 'u', pass: 'x', isCurrentActive: false
    })
    expect(result).toEqual(['mongo_db'])
    expect(fetchDatabases).not.toHaveBeenCalled()
    expect(getDatabasesList).toHaveBeenCalledWith({ motor: 'mongodb', host: 'h', port: 27017, user: 'u', pass: 'x' })
  })

  it('returns an empty array when the companion daemon also fails', async () => {
    getDatabasesList.mockRejectedValue(new Error('daemon unreachable'))
    const result = await listDatabasesForConnection({
      motor: 'mysql', host: 'h', port: 3306, user: 'u', isCurrentActive: false
    })
    expect(result).toEqual([])
  })
})

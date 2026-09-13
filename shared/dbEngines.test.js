import { describe, it, expect } from 'vitest'
import {
  normalizeMotor,
  getDefaultPort,
  getEngineFamily,
  supportsIntrospection,
  supportsCloneStream,
  INTROSPECTION_ENGINES,
  CLONE_STREAM_ENGINES
} from './dbEngines.js'

describe('normalizeMotor', () => {
  it('defaults to mysql when raw is falsy', () => {
    expect(normalizeMotor('')).toBe('mysql')
    expect(normalizeMotor(null)).toBe('mysql')
    expect(normalizeMotor(undefined)).toBe('mysql')
  })

  it('is case-insensitive and trims whitespace', () => {
    expect(normalizeMotor('  MySQL  ')).toBe('mysql')
    expect(normalizeMotor('POSTGRES')).toBe('postgresql')
  })

  it.each([
    ['postgres', 'postgresql'],
    ['pg', 'postgresql'],
    ['postgresql', 'postgresql'],
    ['pgsql', 'postgresql'],
    ['mariadb', 'mariadb'],
    ['mysql', 'mysql'],
    ['sqlite', 'sqlite'],
    ['sqlite3', 'sqlite'],
    ['sqlserver', 'sqlserver'],
    ['mssql', 'sqlserver'],
    ['sqlsrv', 'sqlserver'],
    ['cockroachdb', 'cockroachdb'],
    ['cockroach', 'cockroachdb'],
    ['redshift', 'redshift'],
    ['oracle', 'oracle'],
    ['redis', 'redis'],
    ['keydb', 'redis'],
    ['dragonfly', 'redis'],
    ['mongodb', 'mongodb'],
    ['mongo', 'mongodb'],
    ['clickhouse', 'clickhouse'],
    ['cassandra', 'cassandra'],
    ['scylla', 'cassandra'],
    ['duckdb', 'duckdb'],
    ['libsql', 'libsql'],
    ['turso', 'libsql'],
    ['surreal', 'surrealdb'],
    ['surrealdb', 'surrealdb'],
    ['snowflake', 'snowflake'],
    ['bigquery', 'bigquery'],
    ['firebird', 'firebird'],
    ['tidb', 'tidb']
  ])('normalizes %s -> %s', (input, expected) => {
    expect(normalizeMotor(input)).toBe(expected)
  })

  it('returns the lowercased input unchanged for unknown engines', () => {
    expect(normalizeMotor('SomeFutureEngine')).toBe('somefutureengine')
  })
})

describe('getDefaultPort', () => {
  it.each([
    ['postgresql', 5432],
    ['mysql', 3306],
    ['mariadb', 3306],
    ['sqlserver', 1433],
    ['oracle', 1521],
    ['redis', 6379],
    ['mongodb', 27017],
    ['clickhouse', 8123],
    ['cockroachdb', 26257],
    ['redshift', 5439],
    ['cassandra', 9042],
    ['surrealdb', 8000],
    ['firebird', 3050],
    ['tidb', 4000],
    ['libsql', 8080]
  ])('returns %s default port %d', (motor, port) => {
    expect(getDefaultPort(motor)).toBe(port)
  })

  it('returns null for file-based engines', () => {
    expect(getDefaultPort('sqlite')).toBeNull()
    expect(getDefaultPort('duckdb')).toBeNull()
  })

  it('falls back to 3306 for unrecognized engines', () => {
    expect(getDefaultPort('unknown-engine')).toBe(3306)
    expect(getDefaultPort(undefined)).toBe(3306)
  })
})

describe('getEngineFamily', () => {
  it.each([
    ['mysql', 'mysql'],
    ['mariadb', 'mysql'],
    ['tidb', 'mysql'],
    ['postgresql', 'postgres'],
    ['cockroachdb', 'postgres'],
    ['redshift', 'postgres'],
    ['mongodb', 'mongodb'],
    ['sqlserver', 'sqlserver'],
    ['clickhouse', 'clickhouse'],
    ['redis', 'redis']
  ])('groups %s into the %s wire-compatible family', (motor, family) => {
    expect(getEngineFamily(motor)).toBe(family)
  })

  it('returns null for engines with no known adapter family', () => {
    expect(getEngineFamily('sqlite')).toBeNull()
    expect(getEngineFamily('oracle')).toBeNull()
    expect(getEngineFamily('unknown-engine')).toBeNull()
  })
})

describe('supportsIntrospection / supportsCloneStream', () => {
  it('reports introspection support for every Tier 1 + Tier 2 engine', () => {
    for (const motor of INTROSPECTION_ENGINES) {
      expect(supportsIntrospection(motor)).toBe(true)
    }
  })

  it('reports clone-stream support only for engines with a real pipe-based dump/restore tool', () => {
    for (const motor of CLONE_STREAM_ENGINES) {
      expect(supportsCloneStream(motor)).toBe(true)
    }
    expect(supportsCloneStream('sqlserver')).toBe(false)
    expect(supportsCloneStream('clickhouse')).toBe(false)
    expect(supportsCloneStream('redis')).toBe(false)
  })

  it('returns false for engines outside both lists', () => {
    expect(supportsIntrospection('sqlite')).toBe(false)
    expect(supportsCloneStream('sqlite')).toBe(false)
  })
})

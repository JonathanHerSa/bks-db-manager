import { describe, it, expect } from 'vitest';
import { getEngine } from './index.js';
import mysqlFamily from './mysqlFamily.js';
import postgresFamily from './postgresFamily.js';
import mongodb from './mongodb.js';
import sqlserver from './sqlserver.js';
import clickhouse from './clickhouse.js';
import redis from './redis.js';

describe('getEngine', () => {
  it.each([
    ['mysql', mysqlFamily],
    ['mariadb', mysqlFamily],
    ['tidb', mysqlFamily],
    ['postgresql', postgresFamily],
    ['cockroachdb', postgresFamily],
    ['redshift', postgresFamily],
    ['mongodb', mongodb],
    ['sqlserver', sqlserver],
    ['clickhouse', clickhouse],
    ['redis', redis]
  ])('resolves %s to the correct adapter', (motor, expected) => {
    expect(getEngine(motor)).toBe(expected);
  });

  it('returns undefined for engines with no adapter (file-based or unimplemented)', () => {
    expect(getEngine('sqlite')).toBeUndefined();
    expect(getEngine('duckdb')).toBeUndefined();
    expect(getEngine('oracle')).toBeUndefined();
    expect(getEngine('unknown-engine')).toBeUndefined();
  });
});

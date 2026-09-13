import { getEngineFamily } from '../../shared/dbEngines.js';
import mysqlFamily from './mysqlFamily.js';
import postgresFamily from './postgresFamily.js';
import mongodb from './mongodb.js';
import sqlserver from './sqlserver.js';
import clickhouse from './clickhouse.js';
import redis from './redis.js';

/**
 * Strategy registry: one adapter per wire-compatible engine family. Callers
 * pass a normalized motor (see shared/dbEngines.js normalizeMotor); this
 * resolves the family and returns its adapter, or undefined if the engine
 * has no adapter (e.g. sqlite, oracle — file-based or unimplemented).
 *
 * This replaces the `isMysql = motor === 'mysql' || motor === 'mariadb' ...`
 * / `isPg = ...` blocks that used to be copy-pasted into five different
 * endpoints in server/index.js (and once drifted out of sync with each
 * other, causing Postgres/MariaDB/TiDB to silently fail in two of them).
 */
const ADAPTERS = {
  mysql: mysqlFamily,
  postgres: postgresFamily,
  mongodb,
  sqlserver,
  clickhouse,
  redis
};

export function getEngine(normalizedMotor) {
  const family = getEngineFamily(normalizedMotor) || normalizedMotor;
  return ADAPTERS[family];
}

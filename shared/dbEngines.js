/**
 * Motor detection and default ports, shared between the companion server
 * (server/index.js) and the frontend (src/components/DiscoveryTab.vue) so
 * both sides agree on the same engine list without drifting apart.
 */

export function normalizeMotor(raw) {
  if (!raw) return 'mysql';
  const l = String(raw).toLowerCase().trim();
  if (l.includes('postgre') || l === 'pgsql' || l === 'postgres') return 'postgresql';
  if (l === 'mariadb') return 'mariadb';
  if (l === 'mysql') return 'mysql';
  if (l === 'sqlite' || l === 'sqlite3') return 'sqlite';
  if (l.includes('sqlserver') || l.includes('sqlsrv') || l.includes('mssql')) return 'sqlserver';
  if (l.includes('cockroach')) return 'cockroachdb';
  if (l.includes('redshift')) return 'redshift';
  if (l.includes('oracle')) return 'oracle';
  if (l.includes('redis') || l.includes('keydb') || l.includes('dragonfly')) return 'redis';
  if (l.includes('mongo')) return 'mongodb';
  if (l.includes('clickhouse')) return 'clickhouse';
  if (l.includes('cassandra') || l.includes('scylla')) return 'cassandra';
  if (l.includes('duckdb')) return 'duckdb';
  if (l.includes('libsql') || l.includes('turso')) return 'libsql';
  if (l.includes('surreal')) return 'surrealdb';
  if (l.includes('snowflake')) return 'snowflake';
  if (l.includes('bigquery')) return 'bigquery';
  if (l.includes('firebird')) return 'firebird';
  if (l.includes('tidb')) return 'tidb';
  return l;
}

export function getDefaultPort(motor) {
  switch (motor) {
    case 'postgresql': return 5432;
    case 'mysql':
    case 'mariadb': return 3306;
    case 'sqlserver': return 1433;
    case 'oracle': return 1521;
    case 'redis': return 6379;
    case 'mongodb': return 27017;
    case 'clickhouse': return 8123;
    case 'cockroachdb': return 26257;
    case 'redshift': return 5439;
    case 'cassandra': return 9042;
    case 'surrealdb': return 8000;
    case 'firebird': return 3050;
    case 'tidb': return 4000;
    case 'libsql': return 8080;
    case 'sqlite':
    case 'duckdb': return null;
    default: return 3306;
  }
}

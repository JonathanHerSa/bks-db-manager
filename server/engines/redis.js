import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);
const MAX_KEYS_SAMPLED = 500;

/**
 * Adapter for Redis. Introspection only, and only a rough approximation:
 * Redis has no "databases" or "tables" in the relational sense, so this
 * maps numbered logical DBs (0-15 by default) to "databases", and keys in
 * the selected DB to "tables" (capped at MAX_KEYS_SAMPLED to avoid hanging
 * on a huge keyspace). Schema inspection genuinely does not apply — Redis
 * has no columns — so it returns an empty list rather than guessing.
 *
 * The password is passed via the REDISCLI_AUTH env var (supported by
 * redis-cli since Redis 5), avoiding both argv exposure and the
 * "Using a password on the command line" warning `-a` would otherwise print.
 */
function authEnv(pass) {
  return pass ? { ...process.env, REDISCLI_AUTH: pass } : process.env;
}

export default {
  id: 'redis',
  supportsCloneStream: false,

  async listDatabases({ host, port, user, pass }) {
    const args = ['-h', String(host), '-p', String(port), 'INFO', 'keyspace'];
    const { stdout } = await execFileAsync('redis-cli', args, { env: authEnv(pass) });
    const dbs = [];
    for (const line of stdout.split('\n')) {
      const match = line.match(/^db(\d+):/);
      if (match) dbs.push(match[1]);
    }
    return dbs.length > 0 ? dbs : ['0'];
  },

  // "Tables" here means "keys in the selected numbered DB" — there is no
  // real equivalent, this is the closest useful approximation.
  async listTables({ host, port, user, pass, database }) {
    const dbIndex = parseInt(database, 10) || 0;
    const args = ['-h', String(host), '-p', String(port), '-n', String(dbIndex), '--scan', '--count', String(MAX_KEYS_SAMPLED)];
    const { stdout } = await execFileAsync('redis-cli', args, { env: authEnv(pass) });
    return stdout.split('\n').map((s) => s.trim()).filter(Boolean).slice(0, MAX_KEYS_SAMPLED);
  },

  async getDatabaseInfo({ host, port, user, pass, database }) {
    const dbIndex = parseInt(database, 10) || 0;
    const env = authEnv(pass);
    const [{ stdout: dbsizeOut }, { stdout: infoOut }] = await Promise.all([
      execFileAsync('redis-cli', ['-h', String(host), '-p', String(port), '-n', String(dbIndex), 'DBSIZE'], { env }),
      execFileAsync('redis-cli', ['-h', String(host), '-p', String(port), 'INFO', 'memory'], { env })
    ]);
    const tables = parseInt(dbsizeOut.trim(), 10) || 0;
    // used_memory is instance-wide (Redis doesn't track per-DB memory), so
    // this is a rough upper bound, not this DB's exact footprint.
    const memMatch = infoOut.match(/used_memory:(\d+)/);
    const mb = memMatch ? Math.round((parseInt(memMatch[1], 10) / 1024 / 1024) * 100) / 100 : 0;
    return { mb, tables };
  },

  async inspectSchema() {
    return [];
  }
};

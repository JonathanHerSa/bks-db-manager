import { execFile, spawn } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

function buildUri({ host, port, user, pass, database = '' }) {
  const auth = user ? `${encodeURIComponent(user)}:${encodeURIComponent(pass || '')}@` : '';
  const db = database ? `/${encodeURIComponent(database)}` : '/';
  // authSource=admin is the common convention for admin-created users; a
  // deployment using a non-default authSource isn't configurable from this
  // UI yet (same "best effort, not exhaustive" caveat as the mongo schema
  // inference below).
  return `mongodb://${auth}${host}:${port}${db}?authSource=admin`;
}

/**
 * Adapter for MongoDB. Introspection uses `mongosh --eval` (values embedded
 * via JSON.stringify so they're safe JS string literals); clone streaming
 * uses `mongodump --archive` / `mongorestore --archive`, which behave just
 * like mysqldump|mysql or pg_dump|psql: no value writes to stdout, no value
 * reads from stdin, so the existing pipe/sanitizer/progress-tracker plumbing
 * in server/index.js works unchanged.
 *
 * NOTE: mongosh/mongodump have no environment-variable equivalent to
 * MYSQL_PWD/PGPASSWORD, so the password is embedded (percent-encoded) in the
 * connection URI passed as a single execFile/spawn argv element — visible to
 * other local processes via `ps`, but never parsed by a shell (no injection
 * risk), and this is an inherent limitation of these CLI tools, not a choice
 * made here.
 */
export default {
  id: 'mongodb',
  supportsCloneStream: true,
  // `mongodump --archive` output is a binary BSON-based archive, not text —
  // server/index.js must NOT run its SQL-text sanitizer/email-masking regex
  // over this stream, or it will corrupt the archive.
  textualDumpFormat: false,

  async listDatabases({ host, port, user, pass }) {
    const uri = buildUri({ host, port, user, pass });
    const evalScript = "db.adminCommand({listDatabases:1}).databases.forEach(d => print(d.name));";
    const { stdout } = await execFileAsync('mongosh', [uri, '--quiet', '--eval', evalScript]);
    const ignore = ['admin', 'local', 'config'];
    return stdout.split('\n').map((s) => s.trim()).filter((s) => s && !ignore.includes(s));
  },

  async listTables({ host, port, user, pass, database }) {
    const uri = buildUri({ host, port, user, pass, database });
    const evalScript = 'db.getCollectionNames().forEach(c => print(c));';
    const { stdout } = await execFileAsync('mongosh', [uri, '--quiet', '--eval', evalScript]);
    return stdout.split('\n').map((s) => s.trim()).filter(Boolean);
  },

  async getDatabaseInfo({ host, port, user, pass, database }) {
    const uri = buildUri({ host, port, user, pass, database });
    const evalScript = 'const s = db.stats(); print(Math.round((s.dataSize / 1024 / 1024) * 100) / 100 + " " + s.collections);';
    const { stdout } = await execFileAsync('mongosh', [uri, '--quiet', '--eval', evalScript]);
    const parts = stdout.trim().split(/\s+/);
    return { mb: parseFloat(parts[0]) || 0, tables: parseInt(parts[1]) || 0 };
  },

  // Mongo is schema-less: this samples one document per collection and
  // infers field names/JS types as a best-effort approximation for the
  // cross-motor Schema Diff feature. It is NOT a real schema (no
  // nullability/constraint info, and fields absent from the sampled
  // document are invisible), only a reasonable approximation.
  async inspectSchema({ host, port, user, pass, database }) {
    const uri = buildUri({ host, port, user, pass, database });
    const evalScript = `
      db.getCollectionNames().forEach(coll => {
        const doc = db.getCollection(coll).findOne();
        if (doc) {
          Object.keys(doc).forEach(k => print(coll + '\\t' + k + '\\t' + typeof doc[k] + '\\tYES\\tNULL'));
        }
      });
    `;
    const { stdout } = await execFileAsync('mongosh', [uri, '--quiet', '--eval', evalScript]);
    const lines = stdout.trim().split('\n').filter(Boolean);
    const columns = [];
    for (const line of lines) {
      const parts = line.split('\t');
      if (parts.length >= 3) {
        columns.push({ table: parts[0], column: parts[1], type: parts[2], nullable: parts[3] || 'YES', defaultVal: null });
      }
    }
    return columns;
  },

  async ensureDatabase() {
    // MongoDB creates databases implicitly on first write; nothing to do.
  },

  spawnDump({ host, port, user, pass, database, excludeTables }) {
    const uri = buildUri({ host, port, user, pass, database });
    const args = ['--uri', uri, '--archive'];
    if (Array.isArray(excludeTables)) {
      for (const t of excludeTables) {
        args.push(`--excludeCollection=${t}`);
      }
    }
    return spawn('mongodump', args);
  },

  spawnRestore({ host, port, user, pass, database }) {
    const uri = buildUri({ host, port, user, pass, database });
    return spawn('mongorestore', ['--uri', uri, '--archive', '--drop']);
  }
};

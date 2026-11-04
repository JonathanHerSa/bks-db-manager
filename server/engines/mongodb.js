import crypto from 'crypto';
import { execFile, spawn } from 'child_process';
import { promisify } from 'util';
import { toJsStringLiteral } from './escaping.js';

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

async function mongosh(uri, script) {
  const { stdout } = await execFileAsync('mongosh', [uri, '--quiet', '--eval', script]);
  return stdout;
}

function parseJsonLines(stdout) {
  const rows = [];
  for (const line of String(stdout).split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) continue;
    try {
      rows.push(JSON.parse(trimmed));
    } catch {
      // mongosh may print warnings interleaved with the JSON lines.
    }
  }
  return rows;
}

function hashLines(lines) {
  return crypto.createHash('sha256').update(lines.join('\n')).digest('hex');
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
  appendFormat: 'archive',
  // countDocuments() is a collection scan; skip the post-copy row-count check
  // by default.
  verifyRowCounts: false,

  syncCapabilities() {
    return {
      fingerprint: 'stats',
      appendOnlyByKey: true,
      parallelTableDump: true,
      cdc: 'change-streams'
    };
  },

  async listDatabases({ host, port, user, pass }) {
    const uri = buildUri({ host, port, user, pass });
    const stdout = await mongosh(uri, "db.adminCommand({listDatabases:1}).databases.forEach(d => print(d.name));");
    const ignore = ['admin', 'local', 'config'];
    return stdout.split('\n').map((s) => s.trim()).filter((s) => s && !ignore.includes(s));
  },

  async listTables({ host, port, user, pass, database }) {
    const uri = buildUri({ host, port, user, pass, database });
    const stdout = await mongosh(uri, 'db.getCollectionNames().forEach(c => print(c));');
    return stdout.split('\n').map((s) => s.trim()).filter(Boolean);
  },

  async getDatabaseInfo({ host, port, user, pass, database }) {
    const uri = buildUri({ host, port, user, pass, database });
    const stdout = await mongosh(uri, 'const s = db.stats(); print(Math.round((s.dataSize / 1024 / 1024) * 100) / 100 + " " + s.collections);');
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
    const stdout = await mongosh(uri, evalScript);
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

  // ---------------------------------------------------------------------
  // Incremental sync primitives
  // ---------------------------------------------------------------------

  async getServerIdentity({ host, port, user, pass }) {
    const uri = buildUri({ host, port, user, pass });
    const stdout = await mongosh(uri, `
      const hello = db.adminCommand({ hello: 1 });
      print(JSON.stringify({
        serverUuid: hello.setName || (hello.topologyVersion && String(hello.topologyVersion.processId)) || 'standalone',
        version: db.version()
      }));
    `);
    const [identity] = parseJsonLines(stdout);
    return {
      serverUuid: identity?.serverUuid || null,
      version: identity?.version || null
    };
  },

  async listTablesWithMeta({ host, port, user, pass, database }) {
    const uri = buildUri({ host, port, user, pass, database });
    const stdout = await mongosh(uri, `
      db.getCollectionInfos().forEach(info => {
        if (info.name.startsWith('system.')) return;
        let stats = { count: 0, size: 0, totalIndexSize: 0 };
        try { stats = db.getCollection(info.name).stats(); } catch (e) {}
        let lastId = null;
        try {
          const last = db.getCollection(info.name).find({}, { _id: 1 }).sort({ _id: -1 }).limit(1).next();
          if (last && last._id !== undefined) lastId = last._id;
        } catch (e) {}
        const idType = lastId === null
          ? null
          : (lastId && lastId._bsontype === 'ObjectId' ? 'objectid' : typeof lastId);
        print(JSON.stringify({
          name: info.name,
          type: info.type === 'view' ? 'view' : 'table',
          rows: stats.count || 0,
          bytes: (stats.size || 0) + (stats.totalIndexSize || 0),
          primaryKey: info.type === 'view' ? null : '_id',
          primaryKeyType: idType,
          autoIncrement: idType === 'objectid' || idType === 'number'
        }));
      });
    `);
    return parseJsonLines(stdout);
  },

  async getTableSchemaHashes({ host, port, user, pass, database }, tables = []) {
    const uri = buildUri({ host, port, user, pass, database });
    const wanted = new Set(tables);
    const stdout = await mongosh(uri, `
      db.getCollectionInfos().forEach(info => {
        if (${JSON.stringify([...wanted])}.indexOf(info.name) === -1) return;
        let indexes = [];
        try { indexes = db.getCollection(info.name).getIndexes(); } catch (e) {}
        print(JSON.stringify({ name: info.name, info, indexes }));
      });
    `);
    const hashes = {};
    for (const row of parseJsonLines(stdout)) {
      hashes[row.name] = hashLines([JSON.stringify(row)]);
    }
    for (const table of tables) {
      if (!hashes[table]) hashes[table] = hashLines([]);
    }
    return hashes;
  },

  async getTableFingerprints({ host, port, user, pass, database }, tables = []) {
    const uri = buildUri({ host, port, user, pass, database });
    const stdout = await mongosh(uri, `
      db.getCollectionNames().forEach(name => {
        let stats = null;
        try { stats = db.getCollection(name).stats(); } catch (e) {}
        if (!stats) return;
        print(JSON.stringify({
          name,
          token: [stats.count, stats.size, stats.storageSize, stats.avgObjSize].join(':'),
          rows: stats.count || 0
        }));
      });
    `);
    const result = {};
    for (const row of parseJsonLines(stdout)) {
      result[row.name] = { token: row.token, rows: row.rows };
    }
    for (const table of tables) {
      if (!result[table]) result[table] = { token: null, rows: null };
    }
    return result;
  },

  async getTableAppendStates({ host, port, user, pass, database }, tables = []) {
    const uri = buildUri({ host, port, user, pass, database });
    const result = {};
    for (const { table } of tables) {
      const stdout = await mongosh(uri, `
        const coll = db.getCollection(${toJsStringLiteral(table)});
        const rows = coll.countDocuments({});
        const last = coll.find({}, { _id: 1 }).sort({ _id: -1 }).limit(1).next();
        print(JSON.stringify({ rows, maxKey: last && last._id !== undefined ? String(last._id) : null }));
      `);
      const [state] = parseJsonLines(stdout);
      result[table] = {
        rows: state?.rows || 0,
        maxKey: state?.maxKey ?? null
      };
    }
    return result;
  },

  async countRowsAfterKey({ host, port, user, pass, database }, table, column, value) {
    void column;
    const uri = buildUri({ host, port, user, pass, database });
    const text = String(value);
    let query;
    if (/^[0-9a-fA-F]{24}$/.test(text)) {
      query = `{ _id: { $gt: ObjectId(${toJsStringLiteral(text)}) } }`;
    } else if (/^-?\d+$/.test(text)) {
      query = `{ _id: { $gt: Number(${toJsStringLiteral(text)}) } }`;
    } else {
      query = `{ _id: { $gt: ${toJsStringLiteral(text)} } }`;
    }
    const stdout = await mongosh(uri, `print(db.getCollection(${toJsStringLiteral(table)}).countDocuments(${query}));`);
    return parseInt(stdout.trim(), 10) || 0;
  },

  async getTableRowCount({ host, port, user, pass, database }, table) {
    const uri = buildUri({ host, port, user, pass, database });
    const stdout = await mongosh(uri, `print(db.getCollection(${toJsStringLiteral(table)}).countDocuments({}));`);
    return parseInt(stdout.trim(), 10) || 0;
  },

  async dropTable({ host, port, user, pass, database }, table) {
    const uri = buildUri({ host, port, user, pass, database });
    await mongosh(uri, `db.getCollection(${toJsStringLiteral(table)}).drop();`);
  },

  async getCdcCapabilities({ host, port, user, pass }) {
    const uri = buildUri({ host, port, user, pass });
    try {
      const stdout = await mongosh(uri, `
        const hello = db.adminCommand({ hello: 1 });
        print(JSON.stringify({ setName: hello.setName || null, msg: hello.msg || null }));
      `);
      const [info] = parseJsonLines(stdout);
      if (!info?.setName && info?.msg !== 'isdbgrid') {
        return {
          available: false,
          engine: 'change-streams',
          reason: 'Change streams requieren un replica set o un clúster sharded.'
        };
      }
    } catch {}
    return {
      available: false,
      engine: 'change-streams',
      reason: 'Change streams detectado, pero el replay de CDC para MongoDB aún no está implementado. Usa el modo incremental por colecciones.'
    };
  },

  // ---------------------------------------------------------------------
  // Full-database and single-collection dump/restore
  // ---------------------------------------------------------------------

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

  spawnTableDump({ host, port, user, pass, database }, { table, dataOnly = false, keyColumn = null, keyAfter = null } = {}) {
    const uri = buildUri({ host, port, user, pass, database });
    const args = ['--uri', uri, '--collection', String(table), '--archive'];
    if (dataOnly && keyColumn && keyAfter !== null && keyAfter !== undefined) {
      const text = String(keyAfter);
      let query;
      if (/^[0-9a-fA-F]{24}$/.test(text)) {
        query = JSON.stringify({ _id: { $gt: { $oid: text } } });
      } else if (/^-?\d+$/.test(text)) {
        query = JSON.stringify({ _id: { $gt: Number(text) } });
      } else {
        query = JSON.stringify({ _id: { $gt: text } });
      }
      args.push('--query', query);
    }
    return spawn('mongodump', args);
  },

  spawnRestore({ host, port, user, pass, database }, options = {}) {
    const uri = buildUri({ host, port, user, pass, database });
    const args = ['--uri', uri, '--archive'];
    if (!options.dataOnly) args.push('--drop');
    return spawn('mongorestore', args);
  },

  spawnTableRestore(params, options = {}) {
    return this.spawnRestore(params, options);
  }
};

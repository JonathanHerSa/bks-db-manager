import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import { Transform } from 'stream';
import { StringDecoder } from 'string_decoder';

const execAsync = promisify(exec);
const app = express();
const PORT = process.env.BKS_DB_MANAGER_PORT || 58765;

app.use(cors());
app.use(express.json());

const HOME = os.homedir();
const CONNS_FILE = path.join(HOME, '.db_manager_conns.list');
const BACKUP_DIR = path.join(HOME, 'Bases de datos', 'Trabajo');

if (!fs.existsSync(BACKUP_DIR)) {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

// 1. Health check & Tool verification
app.get('/api/status', async (req, res) => {
  const tools = ['mysql', 'mysqldump', 'psql', 'pg_dump', 'mongodump', 'zstd', 'docker', 'pv'];
  const status = {};
  for (const tool of tools) {
    try {
      await execAsync(`which ${tool}`);
      status[tool] = true;
    } catch {
      status[tool] = false;
    }
  }
  res.json({ ok: true, version: '1.0.0', tools });
});

function getKnownPasswords() {
  const map = new Map();
  try {
    if (fs.existsSync(CONNS_FILE)) {
      const lines = fs.readFileSync(CONNS_FILE, 'utf-8').split('\n').filter(Boolean);
      for (const line of lines) {
        const [name, motor, host, port, user, pass] = line.split('|');
        if (pass && pass.trim()) {
          const p = pass.trim();
          map.set(`${host}:${port}:${user}`, p);
          if (name) map.set(name.trim().toLowerCase(), p);
        }
      }
    }
  } catch (e) {
    console.warn('Error reading passwords map:', e.message);
  }
  return map;
}

function resolvePassword(host, port, user, pass = '', name = '') {
  if (pass && String(pass).trim()) return String(pass).trim();
  const map = getKnownPasswords();
  if (map.has(`${host}:${port}:${user}`)) return map.get(`${host}:${port}:${user}`);
  if (name && map.has(String(name).trim().toLowerCase())) return map.get(String(name).trim().toLowerCase());
  for (const [key, val] of map.entries()) {
    if (key.startsWith(`${host}:${port}:`)) return val;
  }
  return '';
}

function normalizeMotor(raw) {
  if (!raw) return 'mysql';
  const l = raw.toLowerCase().trim();
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

function getDefaultPort(motor) {
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

function getDefaultUser(motor) {
  switch (motor) {
    case 'postgresql': return 'postgres';
    case 'mysql':
    case 'mariadb':
    case 'tidb': return 'root';
    case 'sqlserver': return 'sa';
    case 'oracle': return 'system';
    case 'redis': return 'default';
    case 'mongodb': return 'admin';
    case 'clickhouse': return 'default';
    case 'cassandra': return 'cassandra';
    case 'surrealdb': return 'root';
    case 'firebird': return 'SYSDBA';
    case 'sqlite':
    case 'duckdb': return 'N/A';
    default: return 'root';
  }
}

function formatBytes(bytes, decimals = 1) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

function isSqliteFile(filePath) {
  try {
    const stat = fs.statSync(filePath);
    if (stat.size === 0 && (filePath.endsWith('.sqlite') || filePath.endsWith('.sqlite3'))) return true;
    if (stat.size < 16) return false;
    const fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(16);
    fs.readSync(fd, buf, 0, 16, 0);
    fs.closeSync(fd);
    return buf.toString('utf8').startsWith('SQLite format 3');
  } catch {
    return false;
  }
}

async function getBeekeeperSavedConnections() {
  try {
    const dbPath = path.join(HOME, '.config', 'beekeeper-studio', 'app.db');
    if (!fs.existsSync(dbPath)) return [];

    const { stdout } = await execAsync(
      `sqlite3 "${dbPath}" "SELECT id, name, connectionType, host, port, username, defaultDatabase, path, url FROM saved_connection;"`
    );
    if (!stdout.trim()) return [];

    const lines = stdout.trim().split('\n').filter(Boolean);
    const conns = [];

    for (const line of lines) {
      const parts = line.split('|');
      const id = parts[0];
      const name = parts[1];
      const rawType = parts[2];
      const host = parts[3];
      const port = parts[4];
      const username = parts[5];
      const defaultDatabase = parts[6];
      const pathVal = parts[7] || '';
      const urlVal = parts[8] || '';

      const motor = normalizeMotor(rawType);
      const isFileDb = motor === 'sqlite' || motor === 'duckdb';

      const finalHost = isFileDb ? (pathVal || 'Local File') : (host || '127.0.0.1');
      const finalPort = isFileDb ? null : (parseInt(port) || getDefaultPort(motor));
      const finalUser = isFileDb ? 'N/A' : (username || getDefaultUser(motor));
      const resolvedPass = resolvePassword(finalHost, finalPort || 0, finalUser, '', name);

      conns.push({
        id: `bks-${id}`,
        name: name || 'Conexión Beekeeper',
        motor,
        host: finalHost,
        port: finalPort,
        user: finalUser,
        defaultDatabase: defaultDatabase || '',
        path: pathVal,
        url: urlVal,
        password: resolvedPass,
        hasPassword: Boolean(resolvedPass),
        isBeekeeper: true
      });
    }
    return conns;
  } catch (err) {
    console.warn('Could not read beekeeper app.db:', err.message);
    return [];
  }
}

// 2. Read saved connections from Beekeeper Studio app.db and ~/.db_manager_conns.list
app.get('/api/conns', async (req, res) => {
  try {
    const bksConns = await getBeekeeperSavedConnections();
    const customConns = [];

    if (fs.existsSync(CONNS_FILE)) {
      const lines = fs.readFileSync(CONNS_FILE, 'utf-8').split('\n').filter(Boolean);
      lines.forEach((line, idx) => {
        const [name, motorRaw, host, port, user, pass] = line.split('|');
        const motor = normalizeMotor(motorRaw);
        const isFileDb = motor === 'sqlite' || motor === 'duckdb';
        const finalPort = isFileDb ? null : (parseInt(port) || getDefaultPort(motor));
        const alreadyExists = bksConns.some(
          b => b.host === (host || '127.0.0.1') && b.port === finalPort && b.user === (user || 'root')
        );
        if (!alreadyExists) {
          customConns.push({
            id: `custom-${idx + 1}`,
            name: name || 'Unnamed',
            motor,
            host: host || (isFileDb ? 'Local File' : 'localhost'),
            port: finalPort,
            user: user || (isFileDb ? 'N/A' : 'root'),
            password: pass || '',
            hasPassword: Boolean(pass && pass.trim()),
            isBeekeeper: false
          });
        }
      });
    }

    const conns = [...bksConns, ...customConns];
    res.json({ conns });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Save connection directly into Beekeeper Studio's saved_connection table
app.post('/api/conns/save', async (req, res) => {
  const { name, motor, host, port, user, password, database, path: dbPath, url } = req.body;
  const beekeeperDbPath = path.join(HOME, '.config', 'beekeeper-studio', 'app.db');
  if (!fs.existsSync(beekeeperDbPath)) {
    return res.status(404).json({ error: 'No se encontró la base de datos de Beekeeper Studio en ~/.config/beekeeper-studio/app.db' });
  }

  try {
    const connectionType = normalizeMotor(motor);
    const isFileDb = connectionType === 'sqlite' || connectionType === 'duckdb';
    const connName = name || `${connectionType} - ${database || host || (isFileDb ? path.basename(dbPath || '') : 'Conexión')}`;

    // Check if already exists in Beekeeper app.db
    const checkSql = isFileDb
      ? `SELECT id FROM saved_connection WHERE connectionType = '${connectionType}' AND path = '${(dbPath || '').replace(/'/g, "''")}' LIMIT 1;`
      : `SELECT id FROM saved_connection WHERE connectionType = '${connectionType}' AND host = '${(host || '').replace(/'/g, "''")}' AND port = ${parseInt(port) || 0} AND defaultDatabase = '${(database || '').replace(/'/g, "''")}' LIMIT 1;`;

    const { stdout: checkOut } = await execAsync(`sqlite3 "${beekeeperDbPath}" "${checkSql}"`);
    if (checkOut.trim()) {
      return res.json({ success: true, alreadyExists: true, message: 'Esta conexión ya existe guardada en Beekeeper Studio.' });
    }

    const safeName = connName.replace(/'/g, "''");
    const safeHost = (host || '').replace(/'/g, "''");
    const safePort = parseInt(port) || 0;
    const safeUser = (user || '').replace(/'/g, "''");
    const safePass = (password || '').replace(/'/g, "''");
    const safeDb = (database || '').replace(/'/g, "''");
    const safePath = (dbPath || '').replace(/'/g, "''");
    const safeUrl = (url || '').replace(/'/g, "''");

    const insertSql = `INSERT INTO saved_connection (
      createdAt, updatedAt, version, connectionType, host, port, username, password, defaultDatabase, path, url, uniqueHash, name, rememberPassword
    ) VALUES (
      datetime('now'), datetime('now'), 1, '${connectionType}', '${safeHost}', ${safePort}, '${safeUser}', '${safePass}', '${safeDb}', '${safePath}', '${safeUrl}', 'DEPRECATED', '${safeName}', 1
    );`;

    await execAsync(`sqlite3 "${beekeeperDbPath}" "${insertSql}"`);

    if (safePass) {
      try {
        const passFile = path.join(HOME, '.db_manager_passwords');
        fs.appendFileSync(passFile, `\n${safeHost}:${safePort}:${safeUser}:${safePass}`);
      } catch {}
    }

    res.json({ success: true, alreadyExists: false, message: '¡Conexión guardada exitosamente en Beekeeper Studio!' });
  } catch (err) {
    console.error('Error saving connection to Beekeeper:', err);
    res.status(500).json({ error: err.message });
  }
});

// 3. Scan Docker containers (docker ps) for running database containers
const DOCKER_ENGINES = [
  { motor: 'mysql', label: 'MySQL', keywords: ['mysql', 'percona'], defaultPort: 3306, defaultUser: 'root' },
  { motor: 'mariadb', label: 'MariaDB', keywords: ['mariadb'], defaultPort: 3306, defaultUser: 'root' },
  { motor: 'tidb', label: 'TiDB', keywords: ['tidb', 'pingcap'], defaultPort: 4000, defaultUser: 'root' },
  { motor: 'postgresql', label: 'PostgreSQL', keywords: ['postgres', 'timescale', 'postgis'], defaultPort: 5432, defaultUser: 'postgres' },
  { motor: 'cockroachdb', label: 'CockroachDB', keywords: ['cockroach'], defaultPort: 26257, defaultUser: 'root' },
  { motor: 'sqlserver', label: 'SQL Server', keywords: ['mssql', 'sqlserver', 'azure-sql'], defaultPort: 1433, defaultUser: 'sa' },
  { motor: 'oracle', label: 'Oracle', keywords: ['oracle', 'gvenzl/oracle'], defaultPort: 1521, defaultUser: 'system' },
  { motor: 'redis', label: 'Redis', keywords: ['redis', 'keydb', 'dragonfly'], defaultPort: 6379, defaultUser: 'default' },
  { motor: 'mongodb', label: 'MongoDB', keywords: ['mongo', 'mongodb'], defaultPort: 27017, defaultUser: 'admin' },
  { motor: 'clickhouse', label: 'ClickHouse', keywords: ['clickhouse'], defaultPort: 8123, defaultUser: 'default' },
  { motor: 'cassandra', label: 'Cassandra', keywords: ['cassandra', 'scylla'], defaultPort: 9042, defaultUser: 'cassandra' },
  { motor: 'surrealdb', label: 'SurrealDB', keywords: ['surrealdb', 'surreal'], defaultPort: 8000, defaultUser: 'root' },
  { motor: 'firebird', label: 'Firebird', keywords: ['firebird'], defaultPort: 3050, defaultUser: 'SYSDBA' },
  { motor: 'libsql', label: 'LibSQL', keywords: ['libsql', 'sqld'], defaultPort: 8080, defaultUser: 'admin' },
  { motor: 'duckdb', label: 'DuckDB', keywords: ['duckdb'], defaultPort: null, defaultUser: 'admin' }
];

app.get('/api/docker', async (req, res) => {
  try {
    const { stdout } = await execAsync("docker ps --format '{{json .}}' 2>/dev/null || true");
    if (!stdout.trim()) {
      return res.json({ containers: [] });
    }

    const lines = stdout.trim().split('\n');
    const containers = [];

    for (const line of lines) {
      try {
        const item = JSON.parse(line);
        const imageLower = (item.Image || '').toLowerCase();
        const nameLower = (item.Names || '').toLowerCase();

        const matchedRule = DOCKER_ENGINES.find(engine =>
          engine.keywords.some(k => imageLower.includes(k) || nameLower.includes(k))
        );

        if (matchedRule) {
          const motor = matchedRule.motor;
          let hostPort = null;
          let internalPort = matchedRule.defaultPort;

          const portMatch = (item.Ports || '').match(/(?:0\.0\.0\.0|127\.0\.0\.1|:::|\[::\]):(\d+)->(\d+)/);
          if (portMatch) {
            hostPort = parseInt(portMatch[1]);
            internalPort = parseInt(portMatch[2]);
          } else {
            const singlePortMatch = (item.Ports || '').match(/(?:0\.0\.0\.0|127\.0\.0\.1|:::|\[::\]):(\d+)/);
            if (singlePortMatch) {
              hostPort = parseInt(singlePortMatch[1]);
            }
          }

          let connUrl = '';
          const effectivePort = hostPort || internalPort;
          if (motor === 'postgresql') {
            connUrl = `postgresql://${matchedRule.defaultUser}@127.0.0.1:${effectivePort || 5432}/postgres`;
          } else if (motor === 'mysql' || motor === 'mariadb' || motor === 'tidb') {
            connUrl = `${motor}://${matchedRule.defaultUser}@127.0.0.1:${effectivePort || 3306}`;
          } else if (motor === 'redis') {
            connUrl = `redis://127.0.0.1:${effectivePort || 6379}/0`;
          } else if (motor === 'mongodb') {
            connUrl = `mongodb://127.0.0.1:${effectivePort || 27017}`;
          } else if (motor === 'sqlserver') {
            connUrl = `sqlserver://${matchedRule.defaultUser}@127.0.0.1:${effectivePort || 1433}`;
          } else if (motor === 'clickhouse') {
            connUrl = `http://127.0.0.1:${effectivePort || 8123}`;
          } else if (motor === 'cockroachdb') {
            connUrl = `postgresql://${matchedRule.defaultUser}@127.0.0.1:${effectivePort || 26257}/defaultdb?sslmode=disable`;
          } else {
            connUrl = `${motor}://${matchedRule.defaultUser}@127.0.0.1:${effectivePort || ''}`;
          }

          containers.push({
            id: item.ID,
            name: item.Names,
            image: item.Image,
            status: item.Status,
            ports: item.Ports,
            hostPort,
            internalPort,
            motor,
            label: matchedRule.label,
            suggestedUser: matchedRule.defaultUser,
            connUrl
          });
        }
      } catch {
        // Skip malformed lines
      }
    }

    res.json({ containers });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4. Scan local projects for databases (all types: SQLite, MySQL, Postgres, MSSQL, Mongo, Redis, ClickHouse, etc.)
app.get('/api/discovery/projects', async (req, res) => {
  let rootDir = req.query.path || path.join(HOME, 'Proyectos');
  if (rootDir.startsWith('~/')) {
    rootDir = path.join(HOME, rootDir.slice(2));
  } else if (rootDir === '~') {
    rootDir = HOME;
  }

  const maxDepth = parseInt(req.query.depth) || 6;
  const projects = [];

  function parseEnv(content, currentDir) {
    const lines = content.split('\n');
    const dict = {};
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      let val = trimmed.slice(eqIdx + 1).trim();
      val = val.replace(/^["'](.*)["']$/, '$1').split('#')[0].trim();
      dict[key] = val;
    }

    const items = [];

    // Helper to extract database from standard URL
    function parseDatabaseUrl(rawUrl) {
      if (!rawUrl) return null;
      try {
        if (rawUrl.startsWith('sqlite:') || rawUrl.startsWith('file:')) {
          let cleaned = rawUrl.replace(/^sqlite:\/\/|^file:\/\/|^sqlite:|^file:/, '');
          cleaned = cleaned.split('?')[0];
          const absPath = path.isAbsolute(cleaned) ? cleaned : path.resolve(currentDir, cleaned);
          return {
            motor: 'sqlite',
            database: path.basename(absPath),
            filePath: absPath,
            host: 'Archivo Local',
            port: null,
            username: 'N/A',
            hasPassword: false,
            isLocalFile: true,
            connUrl: `sqlite://${absPath}`
          };
        }

        const u = new URL(rawUrl);
        const protocol = u.protocol.replace(':', '').toLowerCase();
        let motor = normalizeMotor(protocol);

        const host = u.hostname || '127.0.0.1';
        const port = parseInt(u.port) || getDefaultPort(motor);
        const database = (u.pathname || '').replace(/^\//, '');
        const username = u.username || getDefaultUser(motor);
        const hasPassword = Boolean(u.password);

        return {
          motor,
          host,
          port,
          database,
          username,
          hasPassword,
          connUrl: rawUrl
        };
      } catch {
        return null;
      }
    }

    // A. Check URL variables: DATABASE_URL, DB_URL, DIRECT_URL, MONGODB_URI, REDIS_URL
    const urlVar = dict.DATABASE_URL || dict.DB_URL || dict.DIRECT_URL;
    if (urlVar) {
      const parsedUrl = parseDatabaseUrl(urlVar);
      if (parsedUrl) items.push(parsedUrl);
    }

    // B. Check standard DB_CONNECTION / DB_CLIENT
    const connVal = (dict.DB_CONNECTION || dict.DATABASE_CLIENT || dict.DB_CLIENT || dict.DATABASE_DIALECT || dict.DB_TYPE || '').toLowerCase();
    if (connVal) {
      const motor = normalizeMotor(connVal);
      if (motor === 'sqlite') {
        const dbPath = dict.DB_DATABASE || dict.SQLITE_DATABASE || dict.SQLITE_DB || 'database.sqlite';
        if (dbPath !== ':memory:') {
          const absPath = path.isAbsolute(dbPath) ? dbPath : path.resolve(currentDir, dbPath);
          if (!items.some(it => it.motor === 'sqlite' && it.filePath === absPath)) {
            items.push({
              motor: 'sqlite',
              database: path.basename(absPath),
              filePath: absPath,
              host: 'Archivo Local',
              port: null,
              username: 'N/A',
              hasPassword: false,
              isLocalFile: true,
              connUrl: `sqlite://${absPath}`
            });
          }
        }
      } else {
        const host = dict.DB_HOST || dict.MYSQL_HOST || dict.POSTGRES_HOST || dict.PGHOST || dict.MSSQL_HOST || '127.0.0.1';
        const database = dict.DB_DATABASE || dict.DB_NAME || dict.POSTGRES_DB || dict.MYSQL_DATABASE || dict.PGDATABASE || dict.MSSQL_DATABASE || '';
        const username = dict.DB_USERNAME || dict.DB_USER || dict.POSTGRES_USER || dict.MYSQL_USER || dict.PGUSER || dict.MSSQL_USER || getDefaultUser(motor);
        const port = parseInt(dict.DB_PORT || dict.POSTGRES_PORT || dict.PGPORT || dict.MSSQL_PORT) || getDefaultPort(motor);
        const hasPassword = Boolean(dict.DB_PASSWORD || dict.POSTGRES_PASSWORD || dict.MYSQL_PASSWORD || dict.PGPASSWORD || dict.MSSQL_PASSWORD);

        if (!items.some(it => it.motor === motor && it.database === database && it.host === host)) {
          items.push({
            motor,
            host,
            port,
            database,
            username,
            hasPassword,
            connUrl: `${motor}://${username}@${host}:${port}/${database}`
          });
        }
      }
    }

    // C. Check for dedicated Postgres block if not already added
    if ((dict.POSTGRES_DB || dict.PGDATABASE) && !items.some(it => it.motor === 'postgresql')) {
      const host = dict.POSTGRES_HOST || dict.PGHOST || '127.0.0.1';
      const port = parseInt(dict.POSTGRES_PORT || dict.PGPORT) || 5432;
      const database = dict.POSTGRES_DB || dict.PGDATABASE || 'postgres';
      const username = dict.POSTGRES_USER || dict.PGUSER || 'postgres';
      const hasPassword = Boolean(dict.POSTGRES_PASSWORD || dict.PGPASSWORD);
      items.push({
        motor: 'postgresql',
        host,
        port,
        database,
        username,
        hasPassword,
        connUrl: `postgresql://${username}@${host}:${port}/${database}`
      });
    }

    // D. Check for dedicated MySQL / MariaDB block if not already added
    if ((dict.MYSQL_DATABASE || dict.MARIADB_DATABASE) && !items.some(it => it.motor === 'mysql' || it.motor === 'mariadb')) {
      const motor = dict.MARIADB_DATABASE ? 'mariadb' : 'mysql';
      const host = dict.MYSQL_HOST || dict.MARIADB_HOST || '127.0.0.1';
      const port = parseInt(dict.MYSQL_PORT || dict.MARIADB_PORT) || 3306;
      const database = dict.MYSQL_DATABASE || dict.MARIADB_DATABASE || '';
      const username = dict.MYSQL_USER || dict.MARIADB_USER || 'root';
      const hasPassword = Boolean(dict.MYSQL_PASSWORD || dict.MARIADB_PASSWORD);
      items.push({
        motor,
        host,
        port,
        database,
        username,
        hasPassword,
        connUrl: `${motor}://${username}@${host}:${port}/${database}`
      });
    }

    // E. Check for MongoDB if configured
    const mongoUri = dict.MONGODB_URI || dict.MONGO_URL;
    if (mongoUri) {
      const parsed = parseDatabaseUrl(mongoUri);
      if (parsed && !items.some(it => it.motor === 'mongodb')) items.push(parsed);
    } else if (dict.MONGO_DATABASE || dict.MONGO_HOST) {
      if (!items.some(it => it.motor === 'mongodb')) {
        const host = dict.MONGO_HOST || '127.0.0.1';
        const port = parseInt(dict.MONGO_PORT) || 27017;
        const database = dict.MONGO_DATABASE || 'admin';
        const username = dict.MONGO_USER || dict.MONGO_INITDB_ROOT_USERNAME || 'admin';
        const hasPassword = Boolean(dict.MONGO_PASSWORD || dict.MONGO_INITDB_ROOT_PASSWORD);
        items.push({
          motor: 'mongodb',
          host,
          port,
          database,
          username,
          hasPassword,
          connUrl: `mongodb://${username}@${host}:${port}/${database}`
        });
      }
    }

    // F. Check for Redis cache/database if configured
    const redisUri = dict.REDIS_URL;
    if (redisUri) {
      const parsed = parseDatabaseUrl(redisUri);
      if (parsed && !items.some(it => it.motor === 'redis')) items.push(parsed);
    } else if (dict.REDIS_HOST && !items.some(it => it.motor === 'redis')) {
      const host = dict.REDIS_HOST || '127.0.0.1';
      const port = parseInt(dict.REDIS_PORT) || 6379;
      const database = dict.REDIS_DB || '0';
      const hasPassword = Boolean(dict.REDIS_PASSWORD && dict.REDIS_PASSWORD !== 'null');
      items.push({
        motor: 'redis',
        host,
        port,
        database: `DB ${database}`,
        username: 'default',
        hasPassword,
        connUrl: `redis://${host}:${port}/${database}`
      });
    }

    // G. Check for ClickHouse
    if ((dict.CLICKHOUSE_DB || dict.CLICKHOUSE_HOST || dict.CLICKHOUSE_URL) && !items.some(it => it.motor === 'clickhouse')) {
      if (dict.CLICKHOUSE_URL) {
        const parsed = parseDatabaseUrl(dict.CLICKHOUSE_URL);
        if (parsed) items.push(parsed);
      } else {
        const host = dict.CLICKHOUSE_HOST || '127.0.0.1';
        const port = parseInt(dict.CLICKHOUSE_PORT) || 8123;
        const database = dict.CLICKHOUSE_DB || 'default';
        const username = dict.CLICKHOUSE_USER || 'default';
        const hasPassword = Boolean(dict.CLICKHOUSE_PASSWORD);
        items.push({
          motor: 'clickhouse',
          host,
          port,
          database,
          username,
          hasPassword,
          connUrl: `http://${host}:${port}`
        });
      }
    }

    // H. Relational database from DB_HOST / DB_DATABASE / DB_NAME (if not already captured by URL)
    const relDbName = dict.DB_DATABASE || dict.DB_NAME;
    if (relDbName || dict.DB_HOST) {
      const host = dict.DB_HOST || '127.0.0.1';
      const port = parseInt(dict.DB_PORT) || 3306;
      let motor = 'mysql';
      if (port === 5432) motor = 'postgresql';
      else if (port === 1433) motor = 'sqlserver';
      else if (port === 27017) motor = 'mongodb';
      else if (port === 6379) motor = 'redis';
      else if (port === 8123 || port === 9000) motor = 'clickhouse';
      else if (port === 1521) motor = 'oracle';
      else if (port === 9042) motor = 'cassandra';

      const alreadyPresent = items.some(it =>
        it.motor === motor &&
        (it.database === (relDbName || '') || (relDbName && it.database === relDbName)) &&
        it.motor !== 'redis'
      );

      if (!alreadyPresent && relDbName) {
        items.unshift({
          motor,
          host,
          port,
          database: relDbName,
          username: dict.DB_USERNAME || dict.DB_USER || getDefaultUser(motor),
          hasPassword: Boolean(dict.DB_PASSWORD),
          connUrl: `${motor}://${dict.DB_USERNAME || dict.DB_USER || getDefaultUser(motor)}@${host}:${port}/${relDbName}`
        });
      }
    }

    return items;
  }

  function scanDir(currentDir, depth = 0) {
    if (depth > maxDepth) return;
    try {
      if (!fs.existsSync(currentDir)) return;
      const entries = fs.readdirSync(currentDir, { withFileTypes: true });

      const baseName = path.basename(currentDir);
      let displayName = baseName;
      if (['back', 'front', 'api', 'server', 'app'].includes(baseName.toLowerCase())) {
        const parent = path.basename(path.dirname(currentDir));
        displayName = `${parent}/${baseName}`;
      }

      // 1. Scan for Environment files (.env, .env.local, .env.development, .env.docker)
      const envFiles = entries.filter(e => e.isFile() && (
        e.name === '.env' ||
        e.name === '.env.local' ||
        e.name === '.env.development' ||
        e.name === '.env.docker' ||
        e.name === '.env.production'
      ));

      for (const envFile of envFiles) {
        try {
          const envPath = path.join(currentDir, envFile.name);
          const envContent = fs.readFileSync(envPath, 'utf-8');
          const dbs = parseEnv(envContent, currentDir);

          for (const db of dbs) {
            if (db.database || (db.host && db.host !== '127.0.0.1' && db.host !== 'localhost') || db.isLocalFile) {
              const uniqueKey = `${envPath}:${db.motor}:${db.database}:${db.port || db.filePath || ''}`;
              if (!projects.some(p => p.uniqueKey === uniqueKey)) {
                // For local sqlite files, add file size if exists
                let fileSize = '';
                if (db.filePath && fs.existsSync(db.filePath)) {
                  try {
                    fileSize = formatBytes(fs.statSync(db.filePath).size);
                  } catch {}
                }

                projects.push({
                  uniqueKey,
                  name: displayName,
                  fileName: envFile.name,
                  path: envPath,
                  fileSize: fileSize || db.fileSize || '',
                  ...db
                });
              }
            }
          }
        } catch {}
      }

      // 2. Scan directly for SQLite / DuckDB database files (.sqlite, .sqlite3, .db3, .duckdb, and valid .db files)
      const directDbFiles = entries.filter(e => e.isFile() && (
        e.name.endsWith('.sqlite') ||
        e.name.endsWith('.sqlite3') ||
        e.name.endsWith('.db3') ||
        e.name.endsWith('.s3db') ||
        e.name.endsWith('.duckdb') ||
        (e.name.endsWith('.db') && !['app.db', 'package.db', 'thumbs.db'].includes(e.name.toLowerCase()))
      ));

      for (const file of directDbFiles) {
        try {
          const filePath = path.join(currentDir, file.name);
          const isDuck = file.name.endsWith('.duckdb');
          if (isDuck || isSqliteFile(filePath)) {
            const motor = isDuck ? 'duckdb' : 'sqlite';
            const uniqueKey = `file:${filePath}`;
            if (!projects.some(p => p.filePath === filePath || p.uniqueKey === uniqueKey)) {
              let fileSize = '';
              try {
                fileSize = formatBytes(fs.statSync(filePath).size);
              } catch {}

              projects.push({
                uniqueKey,
                name: displayName,
                fileName: file.name,
                path: filePath,
                filePath,
                fileSize,
                motor,
                database: file.name,
                host: 'Archivo Local',
                port: null,
                username: 'N/A',
                hasPassword: false,
                isLocalFile: true,
                connUrl: `${motor}://${filePath}`
              });
            }
          }
        } catch {}
      }

      // 3. Recurse into subdirectories
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const name = entry.name;
          if (
            name.startsWith('.') ||
            name === 'node_modules' ||
            name === 'vendor' ||
            name === 'dist' ||
            name === 'target' ||
            name === 'build' ||
            name === '.next' ||
            name === 'storage' ||
            name === '.cache'
          ) {
            continue;
          }
          scanDir(path.join(currentDir, name), depth + 1);
        }
      }
    } catch {
      // ignore unreadable/permission folders
    }
  }

  scanDir(rootDir);
  res.json({ projects, scannedDir: rootDir, maxDepth });
});

// 5. Query databases list for a connection
app.post('/api/databases', async (req, res) => {
  let { motor = 'mysql', host, port, user, pass, name } = req.body;
  const normMotor = normalizeMotor(motor);
  const isMysql = normMotor === 'mysql' || normMotor === 'mariadb' || normMotor === 'tidb';
  const isPg = normMotor === 'postgresql' || normMotor === 'cockroachdb' || motor === 'pg';
  const rawPass = resolvePassword(host, port, user, pass, name);
  const safePass = rawPass.replace(/'/g, "'\\''");
  try {
    let cmd = '';
    if (isMysql) {
      cmd = `MYSQL_PWD='${safePass}' mysql -h${host} -P${port} -u${user} -N -s -e 'SHOW DATABASES;' 2>/dev/null`;
    } else if (isPg) {
      cmd = `PGPASSWORD='${safePass}' psql -h ${host} -p ${port} -U ${user} -t -c "SELECT datname FROM pg_database WHERE datistemplate = false;" postgres 2>/dev/null`;
    }

    if (!cmd) return res.json({ databases: [] });

    const { stdout } = await execAsync(cmd);
    const ignoreDbs = ['information_schema', 'performance_schema', 'mysql', 'sys', 'postgres', 'template0', 'template1'];
    const databases = stdout.split('\n').map(s => s.trim()).filter(s => s && !ignoreDbs.includes(s));
    res.json({ databases });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 6. Query tables list for a database
app.post('/api/tables', async (req, res) => {
  let { motor = 'mysql', host, port, user, pass, database, name } = req.body;
  const normMotor = normalizeMotor(motor);
  const isMysql = normMotor === 'mysql' || normMotor === 'mariadb' || normMotor === 'tidb';
  const isPg = normMotor === 'postgresql' || normMotor === 'cockroachdb' || motor === 'pg';
  const rawPass = resolvePassword(host, port, user, pass, name);
  const safePass = rawPass.replace(/'/g, "'\\''");
  try {
    let cmd = '';
    if (isMysql) {
      cmd = `MYSQL_PWD='${safePass}' mysql -h${host} -P${port} -u${user} ${database} -N -s -e 'SHOW TABLES;' 2>/dev/null`;
    } else if (isPg) {
      cmd = `PGPASSWORD='${safePass}' psql -h ${host} -p ${port} -U ${user} -d ${database} -t -c "SELECT tablename FROM pg_tables WHERE schemaname = 'public';" 2>/dev/null`;
    }

    if (!cmd) return res.json({ tables: [] });

    const { stdout } = await execAsync(cmd);
    const tables = stdout.split('\n').map(s => s.trim()).filter(Boolean);
    res.json({ tables });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 6.5 Query database size & stats
app.post('/api/database/info', async (req, res) => {
  let { motor = 'mysql', host, port, user, pass, database, name } = req.body;
  const normMotor = normalizeMotor(motor);
  const isMysql = normMotor === 'mysql' || normMotor === 'mariadb' || normMotor === 'tidb';
  const isPg = normMotor === 'postgresql' || normMotor === 'cockroachdb' || motor === 'pg';
  const rawPass = resolvePassword(host, port, user, pass, name);
  const safePass = rawPass.replace(/'/g, "'\\''");
  try {
    let cmd = '';
    if (isMysql) {
      cmd = `MYSQL_PWD='${safePass}' mysql -h${host} -P${port} -u${user} -N -s -e "SELECT ROUND(SUM(data_length + index_length) / (1024 * 1024), 2) AS mb, COUNT(*) AS tables FROM information_schema.TABLES WHERE table_schema='${database}';" 2>/dev/null`;
    } else if (isPg) {
      cmd = `PGPASSWORD='${safePass}' psql -h ${host} -p ${port} -U ${user} -d ${database} -t -c "SELECT ROUND(pg_database_size('${database}') / (1024.0 * 1024.0), 2);" 2>/dev/null`;
    }

    if (!cmd) return res.json({ mb: 0, tables: 0, sqlMb: 0 });

    const { stdout } = await execAsync(cmd);
    const parts = stdout.trim().split(/\s+/);
    const mb = parseFloat(parts[0]) || 0;
    const tables = parseInt(parts[1]) || 0;
    // Uncompressed SQL text is roughly 2.8x InnoDB binary footprint for JSON/text heavy DBs
    const sqlMb = Math.round(mb * 2.8);
    res.json({ mb, tables, sqlMb });
  } catch (err) {
    res.json({ mb: 0, tables: 0, sqlMb: 0, error: err.message });
  }
});

// 6.6 Query table columns metadata for cross-connection schema diff
app.post('/api/schema/inspect', async (req, res) => {
  let { motor = 'mysql', host, port, user, pass, database, name } = req.body;
  const rawPass = resolvePassword(host, port, user, pass, name);
  const safePass = rawPass.replace(/'/g, "'\\''");

  try {
    let cmd = '';
    if (motor === 'mysql') {
      const sql = `SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, IFNULL(COLUMN_DEFAULT, 'NULL') FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = '${database}' ORDER BY TABLE_NAME, ORDINAL_POSITION;`;
      cmd = `MYSQL_PWD='${safePass}' mysql -h${host} -P${port} -u${user} -N -s -e "${sql}" 2>/dev/null`;
    } else if (motor === 'pg') {
      const sql = `SELECT table_name, column_name, data_type, is_nullable, COALESCE(column_default, 'NULL') FROM information_schema.columns WHERE table_schema = 'public' ORDER BY table_name, ordinal_position;`;
      cmd = `PGPASSWORD='${safePass}' psql -h ${host} -p ${port} -U ${user} -d ${database} -t -A -F "\\t" -c "${sql}" 2>/dev/null`;
    }

    if (!cmd) return res.json({ columns: [] });

    const { stdout } = await execAsync(cmd);
    const lines = stdout.trim().split('\n').filter(Boolean);
    const columns = [];
    for (const line of lines) {
      const parts = line.split('\t');
      if (parts.length >= 3) {
        columns.push({
          table: parts[0],
          column: parts[1],
          type: parts[2],
          nullable: parts[3] || 'YES',
          defaultVal: parts[4] === 'NULL' ? null : parts[4]
        });
      }
    }

    res.json({ columns });
  } catch (err) {
    console.error('Error in /api/schema/inspect:', err.message);
    res.json({ columns: [], error: err.message });
  }
});

// 7. Live Stream Cloning with Server-Sent Events (SSE) progress
app.post('/api/clone/stream', (req, res) => {
  let {
    srcHost, srcPort = 3306, srcUser, srcPass = '', srcDb,
    dstHost, dstPort = 3306, dstUser, dstPass = '', dstDb,
    motor = 'mysql',
    excludeTables = [],
    maskData = false
  } = req.body;

  // Prevent Node.js from terminating long-running streaming requests
  req.setTimeout(0);
  res.setTimeout(0);
  req.socket?.setTimeout(0);
  req.socket?.setNoDelay(true);
  req.socket?.setKeepAlive(true);

  srcPass = resolvePassword(srcHost, srcPort, srcUser, srcPass);
  dstPass = resolvePassword(dstHost, dstPort, dstUser, dstPass);

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const sendEvent = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  sendEvent('log', { message: `Iniciando clonado en streaming: ${srcDb} (${srcHost}) -> ${dstDb} (${dstHost})` });

  let bytesTransferred = 0;
  const startTime = Date.now();
  let lastBytes = 0;
  let lastTime = startTime;

  const progressTracker = new Transform({
    transform(chunk, encoding, callback) {
      bytesTransferred += chunk.length;
      callback(null, chunk);
    }
  });

  const progressInterval = setInterval(() => {
    const now = Date.now();
    const timeDiff = (now - lastTime) / 1000;
    const bytesDiff = bytesTransferred - lastBytes;
    const speed = timeDiff > 0 ? bytesDiff / timeDiff : 0;
    lastBytes = bytesTransferred;
    lastTime = now;

    sendEvent('progress', {
      bytes: bytesTransferred,
      mb: (bytesTransferred / (1024 * 1024)).toFixed(2),
      speedMb: (speed / (1024 * 1024)).toFixed(2),
      elapsedSec: Math.floor((now - startTime) / 1000)
    });
  }, 500);

  // Auto-create destination database and set max_allowed_packet
  const dstSafePass = (dstPass || '').replace(/'/g, "'\\''");
  let createCmd = '';
  if (motor === 'mysql') {
    createCmd = `MYSQL_PWD='${dstSafePass}' mysql -h${dstHost} -P${dstPort} -u${dstUser} -e "SET GLOBAL max_allowed_packet=1073741824; CREATE DATABASE IF NOT EXISTS \\\`${dstDb}\\\` CHARACTER SET utf8mb4;" 2>/dev/null || MYSQL_PWD='${dstSafePass}' mysql -h${dstHost} -P${dstPort} -u${dstUser} -e "CREATE DATABASE IF NOT EXISTS \\\`${dstDb}\\\` CHARACTER SET utf8mb4;" 2>/dev/null`;
  } else if (motor === 'pg') {
    createCmd = `PGPASSWORD='${dstSafePass}' psql -h ${dstHost} -p ${dstPort} -U ${dstUser} postgres -c "CREATE DATABASE \\"${dstDb}\\";" 2>/dev/null || true`;
  }

  exec(createCmd, (err) => {
    if (err) {
      sendEvent('log', { message: `Aviso al verificar/crear base destino: ${err.message}` });
    }

    sendEvent('log', { message: `Base de datos destino verificada: ${dstDb}` });

    // Spawn source process
    let srcProc = null;
    let dstProc = null;

    if (motor === 'mysql') {
      const dumpArgs = [
        `-h${srcHost}`, `-P${srcPort}`, `-u${srcUser}`,
        '--compress',
        '--single-transaction',
        '--quick',
        '--hex-blob',
        '--default-character-set=utf8mb4',
        '--max-allowed-packet=512M',
        '--net-buffer-length=32768',
        '--no-tablespaces',
        '--routines',
        '--triggers',
        srcDb
      ];
      if (Array.isArray(excludeTables)) {
        for (const t of excludeTables) {
          dumpArgs.push(`--ignore-table=${srcDb}.${t}`);
        }
      }

      const srcEnv = { ...process.env, MYSQL_PWD: srcPass };
      srcProc = spawn('mysqldump', dumpArgs, { env: srcEnv });

      const dstArgs = [
        `-h${dstHost}`,
        `-P${dstPort}`,
        `-u${dstUser}`,
        '--binary-mode',
        '--batch',
        '--default-character-set=utf8mb4',
        '--max-allowed-packet=512M',
        '--init-command=SET SESSION foreign_key_checks=0; SET SESSION unique_checks=0; SET SESSION sql_log_bin=0;',
        '--force',
        dstDb
      ];
      const dstEnv = { ...process.env, MYSQL_PWD: dstPass };
      dstProc = spawn('mysql', dstArgs, { env: dstEnv });
    } else if (motor === 'pg') {
      const dumpArgs = [
        `-h`, srcHost, `-p`, String(srcPort), `-U`, srcUser, `-d`, srcDb,
        `--format=p`, `--no-owner`, `--no-privileges`
      ];
      if (Array.isArray(excludeTables)) {
        for (const t of excludeTables) {
          dumpArgs.push(`-T`, t);
        }
      }
      const srcEnv = { ...process.env, PGPASSWORD: srcPass };
      srcProc = spawn('pg_dump', dumpArgs, { env: srcEnv });

      const dstArgs = [`-h`, dstHost, `-p`, String(dstPort), `-U`, dstUser, `-d`, dstDb];
      const dstEnv = { ...process.env, PGPASSWORD: dstPass };
      dstProc = spawn('psql', dstArgs, { env: dstEnv });
    }

    if (!srcProc || !dstProc) {
      clearInterval(progressInterval);
      sendEvent('error', { message: 'Motor no soportado para streaming' });
      return res.end();
    }

    // Sanitizer stream: strip DEFINER, USE, SQL_LOG_BIN, GTID_PURGED, etc.
    // Fast-path: only parse string and run regex when DDL keywords or maskData are active
    const sanitizer = new Transform({
      transform(chunk, encoding, callback) {
        if (!maskData) {
          const hasKeyword =
            chunk.includes('DEFINER=') ||
            chunk.includes('GTID_PURGED') ||
            chunk.includes('SQL_LOG_BIN') ||
            chunk.includes('CREATE DATABASE') ||
            chunk.includes('USE `');
          if (!hasKeyword) {
            return callback(null, chunk);
          }
        }

        let str = chunk.toString('utf-8');
        // Clean DEFINER
        str = str.replace(/DEFINER=[^ *;]+/g, '');
        // Clean USE statements
        str = str.replace(/^[Uu][Ss][Ee]\s+[`'"]?[^;]+[`'"]?;/gm, '');
        // Clean CREATE DATABASE
        str = str.replace(/^CREATE DATABASE[^;]+;/gmi, '');
        // Clean SQL_LOG_BIN
        str = str.replace(/SET @@SESSION\.SQL_LOG_BIN[^;]+;/gmi, '');
        // Clean GTID_PURGED
        str = str.replace(/SET @@GLOBAL\.GTID_PURGED[^;]+;/gmi, '');

        if (maskData) {
          // Obfuscate emails: something@domain.com -> user_***@masked.local
          str = str.replace(/([a-zA-Z0-9._%+-]{2})[a-zA-Z0-9._%+-]*@([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g, '$1***@masked.local');
        }

        callback(null, Buffer.from(str, 'utf-8'));
      }
    });

    let dstStderrLines = [];
    let srcStderrLines = [];

    dstProc.stderr.on('data', (d) => {
      const msg = d.toString();
      if (!msg.includes('Using a password on the command line')) {
        if (msg.includes('ERROR 3105') || msg.includes('generated column')) {
          const tableName = msg.match(/in table '([^']+)'/)?.[1] || 'telemetría';
          sendEvent('log', { message: `[RESTORE AVISO] Tabla '${tableName}': fila con columna virtual omitida (MySQL 8.0 evalúa la columna automáticamente).` });
        } else {
          sendEvent('log', { message: `[RESTORE] ${msg.trim()}` });
        }
        const lines = msg.split('\n').map(l => l.trim()).filter(Boolean);
        dstStderrLines.push(...lines);
        if (dstStderrLines.length > 25) dstStderrLines = dstStderrLines.slice(-25);
      }
    });

    srcProc.stderr.on('data', (d) => {
      const msg = d.toString();
      if (!msg.includes('Using a password on the command line')) {
        sendEvent('log', { message: `[DUMP] ${msg.trim()}` });
        const lines = msg.split('\n').map(l => l.trim()).filter(Boolean);
        srcStderrLines.push(...lines);
        if (srcStderrLines.length > 25) srcStderrLines = srcStderrLines.slice(-25);
      }
    });

    // Handle stream errors so EPIPE does not crash
    dstProc.stdin.on('error', () => {});
    sanitizer.on('error', () => {});
    progressTracker.on('error', () => {});
    srcProc.stdout.on('error', () => {});

    let hasFinished = false;
    const finish = (isSuccess, customError = null) => {
      if (hasFinished) return;
      hasFinished = true;

      clearInterval(progressInterval);

      // Kill any lingering child processes immediately
      try { srcProc.kill('SIGTERM'); } catch {}
      try { dstProc.kill('SIGTERM'); } catch {}

      const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
      const totalMb = (bytesTransferred / (1024 * 1024)).toFixed(2);

      if (isSuccess) {
        sendEvent('complete', {
          message: `✔ Clonado completado con éxito: ${totalMb} MB en ${totalTime}s`,
          bytes: bytesTransferred,
          seconds: totalTime
        });
      } else {
        const cleanDst = dstStderrLines.filter(l => !l.includes('Using a password') && !l.includes('Deprecated program'));
        const cleanSrc = srcStderrLines.filter(l => !l.includes('Using a password') && !l.includes('Deprecated program'));

        let errorMsg = customError;
        if (!errorMsg) {
          if (cleanDst.length > 0) {
            errorMsg = cleanDst.slice(-3).join(' | ');
          } else if (cleanSrc.length > 0) {
            errorMsg = cleanSrc.slice(-3).join(' | ');
          } else {
            errorMsg = 'Error inesperado en la transferencia de datos.';
          }
        }

        sendEvent('error', {
          message: errorMsg,
          details: cleanDst.concat(cleanSrc).slice(-10)
        });
      }

      // Allow event buffer to flush to client before closing connection
      setTimeout(() => {
        try { res.end(); } catch {}
      }, 500);
    };

    srcProc.stdout
      .pipe(sanitizer)
      .pipe(progressTracker)
      .pipe(dstProc.stdin);

    dstProc.on('close', (code) => {
      if (code === 0) {
        finish(true);
      } else {
        finish(false);
      }
    });

    srcProc.on('close', (code) => {
      if (code !== 0 && !hasFinished) {
        finish(false);
      }
    });

    srcProc.on('error', (err) => {
      finish(false, `Error en proceso origen (mysqldump): ${err.message}`);
    });

    dstProc.on('error', (err) => {
      finish(false, `Error en proceso destino (mysql): ${err.message}`);
    });

    req.on('close', () => {
      if (!hasFinished) {
        hasFinished = true;
        clearInterval(progressInterval);
        try { srcProc.kill('SIGTERM'); } catch {}
        try { dstProc.kill('SIGTERM'); } catch {}
      }
    });
  });
});

const server = app.listen(PORT, '127.0.0.1', () => {
  console.log(`🦅 DB Manager Companion Daemon running on http://127.0.0.1:${PORT}`);
});
server.timeout = 0;
server.keepAliveTimeout = 0;
server.requestTimeout = 0;
server.headersTimeout = 0;

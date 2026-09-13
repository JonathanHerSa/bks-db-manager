import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { exec, execFile } from 'child_process';
import { promisify } from 'util';
import { Transform } from 'stream';
import { StringDecoder } from 'string_decoder';
import { normalizeMotor, getDefaultPort, supportsCloneStream } from '../shared/dbEngines.js';
import { getEngine } from './engines/index.js';
import { escSqlStr } from './engines/escaping.js';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);
const app = express();
const PORT = process.env.BKS_DB_MANAGER_PORT || 58765;

// NOTE (security): cors() with no options reflects any Origin. This daemon executes
// system commands, reads local files and dumps databases, so this is intentionally
// flagged for a product decision (see audit notes) rather than silently changed here,
// since Beekeeper Studio plugin iframes may not send a whitelistable Origin header.
app.use(cors());
app.use(express.json({ limit: '2mb' }));

// Redacts anything that looks like a credential/password from strings before they are
// ever logged to the console or sent back to the HTTP client.
function sanitizeSecrets(str = '') {
  return String(str)
    .replace(/(MYSQL_PWD|PGPASSWORD)=(\S+)/gi, '$1=[REDACTED]')
    .replace(/(password|pwd|pass)\s*[:=]\s*['"]?[^'"\s;]+['"]?/gi, '$1=[REDACTED]');
}

// Generic-but-safe error message for API responses: never forwards raw command lines,
// SQL text or stack traces (which could contain credentials or leak internal paths).
function safeErrorMessage(err, fallback = 'Error ejecutando la operación.') {
  if (!err) return fallback;
  const stderr = typeof err.stderr === 'string' ? err.stderr : (err.stderr ? err.stderr.toString() : '');
  const base = stderr && stderr.trim() ? stderr.trim() : fallback;
  return sanitizeSecrets(base).slice(0, 2000);
}

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
  res.json({ ok: true, version: '1.0.0', tools: status });
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

    const { stdout } = await execFileAsync('sqlite3', [
      dbPath,
      'SELECT id, name, connectionType, host, port, username, defaultDatabase, path, url FROM saved_connection;'
    ]);
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
      // NOTE (security): the resolved password is intentionally NOT included in the
      // response — GET /api/conns has no authentication and, with CORS wide open, any
      // web page could otherwise read every saved credential in plaintext. Endpoints
      // that actually need the password (`/api/databases`, `/api/tables`,
      // `/api/database/info`, `/api/schema/inspect`, `/api/clone/stream`) already
      // resolve it themselves server-side via `resolvePassword()` when the caller
      // sends an empty `pass`, so the frontend never needs to see or re-send it.
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
            hasPassword: Boolean(pass && pass.trim()),
            isBeekeeper: false
          });
        }
      });
    }

    const conns = [...bksConns, ...customConns];
    res.json({ conns });
  } catch (err) {
    console.error('Error listing connections:', sanitizeSecrets(err.message || ''));
    res.status(500).json({ error: safeErrorMessage(err, 'No se pudieron leer las conexiones guardadas.') });
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

    // NOTE: normalizeMotor() falls back to returning the raw (lowercased) input
    // verbatim for unrecognized engine names, so `connectionType` must still be
    // treated as untrusted input and escaped before being embedded in SQL text.
    const safeConnectionType = escSqlStr(connectionType);

    // Check if already exists in Beekeeper app.db
    const checkSql = isFileDb
      ? `SELECT id FROM saved_connection WHERE connectionType = '${safeConnectionType}' AND path = '${escSqlStr(dbPath || '')}' LIMIT 1;`
      : `SELECT id FROM saved_connection WHERE connectionType = '${safeConnectionType}' AND host = '${escSqlStr(host || '')}' AND port = ${parseInt(port) || 0} AND defaultDatabase = '${escSqlStr(database || '')}' LIMIT 1;`;

    const { stdout: checkOut } = await execFileAsync('sqlite3', [beekeeperDbPath, checkSql]);
    if (checkOut.trim()) {
      return res.json({ success: true, alreadyExists: true, message: 'Esta conexión ya existe guardada en Beekeeper Studio.' });
    }

    const safeName = escSqlStr(connName);
    const safeHost = escSqlStr(host || '');
    const safePort = parseInt(port) || 0;
    const safeUser = escSqlStr(user || '');
    const safePass = escSqlStr(password || '');
    const safeDb = escSqlStr(database || '');
    const safePath = escSqlStr(dbPath || '');
    const safeUrl = escSqlStr(url || '');

    const insertSql = `INSERT INTO saved_connection (
      createdAt, updatedAt, version, connectionType, host, port, username, password, defaultDatabase, path, url, uniqueHash, name, rememberPassword
    ) VALUES (
      datetime('now'), datetime('now'), 1, '${safeConnectionType}', '${safeHost}', ${safePort}, '${safeUser}', '${safePass}', '${safeDb}', '${safePath}', '${safeUrl}', 'DEPRECATED', '${safeName}', 1
    );`;

    await execFileAsync('sqlite3', [beekeeperDbPath, insertSql]);

    if (password) {
      try {
        const passFile = path.join(HOME, '.db_manager_passwords');
        // Raw (unescaped) values on disk; file is created/kept with owner-only permissions
        // since it stores plaintext credentials.
        fs.appendFileSync(passFile, `\n${host || ''}:${parseInt(port) || 0}:${user || ''}:${password}`, { mode: 0o600 });
        fs.chmodSync(passFile, 0o600);
      } catch {}
    }

    res.json({ success: true, alreadyExists: false, message: '¡Conexión guardada exitosamente en Beekeeper Studio!' });
  } catch (err) {
    // NOTE: never log or return `err` as-is here: the sqlite3 argv for this command
    // contains the plaintext SQL (including the password), which Node attaches to
    // failed-exec errors (`Command failed: sqlite3 <db> <sql>`).
    console.error('Error saving connection to Beekeeper (details redacted).');
    res.status(500).json({ error: 'No se pudo guardar la conexión en Beekeeper Studio.' });
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
  let rootDir = req.query.path;
  if (rootDir !== undefined && typeof rootDir !== 'string') {
    return res.status(400).json({ error: 'Parámetro "path" inválido.' });
  }
  rootDir = rootDir || path.join(HOME, 'Proyectos');
  if (rootDir.startsWith('~/')) {
    rootDir = path.join(HOME, rootDir.slice(2));
  } else if (rootDir === '~') {
    rootDir = HOME;
  }

  // Clamp to a sane range: unbounded recursion depth from an untrusted caller
  // (any origin, since this daemon has no auth) could be used for a local DoS.
  const requestedDepth = parseInt(req.query.depth, 10);
  const maxDepth = Number.isFinite(requestedDepth) ? Math.min(Math.max(requestedDepth, 0), 12) : 6;
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

  try {
    scanDir(rootDir);
    res.json({ projects, scannedDir: rootDir, maxDepth });
  } catch (err) {
    console.error('Error scanning projects (details redacted).');
    res.status(500).json({ error: 'No se pudo escanear el directorio indicado.' });
  }
});

// 5. Query databases list for a connection
app.post('/api/databases', async (req, res) => {
  const { motor = 'mysql', host, port, user, pass, name } = req.body;
  const engine = getEngine(normalizeMotor(motor));
  if (!engine) return res.json({ databases: [] });
  const rawPass = resolvePassword(host, port, user, pass, name);
  try {
    const databases = await engine.listDatabases({ host, port, user, pass: rawPass });
    res.json({ databases });
  } catch (err) {
    res.status(500).json({ error: safeErrorMessage(err, 'No se pudo obtener la lista de bases de datos.') });
  }
});

// 6. Query tables list for a database
app.post('/api/tables', async (req, res) => {
  const { motor = 'mysql', host, port, user, pass, database, name } = req.body;
  const engine = getEngine(normalizeMotor(motor));
  if (!engine) return res.json({ tables: [] });
  const rawPass = resolvePassword(host, port, user, pass, name);
  try {
    const tables = await engine.listTables({ host, port, user, pass: rawPass, database });
    res.json({ tables });
  } catch (err) {
    res.status(500).json({ error: safeErrorMessage(err, 'No se pudo obtener la lista de tablas.') });
  }
});

// 6.5 Query database size & stats
app.post('/api/database/info', async (req, res) => {
  const { motor = 'mysql', host, port, user, pass, database, name } = req.body;
  const engine = getEngine(normalizeMotor(motor));
  if (!engine) return res.json({ mb: 0, tables: 0, sqlMb: 0 });
  const rawPass = resolvePassword(host, port, user, pass, name);
  try {
    const { mb, tables } = await engine.getDatabaseInfo({ host, port, user, pass: rawPass, database });
    // Uncompressed SQL text is roughly 2.8x the binary on-disk footprint for JSON/text heavy DBs
    const sqlMb = Math.round(mb * 2.8);
    res.json({ mb, tables, sqlMb });
  } catch (err) {
    res.json({ mb: 0, tables: 0, sqlMb: 0, error: safeErrorMessage(err, 'No se pudo obtener información de la base de datos.') });
  }
});

// 6.6 Query table columns metadata for cross-connection schema diff
app.post('/api/schema/inspect', async (req, res) => {
  const { motor = 'mysql', host, port, user, pass, database, name } = req.body;
  const engine = getEngine(normalizeMotor(motor));
  if (!engine) return res.json({ columns: [] });
  const rawPass = resolvePassword(host, port, user, pass, name);
  try {
    const columns = await engine.inspectSchema({ host, port, user, pass: rawPass, database });
    res.json({ columns });
  } catch (err) {
    console.error('Error in /api/schema/inspect (details redacted).');
    res.json({ columns: [], error: safeErrorMessage(err, 'No se pudo inspeccionar el esquema.') });
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

  const normMotor = normalizeMotor(motor);
  const engine = supportsCloneStream(normMotor) ? getEngine(normMotor) : null;
  if (!engine) {
    return res.status(400).json({ error: `Clonado en streaming no soportado para el motor "${motor}".` });
  }

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

  // Auto-create destination database. Delegated to the engine adapter
  // (server/engines/*.js) — see shared/dbEngines.js for which motors resolve
  // to which adapter.
  engine.ensureDatabase({ host: dstHost, port: dstPort, user: dstUser, pass: dstPass, database: dstDb }).catch((err) => {
    sendEvent('log', { message: `Aviso al verificar/crear base destino: ${safeErrorMessage(err, 'no se pudo verificar/crear automáticamente')}` });
  }).finally(() => {

    sendEvent('log', { message: `Base de datos destino verificada: ${dstDb}` });

    const srcProc = engine.spawnDump({ host: srcHost, port: srcPort, user: srcUser, pass: srcPass, database: srcDb, excludeTables });
    const dstProc = engine.spawnRestore({ host: dstHost, port: dstPort, user: dstUser, pass: dstPass, database: dstDb });

    // Sanitizer stream: strip DEFINER, USE, SQL_LOG_BIN, GTID_PURGED, etc.
    // Fast-path: only parse string and run regex when DDL keywords or maskData are active.
    // Only meaningful (and safe) for engines whose dump is plain SQL text —
    // running this over a binary archive (e.g. MongoDB's `--archive`) would
    // corrupt it, so non-textual engines skip straight through unchanged.
    const sanitizer = new Transform({
      transform(chunk, encoding, callback) {
        if (!engine.textualDumpFormat) {
          return callback(null, chunk);
        }
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

// Catch-all error handler: prevents Express's default handler from ever returning a
// stack trace / internal file paths to the client for any route that throws
// synchronously or forwards an error via next(err).
app.use((err, req, res, _next) => {
  console.error('Unhandled error in companion daemon (details redacted).');
  if (res.headersSent) return;
  res.status(500).json({ error: 'Error interno del companion daemon.' });
});

// Only bind a real port when this file is run directly (`node server/index.js`
// / `npm run server`). Tests import `app` as a module and drive it via
// supertest instead, without opening a real socket.
if (import.meta.url === `file://${process.argv[1]}`) {
  const server = app.listen(PORT, '127.0.0.1', () => {
    console.log(`🦅 DB Manager Companion Daemon running on http://127.0.0.1:${PORT}`);
  });
  server.timeout = 0;
  server.keepAliveTimeout = 0;
  server.requestTimeout = 0;
  server.headersTimeout = 0;
}

export default app;

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

async function getBeekeeperSavedConnections() {
  try {
    const dbPath = path.join(HOME, '.config', 'beekeeper-studio', 'app.db');
    if (!fs.existsSync(dbPath)) return [];

    const { stdout } = await execAsync(
      `sqlite3 "${dbPath}" "SELECT id, name, connectionType, host, port, username, defaultDatabase FROM saved_connection;"`
    );
    if (!stdout.trim()) return [];

    const lines = stdout.trim().split('\n').filter(Boolean);
    const conns = [];

    for (const line of lines) {
      const [id, name, connectionType, host, port, username, defaultDatabase] = line.split('|');
      let motor = 'mysql';
      if ((connectionType || '').toLowerCase().includes('postgre')) motor = 'pg';

      const finalHost = host || '127.0.0.1';
      const finalPort = parseInt(port) || (motor === 'pg' ? 5432 : 3306);
      const finalUser = username || (motor === 'pg' ? 'postgres' : 'root');
      const resolvedPass = resolvePassword(finalHost, finalPort, finalUser, '', name);

      conns.push({
        id: `bks-${id}`,
        name: name || 'Conexión Beekeeper',
        motor,
        host: finalHost,
        port: finalPort,
        user: finalUser,
        defaultDatabase: defaultDatabase || '',
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
        const [name, motor, host, port, user, pass] = line.split('|');
        const finalPort = parseInt(port) || 3306;
        const alreadyExists = bksConns.some(
          b => b.host === (host || '127.0.0.1') && b.port === finalPort && b.user === (user || 'root')
        );
        if (!alreadyExists) {
          customConns.push({
            id: `custom-${idx + 1}`,
            name: name || 'Unnamed',
            motor: motor || 'mysql',
            host: host || 'localhost',
            port: finalPort,
            user: user || 'root',
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

// 3. Scan Docker containers (docker ps) for running database containers
app.get('/api/docker', async (req, res) => {
  try {
    const { stdout } = await execAsync("docker ps --format '{{json .}}' 2>/dev/null || true");
    if (!stdout.trim()) {
      return res.json({ containers: [] });
    }

    const lines = stdout.trim().split('\n');
    const containers = [];
    const dbKeywords = ['mysql', 'mariadb', 'postgres', 'mongo', 'redis', 'cockroach', 'clickhouse'];

    for (const line of lines) {
      try {
        const item = JSON.parse(line);
        const imageLower = (item.Image || '').toLowerCase();
        const nameLower = (item.Names || '').toLowerCase();
        const isDb = dbKeywords.some(k => imageLower.includes(k) || nameLower.includes(k));

        if (isDb) {
          let motor = 'mysql';
          if (imageLower.includes('postgres')) motor = 'pg';
          else if (imageLower.includes('mongo')) motor = 'mongo';
          else if (imageLower.includes('redis')) motor = 'redis';

          // Extract host port
          let hostPort = null;
          const portMatch = (item.Ports || '').match(/0\.0\.0\.0:(\d+)->/);
          if (portMatch) {
            hostPort = parseInt(portMatch[1]);
          }

          containers.push({
            id: item.ID,
            name: item.Names,
            image: item.Image,
            status: item.Status,
            ports: item.Ports,
            hostPort,
            motor,
            suggestedUser: motor === 'mysql' ? 'root' : motor === 'pg' ? 'postgres' : 'root'
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

// 4. Scan local projects for .env files
app.get('/api/discovery/projects', async (req, res) => {
  const rootDir = req.query.path || path.join(HOME, 'Proyectos');
  const projects = [];

  function scanDir(currentDir, depth = 0) {
    if (depth > 3) return;
    try {
      const entries = fs.readdirSync(currentDir, { withFileTypes: true });
      const hasEnv = entries.some(e => e.isFile() && e.name === '.env');

      if (hasEnv) {
        const envPath = path.join(currentDir, '.env');
        const envContent = fs.readFileSync(envPath, 'utf-8');
        const parsed = parseEnv(envContent);
        if (parsed.DB_HOST || parsed.DATABASE_URL) {
          projects.push({
            name: path.basename(currentDir),
            path: currentDir,
            ...parsed
          });
        }
      }

      for (const entry of entries) {
        if (entry.isDirectory()) {
          const name = entry.name;
          if (name.startsWith('.') || name === 'node_modules' || name === 'vendor' || name === 'dist' || name === 'target' || name === 'build') {
            continue;
          }
          scanDir(path.join(currentDir, name), depth + 1);
        }
      }
    } catch {
      // ignore permission or unreadable folders
    }
  }

  function parseEnv(content) {
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

    let motor = 'mysql';
    const connVal = (dict.DB_CONNECTION || '').toLowerCase();
    if (connVal.includes('pg') || connVal.includes('postgres')) motor = 'pg';
    else if (connVal.includes('mongo')) motor = 'mongo';

    return {
      motor,
      host: dict.DB_HOST || 'localhost',
      port: parseInt(dict.DB_PORT) || (motor === 'pg' ? 5432 : 3306),
      database: dict.DB_DATABASE || dict.DB_NAME || '',
      username: dict.DB_USERNAME || dict.DB_USER || 'root',
      hasPassword: Boolean(dict.DB_PASSWORD)
    };
  }

  scanDir(rootDir);
  res.json({ projects });
});

// 5. Query databases list for a connection
app.post('/api/databases', async (req, res) => {
  let { motor = 'mysql', host, port, user, pass, name } = req.body;
  const rawPass = resolvePassword(host, port, user, pass, name);
  const safePass = rawPass.replace(/'/g, "'\\''");
  try {
    let cmd = '';
    if (motor === 'mysql') {
      cmd = `MYSQL_PWD='${safePass}' mysql -h${host} -P${port} -u${user} -N -s -e 'SHOW DATABASES;' 2>/dev/null`;
    } else if (motor === 'pg') {
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
  const rawPass = resolvePassword(host, port, user, pass, name);
  const safePass = rawPass.replace(/'/g, "'\\''");
  try {
    let cmd = '';
    if (motor === 'mysql') {
      cmd = `MYSQL_PWD='${safePass}' mysql -h${host} -P${port} -u${user} ${database} -N -s -e 'SHOW TABLES;' 2>/dev/null`;
    } else if (motor === 'pg') {
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
  const rawPass = resolvePassword(host, port, user, pass, name);
  const safePass = rawPass.replace(/'/g, "'\\''");
  try {
    let cmd = '';
    if (motor === 'mysql') {
      cmd = `MYSQL_PWD='${safePass}' mysql -h${host} -P${port} -u${user} -N -s -e "SELECT ROUND(SUM(data_length + index_length) / (1024 * 1024), 2) AS mb, COUNT(*) AS tables FROM information_schema.TABLES WHERE table_schema='${database}';" 2>/dev/null`;
    } else if (motor === 'pg') {
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

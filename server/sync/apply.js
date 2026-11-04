import { saveManifest } from './manifest.js';
import { cleanStderr, createProgressTracker, createSanitizer } from './streams.js';

const DEFAULT_CONCURRENCY = 3;

function newManifest(plan, previous) {
  const canReuse = Boolean(
    previous &&
    previous.source &&
    previous.source.serverUuid === plan.source.serverUuid &&
    previous.source.version === plan.source.version
  );
  if (canReuse) {
    return {
      ...previous,
      source: plan.source,
      dest: plan.dest,
      tables: { ...(previous.tables || {}) }
    };
  }
  return {
    version: 1,
    source: plan.source,
    dest: plan.dest,
    tables: {},
    createdAt: new Date().toISOString()
  };
}

/**
 * Apply an incremental plan. Tables are copied in parallel (one independent
 * dump|restore pipe per table); a failed table is reported and left out of the
 * manifest so the next run retries it, while the rest of the clone completes.
 */
export async function applySyncPlan({
  engine,
  src,
  dst,
  plan,
  manifest,
  key,
  sendEvent,
  maskData = false,
  concurrency = DEFAULT_CONCURRENCY,
  verify = false,
  signal
}) {
  if (plan.mode === 'cdc') {
    return applyCdcPlan({ engine, src, dst, plan, manifest, key, sendEvent, signal });
  }

  const nextManifest = newManifest(plan, manifest);
  // Invalidate any CDC resume point as soon as a table-level sync starts:
  // partial per-table saves below must not leave a stale binlog position.
  delete nextManifest.cdc;

  // The destination database may not exist yet (the planner treats a missing
  // destination as empty). Create it without ever dropping it: incremental
  // mode must preserve local data that is not being replaced.
  if (typeof engine.ensureDatabase === 'function') {
    sendEvent('log', { message: `Verificando base de datos destino: ${dst.database}` });
    await engine.ensureDatabase({ ...dst, cleanDest: false });
  }

  const queue = plan.tables.filter((table) => table.action === 'full' || table.action === 'append' || table.action === 'drop');
  const totalBytes = plan.summary?.bytesToCopy || 0;

  let completedBytes = 0;
  let lastProgressAt = 0;
  // Keyed by table so a successful retry replaces the earlier failure instead
  // of being counted twice in the final summary.
  const resultByTable = new Map();
  const record = (result) => {
    resultByTable.set(result.table, result);
  };

  const reportProgress = (bytes) => {
    completedBytes += bytes;
    const now = Date.now();
    if (now - lastProgressAt < 400) return;
    lastProgressAt = now;
    sendEvent('progress', {
      bytes: completedBytes,
      totalBytes,
      mb: (completedBytes / (1024 * 1024)).toFixed(2),
      totalMb: (totalBytes / (1024 * 1024)).toFixed(2),
      percent: totalBytes > 0 ? Math.min(99, Math.round((completedBytes / totalBytes) * 100)) : 0
    });
  };

  const runOne = async (table) => {
    if (signal?.aborted) throw new Error('Cancelado por el usuario.');

    if (table.action === 'drop') {
      sendEvent('table-start', { table: table.name, action: 'drop' });
      await engine.dropTable({ ...dst }, table.name, { view: table.type === 'view' });
      delete nextManifest.tables[table.name];
      saveManifest(key, nextManifest);
      sendEvent('table-done', { table: table.name, action: 'drop', ok: true });
      record({ table: table.name, action: 'drop', ok: true });
      return;
    }

    sendEvent('table-start', {
      table: table.name,
      action: table.action,
      bytes: table.bytes,
      reason: table.reason
    });

    const dump = engine.spawnTableDump({ ...src }, {
      table: table.name,
      dataOnly: table.action === 'append',
      keyColumn: table.appendFrom?.column || null,
      keyAfter: table.appendFrom?.value ?? null,
      view: table.type === 'view'
    });
    const restore = engine.spawnTableRestore({ ...dst }, {
      table: table.name,
      dataOnly: table.action === 'append',
      strict: true
    });

    // CSV/archive append formats must bypass the SQL sanitizer; only SQL
    // append dumps (MySQL) are safe to pass through it.
    const sanitize = engine.textualDumpFormat !== false &&
      !(table.action === 'append' && engine.appendFormat === 'csv');
    await pipeProcesses(dump, restore, {
      textualDumpFormat: sanitize,
      maskData: sanitize ? maskData : false,
      onBytes: reportProgress,
      signal
    });

    if (verify && engine.verifyRowCounts !== false && table.type !== 'view') {
      // For append-only tables the destination may legitimately contain local
      // writes the source never had, so row-count parity is only a hard
      // requirement for full copies.
      if (table.action === 'full') {
        const sourceRows = await engine.getTableRowCount({ ...src }, table.name);
        const destinationRows = await engine.getTableRowCount({ ...dst }, table.name);
        if (Number(sourceRows) !== Number(destinationRows)) {
          throw new Error(
            `Verificación fallida en '${table.name}': origen ${sourceRows} filas, destino ${destinationRows}.`
          );
        }
      }
    }

    nextManifest.tables[table.name] = {
      schemaHash: table.schemaHash,
      checksum: table.action === 'append' ? null : (table.checksum ?? null),
      rows: table.rows,
      maxKey: table.maxKey ?? null,
      keyColumn: table.primaryKey || null,
      mode: table.nextMode || 'full',
      syncedAt: new Date().toISOString()
    };
    saveManifest(key, nextManifest);

    sendEvent('table-done', {
      table: table.name,
      action: table.action,
      ok: true,
      rows: table.rows
    });
    record({ table: table.name, action: table.action, ok: true });
  };

  const worker = async () => {
    while (queue.length > 0) {
      if (signal?.aborted) return;
      const table = queue.shift();
      try {
        await runOne(table);
      } catch (err) {
        const message = err?.message || 'Error desconocido';
        sendEvent('table-error', { table: table.name, message });
        record({ table: table.name, action: table.action, ok: false, error: message });
      }
    }
  };

  const workers = Array.from(
    { length: Math.max(1, Math.min(concurrency, queue.length || 1)) },
    () => worker()
  );
  await Promise.all(workers);

  // Retry failed tables once, sequentially. The most common failure is a
  // foreign-key race: a child table is recreated while its parent is being
  // dropped/recreated by another worker. By the time the first pass ends the
  // parent exists again, so a single retry resolves it.
  // Only full/drop copies are idempotent (they DROP+CREATE); an append that
  // failed midway may already have inserted some rows, so retrying it could
  // duplicate data. Those are left for the next sync's COUNT/MAX check.
  const failedFirstPass = [...resultByTable.values()].filter(
    (result) => !result.ok && (result.action === 'full' || result.action === 'drop')
  );
  if (failedFirstPass.length > 0 && !signal?.aborted) {
    sendEvent('log', { message: `Reintentando ${failedFirstPass.length} tabla(s) con error...` });
    for (const failed of failedFirstPass) {
      const table = plan.tables.find((item) => item.name === failed.table);
      if (!table) continue;
      try {
        await runOne(table);
      } catch (err) {
        const message = err?.message || 'Error desconocido';
        sendEvent('table-error', { table: table.name, message });
        record({ table: table.name, action: table.action, ok: false, error: message });
      }
    }
  }

  const results = [...resultByTable.values()];
  const failures = results.filter((result) => !result.ok);
  nextManifest.status = failures.length > 0 ? 'partial' : 'ok';
  nextManifest.lastSyncAt = new Date().toISOString();
  // A table-level sync changes the destination outside the binlog stream, so
  // any previously stored CDC position is no longer a valid resume point.
  delete nextManifest.cdc;
  if (plan.tables.some((table) => table.action === 'full')) {
    nextManifest.lastFullAt = nextManifest.lastSyncAt;
  }
  saveManifest(key, nextManifest);

  const copied = results.filter((result) => result.ok && result.action !== 'drop').length;
  const dropped = results.filter((result) => result.ok && result.action === 'drop').length;
  sendEvent('complete', {
    message: failures.length > 0
      ? `Sync parcial: ${copied} tablas copiadas, ${dropped} eliminadas, ${failures.length} con error.`
      : `Sync completado: ${copied} tablas copiadas, ${dropped} eliminadas, ${plan.summary?.unchanged || 0} sin cambios.`,
    bytes: completedBytes,
    tables: results
  });

  return { manifest: nextManifest, results };
}

function userError(message) {
  const err = new Error(message);
  err.userMessage = message;
  return err;
}

async function applyCdcPlan({ engine, src, dst, plan, manifest, key, sendEvent, signal }) {
  if (!plan.cdc?.available) {
    throw userError(plan.cdc?.reason || 'CDC no disponible para este origen.');
  }
  if (!plan.cdc.from || !plan.cdc.to) {
    throw userError('Falta la posición de CDC. Ejecuta primero un clon completo.');
  }
  if (typeof engine.spawnCdcReplay !== 'function') {
    throw userError('Este motor no implementa replay de CDC.');
  }

  let bytes = 0;
  const replay = engine.spawnCdcReplay({ ...src }, {
    from: plan.cdc.from,
    to: plan.cdc.to,
    binlogs: plan.cdc.binlogs || []
  });
  const restore = engine.spawnTableRestore({ ...dst }, { strict: true });

  await pipeProcesses(replay, restore, {
    textualDumpFormat: engine.textualDumpFormat !== false,
    maskData: false,
    onBytes: (chunkBytes) => {
      bytes += chunkBytes;
      sendEvent('progress', {
        bytes,
        totalBytes: 0,
        mb: (bytes / (1024 * 1024)).toFixed(2),
        totalMb: '0',
        percent: 0
      });
    },
    signal
  });

  const nextManifest = {
    ...(manifest || {}),
    version: 1,
    source: plan.source,
    dest: plan.dest,
    tables: manifest?.tables || {},
    cdc: { position: plan.cdc.to, updatedAt: new Date().toISOString() },
    status: 'ok',
    lastSyncAt: new Date().toISOString()
  };
  saveManifest(key, nextManifest);

  sendEvent('complete', {
    message: `CDC aplicado: ${(bytes / (1024 * 1024)).toFixed(2)} MB desde ${plan.cdc.from?.file || '?'}:${plan.cdc.from?.position || '?'}.`,
    bytes
  });
  return { manifest: nextManifest, results: [] };
}

function pipeProcesses(dump, restore, { textualDumpFormat, maskData, onBytes, signal }) {
  return new Promise((resolve, reject) => {
    let stderr = '';
    let realError = false;
    let settled = false;

    const cleanup = () => {
      try { dump.kill('SIGTERM'); } catch {}
      try { restore.kill('SIGTERM'); } catch {}
    };
    const fail = (err) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(err);
    };
    const done = () => {
      if (settled) return;
      settled = true;
      resolve();
    };

    const onStderr = (data) => {
      const message = data.toString();
      if (/\bERROR\b/.test(message)) realError = true;
      stderr += message;
    };

    dump.stderr?.on('data', onStderr);
    restore.stderr?.on('data', onStderr);
    dump.stdout?.on('error', () => {});
    restore.stdin?.on('error', () => {});

    if (!dump.stdout || !restore.stdin) {
      fail(new Error('No se pudo abrir el pipe de datos del motor.'));
      return;
    }

    const sanitizer = createSanitizer({ textualDumpFormat, maskData });
    sanitizer.on('error', () => {});
    const tracker = createProgressTracker(onBytes);
    tracker.on('error', () => {});

    dump.stdout.pipe(sanitizer).pipe(tracker).pipe(restore.stdin);

    // Wait for BOTH processes: a failing dump/replay can make the restore exit
    // 0 with empty input (e.g. mysqlbinlog refusing a foreign binlog), which
    // would otherwise be reported as a successful 0-byte sync.
    let dumpCode = null;
    let restoreCode = null;
    const maybeFinish = () => {
      if (dumpCode === null || restoreCode === null) return;
      if (restoreCode === 0 && dumpCode === 0 && !realError) {
        done();
      } else {
        fail(new Error(
          cleanStderr(stderr) ||
          `El proceso terminó con códigos dump=${dumpCode}, restore=${restoreCode}.`
        ));
      }
    };

    dump.on('close', (code) => {
      dumpCode = code;
      maybeFinish();
    });
    restore.on('close', (code) => {
      restoreCode = code;
      maybeFinish();
    });
    restore.on('error', fail);
    dump.on('error', fail);

    if (signal) {
      if (signal.aborted) fail(new Error('Cancelado por el usuario.'));
      else signal.addEventListener('abort', () => fail(new Error('Cancelado por el usuario.')), { once: true });
    }
  });
}

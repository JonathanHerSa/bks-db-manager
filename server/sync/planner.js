/**
 * Engine-agnostic incremental clone planner.
 *
 * The planner never touches the destination. It only reads metadata,
 * fingerprints and key ranges from the source and compares them with the
 * manifest left by the previous successful run. The result is a plan the UI
 * can show before anything is copied ("dry run") and the applier can execute.
 *
 * Engine adapters own the engine-specific parts (how to fingerprint a table,
 * how to quote identifiers, how to dump a single table); this module owns the
 * decision logic so every engine gets the same behaviour.
 */

const NUMERIC_KEY_TYPES = new Set([
  'tinyint', 'smallint', 'mediumint', 'int', 'integer', 'bigint',
  'decimal', 'numeric', 'serial', 'bigserial', 'smallserial',
  'int2', 'int4', 'int8', 'float4', 'float8', 'real', 'double', 'double precision'
]);

export function isNumericKeyType(type) {
  if (!type) return false;
  const value = String(type).toLowerCase().trim();
  // ObjectId is not numeric, but its 24-hex representation is monotonically
  // increasing, so the same `_id > lastMax` range trick works for MongoDB.
  if (value === 'objectid') return true;
  if (NUMERIC_KEY_TYPES.has(value)) return true;
  // MySQL reports e.g. "int(11) unsigned", Postgres "bigint".
  return /^(tiny|small|medium|big)?int\b/.test(value) || /^(big)?serial\b/.test(value);
}

export function canAppendByKey(meta) {
  return Boolean(
    meta &&
    meta.type !== 'view' &&
    meta.primaryKey &&
    meta.autoIncrement &&
    isNumericKeyType(meta.primaryKeyType)
  );
}

function emptySummary() {
  return {
    totalTables: 0,
    unchanged: 0,
    toCopy: 0,
    newTables: 0,
    schemaChanged: 0,
    orphan: 0,
    dropped: 0,
    appendOnly: 0,
    bytesToCopy: 0,
    bytesSkipped: 0
  };
}

function numberOrZero(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Compare two primary-key values without losing precision on bigint IDs.
 * Returns 1/0/-1, or null when either side is missing (which forces a full
 * copy instead of guessing a key range).
 */
export function compareKeys(a, b) {
  if (a === null || a === undefined || b === null || b === undefined) return null;
  const left = String(a);
  const right = String(b);
  if (/^-?\d+$/.test(left) && /^-?\d+$/.test(right)) {
    const l = BigInt(left);
    const r = BigInt(right);
    if (l === r) return 0;
    return l > r ? 1 : -1;
  }
  if (left === right) return 0;
  return left > right ? 1 : -1;
}

/**
 * @param {object} params
 * @param {object} params.engine          Engine adapter (server/engines/*.js)
 * @param {object} params.src             Source connection + database
 * @param {object} params.dst             Destination connection + database
 * @param {string[]} [params.excludeTables]
 * @param {object|null} [params.manifest] Previous manifest (or null)
 * @param {boolean} [params.forceFull]
 * @param {boolean} [params.mirror]       Drop destination tables missing in source
 * @param {string[]} [params.appendOnlyTables] Tables the user marked append-only
 * @param {string[]} [params.forceFullTables] Tables the user explicitly unmarked
 * @param {boolean} [params.forceChecksums] Exact but slow verification mode
 * @param {'incremental'|'cdc'} [params.mode]
 */
export async function buildSyncPlan({
  engine,
  src,
  dst,
  excludeTables = [],
  manifest = null,
  forceFull = false,
  mirror = false,
  appendOnlyTables = [],
  forceFullTables = [],
  forceChecksums = false,
  mode = 'incremental'
}) {
  const caps = typeof engine.syncCapabilities === 'function' ? engine.syncCapabilities() : {};
  const identity = await engine.getServerIdentity(src);

  // A recreated/replaced source server invalidates every stored checksum. This
  // is the same safety net as a version upgrade: fall back to a full copy
  // rather than trusting fingerprints that may mean something else now.
  const manifestMatchesSource = Boolean(
    manifest &&
    manifest.source &&
    manifest.source.serverUuid === identity.serverUuid &&
    manifest.source.version === identity.version
  );
  const previous = manifestMatchesSource ? manifest : null;

  if (mode === 'cdc') {
    return buildCdcPlan({ engine, src, dst, previous, identity });
  }

  const excluded = new Set(Array.isArray(excludeTables) ? excludeTables : []);
  const sourceTables = await engine.listTablesWithMeta(src);
  const destinationTables = await safeListTables(engine, dst);
  const destinationNames = new Set(destinationTables.map((table) => table.name));

  // Append-only is sticky: a table the manifest already recorded in append
  // mode stays append unless the user explicitly unchecks it. This avoids
  // re-marking the big table on every session.
  const previousAppend = Object.entries(previous?.tables || {})
    .filter(([, entry]) => entry.mode === 'append')
    .map(([name]) => name);
  const appendSet = new Set([
    ...previousAppend,
    ...(Array.isArray(appendOnlyTables) ? appendOnlyTables : [])
  ]);
  for (const name of (Array.isArray(forceFullTables) ? forceFullTables : [])) {
    appendSet.delete(name);
  }

  const sourceNames = sourceTables.map((table) => table.name);
  const schemaHashes = await engine.getTableSchemaHashes(src, sourceNames);

  // Decide which tables need a fingerprint. Append-only candidates that were
  // already in append mode use COUNT/MAX instead (much cheaper on huge tables);
  // everything else is fingerprinted so unchanged tables can be skipped.
  const fingerprintTables = [];
  const appendCandidates = [];
  for (const meta of sourceTables) {
    if (excluded.has(meta.name) || meta.type === 'view') continue;
    const isAppendCandidate = appendSet.has(meta.name) && canAppendByKey(meta);
    if (isAppendCandidate) {
      // Append candidates are never checksummed: that is the whole point of
      // the fast path. Their COUNT/MAX state is fetched in one batch below.
      appendCandidates.push(meta);
    } else {
      fingerprintTables.push(meta.name);
    }
  }

  const fingerprint = (tables) => (
    forceChecksums && typeof engine.getTableChecksums === 'function'
      ? engine.getTableChecksums(src, tables)
      : engine.getTableFingerprints(src, tables)
  );

  const fingerprints = fingerprintTables.length
    ? await fingerprint(fingerprintTables)
    : {};
  const appendStates = appendCandidates.length
    ? await engine.getTableAppendStates(src, appendCandidates.map((meta) => ({
        table: meta.name,
        column: meta.primaryKey
      })))
    : {};

  const tables = [];
  const summary = emptySummary();
  const sourceNameSet = new Set(sourceNames);

  for (const meta of sourceTables) {
    if (excluded.has(meta.name)) continue;
    summary.totalTables += 1;

    const prev = previous?.tables?.[meta.name];
    const schemaHash = schemaHashes[meta.name] || null;
    const base = {
      name: meta.name,
      type: meta.type || 'table',
      bytes: numberOrZero(meta.bytes),
      rows: numberOrZero(meta.rows),
      primaryKey: meta.primaryKey || null,
      primaryKeyType: meta.primaryKeyType || null,
      autoIncrement: Boolean(meta.autoIncrement),
      appendOnly: appendSet.has(meta.name) && canAppendByKey(meta),
      schemaHash
    };

    // Views are cheap to recreate and cannot be checksummed; compare their
    // definition hash only.
    if (meta.type === 'view') {
      if (!prev || prev.schemaHash !== schemaHash || !destinationNames.has(meta.name)) {
        tables.push({ ...base, action: 'full', reason: 'view', checksum: null });
        summary.toCopy += 1;
        summary.bytesToCopy += base.bytes;
      } else {
        tables.push({ ...base, action: 'skip', reason: 'unchanged', checksum: prev.checksum ?? null });
        summary.unchanged += 1;
        summary.bytesSkipped += base.bytes;
      }
      continue;
    }

    if (!prev || !destinationNames.has(meta.name)) {
      const reason = !prev ? 'new' : 'missing-in-destination';
      const fp = fingerprints[meta.name];
      const appendState = appendStates[meta.name];
      tables.push({
        ...base,
        action: 'full',
        reason,
        checksum: appendState ? null : (fp?.token ?? null),
        rows: appendState?.rows ?? fp?.rows ?? base.rows,
        maxKey: appendState?.maxKey ?? null
      });
      summary.toCopy += 1;
      summary.newTables += 1;
      summary.bytesToCopy += base.bytes;
      continue;
    }

    if (prev.schemaHash !== schemaHash) {
      const fp = fingerprints[meta.name];
      const appendState = appendStates[meta.name];
      tables.push({
        ...base,
        action: 'full',
        reason: 'schema-changed',
        checksum: appendState ? null : (fp?.token ?? null),
        rows: appendState?.rows ?? fp?.rows ?? base.rows,
        maxKey: appendState?.maxKey ?? null
      });
      summary.toCopy += 1;
      summary.schemaChanged += 1;
      summary.bytesToCopy += base.bytes;
      continue;
    }

    if (forceFull) {
      const fp = fingerprints[meta.name];
      const appendState = appendStates[meta.name];
      tables.push({
        ...base,
        action: 'full',
        reason: 'forced',
        checksum: appendState ? null : (fp?.token ?? null),
        rows: appendState?.rows ?? fp?.rows ?? base.rows,
        maxKey: appendState?.maxKey ?? null
      });
      summary.toCopy += 1;
      summary.bytesToCopy += base.bytes;
      continue;
    }

    const isAppendCandidate = appendSet.has(meta.name) && canAppendByKey(meta);

    // The user just marked a table as append-only (or it fell back to full
    // after an append-gap). Compare its checksum once, then switch the
    // manifest to append mode so the next run can use COUNT/MAX.
    if (isAppendCandidate && prev.mode !== 'append') {
      const fp = (await fingerprint([meta.name]))[meta.name];
      const state = appendStates[meta.name] || { rows: base.rows, maxKey: null };
      const rowsMatch = fp?.rows == null || prev.rows == null ||
        numberOrZero(prev.rows) === numberOrZero(fp.rows);
      if (fp && fp.token !== null && fp.token !== undefined && prev.checksum === fp.token && rowsMatch) {
        tables.push({
          ...base,
          action: 'skip',
          reason: 'unchanged',
          checksum: fp.token,
          rows: state.rows,
          maxKey: state.maxKey,
          nextModeOverride: 'append'
        });
        summary.unchanged += 1;
        summary.bytesSkipped += base.bytes;
      } else {
        tables.push({
          ...base,
          action: 'full',
          reason: prev.checksum ? 'changed' : 'append-bootstrap',
          checksum: fp?.token ?? null,
          rows: state.rows,
          maxKey: state.maxKey,
          nextModeOverride: 'append'
        });
        summary.toCopy += 1;
        summary.bytesToCopy += base.bytes;
      }
      continue;
    }

    // Append-only fast path: the user explicitly marked this table as
    // INSERT-only and it has a numeric auto-increment primary key. Only rows
    // with key > lastMax are copied. If the row count did not grow by exactly
    // the number of new keys, assume deletes/updates happened and fall back to
    // a full copy (correctness over speed).
    if (isAppendCandidate && prev.mode === 'append') {
      const state = appendStates[meta.name] || { rows: base.rows, maxKey: prev.maxKey };
      const prevRows = numberOrZero(prev.rows);
      const prevMax = prev.maxKey;
      const maxCmp = compareKeys(state.maxKey, prevMax);

      // An append table that was empty and is still empty has no key range to
      // compare; skip it instead of falling through to a full copy.
      if (prevMax == null && state.maxKey == null && numberOrZero(state.rows) === prevRows) {
        tables.push({ ...base, action: 'skip', reason: 'unchanged', checksum: null, maxKey: null });
        summary.unchanged += 1;
        summary.bytesSkipped += base.bytes;
        continue;
      }

      if (maxCmp === 0 && numberOrZero(state.rows) === prevRows) {
        tables.push({ ...base, action: 'skip', reason: 'unchanged', checksum: null, maxKey: state.maxKey });
        summary.unchanged += 1;
        summary.bytesSkipped += base.bytes;
        continue;
      }

      if (maxCmp === 1 && numberOrZero(state.rows) >= prevRows) {
        const newRows = await engine.countRowsAfterKey(src, meta.name, meta.primaryKey, prevMax);
        if (numberOrZero(state.rows) - prevRows === newRows) {
          const estimatedBytes = base.rows > 0
            ? Math.round(base.bytes * (newRows / base.rows))
            : base.bytes;
          tables.push({
            ...base,
            action: 'append',
            reason: 'append-only',
            checksum: null,
            rows: numberOrZero(state.rows),
            maxKey: state.maxKey,
            appendFrom: { column: meta.primaryKey, value: prevMax },
            appendRows: newRows
          });
          summary.toCopy += 1;
          summary.appendOnly += 1;
          summary.bytesToCopy += estimatedBytes;
          continue;
        }
      }

      // Count/max mismatch: rows were deleted or the key range was rewritten.
      // This table is no longer safe to treat as append-only, so force a
      // checksummed full copy and remember it as "full" until the user
      // re-enables the fast path.
      const fp = (await fingerprint([meta.name]))[meta.name];
      tables.push({
        ...base,
        action: 'full',
        reason: 'append-gap',
        checksum: fp?.token ?? null,
        rows: fp?.rows ?? base.rows,
        maxKey: appendStates[meta.name]?.maxKey ?? null,
        nextModeOverride: 'full'
      });
      summary.toCopy += 1;
      summary.bytesToCopy += base.bytes;
      continue;
    }

    const fp = fingerprints[meta.name];
    if (!fp || fp.token === null || fp.token === undefined) {
      tables.push({
        ...base,
        action: 'full',
        reason: 'no-fingerprint',
        checksum: null,
        rows: fp?.rows ?? base.rows
      });
      summary.toCopy += 1;
      summary.bytesToCopy += base.bytes;
      continue;
    }

    // Some engines only return a checksum token (no exact row count) because
    // counting would mean a second full scan; in that case the token alone is
    // the source of truth.
    const rowsMatch = fp.rows == null || prev.rows == null ||
      numberOrZero(prev.rows) === numberOrZero(fp.rows);
    if (prev.checksum === fp.token && rowsMatch) {
      tables.push({ ...base, action: 'skip', reason: 'unchanged', checksum: fp.token, rows: fp.rows });
      summary.unchanged += 1;
      summary.bytesSkipped += base.bytes;
    } else {
      tables.push({ ...base, action: 'full', reason: 'changed', checksum: fp.token, rows: fp.rows });
      summary.toCopy += 1;
      summary.bytesToCopy += base.bytes;
    }
  }

  // Decide what the manifest should remember after this run. A full copy of a
  // table the user marked append-only becomes an append-mode entry so the next
  // run can use the cheap COUNT/MAX path.
  for (const table of tables) {
    if (table.action === 'full' && table.type !== 'view') {
      table.nextMode = table.nextModeOverride || (table.appendOnly ? 'append' : 'full');
    } else if (table.action === 'append') {
      table.nextMode = 'append';
    } else if (table.action === 'skip') {
      table.nextMode = table.nextModeOverride ||
        (table.maxKey !== undefined
          ? 'append'
          : (table.appendOnly ? 'append' : 'full'));
    }
    delete table.nextModeOverride;
  }

  // Destination tables that no longer exist in the source. In mirror mode they
  // are dropped; otherwise they are reported and left untouched.
  for (const table of destinationTables) {
    if (sourceNameSet.has(table.name) || excluded.has(table.name)) continue;
    if (mirror) {
      tables.push({
        name: table.name,
        type: table.type || 'table',
        bytes: numberOrZero(table.bytes),
        rows: numberOrZero(table.rows),
        primaryKey: table.primaryKey || null,
        primaryKeyType: table.primaryKeyType || null,
        autoIncrement: Boolean(table.autoIncrement),
        appendOnly: false,
        schemaHash: null,
        action: 'drop',
        reason: 'missing-in-source',
        checksum: null
      });
      summary.dropped += 1;
    } else {
      summary.orphan += 1;
    }
  }

  return {
    mode: 'incremental',
    engine: engine.id || null,
    capabilities: caps,
    fingerprintMode: engine.lastFingerprintMode || null,
    source: {
      host: src.host,
      port: src.port,
      db: src.database,
      serverUuid: identity.serverUuid,
      version: identity.version
    },
    dest: {
      host: dst.host,
      port: dst.port,
      db: dst.database
    },
    tables,
    summary
  };
}

async function safeListTables(engine, conn) {
  try {
    return await engine.listTablesWithMeta(conn);
  } catch {
    // Destination database may not exist yet; treat it as empty so every
    // source table is planned as "new".
    return [];
  }
}

async function buildCdcPlan({ engine, src, dst, previous, identity }) {
  const caps = typeof engine.getCdcCapabilities === 'function'
    ? await engine.getCdcCapabilities(src)
    : { available: false, reason: 'Este motor no soporta CDC.' };

  const summary = emptySummary();
  const plan = {
    mode: 'cdc',
    engine: engine.id || null,
    capabilities: typeof engine.syncCapabilities === 'function' ? engine.syncCapabilities() : {},
    source: {
      host: src.host,
      port: src.port,
      db: src.database,
      serverUuid: identity.serverUuid,
      version: identity.version
    },
    dest: { host: dst.host, port: dst.port, db: dst.database },
    tables: [],
    summary,
    cdc: caps
  };

  if (!caps.available) return plan;

  if (String(src.database) !== String(dst.database)) {
    return {
      ...plan,
      cdc: {
        ...caps,
        available: false,
        reason: 'El modo CDC exige el mismo nombre de base de datos en origen y destino.'
      }
    };
  }

  const from = previous?.cdc?.position || null;
  if (!from) {
    return {
      ...plan,
      requiresFull: true,
      reason: 'no-cdc-position',
      cdc: { ...caps, from: null, to: caps.position }
    };
  }

  return {
    ...plan,
    cdc: { ...caps, from, to: caps.position },
    summary: { ...summary, toCopy: 1 }
  };
}

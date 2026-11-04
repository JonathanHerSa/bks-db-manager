# Changelog

## [1.1.1] - 2026-11-04

### Fixed

- Sequential full-table copies by default to avoid MySQL metadata-lock
  deadlocks between related tables; failed copies are retried after a short
  backoff.
- Clear `ERROR 3105` message for generated columns (Pulse/telemetry) and leave
  the table pending instead of failing the whole sync.
- Guard SSE writes after a client disconnect; the daemon no longer risks
  writing to a closed response.
- The frontend now explains that an interrupted incremental sync is resumable
  and only pending tables will be copied.

## [1.1.0] - 2026-11-04

### Added

- **Incremental clone (changes only)** for MySQL/MariaDB/TiDB,
  PostgreSQL/CockroachDB/Redshift and MongoDB.
- Per-table manifest, schema hashes, fingerprints, partial/resumable sync and
  parallel per-table copy.
- **Append-only mode** for INSERT-only tables with numeric auto-increment keys
  (MySQL, PostgreSQL) and ObjectId `_id` (MongoDB): only new rows are copied.
- **Metadata-first configuration UI**: tables, rows, sizes, primary keys,
  append-only and mirror are loaded before the expensive analysis.
- **MySQL fast change detection** via Performance Schema write counters
  (O(number of tables), not O(size)), with an InnoDB metadata fallback when
  Performance Schema is OFF and an explicit **full verification** (checksums)
  mode.
- **CDC mode for MySQL binlog** (opt-in): gated by `ROW`/`FULL`/GTID, same
  database name, no local writes and a compatible `mysqlbinlog`.
- **Plan validation**: config hash, manifest `updatedAt` and source identity;
  stale plans are rejected with HTTP 409 instead of applying the wrong thing.
- Documentation: `docs/INCREMENTAL_SYNC.md` and `docs/INCREMENTAL_SYNC.es.md`.

### Fixed

- PostgreSQL restore compatibility with newer `pg_dump` clients
  (`SET transaction_timeout`).
- Full clone and incremental apply now wait for both dump and restore exit
  codes; a failed dump no longer reports a truncated restore as success.
- Sequential retry for full/drop table copies after foreign-key races.
- 401 token refresh after a companion restart; old daemons are detected through
  the new `/api/status` features flag.
- Removed the misleading `mb * 2.8` SQL size estimate; the UI shows the real
  InnoDB on-disk size.

### Changed

- Incremental sync configuration now lives before the analysis. Changing the
  configuration invalidates the plan; changing mask data does not.
- "Exclude Logs / Pulse / Telemetry" no longer excludes
  `analisis_financiero_jsons` (business data, not a log table).

### Validation

- MySQL 8.0 with Performance Schema ON and OFF: end-to-end (inspect, plan,
  copy, second run with no changes, UPDATE detection, append-only, config and
  manifest guards, full clone).
- PostgreSQL 16: end-to-end (inspect, plan, copy, second run with no changes,
  UPDATE detection via `pg_stat_user_tables`, append-only).
- MongoDB: implemented, pending end-to-end validation with
  `mongosh`/`mongodump` and a real server.
- MySQL CDC: implemented with flavor gating; the actual replay requires MySQL's
  `mysqlbinlog` (MariaDB's cannot read MySQL 8 binlogs).

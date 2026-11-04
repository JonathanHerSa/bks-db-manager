# Incremental clone (changes only)

The incremental clone avoids repeating 100% of a database on every import.
Instead of dumping and restoring every table again, it compares the current
source state with the manifest from the last sync and copies only what changed.

It is designed for large databases (for example, a finance database with tens of
GiB) where the second import must be much faster than the first one.

## How to use it

1. Open `Tools ➔ DB Manager: Stream Clone (A ➔ B)`.
2. Pick the source and destination.
3. Select **Incremental (changes only)**.
4. In the filters panel, the companion first loads **metadata** (tables, rows,
   size and primary key; ~0.2 s, no checksums). Configure:
   - tables to include/exclude,
   - **append-only** for large INSERT-only tables,
   - **exact mirror** if you want to drop destination tables that no longer
     exist in the source.

   Marking append-only does not change the analysis time (MySQL uses write
   counters, not data reads), but it prevents a full table copy when rows are
   added: only new rows are copied.
5. Click **Analyze changes**. Before touching anything you will see:
   - unchanged tables (skipped),
   - new tables,
   - tables with schema changes,
   - orphan tables at the destination,
   - bytes to transfer.
6. Review the plan and click **Start Incremental Sync**.

The first run is always a full copy: it creates the manifest. After that, the
next runs copy only differences.

If you change the configuration after analyzing, the plan is invalidated and you
must analyze again; with append-only already set, that analysis is fast.
Changing **masking** does not invalidate the plan because it only affects the
copy stream. When applying, the companion verifies that the configuration, the
manifest and the source server are still the same; if another sync changed the
manifest or the source was replaced, it asks you to analyze again instead of
applying a stale plan.

## How it works

- **Manifest per source → destination pair.** Stored in the companion data
  directory (`~/.local/share/bks-db-manager/sync` on Linux,
  `~/Library/Application Support/bks-db-manager/sync` on macOS,
  `%LOCALAPPDATA%\bks-db-manager\sync` on Windows). It contains no credentials:
  only the server identity, table names, checksums, counts and keys.
- **Per-table fingerprint.** Each engine implements its own change detection:
  - MySQL/MariaDB/TiDB: write counters from
    `performance_schema.table_io_waits_summary_by_table`
    (`COUNT_INSERT`, `COUNT_UPDATE`, `COUNT_DELETE`) + `AUTO_INCREMENT` and
    `UPDATE_TIME`. It is O(number of tables), not O(size): a 14 GiB database is
    analyzed in the same time as a 14 MB one.
    - If `performance_schema` is **OFF** or the user lacks permission, a fast
      InnoDB metadata mode is used (`mysql.innodb_table_stats.last_update` +
      `AUTO_INCREMENT`/sizes). It detects inserts/deletes but **may miss
      UPDATEs**; the UI warns about it.
    - **Full verification** uses `CHECKSUM TABLE` (exact, but reads the data and
      may take a while).
    - Recommended: enable `performance_schema` on the source (on Cloud SQL it is
      a database flag; requires a restart) for exactness and speed at the same
      time.
  - PostgreSQL/CockroachDB/Redshift: `pg_stat_user_tables` counters
    (`n_tup_ins`, `n_tup_upd`, `n_tup_del`).
  - MongoDB: `collStats` (count, size, index size).
- **Schema.** A per-table hash is computed from columns, indexes, constraints,
  triggers, views and table options. If the hash changes, the table is fully
  copied even when the data is identical.
- **Append-only.** For tables with a numeric auto-increment primary key (or
  MongoDB `_id` ObjectId), the manifest stores `COUNT(*)` and `MAX(key)`. If the
  count grew exactly by the number of new keys, only `key > lastMax` is copied.
  If the count does not match (deletes or rewrites), a full copy is performed
  and the table goes back to `full` until you mark it again. The append-only
  flag is remembered in the manifest, so you do not need to re-mark it every
  session; it is only disabled if you uncheck it explicitly.
- **Source change safety.** If the source `server_uuid`, engine version or schema
  changes, the manifest is invalidated and a full copy is performed.
- **Partial manifest.** If a table fails, it is not marked as synced; the next
  run retries it. The rest continues.

## Engine matrix

| Engine | Per-table incremental | Append-only by key | CDC |
|---|---|---|---|
| MySQL / MariaDB / TiDB | Yes (write counters + metadata) | Yes (`AUTO_INCREMENT`) | Binlog (opt-in) |
| PostgreSQL / CockroachDB / Redshift | Yes (statistics) | Yes (`serial`/`identity`) | Detected, replay not implemented |
| MongoDB | Yes (`collStats`) | Yes (`_id` ObjectId/numeric) | Detected, replay not implemented |
| SQL Server | Requires clone stream (not available) | — | — |
| ClickHouse | Requires clone stream (not available) | — | — |
| Redis | Requires clone stream (not available) | — | — |

## CDC mode (MySQL)

If the MySQL source has `log_bin=ON`, `binlog_format=ROW`,
`binlog_row_image=FULL` and an accessible binlog position, CDC mode replays only
the events since the last sync with `mysqlbinlog`. Requirements:

- Same database name on source and destination.
- The destination must not have local writes (it is a mirror).
- Replication privileges (`REPLICATION SLAVE`/`REPLICATION CLIENT`).
- Binlog retention long enough to cover the gap since the last sync.

If any requirement is missing, the UI shows the reason and you can keep using
the per-table incremental mode.

The first full clone records the binlog position at startup. There is a small
window between that capture and the dump snapshot; if the CDC replay hits a
duplicate from a change in that window, the replay stops without corrupting
anything and you must run a full clone again to reset the position.

## Validation status

- **MySQL 8.0** (Performance Schema ON and OFF): end-to-end validated with
  inspect, plan, copy, second run with no changes, UPDATE detected via counters,
  append-only with a new row, config/manifest guards and full clone.
- **PostgreSQL 16**: end-to-end validated with inspect, plan, copy, second run
  with no changes, UPDATE detected via `pg_stat_user_tables` and append-only
  with a new row.
- **MongoDB**: implemented, pending end-to-end validation with
  `mongosh`/`mongodump` and a real Mongo server.
- **MySQL CDC**: implemented with flavor gating; the actual replay requires
  MySQL's `mysqlbinlog` (MariaDB's cannot read MySQL 8 binlogs).
- **SQL Server / ClickHouse / Redis**: no clone stream; incremental is not
  available and the UI says so.

## Known limitations

- MySQL with `performance_schema=ON` uses write counters and does not read the
  data. With PS OFF it uses InnoDB metadata: fast, but it may miss UPDATEs; the
  UI warns and offers **Full verification**.
- In PostgreSQL, a full per-table copy with foreign keys may require privileges
  to disable triggers; if it fails, use the full clone.
- In MongoDB, `collStats` is a heuristic: an update that does not change the
  size may not be detected. For critical collections, use a full copy.
- SQL Server, ClickHouse and Redis do not have clone stream in this plugin yet;
  incremental mode is disabled for them.

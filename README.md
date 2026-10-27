# 🦅 DB Manager Pro for Beekeeper Studio (`bks-db-manager`)

![Version](https://img.shields.io/badge/version-1.0.7-blue)
![License](https://img.shields.io/badge/license-GPLv3-blue)
![Beekeeper Studio](https://img.shields.io/badge/beekeeper--studio-5.4%2B-38bdf8)

> Plugin and advanced tool suite for **Beekeeper Studio** (v5.4+).
> Built by **[T3zcaDev](https://github.com/JonathanHerSa)**.

**English** · [Español](./README.es.md)

The plugin UI ships in English and Spanish; switch languages from the header.

---

## ✨ Key Features

1. **📸 Smart Snapshots & Backups (1-Click):**
   * On-the-fly compressed backups with **Zstandard (`zstd -3`)** or high-speed **Gzip**.
   * **Hybrid engine:** streams directly through pipes when the daemon is running, or dumps natively from the browser with `CompressionStream` when it is offline.
   * Local snapshot explorer with date, size and engine, plus assisted restore with a confirmation modal and path-traversal protection.

2. **🔄 Live Stream Clone (A ➔ B):**
   * Transfers entire databases between servers (Production/Staging ➔ Local/Docker) in real time through *pipes*, without writing temporary files to disk.
   * **Automatic sanitization:** removes conflicting statements (`DEFINER`, `USE`, `CREATE DATABASE`, `SQL_LOG_BIN`).
   * **Table filtering and data masking:** excludes telemetry tables and masks emails and sensitive data on the fly.

3. **⚖️ Multi-Engine Schema Diff V2 & Migrations:**
   * Multi-engine support for **MySQL / MariaDB** and **PostgreSQL**.
   * Detects missing tables, missing columns, type mismatches, indexes and foreign keys.
   * **Dual exporter:** generates native DDL and **Laravel** migration code (`Blueprint` with `up()` and `down()` methods). Open it directly in Beekeeper Studio's SQL editor or save it as `.sql` / `.php`.

4. **🩺 Health & Performance Auditor:**
   * **Global Health Score (0 - 100)** with a traffic-light indicator and configurable penalties.
   * **Tables without a primary key:** flags tables that degrade row-based replication (RBR) and performance.
   * **Redundant indexes:** finds exact duplicate indexes and redundant prefixes that slow down `INSERT`/`UPDATE` writes.
   * **Storage breakdown:** data vs. index size per table.
   * **Live process monitor:** shows active threads and queries (`SHOW PROCESSLIST` / `pg_stat_activity`) with a button to **safely stop a query** (`KILL QUERY <id>`).

5. **🧪 Smart Mock Data Generator & Cascading Seeding (DAG):**
   * Fills any table with realistic data via Faker.
   * **Populate everything in cascade (graph seeding):** resolves the foreign-key dependency graph for empty tables, seeding parent tables first and injecting their IDs into child tables automatically.
   * **Seed export:** exports to `.sql` (`INSERT INTO`), `.csv` and `.json`.

6. **🐳 Auto-Discovery (Docker & Local Projects):**
   * Detects running containers (`docker ps`) for MySQL, Postgres, MongoDB, Redis, ClickHouse and SQL Server, with host port mapping.
   * Extracts credentials from local `.env` files, ready to save in Beekeeper.

7. **📖 Data Dictionary:**
   * Exports the database's technical documentation as Markdown or static HTML.

---

## 📋 Requirements

* [Beekeeper Studio](https://www.beekeeperstudio.io) **5.4+**
* [Node.js](https://nodejs.org) **18+** and npm — only if you install via Option B (symlink/development). The native companion installer (Option A) does not require Node.js.
* `mysql`/`mysqldump`, `psql`/`pg_dump`, `mongodump`, `docker` (depending on the engine you use) — the companion invokes them but does not bundle them; check `Tools ➔ DB Manager` or `/api/status` to see which ones it detects.
* `sqlite3` CLI (optional, only to read connections already saved in Beekeeper)

## 🔒 Privacy

All processing happens on your machine. The companion daemon only listens on `127.0.0.1:58765` (loopback) and never talks to external servers. Connection credentials never leave your computer.

---

## 🚀 Installation and Auto-start

### Option A: Beekeeper Studio marketplace + native installer (recommended)

1. Install **DB Manager Pro** from the Beekeeper Studio plugin marketplace (`Plugins` ➔ search for "DB Manager Pro").
2. The first time you open a tool that needs the companion (Stream Clone, Auto-Discovery, Schema Diff), you'll see a "Companion Daemon not responding" notice with a **Download Companion** button — download the executable for your OS from [GitHub Releases](https://github.com/JonathanHerSa/bks-db-manager/releases/latest) and open it with a double click.
3. That's it: the executable installs itself, registers to start on login (Linux `systemd --user`, macOS `LaunchAgent`, Windows `Startup`) and starts running. You don't need Node.js installed or a terminal open.

The installer is **not signed** yet (see [docs/COMPANION.md](docs/COMPANION.md)), so Windows/macOS will show a security warning the first time — that document explains exactly which button to press to continue.

#### ⚠️ Read-only mode (Beekeeper Studio 6.2+)

Beekeeper Studio 6.2 installs plugins in read-only mode by default, which blocks writes made through `runQuery`. DB Manager Pro needs it disabled for **Stream Clone**, **Mock Data generation**, **applying Schema Diff migrations** and **cancelling processes** from the Health Auditor; the toggle lives in the plugin's settings (`Plugins` ➔ DB Manager Pro). Snapshots, Data Dictionary, Auto-Discovery and health inspection keep working in read-only mode.

### Option B: Symlink for development/contribution

```bash
git clone https://github.com/JonathanHerSa/bks-db-manager.git
cd bks-db-manager
npm install
npm run build
ln -s "$(pwd)" ~/.config/beekeeper-studio/plugins/t3zca-db-manager
```

`npm install` already leaves the companion daemon running in the background, configured to start automatically and pointing at the cloned repo (not the native binary) — no extra commands or terminal windows needed to use the plugin.

> **Beekeeper Studio 6.2+**: the plugin system added `unlistedDisabled`, enabled by default. For Beekeeper to load the development symlink, add this to `~/.config/beekeeper-studio/user.config.ini`:
>
> ```ini
> [pluginSystem]
> disabled = false
> unlistedDisabled = false
> communityDisabled = false
> ```

#### Manual service management (optional)

You only need this if you installed with `npm install --ignore-scripts`, moved the project folder, or want to disable it:

```bash
# (Re)install the background service manually
npm run daemon:install

# Check that it is running and responding
npm run daemon:status

# Uninstall it at any time
npm run daemon:uninstall
```

*(You can also run it temporarily in a terminal with `npm run server` instead of the persistent service.)*

### Opening it in Beekeeper Studio

1. Open **Beekeeper Studio** and connect to any database.
2. Every tool is available from the top bar under **`Tools`** (the in-app menu labels are currently in Spanish):
   * **`Tools` ➔ `DB Manager: Snapshots & Backups`**
   * **`Tools` ➔ `DB Manager: Clonado Stream (A ➔ B)`** — live stream clone
   * **`Tools` ➔ `DB Manager: Schema Diff & Migraciones`** — schema diff & migrations
   * **`Tools` ➔ `DB Manager: Auditor de Salud & Rendimiento`** — health & performance auditor
   * **`Tools` ➔ `DB Manager: Generador Mock Data`** — mock data generator
   * **`Tools` ➔ `DB Manager: Diccionario de Datos`** — data dictionary
   * **`Tools` ➔ `DB Manager: Auto-Discovery (Docker & .env)`**
   * Or right-click any table ➔ **`DB Manager: Mock Data para esta tabla`**.

### Development mode with Hot Reload (optional)

To edit Vue components and see changes instantly:

```bash
npm run dev
```

---

## 📦 Build and Releases

```bash
npm run build            # plugin frontend -> dist/
npm run companion:build  # native companion binary for your OS -> build/
```

Every `vX.Y.Z` tag push triggers [`.github/workflows/release.yml`](.github/workflows/release.yml), which builds and publishes **a single** GitHub Release with:

- `manifest.json` and `t3zca-db-manager-{version}.zip` (the plugin frontend, following the [Beekeeper Studio Plugins](https://github.com/beekeeper-studio/beekeeper-studio-plugins) publishing process).
- `bks-db-manager-companion-{linux-x64,linux-arm64,darwin-arm64,win-x64}.{tar.gz,zip}` + their `.sha256` (the native companion installer, see [docs/COMPANION.md](docs/COMPANION.md)) — without a version in the name, so they can always be linked from `/releases/latest/download/`. macOS Intel (x64) is still pending due to an open Node.js bug ([nodejs/node#62893](https://github.com/nodejs/node/issues/62893)).

---

## 🤝 Contributing

Issues and pull requests are welcome. Before opening a large PR, please open an issue first to discuss the change.

## 📄 License

This project is licensed under **GPLv3** — see [LICENSE](./LICENSE) for the full text.

## 👤 Author

**T3zcaDev** — [GitHub (@JonathanHerSa)](https://github.com/JonathanHerSa)

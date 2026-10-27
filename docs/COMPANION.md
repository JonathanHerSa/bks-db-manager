# DB Manager Companion — installing the native executable

**English** · [Español](./COMPANION.es.md)

The Beekeeper Studio plugin runs in a sandboxed iframe with no access to the filesystem or OS processes. For everything that needs that access — `mysqldump`/`pg_dump`, scanning Docker containers, reading local `.env` files, comparing schemas between two connections — the plugin talks over HTTP to a small local daemon called **Companion**, which only listens on `127.0.0.1:58765` (it never leaves your machine).

This document is for anyone who installed the plugin from the Beekeeper Studio marketplace and needs the Companion for Stream Clone, Auto-Discovery or Schema Diff. If you cloned the repository for development, you don't need any of this — `npm install` already sets it up for you (see the README, "Option B").

## 1. Download the executable for your system

Go to the [releases page](https://github.com/JonathanHerSa/bks-db-manager/releases/latest) and download the file for your operating system, or use the "Download Companion" button shown inside the plugin when the daemon is not responding (it detects your system automatically):

| System | File |
|---|---|
| Linux (x64) | `bks-db-manager-companion-linux-x64.tar.gz` |
| Linux (ARM64) | `bks-db-manager-companion-linux-arm64.tar.gz` |
| macOS (Apple Silicon) | `bks-db-manager-companion-darwin-arm64.tar.gz` |
| Windows (x64) | `bks-db-manager-companion-win-x64.zip` |

> **macOS Intel (x64) is not available yet.** Binaries built with `node --build-sea` crash (segmentation fault) on every Intel Mac — it is an open Node.js bug ([nodejs/node#62893](https://github.com/nodejs/node/issues/62893)), reproduced in this project across three separate CI runs, so it is not specific to this repository. If you are on an Intel Mac, use Option B from the README (symlink + `npm install`) in the meantime, or check whether that issue has been fixed.

## 2. Verify the checksum (optional but recommended)

Every archive has a `.sha256` file next to it in the same release.

```bash
# Linux/macOS
sha256sum -c bks-db-manager-companion-linux-x64.tar.gz.sha256

# Windows (PowerShell)
Get-FileHash .\bks-db-manager-companion-win-x64.zip -Algorithm SHA256
```

## 3. Extract and run it (double click)

Extract the downloaded archive and run the binary (`bks-db-manager-companion`, or `.exe` on Windows) with a double click. The first time:

- It copies itself to a permanent location outside your Downloads folder, so you can delete the original file afterwards.
- It registers itself to start with your session (you never need to do this again).
- It starts immediately.

You can close the window/console that opens as soon as it confirms it was installed — the daemon keeps running in the background.

### ⚠️ The installer is not signed (yet)

Code signing for Windows and notarization for macOS have a recurring cost (Apple developer account, Windows signing certificate) that this project has not taken on yet. That means the OS will warn you before letting you run the binary the first time — it is the standard warning for any new unsigned program, not a sign that something is wrong (you can verify the checksum from step 2 yourself if you want to be sure).

**Windows (SmartScreen):**
1. You will see "Windows protected your PC". Click **"More info"**.
2. A **"Run anyway"** button appears — click it.

**macOS (Gatekeeper):**
1. macOS will say it cannot open the file because the developer "cannot be verified".
2. **Right-click** (or Control-click) the file ➔ **"Open"** ➔ confirm in the dialog.
3. If it still won't open, run this in a terminal: `xattr -d com.apple.quarantine ./bks-db-manager-companion` and try again.

**Linux:** there is no system warning, but make sure the file is executable if your file manager did not do it automatically: `chmod +x ./bks-db-manager-companion`.

## 4. Confirm it is running

From a terminal (or run the binary again — it detects that it is already installed and just confirms):

```bash
./bks-db-manager-companion --status
```

You should see `Daemon: ACTIVE on http://127.0.0.1:58765`, along with the database tools it detected (`mysqldump`, `pg_dump`, `docker`, etc.) — if one is missing, that is the only reason a specific feature may still not work even though the Companion is running.

## 5. Uninstall

```bash
./bks-db-manager-companion --uninstall
```

It stops the service, unregisters it from auto-start and deletes the installed copy. It does not touch Beekeeper Studio itself or your databases.

## Available commands

```
bks-db-manager-companion            Installs (first run) or verifies the service, then exits.
bks-db-manager-companion --serve    Runs the daemon in the foreground (used internally by the service).
bks-db-manager-companion --install  (Re)installs and starts the background service.
bks-db-manager-companion --uninstall  Stops and removes the service.
bks-db-manager-companion --status   Shows install status, daemon status and detected tools.
bks-db-manager-companion --version  Prints the version.
```

## Where do the files live?

| | Path |
|---|---|
| Installed binary (Linux) | `~/.local/share/bks-db-manager/bin/` |
| Installed binary (macOS) | `~/Library/Application Support/bks-db-manager/bin/` |
| Installed binary (Windows) | `%LOCALAPPDATA%\bks-db-manager\bin\` |
| Logs (macOS) | `~/Library/Logs/bks-db-manager/` |
| Service registration (Linux) | `~/.config/systemd/user/bks-db-manager.service` |
| Service registration (macOS) | `~/Library/LaunchAgents/com.t3zcadev.bks-db-manager.plist` |
| Service registration (Windows) | Windows Start menu "Startup" folder |

## What the installer does NOT install

The Companion does **not** bundle `mysql`/`mysqldump`, `psql`/`pg_dump`, `mongodump`, `docker` or `zstd` — they are tools the companion invokes, but they remain your responsibility to install separately (with your system package manager: `brew`, `apt`, the official MySQL/PostgreSQL installer, Docker Desktop, etc.). Bundling them inside the installer would bring licensing issues and a much larger download, so it is out of scope for this project.

Run `bks-db-manager-companion --status` at any time to see exactly which ones it detects on your system.

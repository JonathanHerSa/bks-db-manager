# 🦅 DB Manager Pro for Beekeeper Studio (`bks-db-manager`)

![Version](https://img.shields.io/badge/version-1.0.0-blue)
![License](https://img.shields.io/badge/license-GPLv3-blue)
![Beekeeper Studio](https://img.shields.io/badge/beekeeper--studio-5.4%2B-38bdf8)

> Plugin y suite de herramientas avanzadas para **Beekeeper Studio** (v5.4+).
> Desarrollado por **[T3zcaDev](https://github.com/JonathanHerSa)**.

---

## ✨ Características Principales

1. **📸 Snapshots & Backups Inteligentes (1-Click):**
   * Respaldos comprimidos al vuelo con **Zstandard (`zstd -3`)** o **Gzip** de alta velocidad.
   * **Motor Híbrido:** Usa volcado directo por pipes si el daemon está activo, o volcado nativo desde el navegador con `CompressionStream` si está offline.
   * Explorador local de snapshots con fecha, tamaño y motor, más restauración asistida con modal de confirmación y protección anti path-traversal.

2. **🔄 Clonado Directo en Vivo (Stream A ➔ B):**
   * Transfiere bases de datos completas entre servidores (Producción/Staging ➔ Local/Docker) en tiempo real mediante *pipes*, sin guardar archivos temporales en disco.
   * **Sanitización automática:** Remueve sentencias conflictivas (`DEFINER`, `USE`, `CREATE DATABASE`, `SQL_LOG_BIN`).
   * **Filtro de tablas y Data Masking:** Excluye tablas de telemetría y ofusca emails y datos sensibles al vuelo.

3. **⚖️ Schema Diff V2 Multi-Motor & Migraciones:**
   * Soporte multi-motor para **MySQL / MariaDB** y **PostgreSQL**.
   * Detección de tablas faltantes, columnas faltantes, discrepancias de tipo, índices y claves foráneas.
   * **Exportador Dual:** Genera script DDL nativo y código de migración de **Laravel** (`Blueprint` con métodos `up()` y `down()`). Botón para abrir directamente en el editor SQL de Beekeeper Studio o guardar como `.sql` / `.php`.

4. **🩺 Auditor de Salud & Rendimiento (Health Auditor):**
   * **Puntaje Global de Salud (0 - 100)** con semáforo y penalizaciones configuradas.
   * **Tablas sin Primary Key:** Alerta de tablas que degradan la replicación por filas (RBR) y rendimiento.
   * **Índices Redundantes:** Detecta índices duplicados exactos y prefijos redundantes que ralentizan escrituras `INSERT`/`UPDATE`.
   * **Desglose de Almacenamiento:** Análisis de tamaño de datos vs índices por tabla.
   * **Monitor de Procesos en Vivo:** Visualiza threads y queries activas (`SHOW PROCESSLIST` / `pg_stat_activity`) con botón para **Detener Consulta de forma segura** (`KILL QUERY <id>`).

5. **🧪 Generador Inteligente de Mock Data & Poblado en Cascada (DAG):**
   * Puebla cualquier tabla con datos realistas mediante Faker.
   * **Poblar Todo en Cascada (Graph Seeding):** Resuelve el grafo de dependencias de claves foráneas hacia tablas vacías, poblando primero las tablas padre e inyectando sus IDs en las tablas hijas automáticamente.
   * **Exportación de Seeds:** Exporta a `.sql` (`INSERT INTO`), `.csv` y `.json`.

6. **🐳 Auto-Discovery (Docker & Proyectos Locales):**
   * Detecta contenedores activos (`docker ps`) de MySQL, Postgres, MongoDB, Redis, ClickHouse y SQL Server con mapeo de puertos en el host.
   * Extrae credenciales de archivos `.env` locales listas para guardar en Beekeeper.

7. **📖 Diccionario de Datos:**
   * Exporta la documentación técnica de la base de datos en Markdown o HTML estático.

---

## 📋 Requisitos Previos

* [Beekeeper Studio](https://www.beekeeperstudio.io) **5.4+**
* [Node.js](https://nodejs.org) **18+** y npm — solo si instalas por la Opción B (symlink/desarrollo). El instalador nativo del companion (Opción A) no requiere Node.js.
* `mysql`/`mysqldump`, `psql`/`pg_dump`, `mongodump`, `docker` (según el motor que uses) — el companion los invoca pero no los empaqueta; revisa `Tools ➔ DB Manager` o `/api/status` para ver cuáles detecta.
* `sqlite3` CLI (opcional, solo para leer conexiones ya guardadas en Beekeeper)

## 🔒 Privacidad

Todo el procesamiento ocurre en tu máquina. El companion daemon solo escucha en `127.0.0.1:58765` (loopback) y nunca se comunica con servidores externos. Las credenciales de conexión nunca salen de tu equipo.

---

## 🚀 Instalación y Autoarranque

### Opción A: Marketplace de Beekeeper Studio + instalador nativo (recomendado)

1. Instala **DB Manager Pro** desde el marketplace de plugins de Beekeeper Studio (`Plugins` ➔ buscar "DB Manager Pro").
2. La primera vez que abras una herramienta que necesite el companion (Clonado Stream, Auto-Discovery, Schema Diff), verás un aviso "Companion Daemon no responde" con un botón **Descargar Companion** — descarga el ejecutable de tu sistema operativo desde [GitHub Releases](https://github.com/JonathanHerSa/bks-db-manager/releases/latest) y ábrelo con doble clic.
3. Eso es todo: el ejecutable se instala a sí mismo, se registra para arrancar solo (Linux `systemd --user`, macOS `LaunchAgent`, Windows `Startup`) y arranca. No necesitas tener Node.js instalado ni abrir una terminal.

El instalador **no viene firmado** todavía (ver [docs/COMPANION.md](docs/COMPANION.md)), así que Windows/macOS mostrarán una advertencia de seguridad la primera vez — ese documento explica exactamente qué botón presionar para continuar.

### Opción B: Symlink para desarrollo/contribución

```bash
git clone https://github.com/JonathanHerSa/bks-db-manager.git
cd bks-db-manager
npm install
npm run build
ln -s "$(pwd)" ~/.config/beekeeper-studio/plugins/bks-db-manager
```

`npm install` ya deja el companion daemon corriendo en segundo plano y configurado para arrancar solo, apuntando al repo clonado (no al binario nativo) — no hace falta ningún comando adicional ni volver a abrir una terminal para usar el plugin.

#### Gestión manual del servicio (opcional)

Solo necesitas esto si instalaste con `npm install --ignore-scripts`, moviste la carpeta del proyecto, o quieres desactivarlo:

```bash
# (Re)instala el servicio en segundo plano manualmente
npm run daemon:install

# Comprueba que esté activo y respondiendo
npm run daemon:status

# Para desinstalarlo en cualquier momento
npm run daemon:uninstall
```

*(También puedes correrlo temporalmente en una terminal con `npm run server` si lo prefieres en vez del servicio persistente).*

### Abrir en Beekeeper Studio

1. Abre **Beekeeper Studio** y conéctate a cualquier base de datos.
2. Cada herramienta está disponible directamente desde la barra superior en **`Tools`**:
   * **`Tools` ➔ `DB Manager: Snapshots & Backups`**
   * **`Tools` ➔ `DB Manager: Clonado Stream (A ➔ B)`**
   * **`Tools` ➔ `DB Manager: Schema Diff & Migraciones`**
   * **`Tools` ➔ `DB Manager: Auditor de Salud & Rendimiento`**
   * **`Tools` ➔ `DB Manager: Generador Mock Data`**
   * **`Tools` ➔ `DB Manager: Diccionario de Datos`**
   * **`Tools` ➔ `DB Manager: Auto-Discovery (Docker & .env)`**
   * O clic derecho sobre cualquier tabla ➔ **`DB Manager: Mock Data para esta tabla`**.

### Modo desarrollo con Hot Reload (opcional)

Para modificar componentes Vue y ver los cambios reflejados al instante:

```bash
npm run dev
```

---

## 📦 Compilación y Releases

```bash
npm run build            # frontend del plugin -> dist/
npm run companion:build  # binario nativo del companion para tu SO -> build/
```

Cada push de un tag `vX.Y.Z` dispara [`.github/workflows/release.yml`](.github/workflows/release.yml), que compila y publica **un solo** GitHub Release con:

- `manifest.json` y `bks-db-manager-{version}.zip` (frontend del plugin, siguiendo el proceso de publicación de [Beekeeper Studio Plugins](https://github.com/beekeeper-studio/beekeeper-studio-plugins)).
- `bks-db-manager-companion-{linux-x64,linux-arm64,darwin-arm64,win-x64}.{tar.gz,zip}` + su `.sha256` (el instalador nativo del companion, ver [docs/COMPANION.md](docs/COMPANION.md)) — sin versión en el nombre, para poder enlazarlos siempre desde `/releases/latest/download/`. macOS Intel (x64) queda pendiente por un bug abierto de Node.js ([nodejs/node#62893](https://github.com/nodejs/node/issues/62893)).

---

## 🤝 Contribuir

Los issues y pull requests son bienvenidos. Antes de abrir un PR grande, abre primero un issue para discutir el cambio.

## 📄 Licencia

Este proyecto está licenciado bajo **GPLv3** — ver [LICENSE](./LICENSE) para el texto completo.

## 👤 Autor

**T3zcaDev** — [GitHub (@JonathanHerSa)](https://github.com/JonathanHerSa)

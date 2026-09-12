# 🦅 DB Manager Pro for Beekeeper Studio (`bks-db-manager`)

![Version](https://img.shields.io/badge/version-1.0.0-blue)
![License](https://img.shields.io/badge/license-GPLv3-blue)
![Beekeeper Studio](https://img.shields.io/badge/beekeeper--studio-5.4%2B-38bdf8)

> Plugin y suite de herramientas avanzadas para **Beekeeper Studio** (v5.4+).
> Desarrollado por **[T3zcaDev](https://github.com/JonathanHerSa)**.

---

## ✨ Características Principales

1. **🔄 Clonado Directo en Vivo (Stream A ➔ B):**
   * Transfiere bases de datos completas entre servidores (Producción/Staging ➔ Local/Docker) en tiempo real mediante *pipes*, sin guardar archivos temporales en disco.
   * **Sanitización automática:** Remueve sentencias conflictivas (`DEFINER`, `USE`, `CREATE DATABASE`, `SQL_LOG_BIN`).
   * **Auto-Creación:** Crea la base de datos destino si no existe (`CREATE DATABASE IF NOT EXISTS`).

2. **🛡️ Filtro de Tablas & Data Masking:**
   * Selector interactivo de tablas con botón de un clic para **excluir tablas pesadas de logs / telemetría** (`pulse_*`, `telescope_*`, `audit_*`, `sessions`).
   * **Data Masking (Ofuscación al vuelo):** Enmascara automáticamente correos electrónicos y datos sensibles durante el streaming.

3. **🐳 Auto-Discovery (Docker & Proyectos Locales):**
   * **Escaneo de Docker:** Detecta contenedores activos (`docker ps`) de MySQL, Postgres, MongoDB o Redis con sus puertos mapeados en el host.
   * **Escaneo de `.env`:** Detecta proyectos locales (Laravel, NestJS, Next.js, etc.) y extrae credenciales de base de datos listas para usar.

4. **⚖️ Comparador Visual de Esquemas & Generador de Migraciones:**
   * Compara dos bases de datos lado a lado (ej. `Local` vs `Producción`).
   * Muestra tablas faltantes, columnas faltantes y diferencias en tipos de datos.
   * **Generador SQL:** Produce el script con los `ALTER TABLE ... ADD COLUMN ...` exactos para sincronizar ambos lados.

5. **🧪 Generador Inteligente de Datos Falsos (Mock Data):**
   * Puebla cualquier tabla con N filas de prueba realistas mediante Faker.
   * Infiere automáticamente generadores para correos, nombres, teléfonos, direcciones, precios, UUIDs, enums y fechas.
   * Inserción directa con transacciones seguras en Beekeeper.

---

## 📋 Requisitos Previos

* [Beekeeper Studio](https://www.beekeeperstudio.io) **5.4+**
* [Node.js](https://nodejs.org) **18+** y npm
* `docker` (opcional, solo para Auto-Discovery de contenedores)
* `sqlite3` CLI (opcional, solo para leer conexiones ya guardadas en Beekeeper)

## 🔒 Privacidad

Todo el procesamiento ocurre en tu máquina. El companion daemon solo escucha en `127.0.0.1:58765` (loopback) y nunca se comunica con servidores externos. Las credenciales de conexión nunca salen de tu equipo.

---

## 🚀 Instalación

### Opción A: Symlink para desarrollo/uso local

```bash
git clone https://github.com/JonathanHerSa/bks-db-manager.git
cd bks-db-manager
npm install
npm run build
ln -s "$(pwd)" ~/.config/beekeeper-studio/plugins/bks-db-manager
```

### Opción B: Plugin Manager de Beekeeper Studio

Una vez publicado en el [registro oficial de plugins](https://github.com/beekeeper-studio/beekeeper-studio-plugins), podrás instalarlo directamente desde **Beekeeper Studio → Plugin Manager** sin pasos manuales.

### 1. Iniciar el Companion Daemon (motor de streaming y Docker)

Necesario para las funciones de streaming de alta velocidad y detección de Docker:

```bash
npm run server
```

*(El companion corre en `http://127.0.0.1:58765`).*

### 2. Abrir en Beekeeper Studio

1. Abre **Beekeeper Studio** y conéctate a cualquier base de datos.
2. Accede a **DB Manager Pro** desde:
   * El menú superior: **`Tools` ➔ `DB Manager Pro`**.
   * El botón `+` de nueva pestaña ➔ **`DB Manager Pro`**.
   * Clic derecho en cualquier tabla ➔ **`DB Manager Pro`**.

### 3. Modo desarrollo con Hot Reload (opcional)

Para modificar componentes Vue y ver los cambios reflejados al instante:

```bash
npm run dev
```

---

## 📦 Compilación y Releases

```bash
npm run build
```

Esto genera la carpeta `dist/` optimizada. Cada release publicado en [GitHub Releases](https://github.com/JonathanHerSa/bks-db-manager/releases) incluye `manifest.json` y `bks-db-manager-{version}.zip` como assets, siguiendo el proceso de publicación de [Beekeeper Studio Plugins](https://github.com/beekeeper-studio/beekeeper-studio-plugins).

---

## 🤝 Contribuir

Los issues y pull requests son bienvenidos. Antes de abrir un PR grande, abre primero un issue para discutir el cambio.

## 📄 Licencia

Este proyecto está licenciado bajo **GPLv3** — ver [LICENSE](./LICENSE) para el texto completo.

## 👤 Autor

**T3zcaDev** — [GitHub (@JonathanHerSa)](https://github.com/JonathanHerSa)

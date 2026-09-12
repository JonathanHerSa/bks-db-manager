# 🦅 DB Manager Pro for Beekeeper Studio (`bks-db-manager`)

> Plugin oficial y suite de herramientas avanzadas para **Beekeeper Studio** (v5.5+ y v6.x).  
> Desarrollado por **[T3zcaDev](https://github.com/JonathanHerSa)**.

---

## ✨ Características Principales

1. **🔄 Clonado Directo en Vivo (Stream A ➔ B):**
   * Transfiere bases de datos completas entre servidores (Producción/Staging ➔ Local/Docker) en tiempo real mediante *pipes*, sin guardar archivos temporales en disco.
   * **Sanitización automática:** Remueve sentencias conflictivas (`DEFINER`, `USE`, `CREATE DATABASE`, `SQL_LOG_BIN`).
   * **Auto-Creación:** Crea la base de datos destino si no existe (`CREATE DATABASE IF NOT EXISTS`).

2. **🛡️ Filtro de Tablas & Data Masking (Punto 1):**
   * Selector interactivo de tablas con botón de un clic para **excluir tablas pesadas de logs / telemetría** (`pulse_*`, `telescope_*`, `audit_*`, `sessions`).
   * **Data Masking (Ofuscación al vuelo):** Enmascara automáticamente correos electrónicos y datos sensibles durante el streaming.

3. **🐳 Auto-Discovery (Docker & Proyectos Locales) (Punto 2):**
   * **Escaneo de Docker:** Detecta contenedores activos (`docker ps`) de MySQL, Postgres, MongoDB o Redis con sus puertos mapeados en el host.
   * **Escaneo de `.env`:** Detecta proyectos en `~/Proyectos` (Laravel, NestJS, Next.js, etc.) y extrae credenciales de base de datos listas para usar.

4. **⚖️ Comparador Visual de Esquemas & Generador de Migraciones (Punto 3):**
   * Compara dos bases de datos lado a lado (ej. `Local` vs `Producción`).
   * Muestra tablas faltantes, columnas faltantes y diferencias en tipos de datos.
   * **Generador SQL:** Produce el script con los `ALTER TABLE ... ADD COLUMN ...` exactos para sincronizar ambos lados.

5. **🧪 Generador Inteligente de Datos Falsos (Mock Data) (Punto 5):**
   * Puebla cualquier tabla con $N$ filas de prueba realistas mediante Faker.
   * Infiere automáticamente generadores para correos, nombres, teléfonos, direcciones, precios, UUIDs, enums y fechas.
   * Inserción directa con transacciones seguras en Beekeeper.

---

## 🚀 Instalación y Prueba Local en Beekeeper Studio

El plugin ya está enlazado a tu carpeta de plugins de Beekeeper:
```bash
ln -s ~/Proyectos/Personal/bks-db-manager ~/.config/beekeeper-studio/plugins/bks-db-manager
```

### 1. Iniciar el Companion Daemon (Motor de Streaming y Docker)
Para habilitar las funciones de streaming de alta velocidad y detección de Docker, inicia el companion:

```bash
cd ~/Proyectos/Personal/bks-db-manager
npm run server
```

*(El companion correrá de forma ligera y segura en `http://127.0.0.1:58765`)*.

### 2. Abrir en Beekeeper Studio
1. Abre **Beekeeper Studio**.
2. Conéctate a cualquier base de datos.
3. Puedes acceder a **DB Manager Pro** desde:
   * El menú superior: **`Tools` ➔ `DB Manager Pro`**.
   * El botón `+` de nueva pestaña ➔ **`DB Manager Pro`**.
   * Clic derecho en cualquier esquema o tabla ➔ **`DB Manager Pro`**.

### 3. Modo Desarrollo con Hot Reload (Opcional)
Si deseas modificar componentes en Vue 3 y ver los cambios reflejados al instante en Beekeeper:
```bash
cd ~/Proyectos/Personal/bks-db-manager
npm run dev
```

---

## 📦 Compilación para Producción / Publicación

Para generar los archivos finales que se empaquetan para el catálogo oficial de Beekeeper:
```bash
npm run build
```

Esto generará la carpeta `dist/` optimizada lista para crear el release `.zip` y someter el Pull Request a [`beekeeper-studio/beekeeper-studio-plugins`](https://github.com/beekeeper-studio/beekeeper-studio-plugins).

---

## 👤 Autor

**T3zcaDev** — [GitHub (@JonathanHerSa)](https://github.com/JonathanHerSa)  
Licencia: **MIT**

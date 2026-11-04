# Clonado incremental (solo cambios)

El clonado incremental evita repetir el 100% de una base de datos en cada
importación. En vez de volver a volcar y restaurar todas las tablas, compara
el estado actual del origen con el manifest de la última sincronización y copia
solo lo que cambió.

Está pensado para bases grandes (por ejemplo, Finanzas con decenas de GiB)
donde la segunda importación debe ser mucho más rápida que la primera.

## Cómo se usa

1. Abre `Tools ➔ DB Manager: Clonado Stream (A ➔ B)`.
2. Elige origen y destino.
3. Selecciona **Incremental (solo cambios)**.
4. En el panel de filtros, el companion carga primero los **metadatos**
   (tablas, filas, tamaño y PK; ~0.2 s, sin checksums). Configura ahí:
   - tablas a incluir/excluir,
   - **append-only** en las tablas grandes que solo reciben `INSERT`,
   - **espejo exacto** si quieres borrar en destino las tablas que ya no
     existen en origen.
   Marcar append-only no cambia el tiempo del análisis (MySQL ya usa
   contadores de escritura, no lee los datos), pero evita que esa tabla se
   copie completa cuando cambien sus filas: solo se copian las nuevas.
5. Pulsa **Analizar cambios**. Verás, antes de tocar nada:
   - tablas sin cambios (se omiten),
   - tablas nuevas,
   - tablas con cambios de esquema,
   - tablas huérfanas en destino,
   - bytes que se van a transferir.
6. Revisa el plan y pulsa **Iniciar Sync Incremental**.

La primera ejecución siempre es una copia completa: es la que crea el manifest.
A partir de ahí, las siguientes solo copian diferencias.

Si cambias la configuración después de analizar, el plan se invalida y hay que
volver a analizar; con append-only ya marcado ese análisis es rápido. Cambiar
el **masking** no invalida el plan porque solo afecta al stream de copia. Al
aplicar, el companion valida que la configuración, el manifest y el servidor
origen sigan siendo los mismos; si otra sincronización cambió el manifest o el
origen se reemplazó, pide volver a analizar en vez de aplicar un plan viejo.

## Cómo funciona

- **Manifest por par origen → destino.** Se guarda en el directorio de datos del
  companion (`~/.local/share/bks-db-manager/sync` en Linux,
  `~/Library/Application Support/bks-db-manager/sync` en macOS,
  `%LOCALAPPDATA%\bks-db-manager\sync` en Windows). No contiene credenciales:
  solo identidad del servidor, nombres de tablas, checksums, conteos y claves.
- **Fingerprint por tabla.** Cada motor implementa su propia forma de detectar
  cambios:
  - MySQL/MariaDB/TiDB: contadores de escritura de
    `performance_schema.table_io_waits_summary_by_table`
    (`COUNT_INSERT`, `COUNT_UPDATE`, `COUNT_DELETE`) + `AUTO_INCREMENT` y
    `UPDATE_TIME`. Es O(número de tablas), no O(tamaño): una base de 14 GiB se
    analiza en el mismo tiempo que una de 14 MB.
    - Si `performance_schema` está **OFF** o el usuario no tiene permiso, se
      usa un modo rápido por metadatos de InnoDB
      (`mysql.innodb_table_stats.last_update` + `AUTO_INCREMENT`/tamaños).
      Detecta inserts/borrados, pero **puede no detectar UPDATEs**; la UI lo
      advierte.
    - La opción **Verificación completa** usa `CHECKSUM TABLE` (exacta, pero
      lee los datos y puede tardar).
    - Recomendado: activar `performance_schema` en el origen (en Cloud SQL es
      un flag de base de datos; requiere reinicio) para tener exactitud y
      velocidad al mismo tiempo.
  - PostgreSQL/CockroachDB/Redshift: contadores de `pg_stat_user_tables`
    (`n_tup_ins`, `n_tup_upd`, `n_tup_del`).
  - MongoDB: `collStats` (conteo, tamaño, tamaño de índices).
- **Esquema.** Se calcula un hash por tabla con columnas, índices, constraints,
  triggers, vistas y opciones de tabla. Si el hash cambia, la tabla se copia
  completa aunque los datos sean idénticos.
- **Append-only.** Para tablas con PK numérica autoincremental (o `_id` ObjectId
  en MongoDB), el manifest guarda `COUNT(*)` y `MAX(clave)`. Si el conteo creció
  exactamente por el número de claves nuevas, solo se copia `clave > últimoMax`.
  Si el conteo no cuadra (borrados o reescrituras), se hace copia completa y la
  tabla vuelve a modo `full` hasta que la marques de nuevo. La marca append-only
  se recuerda en el manifest, así que no hace falta volver a marcarla en cada
  sesión; solo se desactiva si la desmarcas explícitamente.
- **Seguridad ante cambios del origen.** Si cambia el `server_uuid` del origen,
  la versión del motor o el esquema, el manifest se invalida y se hace copia
  completa.
- **Manifest parcial.** Si una tabla falla, no se marca como sincronizada; la
  siguiente pasada la reintenta. Las demás continúan.

## Matriz de motores

| Motor | Incremental por tabla | Append-only por clave | CDC |
|---|---|---|---|
| MySQL / MariaDB / TiDB | Sí (contadores de escritura + metadatos) | Sí (`AUTO_INCREMENT`) | Binlog (opt-in) |
| PostgreSQL / CockroachDB / Redshift | Sí (estadísticas) | Sí (`serial`/`identity`) | Detectado, replay no implementado |
| MongoDB | Sí (`collStats`) | Sí (`_id` ObjectId/numérico) | Detectado, replay no implementado |
| SQL Server | Requiere clone stream (no disponible) | — | — |
| ClickHouse | Requiere clone stream (no disponible) | — | — |
| Redis | Requiere clone stream (no disponible) | — | — |

## Modo CDC (MySQL)

Si el origen MySQL tiene `log_bin=ON`, `binlog_format=ROW`,
`binlog_row_image=FULL` y una posición de binlog accesible, el modo CDC
reproduce solo los eventos desde la última sincronización con `mysqlbinlog`.
Requisitos:

- Mismo nombre de base de datos en origen y destino.
- El destino no debe tener escrituras locales (es un espejo).
- Privilegios de replicación (`REPLICATION SLAVE`/`REPLICATION CLIENT`).
- Retención de binlog suficiente para cubrir el hueco desde la última sync.

Si algo no se cumple, la UI muestra el motivo y se puede seguir usando el modo
incremental por tablas.

El primer clon completo registra la posición de binlog al arrancar. Hay una
ventana mínima entre esa captura y el snapshot del dump; si el replay CDC choca
con un duplicado por un cambio ocurrido en esa ventana, el replay se detiene sin
corromper nada y hay que repetir el clon completo para reiniciar la posición.

## Estado de validación

- **MySQL 8.0** (Performance Schema ON y OFF): validado de punta a punta con
  inspect, plan, copia, segunda pasada sin cambios, UPDATE detectado por
  contadores, append-only con fila nueva, guards de config/manifest y clon
  completo.
- **PostgreSQL 16**: validado de punta a punta con inspect, plan, copia,
  segunda pasada sin cambios, UPDATE detectado por `pg_stat_user_tables` y
  append-only con fila nueva.
- **MongoDB**: implementado, pendiente de validación end-to-end con
  `mongosh`/`mongodump` y un Mongo real.
- **CDC MySQL**: implementado y con gate de flavor; el replay real requiere el
  `mysqlbinlog` de MySQL (el de MariaDB no lee binlogs de MySQL 8).
- **SQL Server / ClickHouse / Redis**: sin clone stream; el incremental no está
  disponible y la UI lo indica.

## Limitaciones conocidas

- MySQL con `performance_schema=ON` usa contadores de escritura y no lee los
  datos. Con PS OFF usa metadatos de InnoDB: es rápido, pero puede no detectar
  UPDATEs; la UI lo advierte y ofrece **Verificación completa**.
- En PostgreSQL, una copia completa por tabla con claves foráneas puede requerir
  privilegios para deshabilitar triggers; si falla, usa el clonado completo.
- En MongoDB, `collStats` es una heurística: una actualización que no cambia el
  tamaño puede no detectarse. Para colecciones críticas, usa copia completa.
- SQL Server, ClickHouse y Redis no tienen clone stream en este plugin todavía;
  el modo incremental aparece deshabilitado para ellos.

<template>
  <div class="space-y-6">
    <!-- Top banner -->
    <div class="p-5 rounded-xl bg-slate-900/50 border border-white/[0.08] shadow-sm">
      <div class="flex items-center gap-2">
        <GitCompare class="w-5 h-5 text-sky-400" />
        <h2 class="text-base font-semibold text-white">Comparador de Esquemas & Migraciones SQL</h2>
      </div>
      <p class="text-xs text-slate-400 mt-1">
        Inspecciona diferencias estructurales entre dos bases de datos (incluso en distintas conexiones como Producción vs Docker) y genera automáticamente el script <code>ALTER TABLE</code> para sincronizarlas.
      </p>
    </div>

    <!-- Inputs Grid -->
    <div class="space-y-3">
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <!-- DB 1 (Reference) -->
        <div class="p-5 rounded-xl bg-slate-900/50 border border-white/[0.08] space-y-3 shadow-sm">
          <div class="flex items-center justify-between pb-2 border-b border-white/[0.06]">
            <div class="flex items-center gap-2">
              <span class="w-2.5 h-2.5 rounded-full bg-emerald-400"></span>
              <h3 class="text-xs font-semibold uppercase tracking-wider text-slate-300">1. Base de Referencia / Origen</h3>
            </div>
            <span v-if="sourceDbs.length > 0" class="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 font-mono">
              {{ sourceDbs.length }} BDs
            </span>
          </div>

          <!-- Conn 1 Select -->
          <div>
            <div class="flex items-center justify-between mb-1.5">
              <label class="block text-xs font-medium text-slate-400">Conexión Origen</label>
              <span v-if="selectedConn1?.isBeekeeper" class="text-[10px] px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 flex items-center gap-1 font-medium">
                <span class="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                Beekeeper
              </span>
            </div>
            <select
              v-model="selectedConn1"
              @change="onConn1Change"
              class="w-full bg-slate-950 border border-white/[0.1] rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:ring-2 focus:ring-sky-500/30 focus:border-sky-500 transition cursor-pointer"
            >
              <option v-for="c in availableConns" :key="'src-c-' + c.id" :value="c">
                {{ formatConnOption(c, availableConns) }}
              </option>
            </select>
          </div>

          <!-- DB 1 Select -->
          <div>
            <label class="block text-xs font-medium text-slate-400 mb-1.5">Base de Datos</label>
            <SearchableSelect
              v-model="sourceDb"
              :options="sourceDbs"
              :allow-custom="false"
              placeholder="Escribe para filtrar o buscar base de referencia..."
            />
          </div>
        </div>

        <!-- DB 2 (Target) -->
        <div class="p-5 rounded-xl bg-slate-900/50 border border-white/[0.08] space-y-3 shadow-sm">
          <div class="flex items-center justify-between pb-2 border-b border-white/[0.06]">
            <div class="flex items-center gap-2">
              <span class="w-2.5 h-2.5 rounded-full bg-rose-400"></span>
              <h3 class="text-xs font-semibold uppercase tracking-wider text-slate-300">2. Base Destino a Actualizar</h3>
            </div>
            <span v-if="targetDbs.length > 0" class="text-[10px] px-1.5 py-0.5 rounded bg-rose-500/10 text-rose-300 font-mono">
              {{ targetDbs.length }} BDs
            </span>
          </div>

          <!-- Conn 2 Select -->
          <div>
            <div class="flex items-center justify-between mb-1.5">
              <label class="block text-xs font-medium text-slate-400">Conexión Destino</label>
              <span v-if="selectedConn2?.isBeekeeper" class="text-[10px] px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 flex items-center gap-1 font-medium">
                <span class="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                Beekeeper
              </span>
            </div>
            <select
              v-model="selectedConn2"
              @change="onConn2Change"
              class="w-full bg-slate-950 border border-white/[0.1] rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:ring-2 focus:ring-sky-500/30 focus:border-sky-500 transition cursor-pointer"
            >
              <option v-for="c in availableConns" :key="'dst-c-' + c.id" :value="c">
                {{ formatConnOption(c, availableConns) }}
              </option>
            </select>
          </div>

          <!-- DB 2 Select -->
          <div>
            <label class="block text-xs font-medium text-slate-400 mb-1.5">Base de Datos</label>
            <SearchableSelect
              v-model="targetDb"
              :options="targetDbs"
              :allow-custom="false"
              placeholder="Escribe para filtrar o buscar base destino..."
            />
          </div>
        </div>
      </div>

      <!-- Settings & Action bar -->
      <div class="flex flex-wrap items-center justify-between gap-3 p-3.5 bg-slate-900/40 rounded-xl border border-white/[0.06]">
        <div class="flex items-center gap-3">
          <label class="text-xs text-slate-400 font-medium">Dialecto SQL Destino:</label>
          <div class="inline-flex rounded-lg bg-slate-950 p-0.5 border border-white/[0.08]">
            <button
              type="button"
              @click="targetDialect = 'mysql'; regenerateScripts()"
              class="px-2.5 py-1 text-xs rounded-md font-medium transition cursor-pointer"
              :class="targetDialect === 'mysql' ? 'bg-sky-600 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'"
            >
              MySQL / MariaDB
            </button>
            <button
              type="button"
              @click="targetDialect = 'postgres'; regenerateScripts()"
              class="px-2.5 py-1 text-xs rounded-md font-medium transition cursor-pointer"
              :class="targetDialect === 'postgres' ? 'bg-sky-600 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'"
            >
              PostgreSQL
            </button>
          </div>
        </div>

        <div class="flex items-center gap-2.5">
          <button
            @click="swapDatabases"
            :disabled="!sourceDb && !targetDb"
            title="Intercambiar bases de datos y conexiones"
            class="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 border border-white/[0.08] rounded-lg text-xs font-medium flex items-center gap-1.5 transition cursor-pointer active:scale-[0.98]"
          >
            <ArrowLeftRight class="w-3.5 h-3.5" />
            <span>Intercambiar</span>
          </button>

          <button
            @click="runSchemaDiff"
            :disabled="isComparing || !sourceDb || !targetDb"
            class="px-5 py-2 bg-sky-600 hover:bg-sky-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-medium rounded-lg text-xs flex items-center gap-2 shadow-sm transition cursor-pointer active:scale-[0.98]"
          >
            <Search class="w-4 h-4" :class="isComparing ? 'animate-spin' : ''" />
            <span>{{ isComparing ? 'Comparando esquemas...' : 'Comparar Esquemas' }}</span>
          </button>
        </div>
      </div>
    </div>

    <!-- Diff Results -->
    <div v-if="hasDiffResults" class="space-y-5">
      <!-- Metric Cards -->
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
        <div class="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-center">
          <div class="text-2xl font-bold text-emerald-400 font-mono">{{ diffSummary.missingTables.length }}</div>
          <div class="text-xs text-slate-300 mt-1 font-medium">Tablas Faltantes en Destino</div>
        </div>
        <div class="p-4 rounded-xl bg-sky-500/10 border border-sky-500/20 text-center">
          <div class="text-2xl font-bold text-sky-400 font-mono">{{ diffSummary.missingColumns.length }}</div>
          <div class="text-xs text-slate-300 mt-1 font-medium">Columnas Faltantes</div>
        </div>
        <div class="p-4 rounded-xl bg-amber-500/10 border border-amber-500/20 text-center">
          <div class="text-2xl font-bold text-amber-400 font-mono">{{ diffSummary.typeChanges.length }}</div>
          <div class="text-xs text-slate-300 mt-1 font-medium">Discrepancias de Tipo</div>
        </div>
      </div>

      <!-- Detailed Diff List -->
      <div class="p-5 rounded-xl bg-slate-900/50 border border-white/[0.08] space-y-3.5 shadow-sm">
        <h3 class="text-xs font-semibold uppercase tracking-wider text-slate-200">Detalle de Discrepancias</h3>

        <div
          v-if="diffSummary.missingTables.length === 0 && diffSummary.missingColumns.length === 0 && diffSummary.typeChanges.length === 0"
          class="p-6 text-center text-xs text-emerald-400 bg-emerald-500/5 rounded-lg border border-emerald-500/20 flex items-center justify-center gap-2"
        >
          <CheckCircle2 class="w-4 h-4 text-emerald-400" />
          <span>Ambos esquemas son completamente idénticos. No se encontraron diferencias.</span>
        </div>

        <div v-else class="space-y-2">
          <!-- Missing tables -->
          <div
            v-for="tbl in diffSummary.missingTables"
            :key="'tbl-' + tbl"
            class="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-between text-xs font-mono"
          >
            <span class="text-white">Tabla: <strong>{{ tbl }}</strong></span>
            <span class="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 text-[10px] font-semibold uppercase">+ Falta en Destino</span>
          </div>

          <!-- Missing columns -->
          <div
            v-for="col in diffSummary.missingColumns"
            :key="'col-' + col.table + '-' + col.column"
            class="p-3 rounded-lg bg-sky-500/10 border border-sky-500/20 flex items-center justify-between text-xs font-mono"
          >
            <span class="text-white">
              {{ col.table }}.<strong class="text-sky-300">{{ col.column }}</strong> ({{ col.type }})
            </span>
            <span class="px-2 py-0.5 rounded bg-sky-500/20 text-sky-300 text-[10px] font-semibold uppercase">+ Columna Faltante</span>
          </div>

          <!-- Type mismatches -->
          <div
            v-for="ch in diffSummary.typeChanges"
            :key="'typ-' + ch.table + '-' + ch.column"
            class="p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-between text-xs font-mono"
          >
            <span class="text-white">
              {{ ch.table }}.<strong>{{ ch.column }}</strong>:
              <span class="text-slate-400 line-through mr-1">{{ ch.dstType }}</span>
              <span class="text-amber-300 font-bold">➔ {{ ch.srcType }}</span>
            </span>
            <span class="px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 text-[10px] font-semibold uppercase">~ Cambio de Tipo</span>
          </div>
        </div>
      </div>

      <!-- Generated Migration Script Box -->
      <div v-if="generatedSql || generatedLaravel" class="p-5 rounded-xl bg-slate-900/50 border border-white/[0.08] space-y-3 shadow-sm">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <!-- Format Switcher -->
          <div class="flex items-center gap-2">
            <div class="inline-flex rounded-lg bg-slate-950 p-0.5 border border-white/[0.08]">
              <button
                type="button"
                @click="activeOutputTab = 'sql'"
                class="px-3 py-1 text-xs rounded-md font-medium transition cursor-pointer flex items-center gap-1.5"
                :class="activeOutputTab === 'sql' ? 'bg-sky-600 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'"
              >
                <FileCode2 class="w-3.5 h-3.5" />
                <span>Script SQL DDL</span>
              </button>
              <button
                type="button"
                @click="activeOutputTab = 'laravel'"
                class="px-3 py-1 text-xs rounded-md font-medium transition cursor-pointer flex items-center gap-1.5"
                :class="activeOutputTab === 'laravel' ? 'bg-rose-600 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'"
              >
                <Code2 class="w-3.5 h-3.5" />
                <span>Laravel Migration</span>
              </button>
            </div>
            <span class="text-[11px] text-slate-400 font-mono">
              ({{ activeOutputTab === 'sql' ? targetDialect.toUpperCase() : 'PHP 8.2+' }})
            </span>
          </div>

          <!-- Actions -->
          <div class="flex items-center gap-2">
            <button
              v-if="activeOutputTab === 'sql'"
              @click="openInBeekeeperEditor"
              class="px-3 py-1.5 bg-sky-600 hover:bg-sky-500 text-white rounded-lg text-xs font-medium flex items-center gap-1.5 transition cursor-pointer shadow-sm active:scale-[0.98]"
              title="Abrir este script en una nueva pestaña del editor de Beekeeper Studio"
            >
              <ExternalLink class="w-3.5 h-3.5" />
              <span>Abrir en Editor</span>
            </button>
            <button
              @click="saveFile"
              class="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-medium flex items-center gap-1.5 transition cursor-pointer border border-white/[0.08]"
              :title="activeOutputTab === 'sql' ? 'Guardar script como archivo .sql' : 'Guardar migración como archivo .php'"
            >
              <Download class="w-3.5 h-3.5 text-slate-400" />
              <span>{{ activeOutputTab === 'sql' ? 'Guardar .sql' : 'Guardar .php' }}</span>
            </button>
            <button
              @click="copyCode"
              class="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-medium flex items-center gap-1.5 transition cursor-pointer border border-white/[0.08]"
            >
              <Check v-if="copied" class="w-3.5 h-3.5 text-emerald-400" />
              <Copy v-else class="w-3.5 h-3.5 text-slate-400" />
              <span>{{ copied ? '¡Copiado!' : (activeOutputTab === 'sql' ? 'Copiar SQL' : 'Copiar PHP') }}</span>
            </button>
          </div>
        </div>

        <pre class="p-4 rounded-lg bg-slate-950 font-mono text-xs overflow-x-auto border border-white/[0.06] leading-relaxed" :class="activeOutputTab === 'sql' ? 'text-emerald-400' : 'text-amber-300'"><code>{{ activeOutputTab === 'sql' ? generatedSql : generatedLaravel }}</code></pre>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import {
  GitCompare,
  Search,
  CheckCircle2,
  FileCode2,
  Code2,
  Copy,
  Check,
  ArrowLeftRight,
  ExternalLink,
  Download
} from 'lucide-vue-next';
import {
  getSavedConnections,
  inspectSchema,
  formatConnOption,
  type SavedConnection,
  type ColumnMeta
} from '../services/companion';
import {
  fetchCurrentConnection,
  executeQuery,
  copyToSystemClipboard,
  isSafeIdentifier,
  openQueryInBeekeeper,
  exportToFile,
  showNotification,
  type ConnectionData
} from '../services/beekeeper';
import { listDatabasesForConnection } from '../services/connectionAccess';
import {
  generateDdlMigration,
  generateLaravelMigration,
  type DiffResult
} from '../services/schemaDiff';
import SearchableSelect from './SearchableSelect.vue';

const availableConns = ref<SavedConnection[]>([]);
const selectedConn1 = ref<SavedConnection | null>(null);
const selectedConn2 = ref<SavedConnection | null>(null);
const currentBksConn = ref<ConnectionData | null>(null);

const sourceDbs = ref<string[]>([]);
const targetDbs = ref<string[]>([]);
const sourceDb = ref('');
const targetDb = ref('');

const targetDialect = ref<'mysql' | 'postgres'>('mysql');
const activeOutputTab = ref<'sql' | 'laravel'>('sql');

const isComparing = ref(false);
const hasDiffResults = ref(false);
const copied = ref(false);

const diffSummary = ref<{
  missingTables: string[];
  missingColumns: Array<{ table: string; column: string; type: string }>;
  typeChanges: Array<{ table: string; column: string; srcType: string; dstType: string }>;
}>({
  missingTables: [],
  missingColumns: [],
  typeChanges: []
});

const generatedSql = ref('');
const generatedLaravel = ref('');
const cachedDiff = ref<DiffResult | null>(null);
const cachedSourceColsMap = ref<Map<string, ColumnMeta[]>>(new Map());

async function loadDbsForConn(conn: SavedConnection | null): Promise<string[]> {
  if (!conn) return [];
  const isCurrentActive = Boolean(
    currentBksConn.value &&
    (conn.name?.toLowerCase() === currentBksConn.value.connectionName?.toLowerCase() || conn.isBeekeeper)
  );

  return listDatabasesForConnection({
    motor: conn.motor,
    host: conn.host,
    port: conn.port || 3306,
    user: conn.user,
    isCurrentActive
  });
}

async function onConn1Change() {
  sourceDbs.value = await loadDbsForConn(selectedConn1.value);
  if (sourceDbs.value.length > 0) {
    if (currentBksConn.value?.databaseName && sourceDbs.value.includes(currentBksConn.value.databaseName)) {
      sourceDb.value = currentBksConn.value.databaseName;
    } else if (!sourceDb.value || !sourceDbs.value.includes(sourceDb.value)) {
      sourceDb.value = sourceDbs.value[0];
    }
  }
}

async function onConn2Change() {
  if (selectedConn2.value?.motor === 'postgres' || selectedConn2.value?.motor === 'postgresql') {
    targetDialect.value = 'postgres';
  } else {
    targetDialect.value = 'mysql';
  }

  targetDbs.value = await loadDbsForConn(selectedConn2.value);
  if (targetDbs.value.length > 0) {
    if (sourceDb.value && targetDbs.value.includes(sourceDb.value)) {
      targetDb.value = sourceDb.value;
    } else if (!targetDb.value || !targetDbs.value.includes(targetDb.value)) {
      targetDb.value = targetDbs.value[0];
    }
  }
}

async function swapDatabases() {
  const tmpConn = selectedConn1.value;
  selectedConn1.value = selectedConn2.value;
  selectedConn2.value = tmpConn;

  const tmpDbs = sourceDbs.value;
  sourceDbs.value = targetDbs.value;
  targetDbs.value = tmpDbs;

  const tmpDb = sourceDb.value;
  sourceDb.value = targetDb.value;
  targetDb.value = tmpDb;

  if (selectedConn2.value?.motor === 'postgres' || selectedConn2.value?.motor === 'postgresql') {
    targetDialect.value = 'postgres';
  } else {
    targetDialect.value = 'mysql';
  }

  if (hasDiffResults.value) {
    await runSchemaDiff();
  }
}

async function getColumnsForConn(conn: SavedConnection | null, db: string): Promise<ColumnMeta[]> {
  if (!db) return [];

  // 1. Companion schema inspection (cross-connection support)
  if (conn) {
    try {
      const cols = await inspectSchema({
        motor: conn.motor,
        host: conn.host,
        port: conn.port || 3306,
        user: conn.user,
        database: db,
        name: conn.name
      });
      if (cols && cols.length > 0) return cols;
    } catch (e) {
      console.warn('Companion inspectSchema failed, falling back to executeQuery:', e);
    }
  }

  // 2. Fallback to active Beekeeper connection executeQuery
  if (!isSafeIdentifier(db)) {
    console.warn(`Nombre de base de datos con caracteres no permitidos, se omite fallback SQL: ${db}`);
    return [];
  }
  const q = `SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT
             FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = '${db}'
             ORDER BY TABLE_NAME, ORDINAL_POSITION;`;
  try {
    const res = await executeQuery(q);
    const rows = res?.results?.[0]?.rows || [];
    return rows.map((r: any) => ({
      table: r.TABLE_NAME || r.table_name,
      column: r.COLUMN_NAME || r.column_name,
      type: r.COLUMN_TYPE || r.column_type,
      nullable: r.IS_NULLABLE || r.is_nullable,
      defaultVal: r.COLUMN_DEFAULT !== undefined ? r.COLUMN_DEFAULT : null
    }));
  } catch (err) {
    console.error('Fallback query error:', err);
    return [];
  }
}

function regenerateScripts() {
  if (!cachedDiff.value) return;
  generatedSql.value = generateDdlMigration(
    cachedDiff.value,
    targetDb.value,
    sourceDb.value,
    targetDialect.value,
    cachedSourceColsMap.value
  );
  generatedLaravel.value = generateLaravelMigration(cachedDiff.value);
}

async function runSchemaDiff() {
  isComparing.value = true;
  hasDiffResults.value = false;
  generatedSql.value = '';
  generatedLaravel.value = '';
  cachedDiff.value = null;

  if (!isSafeIdentifier(sourceDb.value) || !isSafeIdentifier(targetDb.value)) {
    console.error('Nombre de base de datos origen/destino con caracteres no permitidos.');
    isComparing.value = false;
    return;
  }

  try {
    const [cols1, cols2] = await Promise.all([
      getColumnsForConn(selectedConn1.value, sourceDb.value),
      getColumnsForConn(selectedConn2.value, targetDb.value)
    ]);

    const map1 = new Map<string, Map<string, ColumnMeta>>();
    const sourceColsMap = new Map<string, ColumnMeta[]>();

    for (const c of cols1) {
      if (!map1.has(c.table)) map1.set(c.table, new Map());
      map1.get(c.table)!.set(c.column, c);

      if (!sourceColsMap.has(c.table)) sourceColsMap.set(c.table, []);
      sourceColsMap.get(c.table)!.push(c);
    }
    cachedSourceColsMap.value = sourceColsMap;

    const map2 = new Map<string, Map<string, ColumnMeta>>();
    for (const c of cols2) {
      if (!map2.has(c.table)) map2.set(c.table, new Map());
      map2.get(c.table)!.set(c.column, c);
    }

    const missingTables: string[] = [];
    const missingColumns: Array<{ table: string; column: string; type: string; nullable?: string; defaultVal?: any }> = [];
    const typeChanges: Array<{ table: string; column: string; srcType: string; dstType: string }> = [];

    for (const [tblName, colsMap] of map1.entries()) {
      if (!isSafeIdentifier(tblName)) continue;

      if (!map2.has(tblName)) {
        missingTables.push(tblName);
      } else {
        const dstCols = map2.get(tblName)!;
        for (const [colName, colMeta] of colsMap.entries()) {
          if (!isSafeIdentifier(colName)) continue;

          if (!dstCols.has(colName)) {
            missingColumns.push({
              table: tblName,
              column: colName,
              type: colMeta.type,
              nullable: colMeta.nullable,
              defaultVal: colMeta.defaultVal
            });
          } else {
            const dstMeta = dstCols.get(colName)!;
            if (dstMeta.type.toLowerCase() !== colMeta.type.toLowerCase()) {
              typeChanges.push({
                table: tblName,
                column: colName,
                srcType: colMeta.type,
                dstType: dstMeta.type
              });
            }
          }
        }
      }
    }

    const diff: DiffResult = {
      missingTables,
      missingColumns,
      typeChanges,
      missingIndexes: [],
      missingForeignKeys: []
    };

    cachedDiff.value = diff;
    diffSummary.value = { missingTables, missingColumns, typeChanges };

    regenerateScripts();
    hasDiffResults.value = true;
  } catch (err: any) {
    console.error('Error during schema diff:', err);
  } finally {
    isComparing.value = false;
  }
}

async function copyCode() {
  const textToCopy = activeOutputTab.value === 'sql' ? generatedSql.value : generatedLaravel.value;
  if (!textToCopy) return;
  const ok = await copyToSystemClipboard(textToCopy);
  if (ok) {
    copied.value = true;
    setTimeout(() => {
      copied.value = false;
    }, 2000);
  }
}

async function openInBeekeeperEditor() {
  if (!generatedSql.value) return;
  const opened = await openQueryInBeekeeper(generatedSql.value);
  if (opened) {
    showNotification('Script de migración abierto en una nueva pestaña del editor.', 'success');
  } else {
    showNotification('No se pudo abrir el editor nativo de Beekeeper.', 'warning');
  }
}

async function saveFile() {
  if (activeOutputTab.value === 'sql') {
    await saveSqlFile();
  } else {
    await saveLaravelFile();
  }
}

async function saveSqlFile() {
  if (!generatedSql.value) return;
  const fileName = `migration_${targetDb.value || 'sync'}_${new Date().toISOString().slice(0, 10)}.sql`;
  const saved = await exportToFile(generatedSql.value, fileName, [
    { name: 'SQL Scripts (*.sql)', extensions: ['sql'] }
  ]);
  if (saved) {
    showNotification(`Archivo ${fileName} exportado correctamente.`, 'success');
  }
}

async function saveLaravelFile() {
  if (!generatedLaravel.value) return;
  const fileName = `${new Date().toISOString().slice(0, 10).replace(/-/g, '_')}_sync_${targetDb.value || 'tables'}.php`;
  const saved = await exportToFile(generatedLaravel.value, fileName, [
    { name: 'PHP Files (*.php)', extensions: ['php'] }
  ]);
  if (saved) {
    showNotification(`Archivo ${fileName} exportado correctamente.`, 'success');
  }
}

onMounted(async () => {
  try {
    currentBksConn.value = await fetchCurrentConnection();
  } catch (e) {
    console.warn('Active connection fetch error:', e);
  }

  try {
    availableConns.value = await getSavedConnections();
  } catch (e) {
    console.warn('getSavedConnections error:', e);
  }

  if (availableConns.value.length > 0) {
    // Conn 1: prefer matching current active Beekeeper connection, or first
    let srcMatch = null;
    if (currentBksConn.value?.connectionName) {
      srcMatch = availableConns.value.find(
        (c) => c.name.toLowerCase() === currentBksConn.value!.connectionName.toLowerCase()
      );
    }
    selectedConn1.value = srcMatch || availableConns.value[0];
    await onConn1Change();

    // Conn 2: prefer Docker or different connection from Conn 1
    const dstMatch =
      availableConns.value.find(
        (c) => c.name.toLowerCase().includes('docker') && c !== selectedConn1.value
      ) ||
      availableConns.value.find((c) => c !== selectedConn1.value) ||
      availableConns.value[0];

    selectedConn2.value = dstMatch;
    await onConn2Change();
  }
});
</script>

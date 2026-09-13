<template>
  <div class="space-y-6">
    <!-- Top banner -->
    <div class="p-5 rounded-xl bg-slate-900/50 border border-white/[0.08] shadow-sm">
      <div class="flex items-center gap-2">
        <Sparkles class="w-5 h-5 text-sky-400" />
        <h2 class="text-base font-semibold text-white">Generador Inteligente de Datos (Mock Data)</h2>
      </div>
      <p class="text-xs text-slate-400 mt-1">
        Puebla cualquier tabla con datos de prueba realistas mediante Faker, infiriendo nombres, correos, teléfonos, fechas y montos automáticamente.
      </p>
    </div>

    <!-- Table Selection & Config -->
    <div class="p-5 rounded-xl bg-slate-900/50 border border-white/[0.08] space-y-4 shadow-sm">
      <div class="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div>
          <div class="flex items-center justify-between mb-1.5">
            <label class="block text-xs font-medium text-slate-400">Base de Datos</label>
            <span v-if="databases.length > 0" class="text-[10px] px-1.5 py-0.5 rounded bg-sky-500/10 text-sky-400 font-mono">
              {{ databases.length }} BDs
            </span>
          </div>
          <SearchableSelect
            v-model="selectedDb"
            :options="databases"
            :allow-custom="false"
            placeholder="Escribe o busca BD..."
            @change="onDbChange"
          />
        </div>

        <div class="md:col-span-2">
          <div class="flex items-center justify-between mb-1.5">
            <label class="block text-xs font-medium text-slate-400">Tabla</label>
            <span v-if="tableNames.length > 0" class="text-[10px] px-1.5 py-0.5 rounded bg-sky-500/10 text-sky-400 font-mono">
              {{ tableNames.length }} tablas
            </span>
          </div>
          <div class="flex gap-2">
            <SearchableSelect
              v-model="selectedTable"
              :options="tableNames"
              :allow-custom="false"
              placeholder="Escribe o busca una tabla..."
              @change="onTableSelect"
            />
            <button
              @click="loadTables"
              title="Recargar tablas"
              type="button"
              class="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs border border-white/[0.08] transition cursor-pointer flex items-center justify-center shrink-0"
            >
              <RefreshCw class="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        <div>
          <label class="block text-xs font-medium text-slate-400 mb-1.5">Filas a Generar</label>
          <input
            v-model.number="rowCount"
            type="number"
            min="1"
            max="500"
            class="w-full bg-slate-950 border border-white/[0.1] rounded-lg px-3 py-2 text-xs text-slate-200 font-mono focus:outline-none focus:border-sky-500"
            placeholder="10"
          />
        </div>
      </div>

      <!-- Navigation banner if we switched to populate a parent table -->
      <div v-if="previousTable" class="p-3 rounded-lg bg-sky-500/10 border border-sky-500/20 text-sky-200 flex items-center justify-between text-xs">
        <div class="flex items-center gap-2">
          <Info class="w-4 h-4 text-sky-400 shrink-0" />
          <span>
            Poblando tabla padre <strong>{{ selectedTable }}</strong> para satisfacer las claves foráneas de <strong>{{ previousTable }}</strong>.
          </span>
        </div>
        <button
          type="button"
          @click="returnToPreviousTable"
          class="px-3 py-1 bg-sky-600 hover:bg-sky-500 text-white rounded text-xs font-medium transition cursor-pointer flex items-center gap-1.5 shadow-sm"
        >
          <ArrowLeft class="w-3.5 h-3.5" />
          <span>Volver a {{ previousTable }}</span>
        </button>
      </div>

      <!-- Warning banner if any foreign key points to an empty table -->
      <div v-if="emptyFkTables.length > 0" class="p-4 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-200 space-y-2">
        <div class="flex items-center gap-2 font-medium text-xs text-amber-300">
          <AlertTriangle class="w-4 h-4 text-amber-400 shrink-0" />
          <span>Tablas relacionadas vacías detectadas</span>
        </div>
        <p class="text-[11px] text-slate-300 leading-relaxed">
          Esta tabla tiene claves foráneas que apuntan a tablas sin registros. Para mantener la integridad referencial y evitar errores de inserción en la base de datos, te sugerimos poblarlas primero:
        </p>
        <div class="flex flex-wrap gap-2 pt-1">
          <button
            v-for="tbl in emptyFkTables"
            :key="tbl"
            type="button"
            @click="switchToTable(tbl)"
            :disabled="isInNavigationPath(tbl)"
            :title="isInNavigationPath(tbl) ? `Dependencia circular: '${tbl}' ya está en la ruta de navegación actual. Complétala manualmente cambiando de tabla.` : ''"
            class="px-2.5 py-1.5 bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 border border-amber-500/40 rounded text-xs font-mono flex items-center gap-1.5 transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-amber-500/20"
          >
            <ArrowRight class="w-3.5 h-3.5" />
            <span>Poblar "{{ tbl }}"</span>
            <span v-if="isInNavigationPath(tbl)" class="text-[9px] uppercase font-bold">(ciclo)</span>
          </button>
        </div>
      </div>

      <!-- Detected columns preview and generator customization -->
      <div v-if="columnConfigs.length > 0" class="space-y-2.5 pt-3 border-t border-white/[0.06]">
        <div class="flex items-center justify-between">
          <h4 class="text-xs font-semibold uppercase tracking-wider text-slate-300">
            Columnas detectadas ({{ columnConfigs.length }}) y generador inferido:
          </h4>
          <span class="text-[11px] text-slate-400 hidden sm:inline">
            Puedes cambiar el generador o la tabla origen para cada campo
          </span>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5">
          <div
            v-for="col in columnConfigs"
            :key="col.name"
            class="p-3 rounded-lg bg-slate-950/80 border text-xs flex flex-col justify-between gap-2.5 transition"
            :class="col.generator === 'foreign_key' && col.fkEmpty ? 'border-amber-500/40 bg-amber-950/10' : 'border-white/[0.06]'"
          >
            <!-- Header: Column name & Generator select -->
            <div class="flex items-start justify-between gap-2">
              <div class="min-w-0">
                <div class="font-mono font-medium text-white flex items-center gap-1.5 truncate">
                  <Key v-if="col.isPrimary" class="w-3.5 h-3.5 text-amber-400 shrink-0" title="Primary Key / ID" />
                  <Link2 v-else-if="col.generator === 'foreign_key'" class="w-3.5 h-3.5 text-sky-400 shrink-0" title="Clave Foránea" />
                  <span class="truncate">{{ col.name }}</span>
                </div>
                <div class="text-[10px] text-slate-500 font-mono mt-0.5 truncate">{{ col.type }}</div>
              </div>

              <!-- Generator Dropdown -->
              <select
                v-model="col.generator"
                @change="onGeneratorChange(col)"
                class="bg-slate-900 border border-white/[0.15] rounded px-2 py-1 text-[11px] text-sky-300 font-mono focus:outline-none focus:border-sky-500 shrink-0 cursor-pointer max-w-[130px]"
              >
                <optgroup label="Identificadores">
                  <option value="id_sequence">ID Secuencial</option>
                  <option value="foreign_key">Clave Foránea (FK)</option>
                  <option value="db_auto">Auto (BD / Omitir)</option>
                  <option value="faker.uuidv7">UUID (v7 - Temporal)</option>
                  <option value="faker.uuid">UUID (v4 - Aleatorio)</option>
                </optgroup>
                <optgroup label="Texto / Personas">
                  <option value="faker.fullName">faker.fullName</option>
                  <option value="faker.firstName">faker.firstName</option>
                  <option value="faker.lastName">faker.lastName</option>
                  <option value="faker.email">faker.email</option>
                  <option value="faker.phone">faker.phone</option>
                  <option value="faker.company">faker.company</option>
                  <option value="faker.text">faker.text</option>
                  <option value="faker.words">faker.words</option>
                </optgroup>
                <optgroup label="Ubicación">
                  <option value="faker.address">faker.address</option>
                  <option value="faker.city">faker.city</option>
                  <option value="faker.country">faker.country</option>
                </optgroup>
                <optgroup label="Números / Fechas">
                  <option value="faker.int">faker.int</option>
                  <option value="faker.decimal">faker.decimal</option>
                  <option value="faker.price">faker.price</option>
                  <option value="faker.date">faker.date</option>
                  <option value="faker.boolean">faker.boolean</option>
                </optgroup>
              </select>
            </div>

            <!-- FK configuration panel -->
            <div v-if="col.generator === 'foreign_key'" class="pt-2 border-t border-white/[0.06] space-y-1.5">
              <div class="flex items-center justify-between text-[11px]">
                <label class="text-slate-400 font-medium flex items-center gap-1">
                  <Link2 class="w-3 h-3 text-sky-400" />
                  <span>Tabla origen:</span>
                </label>
                <span v-if="col.fkLoading" class="text-[10px] text-slate-500 animate-pulse font-mono">Verificando...</span>
                <span v-else-if="col.fkEmpty" class="text-[10px] text-amber-400 font-mono font-medium">
                  ⚠️ 0 filas
                </span>
                <span v-else-if="col.fkRowCount !== undefined" class="text-[10px] text-emerald-400 font-mono">
                  ✓ {{ col.fkRowCount }} filas
                </span>
              </div>

              <select
                v-model="col.fkTable"
                @change="onFkTableChange(col)"
                class="w-full bg-slate-900 border border-white/[0.1] rounded px-2 py-1 text-xs text-slate-200 font-mono focus:outline-none focus:border-sky-500 cursor-pointer"
              >
                <option value="" disabled>Selecciona tabla origen...</option>
                <option v-for="tbl in tableNames" :key="tbl" :value="tbl">
                  {{ tbl }}
                </option>
              </select>

              <div v-if="col.fkEmpty && col.fkTable" class="flex items-center justify-between pt-0.5">
                <span class="text-[10px] text-amber-300 truncate">
                  {{ isInNavigationPath(col.fkTable) ? 'Dependencia circular' : 'Tabla sin registros' }}
                </span>
                <button
                  type="button"
                  @click="switchToTable(col.fkTable)"
                  :disabled="isInNavigationPath(col.fkTable)"
                  :title="isInNavigationPath(col.fkTable) ? `'${col.fkTable}' ya está en la ruta de navegación actual. Complétala manualmente cambiando de tabla.` : ''"
                  class="text-[10px] px-2 py-0.5 bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 border border-amber-500/40 rounded transition cursor-pointer font-medium flex items-center gap-1 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-amber-500/20"
                >
                  <span>Poblar</span>
                  <ArrowRight class="w-2.5 h-2.5" />
                </button>
              </div>
            </div>

            <!-- Note if generator is id_sequence -->
            <div v-else-if="col.generator === 'id_sequence'" class="pt-1 text-[10px] text-slate-500 font-mono">
              Secuencia autoincremental (inicia en #{{ (maxTableId > 0 ? maxTableId + 1 : 1) }})
            </div>

            <!-- Note if generator is db_auto -->
            <div v-else-if="col.generator === 'db_auto'" class="pt-1 text-[10px] text-slate-500 font-mono">
              Auto (se omite del INSERT)
            </div>
          </div>
        </div>
      </div>

      <div class="flex flex-wrap items-center gap-2.5 pt-2">
        <button
          @click="generateMockRows"
          :disabled="!selectedTable || generating"
          class="px-4 py-2 bg-sky-600 hover:bg-sky-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-medium rounded-lg flex items-center gap-2 shadow-sm transition cursor-pointer active:scale-[0.98]"
        >
          <Eye class="w-4 h-4" />
          <span>{{ generating ? 'Generando...' : `Previsualizar ${rowCount} Filas` }}</span>
        </button>

        <template v-if="mockRows.length > 0">
          <button
            @click="insertIntoDatabase"
            :disabled="inserting"
            class="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-medium rounded-lg flex items-center gap-2 shadow-sm transition cursor-pointer active:scale-[0.98]"
          >
            <Database class="w-4 h-4" />
            <span>{{ inserting ? 'Insertando...' : 'Insertar en Base de Datos' }}</span>
          </button>

          <button
            @click="openSqlInEditor"
            class="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-white/[0.08] rounded-lg text-xs font-medium flex items-center gap-1.5 transition cursor-pointer active:scale-[0.98]"
            title="Abrir INSERT SQL en una nueva pestaña del editor de Beekeeper Studio"
          >
            <ExternalLink class="w-3.5 h-3.5 text-sky-400" />
            <span>Abrir SQL en Editor</span>
          </button>

          <button
            @click="exportAsSql"
            class="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-white/[0.08] rounded-lg text-xs font-medium flex items-center gap-1.5 transition cursor-pointer"
            title="Exportar archivo .sql con sentencias INSERT"
          >
            <Download class="w-3.5 h-3.5 text-slate-400" />
            <span>Exportar .sql</span>
          </button>

          <button
            @click="exportAsCsv"
            class="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-white/[0.08] rounded-lg text-xs font-medium flex items-center gap-1.5 transition cursor-pointer"
            title="Exportar a archivo CSV"
          >
            <Download class="w-3.5 h-3.5 text-slate-400" />
            <span>CSV</span>
          </button>

          <button
            @click="exportAsJson"
            class="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-white/[0.08] rounded-lg text-xs font-medium flex items-center gap-1.5 transition cursor-pointer"
            title="Exportar a archivo JSON"
          >
            <Download class="w-3.5 h-3.5 text-slate-400" />
            <span>JSON</span>
          </button>
        </template>
      </div>
    </div>

    <!-- Preview Table Grid -->
    <div v-if="mockRows.length > 0" class="p-5 rounded-xl bg-slate-900/50 border border-white/[0.08] space-y-3 shadow-sm">
      <div class="flex items-center justify-between">
        <h3 class="text-xs font-semibold uppercase tracking-wider text-slate-200">
          Previsualización ({{ mockRows.length }} filas generadas)
        </h3>
        <div class="flex items-center gap-3">
          <span class="text-xs text-emerald-400 font-medium flex items-center gap-1.5" v-if="insertSuccess">
            <CheckCircle2 class="w-3.5 h-3.5" /> ¡Insertadas con éxito!
          </span>
          <button
            v-if="insertSuccess && previousTable"
            @click="returnToPreviousTable"
            type="button"
            class="px-3 py-1 bg-sky-600 hover:bg-sky-500 text-white rounded text-xs font-medium transition cursor-pointer flex items-center gap-1"
          >
            <ArrowLeft class="w-3 h-3" />
            <span>Volver a {{ previousTable }}</span>
          </button>
        </div>
      </div>

      <div class="overflow-x-auto max-h-80 border border-white/[0.08] rounded-lg">
        <table class="w-full text-xs text-left text-slate-300 font-mono">
          <thead class="bg-slate-950 border-b border-white/[0.08] sticky top-0 z-10">
            <tr>
              <th v-for="col in columnConfigs" :key="'th-' + col.name" class="p-2.5 font-semibold text-white truncate">
                {{ col.name }}
              </th>
            </tr>
          </thead>
          <tbody class="divide-y divide-white/[0.04]">
            <tr v-for="(row, idx) in mockRows" :key="'row-' + idx" class="hover:bg-slate-800/40 transition">
              <td v-for="col in columnConfigs" :key="'td-' + col.name" class="p-2.5 truncate max-w-[200px]">
                {{ row[col.name] !== undefined ? row[col.name] : '-' }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, reactive, onMounted, watch } from 'vue';
import {
  Sparkles,
  RefreshCw,
  Eye,
  Database,
  CheckCircle2,
  Key,
  Link2,
  AlertTriangle,
  ArrowRight,
  ArrowLeft,
  Info,
  ExternalLink,
  Download
} from 'lucide-vue-next';
import { faker } from '@faker-js/faker';
import SearchableSelect from './SearchableSelect.vue';
import {
  fetchTables,
  fetchTablesForDatabase,
  fetchColumns,
  fetchDatabases,
  fetchCurrentConnection,
  fetchTableForeignKeys,
  fetchTableColumnValues,
  fetchTableRowCount,
  fetchTableMaxId,
  findMatchingTable,
  generateUuidV7,
  executeQuery,
  showNotification,
  isSafeIdentifier,
  openQueryInBeekeeper,
  exportToFile,
  confirmAction,
  type ColumnInfo,
  type TableInfo,
  type ForeignKeyInfo
} from '../services/beekeeper';

export interface ColumnConfig {
  name: string;
  type: string;
  generator: string;
  isPrimary?: boolean;
  fkTable?: string;
  fkColumn?: string;
  fkRowCount?: number;
  fkEmpty?: boolean;
  fkLoading?: boolean;
  fkValues?: any[];
}

const props = withDefaults(
  defineProps<{
    initialTable?: string | null;
  }>(),
  {
    initialTable: null
  }
);

const databases = ref<string[]>([]);
const selectedDb = ref('');
const tables = ref<TableInfo[]>([]);
const tableNames = computed(() => tables.value.map((t) => t.name));
const selectedTable = ref('');

watch(
  () => props.initialTable,
  async (newTable) => {
    if (newTable && tableNames.value.includes(newTable) && selectedTable.value !== newTable) {
      selectedTable.value = newTable;
      await onTableSelect();
    }
  }
);
const columns = ref<ColumnInfo[]>([]);
const columnConfigs = ref<ColumnConfig[]>([]);
const maxTableId = ref<number>(0);
// Stack of tables to return to, so navigating through nested empty-FK chains
// (A -> B -> C) can unwind one level at a time (C -> B -> A) instead of
// losing the path back past the immediate parent.
const previousTables = ref<string[]>([]);
const previousTable = computed(() => previousTables.value[previousTables.value.length - 1] || '');

/**
 * True when navigating to `tableName` would revisit a table already on the
 * current path (the table we're on, or any ancestor in `previousTables`).
 * Guards against circular required-FK dependencies (A needs B, B needs A):
 * without this, "Poblar" could push the same table onto the stack forever
 * instead of ever finishing.
 */
function isInNavigationPath(tableName: string): boolean {
  return tableName === selectedTable.value || previousTables.value.includes(tableName);
}

const rowCount = ref(10);
const generating = ref(false);
const inserting = ref(false);
const insertSuccess = ref(false);
const mockRows = ref<any[]>([]);

const emptyFkTables = computed(() => {
  const set = new Set<string>();
  for (const col of columnConfigs.value) {
    if (col.generator === 'foreign_key' && col.fkTable && col.fkEmpty) {
      set.add(col.fkTable);
    }
  }
  return Array.from(set);
});

async function loadTables() {
  if (selectedDb.value) {
    tables.value = await fetchTablesForDatabase(selectedDb.value);
  } else {
    tables.value = await fetchTables();
  }
  if (tables.value.length > 0 && (!selectedTable.value || !tables.value.some((t) => t.name === selectedTable.value))) {
    selectedTable.value = tables.value[0].name;
    await onTableSelect();
  }
}

async function onDbChange() {
  selectedTable.value = '';
  columns.value = [];
  columnConfigs.value = [];
  mockRows.value = [];
  previousTables.value = [];
  await loadTables();
}

async function onTableSelect() {
  if (!selectedTable.value) return;
  mockRows.value = [];
  insertSuccess.value = false;

  let rawCols: ColumnInfo[] = [];
  try {
    rawCols = await fetchColumns(selectedTable.value, selectedDb.value);
  } catch (err) {
    console.warn('Error fetching columns in MockDataTab:', err);
  }
  columns.value = rawCols;

  let dbFks: ForeignKeyInfo[] = [];
  let maxId = 0;
  try {
    const pkCol = rawCols.find(
      (c) => c.name.toLowerCase() === 'id' || c.type.toLowerCase().includes('primary')
    )?.name || 'id';
    const res = await Promise.all([
      fetchTableForeignKeys(selectedTable.value, selectedDb.value),
      fetchTableMaxId(selectedTable.value, pkCol, selectedDb.value)
    ]);
    dbFks = res[0] || [];
    maxId = res[1] || 0;
  } catch (err) {
    console.warn('Error fetching FKs or maxId in MockDataTab:', err);
  }
  maxTableId.value = maxId;

  const fkByCol = new Map<string, ForeignKeyInfo>();
  for (const fk of dbFks) {
    if (fk && fk.columnName) {
      fkByCol.set(fk.columnName.toLowerCase(), fk);
    }
  }

  const configs: ColumnConfig[] = [];
  for (const col of rawCols) {
    const n = col.name.toLowerCase();
    const t = col.type.toLowerCase();
    const isPrimary = n === 'id' || t.includes('primary');

    let generator = '';
    let fkTable = '';
    let fkColumn = 'id';

    if (fkByCol.has(n)) {
      const fk = fkByCol.get(n)!;
      generator = 'foreign_key';
      fkTable = fk.referencedTable;
      fkColumn = fk.referencedColumn || 'id';
    } else if (n.endsWith('_id') || n.endsWith('_fk') || (n.startsWith('id_') && n !== 'id')) {
      generator = 'foreign_key';
      const matched = findMatchingTable(col.name, tableNames.value);
      if (matched) {
        fkTable = matched;
      }
    } else if (n === 'id') {
      if (t.includes('char') || t.includes('uuid') || t.includes('text')) {
        generator = 'faker.uuidv7';
      } else {
        generator = 'id_sequence';
      }
    } else if (t.includes('auto_increment')) {
      generator = 'db_auto';
    } else {
      generator = inferDefaultGenerator(col.name, col.type);
    }

    const cfg = reactive<ColumnConfig>({
      name: col.name,
      type: col.type,
      generator,
      isPrimary,
      fkTable,
      fkColumn,
      fkRowCount: undefined,
      fkEmpty: false,
      fkLoading: false,
      fkValues: []
    });

    configs.push(cfg);
  }

  columnConfigs.value = configs;

  try {
    await Promise.all(
      configs
        .filter((c) => c.generator === 'foreign_key' && c.fkTable)
        .map((c) => refreshFkInfo(c))
    );
  } catch (err) {
    console.warn('Error refreshing FK info:', err);
  }
}

async function refreshFkInfo(cfg: ColumnConfig) {
  if (!cfg.fkTable) {
    cfg.fkRowCount = undefined;
    cfg.fkEmpty = false;
    cfg.fkValues = [];
    return;
  }
  cfg.fkLoading = true;
  try {
    const colName = cfg.fkColumn || 'id';
    const [count, sampleValues] = await Promise.all([
      fetchTableRowCount(cfg.fkTable, selectedDb.value),
      fetchTableColumnValues(cfg.fkTable, colName, selectedDb.value, 200)
    ]);
    cfg.fkRowCount = count;
    cfg.fkEmpty = count === 0 || sampleValues.length === 0;
    cfg.fkValues = sampleValues;
  } catch (err) {
    console.warn(`Error loading FK info for ${cfg.fkTable}:`, err);
    cfg.fkRowCount = 0;
    cfg.fkEmpty = true;
    cfg.fkValues = [];
  } finally {
    cfg.fkLoading = false;
  }
}

async function onFkTableChange(col: ColumnConfig) {
  mockRows.value = [];
  await refreshFkInfo(col);
}

async function onGeneratorChange(col: ColumnConfig) {
  mockRows.value = [];
  if (col.generator === 'foreign_key') {
    if (!col.fkTable) {
      col.fkTable = findMatchingTable(col.name, tableNames.value) || '';
    }
    if (col.fkTable) {
      await refreshFkInfo(col);
    }
  }
}

async function switchToTable(tableName: string) {
  if (!tableName || tableName === selectedTable.value) return;
  // Defense in depth: the UI already disables the button for this case, but
  // guard here too in case switchToTable is ever called some other way.
  if (previousTables.value.includes(tableName)) {
    showNotification(
      `No se puede navegar a "${tableName}": ya está en la ruta de navegación actual (dependencia circular). Complétala manualmente cambiando de tabla.`,
      'warning'
    );
    return;
  }
  previousTables.value.push(selectedTable.value);
  selectedTable.value = tableName;
  await onTableSelect();
  showNotification(`Cambiado a tabla "${tableName}". Genera e inserta datos aquí para satisfacer la relación.`, 'info');
}

async function returnToPreviousTable() {
  const target = previousTables.value.pop();
  if (!target) return;
  selectedTable.value = target;
  await onTableSelect();
  showNotification(`Regresaste a "${target}". Las claves foráneas ahora reflejan los nuevos datos.`, 'info');
}

function inferDefaultGenerator(name: string, type: string): string {
  const n = name.toLowerCase();
  const t = type.toLowerCase();

  if (n.includes('email') || n.includes('correo')) return 'faker.email';
  if (n.includes('first_name') || n.includes('nombre')) return 'faker.firstName';
  if (n.includes('last_name') || n.includes('apellido')) return 'faker.lastName';
  if (n.includes('name') || n.includes('title') || n.includes('titulo')) return 'faker.fullName';
  if (n.includes('phone') || n.includes('telefono') || n.includes('celular')) return 'faker.phone';
  if (n.includes('address') || n.includes('direccion')) return 'faker.address';
  if (n.includes('city') || n.includes('ciudad')) return 'faker.city';
  if (n.includes('country') || n.includes('pais')) return 'faker.country';
  if (n.includes('company') || n.includes('empresa')) return 'faker.company';
  if (n.includes('uuid') || t.includes('uuid')) return 'faker.uuidv7';
  if (
    n.includes('price') ||
    n.includes('amount') ||
    n.includes('total') ||
    n.includes('precio') ||
    n.includes('monto') ||
    n.includes('costo') ||
    n.includes('saldo') ||
    n.includes('balance')
  ) {
    return 'faker.price';
  }
  if (n.includes('cantidad') || n.includes('qty') || n.includes('quantity') || n.includes('stock') || n.includes('cant')) {
    if (t.includes('double') || t.includes('float') || t.includes('decimal') || t.includes('numeric')) {
      return 'faker.decimal';
    }
    return 'faker.int';
  }
  if (t.includes('decimal') || t.includes('double') || t.includes('float') || t.includes('numeric') || t.includes('real')) {
    return 'faker.decimal';
  }
  if (t.includes('int')) return 'faker.int';
  if (t.includes('date') || t.includes('time') || t.includes('timestamp')) return 'faker.date';
  if (t.includes('bool') || t.includes('tinyint(1)')) return 'faker.boolean';
  if (t.includes('text')) return 'faker.text';
  return 'faker.words';
}

interface GeneratorContext {
  col: ColumnConfig;
  rowIndex: number;
  maxTableId: number;
}

/**
 * Strategy registry: one value-generation function per `generator` key,
 * selected at call time in generateValueForCol(). Replaces a ~20-case
 * switch statement — the same shape of "pick behavior by string key" this
 * project already consolidates into a registry on the companion daemon side
 * (server/engines/index.js's getEngine()). Adding a new generator is now a
 * one-line addition here instead of another switch branch, and each
 * generator is independently callable/testable.
 */
const VALUE_GENERATORS: Record<string, (ctx: GeneratorContext) => any> = {
  id_sequence: ({ rowIndex, maxTableId }) => (maxTableId > 0 ? maxTableId : 0) + rowIndex + 1,
  db_auto: () => null,
  foreign_key: ({ col, rowIndex }) => {
    if (col.fkValues && col.fkValues.length > 0) {
      return col.fkValues[Math.floor(Math.random() * col.fkValues.length)];
    }
    return rowIndex + 1;
  },
  'faker.email': () => faker.internet.email().toLowerCase(),
  'faker.firstName': () => faker.person.firstName(),
  'faker.lastName': () => faker.person.lastName(),
  'faker.fullName': () => faker.person.fullName(),
  'faker.phone': () => faker.phone.number(),
  'faker.address': () => faker.location.streetAddress(),
  'faker.city': () => faker.location.city(),
  'faker.country': () => faker.location.country(),
  'faker.company': () => faker.company.name(),
  'faker.uuidv7': () => generateUuidV7(),
  'faker.uuid': () => faker.string.uuid(),
  'faker.price': () => parseFloat(faker.commerce.price({ min: 10, max: 999 })),
  'faker.decimal': () => parseFloat(faker.number.float({ min: 1, max: 500, fractionDigits: 2 }).toFixed(2)),
  'faker.int': () => faker.number.int({ min: 1, max: 1000 }),
  'faker.date': () => faker.date.recent().toISOString().slice(0, 19).replace('T', ' '),
  'faker.boolean': () => (faker.datatype.boolean() ? 1 : 0),
  'faker.text': () => faker.lorem.sentence(),
  'faker.words': () => faker.lorem.word()
};

function generateValueForCol(col: ColumnConfig, rowIndex: number) {
  const generate = VALUE_GENERATORS[col.generator] ?? VALUE_GENERATORS['faker.words'];
  return generate({ col, rowIndex, maxTableId: maxTableId.value });
}

function generateMockRows() {
  generating.value = true;
  insertSuccess.value = false;
  const rows = [];

  for (let i = 0; i < rowCount.value; i++) {
    const row: any = {};
    for (const col of columnConfigs.value) {
      const val = generateValueForCol(col, i);
      if (val !== null && val !== undefined) {
        row[col.name] = val;
      }
    }
    rows.push(row);
  }

  mockRows.value = rows;
  generating.value = false;
}

async function insertIntoDatabase() {
  if (mockRows.value.length === 0 || !selectedTable.value) return;

  const colsToInsert = Object.keys(mockRows.value[0]);
  if (colsToInsert.length === 0) {
    showNotification('No hay columnas con datos para insertar.', 'warning');
    return;
  }

  if (
    !isSafeIdentifier(selectedTable.value) ||
    (selectedDb.value && !isSafeIdentifier(selectedDb.value)) ||
    !colsToInsert.every((c) => isSafeIdentifier(c))
  ) {
    showNotification('Nombre de base de datos, tabla o columna inválido (contiene comillas o caracteres no permitidos).', 'error');
    return;
  }

  const confirmed = await confirmAction(
    `¿Deseas insertar ${mockRows.value.length} filas simuladas en la tabla "${selectedTable.value}"?`,
    'Confirmar Inserción de Mock Data'
  );
  if (!confirmed) return;

  inserting.value = true;
  try {
    const valuesList = mockRows.value.map((row) => {
      const vals = colsToInsert.map((c) => {
        const val = row[c];
        if (typeof val === 'number') return val;
        if (val === null || val === undefined) return 'NULL';
        const safe = String(val).replace(/\\/g, '\\\\').replace(/'/g, "''");
        return `'${safe}'`;
      });
      return `(${vals.join(', ')})`;
    });

    const buildInsert = (q: (id: string) => string) => {
      const colNamesStr = colsToInsert.map((c) => q(c)).join(', ');
      const targetTable = selectedDb.value
        ? `${q(selectedDb.value)}.${q(selectedTable.value)}`
        : q(selectedTable.value);
      return `INSERT INTO ${targetTable} (${colNamesStr}) VALUES \n${valuesList.join(',\n')};`;
    };

    try {
      await executeQuery(buildInsert((id) => `\`${id}\``));
    } catch (mysqlErr: any) {
      // Reintentar con comillas dobles estándar (PostgreSQL / SQLite) si la sintaxis de backticks falla
      try {
        await executeQuery(buildInsert((id) => `"${id}"`));
      } catch {
        throw mysqlErr;
      }
    }

    maxTableId.value += mockRows.value.length;
    insertSuccess.value = true;
    showNotification(`✔ Se insertaron ${mockRows.value.length} filas en ${selectedTable.value} con éxito.`, 'success');
  } catch (err: any) {
    showNotification(`Error al insertar: ${err.message}`, 'error');
  } finally {
    inserting.value = false;
  }
}

function buildInsertSql(): string {
  if (mockRows.value.length === 0 || !selectedTable.value) return '';
  const colsToInsert = Object.keys(mockRows.value[0]);
  const valuesList = mockRows.value.map((row) => {
    const vals = colsToInsert.map((c) => {
      const val = row[c];
      if (typeof val === 'number') return val;
      if (val === null || val === undefined) return 'NULL';
      const safe = String(val).replace(/\\/g, '\\\\').replace(/'/g, "''");
      return `'${safe}'`;
    });
    return `(${vals.join(', ')})`;
  });

  const colNamesStr = colsToInsert.map((c) => `\`${c}\``).join(', ');
  const targetTable = selectedDb.value
    ? `\`${selectedDb.value}\`.\`${selectedTable.value}\``
    : `\`${selectedTable.value}\``;
  return `INSERT INTO ${targetTable} (${colNamesStr}) VALUES \n${valuesList.join(',\n')};`;
}

async function openSqlInEditor() {
  const sql = buildInsertSql();
  if (!sql) return;
  const opened = await openQueryInBeekeeper(sql);
  if (opened) {
    showNotification('Script de inserción abierto en el editor de Beekeeper Studio.', 'success');
  } else {
    showNotification('No se pudo abrir el editor nativo de Beekeeper.', 'warning');
  }
}

async function exportAsSql() {
  const sql = buildInsertSql();
  if (!sql) return;
  const fileName = `seed_${selectedTable.value}_${mockRows.value.length}rows.sql`;
  const saved = await exportToFile(sql, fileName, [{ name: 'SQL Script (*.sql)', extensions: ['sql'] }]);
  if (saved) {
    showNotification(`Archivo ${fileName} exportado correctamente.`, 'success');
  }
}

async function exportAsCsv() {
  if (mockRows.value.length === 0) return;
  const cols = Object.keys(mockRows.value[0]);
  const header = cols.join(',');
  const rows = mockRows.value.map((r) =>
    cols.map((c) => {
      const v = r[c];
      if (v === null || v === undefined) return '';
      const str = String(v).replace(/"/g, '""');
      return `"${str}"`;
    }).join(',')
  );
  const csv = [header, ...rows].join('\n');
  const fileName = `mock_${selectedTable.value}_${mockRows.value.length}rows.csv`;
  const saved = await exportToFile(csv, fileName, [{ name: 'CSV File (*.csv)', extensions: ['csv'] }]);
  if (saved) {
    showNotification(`Archivo ${fileName} exportado correctamente.`, 'success');
  }
}

async function exportAsJson() {
  if (mockRows.value.length === 0) return;
  const json = JSON.stringify(mockRows.value, null, 2);
  const fileName = `mock_${selectedTable.value}_${mockRows.value.length}rows.json`;
  const saved = await exportToFile(json, fileName, [{ name: 'JSON File (*.json)', extensions: ['json'] }]);
  if (saved) {
    showNotification(`Archivo ${fileName} exportado correctamente.`, 'success');
  }
}

onMounted(async () => {
  try {
    const [dbs, current] = await Promise.all([
      fetchDatabases(),
      fetchCurrentConnection()
    ]);
    databases.value = dbs;
    if (dbs.length > 0) {
      selectedDb.value = current?.databaseName && dbs.includes(current.databaseName)
        ? current.databaseName
        : dbs[0];
    }
  } catch (e) {
    console.warn('Error loading initial databases in MockDataTab:', e);
  }
  await loadTables();

  if (props.initialTable && tableNames.value.includes(props.initialTable)) {
    selectedTable.value = props.initialTable;
    await onTableSelect();
  }
});
</script>

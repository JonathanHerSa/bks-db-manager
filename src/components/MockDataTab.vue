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

      <!-- Detected columns preview -->
      <div v-if="columns.length > 0" class="space-y-2.5 pt-3 border-t border-white/[0.06]">
        <h4 class="text-xs font-semibold uppercase tracking-wider text-slate-300">
          Columnas detectadas ({{ columns.length }}) y generador inferido:
        </h4>
        <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
          <div
            v-for="col in columns"
            :key="col.name"
            class="p-2.5 rounded-lg bg-slate-950/80 border border-white/[0.06] text-xs flex items-center justify-between"
          >
            <div>
              <div class="font-mono font-medium text-white">{{ col.name }}</div>
              <div class="text-[10px] text-slate-500 font-mono">{{ col.type }}</div>
            </div>
            <span class="text-[10px] px-2 py-0.5 rounded bg-sky-500/10 text-sky-400 border border-sky-500/20 font-mono font-medium">
              {{ inferGeneratorName(col.name, col.type) }}
            </span>
          </div>
        </div>
      </div>

      <div class="flex items-center gap-3 pt-2">
        <button
          @click="generateMockRows"
          :disabled="!selectedTable || generating"
          class="px-4 py-2 bg-sky-600 hover:bg-sky-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-medium rounded-lg flex items-center gap-2 shadow-sm transition cursor-pointer active:scale-[0.98]"
        >
          <Eye class="w-4 h-4" />
          <span>Previsualizar {{ rowCount }} Filas</span>
        </button>

        <button
          v-if="mockRows.length > 0"
          @click="insertIntoDatabase"
          :disabled="inserting"
          class="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-medium rounded-lg flex items-center gap-2 shadow-sm transition cursor-pointer active:scale-[0.98]"
        >
          <Database class="w-4 h-4" />
          <span>{{ inserting ? 'Insertando...' : 'Insertar en Base de Datos' }}</span>
        </button>
      </div>
    </div>

    <!-- Preview Table Grid -->
    <div v-if="mockRows.length > 0" class="p-5 rounded-xl bg-slate-900/50 border border-white/[0.08] space-y-3 shadow-sm">
      <div class="flex items-center justify-between">
        <h3 class="text-xs font-semibold uppercase tracking-wider text-slate-200">
          Previsualización ({{ mockRows.length }} filas generadas)
        </h3>
        <span class="text-xs text-emerald-400 font-medium flex items-center gap-1.5" v-if="insertSuccess">
          <CheckCircle2 class="w-3.5 h-3.5" /> ¡Insertadas con éxito!
        </span>
      </div>

      <div class="overflow-x-auto max-h-80 border border-white/[0.08] rounded-lg">
        <table class="w-full text-xs text-left text-slate-300 font-mono">
          <thead class="bg-slate-950 border-b border-white/[0.08] sticky top-0 z-10">
            <tr>
              <th v-for="col in columns" :key="'th-' + col.name" class="p-2.5 font-semibold text-white truncate">
                {{ col.name }}
              </th>
            </tr>
          </thead>
          <tbody class="divide-y divide-white/[0.04]">
            <tr v-for="(row, idx) in mockRows" :key="'row-' + idx" class="hover:bg-slate-800/40 transition">
              <td v-for="col in columns" :key="'td-' + col.name" class="p-2.5 truncate max-w-[200px]">
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
import { ref, computed, onMounted } from 'vue';
import { Sparkles, RefreshCw, Eye, Database, CheckCircle2 } from 'lucide-vue-next';
import { faker } from '@faker-js/faker';
import SearchableSelect from './SearchableSelect.vue';
import {
  fetchTables,
  fetchTablesForDatabase,
  fetchColumns,
  fetchDatabases,
  fetchCurrentConnection,
  executeQuery,
  showNotification,
  type ColumnInfo,
  type TableInfo
} from '../services/beekeeper';

const databases = ref<string[]>([]);
const selectedDb = ref('');
const tables = ref<TableInfo[]>([]);
const tableNames = computed(() => tables.value.map((t) => t.name));
const selectedTable = ref('');
const columns = ref<ColumnInfo[]>([]);
const rowCount = ref(10);
const generating = ref(false);
const inserting = ref(false);
const insertSuccess = ref(false);
const mockRows = ref<any[]>([]);

async function loadTables() {
  if (selectedDb.value) {
    tables.value = await fetchTablesForDatabase(selectedDb.value);
  } else {
    tables.value = await fetchTables();
  }
  if (tables.value.length > 0 && (!selectedTable.value || !tables.value.some(t => t.name === selectedTable.value))) {
    selectedTable.value = tables.value[0].name;
    await onTableSelect();
  }
}

async function onDbChange() {
  selectedTable.value = '';
  columns.value = [];
  mockRows.value = [];
  await loadTables();
}

async function onTableSelect() {
  if (!selectedTable.value) return;
  mockRows.value = [];
  insertSuccess.value = false;
  columns.value = await fetchColumns(selectedTable.value, selectedDb.value);
}

function inferGeneratorName(name: string, type: string): string {
  const n = name.toLowerCase();
  const t = type.toLowerCase();

  if (n === 'id' || n.endsWith('_id') || t.includes('auto_increment')) return 'Auto (Skip)';
  if (n.includes('email') || n.includes('correo')) return 'faker.email';
  if (n.includes('first_name') || n.includes('nombre')) return 'faker.firstName';
  if (n.includes('last_name') || n.includes('apellido')) return 'faker.lastName';
  if (n.includes('name') || n.includes('title')) return 'faker.fullName';
  if (n.includes('phone') || n.includes('telefono') || n.includes('celular')) return 'faker.phone';
  if (n.includes('address') || n.includes('direccion')) return 'faker.address';
  if (n.includes('city') || n.includes('ciudad')) return 'faker.city';
  if (n.includes('country') || n.includes('pais')) return 'faker.country';
  if (n.includes('company') || n.includes('empresa')) return 'faker.company';
  if (n.includes('uuid')) return 'faker.uuid';
  if (n.includes('price') || n.includes('amount') || n.includes('total') || n.includes('precio')) return 'faker.price';
  if (t.includes('int')) return 'faker.int';
  if (t.includes('date') || t.includes('time')) return 'faker.date';
  if (t.includes('bool') || t.includes('tinyint(1)')) return 'faker.boolean';
  if (t.includes('text')) return 'faker.text';
  return 'faker.words';
}

function generateValue(name: string, type: string) {
  const n = name.toLowerCase();
  const t = type.toLowerCase();

  if (n === 'id' || (n.endsWith('_id') && t.includes('int')) || t.includes('auto_increment')) {
    return null;
  }
  if (n.includes('email') || n.includes('correo')) return faker.internet.email().toLowerCase();
  if (n.includes('first_name') || n.includes('nombre')) return faker.person.firstName();
  if (n.includes('last_name') || n.includes('apellido')) return faker.person.lastName();
  if (n.includes('name') || n.includes('title')) return faker.person.fullName();
  if (n.includes('phone') || n.includes('telefono')) return faker.phone.number();
  if (n.includes('address') || n.includes('direccion')) return faker.location.streetAddress();
  if (n.includes('city') || n.includes('ciudad')) return faker.location.city();
  if (n.includes('country') || n.includes('pais')) return faker.location.country();
  if (n.includes('company') || n.includes('empresa')) return faker.company.name();
  if (n.includes('uuid')) return faker.string.uuid();
  if (n.includes('price') || n.includes('amount') || n.includes('total') || n.includes('precio')) {
    return parseFloat(faker.commerce.price({ min: 10, max: 999 }));
  }
  if (t.includes('int')) return faker.number.int({ min: 1, max: 1000 });
  if (t.includes('date') || t.includes('time')) return faker.date.recent().toISOString().slice(0, 19).replace('T', ' ');
  if (t.includes('bool') || t.includes('tinyint(1)')) return faker.datatype.boolean() ? 1 : 0;
  if (t.includes('text')) return faker.lorem.sentence();
  return faker.lorem.word();
}

function generateMockRows() {
  generating.value = true;
  insertSuccess.value = false;
  const rows = [];

  for (let i = 0; i < rowCount.value; i++) {
    const row: any = {};
    for (const col of columns.value) {
      const val = generateValue(col.name, col.type);
      if (val !== null) {
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

  inserting.value = true;
  try {
    const colsToInsert = Object.keys(mockRows.value[0]);
    const colNamesStr = colsToInsert.map((c) => `\`${c}\``).join(', ');

    const valuesList = mockRows.value.map((row) => {
      const vals = colsToInsert.map((c) => {
        const val = row[c];
        if (typeof val === 'number') return val;
        if (val === null || val === undefined) return 'NULL';
        const safe = String(val).replace(/'/g, "''");
        return `'${safe}'`;
      });
      return `(${vals.join(', ')})`;
    });

    const targetTable = selectedDb.value
      ? `\`${selectedDb.value}\`.\`${selectedTable.value}\``
      : `\`${selectedTable.value}\``;
    const query = `INSERT INTO ${targetTable} (${colNamesStr}) VALUES \n${valuesList.join(',\n')};`;
    await executeQuery(query);

    insertSuccess.value = true;
    showNotification(`✔ Se insertaron ${mockRows.value.length} filas en ${selectedTable.value} con éxito.`, 'success');
  } catch (err: any) {
    showNotification(`Error al insertar: ${err.message}`, 'error');
  } finally {
    inserting.value = false;
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
});
</script>

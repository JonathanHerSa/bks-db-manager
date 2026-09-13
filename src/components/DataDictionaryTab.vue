<template>
  <div class="space-y-6">
    <!-- Top banner -->
    <div class="p-5 rounded-xl bg-slate-900/50 border border-white/[0.08] flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-sm">
      <div>
        <div class="flex items-center gap-2">
          <BookOpen class="w-5 h-5 text-sky-400" />
          <h2 class="text-base font-semibold text-white">Diccionario de Datos</h2>
        </div>
        <p class="text-xs text-slate-400 mt-1">
          Documentación técnica viva, catálogo de tablas, tipos de columnas, relaciones de claves foráneas y exportación en Markdown.
        </p>
      </div>

      <div class="flex items-center gap-2">
        <button
          @click="loadDictionary"
          :disabled="loading || !selectedDb"
          class="px-4 py-2 bg-sky-600 hover:bg-sky-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-medium rounded-lg flex items-center gap-2 shadow-sm transition cursor-pointer active:scale-[0.98]"
        >
          <RefreshCw class="w-3.5 h-3.5" :class="loading ? 'animate-spin' : ''" />
          <span>{{ loading ? 'Analizando...' : 'Generar Diccionario' }}</span>
        </button>
      </div>
    </div>

    <!-- Database Selector & Stats -->
    <div class="p-5 rounded-xl bg-slate-900/50 border border-white/[0.08] space-y-4 shadow-sm">
      <div class="grid grid-cols-1 md:grid-cols-3 gap-4 items-center">
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
            placeholder="Selecciona una base de datos..."
            @change="onDbChange"
          />
        </div>

        <div v-if="tablesData.length > 0" class="md:col-span-2 flex flex-wrap items-center gap-3 md:justify-end pt-2 md:pt-0">
          <div class="px-3.5 py-2 rounded-lg bg-slate-950/70 border border-white/[0.06] text-center min-w-[100px]">
            <div class="text-lg font-bold text-sky-400 font-mono">{{ tablesData.length }}</div>
            <div class="text-[10px] text-slate-400 uppercase font-medium">Tablas</div>
          </div>
          <div class="px-3.5 py-2 rounded-lg bg-slate-950/70 border border-white/[0.06] text-center min-w-[100px]">
            <div class="text-lg font-bold text-emerald-400 font-mono">{{ totalColumnsCount }}</div>
            <div class="text-[10px] text-slate-400 uppercase font-medium">Columnas</div>
          </div>
          <div class="px-3.5 py-2 rounded-lg bg-slate-950/70 border border-white/[0.06] text-center min-w-[100px]">
            <div class="text-lg font-bold text-purple-400 font-mono">{{ totalFkCount }}</div>
            <div class="text-[10px] text-slate-400 uppercase font-medium">Relaciones FK</div>
          </div>
        </div>
      </div>
    </div>

    <!-- Loading progress -->
    <div v-if="loading" class="p-8 text-center bg-slate-900/40 rounded-xl border border-white/[0.08] space-y-3">
      <RefreshCw class="w-6 h-6 text-sky-400 animate-spin mx-auto" />
      <p class="text-xs text-slate-300 font-medium">Inspeccionando esquema, columnas y relaciones foráneas...</p>
      <p class="text-[11px] text-slate-500 font-mono">{{ progressMessage }}</p>
    </div>

    <!-- Main Content when Loaded -->
    <div v-else-if="tablesData.length > 0" class="space-y-4">
      <!-- Sub-navigation view toggle -->
      <div class="flex items-center justify-between border-b border-white/[0.08] pb-2">
        <div class="flex items-center gap-1.5">
          <button
            @click="activeView = 'dictionary'"
            :class="activeView === 'dictionary' ? 'bg-sky-500/20 text-sky-300 border-sky-500/40' : 'bg-slate-900/60 text-slate-400 hover:text-slate-200 border-white/[0.05]'"
            class="px-3 py-1.5 rounded-lg border text-xs font-medium flex items-center gap-2 transition cursor-pointer"
          >
            <Table class="w-3.5 h-3.5 text-emerald-400" />
            <span>Diccionario de Tablas</span>
          </button>
          <button
            @click="activeView = 'markdown'"
            :class="activeView === 'markdown' ? 'bg-sky-500/20 text-sky-300 border-sky-500/40' : 'bg-slate-900/60 text-slate-400 hover:text-slate-200 border-white/[0.05]'"
            class="px-3 py-1.5 rounded-lg border text-xs font-medium flex items-center gap-2 transition cursor-pointer"
          >
            <FileText class="w-3.5 h-3.5 text-amber-400" />
            <span>Documento Markdown</span>
          </button>
        </div>

        <!-- Global Export Button -->
        <div class="flex items-center gap-2">
          <button
            @click="exportMarkdownDoc"
            class="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-medium flex items-center gap-1.5 transition cursor-pointer border border-white/[0.08]"
            title="Descargar documentación en formato Markdown"
          >
            <Download class="w-3.5 h-3.5 text-slate-400" />
            <span>Exportar Markdown</span>
          </button>
        </div>
      </div>

      <!-- VIEW 1: INTERACTIVE DATA DICTIONARY -->
      <div v-if="activeView === 'dictionary'" class="space-y-3">
        <!-- Search filter input -->
        <div class="flex items-center gap-3">
          <input
            v-model="tableFilter"
            type="text"
            placeholder="Filtrar tablas por nombre..."
            class="w-full sm:max-w-xs bg-slate-900 border border-white/[0.1] rounded-lg px-3 py-1.5 text-xs text-slate-200 font-mono focus:outline-none focus:border-sky-500"
          />
          <span class="text-xs text-slate-500 font-mono">
            Mostrando {{ filteredTables.length }} de {{ tablesData.length }} tablas
          </span>
        </div>

        <!-- Tables list -->
        <div class="space-y-4">
          <div
            v-for="tbl in filteredTables"
            :key="tbl.name"
            class="p-5 rounded-xl bg-slate-900/50 border border-white/[0.08] space-y-3 shadow-sm"
          >
            <!-- Table Header -->
            <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-white/[0.06]">
              <div class="flex items-center gap-2.5">
                <Database class="w-4 h-4 text-emerald-400" />
                <h3 class="text-sm font-semibold text-white font-mono">{{ tbl.name }}</h3>
                <span class="text-[10px] px-2 py-0.5 rounded bg-slate-800 text-slate-400 border border-white/[0.06] font-mono">
                  {{ tbl.rowCount !== undefined ? `${tbl.rowCount} filas` : 'N/A' }}
                </span>
                <span class="text-[10px] px-2 py-0.5 rounded bg-sky-500/10 text-sky-400 border border-sky-500/20 font-mono">
                  {{ tbl.columns.length }} columnas
                </span>
              </div>

              <div class="flex items-center gap-2">
                <button
                  @click="openTableNative(tbl.name)"
                  class="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded border border-white/[0.08] text-[11px] flex items-center gap-1.5 transition cursor-pointer"
                  title="Abrir vista de datos de esta tabla en Beekeeper"
                >
                  <ExternalLink class="w-3 h-3 text-sky-400" />
                  <span>Ver en Beekeeper</span>
                </button>
              </div>
            </div>

            <!-- Columns Table -->
            <div class="overflow-x-auto border border-white/[0.06] rounded-lg">
              <table class="w-full text-xs text-left font-mono">
                <thead class="bg-slate-950/80 text-slate-400 uppercase text-[10px] border-b border-white/[0.06]">
                  <tr>
                    <th class="p-2.5">Columna</th>
                    <th class="p-2.5">Tipo</th>
                    <th class="p-2.5">Clave / Relación</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-white/[0.04]">
                  <tr
                    v-for="col in tbl.columns"
                    :key="col.name"
                    class="hover:bg-slate-800/30 transition text-slate-300"
                  >
                    <td class="p-2.5 font-medium text-white flex items-center gap-1.5">
                      <Key v-if="isColPk(tbl, col.name)" class="w-3 h-3 text-amber-400 shrink-0" title="Primary Key" />
                      <Link2 v-else-if="getColFk(tbl, col.name)" class="w-3 h-3 text-sky-400 shrink-0" title="Foreign Key" />
                      <span>{{ col.name }}</span>
                    </td>
                    <td class="p-2.5 text-sky-300 font-mono text-[11px]">
                      {{ col.type || 'varchar' }}
                    </td>
                    <td class="p-2.5 text-[11px]">
                      <span v-if="isColPk(tbl, col.name)" class="text-amber-400 font-semibold uppercase text-[10px]">
                        PK (Clave Primaria)
                      </span>
                      <span v-else-if="getColFk(tbl, col.name)" class="text-sky-300">
                        FK ➔ <strong>{{ getColFk(tbl, col.name)?.referencedTable }}</strong>.{{ getColFk(tbl, col.name)?.referencedColumn }}
                      </span>
                      <span v-else class="text-slate-600">-</span>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            <!-- FK Summary pill list if any -->
            <div v-if="tbl.foreignKeys.length > 0" class="pt-1 flex flex-wrap items-center gap-2">
              <span class="text-[10px] text-slate-500 uppercase font-semibold">Relaciones detectadas:</span>
              <span
                v-for="(fk, fki) in tbl.foreignKeys"
                :key="fki"
                class="px-2 py-0.5 rounded bg-purple-500/10 text-purple-300 border border-purple-500/20 text-[10px] font-mono flex items-center gap-1"
              >
                <Link2 class="w-2.5 h-2.5" />
                {{ fk.columnName }} ➔ {{ fk.referencedTable }}({{ fk.referencedColumn }})
              </span>
            </div>
          </div>
        </div>
      </div>

      <!-- VIEW 3: MARKDOWN DOCUMENT -->
      <div v-else-if="activeView === 'markdown'" class="space-y-3">
        <div class="p-5 rounded-xl bg-slate-900/50 border border-white/[0.08] space-y-3 shadow-sm">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-2">
              <span class="text-xs font-semibold uppercase tracking-wider text-slate-200">
                Documento Markdown Generado
              </span>
            </div>
            <div class="flex items-center gap-2">
              <button
                @click="copyMarkdown"
                class="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-medium flex items-center gap-1.5 transition cursor-pointer border border-white/[0.08]"
              >
                <Check v-if="mdCopied" class="w-3.5 h-3.5 text-emerald-400" />
                <Copy v-else class="w-3.5 h-3.5 text-slate-400" />
                <span>{{ mdCopied ? '¡Copiado!' : 'Copiar Markdown' }}</span>
              </button>
              <button
                @click="exportMarkdownDoc"
                class="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-medium flex items-center gap-1.5 transition cursor-pointer border border-white/[0.08]"
              >
                <Download class="w-3.5 h-3.5 text-slate-400" />
                <span>Guardar .md</span>
              </button>
            </div>
          </div>

          <pre class="p-4 rounded-lg bg-slate-950 text-slate-300 font-mono text-xs overflow-x-auto border border-white/[0.06] max-h-[460px] leading-relaxed whitespace-pre-wrap"><code>{{ markdownDoc }}</code></pre>
        </div>
      </div>
    </div>

    <!-- Empty State -->
    <div v-else class="p-12 text-center bg-slate-900/30 rounded-xl border border-dashed border-white/[0.08] space-y-2">
      <BookOpen class="w-8 h-8 text-slate-600 mx-auto" />
      <p class="text-xs text-slate-400">Selecciona una base de datos y haz clic en "Generar Diccionario".</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import {
  BookOpen,
  RefreshCw,
  Database,
  Table,
  FileText,
  Copy,
  Check,
  Download,
  Key,
  Link2,
  ExternalLink
} from 'lucide-vue-next';
import SearchableSelect from './SearchableSelect.vue';
import {
  fetchDatabases,
  fetchCurrentConnection,
  fetchTablesForDatabase,
  fetchColumns,
  fetchTableForeignKeys,
  fetchTableRowCount,
  copyToSystemClipboard,
  exportToFile,
  showNotification,
  openTableInBeekeeper,
  isSafeIdentifier,
  type ColumnInfo,
  type ForeignKeyInfo
} from '../services/beekeeper';

export interface TableDocData {
  name: string;
  rowCount?: number;
  columns: ColumnInfo[];
  foreignKeys: ForeignKeyInfo[];
}

const databases = ref<string[]>([]);
const selectedDb = ref('');
const loading = ref(false);
const progressMessage = ref('');
const tablesData = ref<TableDocData[]>([]);
const activeView = ref<'dictionary' | 'markdown'>('dictionary');
const tableFilter = ref('');

const mdCopied = ref(false);

const filteredTables = computed(() => {
  if (!tableFilter.value.trim()) return tablesData.value;
  const q = tableFilter.value.toLowerCase().trim();
  return tablesData.value.filter((t) => t.name.toLowerCase().includes(q));
});

const totalColumnsCount = computed(() =>
  tablesData.value.reduce((acc, t) => acc + t.columns.length, 0)
);

const totalFkCount = computed(() =>
  tablesData.value.reduce((acc, t) => acc + t.foreignKeys.length, 0)
);

function isColPk(tbl: TableDocData, colName: string): boolean {
  const cn = colName.toLowerCase();
  return cn === 'id' || cn === `${tbl.name.toLowerCase()}_id` || cn === `${tbl.name.toLowerCase()}id`;
}

function getColFk(tbl: TableDocData, colName: string): ForeignKeyInfo | undefined {
  return tbl.foreignKeys.find((k) => k.columnName === colName);
}

const markdownDoc = computed(() => {
  if (tablesData.value.length === 0) return '';
  const dateStr = new Date().toISOString().slice(0, 10);
  const lines: string[] = [
    `# 📖 Diccionario de Datos: \`${selectedDb.value}\``,
    ``,
    `> Generado automáticamente el **${dateStr}** mediante **DB Manager Pro para Beekeeper Studio**.`,
    ``,
    `### 📊 Resumen Ejecutivo`,
    `- **Base de Datos:** \`${selectedDb.value}\``,
    `- **Total de Tablas:** ${tablesData.value.length}`,
    `- **Total de Columnas:** ${totalColumnsCount.value}`,
    `- **Total de Relaciones (FKs):** ${totalFkCount.value}`,
    ``,
    `---`,
    ``,
    `## 📑 Catálogo Detallado de Tablas`,
    ``
  ];

  for (const tbl of tablesData.value) {
    lines.push(`### Tabla \`${tbl.name}\``);
    if (tbl.rowCount !== undefined) {
      lines.push(`*Registros estimados: ${tbl.rowCount} filas*`);
    }
    lines.push(``);
    lines.push(`| Columna | Tipo | Clave / Relación |`);
    lines.push(`| :--- | :--- | :--- |`);

    for (const col of tbl.columns) {
      const pk = isColPk(tbl, col.name);
      const fk = getColFk(tbl, col.name);
      let note = '-';
      if (pk) note = '**PK (Primary Key)**';
      else if (fk) note = `FK ➔ \`${fk.referencedTable}.${fk.referencedColumn}\``;

      lines.push(`| \`${col.name}\` | \`${col.type || 'varchar'}\` | ${note} |`);
    }

    lines.push(``);
  }

  return lines.join('\n');
});

async function onDbChange() {
  tablesData.value = [];
  if (selectedDb.value) {
    await loadDictionary();
  }
}

async function loadDictionary() {
  if (!selectedDb.value) return;
  loading.value = true;
  progressMessage.value = 'Obteniendo lista de tablas...';
  tablesData.value = [];

  try {
    const rawTables = await fetchTablesForDatabase(selectedDb.value);
    const names = rawTables.map((t) => t.name).filter(Boolean);

    const results: TableDocData[] = [];
    for (let i = 0; i < names.length; i++) {
      const name = names[i];
      progressMessage.value = `Inspeccionando tabla ${i + 1}/${names.length}: ${name}`;

      const [cols, fks, count] = await Promise.all([
        fetchColumns(name, selectedDb.value),
        fetchTableForeignKeys(name, selectedDb.value),
        fetchTableRowCount(name, selectedDb.value)
      ]);

      results.push({
        name,
        columns: cols,
        foreignKeys: fks,
        rowCount: count
      });
    }

    tablesData.value = results;
    showNotification(`✔ Diccionario de datos generado para ${results.length} tablas.`, 'success');
  } catch (err: any) {
    showNotification(`Error al generar diccionario: ${err.message}`, 'error');
  } finally {
    loading.value = false;
    progressMessage.value = '';
  }
}


async function copyMarkdown() {
  if (!markdownDoc.value) return;
  const ok = await copyToSystemClipboard(markdownDoc.value);
  if (ok) {
    mdCopied.value = true;
    setTimeout(() => {
      mdCopied.value = false;
    }, 2000);
  }
}

async function exportMarkdownDoc() {
  if (!markdownDoc.value) return;
  const fileName = `DATA_DICTIONARY_${selectedDb.value || 'database'}.md`;
  const saved = await exportToFile(markdownDoc.value, fileName, [
    { name: 'Markdown Document (*.md)', extensions: ['md'] }
  ]);
  if (saved) {
    showNotification(`Documento ${fileName} exportado con éxito.`, 'success');
  }
}

async function openTableNative(tableName: string) {
  if (!isSafeIdentifier(tableName)) return;
  await openTableInBeekeeper(tableName, undefined, selectedDb.value);
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
      await loadDictionary();
    }
  } catch (e) {
    console.warn('Error loading initial databases in DataDictionaryTab:', e);
  }
});
</script>

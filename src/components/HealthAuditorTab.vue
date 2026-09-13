<template>
  <div class="space-y-6">
    <!-- Top banner -->
    <div class="p-5 rounded-xl bg-slate-900/50 border border-white/[0.08] shadow-sm">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-2">
          <Activity class="w-5 h-5 text-emerald-400" />
          <h2 class="text-base font-semibold text-white">Auditor de Salud & Rendimiento</h2>
        </div>
        <div class="inline-flex rounded-lg bg-slate-950 p-0.5 border border-white/[0.08]">
          <button
            type="button"
            @click="activeSubTab = 'health'"
            class="px-3 py-1 text-xs rounded-md font-medium transition cursor-pointer flex items-center gap-1.5"
            :class="activeSubTab === 'health' ? 'bg-emerald-600 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'"
          >
            <HeartPulse class="w-3.5 h-3.5" />
            <span>Diagnóstico & Salud</span>
          </button>
          <button
            type="button"
            @click="activeSubTab = 'processlist'; loadProcesslist()"
            class="px-3 py-1 text-xs rounded-md font-medium transition cursor-pointer flex items-center gap-1.5"
            :class="activeSubTab === 'processlist' ? 'bg-sky-600 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'"
          >
            <Cpu class="w-3.5 h-3.5" />
            <span>Monitor de Procesos</span>
            <span v-if="processes.length > 0" class="px-1.5 py-0.2 rounded-full bg-sky-400/20 text-sky-300 text-[10px]">
              {{ processes.length }}
            </span>
          </button>
        </div>
      </div>
      <p class="text-xs text-slate-400 mt-1">
        Inspecciona cuellos de botella: detecta tablas sin Primary Key, índices redundantes o duplicados que ralentizan escrituras, desglose de almacenamiento y monitor de procesos activos con terminación segura de consultas.
      </p>
    </div>

    <!-- Health Diagnostics View -->
    <div v-if="activeSubTab === 'health'" class="space-y-6">
      <!-- Database & Controls Selector -->
      <div class="p-4 rounded-xl bg-slate-900/40 border border-white/[0.06] flex flex-wrap items-center justify-between gap-4">
        <div class="flex items-center gap-3 flex-1 min-w-[280px]">
          <label class="text-xs font-medium text-slate-300 whitespace-nowrap">Base de Datos:</label>
          <div class="flex-1">
            <SearchableSelect
              v-model="selectedDb"
              :options="databases"
              :allow-custom="false"
              placeholder="Selecciona o busca base de datos..."
            />
          </div>
        </div>

        <div class="flex items-center gap-3">
          <div class="inline-flex rounded-lg bg-slate-950 p-0.5 border border-white/[0.08]">
            <button
              type="button"
              @click="dialect = 'mysql'"
              class="px-2.5 py-1 text-xs rounded-md font-medium transition cursor-pointer"
              :class="dialect === 'mysql' ? 'bg-sky-600 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'"
            >
              MySQL / MariaDB
            </button>
            <button
              type="button"
              @click="dialect = 'postgres'"
              class="px-2.5 py-1 text-xs rounded-md font-medium transition cursor-pointer"
              :class="dialect === 'postgres' ? 'bg-sky-600 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'"
            >
              PostgreSQL
            </button>
          </div>

          <button
            @click="runAudit"
            :disabled="loadingAudit || !selectedDb"
            class="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-medium rounded-lg text-xs flex items-center gap-2 shadow-sm transition cursor-pointer active:scale-[0.98]"
          >
            <RefreshCw class="w-3.5 h-3.5" :class="loadingAudit ? 'animate-spin' : ''" />
            <span>{{ loadingAudit ? 'Auditando...' : 'Ejecutar Diagnóstico' }}</span>
          </button>
        </div>
      </div>

      <!-- Audit Results -->
      <div v-if="healthReport" class="space-y-6">
        <!-- Score and Metrics Grid -->
        <div class="grid grid-cols-1 md:grid-cols-4 gap-4">
          <!-- Score Card -->
          <div class="p-4 rounded-xl border flex flex-col items-center justify-center text-center shadow-sm" :class="scoreCardColor">
            <div class="text-3xl font-extrabold font-mono tracking-tight">{{ healthReport.score }} / 100</div>
            <div class="text-xs font-semibold uppercase tracking-wider mt-1">{{ scoreLabel }}</div>
            <div class="text-[11px] opacity-80 mt-0.5">Puntaje Global de Salud</div>
          </div>

          <!-- Total Tables -->
          <div class="p-4 rounded-xl bg-slate-900/50 border border-white/[0.08] text-center shadow-sm">
            <div class="text-2xl font-bold text-white font-mono">{{ healthReport.summary.totalTables }}</div>
            <div class="text-xs text-slate-300 mt-1 font-medium">Tablas Analizadas</div>
            <div class="text-[11px] text-slate-500 mt-0.5">{{ healthReport.totalSizeMb }} MB Totales</div>
          </div>

          <!-- Tables without PK -->
          <div
            class="p-4 rounded-xl border text-center shadow-sm"
            :class="healthReport.tablesWithoutPk.length > 0 ? 'bg-rose-500/10 border-rose-500/30 text-rose-300' : 'bg-slate-900/50 border-white/[0.08] text-slate-300'"
          >
            <div class="text-2xl font-bold font-mono" :class="healthReport.tablesWithoutPk.length > 0 ? 'text-rose-400' : 'text-emerald-400'">
              {{ healthReport.tablesWithoutPk.length }}
            </div>
            <div class="text-xs mt-1 font-medium">Tablas Sin Primary Key</div>
            <div class="text-[11px] opacity-75 mt-0.5">
              {{ healthReport.tablesWithoutPk.length > 0 ? 'Riesgo alto de replicación' : 'Óptimo' }}
            </div>
          </div>

          <!-- Duplicate Indexes -->
          <div
            class="p-4 rounded-xl border text-center shadow-sm"
            :class="healthReport.duplicateIndexes.length > 0 ? 'bg-amber-500/10 border-amber-500/30 text-amber-300' : 'bg-slate-900/50 border-white/[0.08] text-slate-300'"
          >
            <div class="text-2xl font-bold font-mono" :class="healthReport.duplicateIndexes.length > 0 ? 'text-amber-400' : 'text-emerald-400'">
              {{ healthReport.duplicateIndexes.length }}
            </div>
            <div class="text-xs mt-1 font-medium">Índices Redundantes</div>
            <div class="text-[11px] opacity-75 mt-0.5">
              {{ healthReport.duplicateIndexes.length > 0 ? 'Sobrecarga de escrituras' : 'Limpio' }}
            </div>
          </div>
        </div>

        <!-- Tables without PK Warning -->
        <div v-if="healthReport.tablesWithoutPk.length > 0" class="p-5 rounded-xl bg-rose-500/10 border border-rose-500/30 space-y-3">
          <div class="flex items-center gap-2">
            <ShieldAlert class="w-4 h-4 text-rose-400" />
            <h3 class="text-xs font-semibold uppercase tracking-wider text-rose-300">Tablas sin Clave Primaria Detectadas</h3>
          </div>
          <p class="text-xs text-rose-200/90 leading-relaxed">
            Las tablas sin Primary Key causan escaneos de tabla completa en actualizaciones/borrados e impiden la replicación eficiente por filas (RBR) en MySQL. Se recomienda agregar una clave primaria sintética (e.g. <code>id BIGINT AUTO_INCREMENT PRIMARY KEY</code>).
          </p>
          <div class="flex flex-wrap gap-2 pt-1">
            <span
              v-for="tbl in healthReport.tablesWithoutPk"
              :key="'no-pk-' + tbl"
              class="px-2.5 py-1 rounded bg-rose-950/70 border border-rose-500/40 text-xs font-mono text-rose-200"
            >
              {{ tbl }}
            </span>
          </div>
        </div>

        <!-- Duplicate / Redundant Indexes Warning -->
        <div v-if="healthReport.duplicateIndexes.length > 0" class="p-5 rounded-xl bg-amber-500/10 border border-amber-500/30 space-y-3">
          <div class="flex items-center gap-2">
            <AlertTriangle class="w-4 h-4 text-amber-400" />
            <h3 class="text-xs font-semibold uppercase tracking-wider text-amber-300">Índices Redundantes o Duplicados</h3>
          </div>
          <p class="text-xs text-amber-200/90 leading-relaxed">
            Los siguientes índices duplican columnas o son prefijos de índices existentes, consumiendo memoria RAM en búferes de InnoDB y ralentizando las operaciones <code>INSERT</code> y <code>UPDATE</code> sin aportar beneficio a las lecturas.
          </p>
          <div class="space-y-2">
            <div
              v-for="(dup, i) in healthReport.duplicateIndexes"
              :key="'dup-idx-' + i"
              class="p-3 rounded-lg bg-slate-950/80 border border-amber-500/20 flex flex-wrap items-center justify-between gap-2 text-xs"
            >
              <div>
                <span class="text-slate-300 font-semibold font-mono">{{ dup.table }}</span>:
                <span class="text-amber-300 font-mono font-medium">{{ dup.index1 }}</span> vs
                <span class="text-slate-400 font-mono">{{ dup.index2 }}</span>
                <span class="text-slate-400 ml-2">({{ dup.columns }})</span>
                <div class="text-[11px] text-amber-400/80 mt-0.5">{{ dup.reason }}</div>
              </div>
            </div>
          </div>
        </div>

        <!-- Storage Breakdown Table -->
        <div class="p-5 rounded-xl bg-slate-900/50 border border-white/[0.08] space-y-4 shadow-sm">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-2">
              <HardDrive class="w-4 h-4 text-sky-400" />
              <h3 class="text-xs font-semibold uppercase tracking-wider text-slate-200">Consumo de Almacenamiento por Tabla</h3>
            </div>
            <span class="text-xs text-slate-400 font-mono">Total: {{ healthReport.totalSizeMb }} MB</span>
          </div>

          <div class="overflow-x-auto rounded-lg border border-white/[0.06]">
            <table class="w-full text-left text-xs">
              <thead class="bg-slate-950 text-slate-400 uppercase text-[10px] tracking-wider border-b border-white/[0.06]">
                <tr>
                  <th class="px-4 py-2.5 font-medium">Tabla</th>
                  <th class="px-4 py-2.5 font-medium text-right">Filas Aprox.</th>
                  <th class="px-4 py-2.5 font-medium text-right">Datos (MB)</th>
                  <th class="px-4 py-2.5 font-medium text-right">Índices (MB)</th>
                  <th class="px-4 py-2.5 font-medium text-right">Total (MB)</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-white/[0.04] text-slate-300 font-mono">
                <tr
                  v-for="st in healthReport.storageBreakdown"
                  :key="'st-' + st.table"
                  class="hover:bg-white/[0.02] transition"
                >
                  <td class="px-4 py-2 font-medium text-white flex items-center gap-2">
                    <span>{{ st.table }}</span>
                    <span v-if="healthReport.tablesWithoutPk.includes(st.table)" class="px-1.5 py-0.2 rounded bg-rose-500/20 text-rose-300 text-[10px]">Sin PK</span>
                  </td>
                  <td class="px-4 py-2 text-right text-slate-400">{{ st.rows.toLocaleString() }}</td>
                  <td class="px-4 py-2 text-right">{{ st.dataSizeMb }} MB</td>
                  <td class="px-4 py-2 text-right text-sky-300">{{ st.indexSizeMb }} MB</td>
                  <td class="px-4 py-2 text-right font-bold text-emerald-400">{{ st.totalSizeMb }} MB</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>

    <!-- Active Processlist Monitor View -->
    <div v-else class="space-y-4">
      <div class="flex items-center justify-between p-4 rounded-xl bg-slate-900/40 border border-white/[0.06]">
        <div class="flex items-center gap-3">
          <span class="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse"></span>
          <span class="text-xs font-semibold text-slate-200">Consultas & Threads en Ejecución</span>
          <span class="text-xs text-slate-400 font-mono">({{ processes.length }} activos)</span>
        </div>

        <div class="flex items-center gap-2.5">
          <button
            @click="loadProcesslist"
            :disabled="loadingProcesses"
            class="px-3.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-medium flex items-center gap-1.5 transition cursor-pointer border border-white/[0.08]"
          >
            <RefreshCw class="w-3.5 h-3.5" :class="loadingProcesses ? 'animate-spin' : ''" />
            <span>Refrescar</span>
          </button>
        </div>
      </div>

      <!-- Process List Table -->
      <div class="rounded-xl bg-slate-900/50 border border-white/[0.08] overflow-hidden shadow-sm">
        <div v-if="processes.length === 0" class="p-8 text-center text-xs text-slate-400">
          No hay consultas lentas ni procesos bloqueados activos en el motor.
        </div>
        <div v-else class="overflow-x-auto">
          <table class="w-full text-left text-xs">
            <thead class="bg-slate-950 text-slate-400 uppercase text-[10px] tracking-wider border-b border-white/[0.06]">
              <tr>
                <th class="px-4 py-2.5 font-medium">ID</th>
                <th class="px-4 py-2.5 font-medium">Usuario / Host</th>
                <th class="px-4 py-2.5 font-medium">BD</th>
                <th class="px-4 py-2.5 font-medium">Comando / Estado</th>
                <th class="px-4 py-2.5 font-medium text-right">Tiempo (s)</th>
                <th class="px-4 py-2.5 font-medium">Consulta SQL</th>
                <th class="px-4 py-2.5 font-medium text-center">Acción</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-white/[0.04] text-slate-300 font-mono">
              <tr
                v-for="p in processes"
                :key="'proc-' + p.id"
                class="hover:bg-white/[0.02] transition"
                :class="p.time > 30 ? 'bg-rose-500/5' : ''"
              >
                <td class="px-4 py-2.5 font-semibold text-white">{{ p.id }}</td>
                <td class="px-4 py-2.5 text-slate-400">
                  <div class="text-slate-200">{{ p.user }}</div>
                  <div class="text-[10px] text-slate-500 truncate max-w-[120px]">{{ p.host }}</div>
                </td>
                <td class="px-4 py-2.5 text-slate-300">{{ p.db || '-' }}</td>
                <td class="px-4 py-2.5">
                  <span class="text-slate-200 font-medium">{{ p.command }}</span>
                  <div v-if="p.state" class="text-[10px] text-slate-400">{{ p.state }}</div>
                </td>
                <td class="px-4 py-2.5 text-right font-bold" :class="p.time > 30 ? 'text-rose-400' : (p.time > 5 ? 'text-amber-400' : 'text-emerald-400')">
                  {{ p.time }}s
                </td>
                <td class="px-4 py-2.5 max-w-[320px]">
                  <div class="truncate text-slate-300 font-mono text-[11px]" :title="p.info || '-'">
                    {{ p.info || '-' }}
                  </div>
                </td>
                <td class="px-4 py-2.5 text-center">
                  <button
                    @click="confirmKill(p)"
                    class="px-2.5 py-1 bg-rose-600/20 hover:bg-rose-600 text-rose-300 hover:text-white rounded border border-rose-500/30 text-[11px] font-medium transition cursor-pointer"
                    title="Detener consulta (KILL QUERY)"
                  >
                    Detener
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- Confirm Kill Modal -->
    <div
      v-if="processToKill"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
    >
      <div class="bg-slate-900 border border-white/[0.1] rounded-xl p-6 max-w-md w-full space-y-4 shadow-xl text-left">
        <div class="flex items-center gap-2 text-rose-400">
          <ShieldAlert class="w-5 h-5" />
          <h3 class="text-base font-semibold text-white">¿Detener Consulta / Proceso?</h3>
        </div>
        <p class="text-xs text-slate-300 leading-relaxed">
          Estás a punto de ejecutar <code>KILL QUERY {{ processToKill.id }}</code>. Esto abortará la consulta actual sin desconectar al cliente.
        </p>
        <div class="p-3 bg-slate-950 rounded-lg border border-white/[0.06] text-xs font-mono text-slate-300 space-y-1">
          <div><span class="text-slate-500">ID:</span> {{ processToKill.id }}</div>
          <div><span class="text-slate-500">Usuario:</span> {{ processToKill.user }}</div>
          <div><span class="text-slate-500">Tiempo:</span> {{ processToKill.time }}s</div>
          <div class="truncate"><span class="text-slate-500">Query:</span> {{ processToKill.info || 'N/A' }}</div>
        </div>
        <div class="flex items-center justify-end gap-2.5 pt-2">
          <button
            @click="processToKill = null"
            class="px-3.5 py-1.5 text-xs text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 rounded-lg transition cursor-pointer"
          >
            Cancelar
          </button>
          <button
            @click="executeKill"
            :disabled="killing"
            class="px-4 py-1.5 text-xs font-medium text-white bg-rose-600 hover:bg-rose-500 disabled:opacity-50 rounded-lg transition cursor-pointer flex items-center gap-1.5"
          >
            <RefreshCw v-if="killing" class="w-3.5 h-3.5 animate-spin" />
            <span>{{ killing ? 'Deteniendo...' : 'Confirmar y Detener' }}</span>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import {
  Activity,
  HeartPulse,
  Cpu,
  RefreshCw,
  AlertTriangle,
  ShieldAlert,
  HardDrive
} from 'lucide-vue-next';
import {
  fetchDatabases,
  fetchCurrentConnection,
  showNotification
} from '../services/beekeeper';
import {
  auditHealth,
  fetchProcesslist,
  killProcess,
  type HealthReport,
  type ProcessItem
} from '../services/healthAuditor';
import SearchableSelect from './SearchableSelect.vue';

const activeSubTab = ref<'health' | 'processlist'>('health');
const databases = ref<string[]>([]);
const selectedDb = ref('');
const dialect = ref<'mysql' | 'postgres'>('mysql');

const loadingAudit = ref(false);
const healthReport = ref<HealthReport | null>(null);

const processes = ref<ProcessItem[]>([]);
const loadingProcesses = ref(false);
const processToKill = ref<ProcessItem | null>(null);
const killing = ref(false);

const scoreLabel = computed(() => {
  if (!healthReport.value) return '';
  const s = healthReport.value.score;
  if (s >= 90) return 'Excelente';
  if (s >= 70) return 'Aceptable';
  return 'Crítico';
});

const scoreCardColor = computed(() => {
  if (!healthReport.value) return 'bg-slate-900/50 border-white/[0.08] text-white';
  const s = healthReport.value.score;
  if (s >= 90) return 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400';
  if (s >= 70) return 'bg-amber-500/10 border-amber-500/30 text-amber-400';
  return 'bg-rose-500/10 border-rose-500/30 text-rose-400';
});

async function runAudit() {
  if (!selectedDb.value) return;
  loadingAudit.value = true;
  try {
    healthReport.value = await auditHealth(selectedDb.value, dialect.value);
  } catch (err: any) {
    showNotification(err.message || 'Error al ejecutar diagnóstico', 'error');
  } finally {
    loadingAudit.value = false;
  }
}

async function loadProcesslist() {
  loadingProcesses.value = true;
  try {
    processes.value = await fetchProcesslist(dialect.value);
  } catch (err: any) {
    showNotification(err.message || 'Error al cargar lista de procesos', 'warning');
  } finally {
    loadingProcesses.value = false;
  }
}

function confirmKill(proc: ProcessItem) {
  processToKill.value = proc;
}

async function executeKill() {
  if (!processToKill.value) return;
  killing.value = true;
  try {
    const res = await killProcess(processToKill.value.id, dialect.value);
    showNotification(res.message, 'success');
    processToKill.value = null;
    await loadProcesslist();
  } catch (err: any) {
    showNotification(err.message || 'Error al detener proceso', 'error');
  } finally {
    killing.value = false;
  }
}

onMounted(async () => {
  try {
    const current = await fetchCurrentConnection();
    if (current?.databaseType?.toLowerCase().includes('postgres')) {
      dialect.value = 'postgres';
    }
    const dbs = await fetchDatabases();
    databases.value = dbs;
    if (current?.databaseName && dbs.includes(current.databaseName)) {
      selectedDb.value = current.databaseName;
    } else if (dbs.length > 0) {
      selectedDb.value = dbs[0];
    }

    if (selectedDb.value) {
      await runAudit();
    }
  } catch (err) {
    console.warn('Error on HealthAuditorTab mount:', err);
  }
});
</script>

<template>
  <div class="space-y-6">
    <!-- Top banner -->
    <div class="p-5 rounded-xl bg-slate-900/50 border border-white/[0.08] flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-sm">
      <div>
        <div class="flex items-center gap-2">
          <Archive class="w-5 h-5 text-sky-400" />
          <h2 class="text-base font-semibold text-white">Snapshots & Backups Rápidos</h2>
          <span
            v-if="companionActive"
            class="px-2 py-0.5 rounded text-[10px] font-mono bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center gap-1"
          >
            <Zap class="w-2.5 h-2.5" /> Turbo (Zstd)
          </span>
          <span
            v-else
            class="px-2 py-0.5 rounded text-[10px] font-mono bg-amber-500/10 text-amber-400 border border-amber-500/20"
          >
            Modo Nativo
          </span>
        </div>
        <p class="text-xs text-slate-400 mt-1">
          Respaldos instantáneos al vuelo con compresión Zstandard / Gzip antes de migraciones o cambios destructivos, con restauración protegida en 1 clic.
        </p>
      </div>

      <div class="flex items-center gap-2">
        <button
          @click="loadSnapshots"
          :disabled="loading"
          class="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium rounded-lg flex items-center gap-1.5 transition cursor-pointer border border-white/[0.08]"
          title="Refrescar lista de snapshots"
        >
          <RefreshCw class="w-3.5 h-3.5" :class="loading ? 'animate-spin' : ''" />
          <span>Actualizar</span>
        </button>

        <button
          @click="handleCreateSnapshot"
          :disabled="creating || !selectedDb"
          class="px-4 py-2 bg-sky-600 hover:bg-sky-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-medium rounded-lg flex items-center gap-2 shadow-sm transition cursor-pointer active:scale-[0.98]"
        >
          <Archive class="w-3.5 h-3.5" :class="creating ? 'animate-pulse' : ''" />
          <span>{{ creating ? 'Creando Snapshot...' : 'Tomar Snapshot Rápido' }}</span>
        </button>
      </div>
    </div>

    <!-- Database Selector & Options -->
    <div class="p-5 rounded-xl bg-slate-900/50 border border-white/[0.08] space-y-4 shadow-sm">
      <div class="grid grid-cols-1 md:grid-cols-3 gap-4 items-center">
        <div>
          <label class="block text-xs font-medium text-slate-400 mb-1.5">Base de Datos a Respaldar</label>
          <SearchableSelect
            v-model="selectedDb"
            :options="databases"
            :allow-custom="false"
            placeholder="Selecciona una base de datos..."
          />
        </div>

        <div>
          <label class="block text-xs font-medium text-slate-400 mb-1.5">Método de Compresión</label>
          <select
            v-model="compressionFormat"
            class="w-full bg-slate-950 border border-white/[0.1] rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-sky-500"
          >
            <option value="zstd">Zstandard (.sql.zst) - Máxima velocidad y ratio</option>
            <option value="gzip">Gzip (.sql.gz) - Estándar universal</option>
            <option value="none">Sin compresión (.sql) - Texto plano</option>
          </select>
        </div>

        <div class="flex items-center gap-3 md:justify-end pt-2 md:pt-0">
          <div class="px-3.5 py-2 rounded-lg bg-slate-950/70 border border-white/[0.06] text-center min-w-[100px]">
            <div class="text-lg font-bold text-sky-400 font-mono">{{ snapshots.length }}</div>
            <div class="text-[10px] text-slate-400 uppercase font-medium">Snapshots</div>
          </div>
          <div class="px-3.5 py-2 rounded-lg bg-slate-950/70 border border-white/[0.06] text-center min-w-[100px]">
            <div class="text-lg font-bold text-emerald-400 font-mono">{{ formatBytes(totalBytes) }}</div>
            <div class="text-[10px] text-slate-400 uppercase font-medium">Espacio en Disco</div>
          </div>
        </div>
      </div>
    </div>

    <!-- Progress Notification Bar -->
    <div v-if="statusMessage" class="p-3 bg-sky-950/40 border border-sky-500/30 rounded-lg flex items-center gap-2 text-xs text-sky-300 font-mono">
      <RefreshCw class="w-3.5 h-3.5 animate-spin text-sky-400" />
      <span>{{ statusMessage }}</span>
    </div>

    <!-- Snapshots List Section -->
    <div class="space-y-3">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-3">
          <input
            v-model="searchFilter"
            type="text"
            placeholder="Filtrar por base de datos o archivo..."
            class="w-64 bg-slate-900 border border-white/[0.1] rounded-lg px-3 py-1.5 text-xs text-slate-200 font-mono focus:outline-none focus:border-sky-500"
          />
          <span class="text-xs text-slate-500 font-mono">
            Mostrando {{ filteredSnapshots.length }} de {{ snapshots.length }}
          </span>
        </div>

        <span v-if="backupDirectory" class="text-[11px] text-slate-500 font-mono hidden sm:inline truncate max-w-sm" :title="backupDirectory">
          Carpeta: {{ backupDirectory }}
        </span>
      </div>

      <!-- Snapshots Table -->
      <div v-if="filteredSnapshots.length > 0" class="overflow-x-auto border border-white/[0.08] rounded-xl bg-slate-900/40 shadow-sm">
        <table class="w-full text-xs text-left font-mono">
          <thead class="bg-slate-950/80 text-slate-400 uppercase text-[10px] border-b border-white/[0.06]">
            <tr>
              <th class="p-3">Base de Datos</th>
              <th class="p-3">Archivo</th>
              <th class="p-3">Formato</th>
              <th class="p-3">Tamaño</th>
              <th class="p-3">Fecha de Creación</th>
              <th class="p-3 text-right">Acciones</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-white/[0.04]">
            <tr
              v-for="s in filteredSnapshots"
              :key="s.filename"
              class="hover:bg-slate-800/30 transition text-slate-300"
            >
              <td class="p-3 font-semibold text-white flex items-center gap-2">
                <Database class="w-3.5 h-3.5 text-sky-400 shrink-0" />
                <span>{{ s.database }}</span>
              </td>
              <td class="p-3 text-slate-400 font-mono text-[11px] truncate max-w-xs" :title="s.filename">
                {{ s.filename }}
              </td>
              <td class="p-3">
                <span
                  :class="[
                    s.format === 'zstd' ? 'bg-purple-500/15 text-purple-300 border-purple-500/30' :
                    s.format === 'gzip' ? 'bg-sky-500/15 text-sky-300 border-sky-500/30' :
                    'bg-amber-500/15 text-amber-300 border-amber-500/30'
                  ]"
                  class="px-2 py-0.5 rounded text-[10px] uppercase font-bold border font-mono"
                >
                  {{ s.format }}
                </span>
              </td>
              <td class="p-3 font-mono text-emerald-400">
                {{ formatBytes(s.sizeBytes) }}
              </td>
              <td class="p-3 text-slate-400 text-[11px]">
                {{ formatDate(s.mtime) }}
              </td>
              <td class="p-3 text-right">
                <div class="flex items-center justify-end gap-1.5">
                  <button
                    @click="openRestoreModal(s)"
                    class="px-2.5 py-1 bg-emerald-950/60 hover:bg-emerald-900/80 text-emerald-300 border border-emerald-500/30 rounded text-[11px] font-medium transition cursor-pointer flex items-center gap-1"
                    title="Restaurar este snapshot en una base de datos"
                  >
                    <RotateCcw class="w-3 h-3" />
                    <span>Restaurar</span>
                  </button>

                  <button
                    @click="handleDeleteSnapshot(s)"
                    class="p-1 hover:bg-red-500/20 text-slate-500 hover:text-red-400 rounded transition cursor-pointer"
                    title="Eliminar snapshot"
                  >
                    <Trash2 class="w-3.5 h-3.5" />
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Empty State -->
      <div v-else class="p-12 text-center bg-slate-900/30 rounded-xl border border-dashed border-white/[0.08] space-y-2">
        <Archive class="w-8 h-8 text-slate-600 mx-auto" />
        <p class="text-xs text-slate-400">No hay snapshots disponibles en la carpeta de trabajo.</p>
        <p class="text-[11px] text-slate-500">Selecciona una base de datos y pulsa "Tomar Snapshot Rápido" para generar tu primer respaldo comprimido.</p>
      </div>
    </div>

    <!-- Restore Confirmation Modal -->
    <div
      v-if="showRestoreModal"
      class="fixed inset-0 bg-black/70 backdrop-blur-xs flex items-center justify-center z-50 p-4"
    >
      <div class="bg-slate-900 border border-white/[0.1] rounded-xl max-w-md w-full p-6 space-y-4 shadow-xl">
        <div class="flex items-center gap-2.5 text-amber-400">
          <AlertTriangle class="w-5 h-5 shrink-0" />
          <h3 class="text-sm font-semibold text-white">Confirmar Restauración de Snapshot</h3>
        </div>

        <div class="space-y-2 text-xs text-slate-300">
          <p>
            Vas a restaurar el snapshot <strong class="text-white font-mono">{{ activeSnapshot?.filename }}</strong>.
          </p>
          <div class="p-3 bg-red-950/30 border border-red-500/20 rounded-lg text-red-300 text-[11px] leading-relaxed">
            ⚠️ <strong>Precaución:</strong> Esta acción importará las tablas y datos del snapshot en la base de datos destino, sobreescribiendo los registros existentes.
          </div>
        </div>

        <div>
          <label class="block text-xs font-medium text-slate-400 mb-1.5">Base de Datos Destino</label>
          <SearchableSelect
            v-model="restoreTargetDb"
            :options="databases"
            :allow-custom="true"
            placeholder="Selecciona o escribe la BD destino..."
          />
        </div>

        <div class="flex items-center justify-end gap-2 pt-2 border-t border-white/[0.06]">
          <button
            @click="showRestoreModal = false"
            :disabled="restoring"
            class="px-3.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs font-medium transition cursor-pointer"
          >
            Cancelar
          </button>
          <button
            @click="executeRestore"
            :disabled="restoring || !restoreTargetDb"
            class="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white rounded-lg text-xs font-medium flex items-center gap-1.5 transition cursor-pointer"
          >
            <RefreshCw v-if="restoring" class="w-3 h-3 animate-spin" />
            <span>{{ restoring ? 'Restaurando...' : 'Confirmar y Restaurar' }}</span>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import {
  Archive,
  RefreshCw,
  Database,
  RotateCcw,
  Trash2,
  AlertTriangle,
  Zap
} from 'lucide-vue-next';
import SearchableSelect from './SearchableSelect.vue';
import {
  fetchSnapshots,
  createSnapshot,
  restoreSnapshot,
  deleteSnapshot,
  createNativeSnapshot,
  checkCompanionStatus,
  formatBytes,
  type SnapshotInfo
} from '../services/snapshots';
import {
  fetchDatabases,
  fetchCurrentConnection,
  showNotification,
  confirmAction
} from '../services/beekeeper';

const databases = ref<string[]>([]);
const selectedDb = ref('');
const compressionFormat = ref<'zstd' | 'gzip' | 'none'>('zstd');

const snapshots = ref<SnapshotInfo[]>([]);
const backupDirectory = ref('');
const loading = ref(false);
const creating = ref(false);
const restoring = ref(false);
const statusMessage = ref('');
const companionActive = ref(false);
const searchFilter = ref('');

const showRestoreModal = ref(false);
const activeSnapshot = ref<SnapshotInfo | null>(null);
const restoreTargetDb = ref('');

const filteredSnapshots = computed(() => {
  if (!searchFilter.value.trim()) return snapshots.value;
  const q = searchFilter.value.toLowerCase().trim();
  return snapshots.value.filter(
    (s) => s.database.toLowerCase().includes(q) || s.filename.toLowerCase().includes(q)
  );
});

const totalBytes = computed(() =>
  snapshots.value.reduce((acc, s) => acc + (s.sizeBytes || 0), 0)
);

function formatDate(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    return d.toLocaleString();
  } catch {
    return dateStr;
  }
}

async function loadSnapshots() {
  loading.value = true;
  try {
    companionActive.value = await checkCompanionStatus();
    if (companionActive.value) {
      const res = await fetchSnapshots();
      if (res.ok) {
        snapshots.value = res.backups || [];
        backupDirectory.value = res.backupDir || '';
      }
    }
  } catch (err: any) {
    console.warn('Error loading snapshots:', err);
  } finally {
    loading.value = false;
  }
}

async function handleCreateSnapshot() {
  if (!selectedDb.value) {
    showNotification('Selecciona una base de datos primero.', 'warning');
    return;
  }

  creating.value = true;
  statusMessage.value = `Tomando snapshot de ${selectedDb.value}...`;

  try {
    if (companionActive.value) {
      const current = await fetchCurrentConnection();
      const res = await createSnapshot({
        database: selectedDb.value,
        motor: current?.databaseType || 'mysql',
        compressWith: compressionFormat.value
      });

      if (res.ok && res.snapshot) {
        showNotification(`✔ Snapshot creado: ${res.snapshot.filename}`, 'success');
        await loadSnapshots();
      } else {
        throw new Error(res.error || 'Error al generar snapshot.');
      }
    } else {
      // Standalone native mode fallback
      const ok = await createNativeSnapshot(selectedDb.value, (msg) => {
        statusMessage.value = msg;
      });
      if (ok) {
        showNotification(`✔ Snapshot nativo de ${selectedDb.value} completado.`, 'success');
      }
    }
  } catch (err: any) {
    showNotification(`Error: ${err.message}`, 'error');
  } finally {
    creating.value = false;
    statusMessage.value = '';
  }
}

function openRestoreModal(s: SnapshotInfo) {
  activeSnapshot.value = s;
  restoreTargetDb.value = s.database;
  showRestoreModal.value = true;
}

async function executeRestore() {
  if (!activeSnapshot.value || !restoreTargetDb.value) return;

  restoring.value = true;
  statusMessage.value = `Restaurando ${activeSnapshot.value.filename} en ${restoreTargetDb.value}...`;

  try {
    const current = await fetchCurrentConnection();
    const res = await restoreSnapshot({
      filename: activeSnapshot.value.filename,
      database: restoreTargetDb.value,
      motor: current?.databaseType || 'mysql'
    });

    if (res.ok) {
      showNotification(`✔ ${res.message || 'Restauración completada con éxito.'}`, 'success');
      showRestoreModal.value = false;
    } else {
      throw new Error(res.error || 'Error al restaurar snapshot.');
    }
  } catch (err: any) {
    showNotification(`Error en restauración: ${err.message}`, 'error');
  } finally {
    restoring.value = false;
    statusMessage.value = '';
  }
}

async function handleDeleteSnapshot(s: SnapshotInfo) {
  const confirmed = await confirmAction(
    `¿Seguro que deseas eliminar el snapshot ${s.filename}? Esta acción no se puede deshacer.`,
    'Eliminar Snapshot'
  );
  if (!confirmed) return;

  try {
    const res = await deleteSnapshot(s.filename);
    if (res.ok) {
      showNotification(`✔ Snapshot ${s.filename} eliminado.`, 'success');
      await loadSnapshots();
    } else {
      throw new Error(res.error || 'No se pudo eliminar el snapshot.');
    }
  } catch (err: any) {
    showNotification(`Error: ${err.message}`, 'error');
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
    await loadSnapshots();
  } catch (e) {
    console.warn('Error loading initial data in SnapshotsTab:', e);
  }
});
</script>

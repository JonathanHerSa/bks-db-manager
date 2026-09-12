<template>
  <div class="space-y-6">
    <!-- Top banner -->
    <div class="p-5 rounded-xl bg-slate-900/50 border border-white/[0.08] flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-sm">
      <div>
        <div class="flex items-center gap-2">
          <Container class="w-5 h-5 text-sky-400" />
          <h2 class="text-base font-semibold text-white">Auto-Discovery Multimotor</h2>
          <span class="text-[10px] uppercase font-mono px-2 py-0.5 rounded font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            Todos los motores
          </span>
        </div>
        <p class="text-xs text-slate-400 mt-1">
          Detección automática de SQLite (.sqlite, .db), MySQL, MariaDB, PostgreSQL, SQL Server, Redis, MongoDB, ClickHouse y contenedores Docker.
        </p>
      </div>

      <div class="flex items-center gap-2">
        <button
          @click="refreshAll"
          :disabled="loading"
          class="px-3.5 py-1.5 bg-slate-800 hover:bg-slate-700/80 border border-white/[0.1] rounded-lg text-xs font-medium text-slate-200 flex items-center gap-2 transition cursor-pointer active:scale-[0.98]"
        >
          <RefreshCw class="w-3.5 h-3.5 text-sky-400" :class="loading ? 'animate-spin' : ''" />
          <span>{{ loading ? 'Escaneando...' : 'Escanear Todo' }}</span>
        </button>
      </div>
    </div>

    <!-- Engine Filter Bar -->
    <div class="p-3 rounded-xl bg-slate-900/40 border border-white/[0.06] flex items-center gap-1.5 overflow-x-auto">
      <span class="text-xs text-slate-500 flex items-center gap-1.5 px-2 font-medium">
        <Filter class="w-3.5 h-3.5 text-slate-400" /> Filtrar:
      </span>
      <button
        v-for="f in engineFilters"
        :key="f.id"
        @click="selectedEngine = f.id"
        :class="selectedEngine === f.id ? 'bg-sky-500/20 text-sky-300 border-sky-500/40 shadow-sm' : 'bg-slate-900/60 text-slate-400 hover:text-slate-200 border-white/[0.05]'"
        class="text-xs px-2.5 py-1 rounded-lg border transition cursor-pointer font-mono flex items-center gap-1.5 shrink-0"
      >
        <span>{{ f.label }}</span>
        <span class="text-[10px] px-1.5 py-0.2 rounded-full bg-slate-800 text-slate-300 font-semibold">
          {{ f.count }}
        </span>
      </button>
    </div>

    <!-- Section 1: Docker Containers -->
    <div class="p-5 rounded-xl bg-slate-900/50 border border-white/[0.08] space-y-4 shadow-sm">
      <div class="flex items-center justify-between pb-3 border-b border-white/[0.06]">
        <div class="flex items-center gap-2">
          <Server class="w-4 h-4 text-sky-400" />
          <h3 class="text-xs font-semibold uppercase tracking-wider text-slate-200">
            Contenedores Docker Activos ({{ filteredDockerContainers.length }})
          </h3>
        </div>
        <span class="text-[11px] font-mono text-slate-500">docker ps</span>
      </div>

      <div v-if="filteredDockerContainers.length === 0" class="p-8 text-center text-xs text-slate-500 bg-slate-950/40 rounded-lg border border-dashed border-white/[0.08]">
        {{ dockerContainers.length === 0 ? 'No se detectaron contenedores de bases de datos en ejecución.' : 'No hay contenedores que coincidan con el filtro seleccionado.' }}
      </div>

      <div v-else class="grid grid-cols-1 md:grid-cols-2 gap-3.5">
        <div
          v-for="c in filteredDockerContainers"
          :key="c.id"
          class="p-4 rounded-lg bg-slate-950/80 border border-white/[0.08] hover:border-sky-500/40 transition space-y-3"
        >
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-2">
              <span class="w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]"></span>
              <span class="text-xs font-semibold text-white font-mono">{{ c.name }}</span>
            </div>
            <span
              class="text-[10px] uppercase font-mono px-2 py-0.5 rounded font-semibold border"
              :class="getMotorBadgeClass(c.motor)"
            >
              {{ c.label || c.motor }}
            </span>
          </div>

          <div class="text-[11px] text-slate-400 space-y-1 font-mono">
            <div class="flex justify-between">
              <span class="text-slate-500">Imagen:</span>
              <span class="text-slate-300 truncate max-w-[200px]" :title="c.image">{{ c.image }}</span>
            </div>
            <div class="flex justify-between">
              <span class="text-slate-500">Puerto Host:</span>
              <span class="text-sky-400 font-semibold">{{ c.hostPort ? `127.0.0.1:${c.hostPort}` : 'No mapeado' }}</span>
            </div>
            <div class="flex justify-between">
              <span class="text-slate-500">Usuario Sugerido:</span>
              <span class="text-slate-300">{{ c.suggestedUser }}</span>
            </div>
            <div class="flex justify-between">
              <span class="text-slate-500">Estado:</span>
              <span class="text-slate-300 truncate max-w-[200px]">{{ c.status }}</span>
            </div>
          </div>

          <div class="pt-2.5 flex items-center justify-between border-t border-white/[0.06] text-xs">
            <div class="flex items-center gap-1.5">
              <button
                @click="copyDockerHost(c)"
                class="px-2.5 py-1 bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-white rounded border border-white/[0.08] text-[11px] flex items-center gap-1.5 transition cursor-pointer"
                title="Copiar Host:Port"
              >
                <Copy class="w-3 h-3 text-slate-400" />
                <span>Host:Port</span>
              </button>
              <button
                v-if="c.connUrl"
                @click="copyDockerUrl(c)"
                class="px-2.5 py-1 bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-white rounded border border-white/[0.08] text-[11px] flex items-center gap-1.5 transition cursor-pointer"
                title="Copiar Cadena de Conexión"
              >
                <Copy class="w-3 h-3 text-slate-400" />
                <span>URL</span>
              </button>
            </div>

            <div class="flex items-center gap-2">
              <button
                @click="saveDockerConnection(c)"
                :disabled="savingId === c.id"
                class="px-2.5 py-1 bg-sky-600/20 hover:bg-sky-600/30 text-sky-300 rounded border border-sky-500/30 text-[11px] flex items-center gap-1.5 transition cursor-pointer active:scale-[0.98]"
                title="Guardar como conexión en Beekeeper Studio"
              >
                <BookmarkPlus class="w-3 h-3 text-sky-400" />
                <span>Guardar</span>
              </button>

              <span v-if="copiedId === c.id" class="text-[11px] text-emerald-400 font-medium flex items-center gap-1">
                <Check class="w-3 h-3" /> Copiado
              </span>
              <span v-if="savedId === c.id" class="text-[11px] text-sky-400 font-medium flex items-center gap-1">
                <Check class="w-3 h-3" /> En Beekeeper
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Section 2: Local Projects & Databases -->
    <div class="p-5 rounded-xl bg-slate-900/50 border border-white/[0.08] space-y-4 shadow-sm">
      <div class="flex items-center justify-between pb-3 border-b border-white/[0.06]">
        <div class="flex items-center gap-2">
          <FolderGit2 class="w-4 h-4 text-emerald-400" />
          <h3 class="text-xs font-semibold uppercase tracking-wider text-slate-200">
            Proyectos y Archivos Locales ({{ filteredProjects.length }})
          </h3>
        </div>
        <span class="text-[11px] font-mono text-slate-400 truncate max-w-xs" :title="scanPath">
          {{ scanPath }} (profundidad: {{ scanDepth }})
        </span>
      </div>

      <!-- Path & Depth Controls Toolbar -->
      <div class="p-3.5 rounded-lg bg-slate-950/70 border border-white/[0.06] space-y-3">
        <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
          <!-- Folder Path Input -->
          <div class="md:col-span-2 space-y-1.5">
            <div class="flex items-center justify-between">
              <label class="block text-xs font-medium text-slate-400">Carpeta a Explorar</label>
              <div class="flex items-center gap-1">
                <button
                  v-for="preset in pathPresets"
                  :key="preset"
                  @click="setPath(preset)"
                  type="button"
                  :class="scanPath === preset ? 'bg-sky-500/20 text-sky-300 border-sky-500/30' : 'bg-slate-900 text-slate-400 hover:text-slate-200 border-white/[0.06]'"
                  class="text-[10px] px-2 py-0.5 rounded border transition cursor-pointer font-mono"
                >
                  {{ preset }}
                </button>
              </div>
            </div>
            <div class="flex items-center gap-2">
              <input
                v-model="scanPath"
                @keyup.enter="refreshProjects"
                type="text"
                placeholder="Ej: ~/Proyectos, /home/usuario/apps..."
                class="w-full bg-slate-900 border border-white/[0.1] rounded-lg px-3 py-1.5 text-xs text-slate-200 font-mono focus:outline-none focus:ring-2 focus:ring-sky-500/30 focus:border-sky-500 transition"
              />
            </div>
          </div>

          <!-- Depth Selector & Scan Button -->
          <div class="space-y-1.5">
            <label class="block text-xs font-medium text-slate-400">Profundidad</label>
            <div class="flex items-center gap-2">
              <select
                v-model.number="scanDepth"
                class="w-full bg-slate-900 border border-white/[0.1] rounded-lg px-2.5 py-1.5 text-xs text-slate-200 font-mono focus:outline-none focus:border-sky-500 cursor-pointer"
              >
                <option :value="3">Nivel 3 (Rápido)</option>
                <option :value="5">Nivel 5 (Estándar)</option>
                <option :value="7">Nivel 7 (Profundo)</option>
                <option :value="10">Nivel 10 (Ultra Profundo)</option>
              </select>

              <button
                @click="refreshProjects"
                :disabled="loadingProjects"
                type="button"
                class="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white rounded-lg text-xs font-medium flex items-center gap-1.5 transition shrink-0 cursor-pointer shadow-sm active:scale-[0.98]"
              >
                <RefreshCw class="w-3.5 h-3.5" :class="loadingProjects ? 'animate-spin' : ''" />
                <span>{{ loadingProjects ? 'Buscando...' : 'Escanear' }}</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- Empty State -->
      <div v-if="filteredProjects.length === 0" class="p-8 text-center text-xs text-slate-500 bg-slate-950/40 rounded-lg border border-dashed border-white/[0.08]">
        {{ projects.length === 0 ? `No se encontraron bases de datos en ${scanPath} (profundidad ${scanDepth}). Prueba seleccionando otra carpeta o aumentando la profundidad.` : 'No hay proyectos locales que coincidan con el filtro seleccionado.' }}
      </div>

      <!-- Projects Grid -->
      <div v-else class="grid grid-cols-1 md:grid-cols-2 gap-3.5">
        <div
          v-for="p in filteredProjects"
          :key="p.uniqueKey || p.path"
          class="p-4 rounded-lg bg-slate-950/80 border border-white/[0.08] hover:border-emerald-500/40 transition space-y-2.5"
        >
          <!-- Header -->
          <div class="flex items-center justify-between">
            <span class="text-xs font-semibold text-white font-mono flex items-center gap-1.5">
              <HardDrive v-if="p.isLocalFile" class="w-3.5 h-3.5 text-amber-400" />
              <Database v-else class="w-3.5 h-3.5 text-emerald-400" />
              {{ p.name }}
            </span>
            <div class="flex items-center gap-1.5">
              <span v-if="p.fileName" class="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 border border-white/[0.06]">
                {{ p.fileName }}
              </span>
              <span
                class="text-[10px] uppercase font-mono px-2 py-0.5 rounded font-semibold border"
                :class="getMotorBadgeClass(p.motor)"
              >
                {{ p.motor }}
              </span>
            </div>
          </div>

          <!-- Body Info: File-based vs Client-Server -->
          <div v-if="p.isLocalFile || p.motor === 'sqlite' || p.motor === 'duckdb'" class="text-[11px] text-slate-400 space-y-1 font-mono">
            <div class="flex justify-between">
              <span class="text-slate-500">Archivo:</span>
              <span class="text-amber-300 font-semibold">{{ p.database }}</span>
            </div>
            <div class="flex justify-between">
              <span class="text-slate-500">Tamaño:</span>
              <span class="text-slate-300">{{ p.fileSize || 'Vacío / En blanco' }}</span>
            </div>
            <div class="flex justify-between">
              <span class="text-slate-500">Tipo:</span>
              <span class="text-slate-300">Base de datos de archivo</span>
            </div>
            <div class="text-[10px] text-slate-500 truncate pt-1 border-t border-white/[0.04]" :title="p.filePath || p.path">
              {{ p.filePath || p.path }}
            </div>
          </div>

          <div v-else class="text-[11px] text-slate-400 space-y-1 font-mono">
            <div class="flex justify-between">
              <span class="text-slate-500">Base de datos:</span>
              <span class="text-white font-semibold">{{ p.database || 'N/A' }}</span>
            </div>
            <div class="flex justify-between">
              <span class="text-slate-500">Host / Puerto:</span>
              <span class="text-slate-300">{{ p.host }}:{{ p.port || getDefaultPort(p.motor) }}</span>
            </div>
            <div class="flex justify-between">
              <span class="text-slate-500">Usuario:</span>
              <span class="text-slate-300">{{ p.username }}</span>
            </div>
            <div class="text-[10px] text-slate-500 truncate pt-1 border-t border-white/[0.04]" :title="p.path">
              {{ p.path }}
            </div>
          </div>

          <!-- Actions Toolbar -->
          <div class="pt-2 flex items-center justify-between border-t border-white/[0.06] text-xs">
            <div class="flex items-center gap-1.5">
              <!-- SQLite file copy -->
              <button
                v-if="p.isLocalFile || p.motor === 'sqlite' || p.motor === 'duckdb'"
                @click="copySqlitePath(p)"
                class="px-2.5 py-1 bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-white rounded border border-white/[0.08] text-[11px] flex items-center gap-1.5 transition cursor-pointer"
                title="Copiar ruta absoluta del archivo"
              >
                <Copy class="w-3 h-3 text-slate-400" />
                <span>Copiar Ruta</span>
              </button>

              <!-- URL / Config copy -->
              <button
                v-else
                @click="copyProjectConn(p)"
                class="px-2.5 py-1 bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-white rounded border border-white/[0.08] text-[11px] flex items-center gap-1.5 transition cursor-pointer"
                title="Copiar URI de conexión"
              >
                <Copy class="w-3 h-3 text-slate-400" />
                <span>Copiar URL</span>
              </button>

              <button
                @click="copyProjectHostPort(p)"
                class="px-2.5 py-1 bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-white rounded border border-white/[0.08] text-[11px] flex items-center gap-1.5 transition cursor-pointer"
                title="Copiar Host:Port o Ruta"
              >
                <Copy class="w-3 h-3 text-slate-400" />
                <span>{{ p.isLocalFile ? 'URI' : 'Host:Port' }}</span>
              </button>
            </div>

            <div class="flex items-center gap-2">
              <button
                @click="saveProjectConnection(p)"
                :disabled="savingId === (p.uniqueKey || p.path)"
                class="px-2.5 py-1 bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 rounded border border-emerald-500/30 text-[11px] flex items-center gap-1.5 transition cursor-pointer active:scale-[0.98]"
                title="Guardar directamente como conexión en Beekeeper Studio"
              >
                <BookmarkPlus class="w-3 h-3 text-emerald-400" />
                <span>Guardar</span>
              </button>

              <span v-if="copiedId === (p.uniqueKey || p.path)" class="text-[11px] text-emerald-400 font-medium flex items-center gap-1">
                <Check class="w-3 h-3" /> Copiado
              </span>
              <span v-if="savedId === (p.uniqueKey || p.path)" class="text-[11px] text-sky-400 font-medium flex items-center gap-1">
                <Check class="w-3 h-3" /> En Beekeeper
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import {
  Container,
  RefreshCw,
  Server,
  FolderGit2,
  Copy,
  Check,
  BookmarkPlus,
  Database,
  HardDrive,
  Filter
} from 'lucide-vue-next';
import {
  getDockerContainers,
  getDiscoveredProjects,
  saveConnectionToBeekeeper,
  type DockerContainer,
  type DiscoveredProject
} from '../services/companion';
import { copyToSystemClipboard, showNotification } from '../services/beekeeper';
import { getDefaultPort } from '../../shared/dbEngines.js';

const loading = ref(false);
const loadingProjects = ref(false);
const dockerContainers = ref<DockerContainer[]>([]);
const projects = ref<DiscoveredProject[]>([]);
const copiedId = ref<string | null>(null);
const savedId = ref<string | null>(null);
const savingId = ref<string | null>(null);

const scanPath = ref(localStorage.getItem('bks_discovery_path') || '~/Proyectos');
const scanDepth = ref(parseInt(localStorage.getItem('bks_discovery_depth') || '7') || 7);
const pathPresets = ['~/Proyectos', '~/Proyectos/Trabajo', '~/Proyectos/Personal', '~'];

const selectedEngine = ref('all');

function getMotorBadgeClass(motor: string): string {
  const m = (motor || '').toLowerCase();
  if (m === 'mysql') return 'bg-sky-500/10 text-sky-400 border-sky-500/20';
  if (m === 'mariadb') return 'bg-teal-500/10 text-teal-400 border-teal-500/20';
  if (m === 'postgresql' || m === 'pg' || m === 'cockroachdb') return 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20';
  if (m === 'sqlite' || m === 'duckdb') return 'bg-amber-500/10 text-amber-400 border-amber-500/20';
  if (m === 'sqlserver' || m === 'mssql') return 'bg-rose-500/10 text-rose-400 border-rose-500/20';
  if (m === 'redis') return 'bg-red-500/10 text-red-400 border-red-500/20';
  if (m === 'mongodb' || m === 'mongo') return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20';
  if (m === 'clickhouse') return 'bg-orange-500/10 text-orange-400 border-orange-500/20';
  if (m === 'oracle') return 'bg-red-600/10 text-red-400 border-red-600/20';
  if (m === 'cassandra') return 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20';
  return 'bg-purple-500/10 text-purple-400 border-purple-500/20';
}

// Engine filter chips
const engineFilters = computed(() => {
  const counts: Record<string, number> = {
    all: dockerContainers.value.length + projects.value.length,
    mysql: 0,
    postgresql: 0,
    sqlite: 0,
    redis: 0,
    mongodb: 0,
    sqlserver: 0,
    other: 0
  };

  const countItem = (m: string) => {
    const motor = (m || '').toLowerCase();
    if (motor === 'mysql' || motor === 'mariadb' || motor === 'tidb') counts.mysql++;
    else if (motor === 'postgresql' || motor === 'pg' || motor === 'cockroachdb') counts.postgresql++;
    else if (motor === 'sqlite' || motor === 'duckdb') counts.sqlite++;
    else if (motor === 'redis') counts.redis++;
    else if (motor === 'mongodb' || motor === 'mongo') counts.mongodb++;
    else if (motor === 'sqlserver' || motor === 'mssql') counts.sqlserver++;
    else counts.other++;
  };

  dockerContainers.value.forEach(c => countItem(c.motor));
  projects.value.forEach(p => countItem(p.motor));

  return [
    { id: 'all', label: 'Todos', count: counts.all },
    { id: 'mysql', label: 'MySQL / MariaDB', count: counts.mysql },
    { id: 'postgresql', label: 'PostgreSQL', count: counts.postgresql },
    { id: 'sqlite', label: 'SQLite', count: counts.sqlite },
    { id: 'redis', label: 'Redis', count: counts.redis },
    { id: 'mongodb', label: 'MongoDB', count: counts.mongodb },
    { id: 'sqlserver', label: 'SQL Server', count: counts.sqlserver },
    { id: 'other', label: 'Otros', count: counts.other }
  ].filter(f => f.id === 'all' || f.count > 0);
});

function matchesFilter(motor: string): boolean {
  if (selectedEngine.value === 'all') return true;
  const m = (motor || '').toLowerCase();
  if (selectedEngine.value === 'mysql') return m === 'mysql' || m === 'mariadb' || m === 'tidb';
  if (selectedEngine.value === 'postgresql') return m === 'postgresql' || m === 'pg' || m === 'cockroachdb';
  if (selectedEngine.value === 'sqlite') return m === 'sqlite' || m === 'duckdb';
  if (selectedEngine.value === 'redis') return m === 'redis';
  if (selectedEngine.value === 'mongodb') return m === 'mongodb' || m === 'mongo';
  if (selectedEngine.value === 'sqlserver') return m === 'sqlserver' || m === 'mssql';
  if (selectedEngine.value === 'other') {
    return !['mysql', 'mariadb', 'tidb', 'postgresql', 'pg', 'cockroachdb', 'sqlite', 'duckdb', 'redis', 'mongodb', 'mongo', 'sqlserver', 'mssql'].includes(m);
  }
  return true;
}

const filteredDockerContainers = computed(() => {
  return dockerContainers.value.filter(c => matchesFilter(c.motor));
});

const filteredProjects = computed(() => {
  return projects.value.filter(p => matchesFilter(p.motor));
});

function setPath(p: string) {
  scanPath.value = p;
  refreshProjects();
}

async function refreshProjects() {
  loadingProjects.value = true;
  localStorage.setItem('bks_discovery_path', scanPath.value);
  localStorage.setItem('bks_discovery_depth', String(scanDepth.value));
  try {
    projects.value = await getDiscoveredProjects({
      path: scanPath.value,
      depth: scanDepth.value
    });
  } finally {
    loadingProjects.value = false;
  }
}

async function refreshAll() {
  loading.value = true;
  try {
    const [containers, projs] = await Promise.all([
      getDockerContainers(),
      getDiscoveredProjects({
        path: scanPath.value,
        depth: scanDepth.value
      })
    ]);
    dockerContainers.value = containers;
    projects.value = projs;
  } finally {
    loading.value = false;
  }
}

async function copyDockerHost(c: DockerContainer) {
  const text = `127.0.0.1:${c.hostPort || 3306}`;
  const ok = await copyToSystemClipboard(text);
  if (ok) {
    copiedId.value = c.id;
    setTimeout(() => { copiedId.value = null; }, 2000);
  }
}

async function copyDockerUrl(c: DockerContainer) {
  const text = c.connUrl || `127.0.0.1:${c.hostPort || 3306}`;
  const ok = await copyToSystemClipboard(text);
  if (ok) {
    copiedId.value = c.id;
    setTimeout(() => { copiedId.value = null; }, 2000);
  }
}

async function copyProjectConn(p: DiscoveredProject) {
  const text = p.connUrl || `${p.motor}://${p.username}@${p.host}:${p.port || ''}/${p.database}`;
  const ok = await copyToSystemClipboard(text);
  if (ok) {
    copiedId.value = p.uniqueKey || p.path;
    setTimeout(() => { copiedId.value = null; }, 2000);
  }
}

async function copySqlitePath(p: DiscoveredProject) {
  const text = p.filePath || p.path;
  const ok = await copyToSystemClipboard(text);
  if (ok) {
    copiedId.value = p.uniqueKey || p.path;
    setTimeout(() => { copiedId.value = null; }, 2000);
  }
}

async function copyProjectHostPort(p: DiscoveredProject) {
  const text = p.isLocalFile ? `sqlite://${p.filePath || p.path}` : `${p.host}:${p.port || getDefaultPort(p.motor)}`;
  const ok = await copyToSystemClipboard(text);
  if (ok) {
    copiedId.value = p.uniqueKey || p.path;
    setTimeout(() => { copiedId.value = null; }, 2000);
  }
}

async function saveDockerConnection(c: DockerContainer) {
  savingId.value = c.id;
  try {
    const res = await saveConnectionToBeekeeper({
      name: `Docker - ${c.name}`,
      motor: c.motor,
      host: '127.0.0.1',
      port: c.hostPort,
      user: c.suggestedUser,
      database: c.motor === 'postgresql' ? 'postgres' : '',
      url: c.connUrl
    });

    if (res.success) {
      savedId.value = c.id;
      showNotification(res.message, res.alreadyExists ? 'info' : 'success');
      setTimeout(() => { savedId.value = null; }, 3000);
    } else {
      showNotification(res.message || 'Error al guardar conexión', 'error');
    }
  } finally {
    savingId.value = null;
  }
}

async function saveProjectConnection(p: DiscoveredProject) {
  const id = p.uniqueKey || p.path;
  savingId.value = id;
  try {
    const isFile = p.isLocalFile || p.motor === 'sqlite' || p.motor === 'duckdb';
    const res = await saveConnectionToBeekeeper({
      name: `${p.name} (${p.motor.toUpperCase()})`,
      motor: p.motor,
      host: isFile ? '' : p.host,
      port: isFile ? null : p.port,
      user: isFile ? '' : p.username,
      database: isFile ? '' : p.database,
      path: isFile ? (p.filePath || p.path) : '',
      url: p.connUrl
    });

    if (res.success) {
      savedId.value = id;
      showNotification(res.message, res.alreadyExists ? 'info' : 'success');
      setTimeout(() => { savedId.value = null; }, 3000);
    } else {
      showNotification(res.message || 'Error al guardar conexión', 'error');
    }
  } finally {
    savingId.value = null;
  }
}

onMounted(() => {
  refreshAll();
});
</script>

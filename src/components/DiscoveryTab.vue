<template>
  <div class="space-y-6">
    <!-- Top banner -->
    <div class="p-5 rounded-xl bg-slate-900/50 border border-white/[0.08] flex items-center justify-between shadow-sm">
      <div>
        <div class="flex items-center gap-2">
          <Container class="w-5 h-5 text-sky-400" />
          <h2 class="text-base font-semibold text-white">Auto-Discovery (Docker & Proyectos Locales)</h2>
        </div>
        <p class="text-xs text-slate-400 mt-1">
          Detección en tiempo real de contenedores Docker activos y credenciales de bases de datos en archivos <code>.env</code>.
        </p>
      </div>

      <button
        @click="refreshAll"
        :disabled="loading"
        class="px-3.5 py-1.5 bg-slate-800 hover:bg-slate-700/80 border border-white/[0.1] rounded-lg text-xs font-medium text-slate-200 flex items-center gap-2 transition cursor-pointer active:scale-[0.98]"
      >
        <RefreshCw class="w-3.5 h-3.5 text-sky-400" :class="loading ? 'animate-spin' : ''" />
        <span>{{ loading ? 'Escaneando...' : 'Escanear Ahora' }}</span>
      </button>
    </div>

    <!-- Section 1: Docker Containers -->
    <div class="p-5 rounded-xl bg-slate-900/50 border border-white/[0.08] space-y-4 shadow-sm">
      <div class="flex items-center justify-between pb-3 border-b border-white/[0.06]">
        <div class="flex items-center gap-2">
          <Server class="w-4 h-4 text-sky-400" />
          <h3 class="text-xs font-semibold uppercase tracking-wider text-slate-200">
            Contenedores Docker Activos ({{ dockerContainers.length }})
          </h3>
        </div>
        <span class="text-[11px] font-mono text-slate-500">docker ps</span>
      </div>

      <div v-if="dockerContainers.length === 0" class="p-8 text-center text-xs text-slate-500 bg-slate-950/40 rounded-lg border border-dashed border-white/[0.08]">
        No se detectaron contenedores activos de MySQL, Postgres, MongoDB o Redis en ejecución.
      </div>

      <div v-else class="grid grid-cols-1 md:grid-cols-2 gap-3.5">
        <div
          v-for="c in dockerContainers"
          :key="c.id"
          class="p-4 rounded-lg bg-slate-950/80 border border-white/[0.08] hover:border-sky-500/40 transition space-y-3"
        >
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-2">
              <span class="w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]"></span>
              <span class="text-xs font-semibold text-white font-mono">{{ c.name }}</span>
            </div>
            <span class="text-[10px] uppercase font-mono px-2 py-0.5 rounded font-semibold bg-sky-500/10 text-sky-400 border border-sky-500/20">
              {{ c.motor }}
            </span>
          </div>

          <div class="text-[11px] text-slate-400 space-y-1 font-mono">
            <div class="flex justify-between">
              <span class="text-slate-500">Imagen:</span>
              <span class="text-slate-300">{{ c.image }}</span>
            </div>
            <div class="flex justify-between">
              <span class="text-slate-500">Puerto Host:</span>
              <span class="text-sky-400 font-semibold">{{ c.hostPort ? `127.0.0.1:${c.hostPort}` : 'No mapeado' }}</span>
            </div>
            <div class="flex justify-between">
              <span class="text-slate-500">Estado:</span>
              <span class="text-slate-300">{{ c.status }}</span>
            </div>
          </div>

          <div class="pt-2.5 flex items-center justify-between border-t border-white/[0.06] text-xs">
            <button
              @click="copyConnString(c)"
              class="px-2.5 py-1 bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-white rounded border border-white/[0.08] text-[11px] flex items-center gap-1.5 transition cursor-pointer"
            >
              <Copy class="w-3 h-3 text-slate-400" />
              <span>Copiar Host:Port</span>
            </button>
            <span v-if="copiedId === c.id" class="text-[11px] text-emerald-400 font-medium flex items-center gap-1">
              <Check class="w-3 h-3" /> Copiado al portapapeles
            </span>
          </div>
        </div>
      </div>
    </div>

    <!-- Section 2: Local Projects (.env) -->
    <div class="p-5 rounded-xl bg-slate-900/50 border border-white/[0.08] space-y-4 shadow-sm">
      <div class="flex items-center justify-between pb-3 border-b border-white/[0.06]">
        <div class="flex items-center gap-2">
          <FolderGit2 class="w-4 h-4 text-emerald-400" />
          <h3 class="text-xs font-semibold uppercase tracking-wider text-slate-200">
            Proyectos Locales con Credenciales (.env) ({{ projects.length }})
          </h3>
        </div>
        <span class="text-[11px] font-mono text-slate-500">~/Proyectos</span>
      </div>

      <div v-if="projects.length === 0" class="p-8 text-center text-xs text-slate-500 bg-slate-950/40 rounded-lg border border-dashed border-white/[0.08]">
        No se encontraron archivos .env con credenciales en ~/Proyectos.
      </div>

      <div v-else class="grid grid-cols-1 md:grid-cols-2 gap-3.5">
        <div
          v-for="p in projects"
          :key="p.path"
          class="p-4 rounded-lg bg-slate-950/80 border border-white/[0.08] hover:border-emerald-500/40 transition space-y-2.5"
        >
          <div class="flex items-center justify-between">
            <span class="text-xs font-semibold text-white font-mono flex items-center gap-1.5">
              {{ p.name }}
            </span>
            <span class="text-[10px] uppercase font-mono px-2 py-0.5 rounded font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              {{ p.motor }}
            </span>
          </div>

          <div class="text-[11px] text-slate-400 space-y-1 font-mono">
            <div class="flex justify-between">
              <span class="text-slate-500">Base de datos:</span>
              <span class="text-white font-semibold">{{ p.database || 'N/A' }}</span>
            </div>
            <div class="flex justify-between">
              <span class="text-slate-500">Host / Puerto:</span>
              <span class="text-slate-300">{{ p.host }}:{{ p.port }}</span>
            </div>
            <div class="flex justify-between">
              <span class="text-slate-500">Usuario:</span>
              <span class="text-slate-300">{{ p.username }}</span>
            </div>
            <div class="text-[10px] text-slate-500 truncate pt-1 border-t border-white/[0.04]" :title="p.path">
              {{ p.path }}
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { Container, RefreshCw, Server, FolderGit2, Copy, Check } from 'lucide-vue-next';
import {
  getDockerContainers,
  getDiscoveredProjects,
  type DockerContainer,
  type DiscoveredProject
} from '../services/companion';

const loading = ref(false);
const dockerContainers = ref<DockerContainer[]>([]);
const projects = ref<DiscoveredProject[]>([]);
const copiedId = ref<string | null>(null);

async function refreshAll() {
  loading.value = true;
  try {
    const [containers, projs] = await Promise.all([
      getDockerContainers(),
      getDiscoveredProjects()
    ]);
    dockerContainers.value = containers;
    projects.value = projs;
  } finally {
    loading.value = false;
  }
}

function copyConnString(c: DockerContainer) {
  const text = `127.0.0.1:${c.hostPort || 3306}`;
  navigator.clipboard.writeText(text);
  copiedId.value = c.id;
  setTimeout(() => {
    copiedId.value = null;
  }, 2000);
}

onMounted(() => {
  refreshAll();
});
</script>

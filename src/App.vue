<template>
  <div class="min-h-screen bg-[var(--bks-bg)] text-slate-100 flex flex-col font-sans">
    <!-- Top App Navigation Header -->
    <header class="border-b border-white/[0.08] bg-slate-900/40 backdrop-blur-sm sticky top-0 z-20">
      <div class="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
        <!-- Logo & Title -->
        <div class="flex items-center gap-3.5">
          <div class="w-9 h-9 rounded-lg bg-sky-500/10 border border-sky-500/20 flex items-center justify-center text-sky-400 shadow-sm">
            <Database class="w-5 h-5" />
          </div>
          <div>
            <div class="flex items-center gap-2">
              <h1 class="text-sm font-semibold tracking-tight text-white">DB Manager Pro</h1>
              <span class="px-1.5 py-0.5 rounded text-[10px] font-mono font-medium bg-sky-500/15 text-sky-300 border border-sky-500/30">
                v1.0
              </span>
            </div>
            <p class="text-[11px] text-slate-400">Toolkit avanzado para sincronización, clonado y generación de datos</p>
          </div>
        </div>

        <!-- Right Side: Active Beekeeper Connection -->
        <div class="flex items-center gap-3">
          <div class="flex items-center gap-2.5 px-3 py-1.5 rounded-lg bg-slate-800/60 border border-white/[0.08] text-xs">
            <span class="w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.6)]"></span>
            <span class="text-slate-400 text-[11px]">Conexión Activa:</span>
            <span class="font-medium text-slate-200">{{ currentConn?.connectionName || 'Detectando...' }}</span>
            <span v-if="currentConn?.databaseName" class="font-mono text-sky-400 text-[11px]">
              ({{ currentConn.databaseName }})
            </span>
          </div>
        </div>
      </div>

      <!-- Segmented Navigation Tab Bar -->
      <div class="max-w-7xl mx-auto px-6 overflow-x-auto">
        <nav class="flex items-center gap-1 border-t border-white/[0.04] pt-1 min-w-max">
          <button
            v-for="tab in tabs"
            :key="tab.id"
            @click="activeTab = tab.id"
            :class="[
              activeTab === tab.id
                ? 'text-sky-400 bg-sky-500/10 border-sky-500/30 shadow-sm'
                : 'text-slate-400 border-transparent hover:text-slate-200 hover:bg-white/[0.04]'
            ]"
            class="px-3 py-1.5 text-xs font-medium border rounded-lg flex items-center gap-2 transition cursor-pointer my-1.5 whitespace-nowrap"
          >
            <component :is="tab.icon" class="w-4 h-4" />
            <span>{{ tab.label }}</span>
          </button>
        </nav>
      </div>
    </header>

    <!-- Main Content Area -->
    <main class="flex-1 max-w-7xl w-full mx-auto px-6 py-6">
      <SnapshotsTab v-if="activeTab === 'snapshots'" />
      <CloneStreamTab v-if="activeTab === 'clone'" />
      <SchemaDiffTab v-if="activeTab === 'diff'" />
      <HealthAuditorTab v-if="activeTab === 'health'" />
      <MockDataTab v-if="activeTab === 'mock'" :initial-table="initialTable" />
      <DataDictionaryTab v-if="activeTab === 'docs'" />
      <DiscoveryTab v-if="activeTab === 'discovery'" />
    </main>

    <!-- Footer -->
    <footer class="border-t border-white/[0.06] bg-slate-950/40 py-3 mt-auto">
      <div class="max-w-7xl mx-auto px-6 flex items-center justify-between text-[11px] text-slate-500 font-mono">
        <span>DB Manager Pro para Beekeeper Studio • GPLv3</span>
        <span>Streaming Pipes • Zero Temp Files</span>
      </div>
    </footer>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, defineAsyncComponent } from 'vue';
import {
  Database,
  Archive,
  RefreshCw,
  GitCompare,
  Activity,
  Sparkles,
  BookOpen,
  Container
} from 'lucide-vue-next';
import {
  fetchCurrentConnection,
  fetchViewContext,
  extractTableFromViewContext,
  type ConnectionData
} from './services/beekeeper';

const SnapshotsTab = defineAsyncComponent(() => import('./components/SnapshotsTab.vue'));
const CloneStreamTab = defineAsyncComponent(() => import('./components/CloneStreamTab.vue'));
const SchemaDiffTab = defineAsyncComponent(() => import('./components/SchemaDiffTab.vue'));
const HealthAuditorTab = defineAsyncComponent(() => import('./components/HealthAuditorTab.vue'));
const MockDataTab = defineAsyncComponent(() => import('./components/MockDataTab.vue'));
const DataDictionaryTab = defineAsyncComponent(() => import('./components/DataDictionaryTab.vue'));
const DiscoveryTab = defineAsyncComponent(() => import('./components/DiscoveryTab.vue'));

type TabType = 'snapshots' | 'clone' | 'diff' | 'health' | 'mock' | 'docs' | 'discovery';

const activeTab = ref<TabType>('clone');
const initialTable = ref<string | null>(null);

const tabs = [
  { id: 'snapshots' as TabType, label: 'Snapshots & Backups', icon: Archive },
  { id: 'clone' as TabType, label: 'Clonado Stream (A ➔ B)', icon: RefreshCw },
  { id: 'diff' as TabType, label: 'Schema Diff & Migraciones', icon: GitCompare },
  { id: 'health' as TabType, label: 'Salud & Rendimiento', icon: Activity },
  { id: 'mock' as TabType, label: 'Mock Data Generator', icon: Sparkles },
  { id: 'docs' as TabType, label: 'Diccionario de Datos', icon: BookOpen },
  { id: 'discovery' as TabType, label: 'Auto-Discovery (Docker & .env)', icon: Container }
];

const currentConn = ref<ConnectionData | null>(null);

onMounted(async () => {
  currentConn.value = await fetchCurrentConnection();
  try {
    const ctx = await fetchViewContext();
    if (ctx) {
      const cmd = String(ctx.command || ctx.id || ctx || '');
      if (cmd.includes('snapshots')) activeTab.value = 'snapshots';
      else if (cmd.includes('clone')) activeTab.value = 'clone';
      else if (cmd.includes('diff')) activeTab.value = 'diff';
      else if (cmd.includes('health')) activeTab.value = 'health';
      else if (cmd.includes('mock')) activeTab.value = 'mock';
      else if (cmd.includes('docs')) activeTab.value = 'docs';
      else if (cmd.includes('discovery')) activeTab.value = 'discovery';

      const table = extractTableFromViewContext(ctx);
      if (table) {
        initialTable.value = table;
        activeTab.value = 'mock';
      }
    }
  } catch (err) {
    console.warn('Error reading view context in App:', err);
  }
});
</script>

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
                v{{ pkg.version }}
              </span>
            </div>
            <p class="text-[11px] text-slate-400">{{ t('Toolkit avanzado para sincronización, clonado y generación de datos') }}</p>
          </div>
        </div>

        <!-- Right Side: Active Beekeeper Connection -->
        <div class="flex items-center gap-3">
          <div class="flex items-center gap-2.5 px-3 py-1.5 rounded-lg bg-slate-800/60 border border-white/[0.08] text-xs">
            <span class="w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.6)]"></span>
            <span class="text-slate-400 text-[11px]">{{ t('Conexión Activa:') }}</span>
            <span class="font-medium text-slate-200">{{ currentConn?.connectionName || t('Detectando...') }}</span>
            <span v-if="currentConn?.databaseName" class="font-mono text-sky-400 text-[11px]">
              ({{ currentConn.databaseName }})
            </span>
          </div>

          <!-- Language switcher -->
          <div class="flex items-center rounded-lg border border-white/[0.08] overflow-hidden text-[10px] font-mono">
            <button
              v-for="option in locales"
              :key="option"
              @click="setLocale(option)"
              :class="locale === option ? 'bg-sky-500/20 text-sky-300' : 'text-slate-400 hover:text-slate-200 hover:bg-white/[0.04]'"
              class="px-2 py-1 transition cursor-pointer uppercase"
              :title="option === 'es' ? 'Español' : 'English'"
            >
              {{ option }}
            </button>
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
            <span>{{ t(tab.labelKey) }}</span>
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
        <span>{{ t('DB Manager Pro para Beekeeper Studio • GPLv3') }}</span>
        <span>Streaming Pipes • Zero Temp Files</span>
      </div>
    </footer>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, type Component } from 'vue';
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
import pkg from '../package.json';
import { t, locale, setLocale, type Locale, type MessageKey } from './i18n';

import SnapshotsTab from './components/SnapshotsTab.vue';
import CloneStreamTab from './components/CloneStreamTab.vue';
import SchemaDiffTab from './components/SchemaDiffTab.vue';
import HealthAuditorTab from './components/HealthAuditorTab.vue';
import MockDataTab from './components/MockDataTab.vue';
import DataDictionaryTab from './components/DataDictionaryTab.vue';
import DiscoveryTab from './components/DiscoveryTab.vue';

type TabType = 'snapshots' | 'clone' | 'diff' | 'health' | 'mock' | 'docs' | 'discovery';

const activeTab = ref<TabType>('clone');
const initialTable = ref<string | null>(null);

const locales: Locale[] = ['es', 'en'];

const tabs: Array<{ id: TabType; labelKey: MessageKey; icon: Component }> = [
  { id: 'snapshots', labelKey: 'Snapshots & Backups', icon: Archive },
  { id: 'clone', labelKey: 'Clonado Stream (A ➔ B)', icon: RefreshCw },
  { id: 'diff', labelKey: 'Schema Diff & Migraciones', icon: GitCompare },
  { id: 'health', labelKey: 'Salud & Rendimiento', icon: Activity },
  { id: 'mock', labelKey: 'Mock Data Generator', icon: Sparkles },
  { id: 'docs', labelKey: 'Diccionario de Datos', icon: BookOpen },
  { id: 'discovery', labelKey: 'Auto-Discovery (Docker & .env)', icon: Container }
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

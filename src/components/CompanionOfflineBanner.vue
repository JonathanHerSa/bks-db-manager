<template>
  <div class="p-4 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-200 text-xs space-y-3">
    <div class="flex items-start gap-2">
      <AlertTriangle class="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
      <span>El Companion Daemon no responde en el puerto 58765<template v-if="reason">, así que {{ reason }}</template>.</span>
    </div>

    <div class="flex flex-wrap items-center gap-2">
      <button
        @click="handleDownload"
        class="px-3 py-1.5 bg-sky-500/20 hover:bg-sky-500/30 text-sky-100 rounded-md border border-sky-500/40 text-xs font-medium transition cursor-pointer flex items-center gap-1.5"
      >
        <Download class="w-3.5 h-3.5" /> Descargar Companion
      </button>
      <button
        @click="$emit('retry')"
        class="px-3 py-1 bg-amber-500/20 hover:bg-amber-500/30 text-amber-100 rounded-md border border-amber-500/40 text-xs font-medium transition cursor-pointer"
      >
        Reintentar
      </button>
      <button
        @click="showOtherPlatforms = !showOtherPlatforms"
        class="text-amber-300/80 hover:text-amber-200 underline underline-offset-2 cursor-pointer"
      >
        ¿Otro sistema operativo?
      </button>
    </div>

    <div v-if="showOtherPlatforms" class="flex flex-wrap gap-1.5 pt-2 border-t border-amber-500/20">
      <button
        v-for="(label, key) in platformLabels"
        :key="key"
        @click="download(key as CompanionPlatform)"
        class="px-2 py-1 bg-slate-900/40 hover:bg-slate-900/60 text-amber-100 rounded border border-white/[0.08] text-[11px] cursor-pointer"
      >
        {{ label }}
      </button>
    </div>

    <p class="text-amber-300/70 text-[11px]">
      ¿Ya eres desarrollador? <code>npm run daemon:install</code> también funciona.
      <a href="#" @click.prevent="openDocs" class="underline underline-offset-2 hover:text-amber-200">Cómo instalarlo</a>
    </p>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { AlertTriangle, Download } from 'lucide-vue-next';
import {
  detectPlatform,
  openDownload,
  openUrl,
  docsUrl,
  COMPANION_PLATFORM_LABELS,
  type CompanionPlatform
} from '../services/companionInstall';

// `reason` completes "...no responde en el puerto 58765, así que {reason}."
// — pass a lowercase clause specific to what breaks in that tab, e.g.
// "Docker y Auto-Discovery no pueden escanear".
defineProps<{ reason?: string }>();
defineEmits<{ retry: [] }>();

const platformLabels = COMPANION_PLATFORM_LABELS;
const showOtherPlatforms = ref(false);

function download(platform: CompanionPlatform) {
  openDownload(platform);
}

function handleDownload() {
  download(detectPlatform());
}

function openDocs() {
  openUrl(docsUrl());
}
</script>

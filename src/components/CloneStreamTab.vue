<template>
  <div class="space-y-6">
    <!-- Header banner -->
    <div class="p-5 rounded-xl bg-slate-900/50 border border-white/[0.08] flex items-center justify-between shadow-sm">
      <div>
        <div class="flex items-center gap-2">
          <RefreshCw class="w-5 h-5 text-sky-400" />
          <h2 class="text-base font-semibold text-white">Clonado Directo en Vivo (Stream A ➔ B)</h2>
        </div>
        <p class="text-xs text-slate-400 mt-1">
          Transfiere bases de datos completas entre servidores (Prod ➔ Local/Docker) mediante pipes en streaming sin tocar el disco.
        </p>
      </div>

      <div class="flex items-center gap-2.5">
        <span
          :class="daemonConnected ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30' : 'bg-rose-500/10 text-rose-300 border-rose-500/30'"
          class="px-3 py-1 text-xs rounded-full border flex items-center gap-2 font-medium"
        >
          <span class="w-2 h-2 rounded-full" :class="daemonConnected ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)] animate-pulse' : 'bg-rose-400'"></span>
          {{ daemonConnected ? 'Companion Activo' : 'Companion Offline' }}
        </span>
      </div>
    </div>

    <!-- Daemon Warning -->
    <div v-if="!daemonConnected" class="p-4 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-200 text-xs flex items-center justify-between">
      <div class="flex items-center gap-2">
        <AlertTriangle class="w-4 h-4 text-amber-400 shrink-0" />
        <span>El Companion Daemon no responde en el puerto 58765. Ejecuta <code>npm run server</code> en la carpeta del plugin.</span>
      </div>
      <button @click="checkDaemon" class="px-3 py-1 bg-amber-500/20 hover:bg-amber-500/30 text-amber-100 rounded-md border border-amber-500/40 text-xs font-medium transition cursor-pointer">
        Reintentar
      </button>
    </div>

    <!-- Connections Grid -->
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-5">
      <!-- Source Panel -->
      <div class="p-5 rounded-xl bg-slate-900/50 border border-white/[0.08] space-y-4 shadow-sm">
        <div class="flex items-center justify-between pb-3 border-b border-white/[0.06]">
          <div class="flex items-center gap-2">
            <span class="w-2.5 h-2.5 rounded-full bg-emerald-400"></span>
            <h3 class="text-xs font-semibold uppercase tracking-wider text-slate-200">1. Servidor Origen (Lectura)</h3>
          </div>
          <span class="text-[11px] font-mono text-slate-500">mysqldump pipe</span>
        </div>

        <div>
          <div class="flex items-center justify-between mb-1.5">
            <label class="block text-xs font-medium text-slate-400">Conexión Guardada</label>
            <span v-if="selectedSourceConn?.isBeekeeper" class="text-[10px] px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 flex items-center gap-1 font-medium">
              <span class="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
              Beekeeper Studio
            </span>
          </div>
          <select
            v-model="selectedSourceConn"
            @change="onSourceConnChange"
            class="w-full bg-slate-950 border border-white/[0.1] rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:ring-2 focus:ring-sky-500/30 focus:border-sky-500 transition cursor-pointer"
          >
            <option value="custom">Configuración Manual...</option>
            <option v-for="c in availableConns" :key="'src-' + c.id" :value="c">
              {{ formatConnOption(c, availableConns) }}
            </option>
          </select>
        </div>

        <div>
          <label class="block text-xs text-slate-400 mb-1">Motor</label>
          <select
            v-model="source.motor"
            :disabled="selectedSourceConn !== 'custom'"
            class="w-full bg-slate-950 border border-white/[0.1] rounded-lg px-3 py-1.5 text-xs text-slate-200 font-mono focus:outline-none focus:border-sky-500 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            <option v-for="m in CLONE_STREAM_ENGINES" :key="'src-motor-' + m" :value="m">{{ m.toUpperCase() }}</option>
          </select>
        </div>

        <div class="grid grid-cols-3 gap-2.5">
          <div class="col-span-2">
            <label class="block text-xs text-slate-400 mb-1">Host</label>
            <input
              v-model="source.host"
              class="w-full bg-slate-950 border border-white/[0.1] rounded-lg px-3 py-1.5 text-xs text-slate-200 font-mono focus:outline-none focus:border-sky-500"
              placeholder="127.0.0.1"
            />
          </div>
          <div>
            <label class="block text-xs text-slate-400 mb-1">Puerto</label>
            <input
              v-model.number="source.port"
              type="number"
              class="w-full bg-slate-950 border border-white/[0.1] rounded-lg px-3 py-1.5 text-xs text-slate-200 font-mono focus:outline-none focus:border-sky-500"
              placeholder="3306"
            />
          </div>
        </div>

        <div class="grid grid-cols-2 gap-2.5">
          <div>
            <label class="block text-xs text-slate-400 mb-1">Usuario</label>
            <input
              v-model="source.user"
              class="w-full bg-slate-950 border border-white/[0.1] rounded-lg px-3 py-1.5 text-xs text-slate-200 font-mono focus:outline-none focus:border-sky-500"
              placeholder="root"
            />
          </div>
          <div>
            <label class="block text-xs text-slate-400 mb-1">Contraseña</label>
            <input
              v-model="source.pass"
              type="password"
              class="w-full bg-slate-950 border border-white/[0.1] rounded-lg px-3 py-1.5 text-xs text-slate-200 font-mono focus:outline-none focus:border-sky-500"
              :placeholder="selectedSourceConn !== 'custom' && selectedSourceConn?.hasPassword ? 'Usar contraseña guardada' : '••••••••'"
            />
          </div>
        </div>

        <div>
          <div class="flex items-center justify-between mb-1.5">
            <div class="flex items-center gap-2">
              <label class="block text-xs text-slate-400">Base de Datos Origen</label>
              <span v-if="sourceDbs.length > 0" class="text-[10px] px-1.5 py-0.5 rounded bg-sky-500/10 text-sky-400 font-mono">
                {{ sourceDbs.length }} BDs disponibles
              </span>
            </div>
            <button
              @click="loadSourceDbs"
              :disabled="loadingSourceDbs"
              type="button"
              class="text-[11px] text-sky-400 hover:text-sky-300 flex items-center gap-1 cursor-pointer"
            >
              <RefreshCw class="w-3 h-3" :class="loadingSourceDbs ? 'animate-spin' : ''" />
              <span>{{ loadingSourceDbs ? 'Consultando...' : 'Recargar BDs' }}</span>
            </button>
          </div>
          <SearchableSelect
            v-model="source.db"
            :options="sourceDbs"
            :allow-custom="false"
            placeholder="Escribe para filtrar o buscar BD origen..."
            @change="onSourceDbChange"
          />

          <!-- Database stats summary -->
          <div v-if="sourceDbStats && source.db" class="mt-2.5 p-2.5 rounded-lg bg-slate-950/80 border border-white/[0.06] text-xs font-mono space-y-1">
            <div class="flex items-center justify-between text-slate-300">
              <span class="text-slate-400">Tamaño SQL estimado:</span>
              <strong class="text-sky-400 font-semibold text-xs">{{ formatMb(sourceDbStats.sqlMb) }}</strong>
            </div>
            <div class="flex items-center justify-between text-[11px] text-slate-500 pt-0.5 border-t border-white/[0.04]">
              <span>Almacenamiento InnoDB: {{ formatMb(sourceDbStats.mb) }}</span>
              <span>{{ sourceDbStats.tables }} tablas</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Destination Panel -->
      <div class="p-5 rounded-xl bg-slate-900/50 border border-white/[0.08] space-y-4 shadow-sm">
        <div class="flex items-center justify-between pb-3 border-b border-white/[0.06]">
          <div class="flex items-center gap-2">
            <span class="w-2.5 h-2.5 rounded-full bg-rose-400"></span>
            <h3 class="text-xs font-semibold uppercase tracking-wider text-slate-200">2. Servidor Destino (Escritura)</h3>
          </div>
          <span class="text-[11px] font-mono text-slate-500">mysql import pipe</span>
        </div>

        <div>
          <div class="flex items-center justify-between mb-1.5">
            <label class="block text-xs font-medium text-slate-400">Conexión Guardada</label>
            <span v-if="selectedDestConn?.isBeekeeper" class="text-[10px] px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 flex items-center gap-1 font-medium">
              <span class="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
              Beekeeper Studio
            </span>
          </div>
          <select
            v-model="selectedDestConn"
            @change="onDestConnChange"
            class="w-full bg-slate-950 border border-white/[0.1] rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:ring-2 focus:ring-sky-500/30 focus:border-sky-500 transition cursor-pointer"
          >
            <option value="custom">Configuración Manual...</option>
            <option v-for="c in availableConns" :key="'dst-' + c.id" :value="c">
              {{ formatConnOption(c, availableConns) }}
            </option>
          </select>
        </div>

        <div>
          <label class="block text-xs text-slate-400 mb-1">Motor</label>
          <select
            v-model="dest.motor"
            :disabled="selectedDestConn !== 'custom'"
            class="w-full bg-slate-950 border border-white/[0.1] rounded-lg px-3 py-1.5 text-xs text-slate-200 font-mono focus:outline-none focus:border-sky-500 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            <option v-for="m in CLONE_STREAM_ENGINES" :key="'dst-motor-' + m" :value="m">{{ m.toUpperCase() }}</option>
          </select>
        </div>

        <div class="grid grid-cols-3 gap-2.5">
          <div class="col-span-2">
            <label class="block text-xs text-slate-400 mb-1">Host</label>
            <input
              v-model="dest.host"
              class="w-full bg-slate-950 border border-white/[0.1] rounded-lg px-3 py-1.5 text-xs text-slate-200 font-mono focus:outline-none focus:border-sky-500"
              placeholder="127.0.0.1"
            />
          </div>
          <div>
            <label class="block text-xs text-slate-400 mb-1">Puerto</label>
            <input
              v-model.number="dest.port"
              type="number"
              class="w-full bg-slate-950 border border-white/[0.1] rounded-lg px-3 py-1.5 text-xs text-slate-200 font-mono focus:outline-none focus:border-sky-500"
              placeholder="3306"
            />
          </div>
        </div>

        <div class="grid grid-cols-2 gap-2.5">
          <div>
            <label class="block text-xs text-slate-400 mb-1">Usuario</label>
            <input
              v-model="dest.user"
              class="w-full bg-slate-950 border border-white/[0.1] rounded-lg px-3 py-1.5 text-xs text-slate-200 font-mono focus:outline-none focus:border-sky-500"
              placeholder="root"
            />
          </div>
          <div>
            <label class="block text-xs text-slate-400 mb-1">Contraseña</label>
            <input
              v-model="dest.pass"
              type="password"
              class="w-full bg-slate-950 border border-white/[0.1] rounded-lg px-3 py-1.5 text-xs text-slate-200 font-mono focus:outline-none focus:border-sky-500"
              :placeholder="selectedDestConn !== 'custom' && selectedDestConn?.hasPassword ? 'Usar contraseña guardada' : '••••••••'"
            />
          </div>
        </div>

        <div>
          <div class="flex items-center justify-between mb-1.5">
            <div class="flex items-center gap-2">
              <label class="block text-xs text-slate-400">Base de Datos Destino</label>
              <span v-if="destDbs.length > 0" class="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 font-mono">
                {{ destDbs.length }} en destino
              </span>
            </div>
            <button
              @click="syncDestDbWithSource"
              type="button"
              class="text-[11px] text-sky-400 hover:text-sky-300 transition cursor-pointer"
            >
              Copiar de origen
            </button>
          </div>
          <SearchableSelect
            v-model="dest.db"
            :options="destDbs"
            :allow-custom="true"
            placeholder="Escribe o busca BD destino (o nombre nuevo)..."
          />
        </div>
      </div>
    </div>

    <!-- Smart Filters & Table Selection -->
    <div class="p-5 rounded-xl bg-slate-900/50 border border-white/[0.08] space-y-4 shadow-sm">
      <div class="flex items-center justify-between pb-3 border-b border-white/[0.06]">
        <div>
          <h3 class="text-xs font-semibold uppercase tracking-wider text-slate-200 flex items-center gap-2">
            <Shield class="w-4 h-4 text-sky-400" />
            Filtro de Tablas & Sanitización de Datos
          </h3>
          <p class="text-xs text-slate-400 mt-0.5">
            Sanitiza sentencias problemáticas en dumps y excluye tablas pesadas de auditoría para acelerar el clonado.
          </p>
        </div>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
        <label class="flex items-start gap-3 p-3 rounded-lg bg-slate-950/60 border border-white/[0.06] hover:border-white/[0.12] transition cursor-pointer">
          <input type="checkbox" v-model="maskData" class="mt-0.5 rounded text-sky-500 focus:ring-0 focus:ring-offset-0 bg-slate-900 border-white/20" />
          <div>
            <span class="text-xs font-medium text-slate-200 block">Enmascarar Datos Sensibles (Data Masking)</span>
            <span class="text-[11px] text-slate-400 block mt-0.5">Ofusca correos electrónicos (ej. <code>us***@masked.local</code>) para proteger datos privados en local.</span>
          </div>
        </label>

        <label class="flex items-start gap-3 p-3 rounded-lg bg-slate-950/60 border border-white/[0.06] opacity-80 cursor-default">
          <input type="checkbox" v-model="autoSanitize" checked disabled class="mt-0.5 rounded text-sky-500 focus:ring-0 focus:ring-offset-0 bg-slate-900 border-white/20" />
          <div>
            <span class="text-xs font-medium text-slate-200 block">Sanitización Automática de Dumps (Activa)</span>
            <span class="text-[11px] text-slate-400 block mt-0.5">Remueve automáticamente cláusulas <code>DEFINER</code>, <code>USE</code>, <code>CREATE DATABASE</code> y <code>SQL_LOG_BIN</code>.</span>
          </div>
        </label>
      </div>

      <!-- Table checklist -->
      <div v-if="availableTables.length > 0" class="space-y-2.5 pt-2 border-t border-white/[0.06]">
        <div class="flex items-center justify-between">
          <span class="text-xs font-medium text-slate-300">
            Tablas a incluir ({{ selectedTablesCount }} de {{ availableTables.length }} seleccionadas):
          </span>
          <div class="flex items-center gap-2">
            <button
              @click="excludeHeavyTables"
              class="px-2.5 py-1 bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border border-amber-500/30 rounded text-[11px] font-medium transition cursor-pointer"
            >
              Excluir Logs / Pulse / Telemetría
            </button>
            <button @click="selectAllTables(true)" class="text-xs text-sky-400 hover:text-sky-300 cursor-pointer">Todas</button>
            <span class="text-slate-600">•</span>
            <button @click="selectAllTables(false)" class="text-xs text-slate-400 hover:text-slate-300 cursor-pointer">Ninguna</button>
          </div>
        </div>

        <div class="max-h-44 overflow-y-auto grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-1.5 p-3 rounded-lg bg-slate-950/80 border border-white/[0.06]">
          <label
            v-for="t in availableTables"
            :key="t"
            class="flex items-center gap-2 text-xs text-slate-300 p-1.5 hover:bg-slate-900 rounded transition cursor-pointer"
          >
            <input
              type="checkbox"
              :value="t"
              v-model="selectedTables"
              class="rounded text-sky-500 bg-slate-900 border-white/20"
            />
            <span class="truncate font-mono text-[11px]" :title="t">{{ t }}</span>
          </label>
        </div>
      </div>
    </div>

    <!-- Error Alert Banner -->
    <div
      v-if="cloneError"
      class="p-4 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-200 text-xs space-y-2.5 shadow-sm animate-in fade-in duration-200"
    >
      <div class="flex items-start justify-between gap-3">
        <div class="flex items-start gap-2.5">
          <XCircle class="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
          <div class="space-y-1">
            <span class="font-semibold text-rose-300 text-sm block">Error en la transferencia</span>
            <p class="font-mono text-xs text-rose-200/90 whitespace-pre-wrap leading-relaxed">{{ cloneError }}</p>
          </div>
        </div>
        <div class="flex items-center gap-2 shrink-0">
          <button
            @click="copyError"
            type="button"
            class="px-2.5 py-1 bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 hover:text-white rounded border border-rose-500/40 text-xs flex items-center gap-1.5 transition cursor-pointer font-sans"
            title="Copiar mensaje de error al portapapeles"
          >
            <Check v-if="copiedError" class="w-3.5 h-3.5 text-emerald-400" />
            <Copy v-else class="w-3.5 h-3.5" />
            <span>{{ copiedError ? '¡Copiado!' : 'Copiar Error' }}</span>
          </button>
          <button
            @click="cloneError = null"
            class="text-rose-400 hover:text-white p-1 rounded transition cursor-pointer text-xs"
            title="Cerrar alerta"
          >
            ✕
          </button>
        </div>
      </div>
    </div>

    <!-- Success Alert Banner -->
    <div
      v-if="cloneSuccess"
      class="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-200 text-xs flex items-center justify-between shadow-sm animate-in fade-in duration-200"
    >
      <div class="flex items-center gap-2.5">
        <CheckCircle class="w-5 h-5 text-emerald-400 shrink-0" />
        <div>
          <span class="font-semibold text-emerald-300 text-sm block">¡Clonado completado exitosamente!</span>
          <span class="text-xs text-emerald-200/90">{{ cloneSuccess }}</span>
        </div>
      </div>
      <button
        @click="cloneSuccess = null"
        class="text-emerald-400 hover:text-white p-1 rounded transition cursor-pointer text-xs shrink-0"
        title="Cerrar alerta"
      >
        ✕
      </button>
    </div>

    <!-- Execution Bar & Progress -->
    <div class="p-5 rounded-xl bg-slate-900/50 border border-white/[0.08] space-y-4 shadow-sm">
      <div class="flex items-center justify-between">
        <div v-if="!isCloning" class="flex flex-col gap-1.5">
          <button
            @click="startClone"
            :disabled="!canClone"
            class="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-medium rounded-lg text-xs flex items-center gap-2 transition shadow-sm cursor-pointer active:scale-[0.98]"
          >
            <Play class="w-4 h-4 fill-current" />
            <span>Iniciar Clonado Stream</span>
          </button>
          <span v-if="cloneMotorUnsupported" class="text-[11px] text-amber-400">
            Clonado en streaming no soportado para {{ source.motor.toUpperCase() }} todavía.
          </span>
          <span v-else-if="cloneMotorMismatch" class="text-[11px] text-amber-400">
            Origen ({{ source.motor.toUpperCase() }}) y destino ({{ dest.motor.toUpperCase() }}) deben ser el mismo motor.
          </span>
        </div>

        <button
          v-else
          @click="stopClone"
          class="px-5 py-2.5 bg-rose-600 hover:bg-rose-500 text-white font-medium rounded-lg text-xs flex items-center gap-2 transition shadow-sm cursor-pointer animate-pulse active:scale-[0.98]"
        >
          <Square class="w-4 h-4 fill-current" />
          <span>Detener Operación</span>
        </button>

        <div v-if="isCloning" class="text-xs text-slate-400 flex items-center gap-4 font-mono">
          <span>Velocidad: <strong class="text-white">{{ progress.speedMb }} MB/s</strong></span>
          <span>Transferido: <strong class="text-sky-400">{{ progress.mb }} MB</strong></span>
          <span>Tiempo: <strong class="text-white">{{ progress.elapsedSec }}s</strong></span>
        </div>
      </div>

      <!-- Animated Progress Bar with real percentage & ETA -->
      <div v-if="isCloning" class="space-y-1.5">
        <div class="flex items-center justify-between text-xs text-slate-300 font-mono">
          <span>
            Progreso: <strong class="text-sky-400">{{ transferPercent }}%</strong>
            <span class="text-slate-500 text-[11px] ml-1">
              ({{ progress.mb }} MB de ~{{ formatMb(sourceDbStats?.sqlMb || 4000) }})
            </span>
          </span>
          <span v-if="estimatedTimeRemaining" class="text-emerald-400 text-xs font-mono flex items-center gap-1">
            <span>Restante:</span>
            <strong class="text-emerald-300">~{{ estimatedTimeRemaining }}</strong>
          </span>
        </div>
        <div class="w-full bg-slate-950 rounded-full h-2.5 overflow-hidden border border-white/[0.08]">
          <div
            class="bg-gradient-to-r from-sky-500 via-teal-400 to-emerald-400 h-full transition-all duration-300 rounded-full"
            :style="{ width: `${Math.max(3, transferPercent)}%` }"
          ></div>
        </div>
      </div>

      <!-- Console Log Box with Toolbar -->
      <div v-if="logs.length > 0" class="mt-3 rounded-lg border border-white/[0.08] bg-slate-950 overflow-hidden shadow-inner">
        <!-- Log Toolbar -->
        <div class="px-3 py-1.5 bg-slate-900/90 border-b border-white/[0.06] flex items-center justify-between text-[11px] select-none">
          <div class="flex items-center gap-2 text-slate-400 font-mono">
            <Terminal class="w-3.5 h-3.5 text-sky-400" />
            <span>Terminal de Streaming ({{ logs.length }} eventos)</span>
          </div>
          <div class="flex items-center gap-2">
            <button
              @click="copyLogs"
              type="button"
              class="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white transition flex items-center gap-1.5 cursor-pointer font-sans text-xs border border-white/10"
              title="Copiar todos los logs al portapapeles"
            >
              <Check v-if="copiedLogs" class="w-3 h-3 text-emerald-400" />
              <Copy v-else class="w-3 h-3 text-slate-400" />
              <span>{{ copiedLogs ? '¡Copiado!' : 'Copiar Logs' }}</span>
            </button>
            <button
              @click="clearLogs"
              type="button"
              class="px-2 py-1 rounded hover:bg-slate-800 text-slate-400 hover:text-rose-300 transition text-xs font-sans flex items-center gap-1 cursor-pointer"
              title="Limpiar terminal"
            >
              <Trash2 class="w-3 h-3" />
              <span>Limpiar</span>
            </button>
          </div>
        </div>

        <!-- Log Output -->
        <div
          ref="logsContainer"
          class="p-3 text-xs font-mono max-h-56 overflow-y-auto space-y-1 scrollbar-thin scrollbar-thumb-slate-800 select-text"
        >
          <div v-for="(log, idx) in logs" :key="idx" class="flex items-start gap-2 select-text">
            <span class="text-slate-600 select-none shrink-0">&gt;</span>
            <span :class="getLogClass(log)" class="break-all select-text">{{ log }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, nextTick } from 'vue';
import {
  RefreshCw,
  Shield,
  AlertTriangle,
  Play,
  Square,
  CheckCircle,
  XCircle,
  Terminal,
  Copy,
  Check,
  Trash2
} from 'lucide-vue-next';
import {
  checkCompanionStatus,
  getSavedConnections,
  getTablesList,
  getDatabaseInfo,
  startStreamClone,
  formatConnOption,
  type SavedConnection
} from '../services/companion';
import {
  fetchCurrentConnection,
  copyToSystemClipboard,
  type ConnectionData
} from '../services/beekeeper';
import { listDatabasesForConnection } from '../services/connectionAccess';
import { normalizeMotor, CLONE_STREAM_ENGINES } from '../../shared/dbEngines.js';
import SearchableSelect from './SearchableSelect.vue';

const daemonConnected = ref(false);
const availableConns = ref<SavedConnection[]>([]);
const selectedSourceConn = ref<any>('custom');
const selectedDestConn = ref<any>('custom');

const currentBksConn = ref<ConnectionData | null>(null);

const source = ref({
  host: '127.0.0.1',
  port: 3307,
  user: 'root',
  pass: '',
  db: '',
  motor: 'mysql'
});

const dest = ref({
  host: '127.0.0.1',
  port: 3308,
  user: 'root',
  pass: '',
  db: '',
  motor: 'mysql'
});

const sourceDbs = ref<string[]>([]);
const loadingSourceDbs = ref(false);
const destDbs = ref<string[]>([]);
const loadingDestDbs = ref(false);

const availableTables = ref<string[]>([]);
const selectedTables = ref<string[]>([]);
const maskData = ref(false);
const autoSanitize = ref(true);

const sourceDbStats = ref<{ mb: number; tables: number; sqlMb: number } | null>(null);
const isCloning = ref(false);
const cloneError = ref<string | null>(null);
const cloneSuccess = ref<string | null>(null);
const progress = ref({ bytes: 0, mb: '0', speedMb: '0', elapsedSec: 0 });
const logs = ref<string[]>([]);
const logsContainer = ref<HTMLElement | null>(null);
const copiedLogs = ref(false);
const copiedError = ref(false);
let stopCloneFn: (() => void) | null = null;
let lastSyncedDb = '';

function formatMb(mb: number | undefined | null) {
  if (!mb) return '0 MB';
  if (mb >= 1024) {
    return `${(mb / 1024).toFixed(2)} GB`;
  }
  return `${mb.toFixed(1)} MB`;
}

const transferPercent = computed(() => {
  const currentMb = parseFloat(progress.value.mb) || 0;
  const totalMb = sourceDbStats.value?.sqlMb || 4000;
  if (totalMb <= 0) return 0;
  const pct = Math.round((currentMb / totalMb) * 100);
  return Math.min(99, Math.max(0, pct));
});

const estimatedTimeRemaining = computed(() => {
  const currentMb = parseFloat(progress.value.mb) || 0;
  const speed = parseFloat(progress.value.speedMb) || 0;
  const totalMb = sourceDbStats.value?.sqlMb || 4000;
  const remainingMb = totalMb - currentMb;
  if (speed <= 0 || remainingMb <= 0) return null;
  const totalSecs = Math.round(remainingMb / speed);
  const mins = Math.floor(totalSecs / 60);
  const secs = totalSecs % 60;
  if (mins > 0) {
    return `${mins}m ${secs}s`;
  }
  return `${secs}s`;
});

function scrollToBottom() {
  nextTick(() => {
    if (logsContainer.value) {
      logsContainer.value.scrollTop = logsContainer.value.scrollHeight;
    }
  });
}

function getLogClass(log: string) {
  if (log.startsWith('✔')) return 'text-emerald-400 font-semibold';
  if (log.includes('ERROR') || log.startsWith('✘') || log.toLowerCase().includes('failed') || log.toLowerCase().includes('error')) {
    return 'text-rose-400 font-medium bg-rose-500/10 px-1.5 py-0.5 rounded border border-rose-500/20';
  }
  if (log.includes('WARNING') || log.toLowerCase().includes('aviso')) return 'text-amber-400';
  if (log.startsWith('[DUMP]')) return 'text-sky-300/80';
  if (log.startsWith('[RESTORE]')) return 'text-indigo-300/80';
  return 'text-slate-300';
}

async function copyLogs() {
  if (logs.value.length === 0) return;
  const ok = await copyToSystemClipboard(logs.value.join('\n'));
  if (ok) {
    copiedLogs.value = true;
    setTimeout(() => {
      copiedLogs.value = false;
    }, 2000);
  }
}

async function copyError() {
  if (!cloneError.value) return;
  const ok = await copyToSystemClipboard(cloneError.value);
  if (ok) {
    copiedError.value = true;
    setTimeout(() => {
      copiedError.value = false;
    }, 2000);
  }
}

function clearLogs() {
  logs.value = [];
}

// The streaming clone pipes one dump process into one restore process, so
// source and destination must be the same engine (no cross-motor migration).
const cloneMotorMismatch = computed(() => source.value.motor !== dest.value.motor);
const cloneMotorUnsupported = computed(() => !CLONE_STREAM_ENGINES.includes(source.value.motor));

const canClone = computed(() => {
  return Boolean(
    daemonConnected.value &&
    source.value.host &&
    source.value.user &&
    source.value.db &&
    dest.value.host &&
    dest.value.user &&
    dest.value.db &&
    !cloneMotorMismatch.value &&
    !cloneMotorUnsupported.value
  );
});

const selectedTablesCount = computed(() => selectedTables.value.length);

async function checkDaemon() {
  const status = await checkCompanionStatus();
  daemonConnected.value = Boolean(status?.ok);
  if (daemonConnected.value) {
    availableConns.value = await getSavedConnections();
  }
}

async function onSourceConnChange() {
  if (selectedSourceConn.value !== 'custom') {
    const c = selectedSourceConn.value as SavedConnection;
    source.value.host = c.host;
    source.value.port = c.port || 3306;
    source.value.user = c.user;
    source.value.motor = normalizeMotor(c.motor);
    // The daemon never sends saved passwords back to the client; leaving this
    // empty makes the daemon resolve the saved one server-side when needed.
    source.value.pass = '';
    await loadSourceDbs();
  }
}

async function onDestConnChange() {
  if (selectedDestConn.value !== 'custom') {
    const c = selectedDestConn.value as SavedConnection;
    dest.value.host = c.host;
    dest.value.port = c.port || 3306;
    dest.value.user = c.user;
    dest.value.motor = normalizeMotor(c.motor);
    // The daemon never sends saved passwords back to the client; leaving this
    // empty makes the daemon resolve the saved one server-side when needed.
    dest.value.pass = '';
    await loadDestDbs();
  }
}

async function loadSourceDbs() {
  loadingSourceDbs.value = true;

  const isCurrentActive = Boolean(
    currentBksConn.value &&
    (selectedSourceConn.value?.name?.toLowerCase() === currentBksConn.value.connectionName?.toLowerCase() ||
      selectedSourceConn.value?.isBeekeeper)
  );

  sourceDbs.value = await listDatabasesForConnection({
    motor: source.value.motor,
    host: source.value.host,
    port: source.value.port,
    user: source.value.user,
    pass: source.value.pass,
    isCurrentActive
  });
  loadingSourceDbs.value = false;

  // Auto-select DB: prefer Beekeeper's active DB if present, otherwise first DB
  if (sourceDbs.value.length > 0) {
    if (currentBksConn.value?.databaseName && sourceDbs.value.includes(currentBksConn.value.databaseName)) {
      source.value.db = currentBksConn.value.databaseName;
    } else if (!source.value.db || !sourceDbs.value.includes(source.value.db)) {
      source.value.db = sourceDbs.value[0];
    }
    syncDestDbWithSource();
    await loadTablesForExclusion();
    await loadSourceDbStats();
  }
}

async function loadDestDbs() {
  if (!dest.value.host || !dest.value.user) return;
  loadingDestDbs.value = true;

  const isCurrentActive = Boolean(
    currentBksConn.value &&
    (selectedDestConn.value?.name?.toLowerCase() === currentBksConn.value.connectionName?.toLowerCase() ||
      selectedDestConn.value?.isBeekeeper)
  );

  destDbs.value = await listDatabasesForConnection({
    motor: dest.value.motor,
    host: dest.value.host,
    port: dest.value.port,
    user: dest.value.user,
    pass: dest.value.pass,
    isCurrentActive
  });
  loadingDestDbs.value = false;
}

async function onSourceDbChange() {
  syncDestDbWithSource();
  await loadTablesForExclusion();
  await loadSourceDbStats();
}

async function loadSourceDbStats() {
  if (!source.value.db) {
    sourceDbStats.value = null;
    return;
  }
  try {
    const stats = await getDatabaseInfo({
      motor: source.value.motor,
      host: source.value.host,
      port: source.value.port,
      user: source.value.user,
      pass: source.value.pass,
      database: source.value.db,
      name: selectedSourceConn.value !== 'custom' ? selectedSourceConn.value?.name : undefined
    });
    sourceDbStats.value = stats;
  } catch (err) {
    console.warn('Failed to load DB stats:', err);
    sourceDbStats.value = null;
  }
}

function syncDestDbWithSource() {
  if (!dest.value.db || dest.value.db === lastSyncedDb) {
    dest.value.db = source.value.db;
    lastSyncedDb = source.value.db;
  }
}

async function loadTablesForExclusion() {
  if (!source.value.db) return;
  availableTables.value = await getTablesList({
    motor: source.value.motor,
    host: source.value.host,
    port: source.value.port,
    user: source.value.user,
    pass: source.value.pass,
    database: source.value.db
  });
  selectedTables.value = [...availableTables.value];
}

function selectAllTables(val: boolean) {
  selectedTables.value = val ? [...availableTables.value] : [];
}

function excludeHeavyTables() {
  const heavyKeywords = [
    'pulse_',
    'telescope_',
    'log',
    'audit',
    'activity',
    'sessions',
    'analisis_financiero',
    '_jsons',
    'cache'
  ];
  selectedTables.value = availableTables.value.filter((t) => {
    const lower = t.toLowerCase();
    return !heavyKeywords.some((k) => lower.includes(k));
  });
}

function startClone() {
  if (!canClone.value) return;

  const excluded = availableTables.value.filter((t) => !selectedTables.value.includes(t));
  logs.value = [];
  cloneError.value = null;
  cloneSuccess.value = null;
  isCloning.value = true;

  stopCloneFn = startStreamClone(
    {
      srcHost: source.value.host,
      srcPort: source.value.port,
      srcUser: source.value.user,
      srcPass: source.value.pass,
      srcDb: source.value.db,
      dstHost: dest.value.host,
      dstPort: dest.value.port,
      dstUser: dest.value.user,
      dstPass: dest.value.pass,
      dstDb: dest.value.db,
      motor: source.value.motor,
      excludeTables: excluded,
      maskData: maskData.value
    },
    {
      onLog: (msg) => {
        logs.value.push(msg);
        scrollToBottom();
      },
      onProgress: (p) => {
        progress.value = p;
      },
      onComplete: (res) => {
        cloneSuccess.value = res.message;
        cloneError.value = null;
        logs.value.push(res.message);
        isCloning.value = false;
        scrollToBottom();
      },
      onError: (err) => {
        if (cloneSuccess.value) return;
        cloneError.value = err;
        logs.value.push(`✘ ${err}`);
        isCloning.value = false;
        scrollToBottom();
      }
    }
  );
}

function stopClone() {
  if (stopCloneFn) {
    stopCloneFn();
    stopCloneFn = null;
  }
  isCloning.value = false;
  logs.value.push('⏹ Clonado cancelado por el usuario.');
  scrollToBottom();
}

onMounted(async () => {
  await checkDaemon();

  try {
    currentBksConn.value = await fetchCurrentConnection();
  } catch (e) {
    console.warn('Could not fetch active connection:', e);
  }

  if (availableConns.value.length > 0) {
    // 1. Pick Source connection: prefer matching active Beekeeper connection
    let srcMatch = null;
    if (currentBksConn.value?.connectionName) {
      srcMatch = availableConns.value.find(
        (c) => c.name.toLowerCase() === currentBksConn.value!.connectionName.toLowerCase()
      );
    }
    selectedSourceConn.value = srcMatch || availableConns.value[0];
    await onSourceConnChange();

    // 2. Pick Destination connection: prefer Docker or a connection different from source
    const destMatch =
      availableConns.value.find(
        (c) => c.name.toLowerCase().includes('docker') && c !== selectedSourceConn.value
      ) ||
      availableConns.value.find((c) => c !== selectedSourceConn.value) ||
      availableConns.value[0];

    if (destMatch) {
      selectedDestConn.value = destMatch;
      await onDestConnChange();
    }
  } else {
    await loadSourceDbs();
  }
});
</script>

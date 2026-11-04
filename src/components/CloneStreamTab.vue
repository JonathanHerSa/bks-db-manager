<template>
  <div class="space-y-6">
    <!-- Header banner -->
    <div class="p-5 rounded-xl bg-slate-900/50 border border-white/[0.08] flex items-center justify-between shadow-sm">
      <div>
        <div class="flex items-center gap-2">
          <RefreshCw class="w-5 h-5 text-sky-400" />
          <h2 class="text-base font-semibold text-white">{{ t('Clonado Directo en Vivo (Stream A ➔ B)') }}</h2>
        </div>
        <p class="text-xs text-slate-400 mt-1">
          {{ t('Transfiere bases de datos completas entre servidores (Prod ➔ Local/Docker) mediante pipes en streaming sin tocar el disco.') }}
        </p>
      </div>

      <div class="flex items-center gap-2.5">
        <span
          :class="daemonConnected ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30' : 'bg-rose-500/10 text-rose-300 border-rose-500/30'"
          class="px-3 py-1 text-xs rounded-full border flex items-center gap-2 font-medium"
        >
          <span class="w-2 h-2 rounded-full" :class="daemonConnected ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)] animate-pulse' : 'bg-rose-400'"></span>
          {{ daemonConnected ? t('Companion Activo') : t('Companion Offline') }}
        </span>
      </div>
    </div>

    <!-- Daemon Warning -->
    <CompanionOfflineBanner v-if="!daemonConnected" @retry="checkDaemon" />

    <!-- Connections Grid -->
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-5">
      <!-- Source Panel -->
      <div class="p-5 rounded-xl bg-slate-900/50 border border-white/[0.08] space-y-4 shadow-sm">
        <div class="flex items-center justify-between pb-3 border-b border-white/[0.06]">
          <div class="flex items-center gap-2">
            <span class="w-2.5 h-2.5 rounded-full bg-emerald-400"></span>
            <h3 class="text-xs font-semibold uppercase tracking-wider text-slate-200">{{ t('1. Servidor Origen (Lectura)') }}</h3>
          </div>
          <span class="text-[11px] font-mono text-slate-500">mysqldump pipe</span>
        </div>

        <div>
          <div class="flex items-center justify-between mb-1.5">
            <label class="block text-xs font-medium text-slate-400">{{ t('Conexión Guardada') }}</label>
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
            <option value="custom">{{ t('Configuración Manual...') }}</option>
            <option v-for="c in availableConns" :key="'src-' + c.id" :value="c">
              {{ formatConnOption(c, availableConns) }}
            </option>
          </select>
        </div>

        <div>
          <label class="block text-xs text-slate-400 mb-1">{{ t('Motor') }}</label>
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
            <label class="block text-xs text-slate-400 mb-1">{{ t('Puerto') }}</label>
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
            <label class="block text-xs text-slate-400 mb-1">{{ t('Usuario') }}</label>
            <input
              v-model="source.user"
              class="w-full bg-slate-950 border border-white/[0.1] rounded-lg px-3 py-1.5 text-xs text-slate-200 font-mono focus:outline-none focus:border-sky-500"
              placeholder="root"
            />
          </div>
          <div>
            <label class="block text-xs text-slate-400 mb-1">{{ t('Contraseña') }}</label>
            <input
              v-model="source.pass"
              type="password"
              class="w-full bg-slate-950 border border-white/[0.1] rounded-lg px-3 py-1.5 text-xs text-slate-200 font-mono focus:outline-none focus:border-sky-500"
              :placeholder="selectedSourceConn !== 'custom' && selectedSourceConn?.hasPassword ? t('Usar contraseña guardada') : '••••••••'"
            />
          </div>
        </div>

        <div>
          <div class="flex items-center justify-between mb-1.5">
            <div class="flex items-center gap-2">
              <label class="block text-xs text-slate-400">{{ t('Base de Datos Origen') }}</label>
              <span v-if="sourceDbs.length > 0" class="text-[10px] px-1.5 py-0.5 rounded bg-sky-500/10 text-sky-400 font-mono">
                {{ t('{count} BDs disponibles', { count: sourceDbs.length }) }}
              </span>
            </div>
            <button
              @click="loadSourceDbs"
              :disabled="loadingSourceDbs"
              type="button"
              class="text-[11px] text-sky-400 hover:text-sky-300 flex items-center gap-1 cursor-pointer"
            >
              <RefreshCw class="w-3 h-3" :class="loadingSourceDbs ? 'animate-spin' : ''" />
              <span>{{ loadingSourceDbs ? t('Consultando...') : t('Recargar BDs') }}</span>
            </button>
          </div>
          <SearchableSelect
            v-model="source.db"
            :options="sourceDbs"
            :allow-custom="false"
            :placeholder="t('Escribe para filtrar o buscar BD origen...')"
            @change="onSourceDbChange"
          />

          <!-- Database stats summary -->
          <div v-if="sourceDbStats && source.db" class="mt-2.5 p-2.5 rounded-lg bg-slate-950/80 border border-white/[0.06] text-xs font-mono space-y-1">
            <div class="flex items-center justify-between text-slate-300">
              <span class="text-slate-400">{{ t('Tamaño en disco (InnoDB):') }}</span>
              <strong class="text-sky-400 font-semibold text-xs">{{ formatMb(sourceDbStats.mb) }}</strong>
            </div>
            <div class="flex items-center justify-between text-[11px] text-slate-500 pt-0.5 border-t border-white/[0.04]">
              <span>{{ t('{count} tablas', { count: sourceDbStats.tables }) }}</span>
              <span class="text-slate-600">{{ t('El dump SQL puede pesar distinto.') }}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Destination Panel -->
      <div class="p-5 rounded-xl bg-slate-900/50 border border-white/[0.08] space-y-4 shadow-sm">
        <div class="flex items-center justify-between pb-3 border-b border-white/[0.06]">
          <div class="flex items-center gap-2">
            <span class="w-2.5 h-2.5 rounded-full bg-rose-400"></span>
            <h3 class="text-xs font-semibold uppercase tracking-wider text-slate-200">{{ t('2. Servidor Destino (Escritura)') }}</h3>
          </div>
          <span class="text-[11px] font-mono text-slate-500">mysql import pipe</span>
        </div>

        <div>
          <div class="flex items-center justify-between mb-1.5">
            <label class="block text-xs font-medium text-slate-400">{{ t('Conexión Guardada') }}</label>
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
            <option value="custom">{{ t('Configuración Manual...') }}</option>
            <option v-for="c in availableConns" :key="'dst-' + c.id" :value="c">
              {{ formatConnOption(c, availableConns) }}
            </option>
          </select>
        </div>

        <div>
          <label class="block text-xs text-slate-400 mb-1">{{ t('Motor') }}</label>
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
            <label class="block text-xs text-slate-400 mb-1">{{ t('Puerto') }}</label>
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
            <label class="block text-xs text-slate-400 mb-1">{{ t('Usuario') }}</label>
            <input
              v-model="dest.user"
              class="w-full bg-slate-950 border border-white/[0.1] rounded-lg px-3 py-1.5 text-xs text-slate-200 font-mono focus:outline-none focus:border-sky-500"
              placeholder="root"
            />
          </div>
          <div>
            <label class="block text-xs text-slate-400 mb-1">{{ t('Contraseña') }}</label>
            <input
              v-model="dest.pass"
              type="password"
              class="w-full bg-slate-950 border border-white/[0.1] rounded-lg px-3 py-1.5 text-xs text-slate-200 font-mono focus:outline-none focus:border-sky-500"
              :placeholder="selectedDestConn !== 'custom' && selectedDestConn?.hasPassword ? t('Usar contraseña guardada') : '••••••••'"
            />
          </div>
        </div>

        <div>
          <div class="flex items-center justify-between mb-1.5">
            <div class="flex items-center gap-2">
              <label class="block text-xs text-slate-400">{{ t('Base de Datos Destino') }}</label>
              <span v-if="destDbs.length > 0" class="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 font-mono">
                {{ t('{count} en destino', { count: destDbs.length }) }}
              </span>
            </div>
            <button
              @click="syncDestDbWithSource"
              type="button"
              class="text-[11px] text-sky-400 hover:text-sky-300 transition cursor-pointer"
            >
              {{ t('Copiar de origen') }}
            </button>
          </div>
          <SearchableSelect
            v-model="dest.db"
            :options="destDbs"
            :allow-custom="true"
            :placeholder="t('Escribe o busca BD destino (o nombre nuevo)...')"
            @change="onDestDbChange"
          />
        </div>
      </div>
    </div>

    <!-- Clone mode -->
    <div class="p-5 rounded-xl bg-slate-900/50 border border-white/[0.08] space-y-3 shadow-sm">
      <div class="flex items-center justify-between pb-3 border-b border-white/[0.06]">
        <h3 class="text-xs font-semibold uppercase tracking-wider text-slate-200 flex items-center gap-2">
          <RefreshCw class="w-4 h-4 text-sky-400" />
          {{ t('Modo de clonado') }}
        </h3>
      </div>
      <div v-if="daemonConnected && !daemonSupportsIncremental" class="p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-200 text-xs">
        {{ t('El Companion está desactualizado: reinícialo para usar el modo incremental.') }}
      </div>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
        <label class="flex items-start gap-3 p-3 rounded-lg bg-slate-950/60 border border-white/[0.06] hover:border-white/[0.12] transition cursor-pointer">
          <input type="radio" value="full" v-model="cloneMode" @change="invalidatePlan()" class="mt-0.5 text-sky-500 bg-slate-900 border-white/20" />
          <div>
            <span class="text-xs font-medium text-slate-200 block">{{ t('Completo (siempre)') }}</span>
            <span class="text-[11px] text-slate-400 block mt-0.5">{{ t('Recrea y reescribe todas las tablas en cada ejecución.') }}</span>
          </div>
        </label>
        <label
          class="flex items-start gap-3 p-3 rounded-lg bg-slate-950/60 border border-white/[0.06] hover:border-white/[0.12] transition"
          :class="daemonSupportsIncremental ? 'cursor-pointer' : 'opacity-50 cursor-not-allowed'"
        >
          <input type="radio" value="incremental" v-model="cloneMode" @change="invalidatePlan()" :disabled="!daemonSupportsIncremental" class="mt-0.5 text-sky-500 bg-slate-900 border-white/20" />
          <div>
            <span class="text-xs font-medium text-slate-200 block">{{ t('Incremental (solo cambios)') }}</span>
            <span class="text-[11px] text-slate-400 block mt-0.5">{{ t('Compara las tablas contra la última sincronización y solo copia lo que cambió. La primera vez hace una copia completa.') }}</span>
          </div>
        </label>
        <label
          class="flex items-start gap-3 p-3 rounded-lg bg-slate-950/60 border border-white/[0.06] hover:border-white/[0.12] transition md:col-span-2"
          :class="daemonSupportsIncremental ? 'cursor-pointer' : 'opacity-50 cursor-not-allowed'"
        >
          <input type="radio" value="cdc" v-model="cloneMode" @change="checkCdc" :disabled="!daemonSupportsIncremental" class="mt-0.5 text-sky-500 bg-slate-900 border-white/20" />
          <div>
            <span class="text-xs font-medium text-slate-200 block">{{ t('Modo CDC (solo cambios)') }}</span>
            <span class="text-[11px] text-slate-400 block mt-0.5">
              {{ cdcStatus ? (cdcStatus.available ? t('CDC disponible: {engine}', { engine: cdcStatus.engine || '' }) : t('CDC no disponible: {reason}', { reason: cdcStatus.reason || '' })) : t('Detectando CDC...') }}
            </span>
          </div>
        </label>
      </div>
    </div>

    <!-- Smart Filters & Table Selection -->
    <div class="p-5 rounded-xl bg-slate-900/50 border border-white/[0.08] space-y-4 shadow-sm">
      <div class="flex items-center justify-between pb-3 border-b border-white/[0.06]">
        <div>
          <h3 class="text-xs font-semibold uppercase tracking-wider text-slate-200 flex items-center gap-2">
            <Shield class="w-4 h-4 text-sky-400" />
            {{ t('Filtro de Tablas & Sanitización de Datos') }}
          </h3>
          <p class="text-xs text-slate-400 mt-0.5">
            {{ t('Sanitiza sentencias problemáticas en dumps y excluye tablas pesadas de auditoría para acelerar el clonado.') }}
          </p>
        </div>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
        <label class="flex items-start gap-3 p-3 rounded-lg bg-slate-950/60 border border-white/[0.06] hover:border-white/[0.12] transition cursor-pointer">
          <input type="checkbox" v-model="maskData" class="mt-0.5 rounded text-sky-500 focus:ring-0 focus:ring-offset-0 bg-slate-900 border-white/20" />
          <div>
            <span class="text-xs font-medium text-slate-200 block">{{ t('Enmascarar Datos Sensibles (Data Masking)') }}</span>
            <span class="text-[11px] text-slate-400 block mt-0.5">{{ t('Ofusca correos electrónicos (ej.') }} <code>us***@masked.local</code>{{ t(') para proteger datos privados en local.') }}</span>
          </div>
        </label>

        <label class="flex items-start gap-3 p-3 rounded-lg bg-slate-950/60 border border-white/[0.06] opacity-80 cursor-default">
          <input type="checkbox" v-model="autoSanitize" checked disabled class="mt-0.5 rounded text-sky-500 focus:ring-0 focus:ring-offset-0 bg-slate-900 border-white/20" />
          <div>
            <span class="text-xs font-medium text-slate-200 block">{{ t('Sanitización Automática de Dumps (Activa)') }}</span>
            <span class="text-[11px] text-slate-400 block mt-0.5">{{ t('Remueve automáticamente cláusulas') }} <code>DEFINER</code>, <code>USE</code>, <code>CREATE DATABASE</code> {{ t('y') }} <code>SQL_LOG_BIN</code>.</span>
          </div>
        </label>

        <label v-if="cloneMode === 'full'" class="flex items-start gap-3 p-3 rounded-lg bg-slate-950/60 border border-white/[0.06] hover:border-white/10 cursor-pointer transition-colors">
          <input type="checkbox" v-model="cleanDest" class="mt-0.5 rounded text-sky-500 focus:ring-0 focus:ring-offset-0 bg-slate-900 border-white/20" />
          <div>
            <span class="text-xs font-medium text-slate-200 block">{{ t('Recrear base de datos destino (DROP DATABASE)') }}</span>
            <span class="text-[11px] text-slate-400 block mt-0.5">{{ t('Ejecuta') }} <code>DROP DATABASE IF EXISTS</code> {{ t('antes de clonar para limpiar tablas huérfanas o intentos parciales.') }}</span>
          </div>
        </label>
      </div>

      <!-- Table configuration (fast metadata, no checksums) -->
      <div class="space-y-2.5 pt-2 border-t border-white/[0.06]">
        <div class="flex items-center justify-between">
          <span class="text-xs font-medium text-slate-300">
            {{ t('Tablas a incluir ({selected} de {total} seleccionadas):', { selected: selectedTablesCount, total: availableTables.length }) }}
          </span>
          <div class="flex items-center gap-2">
            <button
              @click="excludeHeavyTables"
              class="px-2.5 py-1 bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border border-amber-500/30 rounded text-[11px] font-medium transition cursor-pointer"
            >
              {{ t('Excluir Logs / Pulse / Telemetría') }}
            </button>
            <button @click="selectAllTables(true)" class="text-xs text-sky-400 hover:text-sky-300 cursor-pointer">{{ t('Todas') }}</button>
            <span class="text-slate-600">•</span>
            <button @click="selectAllTables(false)" class="text-xs text-slate-400 hover:text-slate-300 cursor-pointer">{{ t('Ninguna') }}</button>
          </div>
        </div>

        <div v-if="isInspecting" class="p-3 text-xs text-slate-400">
          {{ t('Leyendo metadatos de las tablas...') }}
        </div>
        <div v-else-if="inspectError" class="p-3 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-200 text-xs">
          {{ t('No se pudo inspeccionar: {error}', { error: inspectError }) }}
        </div>
        <div v-else-if="inspectData" class="max-h-72 overflow-y-auto rounded-lg border border-white/[0.06]">
          <table class="w-full text-xs">
            <thead class="bg-slate-950/80 text-slate-400 sticky top-0">
              <tr>
                <th class="text-center font-medium px-2 py-2">{{ t('Incluir') }}</th>
                <th class="text-left font-medium px-2 py-2">{{ t('Tabla') }}</th>
                <th class="text-right font-medium px-2 py-2">{{ t('Filas') }}</th>
                <th class="text-right font-medium px-2 py-2">{{ t('Tamaño') }}</th>
                <th v-if="cloneMode === 'incremental'" class="text-center font-medium px-2 py-2">append-only</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="table in inspectData.tables" :key="table.name" class="border-t border-white/[0.04] hover:bg-slate-950/40">
                <td class="px-2 py-1.5 text-center">
                  <input
                    type="checkbox"
                    :value="table.name"
                    v-model="selectedTables"
                    class="rounded text-sky-500 bg-slate-900 border-white/20"
                  />
                </td>
                <td class="px-2 py-1.5 font-mono text-[11px] text-slate-200 truncate max-w-[18rem]" :title="table.name">{{ table.name }}</td>
                <td class="px-2 py-1.5 text-right font-mono text-slate-400">{{ table.rows }}</td>
                <td class="px-2 py-1.5 text-right font-mono text-slate-400">{{ formatMb(table.bytes / (1024 * 1024)) }}</td>
                <td v-if="cloneMode === 'incremental'" class="px-2 py-1.5 text-center">
                  <input
                    v-if="canMarkAppend(table)"
                    type="checkbox"
                    :checked="appendOnlyTables.includes(table.name)"
                    @change="toggleAppendOnly(table)"
                    class="rounded text-sky-500 bg-slate-900 border-white/20"
                    :title="t('Se asume que la tabla solo recibe INSERTs; si se actualizan filas existentes, desmarca esta opción.')"
                  />
                  <span v-else class="text-slate-600">—</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <p v-if="cloneMode === 'incremental'" class="text-[11px] text-amber-300/80">
          {{ t('Marca append-only las tablas grandes que solo reciben INSERTs; así no se copian completas en cada sync.') }}
        </p>

        <label v-if="cloneMode === 'incremental'" class="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
          <input type="checkbox" v-model="mirrorDest" class="rounded text-sky-500 bg-slate-900 border-white/20" />
          <span>{{ t('Espejo exacto: eliminar en destino las tablas que ya no existen en origen.') }}</span>
        </label>
        <label v-if="cloneMode === 'incremental'" class="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
          <input type="checkbox" v-model="forceChecksums" class="rounded text-sky-500 bg-slate-900 border-white/20" />
          <span>{{ t('Verificación completa (checksums, lento)') }}</span>
        </label>
        <div v-if="cloneMode === 'incremental' && inspectData && inspectData.orphanTables.length > 0" class="text-[11px] text-slate-400">
          {{ t('Huérfanas en destino: {count}', { count: inspectData.orphanTables.length }) }}
        </div>
      </div>
    </div>

    <!-- Incremental / CDC plan -->
    <div v-if="cloneMode !== 'full'" class="p-5 rounded-xl bg-slate-900/50 border border-white/[0.08] space-y-4 shadow-sm">
      <div class="flex items-center justify-between pb-3 border-b border-white/[0.06]">
        <div>
          <h3 class="text-xs font-semibold uppercase tracking-wider text-slate-200 flex items-center gap-2">
            <Shield class="w-4 h-4 text-emerald-400" />
            {{ t('Cambios detectados') }}
          </h3>
          <p class="text-xs text-slate-400 mt-0.5">{{ t('Analiza antes de aplicar: verás qué tablas se copian y cuánto se evita transferir.') }}</p>
          <p class="text-[11px] text-slate-500 mt-1">{{ t('La configuración (tablas, append-only y espejo) está en el panel de filtros, antes de analizar.') }}</p>
        </div>
        <button
          @click="analyzeChanges"
          :disabled="!canClone || isPlanning || isInspecting || !inspectData"
          class="px-4 py-2 bg-sky-600 hover:bg-sky-500 disabled:opacity-40 disabled:cursor-not-allowed text-[var(--bks-on-accent)] font-medium rounded-lg text-xs flex items-center gap-2 transition cursor-pointer"
        >
          <RefreshCw class="w-3.5 h-3.5" :class="isPlanning ? 'animate-spin' : ''" />
          <span>{{ isPlanning ? t('Analizando...') : t('Analizar cambios') }}</span>
        </button>
      </div>

      <div v-if="planError" class="p-3 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-200 text-xs">
        {{ t('No se pudo analizar: {error}', { error: planError }) }}
      </div>

      <div v-if="largeUnmarkedTables.length > 0" class="p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-200 text-xs space-y-2">
        <div>
          {{ t('Estas tablas grandes se copiarán completas cuando cambien. Si solo reciben INSERTs, márcalas append-only para copiar únicamente las filas nuevas:') }}
        </div>
        <div class="font-mono text-[11px]">
          {{ largeUnmarkedTables.map((table) => `${table.name} (${formatMb(table.bytes / (1024 * 1024))})`).join(', ') }}
        </div>
        <button
          @click="markLargeAsAppendOnly"
          class="px-2.5 py-1 bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 border border-amber-500/40 rounded text-[11px] font-medium transition cursor-pointer"
        >
          {{ t('Marcar como append-only') }}
        </button>
      </div>

      <div v-if="planStale && !syncPlan" class="p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-200 text-xs">
        {{ t('La configuración cambió. Vuelve a analizar para recalcular el plan.') }}
      </div>

      <div v-if="syncPlan" class="space-y-3">
        <div v-if="syncPlan.fingerprintMode === 'metadata' || syncPlan.fingerprintMode === 'mixed'" class="p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-200 text-xs">
          {{ t('El origen no tiene Performance Schema (o le faltan contadores): el análisis usó metadatos de InnoDB (rápido) y puede no detectar UPDATEs. Activa performance_schema en el origen (recomendado) o marca "Verificación completa" para exactitud.') }}
        </div>
        <div v-else-if="syncPlan.fingerprintMode === 'checksum'" class="p-3 rounded-lg bg-sky-500/10 border border-sky-500/30 text-sky-200 text-xs">
          {{ t('Verificación completa: el análisis leyó los datos y puede tardar.') }}
        </div>

        <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 text-xs font-mono">
          <div class="p-2.5 rounded-lg bg-slate-950/70 border border-white/[0.06]">
            <div class="text-[10px] uppercase tracking-wide text-slate-500">{{ t('Sin cambios') }}</div>
            <div class="text-slate-200 mt-0.5">{{ syncPlan.summary.unchanged }}</div>
          </div>
          <div class="p-2.5 rounded-lg bg-slate-950/70 border border-white/[0.06]">
            <div class="text-[10px] uppercase tracking-wide text-slate-500">{{ t('A copiar') }}</div>
            <div class="text-sky-300 mt-0.5">{{ syncPlan.summary.toCopy }}</div>
          </div>
          <div class="p-2.5 rounded-lg bg-slate-950/70 border border-white/[0.06]">
            <div class="text-[10px] uppercase tracking-wide text-slate-500">{{ t('Nuevas') }}</div>
            <div class="text-emerald-300 mt-0.5">{{ syncPlan.summary.newTables }}</div>
          </div>
          <div class="p-2.5 rounded-lg bg-slate-950/70 border border-white/[0.06]">
            <div class="text-[10px] uppercase tracking-wide text-slate-500">{{ t('Cambios de esquema') }}</div>
            <div class="text-amber-300 mt-0.5">{{ syncPlan.summary.schemaChanged }}</div>
          </div>
          <div class="p-2.5 rounded-lg bg-slate-950/70 border border-white/[0.06]">
            <div class="text-[10px] uppercase tracking-wide text-slate-500">{{ t('Huérfanas en destino') }}</div>
            <div class="text-slate-300 mt-0.5">{{ syncPlan.summary.orphan }}</div>
          </div>
          <div class="p-2.5 rounded-lg bg-slate-950/70 border border-white/[0.06]">
            <div class="text-[10px] uppercase tracking-wide text-slate-500">{{ t('Bytes a transferir') }}</div>
            <div class="text-white mt-0.5">{{ formatMb(syncPlan.summary.bytesToCopy / (1024 * 1024)) }}</div>
          </div>
        </div>

        <div v-if="syncPlan.mode === 'cdc'" class="p-3 rounded-lg bg-slate-950/70 border border-white/[0.06] text-xs text-slate-300">
          <span class="font-medium text-slate-200">{{ t('Modo CDC (solo cambios)') }}</span>
          <span v-if="syncPlan.cdc?.available" class="text-emerald-300"> · {{ syncPlan.cdc.engine }}</span>
          <span v-else class="text-amber-300"> · {{ t('CDC no disponible: {reason}', { reason: syncPlan.cdc?.reason || '' }) }}</span>
          <span v-if="syncPlan.requiresFull" class="text-amber-300"> · {{ t('Ejecuta primero un clon completo para registrar la posición.') }}</span>
        </div>

        <div class="max-h-64 overflow-y-auto rounded-lg border border-white/[0.06]">
          <table class="w-full text-xs">
            <thead class="bg-slate-950/80 text-slate-400 sticky top-0">
              <tr>
                <th class="text-left font-medium px-3 py-2">{{ t('Tabla') }}</th>
                <th class="text-left font-medium px-3 py-2">{{ t('Estado') }}</th>
                <th class="text-right font-medium px-3 py-2">{{ t('Filas') }}</th>
                <th class="text-right font-medium px-3 py-2">{{ t('Tamaño') }}</th>
                <th class="text-center font-medium px-3 py-2">append-only</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="table in sortedPlanTables" :key="table.name" class="border-t border-white/[0.04] hover:bg-slate-950/40">
                <td class="px-3 py-1.5 font-mono text-[11px] text-slate-200 truncate max-w-[18rem]" :title="table.name">{{ table.name }}</td>
                <td class="px-3 py-1.5">
                  <span :class="actionClass(table.action)" class="px-2 py-0.5 rounded text-[10px] font-medium border">
                    {{ actionLabel(table.action) }}
                  </span>
                </td>
                <td class="px-3 py-1.5 text-right font-mono text-slate-400">{{ table.rows }}</td>
                <td class="px-3 py-1.5 text-right font-mono text-slate-400">{{ formatMb(table.bytes / (1024 * 1024)) }}</td>
                <td class="px-3 py-1.5 text-center">
                  <span v-if="table.appendOnly" class="text-emerald-300 text-[10px] font-medium">append-only</span>
                  <span v-else class="text-slate-600" :title="t('No marcada: si la tabla cambia, se copiará completa.')">—</span>
                </td>
              </tr>
            </tbody>
          </table>
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
            <span class="font-semibold text-rose-300 text-sm block">{{ t('Error en la transferencia') }}</span>
            <p class="font-mono text-xs text-rose-200/90 whitespace-pre-wrap leading-relaxed">{{ cloneError }}</p>
          </div>
        </div>
        <div class="flex items-center gap-2 shrink-0">
          <button
            @click="copyError"
            type="button"
            class="px-2.5 py-1 bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 hover:text-white rounded border border-rose-500/40 text-xs flex items-center gap-1.5 transition cursor-pointer font-sans"
            :title="t('Copiar mensaje de error al portapapeles')"
          >
            <Check v-if="copiedError" class="w-3.5 h-3.5 text-emerald-400" />
            <Copy v-else class="w-3.5 h-3.5" />
            <span>{{ copiedError ? t('¡Copiado!') : t('Copiar Error') }}</span>
          </button>
          <button
            @click="cloneError = null"
            class="text-rose-400 hover:text-white p-1 rounded transition cursor-pointer text-xs"
            :title="t('Cerrar alerta')"
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
          <span class="font-semibold text-emerald-300 text-sm block">{{ t('¡Clonado completado exitosamente!') }}</span>
          <span class="text-xs text-emerald-200/90">{{ cloneSuccess }}</span>
        </div>
      </div>
      <button
        @click="cloneSuccess = null"
        class="text-emerald-400 hover:text-white p-1 rounded transition cursor-pointer text-xs shrink-0"
        :title="t('Cerrar alerta')"
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
            :disabled="!canClone || isPlanning || isInspecting || (cloneMode !== 'full' && (!inspectData || !syncPlanId || !hasChanges))"
            class="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed text-[var(--bks-on-accent)] font-medium rounded-lg text-xs flex items-center gap-2 transition shadow-sm cursor-pointer active:scale-[0.98]"
          >
            <Play class="w-4 h-4 fill-current" />
            <span>{{ primaryActionLabel }}</span>
          </button>
          <span v-if="cloneMotorUnsupported" class="text-[11px] text-amber-400">
            {{ t('Clonado en streaming no soportado para {engine} todavía.', { engine: source.motor.toUpperCase() }) }}
          </span>
          <span v-else-if="cloneMotorMismatch" class="text-[11px] text-amber-400">
            {{ t('Origen ({source}) y destino ({dest}) deben ser el mismo motor.', { source: source.motor.toUpperCase(), dest: dest.motor.toUpperCase() }) }}
          </span>
          <span v-else-if="cloneMode !== 'full' && !syncPlanId" class="text-[11px] text-slate-400">
            {{ t('Sin plan. Analiza los cambios primero.') }}
          </span>
          <span v-else-if="cloneMode !== 'full' && syncPlan && !hasChanges" class="text-[11px] text-emerald-400">
            {{ t('No hay cambios que aplicar.') }}
          </span>
        </div>

        <button
          v-else
          @click="stopClone"
          class="px-5 py-2.5 bg-rose-600 hover:bg-rose-500 text-[var(--bks-on-accent)] font-medium rounded-lg text-xs flex items-center gap-2 transition shadow-sm cursor-pointer animate-pulse active:scale-[0.98]"
        >
          <Square class="w-4 h-4 fill-current" />
          <span>{{ t('Detener Operación') }}</span>
        </button>

        <div v-if="isCloning" class="text-xs text-slate-400 flex items-center gap-4 font-mono">
          <template v-if="cloneMode === 'full'">
            <span>{{ t('Velocidad:') }} <strong class="text-white">{{ progress.speedMb }} MB/s</strong></span>
            <span>{{ t('Transferido:') }} <strong class="text-sky-400">{{ progress.mb }} MB</strong></span>
            <span>{{ t('Tiempo:') }} <strong class="text-white">{{ progress.elapsedSec }}s</strong></span>
          </template>
          <template v-else>
            <span>{{ t('Transferido:') }} <strong class="text-sky-400">{{ syncProgress.mb }} MB</strong></span>
            <span>{{ t('Progreso incremental:') }} <strong class="text-white">{{ syncProgress.percent }}%</strong></span>
          </template>
        </div>
      </div>

      <!-- Animated Progress Bar with real percentage & ETA -->
      <div v-if="isCloning" class="space-y-1.5">
        <div class="flex items-center justify-between text-xs text-slate-300 font-mono">
          <span v-if="cloneMode === 'full'">
            {{ t('Progreso aproximado:') }} <strong class="text-sky-400">{{ transferPercent }}%</strong>
            <span class="text-slate-500 text-[11px] ml-1">
              {{ t('({mb} MB de ~{total})', { mb: progress.mb, total: formatMb(sourceDbStats?.mb || 4000) }) }}
            </span>
          </span>
          <span v-else>
            {{ t('Progreso:') }} <strong class="text-sky-400">{{ syncProgress.percent }}%</strong>
            <span class="text-slate-500 text-[11px] ml-1">
              {{ t('({mb} MB de ~{total})', { mb: syncProgress.mb, total: formatMb(syncProgress.totalBytes / (1024 * 1024)) }) }}
            </span>
          </span>
          <span v-if="cloneMode === 'full' && estimatedTimeRemaining" class="text-emerald-400 text-xs font-mono flex items-center gap-1">
            <span>{{ t('Restante estimado:') }}</span>
            <strong class="text-emerald-300">~{{ estimatedTimeRemaining }}</strong>
          </span>
        </div>
        <div class="w-full bg-slate-950 rounded-full h-2.5 overflow-hidden border border-white/[0.08]">
          <div
            class="bg-gradient-to-r from-sky-500 via-teal-400 to-emerald-400 h-full transition-all duration-300 rounded-full"
            :style="{ width: `${Math.max(3, cloneMode === 'full' ? transferPercent : syncProgress.percent)}%` }"
          ></div>
        </div>
      </div>

      <!-- Console Log Box with Toolbar -->
      <div v-if="logs.length > 0" class="mt-3 rounded-lg border border-white/[0.08] bg-slate-950 overflow-hidden shadow-inner">
        <!-- Log Toolbar -->
        <div class="px-3 py-1.5 bg-slate-900/90 border-b border-white/[0.06] flex items-center justify-between text-[11px] select-none">
          <div class="flex items-center gap-2 text-slate-400 font-mono">
            <Terminal class="w-3.5 h-3.5 text-sky-400" />
            <span>{{ t('Terminal de Streaming ({count} eventos)', { count: logs.length }) }}</span>
          </div>
          <div class="flex items-center gap-2">
            <button
              @click="copyLogs"
              type="button"
              class="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white transition flex items-center gap-1.5 cursor-pointer font-sans text-xs border border-white/10"
              :title="t('Copiar todos los logs al portapapeles')"
            >
              <Check v-if="copiedLogs" class="w-3 h-3 text-emerald-400" />
              <Copy v-else class="w-3 h-3 text-slate-400" />
              <span>{{ copiedLogs ? t('¡Copiado!') : t('Copiar Logs') }}</span>
            </button>
            <button
              @click="clearLogs"
              type="button"
              class="px-2 py-1 rounded hover:bg-slate-800 text-slate-400 hover:text-rose-300 transition text-xs font-sans flex items-center gap-1 cursor-pointer"
              :title="t('Limpiar terminal')"
            >
              <Trash2 class="w-3 h-3" />
              <span>{{ t('Limpiar') }}</span>
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
import { ref, computed, onMounted, nextTick, watch } from 'vue';
import {
  RefreshCw,
  Shield,
  Play,
  Square,
  CheckCircle,
  XCircle,
  Terminal,
  Copy,
  Check,
  Trash2
} from 'lucide-vue-next';
import CompanionOfflineBanner from './CompanionOfflineBanner.vue';
import {
  checkCompanionStatus,
  getSavedConnections,
  getDatabaseInfo,
  startStreamClone,
  inspectSyncClone,
  planSyncClone,
  startSyncClone,
  getCdcStatus,
  formatConnOption,
  type SavedConnection,
  type SyncInspect,
  type SyncInspectTable,
  type SyncPlan
} from '../services/companion';
import {
  fetchCurrentConnection,
  copyToSystemClipboard,
  type ConnectionData
} from '../services/beekeeper';
import { listDatabasesForConnection } from '../services/connectionAccess';
import { normalizeMotor, CLONE_STREAM_ENGINES } from '../../shared/dbEngines.js';
import SearchableSelect from './SearchableSelect.vue';
import { t } from '../i18n';

const daemonConnected = ref(false);
const daemonFeatures = ref<Record<string, boolean>>({});
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
const cleanDest = ref(true);

const cloneMode = ref<'full' | 'incremental' | 'cdc'>('incremental');
const syncPlan = ref<SyncPlan | null>(null);
const syncPlanId = ref<string | null>(null);
const isPlanning = ref(false);
const planError = ref<string | null>(null);
const appendOnlyTables = ref<string[]>([]);
const forceFullTables = ref<string[]>([]);
const mirrorDest = ref(false);
const forceChecksums = ref(false);
const cdcStatus = ref<SyncPlan['cdc'] | null>(null);
const syncProgress = ref({ bytes: 0, totalBytes: 0, mb: '0', totalMb: '0', percent: 0 });
const syncTableStatus = ref<Record<string, string>>({});

// Fast metadata pass: table catalog + sizes + PKs + orphan tables + the
// append-only modes remembered by the manifest. This is what the user
// configures before running the expensive checksum analysis.
const inspectData = ref<SyncInspect | null>(null);
const isInspecting = ref(false);
const inspectError = ref<string | null>(null);
const planConfigHash = ref<string | null>(null);
const planStale = ref(false);

const sourceDbStats = ref<{ mb: number; tables: number } | null>(null);
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
let planRequestId = 0;
let cdcRequestId = 0;

function formatMb(mb: number | undefined | null) {
  if (!mb) return '0 MB';
  if (mb >= 1024) {
    return `${(mb / 1024).toFixed(2)} GB`;
  }
  return `${mb.toFixed(1)} MB`;
}

const transferPercent = computed(() => {
  const currentMb = parseFloat(progress.value.mb) || 0;
  // Use the real on-disk size, not the old `mb * 2.8` SQL estimate: the dump
  // can be larger or smaller, so this is explicitly approximate.
  const totalMb = sourceDbStats.value?.mb || 4000;
  if (totalMb <= 0) return 0;
  const pct = Math.round((currentMb / totalMb) * 100);
  return Math.min(99, Math.max(0, pct));
});

const estimatedTimeRemaining = computed(() => {
  const currentMb = parseFloat(progress.value.mb) || 0;
  const speed = parseFloat(progress.value.speedMb) || 0;
  const totalMb = sourceDbStats.value?.mb || 4000;
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

const primaryActionLabel = computed(() => {
  if (cloneMode.value === 'full') return t('Iniciar Clonado Stream');
  if (cloneMode.value === 'cdc') {
    return syncPlanId.value ? t('Iniciar Sync CDC') : t('Analizar cambios');
  }
  return syncPlanId.value ? t('Iniciar Sync Incremental') : t('Analizar cambios');
});

const sortedPlanTables = computed(() => {
  if (!syncPlan.value) return [];
  // Largest first: the table that dominates the transfer should be the one
  // the user sees (and can mark append-only) without scrolling.
  return [...syncPlan.value.tables].sort((a, b) => b.bytes - a.bytes);
});

const hasChanges = computed(() => Boolean(
  syncPlan.value &&
  (syncPlan.value.summary.toCopy > 0 || syncPlan.value.summary.dropped > 0)
));

const LARGE_TABLE_THRESHOLD = 256 * 1024 * 1024;
const largeUnmarkedTables = computed(() => {
  if (!inspectData.value) return [];
  const included = new Set(selectedTables.value);
  return inspectData.value.tables
    .filter((table) =>
      included.has(table.name) &&
      canMarkAppend(table) &&
      !appendOnlyTables.value.includes(table.name)
    )
    .filter((table) => table.bytes >= LARGE_TABLE_THRESHOLD)
    .sort((a, b) => b.bytes - a.bytes);
});

function markLargeAsAppendOnly() {
  for (const table of largeUnmarkedTables.value) {
    if (!appendOnlyTables.value.includes(table.name)) appendOnlyTables.value.push(table.name);
    forceFullTables.value = forceFullTables.value.filter((name) => name !== table.name);
  }
  invalidatePlan();
}

function buildSyncParams() {
  const excluded = availableTables.value.filter((tbl) => !selectedTables.value.includes(tbl));
  return {
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
    appendOnlyTables: appendOnlyTables.value,
    forceFullTables: forceFullTables.value,
    mirror: mirrorDest.value,
    forceChecksums: forceChecksums.value,
    mode: cloneMode.value === 'cdc' ? ('cdc' as const) : ('incremental' as const)
  };
}

async function checkCdc() {
  if (!canClone.value) {
    cdcStatus.value = { available: false, reason: t('Selecciona origen y destino primero.') };
    return;
  }
  const requestId = ++cdcRequestId;
  const res = await getCdcStatus(buildSyncParams());
  if (requestId !== cdcRequestId) return;
  cdcStatus.value = res.ok
    ? res.capabilities
    : { available: false, reason: res.error };
  invalidatePlan();
}

function invalidatePlan(markStale = true) {
  if (markStale && syncPlanId.value) planStale.value = true;
  planRequestId += 1;
  isPlanning.value = false;
  syncPlan.value = null;
  syncPlanId.value = null;
  planConfigHash.value = null;
  planError.value = null;
  syncTableStatus.value = {};
}

async function analyzeChanges() {
  if (!canClone.value || isPlanning.value || !inspectData.value) return;
  planError.value = null;
  invalidatePlan(false);
  planStale.value = false;
  isPlanning.value = true;
  const requestId = planRequestId;
  const res = await planSyncClone(buildSyncParams());
  if (requestId !== planRequestId) return;
  isPlanning.value = false;
  if (!res.ok) {
    planError.value = res.error;
    return;
  }
  syncPlan.value = res.plan;
  syncPlanId.value = res.planId;
  planConfigHash.value = res.configHash;
}

async function loadInspect() {
  invalidatePlan(false);
  planStale.value = false;
  if (!source.value.db || !dest.value.db) {
    inspectData.value = null;
    availableTables.value = [];
    selectedTables.value = [];
    return;
  }

  isInspecting.value = true;
  inspectError.value = null;
  const res = await inspectSyncClone(buildSyncParams());
  isInspecting.value = false;
  if (!res.ok) {
    inspectError.value = res.error;
    inspectData.value = null;
    return;
  }

  inspectData.value = res.data;
  availableTables.value = res.data.tables.map((table) => table.name);
  selectedTables.value = [...availableTables.value];
  // The manifest remembers append-only across sessions; pre-check those so
  // the user does not have to re-mark the big table on every visit.
  appendOnlyTables.value = res.data.manifestAppendTables
    .filter((name) => availableTables.value.includes(name));
  forceFullTables.value = [];
}

function canMarkAppend(table: SyncInspectTable) {
  return table.type !== 'view' && Boolean(table.primaryKey) && table.autoIncrement;
}

function toggleAppendOnly(table: SyncInspectTable) {
  if (appendOnlyTables.value.includes(table.name)) {
    // The manifest remembers append mode across sessions; unchecking it must
    // be an explicit override, not just an absent checkbox.
    if (!forceFullTables.value.includes(table.name)) forceFullTables.value.push(table.name);
    appendOnlyTables.value = appendOnlyTables.value.filter((name) => name !== table.name);
  } else {
    if (!appendOnlyTables.value.includes(table.name)) appendOnlyTables.value.push(table.name);
    forceFullTables.value = forceFullTables.value.filter((name) => name !== table.name);
  }
  invalidatePlan();
}

function actionLabel(action: string) {
  if (action === 'skip') return t('Sin cambios');
  if (action === 'append') return t('Solo filas nuevas');
  if (action === 'drop') return t('Eliminar en destino');
  return t('Copiar completa');
}

function actionClass(action: string) {
  if (action === 'skip') return 'bg-slate-500/10 text-slate-400 border-slate-500/20';
  if (action === 'append') return 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30';
  if (action === 'drop') return 'bg-rose-500/10 text-rose-300 border-rose-500/30';
  return 'bg-sky-500/10 text-sky-300 border-sky-500/30';
}

function startIncrementalSync() {
  if (!syncPlanId.value || !hasChanges.value) return;
  isCloning.value = true;
  cloneError.value = null;
  cloneSuccess.value = null;
  logs.value = [];
  syncTableStatus.value = {};
  syncProgress.value = {
    bytes: 0,
    totalBytes: syncPlan.value?.summary.bytesToCopy || 0,
    mb: '0',
    totalMb: ((syncPlan.value?.summary.bytesToCopy || 0) / (1024 * 1024)).toFixed(2),
    percent: 0
  };

  stopCloneFn = startSyncClone(
    {
      planId: syncPlanId.value,
      configHash: planConfigHash.value || undefined,
      maskData: maskData.value,
      // Sequential full-table copies avoid MySQL metadata-lock deadlocks
      // between related tables; the large table dominates the total time.
      concurrency: 1,
      // Counting both sides is an extra scan and can produce false failures
      // on a live source that changes during the copy; the dump/restore exit
      // code and stderr ERROR tracking are the primary correctness signals.
      verify: false
    },
    {
      onLog: (msg) => {
        logs.value.push(msg);
        scrollToBottom();
      },
      onProgress: (p) => {
        syncProgress.value = p;
      },
      onTableStart: (info) => {
        syncTableStatus.value[info.table] = 'running';
        logs.value.push(`[SYNC] ${info.table} (${info.action})`);
        scrollToBottom();
      },
      onTableDone: (info) => {
        syncTableStatus.value[info.table] = 'ok';
        logs.value.push(`✔ ${info.table}`);
        scrollToBottom();
      },
      onTableError: (info) => {
        syncTableStatus.value[info.table] = 'error';
        logs.value.push(`✘ ${info.table}: ${info.message}`);
        scrollToBottom();
      },
      onComplete: (res) => {
        cloneSuccess.value = res.message;
        isCloning.value = false;
        logs.value.push(res.message);
        scrollToBottom();
      },
      onError: (err) => {
        cloneError.value = err;
        isCloning.value = false;
        logs.value.push(`✘ ${err}`);
        scrollToBottom();
      }
    }
  );
}

// Source/destination changes invalidate the plan and the CDC probe. The
// table catalog is reloaded by onSourceDbChange / onDestDbChange / loadInspect.
watch(
  [
    () => source.value.host,
    () => source.value.port,
    () => source.value.user,
    () => source.value.db,
    () => source.value.motor,
    () => dest.value.host,
    () => dest.value.port,
    () => dest.value.user,
    () => dest.value.db
  ],
  () => {
    cdcRequestId += 1;
    cdcStatus.value = null;
    invalidatePlan();
  }
);

// Configuration changes (included tables, append-only, force-full, mirror)
// invalidate the plan. maskData is deliberately NOT here: it is an apply
// option and does not change what the plan computes.
watch(
  [selectedTables, appendOnlyTables, forceFullTables, () => mirrorDest.value, () => forceChecksums.value],
  () => invalidatePlan(),
  { deep: true }
);

const daemonSupportsIncremental = computed(() => daemonFeatures.value.incrementalSync === true);

async function checkDaemon() {
  const status = await checkCompanionStatus();
  daemonConnected.value = Boolean(status?.ok);
  daemonFeatures.value = status?.features || {};
  // An old daemon (started before incremental sync existed) must not leave
  // the UI in a mode whose endpoints it does not implement.
  if (daemonConnected.value && !daemonSupportsIncremental.value && cloneMode.value !== 'full') {
    cloneMode.value = 'full';
  }
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
    await loadInspect();
  }
}

async function loadSourceDbs() {
  loadingSourceDbs.value = true;

  const isCurrentActive = Boolean(
    currentBksConn.value &&
    (selectedSourceConn.value?.name?.toLowerCase() === currentBksConn.value.connectionName?.toLowerCase() ||
      selectedSourceConn.value?.id === `bks-${(currentBksConn.value as any).id}`)
  );

  sourceDbs.value = await listDatabasesForConnection({
    motor: source.value.motor,
    host: source.value.host,
    port: source.value.port,
    user: source.value.user,
    pass: source.value.pass,
    name: selectedSourceConn.value !== 'custom' ? selectedSourceConn.value?.name : undefined,
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
    await loadInspect();
    await loadSourceDbStats();
  }
}

async function loadDestDbs() {
  if (!dest.value.host || !dest.value.user) return;
  loadingDestDbs.value = true;

  const isCurrentActive = Boolean(
    currentBksConn.value &&
    (selectedDestConn.value?.name?.toLowerCase() === currentBksConn.value.connectionName?.toLowerCase() ||
      selectedDestConn.value?.id === `bks-${(currentBksConn.value as any).id}`)
  );

  destDbs.value = await listDatabasesForConnection({
    motor: dest.value.motor,
    host: dest.value.host,
    port: dest.value.port,
    user: dest.value.user,
    pass: dest.value.pass,
    name: selectedDestConn.value !== 'custom' ? selectedDestConn.value?.name : undefined,
    isCurrentActive
  });
  loadingDestDbs.value = false;
}

async function onSourceDbChange() {
  syncDestDbWithSource();
  await loadInspect();
  await loadSourceDbStats();
}

async function onDestDbChange() {
  await loadInspect();
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

function selectAllTables(val: boolean) {
  selectedTables.value = val ? [...availableTables.value] : [];
}

function excludeHeavyTables() {
  // Logs/telemetry only. The big `analisis_financiero_jsons` table is NOT
  // excluded here on purpose: it is business data, and the incremental mode
  // can copy only its new rows when the user marks it append-only.
  const heavyKeywords = [
    'pulse_',
    'telescope_',
    'log',
    'audit',
    'activity',
    'sessions',
    'cache'
  ];
  selectedTables.value = availableTables.value.filter((tbl) => {
    const lower = tbl.toLowerCase();
    return !heavyKeywords.some((k) => lower.includes(k));
  });
}

function startClone() {
  if (!canClone.value) return;

  if (cloneMode.value !== 'full') {
    if (!syncPlanId.value) {
      void analyzeChanges();
      return;
    }
    startIncrementalSync();
    return;
  }

  const excluded = availableTables.value.filter((tbl) => !selectedTables.value.includes(tbl));
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
      maskData: maskData.value,
      cleanDest: cleanDest.value
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
  logs.value.push(t('⏹ Clonado cancelado por el usuario.'));
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

const COMPANION_URL = 'http://127.0.0.1:58765';

// Token obtained from /api/status on the first successful health check.
// All privileged endpoints require this token in the X-Companion-Token header.
let companionToken: string | null = null;

export interface CompanionStatus {
  ok: boolean;
  version: string;
  tools: Record<string, boolean>;
  features?: Record<string, boolean>;
}

export interface SavedConnection {
  id: string | number;
  name: string;
  motor: string;
  host: string;
  port: number | null;
  user: string;
  hasPassword: boolean;
  isBeekeeper?: boolean;
  defaultDatabase?: string;
  path?: string;
  url?: string;
}

export function formatConnOption(conn: SavedConnection, allConns: SavedConnection[]): string {
  const icon = conn.isBeekeeper ? '🗄️' : '⚡';
  const duplicates = allConns.filter(
    (item) => item.name.trim().toLowerCase() === conn.name.trim().toLowerCase()
  );
  if (duplicates.length > 1) {
    return `${icon} ${conn.name} (${conn.motor.toUpperCase()} :${conn.port})`;
  }
  return `${icon} ${conn.name} (${conn.motor.toUpperCase()})`;
}

export interface DockerContainer {
  id: string;
  name: string;
  image: string;
  status: string;
  ports: string;
  hostPort: number | null;
  internalPort?: number | null;
  motor: string;
  label?: string;
  suggestedUser: string;
  connUrl?: string;
}

export interface DiscoveredProject {
  uniqueKey?: string;
  name: string;
  fileName?: string;
  path: string;
  filePath?: string;
  fileSize?: string;
  motor: string;
  host: string;
  port: number | null;
  database: string;
  username: string;
  hasPassword: boolean;
  isLocalFile?: boolean;
  connUrl?: string;
}

function authHeaders(): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (companionToken) {
    h['X-Companion-Token'] = companionToken;
  }
  return h;
}

export async function saveConnectionToBeekeeper(params: {
  name: string;
  motor: string;
  host?: string;
  port?: number | null;
  user?: string;
  password?: string;
  database?: string;
  path?: string;
  url?: string;
}): Promise<{ success: boolean; alreadyExists?: boolean; message: string }> {
  try {
    const res = await fetch(`${COMPANION_URL}/api/conns/save`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(params)
    });
    return await res.json();
  } catch (err: any) {
    return { success: false, message: err.message || 'Error al conectar con el daemon companion' };
  }
}

export async function checkCompanionStatus(): Promise<CompanionStatus | null> {
  try {
    const res = await fetch(`${COMPANION_URL}/api/status`, { signal: AbortSignal.timeout(1500) });
    if (!res.ok) return null;
    const data = await res.json();
    if (data.token) {
      companionToken = data.token;
    }
    return data as CompanionStatus;
  } catch {
    return null;
  }
}

export async function getSavedConnections(): Promise<SavedConnection[]> {
  try {
    const res = await fetch(`${COMPANION_URL}/api/conns`, {
      headers: authHeaders()
    });
    const data = await res.json();
    return data.conns || [];
  } catch (err) {
    console.error('Error fetching conns from companion:', err);
    return [];
  }
}

export async function getDockerContainers(): Promise<DockerContainer[]> {
  try {
    const res = await fetch(`${COMPANION_URL}/api/docker`, {
      headers: authHeaders()
    });
    const data = await res.json();
    return data.containers || [];
  } catch (err) {
    console.error('Error fetching docker containers:', err);
    return [];
  }
}

export async function getDiscoveredProjects(params?: {
  path?: string;
  depth?: number;
}): Promise<DiscoveredProject[]> {
  try {
    const q = new URLSearchParams();
    if (params?.path) q.set('path', params.path);
    if (params?.depth) q.set('depth', String(params.depth));
    const url = `${COMPANION_URL}/api/discovery/projects${q.toString() ? '?' + q.toString() : ''}`;
    const res = await fetch(url, {
      headers: authHeaders()
    });
    const data = await res.json();
    return data.projects || [];
  } catch (err) {
    console.error('Error discovering projects:', err);
    return [];
  }
}

export async function getDatabasesList(params: {
  motor: string;
  host: string;
  port: number;
  user: string;
  pass?: string;
  name?: string;
}): Promise<string[]> {
  try {
    const res = await fetch(`${COMPANION_URL}/api/databases`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(params)
    });
    const data = await res.json();
    return data.databases || [];
  } catch {
    return [];
  }
}

export async function getTablesList(params: {
  motor: string;
  host: string;
  port: number;
  user: string;
  pass?: string;
  database: string;
}): Promise<string[]> {
  try {
    const res = await fetch(`${COMPANION_URL}/api/tables`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(params)
    });
    const data = await res.json();
    return data.tables || [];
  } catch {
    return [];
  }
}

export async function getDatabaseInfo(params: {
  motor: string;
  host: string;
  port: number;
  user: string;
  pass?: string;
  database: string;
  name?: string;
}): Promise<{ mb: number; tables: number }> {
  try {
    const res = await fetch(`${COMPANION_URL}/api/database/info`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(params)
    });
    const data = await res.json();
    return {
      mb: data.mb || 0,
      tables: data.tables || 0
    };
  } catch {
    return { mb: 0, tables: 0 };
  }
}

export interface ColumnMeta {
  table: string;
  column: string;
  type: string;
  nullable: string;
  defaultVal: string | null;
}

export async function inspectSchema(params: {
  motor?: string;
  host: string;
  port: number;
  user: string;
  pass?: string;
  database: string;
  name?: string;
}): Promise<ColumnMeta[]> {
  try {
    const res = await fetch(`${COMPANION_URL}/api/schema/inspect`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(params)
    });
    const data = await res.json();
    return data.columns || [];
  } catch (err) {
    console.error('Error inspecting schema from companion:', err);
    return [];
  }
}

export interface SyncCloneParams {
  srcHost: string;
  srcPort: number;
  srcUser: string;
  srcPass?: string;
  srcDb: string;
  dstHost: string;
  dstPort: number;
  dstUser: string;
  dstPass?: string;
  dstDb: string;
  motor?: string;
  excludeTables?: string[];
  appendOnlyTables?: string[];
  forceFullTables?: string[];
  forceFull?: boolean;
  forceChecksums?: boolean;
  mirror?: boolean;
  mode?: 'incremental' | 'cdc';
}

export interface SyncPlanTable {
  name: string;
  type: 'table' | 'view';
  bytes: number;
  rows: number;
  primaryKey: string | null;
  primaryKeyType: string | null;
  autoIncrement: boolean;
  appendOnly: boolean;
  schemaHash: string | null;
  action: 'full' | 'skip' | 'append' | 'drop';
  reason: string;
  checksum: string | null;
  maxKey?: string | number | null;
  appendRows?: number;
  nextMode?: 'full' | 'append';
}

export interface SyncPlanSummary {
  totalTables: number;
  unchanged: number;
  toCopy: number;
  newTables: number;
  schemaChanged: number;
  orphan: number;
  dropped: number;
  appendOnly: number;
  bytesToCopy: number;
  bytesSkipped: number;
}

export interface SyncInspectTable {
  name: string;
  type: 'table' | 'view';
  rows: number;
  bytes: number;
  primaryKey: string | null;
  primaryKeyType: string | null;
  autoIncrement: boolean;
}

export interface SyncInspect {
  source: { host: string; port: number; db: string };
  dest: { host: string; port: number; db: string };
  identity: { serverUuid: string | null; version: string | null };
  capabilities: Record<string, unknown>;
  hasManifest: boolean;
  manifestUpdatedAt: string | null;
  tables: SyncInspectTable[];
  destinationTables: string[];
  orphanTables: string[];
  manifestAppendTables: string[];
}

export interface SyncPlan {
  mode: 'incremental' | 'cdc';
  engine: string | null;
  capabilities: Record<string, unknown>;
  fingerprintMode?: 'stats' | 'metadata' | 'mixed' | 'checksum' | null;
  source: { host: string; port: number; db: string; serverUuid?: string | null; version?: string | null };
  dest: { host: string; port: number; db: string };
  tables: SyncPlanTable[];
  summary: SyncPlanSummary;
  cdc?: {
    available?: boolean;
    engine?: string;
    reason?: string;
    from?: { file: string; position: number; gtid?: string | null } | null;
    to?: { file: string; position: number; gtid?: string | null } | null;
    binlogs?: string[];
  };
  requiresFull?: boolean;
  reason?: string;
}

/**
 * POST with a one-shot token refresh. The daemon generates a new token on
 * every restart, so a tool window that was already open when the service was
 * restarted would otherwise fail with a 401 until it is reopened.
 */
async function postJsonWithTokenRetry(url: string, body: unknown): Promise<Response> {
  let res = await fetch(url, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(body)
  });
  if (res.status === 401) {
    await checkCompanionStatus();
    res = await fetch(url, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(body)
    });
  }
  return res;
}

export async function inspectSyncClone(
  params: SyncCloneParams
): Promise<{ ok: true; data: SyncInspect } | { ok: false; error: string }> {
  try {
    const res = await postJsonWithTokenRetry(`${COMPANION_URL}/api/clone/sync/inspect`, params);
    const text = await res.text();
    let data: any = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      return {
        ok: false,
        error: `El Companion respondió con HTML (HTTP ${res.status}). Reinícialo para cargar los endpoints de sincronización incremental.`
      };
    }
    if (!res.ok) {
      return { ok: false, error: data.error || `HTTP Error ${res.status}: ${res.statusText}` };
    }
    return { ok: true, data };
  } catch (err: any) {
    return { ok: false, error: err.message || 'Error al conectar con el daemon companion' };
  }
}

export async function planSyncClone(
  params: SyncCloneParams
): Promise<{ ok: true; planId: string; plan: SyncPlan; hasManifest: boolean; configHash: string } | { ok: false; error: string }> {
  try {
    const res = await postJsonWithTokenRetry(`${COMPANION_URL}/api/clone/sync/plan`, params);
    const text = await res.text();
    let data: any = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      return {
        ok: false,
        error: `El Companion respondió con HTML (HTTP ${res.status}). Reinícialo para cargar los endpoints de sincronización incremental.`
      };
    }
    if (!res.ok) {
      return { ok: false, error: data.error || `HTTP Error ${res.status}: ${res.statusText}` };
    }
    return {
      ok: true,
      planId: data.planId,
      plan: data.plan,
      hasManifest: Boolean(data.hasManifest),
      configHash: data.configHash
    };
  } catch (err: any) {
    return { ok: false, error: err.message || 'Error al conectar con el daemon companion' };
  }
}

export async function getCdcStatus(
  params: SyncCloneParams
): Promise<{ ok: true; capabilities: SyncPlan['cdc'] } | { ok: false; error: string }> {
  try {
    const res = await postJsonWithTokenRetry(`${COMPANION_URL}/api/clone/cdc/status`, params);
    const text = await res.text();
    let data: any = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      return {
        ok: false,
        error: `El Companion respondió con HTML (HTTP ${res.status}). Reinícialo para cargar el soporte CDC.`
      };
    }
    if (!res.ok) return { ok: false, error: data.error || `HTTP Error ${res.status}` };
    return { ok: true, capabilities: data.capabilities };
  } catch (err: any) {
    return { ok: false, error: err.message || 'Error al conectar con el daemon companion' };
  }
}

export function startSyncClone(
  params: { planId: string; configHash?: string; maskData?: boolean; concurrency?: number; verify?: boolean },
  callbacks: {
    onLog: (msg: string) => void;
    onProgress: (info: { bytes: number; totalBytes: number; mb: string; totalMb: string; percent: number }) => void;
    onTableStart: (info: { table: string; action: string }) => void;
    onTableDone: (info: { table: string; action: string; ok: boolean; rows?: number }) => void;
    onTableError: (info: { table: string; message: string }) => void;
    onComplete: (info: { message: string; bytes: number }) => void;
    onError: (err: string) => void;
  }
): () => void {
  const controller = new AbortController();
  let errorReported = false;
  let isCompleted = false;

  fetch(`${COMPANION_URL}/api/clone/sync/apply`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(params),
    signal: controller.signal
  })
    .then(async (response) => {
      if (!response.ok) {
        errorReported = true;
        const data = await response.json().catch(() => ({}));
        callbacks.onError(data.error || `HTTP Error ${response.status}: ${response.statusText}`);
        return;
      }

      const reader = response.body?.getReader();
      if (!reader) return;

      const decoder = new TextDecoder();
      let buffer = '';

      const processBlock = (block: string) => {
        const eventMatch = block.match(/^event: (.*)$/m);
        const dataMatch = block.match(/^data: (.*)$/m);
        if (!eventMatch || !dataMatch) return;

        const event = eventMatch[1].trim();
        try {
          const data = JSON.parse(dataMatch[1]);
          if (event === 'log') callbacks.onLog(data.message);
          else if (event === 'progress') callbacks.onProgress(data);
          else if (event === 'table-start') callbacks.onTableStart(data);
          else if (event === 'table-done') callbacks.onTableDone(data);
          else if (event === 'table-error') callbacks.onTableError(data);
          else if (event === 'complete') {
            isCompleted = true;
            callbacks.onComplete(data);
          } else if (event === 'error') {
            errorReported = true;
            callbacks.onError(data.message);
          }
        } catch {
          // malformed json
        }
      };

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const blocks = buffer.split('\n\n');
          buffer = blocks.pop() || '';
          for (const block of blocks) processBlock(block);
        }
        if (buffer.trim()) {
          for (const block of buffer.split('\n\n')) processBlock(block);
        }
      } catch (streamErr: any) {
        if (!isCompleted && !errorReported && streamErr?.name !== 'AbortError') throw streamErr;
      }
    })
    .catch((err) => {
      if (err.name !== 'AbortError' && !errorReported && !isCompleted) {
        callbacks.onError(
          `Error de conexión con el motor o corte de red: ${err.message}. ` +
          'La sincronización se detuvo; vuelve a analizar y solo se copiarán las tablas pendientes.'
        );
      }
    });

  return () => controller.abort();
}

export function startStreamClone(
  params: {
    srcHost: string;
    srcPort: number;
    srcUser: string;
    srcPass?: string;
    srcDb: string;
    dstHost: string;
    dstPort: number;
    dstUser: string;
    dstPass?: string;
    dstDb: string;
    motor?: string;
    excludeTables?: string[];
    maskData?: boolean;
    cleanDest?: boolean;
  },
  callbacks: {
    onLog: (msg: string) => void;
    onProgress: (info: { bytes: number; mb: string; speedMb: string; elapsedSec: number }) => void;
    onComplete: (info: { message: string; bytes: number; seconds: string }) => void;
    onError: (err: string) => void;
  }
): () => void {
  const controller = new AbortController();
  let errorReported = false;
  let isCompleted = false;

  fetch(`${COMPANION_URL}/api/clone/stream`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(params),
    signal: controller.signal
  })
    .then(async (response) => {
      if (!response.ok) {
        errorReported = true;
        callbacks.onError(`HTTP Error ${response.status}: ${response.statusText}`);
        return;
      }

      const reader = response.body?.getReader();
      if (!reader) return;

      const decoder = new TextDecoder();
      let buffer = '';

      const processBlock = (block: string) => {
        const eventMatch = block.match(/^event: (.*)$/m);
        const dataMatch = block.match(/^data: (.*)$/m);
        if (!eventMatch || !dataMatch) return;

        const event = eventMatch[1].trim();
        try {
          const data = JSON.parse(dataMatch[1]);
          if (event === 'log') callbacks.onLog(data.message);
          else if (event === 'progress') callbacks.onProgress(data);
          else if (event === 'complete') {
            isCompleted = true;
            callbacks.onComplete(data);
          } else if (event === 'error') {
            errorReported = true;
            callbacks.onError(data.message);
          }
        } catch {
          // malformed json
        }
      };

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n\n');
          buffer = lines.pop() || '';

          for (const block of lines) {
            processBlock(block);
          }
        }

        if (buffer.trim()) {
          const lines = buffer.split('\n\n');
          for (const block of lines) {
            processBlock(block);
          }
        }
      } catch (streamErr: any) {
        if (!isCompleted && !errorReported && streamErr?.name !== 'AbortError') {
          throw streamErr;
        }
      }
    })
    .catch((err) => {
      if (err.name !== 'AbortError' && !errorReported && !isCompleted) {
        callbacks.onError(`Error de conexión con el motor o corte de red: ${err.message}`);
      }
    });

  return () => controller.abort();
}

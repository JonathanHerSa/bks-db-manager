const COMPANION_URL = 'http://127.0.0.1:58765';

export interface CompanionStatus {
  ok: boolean;
  version: string;
  tools: Record<string, boolean>;
}

export interface SavedConnection {
  id: string | number;
  name: string;
  motor: string;
  host: string;
  port: number | null;
  user: string;
  // NOTE: the companion daemon never sends the resolved password back to the
  // client (no auth + open CORS would otherwise leak every saved credential).
  // Endpoints that need it (getDatabasesList, getTablesList, inspectSchema,
  // startStreamClone) resolve it server-side when `pass` is omitted/empty.
  hasPassword: boolean;
  isBeekeeper?: boolean;
  defaultDatabase?: string;
  path?: string;
  url?: string;
}

/**
 * Formats a saved connection for a <select> option label, disambiguating
 * connections that share the same display name by appending their port.
 */
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
      headers: { 'Content-Type': 'application/json' },
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
    return await res.json();
  } catch {
    return null;
  }
}

export async function getSavedConnections(): Promise<SavedConnection[]> {
  try {
    const res = await fetch(`${COMPANION_URL}/api/conns`);
    const data = await res.json();
    return data.conns || [];
  } catch (err) {
    console.error('Error fetching conns from companion:', err);
    return [];
  }
}

export async function getDockerContainers(): Promise<DockerContainer[]> {
  try {
    const res = await fetch(`${COMPANION_URL}/api/docker`);
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
    const res = await fetch(url);
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
}): Promise<string[]> {
  try {
    const res = await fetch(`${COMPANION_URL}/api/databases`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
      headers: { 'Content-Type': 'application/json' },
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
}): Promise<{ mb: number; tables: number; sqlMb: number }> {
  try {
    const res = await fetch(`${COMPANION_URL}/api/database/info`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params)
    });
    const data = await res.json();
    return {
      mb: data.mb || 0,
      tables: data.tables || 0,
      sqlMb: data.sqlMb || 0
    };
  } catch {
    return { mb: 0, tables: 0, sqlMb: 0 };
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
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params)
    });
    const data = await res.json();
    return data.columns || [];
  } catch (err) {
    console.error('Error inspecting schema from companion:', err);
    return [];
  }
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
    headers: { 'Content-Type': 'application/json' },
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
        // If the stream already completed successfully, ignore downstream socket close errors
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

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
  port: number;
  user: string;
  password?: string;
  hasPassword: boolean;
  isBeekeeper?: boolean;
  defaultDatabase?: string;
}

export interface DockerContainer {
  id: string;
  name: string;
  image: string;
  status: string;
  ports: string;
  hostPort: number | null;
  motor: string;
  suggestedUser: string;
}

export interface DiscoveredProject {
  name: string;
  path: string;
  motor: string;
  host: string;
  port: number;
  database: string;
  username: string;
  hasPassword: boolean;
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

export async function getDiscoveredProjects(): Promise<DiscoveredProject[]> {
  try {
    const res = await fetch(`${COMPANION_URL}/api/discovery/projects`);
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

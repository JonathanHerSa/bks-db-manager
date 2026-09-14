const PORT = process.env.BKS_DB_MANAGER_PORT || 58765;

/**
 * Uses the global `fetch` (Node 18+) instead of shelling out to `curl` — curl
 * isn't guaranteed to exist (especially on older Windows), and spawning a
 * process just to hit a local HTTP endpoint is unnecessary overhead.
 */
export async function checkDaemonStatus(port = PORT, timeoutMs = 2000) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/status`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/** Polls a few times with a short delay — used right after starting the
 * service, since the process needs a moment to bind the port. */
export async function waitForDaemon(port = PORT, attempts = 5, delayMs = 500) {
  for (let i = 0; i < attempts; i++) {
    const status = await checkDaemonStatus(port, 1000);
    if (status?.ok) return status;
    if (i < attempts - 1) await new Promise((r) => setTimeout(r, delayMs));
  }
  return null;
}

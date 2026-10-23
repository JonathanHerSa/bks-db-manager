import { fetchDatabases } from './beekeeper';
import { getDatabasesList } from './companion';

export interface ListDatabasesParams {
  motor: string;
  host: string;
  port: number;
  user: string;
  pass?: string;
  name?: string;
  /** True when these params describe the connection currently active in Beekeeper Studio. */
  isCurrentActive: boolean;
}

/**
 * Shared "SDK-first, companion-daemon fallback" heuristic used when listing
 * databases for a connection: if it's the one currently active in Beekeeper
 * Studio, try the plugin SDK first (works for any engine Beekeeper itself
 * supports, no CLI tool needed on the user's machine); if the SDK returns
 * nothing or only a single active schema, ask the companion daemon, which
 * queries all databases on the instance.
 */
export async function listDatabasesForConnection(params: ListDatabasesParams): Promise<string[]> {
  let dbs: string[] = [];
  if (params.isCurrentActive) {
    try {
      dbs = await fetchDatabases();
      if (dbs && dbs.length > 1) return dbs;
    } catch (e) {
      console.warn('fetchDatabases SDK error:', e);
    }
  }

  try {
    const companionDbs = await getDatabasesList({
      motor: params.motor,
      host: params.host,
      port: params.port,
      user: params.user,
      pass: params.pass,
      name: params.name
    });
    if (companionDbs && companionDbs.length > 0) {
      if (dbs.length === 1 && !companionDbs.includes(dbs[0])) {
        return [dbs[0], ...companionDbs];
      }
      return companionDbs;
    }
  } catch (e) {
    console.warn('getDatabasesList companion error:', e);
  }

  return dbs;
}

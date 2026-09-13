import { fetchDatabases } from './beekeeper';
import { getDatabasesList } from './companion';

export interface ListDatabasesParams {
  motor: string;
  host: string;
  port: number;
  user: string;
  pass?: string;
  /** True when these params describe the connection currently active in Beekeeper Studio. */
  isCurrentActive: boolean;
}

/**
 * Shared "SDK-first, companion-daemon fallback" heuristic used when listing
 * databases for a connection: if it's the one currently active in Beekeeper
 * Studio, try the plugin SDK first (works for any engine Beekeeper itself
 * supports, no CLI tool needed on the user's machine); otherwise, or if the
 * SDK returns nothing, ask the companion daemon, which shells out to the
 * matching engine adapter (server/engines/*.js) for the given motor.
 *
 * This used to be duplicated (with slightly different shapes) between
 * CloneStreamTab.vue and SchemaDiffTab.vue; extracted here so both call the
 * same tested logic.
 */
export async function listDatabasesForConnection(params: ListDatabasesParams): Promise<string[]> {
  if (params.isCurrentActive) {
    try {
      const dbs = await fetchDatabases();
      if (dbs && dbs.length > 0) return dbs;
    } catch (e) {
      console.warn('fetchDatabases SDK error:', e);
    }
  }

  try {
    return await getDatabasesList({
      motor: params.motor,
      host: params.host,
      port: params.port,
      user: params.user,
      pass: params.pass
    });
  } catch (e) {
    console.warn('getDatabasesList companion error:', e);
    return [];
  }
}

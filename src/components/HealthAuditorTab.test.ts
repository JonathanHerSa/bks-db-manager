import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils';

const fetchDatabases = vi.fn();
const fetchCurrentConnection = vi.fn();
const showNotification = vi.fn();
const auditHealth = vi.fn();
const fetchProcesslist = vi.fn();
const killProcess = vi.fn();

vi.mock('../services/beekeeper', () => ({
  fetchDatabases: (...a: any[]) => fetchDatabases(...a),
  fetchCurrentConnection: (...a: any[]) => fetchCurrentConnection(...a),
  showNotification: (...a: any[]) => showNotification(...a),
  isSafeIdentifier: (str: string) => /^[a-zA-Z0-9_]+$/.test(str)
}));

vi.mock('../services/healthAuditor', () => ({
  auditHealth: (...a: any[]) => auditHealth(...a),
  fetchProcesslist: (...a: any[]) => fetchProcesslist(...a),
  killProcess: (...a: any[]) => killProcess(...a)
}));

import HealthAuditorTab from './HealthAuditorTab.vue';

let wrapper: VueWrapper<any> | null = null;

beforeEach(() => {
  fetchDatabases.mockReset().mockResolvedValue(['prod_db']);
  fetchCurrentConnection.mockReset().mockResolvedValue({ connectionName: 'Prod', databaseName: 'prod_db', databaseType: 'mysql' });
  showNotification.mockReset();
  auditHealth.mockReset().mockResolvedValue({
    database: 'prod_db',
    dialect: 'mysql',
    score: 85,
    tablesWithoutPk: ['audit_logs'],
    duplicateIndexes: [{
      table: 'users',
      index1: 'idx_email',
      index2: 'idx_email_dup',
      columns: 'email',
      reason: 'Índices exactamente duplicados con las mismas columnas'
    }],
    storageBreakdown: [
      { table: 'users', rows: 10000, dataSizeMb: 5.2, indexSizeMb: 2.1, totalSizeMb: 7.3 },
      { table: 'audit_logs', rows: 25000, dataSizeMb: 12.0, indexSizeMb: 0.5, totalSizeMb: 12.5 }
    ],
    totalSizeMb: 19.8,
    longRunningQueriesCount: 0,
    summary: { totalTables: 2, healthyTablesCount: 1, issuesCount: 2 }
  });
  fetchProcesslist.mockReset().mockResolvedValue([
    { id: 101, user: 'root', host: 'localhost', db: 'prod_db', command: 'Query', time: 45, state: 'Sending data', info: 'SELECT * FROM big_table' }
  ]);
  killProcess.mockReset().mockResolvedValue({ success: true, message: 'Consulta detenida exitosamente' });
});

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
});

async function mountTab() {
  wrapper = mount(HealthAuditorTab);
  await flushPromises();
  return wrapper;
}

describe('HealthAuditorTab.vue', () => {
  it('renders and runs health audit on mount', async () => {
    await mountTab();
    expect(fetchDatabases).toHaveBeenCalled();
    expect(auditHealth).toHaveBeenCalledWith('prod_db', 'mysql');
    expect(wrapper!.text()).toContain('85 / 100');
    expect(wrapper!.text()).toContain('Aceptable');
    expect(wrapper!.text()).toContain('audit_logs');
    expect(wrapper!.text()).toContain('idx_email_dup');
    expect(wrapper!.text()).toContain('19.8 MB Totales');
  });

  it('switches to processlist view and displays active queries', async () => {
    await mountTab();
    const procTabBtn = wrapper!.findAll('button').find((b) => b.text().includes('Monitor de Procesos'));
    expect(procTabBtn?.exists()).toBe(true);
    await procTabBtn!.trigger('click');
    await flushPromises();

    expect(fetchProcesslist).toHaveBeenCalled();
    expect(wrapper!.text()).toContain('Consultas & Threads en Ejecución');
    expect(wrapper!.text()).toContain('SELECT * FROM big_table');
    expect(wrapper!.text()).toContain('45s');
  });

  it('opens confirmation modal and terminates slow query', async () => {
    await mountTab();
    const procTabBtn = wrapper!.findAll('button').find((b) => b.text().includes('Monitor de Procesos'));
    await procTabBtn!.trigger('click');
    await flushPromises();

    const killBtn = wrapper!.findAll('button').find((b) => b.text().includes('Detener'));
    expect(killBtn?.exists()).toBe(true);
    await killBtn!.trigger('click');
    await flushPromises();

    expect(wrapper!.text()).toContain('¿Detener Consulta / Proceso?');
    expect(wrapper!.text()).toContain('KILL QUERY 101');

    const confirmBtn = wrapper!.findAll('button').find((b) => b.text().includes('Confirmar y Detener'));
    expect(confirmBtn?.exists()).toBe(true);
    await confirmBtn!.trigger('click');
    await flushPromises();

    expect(killProcess).toHaveBeenCalledWith(101, 'mysql');
    expect(showNotification).toHaveBeenCalledWith('Consulta detenida exitosamente', 'success');
  });
});

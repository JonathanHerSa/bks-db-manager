import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils';

const fetchSnapshots = vi.fn();
const createSnapshot = vi.fn();
const restoreSnapshot = vi.fn();
const deleteSnapshot = vi.fn();
const checkCompanionStatus = vi.fn();
const fetchDatabases = vi.fn();
const fetchCurrentConnection = vi.fn();
const showNotification = vi.fn();
const confirmAction = vi.fn();

vi.mock('../services/snapshots', () => ({
  fetchSnapshots: (...a: any[]) => fetchSnapshots(...a),
  createSnapshot: (...a: any[]) => createSnapshot(...a),
  restoreSnapshot: (...a: any[]) => restoreSnapshot(...a),
  deleteSnapshot: (...a: any[]) => deleteSnapshot(...a),
  createNativeSnapshot: vi.fn(),
  checkCompanionStatus: (...a: any[]) => checkCompanionStatus(...a),
  formatBytes: (bytes: number) => `${bytes} B`
}));

vi.mock('../services/beekeeper', () => ({
  fetchDatabases: (...a: any[]) => fetchDatabases(...a),
  fetchCurrentConnection: (...a: any[]) => fetchCurrentConnection(...a),
  showNotification: (...a: any[]) => showNotification(...a),
  confirmAction: (...a: any[]) => confirmAction(...a)
}));

import SnapshotsTab from './SnapshotsTab.vue';

let wrapper: VueWrapper<any> | null = null;

beforeEach(() => {
  fetchDatabases.mockReset().mockResolvedValue(['ecommerce_db', 'users_db']);
  fetchCurrentConnection.mockReset().mockResolvedValue({
    connectionName: 'Local MySQL',
    databaseName: 'ecommerce_db',
    databaseType: 'mysql'
  });
  checkCompanionStatus.mockReset().mockResolvedValue(true);
  fetchSnapshots.mockReset().mockResolvedValue({
    ok: true,
    backups: [
      {
        filename: 'ecommerce_db_2026-09-13T12-00-00.sql.zst',
        filePath: '/tmp/ecommerce_db_2026-09-13T12-00-00.sql.zst',
        sizeBytes: 1048576,
        mtime: '2026-09-13T12:00:00.000Z',
        createdAt: '2026-09-13T12:00:00.000Z',
        format: 'zstd',
        database: 'ecommerce_db'
      }
    ],
    backupDir: '/home/user/Bases de datos/Trabajo'
  });
  createSnapshot.mockReset().mockResolvedValue({
    ok: true,
    snapshot: {
      filename: 'ecommerce_db_2026-09-13T13-00-00.sql.zst',
      sizeBytes: 2048
    }
  });
  restoreSnapshot.mockReset().mockResolvedValue({
    ok: true,
    message: 'Restaurado con éxito'
  });
  deleteSnapshot.mockReset().mockResolvedValue({ ok: true });
  confirmAction.mockReset().mockResolvedValue(true);
  showNotification.mockReset();
});

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
});

async function mountTab() {
  wrapper = mount(SnapshotsTab);
  await flushPromises();
  return wrapper;
}

describe('SnapshotsTab', () => {
  it('mounts and renders snapshots list from companion server', async () => {
    const w = await mountTab();
    expect(fetchSnapshots).toHaveBeenCalled();
    expect(w.text()).toContain('ecommerce_db_2026-09-13T12-00-00.sql.zst');
    expect(w.text()).toContain('zstd');
    expect(w.text()).toContain('Turbo (Zstd)');
  });

  it('creates a new snapshot when "Tomar Snapshot Rápido" is clicked', async () => {
    const w = await mountTab();
    const btn = w.findAll('button').find((b) => b.text().includes('Tomar Snapshot Rápido'));
    expect(btn?.exists()).toBe(true);

    await btn?.trigger('click');
    await flushPromises();

    expect(createSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        database: 'ecommerce_db',
        compressWith: 'zstd'
      })
    );
    expect(showNotification).toHaveBeenCalledWith(expect.stringContaining('Snapshot creado'), 'success');
  });

  it('opens restore modal and executes restore on target database', async () => {
    const w = await mountTab();
    const restoreBtn = w.findAll('button').find((b) => b.text().includes('Restaurar'));
    expect(restoreBtn?.exists()).toBe(true);

    await restoreBtn?.trigger('click');
    await flushPromises();

    expect(w.text()).toContain('Confirmar Restauración de Snapshot');

    const confirmBtn = w.findAll('button').find((b) => b.text().includes('Confirmar y Restaurar'));
    expect(confirmBtn?.exists()).toBe(true);

    await confirmBtn?.trigger('click');
    await flushPromises();

    expect(restoreSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        filename: 'ecommerce_db_2026-09-13T12-00-00.sql.zst',
        database: 'ecommerce_db'
      })
    );
    expect(showNotification).toHaveBeenCalledWith(expect.stringContaining('Restaurado con éxito'), 'success');
  });

  it('deletes snapshot after user confirmation', async () => {
    const w = await mountTab();
    const deleteBtn = w.findAll('button').find((b) => b.attributes('title')?.includes('Eliminar'));
    expect(deleteBtn?.exists()).toBe(true);

    await deleteBtn?.trigger('click');
    await flushPromises();

    expect(confirmAction).toHaveBeenCalled();
    expect(deleteSnapshot).toHaveBeenCalledWith('ecommerce_db_2026-09-13T12-00-00.sql.zst');
    expect(showNotification).toHaveBeenCalledWith(expect.stringContaining('eliminado'), 'success');
  });

  it('filters snapshots based on search input', async () => {
    const w = await mountTab();
    const input = w.find('input[placeholder*="Filtrar por base"]');
    expect(input.exists()).toBe(true);

    await input.setValue('non_existent_db');
    await flushPromises();

    expect(w.text()).toContain('No hay snapshots disponibles');
  });
});

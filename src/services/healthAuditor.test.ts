import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  calculateHealthScore,
  detectDuplicateIndexes,
  auditHealth,
  fetchProcesslist,
  killProcess
} from './healthAuditor';

const executeQuery = vi.fn();

vi.mock('./beekeeper', () => ({
  executeQuery: (...a: any[]) => executeQuery(...a),
  isSafeIdentifier: (str: string) => /^[a-zA-Z0-9_]+$/.test(str)
}));

beforeEach(() => {
  executeQuery.mockReset();
});

describe('healthAuditor service', () => {
  describe('calculateHealthScore', () => {
    it('returns 100 for zero issues', () => {
      expect(calculateHealthScore(0, 0, 0)).toBe(100);
    });

    it('penalizes missing PKs, duplicate indexes, and long running queries', () => {
      const score = calculateHealthScore(2, 2, 1);
      // 100 - (2*15) - (2*5) - (1*10) = 100 - 30 - 10 - 10 = 50
      expect(score).toBe(50);
    });

    it('caps penalties and does not go below 0', () => {
      const score = calculateHealthScore(10, 10, 5);
      expect(score).toBeGreaterThanOrEqual(0);
    });
  });

  describe('detectDuplicateIndexes', () => {
    it('detects exact duplicate indexes', () => {
      const duplicates = detectDuplicateIndexes([
        { table: 'users', indexName: 'idx_email', columns: 'email' },
        { table: 'users', indexName: 'idx_email_dup', columns: 'email' }
      ]);
      expect(duplicates.length).toBe(1);
      expect(duplicates[0].table).toBe('users');
      expect(duplicates[0].reason).toContain('exactamente duplicados');
    });

    it('detects redundant prefix indexes', () => {
      const duplicates = detectDuplicateIndexes([
        { table: 'orders', indexName: 'idx_user_created', columns: 'user_id,created_at' },
        { table: 'orders', indexName: 'idx_user_only', columns: 'user_id' }
      ]);
      expect(duplicates.length).toBe(1);
      expect(duplicates[0].reason).toContain('prefijo redundante');
    });

    it('ignores distinct indexes on different columns', () => {
      const duplicates = detectDuplicateIndexes([
        { table: 'users', indexName: 'idx_email', columns: 'email' },
        { table: 'users', indexName: 'idx_status', columns: 'status' }
      ]);
      expect(duplicates.length).toBe(0);
    });
  });

  describe('auditHealth', () => {
    it('throws error for unsafe database name', async () => {
      await expect(auditHealth("users'; DROP TABLE test;--")).rejects.toThrow('no seguro');
    });

    it('audits MySQL database successfully', async () => {
      // 1. PK query
      executeQuery.mockResolvedValueOnce({
        results: [{ rows: [{ TABLE_NAME: 'logs' }] }]
      });
      // 2. Indexes query
      executeQuery.mockResolvedValueOnce({
        results: [{
          rows: [
            { TABLE_NAME: 'users', INDEX_NAME: 'idx_email', COLUMNS: 'email' },
            { TABLE_NAME: 'users', INDEX_NAME: 'idx_email_2', COLUMNS: 'email' }
          ]
        }]
      });
      // 3. Storage query
      executeQuery.mockResolvedValueOnce({
        results: [{
          rows: [
            { TABLE_NAME: 'users', TABLE_ROWS: 1000, DATA_LENGTH: 1048576, INDEX_LENGTH: 524288, TOTAL_LENGTH: 1572864 },
            { TABLE_NAME: 'logs', TABLE_ROWS: 500, DATA_LENGTH: 524288, INDEX_LENGTH: 0, TOTAL_LENGTH: 524288 }
          ]
        }]
      });

      const report = await auditHealth('my_db', 'mysql');
      expect(report.database).toBe('my_db');
      expect(report.dialect).toBe('mysql');
      expect(report.tablesWithoutPk).toEqual(['logs']);
      expect(report.duplicateIndexes.length).toBe(1);
      expect(report.storageBreakdown.length).toBe(2);
      expect(report.score).toBeLessThan(100);
    });
  });

  describe('fetchProcesslist', () => {
    it('fetches and normalizes MySQL processlist', async () => {
      executeQuery.mockResolvedValueOnce({
        results: [{
          rows: [
            { Id: 42, User: 'app_user', Host: 'localhost:5000', Db: 'prod_db', Command: 'Query', Time: 12, State: 'executing', Info: 'SELECT * FROM users' }
          ]
        }]
      });

      const list = await fetchProcesslist('mysql');
      expect(list.length).toBe(1);
      expect(list[0].id).toBe(42);
      expect(list[0].info).toBe('SELECT * FROM users');
    });
  });

  describe('killProcess', () => {
    it('rejects non-numeric or invalid process IDs', async () => {
      await expect(killProcess('abc' as any)).rejects.toThrow('inválido');
      await expect(killProcess(-5)).rejects.toThrow('inválido');
    });

    it('kills MySQL query using safe KILL QUERY syntax', async () => {
      executeQuery.mockResolvedValueOnce({ results: [] });
      const res = await killProcess(123, 'mysql');
      expect(executeQuery).toHaveBeenCalledWith('KILL QUERY 123;');
      expect(res.success).toBe(true);
    });

    it('cancels PostgreSQL query using pg_cancel_backend', async () => {
      executeQuery.mockResolvedValueOnce({ results: [] });
      const res = await killProcess(456, 'postgres');
      expect(executeQuery).toHaveBeenCalledWith('SELECT pg_cancel_backend(456);');
      expect(res.success).toBe(true);
    });
  });
});

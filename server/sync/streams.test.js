import { describe, test, expect } from 'vitest';
import { Readable } from 'stream';
import { createSanitizer, cleanStderr } from './streams.js';

function runSanitizer(input, options = {}) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const sanitizer = createSanitizer(options);
    sanitizer.on('data', (chunk) => chunks.push(chunk));
    sanitizer.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    sanitizer.on('error', reject);
    Readable.from([Buffer.from(input, 'utf-8')]).pipe(sanitizer);
  });
}

describe('sync stream sanitizer', () => {
  test('drops pg_dump 17 transaction_timeout for older PostgreSQL servers', async () => {
    const input = [
      'SET statement_timeout = 0;',
      'SET transaction_timeout = 0;',
      'CREATE TABLE users (id bigint);',
      ''
    ].join('\n');

    const output = await runSanitizer(input, { textualDumpFormat: true });

    expect(output).not.toContain('transaction_timeout');
    expect(output).toContain('SET statement_timeout = 0;');
    expect(output).toContain('CREATE TABLE users');
  });

  test('passes non-SQL archives through untouched', async () => {
    const input = 'BINARY\x00ARCHIVE\x01transaction_timeout';
    const output = await runSanitizer(input, { textualDumpFormat: false });
    expect(output).toBe(input);
  });

  test('masks emails when requested', async () => {
    const output = await runSanitizer("INSERT INTO users VALUES ('ana@example.com');", {
      textualDumpFormat: true,
      maskData: true
    });
    expect(output).toContain('an***@masked.local');
    expect(output).not.toContain('ana@example.com');
  });

  test('cleanStderr removes password warnings and keeps the last lines', () => {
    const stderr = [
      'Using a password on the command line interface can be insecure.',
      'ERROR 1049 (42000): Unknown database',
      'Deprecated program name'
    ].join('\n');
    expect(cleanStderr(stderr)).toContain('ERROR 1049');
    expect(cleanStderr(stderr)).not.toContain('Using a password');
  });
});

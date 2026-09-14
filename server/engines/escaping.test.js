import { describe, it, expect } from 'vitest';
import { escSqlStr, escMysqlSqlStr, escMysqlIdent, escPgIdent, toJsStringLiteral } from './escaping.js';

describe('escSqlStr', () => {
  it('doubles single quotes', () => {
    expect(escSqlStr("o'brien")).toBe("o''brien");
  });

  it('leaves safe strings untouched', () => {
    expect(escSqlStr('app_db')).toBe('app_db');
  });

  it('defaults to an empty string', () => {
    expect(escSqlStr()).toBe('');
  });
});

describe('escMysqlSqlStr', () => {
  it('doubles single quotes just like escSqlStr', () => {
    expect(escMysqlSqlStr("o'brien")).toBe("o''brien");
  });

  it('doubles backslashes so a trailing backslash cannot escape the closing quote', () => {
    // Without this, embedding the result as `'${value}'` in a MySQL/ClickHouse
    // string literal would let a value ending in `\` "eat" the closing quote
    // and let the rest of the SQL text run unquoted.
    expect(escMysqlSqlStr('db\\')).toBe('db\\\\');
    expect(escMysqlSqlStr("db\\' OR '1'='1")).toBe("db\\\\'' OR ''1''=''1");
  });

  it('escapes backslashes before quotes so the two escapes cannot interact', () => {
    expect(escMysqlSqlStr("\\'")).toBe("\\\\''");
  });

  it('leaves safe strings untouched', () => {
    expect(escMysqlSqlStr('app_db')).toBe('app_db');
  });
});

describe('escMysqlIdent', () => {
  it('doubles backticks', () => {
    expect(escMysqlIdent('my`db')).toBe('my``db');
  });

  it('leaves safe identifiers untouched', () => {
    expect(escMysqlIdent('app_db')).toBe('app_db');
  });
});

describe('escPgIdent', () => {
  it('doubles double-quotes', () => {
    expect(escPgIdent('my"db')).toBe('my""db');
  });

  it('leaves safe identifiers untouched', () => {
    expect(escPgIdent('app_db')).toBe('app_db');
  });
});

describe('toJsStringLiteral', () => {
  it('produces a value that JSON.parse can read back unchanged', () => {
    const inputs = ['simple', "with'quote", 'with"doublequote', 'with\\backslash', 'multi\nline', 'coll'];
    for (const input of inputs) {
      const literal = toJsStringLiteral(input);
      expect(JSON.parse(literal)).toBe(input);
    }
  });

  it('never produces a string that breaks out of a JS string literal', () => {
    const malicious = '"; process.exit(1); //';
    const literal = toJsStringLiteral(malicious);
    // The literal must be a single well-formed JSON/JS string, quotes and all.
    expect(literal.startsWith('"')).toBe(true);
    expect(literal.endsWith('"')).toBe(true);
    expect(JSON.parse(literal)).toBe(malicious);
  });

  it('coerces non-string values to strings first', () => {
    expect(toJsStringLiteral(42)).toBe('"42"');
  });
});

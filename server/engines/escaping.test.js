import { describe, it, expect } from 'vitest';
import { escSqlStr, escMysqlIdent, escPgIdent, toJsStringLiteral } from './escaping.js';

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

/**
 * SQL/identifier escaping helpers shared by every engine adapter that embeds
 * untrusted values into a raw query string (the CLI tools used here have no
 * prepared-statement mechanism). Centralized here instead of duplicated per
 * adapter so a future fix only has to happen once.
 */

export function escSqlStr(str = '') {
  return String(str).replace(/'/g, "''");
}

export function escMysqlIdent(str = '') {
  return String(str).replace(/`/g, '``');
}

export function escPgIdent(str = '') {
  return String(str).replace(/"/g, '""');
}

/** Safely embeds an arbitrary string into a JS source string (mongosh --eval scripts). */
export function toJsStringLiteral(value) {
  return JSON.stringify(String(value));
}

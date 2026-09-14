/**
 * SQL/identifier escaping helpers shared by every engine adapter that embeds
 * untrusted values into a raw query string (the CLI tools used here have no
 * prepared-statement mechanism). Centralized here instead of duplicated per
 * adapter so a future fix only has to happen once.
 */

export function escSqlStr(str = '') {
  return String(str).replace(/'/g, "''");
}

/**
 * Same as escSqlStr, but also doubles backslashes first. Unlike Postgres
 * (with the default standard_conforming_strings=on), MySQL and ClickHouse
 * treat `\` as an escape character inside a quoted string literal, so a
 * value ending in an odd number of backslashes could otherwise "eat" the
 * closing quote and break out of the literal (e.g. `db\` followed by
 * attacker-controlled SQL). Use this instead of escSqlStr for any value
 * embedded in a MySQL/MariaDB/TiDB or ClickHouse string literal.
 */
export function escMysqlSqlStr(str = '') {
  return String(str).replace(/\\/g, '\\\\').replace(/'/g, "''");
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

import { isSafeIdentifier } from './beekeeper';

export interface ColumnMeta {
  table: string;
  column: string;
  type: string;
  nullable?: string;
  defaultVal?: any;
}

export interface IndexMeta {
  table: string;
  name: string;
  columns: string[];
  unique: boolean;
  primary: boolean;
}

export interface ForeignKeyMeta {
  table: string;
  constraintName?: string;
  column: string;
  referencedTable: string;
  referencedColumn: string;
}

export interface DiffResult {
  missingTables: string[];
  missingColumns: Array<{ table: string; column: string; type: string; nullable?: string; defaultVal?: any }>;
  typeChanges: Array<{ table: string; column: string; srcType: string; dstType: string }>;
  missingIndexes: IndexMeta[];
  missingForeignKeys: ForeignKeyMeta[];
}

export function escapeDefaultLiteral(v: string): string {
  return String(v).replace(/\\/g, '\\\\').replace(/'/g, "''");
}

export function quoteIdent(ident: string, dialect: 'mysql' | 'postgres' | 'sqlite' = 'mysql'): string {
  if (dialect === 'postgres') return `"${ident.replace(/"/g, '""')}"`;
  return `\`${ident.replace(/`/g, '``')}\``;
}

export function generateDdlMigration(
  diff: DiffResult,
  targetDb: string,
  sourceDb: string,
  dialect: 'mysql' | 'postgres' | 'sqlite' = 'mysql',
  sourceColsMap?: Map<string, ColumnMeta[]>
): string {
  const sql: string[] = [];
  const q = (name: string) => quoteIdent(name, dialect);

  // Missing Tables
  for (const tbl of diff.missingTables) {
    if (!isSafeIdentifier(tbl)) continue;
    sql.push(`-- Falta tabla completa en destino: ${tbl}`);
    if (dialect === 'postgres') {
      const cols = sourceColsMap?.get(tbl) || [];
      if (cols.length > 0) {
        const colDefs = cols.map((c) => {
          const nullClause = c.nullable === 'NO' ? ' NOT NULL' : '';
          const defClause = c.defaultVal !== null && c.defaultVal !== undefined ? ` DEFAULT '${escapeDefaultLiteral(String(c.defaultVal))}'` : '';
          return `    ${q(c.column)} ${c.type}${nullClause}${defClause}`;
        }).join(',\n');
        sql.push(`CREATE TABLE ${q(tbl)} (\n${colDefs}\n);\n`);
      } else {
        sql.push(`CREATE TABLE ${q(tbl)} (\n    id SERIAL PRIMARY KEY\n);\n`);
      }
    } else {
      sql.push(`CREATE TABLE ${q(targetDb)}.${q(tbl)} LIKE ${q(sourceDb)}.${q(tbl)};\n`);
    }
  }

  // Missing Columns
  for (const c of diff.missingColumns) {
    if (!isSafeIdentifier(c.table) || !isSafeIdentifier(c.column)) continue;
    const nullClause = c.nullable === 'NO' ? ' NOT NULL' : ' NULL';
    const defaultClause = c.defaultVal !== null && c.defaultVal !== undefined
      ? ` DEFAULT '${escapeDefaultLiteral(String(c.defaultVal))}'`
      : '';

    const targetRef = dialect === 'postgres' ? q(c.table) : `${q(targetDb)}.${q(c.table)}`;
    sql.push(`ALTER TABLE ${targetRef} ADD COLUMN ${q(c.column)} ${c.type}${nullClause}${defaultClause};`);
  }

  // Type Changes
  for (const c of diff.typeChanges) {
    if (!isSafeIdentifier(c.table) || !isSafeIdentifier(c.column)) continue;
    const targetRef = dialect === 'postgres' ? q(c.table) : `${q(targetDb)}.${q(c.table)}`;
    if (dialect === 'postgres') {
      sql.push(`ALTER TABLE ${targetRef} ALTER COLUMN ${q(c.column)} TYPE ${c.srcType};`);
    } else {
      sql.push(`ALTER TABLE ${targetRef} MODIFY COLUMN ${q(c.column)} ${c.srcType};`);
    }
  }

  // Missing Indexes
  for (const idx of diff.missingIndexes) {
    if (!isSafeIdentifier(idx.table) || idx.primary) continue;
    const targetRef = dialect === 'postgres' ? q(idx.table) : `${q(targetDb)}.${q(idx.table)}`;
    const colsStr = idx.columns.map((col) => q(col)).join(', ');
    const uniqueStr = idx.unique ? 'UNIQUE ' : '';
    const idxName = idx.name || `idx_${idx.table}_${idx.columns.join('_')}`;
    sql.push(`CREATE ${uniqueStr}INDEX ${q(idxName)} ON ${targetRef} (${colsStr});`);
  }

  // Missing Foreign Keys
  for (const fk of diff.missingForeignKeys) {
    if (!isSafeIdentifier(fk.table) || !isSafeIdentifier(fk.column)) continue;
    const targetRef = dialect === 'postgres' ? q(fk.table) : `${q(targetDb)}.${q(fk.table)}`;
    const targetRel = dialect === 'postgres' ? q(fk.referencedTable) : `${q(targetDb)}.${q(fk.referencedTable)}`;
    const fkName = fk.constraintName || `fk_${fk.table}_${fk.column}`;
    sql.push(
      `ALTER TABLE ${targetRef} ADD CONSTRAINT ${q(fkName)} FOREIGN KEY (${q(fk.column)}) REFERENCES ${targetRel} (${q(fk.referencedColumn)});`
    );
  }

  if (sql.length === 0) {
    return '-- Los esquemas son idénticos. No se requieren cambios estructurales.';
  }

  return sql.join('\n');
}

export function generateLaravelMigration(diff: DiffResult): string {
  const lines: string[] = [
    `<?php`,
    ``,
    `use Illuminate\\Database\\Migrations\\Migration;`,
    `use Illuminate\\Database\\Schema\\Blueprint;`,
    `use Illuminate\\Support\\Facades\\Schema;`,
    ``,
    `return new class extends Migration`,
    `{`,
    `    public function up(): void`,
    `    {`
  ];

  // Group columns by table
  const byTable = new Map<string, typeof diff.missingColumns>();
  for (const col of diff.missingColumns) {
    if (!byTable.has(col.table)) byTable.set(col.table, []);
    byTable.get(col.table)!.push(col);
  }

  for (const [table, cols] of byTable.entries()) {
    lines.push(`        Schema::table('${table}', function (Blueprint $table) {`);
    for (const c of cols) {
      const colName = c.column;
      const lowerType = c.type.toLowerCase();
      let method = `string('${colName}')`;
      if (lowerType.includes('int')) method = `integer('${colName}')`;
      else if (lowerType.includes('text')) method = `text('${colName}')`;
      else if (lowerType.includes('bool') || lowerType.includes('tinyint(1)')) method = `boolean('${colName}')`;
      else if (lowerType.includes('decimal') || lowerType.includes('float')) method = `decimal('${colName}', 10, 2)`;
      else if (lowerType.includes('timestamp') || lowerType.includes('datetime')) method = `timestamp('${colName}')`;

      const nullableStr = c.nullable !== 'NO' ? '->nullable()' : '';
      lines.push(`            $table->${method}${nullableStr};`);
    }
    lines.push(`        });\n`);
  }

  lines.push(`    }\n`);
  lines.push(`    public function down(): void`);
  lines.push(`    {`);
  for (const [table, cols] of byTable.entries()) {
    const colNames = cols.map((c) => `'${c.column}'`).join(', ');
    lines.push(`        Schema::table('${table}', function (Blueprint $table) {`);
    lines.push(`            $table->dropColumn([${colNames}]);`);
    lines.push(`        });`);
  }
  lines.push(`    }`);
  lines.push(`};`);

  return lines.join('\n');
}

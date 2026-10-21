// Runs a multi-statement SQL script (schema.sql, seed.sql) atomically.
// D1's exec() splits on newlines, which breaks multi-line statements, so we
// split on statement-ending semicolons instead and run everything in one batch.
export function splitSqlStatements(sql: string): string[] {
  const withoutComments = sql
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n');
  return withoutComments
    .split(/;\s*$/m)
    .map((statement) => statement.trim())
    .filter(Boolean);
}

export async function runSqlScript(db: D1Database, sql: string): Promise<void> {
  const statements = splitSqlStatements(sql).map((statement) => db.prepare(statement));
  if (statements.length > 0) await db.batch(statements);
}

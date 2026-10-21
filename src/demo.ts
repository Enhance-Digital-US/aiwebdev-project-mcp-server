import seed from '../seed.sql';
import { runSqlScript } from './sql.js';

// Wipes all application data and restores the shared demo project (seed.sql).
// OAuth sessions live in KV, not D1, so a reset never signs anyone out.
export function resetDemoData(db: D1Database): Promise<void> {
  return runSqlScript(db, seed);
}

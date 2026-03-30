import { createMigrator } from './migrator.js';
import { pool } from './pool.js';

export async function initSchema() {
  const migrator = createMigrator(pool);
  await migrator.up();
}

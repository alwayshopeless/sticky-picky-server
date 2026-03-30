import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { Pool } from 'mysql2/promise';
import { Umzug } from 'umzug';
import { MySqlMigrationStorage } from './migrationStorage.js';

export type MigrationContext = Pool;

const currentDir = path.dirname(fileURLToPath(import.meta.url));

export function createMigrator(pool: Pool) {
  return new Umzug<MigrationContext>({
    context: pool,
    logger: undefined,
    storage: new MySqlMigrationStorage(pool),
    migrations: {
      glob: ['migrations/*.{js,ts}', { cwd: currentDir }],
      resolve: ({ name, path: migrationPath, context }) => {
        if (!migrationPath) {
          throw new Error(`Migration path is missing for ${name}`);
        }

        return {
          name,
          up: async () => {
            const migration = await import(pathToFileURL(migrationPath).href);
            await migration.up({ context });
          },
          down: async () => {
            const migration = await import(pathToFileURL(migrationPath).href);
            if (typeof migration.down === 'function') {
              await migration.down({ context });
            }
          },
        };
      },
    },
  });
}

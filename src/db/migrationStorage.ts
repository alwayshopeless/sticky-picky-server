import type { Pool, RowDataPacket } from 'mysql2/promise';
import type { UmzugStorage } from 'umzug';

interface MigrationRow extends RowDataPacket {
  name: string;
}

export class MySqlMigrationStorage implements UmzugStorage {
  private initialized = false;

  constructor(private readonly pool: Pool) {}

  async logMigration({ name }: { name: string }): Promise<void> {
    await this.ensureTable();
    await this.pool.query(
      `INSERT INTO schema_migrations (name)
       VALUES (?)`,
      [name],
    );
  }

  async unlogMigration({ name }: { name: string }): Promise<void> {
    await this.ensureTable();
    await this.pool.query(
      `DELETE
       FROM schema_migrations
       WHERE name = ?`,
      [name],
    );
  }

  async executed(): Promise<string[]> {
    await this.ensureTable();
    const [rows] = await this.pool.query<MigrationRow[]>(
      `SELECT name
       FROM schema_migrations
       ORDER BY name ASC`,
    );

    return rows.map((row) => row.name);
  }

  private async ensureTable(): Promise<void> {
    if (this.initialized) {
      return;
    }

    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations
      (
          name       VARCHAR(255) PRIMARY KEY,
          executed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    this.initialized = true;
  }
}

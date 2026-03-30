import type { RowDataPacket } from 'mysql2/promise';
import type { MigrationContext } from '../migrator.js';

interface ColumnRow extends RowDataPacket {
  Field: string;
}

interface TableRow extends RowDataPacket {
  TABLE_NAME: string;
}

async function hasColumn(context: MigrationContext, tableName: string, columnName: string) {
  const [rows] = await context.query<ColumnRow[]>(`SHOW COLUMNS FROM \`${tableName}\` LIKE ?`, [columnName]);
  return rows.length > 0;
}

async function hasTable(context: MigrationContext, tableName: string) {
  const [rows] = await context.query<TableRow[]>(
    `SELECT TABLE_NAME
     FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?`,
    [tableName],
  );

  return rows.length > 0;
}

export async function up({ context }: { context: MigrationContext }) {
  if (!(await hasColumn(context, 'stickerpacks', 'owner_user_id'))) {
    await context.query(`
      ALTER TABLE stickerpacks
      ADD COLUMN owner_user_id INT NULL AFTER type
    `);
  }

  if (!(await hasColumn(context, 'stickerpacks', 'visibility'))) {
    await context.query(`
      ALTER TABLE stickerpacks
      ADD COLUMN visibility VARCHAR(20) NOT NULL DEFAULT 'public' AFTER owner_user_id
    `);
  }

  if (!(await hasColumn(context, 'stickerpacks', 'created_at'))) {
    await context.query(`
      ALTER TABLE stickerpacks
      ADD COLUMN created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP AFTER visibility
    `);
  }

  if (!(await hasColumn(context, 'stickerpacks', 'updated_at'))) {
    await context.query(`
      ALTER TABLE stickerpacks
      ADD COLUMN updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      AFTER created_at
    `);
  }

  if (!(await hasTable(context, 'stickerpack_stickers'))) {
    await context.query(`
      CREATE TABLE stickerpack_stickers
      (
          id            INT PRIMARY KEY AUTO_INCREMENT,
          stickerpack_id INT NOT NULL,
          body          VARCHAR(200) NOT NULL,
          url           VARCHAR(500) NOT NULL,
          info          JSON NULL,
          sort_order    INT NOT NULL DEFAULT 0,
          created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          FOREIGN KEY (stickerpack_id) REFERENCES stickerpacks (id) ON DELETE CASCADE,
          INDEX idx_stickerpack_stickers_pack_order (stickerpack_id, sort_order, id)
      )
    `);
  }

  await context.query(`
    UPDATE stickerpacks
    SET visibility = COALESCE(NULLIF(visibility, ''), 'public')
  `);

  const [foreignKeys] = await context.query<RowDataPacket[]>(
    `SELECT CONSTRAINT_NAME
     FROM information_schema.KEY_COLUMN_USAGE
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'stickerpacks'
       AND COLUMN_NAME = 'owner_user_id'
       AND REFERENCED_TABLE_NAME = 'users'`,
  );

  if (foreignKeys.length === 0) {
    await context.query(`
      ALTER TABLE stickerpacks
      ADD CONSTRAINT fk_stickerpacks_owner
      FOREIGN KEY (owner_user_id) REFERENCES users (id) ON DELETE SET NULL
    `);
  }
}

export async function down({ context }: { context: MigrationContext }) {
  if (await hasTable(context, 'stickerpack_stickers')) {
    await context.query('DROP TABLE stickerpack_stickers');
  }
}

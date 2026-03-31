import crypto from 'node:crypto';
import type { RowDataPacket } from 'mysql2/promise';
import type { MigrationContext } from '../migrator.js';

interface ColumnRow extends RowDataPacket {
  Field: string;
}

interface IndexRow extends RowDataPacket {
  Key_name: string;
}

interface StickerpackIdRow extends RowDataPacket {
  id: number;
}

function generateShareId() {
  return crypto.randomBytes(12).toString('base64url');
}

async function hasColumn(context: MigrationContext, tableName: string, columnName: string) {
  const [rows] = await context.query<ColumnRow[]>(`SHOW COLUMNS FROM \`${tableName}\` LIKE ?`, [columnName]);
  return rows.length > 0;
}

async function hasIndex(context: MigrationContext, tableName: string, indexName: string) {
  const [rows] = await context.query<IndexRow[]>(`SHOW INDEX FROM \`${tableName}\` WHERE Key_name = ?`, [indexName]);
  return rows.length > 0;
}

export async function up({ context }: { context: MigrationContext }) {
  if (!(await hasColumn(context, 'stickerpacks', 'share_id'))) {
    await context.query(`
      ALTER TABLE stickerpacks
      ADD COLUMN share_id VARCHAR(64) NULL AFTER visibility
    `);
  }

  const [stickerpacks] = await context.query<StickerpackIdRow[]>(
    `SELECT id
     FROM stickerpacks
     WHERE share_id IS NULL
        OR share_id = ''`,
  );

  for (const stickerpack of stickerpacks) {
    let shareId = generateShareId();

    while (true) {
      const [existing] = await context.query<RowDataPacket[]>(
        `SELECT 1
         FROM stickerpacks
         WHERE share_id = ?
         LIMIT 1`,
        [shareId],
      );

      if (existing.length === 0) {
        break;
      }

      shareId = generateShareId();
    }

    await context.query(
      `UPDATE stickerpacks
       SET share_id = ?
       WHERE id = ?`,
      [shareId, stickerpack.id],
    );
  }

  await context.query(`
    ALTER TABLE stickerpacks
    MODIFY COLUMN share_id VARCHAR(64) NOT NULL
  `);

  if (!(await hasIndex(context, 'stickerpacks', 'unique_stickerpack_share_id'))) {
    await context.query(`
      ALTER TABLE stickerpacks
      ADD UNIQUE KEY unique_stickerpack_share_id (share_id)
    `);
  }
}

export async function down({ context }: { context: MigrationContext }) {
  if (await hasIndex(context, 'stickerpacks', 'unique_stickerpack_share_id')) {
    await context.query(`
      ALTER TABLE stickerpacks
      DROP INDEX unique_stickerpack_share_id
    `);
  }

  if (await hasColumn(context, 'stickerpacks', 'share_id')) {
    await context.query(`
      ALTER TABLE stickerpacks
      DROP COLUMN share_id
    `);
  }
}

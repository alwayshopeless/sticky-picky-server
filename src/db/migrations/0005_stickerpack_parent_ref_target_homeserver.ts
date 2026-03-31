import type { RowDataPacket } from 'mysql2/promise';
import type { MigrationContext } from '../migrator.js';

interface ColumnRow extends RowDataPacket {
  Field: string;
}

interface IndexRow extends RowDataPacket {
  Key_name: string;
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
  if (!(await hasColumn(context, 'stickerpacks', 'import_target_homeserver'))) {
    await context.query(`
      ALTER TABLE stickerpacks
      ADD COLUMN import_target_homeserver VARCHAR(255) NULL AFTER source_aggregator_host
    `);
  }

  if (await hasIndex(context, 'stickerpacks', 'unique_stickerpack_parent_ref')) {
    await context.query(`
      ALTER TABLE stickerpacks
      DROP INDEX unique_stickerpack_parent_ref
    `);
  }

  if (!(await hasIndex(context, 'stickerpacks', 'unique_stickerpack_parent_ref_target'))) {
    await context.query(`
      ALTER TABLE stickerpacks
      ADD UNIQUE KEY unique_stickerpack_parent_ref_target (parent_ref, import_target_homeserver)
    `);
  }
}

export async function down({ context }: { context: MigrationContext }) {
  if (await hasIndex(context, 'stickerpacks', 'unique_stickerpack_parent_ref_target')) {
    await context.query(`
      ALTER TABLE stickerpacks
      DROP INDEX unique_stickerpack_parent_ref_target
    `);
  }

  if (!(await hasIndex(context, 'stickerpacks', 'unique_stickerpack_parent_ref'))) {
    await context.query(`
      ALTER TABLE stickerpacks
      ADD UNIQUE KEY unique_stickerpack_parent_ref (parent_ref)
    `);
  }

  if (await hasColumn(context, 'stickerpacks', 'import_target_homeserver')) {
    await context.query(`
      ALTER TABLE stickerpacks
      DROP COLUMN import_target_homeserver
    `);
  }
}

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
  if (!(await hasColumn(context, 'stickerpacks', 'parent_ref'))) {
    await context.query(`
      ALTER TABLE stickerpacks
      ADD COLUMN parent_ref VARCHAR(255) NULL AFTER share_id
    `);
  }

  if (!(await hasColumn(context, 'stickerpacks', 'parent_share_id'))) {
    await context.query(`
      ALTER TABLE stickerpacks
      ADD COLUMN parent_share_id VARCHAR(64) NULL AFTER parent_ref
    `);
  }

  if (!(await hasColumn(context, 'stickerpacks', 'parent_media_homeserver'))) {
    await context.query(`
      ALTER TABLE stickerpacks
      ADD COLUMN parent_media_homeserver VARCHAR(255) NULL AFTER parent_share_id
    `);
  }

  if (!(await hasColumn(context, 'stickerpacks', 'source_aggregator_host'))) {
    await context.query(`
      ALTER TABLE stickerpacks
      ADD COLUMN source_aggregator_host VARCHAR(255) NULL AFTER parent_media_homeserver
    `);
  }

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

  if (await hasColumn(context, 'stickerpacks', 'import_target_homeserver')) {
    await context.query(`
      ALTER TABLE stickerpacks
      DROP COLUMN import_target_homeserver
    `);
  }

  if (await hasColumn(context, 'stickerpacks', 'source_aggregator_host')) {
    await context.query(`
      ALTER TABLE stickerpacks
      DROP COLUMN source_aggregator_host
    `);
  }

  if (await hasColumn(context, 'stickerpacks', 'parent_media_homeserver')) {
    await context.query(`
      ALTER TABLE stickerpacks
      DROP COLUMN parent_media_homeserver
    `);
  }

  if (await hasColumn(context, 'stickerpacks', 'parent_share_id')) {
    await context.query(`
      ALTER TABLE stickerpacks
      DROP COLUMN parent_share_id
    `);
  }

  if (await hasColumn(context, 'stickerpacks', 'parent_ref')) {
    await context.query(`
      ALTER TABLE stickerpacks
      DROP COLUMN parent_ref
    `);
  }
}

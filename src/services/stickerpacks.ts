import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { pool } from '../db/pool.js';
import type { StickerpackRow, StickerpackStickerRow, StickerpackStickerView } from '../types/models.js';

export function isMatrixBackedStickerpack(type: string) {
  return type === 'matrix_mxc' || type === 'user_owned';
}

export async function getStickerpackById(stickerpackId: number) {
  const [rows] = await pool.query<(StickerpackRow & RowDataPacket)[]>(
    `SELECT *
     FROM stickerpacks
     WHERE id = ?`,
    [stickerpackId],
  );

  return rows[0] as StickerpackRow | undefined;
}

export async function listStickerpackStickers(stickerpackId: number) {
  const [rows] = await pool.query<(StickerpackStickerRow & RowDataPacket)[]>(
    `SELECT id, stickerpack_id, body, url, info, sort_order
     FROM stickerpack_stickers
     WHERE stickerpack_id = ?
     ORDER BY sort_order ASC, id ASC`,
    [stickerpackId],
  );

  return rows;
}

export function toStickerpackStickerView(
  stickerpack: Pick<StickerpackRow, 'repository' | 'type'>,
  sticker: StickerpackStickerRow,
): StickerpackStickerView {
  return {
    ...sticker,
    repository: stickerpack.repository,
    stickerpack_type: stickerpack.type,
  };
}

export async function isStickerpackAttached(userId: number, stickerpackId: number) {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT 1
     FROM user_stickerpacks
     WHERE user_id = ?
       AND stickerpack_id = ?
     LIMIT 1`,
    [userId, stickerpackId],
  );

  return rows.length > 0;
}

export async function canReadStickerpack(stickerpack: StickerpackRow, userId?: number) {
  if (!isMatrixBackedStickerpack(stickerpack.type)) {
    return false;
  }

  if (stickerpack.visibility === 'public') {
    return true;
  }

  if (!userId) {
    return false;
  }

  if (stickerpack.owner_user_id === userId) {
    return true;
  }

  return isStickerpackAttached(userId, stickerpack.id);
}

export async function canAttachStickerpack(stickerpack: StickerpackRow, userId: number) {
  if (stickerpack.visibility === 'public') {
    return true;
  }

  return stickerpack.owner_user_id === userId;
}

export async function createStickerpackAttachment(userId: number, stickerpackId: number) {
  await pool.query(
    `INSERT INTO user_stickerpacks (user_id, stickerpack_id)
     VALUES (?, ?)`,
    [userId, stickerpackId],
  );
}

export async function createStickerpackSticker(stickerpackId: number, body: string, url: string, info: unknown) {
  const [orderRows] = await pool.query<RowDataPacket[]>(
    `SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_sort_order
     FROM stickerpack_stickers
     WHERE stickerpack_id = ?`,
    [stickerpackId],
  );
  const sortOrder = Number(orderRows[0]?.next_sort_order) || 0;

  const [result] = await pool.query<ResultSetHeader>(
    `INSERT INTO stickerpack_stickers (stickerpack_id, body, url, info, sort_order)
     VALUES (?, ?, ?, ?, ?)`,
    [stickerpackId, body, url, JSON.stringify(info ?? null), sortOrder],
  );

  return result.insertId;
}

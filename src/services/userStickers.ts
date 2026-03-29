import { pool } from '../db/pool.js';
import type { StickerPayload, StickerWithUid, UserRow } from '../types/models.js';
import { parseJsonArray } from '../utils/json.js';
import { generateSpUid } from '../utils/token.js';

export async function updateUserStickers(
  user: UserRow,
  column: 'favorites' | 'recent',
  sticker: StickerPayload,
  limit: number,
) {
  let stickers = parseJsonArray<StickerWithUid>(user[column]);
  const newSticker: StickerWithUid = { spUid: generateSpUid(), ...sticker };

  stickers = stickers.filter((item) => item.url !== sticker.url);
  if (stickers.length >= limit) {
    stickers.pop();
  }
  stickers.unshift(newSticker);

  await pool.query(
    `UPDATE users
     SET ${column} = ?
     WHERE id = ?`,
    [JSON.stringify(stickers), user.id],
  );

  return newSticker;
}

export async function removeUserSticker(user: UserRow, column: 'favorites' | 'recent', spUid: string) {
  const stickers = parseJsonArray<StickerWithUid>(user[column]).filter((item) => item.spUid !== spUid);

  await pool.query(
    `UPDATE users
     SET ${column} = ?
     WHERE id = ?`,
    [JSON.stringify(stickers), user.id],
  );
}

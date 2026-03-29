import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { RowDataPacket } from 'mysql2/promise';
import { pool } from '../db/pool.js';
import { authMiddleware } from '../middleware/auth.js';
import type { StickerPayload, StickerpackRow, StickerWithUid } from '../types/models.js';
import { parseJsonArray } from '../utils/json.js';
import { removeUserSticker, updateUserStickers } from '../services/userStickers.js';

interface StickerpackSelectionBody {
  stickerpack_id?: number;
}

interface RemoveStickerBody {
  spUid?: string;
}

async function attachStickerpack(request: FastifyRequest<{ Body: StickerpackSelectionBody }>, reply: FastifyReply) {
  const { stickerpack_id: stickerpackId } = request.body;

  try {
    await pool.query(
      `INSERT INTO user_stickerpacks (user_id, stickerpack_id)
       VALUES (?, ?)`,
      [request.user!.id, stickerpackId],
    );
  } catch (error) {
    const duplicate = typeof error === 'object' && error !== null && 'code' in error && error.code === 'ER_DUP_ENTRY';
    if (duplicate) {
      return { success: true, already_attached: true };
    }

    return reply.code(400).send({ error: (error as Error).message });
  }

  return { success: true };
}

async function detachStickerpack(request: FastifyRequest<{ Body: StickerpackSelectionBody }>) {
  const { stickerpack_id: stickerpackId } = request.body;

  await pool.query(
    `DELETE
     FROM user_stickerpacks
     WHERE user_id = ?
       AND stickerpack_id = ?`,
    [request.user!.id, stickerpackId],
  );

  return { success: true };
}

export async function registerUserRoutes(fastify: FastifyInstance) {
  fastify.get('/api/v1/user/stickerpacks', { preHandler: authMiddleware }, async (request) => {
    const [rows] = await pool.query<(StickerpackRow & RowDataPacket)[]>(
      `SELECT s.*, usp.stickerpack_id
       FROM user_stickerpacks usp
       JOIN stickerpacks s ON usp.stickerpack_id = s.id
       WHERE usp.user_id = ?`,
      [request.user!.id],
    );

    return { stickerpacks: rows };
  });

  fastify.post<{ Body: StickerpackSelectionBody }>(
    '/api/v1/user/stickerpack/attach',
    { preHandler: authMiddleware },
    attachStickerpack,
  );

  fastify.post<{ Body: StickerpackSelectionBody }>(
    '/api/v1/user/stickerpack/detach',
    { preHandler: authMiddleware },
    detachStickerpack,
  );

  fastify.get('/api/v1/user/stickers', { preHandler: authMiddleware }, async (request) => {
    return {
      favorites: parseJsonArray<StickerWithUid>(request.user!.favorites),
      recent: parseJsonArray<StickerWithUid>(request.user!.recent),
    };
  });

  fastify.post<{ Body: StickerPayload }>(
    '/api/v1/user/stickers/favorites/add',
    { preHandler: authMiddleware },
    async (request, reply) => {
      const { repository, body, url, info } = request.body;

      if (!repository || !body || !url || info === undefined) {
        return reply.code(400).send({ error: 'Missing required fields' });
      }

      const sticker = await updateUserStickers(request.user!, 'favorites', { repository, body, url, info }, 10);
      return { success: true, sticker };
    },
  );

  fastify.post<{ Body: RemoveStickerBody }>(
    '/api/v1/user/stickers/favorites/remove',
    { preHandler: authMiddleware },
    async (request, reply) => {
      const { spUid } = request.body;

      if (!spUid) {
        return reply.code(400).send({ error: 'Missing spUid' });
      }

      await removeUserSticker(request.user!, 'favorites', spUid);
      return { success: true };
    },
  );

  fastify.post<{ Body: StickerPayload }>(
    '/api/v1/user/stickers/recent/add',
    { preHandler: authMiddleware },
    async (request, reply) => {
      const { repository, body, url, info } = request.body;

      if (!repository || !body || !url || info === undefined) {
        return reply.code(400).send({ error: 'Missing required fields' });
      }

      const sticker = await updateUserStickers(request.user!, 'recent', { repository, body, url, info }, 20);
      return { success: true, sticker };
    },
  );

  fastify.post<{ Body: RemoveStickerBody }>(
    '/api/v1/user/stickers/recent/remove',
    { preHandler: authMiddleware },
    async (request, reply) => {
      const { spUid } = request.body;

      if (!spUid) {
        return reply.code(400).send({ error: 'Missing spUid' });
      }

      await removeUserSticker(request.user!, 'recent', spUid);
      return { success: true };
    },
  );
}

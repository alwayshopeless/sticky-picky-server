import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { RowDataPacket } from 'mysql2/promise';
import { pool } from '../db/pool.js';
import {
  errorResponseSchema,
  stickerPayloadSchema,
  stickerWithUidSchema,
  stickerpackSchema,
  successResponseSchema,
} from '../docs/schemas.js';
import { authMiddleware } from '../middleware/auth.js';
import type { StickerPayload, StickerpackRow, StickerWithUid } from '../types/models.js';
import { canAttachStickerpack, getStickerpackById } from '../services/stickerpacks.js';
import { parseJsonArray } from '../utils/json.js';
import { removeUserSticker, updateUserStickers } from '../services/userStickers.js';

interface StickerpackSelectionBody {
  stickerpack_id?: number;
}

interface RemoveStickerBody {
  spUid?: string;
}

const authSecuritySchema = [{ bearerAuth: [] }] as const;

// Add stickerpack for user
async function attachStickerpack(request: FastifyRequest<{ Body: StickerpackSelectionBody }>, reply: FastifyReply) {
  const { stickerpack_id: stickerpackId } = request.body;

  if (!stickerpackId) {
    return reply.code(400).send({ error: 'Missing stickerpack_id' });
  }

  const stickerpack = await getStickerpackById(stickerpackId);
  if (!stickerpack) {
    return reply.code(404).send({ error: 'Stickerpack not found' });
  }

  const allowed = await canAttachStickerpack(stickerpack, request.user!.id);
  if (!allowed) {
    return reply.code(403).send({ error: 'You do not have access to attach this stickerpack' });
  }

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

// Remove stickerpack for user
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
  fastify.get('/api/v1/user/stickerpacks', {
    preHandler: authMiddleware,
    schema: {
      tags: ['User'],
      summary: 'Get sticker packs attached to the current user',
      security: authSecuritySchema,
      response: {
        200: {
          type: 'object',
          properties: {
            stickerpacks: {
              type: 'array',
              items: {
                allOf: [
                  stickerpackSchema,
                  {
                    type: 'object',
                    properties: {
                      stickerpack_id: { type: 'integer' },
                    },
                    required: ['stickerpack_id'],
                  },
                ],
              },
            },
          },
          required: ['stickerpacks'],
        },
        401: errorResponseSchema,
      },
    },
  }, async (request) => {
    const [rows] = await pool.query<(StickerpackRow & RowDataPacket)[]>(
      `SELECT s.*, usp.stickerpack_id
       FROM user_stickerpacks usp
       JOIN stickerpacks s ON usp.stickerpack_id = s.id
       WHERE usp.user_id = ?`,
      [request.user!.id],
    );

    return { stickerpacks: rows };
  });

  // Add stickerpack for user
  fastify.post<{ Body: StickerpackSelectionBody }>(
    '/api/v1/user/stickerpack/attach',
    {
      preHandler: authMiddleware,
      schema: {
        tags: ['User'],
        summary: 'Attach a sticker pack to the current user',
        security: authSecuritySchema,
        body: {
          type: 'object',
          properties: {
            stickerpack_id: { type: 'integer' },
          },
          required: ['stickerpack_id'],
        },
        response: {
          200: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              already_attached: { type: 'boolean' },
            },
            required: ['success'],
          },
          400: errorResponseSchema,
          403: errorResponseSchema,
          404: errorResponseSchema,
          401: errorResponseSchema,
        },
      },
    },
    attachStickerpack,
  );

  // Remove a sticker pack from a user's personal sticker packs
  fastify.post<{ Body: StickerpackSelectionBody }>(
    '/api/v1/user/stickerpack/detach',
    {
      preHandler: authMiddleware,
      schema: {
        tags: ['User'],
        summary: 'Detach a sticker pack from the current user',
        security: authSecuritySchema,
        body: {
          type: 'object',
          properties: {
            stickerpack_id: { type: 'integer' },
          },
          required: ['stickerpack_id'],
        },
        response: {
          200: successResponseSchema,
          401: errorResponseSchema,
        },
      },
    },
    detachStickerpack,
  );

  fastify.get('/api/v1/user/stickers', {
    preHandler: authMiddleware,
    schema: {
      tags: ['User'],
      summary: 'Get current user favorites and recent stickers',
      security: authSecuritySchema,
      response: {
        200: {
          type: 'object',
          properties: {
            favorites: {
              type: 'array',
              items: stickerWithUidSchema,
            },
            recent: {
              type: 'array',
              items: stickerWithUidSchema,
            },
          },
          required: ['favorites', 'recent'],
        },
        401: errorResponseSchema,
      },
    },
  }, async (request) => {
    return {
      favorites: parseJsonArray<StickerWithUid>(request.user!.favorites),
      recent: parseJsonArray<StickerWithUid>(request.user!.recent),
    };
  });

  // Add new sticker to user's favorites list
  fastify.post<{ Body: StickerPayload }>(
    '/api/v1/user/stickers/favorites/add',
    {
      preHandler: authMiddleware,
      schema: {
        tags: ['User'],
        summary: 'Add a sticker to favorites',
        security: authSecuritySchema,
        body: stickerPayloadSchema,
        response: {
          200: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              sticker: stickerWithUidSchema,
            },
            required: ['success', 'sticker'],
          },
          400: errorResponseSchema,
          401: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const { repository, body, url, info } = request.body;

      if (!repository || !body || !url || info === undefined) {
        return reply.code(400).send({ error: 'Missing required fields' });
      }

      const sticker = await updateUserStickers(request.user!, 'favorites', { repository, body, url, info }, 10);
      return { success: true, sticker };
    },
  );

  // Remove sticker to user's favorites list
  fastify.post<{ Body: RemoveStickerBody }>(
    '/api/v1/user/stickers/favorites/remove',
    {
      preHandler: authMiddleware,
      schema: {
        tags: ['User'],
        summary: 'Remove a sticker from favorites',
        security: authSecuritySchema,
        body: {
          type: 'object',
          properties: {
            spUid: { type: 'string' },
          },
          required: ['spUid'],
        },
        response: {
          200: successResponseSchema,
          400: errorResponseSchema,
          401: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const { spUid } = request.body;

      if (!spUid) {
        return reply.code(400).send({ error: 'Missing spUid' });
      }

      await removeUserSticker(request.user!, 'favorites', spUid);
      return { success: true };
    },
  );

  // Add new sticker to user's recents list
  fastify.post<{ Body: StickerPayload }>(
    '/api/v1/user/stickers/recent/add',
    {
      preHandler: authMiddleware,
      schema: {
        tags: ['User'],
        summary: 'Add a sticker to recent history',
        security: authSecuritySchema,
        body: stickerPayloadSchema,
        response: {
          200: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              sticker: stickerWithUidSchema,
            },
            required: ['success', 'sticker'],
          },
          400: errorResponseSchema,
          401: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const { repository, body, url, info } = request.body;

      if (!repository || !body || !url || info === undefined) {
        return reply.code(400).send({ error: 'Missing required fields' });
      }

      const sticker = await updateUserStickers(request.user!, 'recent', { repository, body, url, info }, 20);
      return { success: true, sticker };
    },
  );

  // Remove sticker to user's favorites list
  fastify.post<{ Body: RemoveStickerBody }>(
    '/api/v1/user/stickers/recent/remove',
    {
      preHandler: authMiddleware,
      schema: {
        tags: ['User'],
        summary: 'Remove a sticker from recent history',
        security: authSecuritySchema,
        body: {
          type: 'object',
          properties: {
            spUid: { type: 'string' },
          },
          required: ['spUid'],
        },
        response: {
          200: successResponseSchema,
          400: errorResponseSchema,
          401: errorResponseSchema,
        },
      },
    },
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

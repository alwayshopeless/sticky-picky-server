import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
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
import {
  canAttachStickerpack,
  canAttachStickerpackByShare,
  createStickerpackAttachment,
  createStickerpackSticker,
  getStickerpackById,
  getStickerpackByParentRef,
  getStickerpackByShareId,
  isMatrixBackedStickerpack,
  listStickerpackStickers,
  toStickerpackStickerView,
} from '../services/stickerpacks.js';
import { parseJsonArray } from '../utils/json.js';
import { removeUserSticker, updateUserStickers } from '../services/userStickers.js';
import { generateStickerpackShareId, generateToken } from '../utils/token.js';
import { normalizeName } from '../utils/text.js';

interface StickerpackSelectionBody {
  stickerpack_id?: number;
  share_id?: string;
}

interface ResolveStickerpackBody {
  share_ref?: string;
}

interface CompleteImportBody {
  share_ref?: string;
  source_stickerpack?: {
    name?: string;
    visibility?: 'private' | 'public';
    share_id?: string;
    homeserver?: string;
  };
  stickers?: Array<{
    body?: string;
    url?: string;
    info?: unknown;
  }>;
}

interface RemoveStickerBody {
  spUid?: string;
}

const authSecuritySchema = [{ bearerAuth: [] }] as const;

const STICKERPACK_SHARE_PROTOCOL = 'stpk://';

interface ParsedShareRef {
  host: string | null;
  shareId: string;
  parentRef: string;
}

function getHomeserverFromMatrixId(matrixId: string) {
  const homeserver = matrixId.split(':').slice(1).join(':');
  return homeserver || 'matrix.local';
}

function parseShareRef(input: string, currentHost?: string): ParsedShareRef | null {
  const trimmed = input.trim();
  if (!trimmed) {
    return null;
  }

  if (!trimmed.startsWith(STICKERPACK_SHARE_PROTOCOL)) {
    return {
      host: currentHost ?? null,
      shareId: trimmed,
      parentRef: currentHost ? `${STICKERPACK_SHARE_PROTOCOL}${currentHost}/${trimmed}` : trimmed,
    };
  }

  try {
    const parsed = new URL(trimmed);
    const shareId = parsed.pathname.replace(/^\/+/, '');
    if (!shareId) {
      return null;
    }

    return {
      host: parsed.host || null,
      shareId,
      parentRef: `${STICKERPACK_SHARE_PROTOCOL}${parsed.host}/${shareId}`,
    };
  } catch {
    return null;
  }
}

function getHomeserverHost(value?: string | null) {
  if (!value) {
    return null;
  }

  try {
    return new URL(value).host || null;
  } catch {
    return value.replace(/^https?:\/\//, '').replace(/\/+$/, '') || null;
  }
}

function getMatrixContentHomeserver(mxcUrl?: string | null) {
  if (!mxcUrl || typeof mxcUrl !== 'string' || !mxcUrl.startsWith('mxc://')) {
    return null;
  }

  const withoutProtocol = mxcUrl.slice('mxc://'.length);
  const slashIndex = withoutProtocol.indexOf('/');
  if (slashIndex === -1) {
    return withoutProtocol || null;
  }

  return withoutProtocol.slice(0, slashIndex) || null;
}

function getStickerMediaHomeserver(
  stickers: Array<{ url?: string | null }> | undefined,
  fallback?: string | null,
) {
  const mediaHomeserver = stickers?.map((sticker) => getMatrixContentHomeserver(sticker.url)).find(Boolean);
  return mediaHomeserver ?? getHomeserverHost(fallback);
}

async function attachStickerpackForUser(userId: number, stickerpack: StickerpackRow) {
  try {
    await createStickerpackAttachment(userId, stickerpack.id);
    return { alreadyAttached: false };
  } catch (error) {
    const duplicate = typeof error === 'object' && error !== null && 'code' in error && error.code === 'ER_DUP_ENTRY';
    if (duplicate) {
      return { alreadyAttached: true };
    }

    throw error;
  }
}

async function createMirroredStickerpack({
  userId,
  localHomeserver,
  sourceHost,
  parentRef,
  parentShareId,
  parentMediaHomeserver,
  name,
  visibility,
  importTargetHomeserver,
  stickers,
}: {
  userId: number;
  localHomeserver: string;
  sourceHost: string;
  parentRef: string;
  parentShareId: string;
  parentMediaHomeserver: string | null;
  name: string;
  visibility: 'private' | 'public';
  importTargetHomeserver: string;
  stickers: Array<{ body: string; url: string; info: unknown }>;
}) {
  const internalName = `matrix-mxc-${generateToken().slice(0, 12)}`;
  const repository = `matrix-mxc://${localHomeserver}/`;
  const homeserver = `https://${localHomeserver}`;
  const shareId = generateStickerpackShareId();

  const [result] = await pool.query<ResultSetHeader>(
    `INSERT INTO stickerpacks (
      repository,
      homeserver,
      name,
      internal_name,
      type,
      owner_user_id,
      visibility,
      share_id,
      parent_ref,
      parent_share_id,
      parent_media_homeserver,
      source_aggregator_host,
      import_target_homeserver
    )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      repository,
      homeserver,
      normalizeName(name, internalName),
      internalName,
      'matrix_mxc',
      null,
      visibility,
      shareId,
      parentRef,
      parentShareId,
      parentMediaHomeserver,
      sourceHost,
      importTargetHomeserver,
    ],
  );

  for (const sticker of stickers) {
    await createStickerpackSticker(result.insertId, sticker.body, sticker.url, sticker.info);
  }

  await createStickerpackAttachment(userId, result.insertId);
  return getStickerpackById(result.insertId);
}

async function fetchRemoteStickerpackExport(host: string, shareId: string) {
  const response = await fetch(`https://${host}/api/v1/stickerpacks/share/${encodeURIComponent(shareId)}/export`);
  if (!response.ok) {
    throw new Error(`Remote aggregator ${host} returned ${response.status}`);
  }

  const contentType = response.headers.get('content-type') || '';
  if (!contentType.toLowerCase().includes('application/json')) {
    const bodyPreview = (await response.text()).slice(0, 80).replace(/\s+/g, ' ').trim();
    throw new Error(`Remote aggregator ${host} returned non-JSON response: ${bodyPreview || 'empty response'}`);
  }

  return response.json() as Promise<{
    stickerpack?: StickerpackRow;
    stickers?: Array<{ body: string; url: string; info: unknown }>;
  }>;
}

// Add stickerpack for user
async function attachStickerpack(request: FastifyRequest<{ Body: StickerpackSelectionBody }>, reply: FastifyReply) {
  const { stickerpack_id: stickerpackId, share_id: shareId } = request.body;
  const normalizedShareId = shareId?.trim();

  if (!stickerpackId && !normalizedShareId) {
    return reply.code(400).send({ error: 'Missing stickerpack_id or share_id' });
  }

  const stickerpack = stickerpackId
    ? await getStickerpackById(stickerpackId)
    : await getStickerpackByShareId(normalizedShareId!);

  if (!stickerpack) {
    return reply.code(404).send({ error: 'Stickerpack not found' });
  }

  const allowed = normalizedShareId
    ? canAttachStickerpackByShare(stickerpack)
    : await canAttachStickerpack(stickerpack, request.user!.id);

  if (!allowed) {
    return reply.code(403).send({ error: 'You do not have access to attach this stickerpack' });
  }

  try {
    const attachResult = await attachStickerpackForUser(request.user!.id, stickerpack);
    if (attachResult.alreadyAttached) {
      return { success: true, already_attached: true, stickerpack };
    }
  } catch (error) {
    return reply.code(400).send({ error: (error as Error).message });
  }

  return { success: true, stickerpack };
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
            user_id: { type: 'integer' },
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
          required: ['user_id', 'stickerpacks'],
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

    return { user_id: request.user!.id, stickerpacks: rows };
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
            share_id: { type: 'string' },
          },
          anyOf: [
            { required: ['stickerpack_id'] },
            { required: ['share_id'] },
          ],
        },
        response: {
          200: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              already_attached: { type: 'boolean' },
              stickerpack: stickerpackSchema,
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

  fastify.post<{ Body: ResolveStickerpackBody }>(
    '/api/v1/user/stickerpack/resolve',
    {
      preHandler: authMiddleware,
      schema: {
        tags: ['User'],
        summary: 'Resolve a stickerpack share ref for attach or local import',
        security: authSecuritySchema,
        body: {
          type: 'object',
          properties: {
            share_ref: { type: 'string' },
          },
          required: ['share_ref'],
        },
        response: {
          200: {
            type: 'object',
            properties: {
              status: { type: 'string' },
              stickerpack: stickerpackSchema,
              source_ref: { type: 'string' },
              source_host: { type: 'string' },
              source_stickerpack: stickerpackSchema,
              stickers: {
                type: 'array',
                items: stickerWithUidSchema,
              },
            },
            required: ['status'],
          },
          400: errorResponseSchema,
          401: errorResponseSchema,
          403: errorResponseSchema,
          404: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const localHost = request.headers.host ?? null;
      const parsed = parseShareRef(request.body.share_ref ?? '', localHost ?? undefined);
      const localHomeserver = getHomeserverFromMatrixId(request.user!.matrix_id);
      const targetHomeserver = localHomeserver;

      if (!parsed) {
        return reply.code(400).send({ error: 'Invalid share ref' });
      }

      if (!parsed.host || parsed.host === localHost) {
        const stickerpack = await getStickerpackByShareId(parsed.shareId);
        if (!stickerpack) {
          return reply.code(404).send({ error: 'Stickerpack not found' });
        }

        if (isMatrixBackedStickerpack(stickerpack.type)) {
          const sourceStickers = await listStickerpackStickers(stickerpack.id);
          const sourceMediaHomeserver = getStickerMediaHomeserver(sourceStickers, stickerpack.homeserver);
          const canonicalParentRef = stickerpack.parent_ref ?? `${STICKERPACK_SHARE_PROTOCOL}${localHost}/${stickerpack.share_id}`;

          if (sourceMediaHomeserver && sourceMediaHomeserver !== targetHomeserver) {
            const existingMirror = await getStickerpackByParentRef(canonicalParentRef, targetHomeserver);
            if (existingMirror) {
              const attachResult = await attachStickerpackForUser(request.user!.id, existingMirror);
              return {
                status: attachResult.alreadyAttached ? 'already_attached' : 'attached_existing_mirror',
                stickerpack: existingMirror,
              };
            }

            return {
              status: 'requires_import',
              source_ref: canonicalParentRef,
              source_host: localHost ?? '',
              source_stickerpack: stickerpack,
              stickers: sourceStickers.map((sticker, index) => ({
                ...toStickerpackStickerView(stickerpack, sticker),
                spUid: `import-${index}`,
              })),
            };
          }
        }

        const attachResult = await attachStickerpackForUser(request.user!.id, stickerpack);
        return {
          status: attachResult.alreadyAttached ? 'already_attached' : 'attached_local',
          stickerpack,
        };
      }

      const remoteExport = await fetchRemoteStickerpackExport(parsed.host, parsed.shareId);
      const sourceStickerpack = remoteExport?.stickerpack;
      const sourceStickers = remoteExport?.stickers ?? [];

      if (!sourceStickerpack) {
        return reply.code(404).send({ error: 'Remote stickerpack not found' });
      }

      const sourceMediaHomeserver = getStickerMediaHomeserver(sourceStickers, sourceStickerpack.homeserver);

      const existingMirror = await getStickerpackByParentRef(parsed.parentRef, targetHomeserver);
      if (existingMirror) {
        const attachResult = await attachStickerpackForUser(request.user!.id, existingMirror);
        return {
          status: attachResult.alreadyAttached ? 'already_attached' : 'attached_existing_mirror',
          stickerpack: existingMirror,
        };
      }

      if (sourceMediaHomeserver && sourceMediaHomeserver === targetHomeserver) {
        const mirroredStickerpack = await createMirroredStickerpack({
          userId: request.user!.id,
          localHomeserver,
          sourceHost: parsed.host,
          parentRef: parsed.parentRef,
          parentShareId: parsed.shareId,
          parentMediaHomeserver: sourceMediaHomeserver,
          name: sourceStickerpack.name,
          visibility: sourceStickerpack.visibility,
          importTargetHomeserver: targetHomeserver,
          stickers: sourceStickers.map((sticker) => ({
            body: sticker.body,
            url: sticker.url,
            info: sticker.info,
          })),
        });

        return {
          status: 'imported_without_media_copy',
          stickerpack: mirroredStickerpack,
        };
      }

      return {
        status: 'requires_import',
        source_ref: parsed.parentRef,
        source_host: parsed.host,
        source_stickerpack: sourceStickerpack,
        stickers: sourceStickers.map((sticker, index) => ({
          ...sticker,
          spUid: `import-${index}`,
        })),
      };
    },
  );

  fastify.post<{ Body: CompleteImportBody }>(
    '/api/v1/user/stickerpack/import/complete',
    {
      preHandler: authMiddleware,
      schema: {
        tags: ['User'],
        summary: 'Complete a remote stickerpack import after client-side media upload',
        security: authSecuritySchema,
        body: {
          type: 'object',
          properties: {
            share_ref: { type: 'string' },
            source_stickerpack: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                visibility: { type: 'string', enum: ['private', 'public'] },
                share_id: { type: 'string' },
                homeserver: { type: 'string' },
              },
              required: ['name'],
            },
            stickers: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  body: { type: 'string' },
                  url: { type: 'string' },
                  info: {},
                },
                required: ['body', 'url', 'info'],
              },
            },
          },
          required: ['share_ref', 'source_stickerpack', 'stickers'],
        },
        response: {
          200: {
            type: 'object',
            properties: {
              status: { type: 'string' },
              stickerpack: stickerpackSchema,
            },
            required: ['status', 'stickerpack'],
          },
          400: errorResponseSchema,
          401: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const parsed = parseShareRef(request.body.share_ref ?? '');
      if (!parsed || !parsed.host) {
        return reply.code(400).send({ error: 'Invalid remote share ref' });
      }

      const localHomeserver = getHomeserverFromMatrixId(request.user!.matrix_id);
      const targetHomeserver = localHomeserver;
      const existingMirror = await getStickerpackByParentRef(parsed.parentRef, targetHomeserver);
      if (existingMirror) {
        const attachResult = await attachStickerpackForUser(request.user!.id, existingMirror);
        return {
          status: attachResult.alreadyAttached ? 'already_attached' : 'attached_existing_mirror',
          stickerpack: existingMirror,
        };
      }

      const sourceStickerpack = request.body.source_stickerpack!;
      const stickers = request.body.stickers ?? [];

      if (!sourceStickerpack.name?.trim()) {
        return reply.code(400).send({ error: 'Missing source stickerpack name' });
      }

      const mirroredStickerpack = await createMirroredStickerpack({
        userId: request.user!.id,
        localHomeserver,
        sourceHost: parsed.host,
        parentRef: parsed.parentRef,
        parentShareId: sourceStickerpack.share_id?.trim() || parsed.shareId,
        parentMediaHomeserver: getStickerMediaHomeserver(stickers, sourceStickerpack.homeserver),
        name: sourceStickerpack.name,
        visibility: sourceStickerpack.visibility === 'public' ? 'public' : 'private',
        importTargetHomeserver: targetHomeserver,
        stickers: stickers
          .filter((sticker): sticker is { body: string; url: string; info: unknown } => Boolean(sticker?.body && sticker?.url))
          .map((sticker) => ({
            body: sticker.body!,
            url: sticker.url!,
            info: sticker.info,
          })),
      });

      return {
        status: 'imported',
        stickerpack: mirroredStickerpack,
      };
    },
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

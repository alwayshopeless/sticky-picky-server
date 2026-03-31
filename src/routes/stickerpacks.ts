import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { pool } from '../db/pool.js';
import {
  errorResponseSchema,
  matrixStickerPayloadSchema,
  stickerpackSchema,
  stickerpackStickerSchema,
  successResponseSchema,
} from '../docs/schemas.js';
import { authMiddleware } from '../middleware/auth.js';
import { authenticateByToken } from '../services/auth.js';
import {
  canReadStickerpack,
  createStickerpackAttachment,
  createStickerpackSticker,
  getStickerpackById,
  getStickerpackByShareId,
  isMatrixBackedStickerpack,
  listStickerpackStickers,
  toStickerpackStickerView,
} from '../services/stickerpacks.js';
import type { StickerpackCountRow, StickerpackRow, StickerpackStickerRow, UserRow } from '../types/models.js';
import { normalizeName } from '../utils/text.js';
import { generateStickerpackShareId, generateToken } from '../utils/token.js';

interface CreateStickerpackBody {
  repository?: string;
  homeserver?: string;
  internal_name?: string;
  name?: string;
  type?: string;
}

interface CreateMatrixStickerpackBody {
  name?: string;
  visibility?: 'private' | 'public';
  type?: string;
}

interface ImportStickerpacksBody {
  repository?: string;
  type?: string;
}

interface ImportMauniumPackBody {
  pack_url?: string;
}

interface StickerpackListQuery {
  limit?: string | number;
  offset?: string | number;
  search?: string;
}

interface StickerpackSearchQuery {
  q?: string;
  search?: string;
}

interface StickerpackParams {
  stickerpackId: string;
}

interface StickerpackShareParams {
  shareId: string;
}

interface StickerParams extends StickerpackParams {
  stickerId: string;
}

interface ImportedIndex {
  homeserver_url: string;
  packs: string[];
}

interface ImportedPack {
  title?: string;
  stickers?: Array<{
    body?: string;
    url?: string;
    info?: unknown;
  }>;
}

interface UpdateStickerBody {
  body?: string;
}

interface UpdateStickerpackBody {
  name?: string;
}

interface ForkStickerpackResponse {
  stickerpack_id: number;
  stickerpack: StickerpackRow;
}

const authSecuritySchema = [{ bearerAuth: [] }] as const;
const MAX_FORK_STICKERS = 250;

async function getOptionalUser(request: FastifyRequest) {
  const token = request.headers.authorization?.replace('Bearer ', '').trim();
  if (!token) {
    return undefined;
  }

  return authenticateByToken(token);
}

function getHomeserverFromMatrixId(matrixId: string) {
  const homeserver = matrixId.split(':').slice(1).join(':');
  return homeserver || 'matrix.local';
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

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, '');
}

function joinRepositoryPath(repository: string, relativePath: string) {
  const normalizedRepository = trimTrailingSlash(repository);
  const normalizedPath = relativePath.replace(/^\/+/, '');
  return `${normalizedRepository}/packs/${normalizedPath}`;
}

function resolveStickerAssetUrl(repository: string, stickerUrl?: string) {
  if (!stickerUrl) {
    return null;
  }

  if (/^(https?:\/\/|mxc:\/\/)/.test(stickerUrl)) {
    return stickerUrl;
  }

  return joinRepositoryPath(repository, stickerUrl);
}

function parseMauniumPackUrl(packUrl: string) {
  const parsed = new URL(packUrl);
  const pathname = parsed.pathname;
  const packsIndex = pathname.lastIndexOf('/packs/');
  if (packsIndex === -1) {
    throw new Error('Pack URL must point to /packs/<file>.json');
  }

  const repositoryPath = pathname.slice(0, packsIndex);
  const internalName = pathname.slice(packsIndex + '/packs/'.length);
  if (!internalName) {
    throw new Error('Pack URL must include a pack file name');
  }

  return {
    repository: `${parsed.origin}${repositoryPath}`,
    internalName,
  };
}

async function fetchMauniumPack(repository: string, internalName: string) {
  const repositoryBase = trimTrailingSlash(repository);
  const packResponse = await fetch(joinRepositoryPath(repositoryBase, internalName));
  if (!packResponse.ok) {
    throw new Error('Failed to fetch pack.json');
  }

  const packJson = (await packResponse.json()) as ImportedPack;
  const indexResponse = await fetch(`${repositoryBase}/packs/index.json`);
  if (!indexResponse.ok) {
    throw new Error('Failed to fetch index.json');
  }

  const indexJson = (await indexResponse.json()) as ImportedIndex;
  return {
    packJson,
    indexJson,
  };
}

async function ensureStickerpackOwner(stickerpackId: number, userId: number, reply: FastifyReply) {
  const stickerpack = await getStickerpackById(stickerpackId);

  if (!stickerpack) {
    return reply.code(404).send({ error: 'Stickerpack not found' });
  }

  if (!isMatrixBackedStickerpack(stickerpack.type)) {
    return reply.code(400).send({ error: 'Stickerpack is not editable through this API' });
  }

  if (stickerpack.owner_user_id !== userId) {
    return reply.code(403).send({ error: 'Only the stickerpack owner can modify it' });
  }

  return stickerpack;
}

export async function registerStickerpackRoutes(fastify: FastifyInstance) {
  fastify.post<{ Body: CreateStickerpackBody }>(
    '/api/v1/stickerpacks',
    {
      schema: {
        tags: ['Stickerpacks'],
        summary: 'Add stickerpack to agragator',
        description: 'Accepts any sticker pack with a structure similar to Maunium sticker packs.\n\nSee: https://github.com/maunium/stickerpicker',
        body: {
          type: 'object',
          properties: {
            repository: {
              type: 'string',
              description: 'Base URL of the sticker repository. Must be directory containing /packs folder.\n\n For example: https://user.github.io/matrix-stickerpicker/web/',
            },
            homeserver: { type: 'string' },
            internal_name: { type: 'string', description: 'Mainium stickers json-file name' },
            name: { type: 'string', description: 'Stickerpack name displayed to the user' },
            type: { type: 'string', description: 'Always ```maunium```' },
          },
          required: ['repository', 'homeserver', 'internal_name'],
        },
        response: {
          200: {
            type: 'object',
            properties: {
              stickerpack_id: { type: 'integer' },
              share_id: { type: 'string' },
            },
            required: ['stickerpack_id', 'share_id'],
          },
          400: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const { repository, homeserver, internal_name: internalName, name, type = 'maunium' } = request.body;

      if (!repository || !homeserver || !internalName) {
        return reply.code(400).send({ error: 'Missing required fields' });
      }

      if (!/^https?:\/\/.+\/$/.test(repository)) {
        return reply.code(400).send({ error: 'repository must be http(s)://.../ and end with /' });
      }

      try {
        const shareId = generateStickerpackShareId();
        const [result] = await pool.query<ResultSetHeader>(
          `INSERT INTO stickerpacks (repository, homeserver, name, internal_name, type, share_id)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [repository, homeserver, normalizeName(name, internalName), internalName, type, shareId],
        );

        return { stickerpack_id: result.insertId, share_id: shareId };
      } catch (error) {
        return reply.code(400).send({ error: (error as Error).message });
      }
    },
  );

  fastify.post<{ Body: CreateMatrixStickerpackBody }>(
    '/api/v1/stickerpacks/create',
    {
      preHandler: authMiddleware,
      schema: {
        tags: ['Stickerpacks'],
        summary: 'Create a Matrix MXC-backed sticker pack',
        security: authSecuritySchema,
        body: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            visibility: { type: 'string', enum: ['private', 'public'] },
            type: { type: 'string', enum: ['matrix_mxc', 'user_owned'] },
          },
          required: ['name'],
        },
        response: {
          200: {
            type: 'object',
            properties: {
              stickerpack_id: { type: 'integer' },
              share_id: { type: 'string' },
            },
            required: ['stickerpack_id', 'share_id'],
          },
          400: errorResponseSchema,
          401: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const { name, visibility = 'private', type = 'matrix_mxc' } = request.body;
      const normalizedType = type === 'user_owned' ? 'user_owned' : 'matrix_mxc';

      if (!name?.trim()) {
        return reply.code(400).send({ error: 'Missing stickerpack name' });
      }

      const homeserver = `https://${getHomeserverFromMatrixId(request.user!.matrix_id)}`;
      const internalName = `matrix-mxc-${generateToken().slice(0, 12)}`;
      const repository = `matrix-mxc://${getHomeserverFromMatrixId(request.user!.matrix_id)}/`;

      const shareId = generateStickerpackShareId();
      const [result] = await pool.query<ResultSetHeader>(
        `INSERT INTO stickerpacks (repository, homeserver, name, internal_name, type, owner_user_id, visibility, share_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [repository, homeserver, normalizeName(name, internalName), internalName, normalizedType, request.user!.id, visibility, shareId],
      );

      await createStickerpackAttachment(request.user!.id, result.insertId);

      return { stickerpack_id: result.insertId, share_id: shareId };
    },
  );

  fastify.post<{ Body: ImportStickerpacksBody }>(
    '/api/v1/stickerpacks/import',
    {
      schema: {
        tags: ['Stickerpacks'],
        summary: 'Import sticker packs from a remote repository.',
        description: 'Reads index.json inside target repository and imports all stickerpack from it.',
        body: {
          type: 'object',
          properties: {
            repository: {
              type: 'string',
              description: 'Base URL of the sticker repository. Must be directory containing /packs folder.\n\n For example: https://user.github.io/matrix-stickerpicker/web/',
            },
            type: { type: 'string', description: 'Always ```maunium```' },
          },
          required: ['repository'],
        },
        response: {
          200: {
            type: 'object',
            properties: {
              imported: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    internal_name: { type: 'string' },
                    status: { type: 'string' },
                    stickerpack_id: { type: 'integer' },
                    error: { type: 'string' },
                  },
                  required: ['internal_name', 'status'],
                },
              },
            },
            required: ['imported'],
          },
          400: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      let { repository, type = 'maunium' } = request.body;

      if (!repository || !/^https?:\/\//.test(repository)) {
        return reply.code(400).send({ error: 'Invalid repository' });
      }

      repository = repository.replace(/\/+$/, '');

      let indexJson: ImportedIndex;
      try {
        const response = await fetch(`${repository}/packs/index.json`);
        if (!response.ok) {
          return reply.code(400).send({ error: 'Failed to fetch index.json' });
        }

        indexJson = (await response.json()) as ImportedIndex;
      } catch {
        return reply.code(400).send({ error: 'Fetch error' });
      }

      const created: Array<{ internal_name: string; status: string; stickerpack_id?: number; error?: string }> = [];

      for (const pack of indexJson.packs) {
        try {
          const packUrl = `${repository}/packs/${pack}`;
          let packJson: ImportedPack;

          try {
            const response = await fetch(packUrl);
            if (!response.ok) {
              throw new Error(`Failed to fetch ${packUrl}`);
            }

            packJson = (await response.json()) as ImportedPack;
          } catch {
            created.push({ internal_name: pack, status: 'error', error: 'Failed to fetch pack.json' });
            continue;
          }

          const shareId = generateStickerpackShareId();
          const [result] = await pool.query<ResultSetHeader>(
            `INSERT INTO stickerpacks (repository, homeserver, name, internal_name, type, share_id)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [repository, indexJson.homeserver_url, packJson.title || pack, pack, type, shareId],
          );

          created.push({ internal_name: pack, stickerpack_id: result.insertId, status: 'success' });
        } catch (error) {
          const duplicate = typeof error === 'object' && error !== null && 'code' in error && error.code === 'ER_DUP_ENTRY';
          created.push({ internal_name: pack, status: duplicate ? 'already_exists' : 'error' });
        }
      }

      return { imported: created };
    },
  );

  fastify.post<{ Body: ImportMauniumPackBody }>(
    '/api/v1/stickerpacks/import/maunium-pack',
    {
      schema: {
        tags: ['Stickerpacks'],
        summary: 'Import a single Maunium sticker pack from its pack JSON URL',
        body: {
          type: 'object',
          properties: {
            pack_url: { type: 'string' },
          },
          required: ['pack_url'],
        },
        response: {
          200: {
            type: 'object',
            properties: {
              status: { type: 'string' },
              stickerpack_id: { type: 'integer' },
              share_id: { type: 'string' },
            },
            required: ['status'],
          },
          400: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const packUrl = request.body.pack_url?.trim();
      if (!packUrl) {
        return reply.code(400).send({ error: 'Missing pack_url' });
      }

      let repository: string;
      let internalName: string;

      try {
        ({ repository, internalName } = parseMauniumPackUrl(packUrl));
      } catch (error) {
        return reply.code(400).send({ error: (error as Error).message });
      }

      try {
        const { packJson, indexJson } = await fetchMauniumPack(repository, internalName);
        const shareId = generateStickerpackShareId();
        const [result] = await pool.query<ResultSetHeader>(
          `INSERT INTO stickerpacks (repository, homeserver, name, internal_name, type, share_id)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [
            trimTrailingSlash(repository),
            indexJson.homeserver_url || new URL(repository).origin,
            normalizeName(packJson.title, internalName),
            internalName,
            'maunium',
            shareId,
          ],
        );

        return {
          status: 'success',
          stickerpack_id: result.insertId,
          share_id: shareId,
        };
      } catch (error) {
        const duplicate = typeof error === 'object' && error !== null && 'code' in error && error.code === 'ER_DUP_ENTRY';
        if (duplicate) {
          return { status: 'already_exists' };
        }

        return reply.code(400).send({ error: (error as Error).message || 'Failed to import Maunium pack' });
      }
    },
  );

  fastify.post<{ Params: StickerpackParams; Body: UpdateStickerpackBody }>(
    '/api/v1/stickerpacks/:stickerpackId/edit',
    {
      preHandler: authMiddleware,
      schema: {
        tags: ['Stickerpacks'],
        summary: 'Rename a Matrix MXC-backed sticker pack',
        security: authSecuritySchema,
        params: {
          type: 'object',
          properties: {
            stickerpackId: { type: 'string' },
          },
          required: ['stickerpackId'],
        },
        body: {
          type: 'object',
          properties: {
            name: { type: 'string' },
          },
          required: ['name'],
        },
        response: {
          200: successResponseSchema,
          400: errorResponseSchema,
          401: errorResponseSchema,
          403: errorResponseSchema,
          404: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const stickerpackId = Number(request.params.stickerpackId);
      if (!Number.isInteger(stickerpackId) || stickerpackId < 1) {
        return reply.code(400).send({ error: 'Invalid stickerpack id' });
      }

      const stickerpack = await ensureStickerpackOwner(stickerpackId, request.user!.id, reply);
      if (!stickerpack || 'statusCode' in stickerpack) {
        return stickerpack;
      }

      const normalizedName = request.body.name?.trim();
      if (!normalizedName) {
        return reply.code(400).send({ error: 'Missing stickerpack name' });
      }

      const [result] = await pool.query<ResultSetHeader>(
        `UPDATE stickerpacks
         SET name = ?
         WHERE id = ?`,
        [normalizeName(normalizedName, stickerpack.internal_name), stickerpack.id],
      );

      if (result.affectedRows === 0) {
        return reply.code(404).send({ error: 'Stickerpack not found' });
      }

      return { success: true };
    },
  );

  fastify.get<{ Querystring: StickerpackListQuery }>(
    '/api/v1/stickerpacks/all',
    {
      schema: {
        tags: ['Stickerpacks'],
        summary: 'List sticker packs',
        description: 'Show and search stickerpacks by name',
        querystring: {
          type: 'object',
          properties: {
            limit: { type: 'integer', minimum: 1, maximum: 100 },
            offset: { type: 'integer', minimum: 0 },
            search: { type: 'string' },
          },
        },
        response: {
          200: {
            type: 'object',
            properties: {
              stickerpacks: {
                type: 'object',
                additionalProperties: stickerpackSchema,
              },
              total: { type: 'integer' },
              hasMore: { type: 'boolean' },
              limit: { type: 'integer' },
              offset: { type: 'integer' },
              search: { type: 'string' },
            },
            required: ['stickerpacks', 'total', 'hasMore', 'limit', 'offset', 'search'],
          },
        },
      },
    },
    async (request) => {
      const query = request.query ?? {};
      const limit = Math.min(Math.max(Number(query.limit) || 20, 1), 100);
      const offset = Math.max(Number(query.offset) || 0, 0);
      const search = (query.search || '').toString().trim();
      const searchTerm = `%${search}%`;
      const visibilityFilter = `(type = 'maunium' OR visibility = 'public')`;
      let rows: (StickerpackRow & RowDataPacket)[];
      let totalRows: (StickerpackCountRow & RowDataPacket)[];

      if (search) {
        [rows] = await pool.query<(StickerpackRow & RowDataPacket)[]>(
          `SELECT *
           FROM stickerpacks
           WHERE ${visibilityFilter}
             AND name LIKE ?
           ORDER BY id ASC LIMIT ?
           OFFSET ?`,
          [searchTerm, limit, offset],
        );

        [totalRows] = await pool.query<(StickerpackCountRow & RowDataPacket)[]>(
          `SELECT COUNT(*) AS total
           FROM stickerpacks
           WHERE ${visibilityFilter}
             AND name LIKE ?`,
          [searchTerm],
        );
      } else {
        [rows] = await pool.query<(StickerpackRow & RowDataPacket)[]>(
          `SELECT *
           FROM stickerpacks
           WHERE ${visibilityFilter}
           ORDER BY id ASC LIMIT ?
           OFFSET ?`,
          [limit, offset],
        );

        [totalRows] = await pool.query<(StickerpackCountRow & RowDataPacket)[]>(
          `SELECT COUNT(*) AS total
           FROM stickerpacks
           WHERE ${visibilityFilter}`,
        );
      }

      const total = Number(totalRows[0]?.total) || 0;
      const hasMore = offset + rows.length < total;
      const stickerpacks = Object.fromEntries(rows.map((item) => [item.id, item]));

      return { stickerpacks, total, hasMore, limit, offset, search };
    },
  );

  fastify.get<{ Querystring: StickerpackSearchQuery }>(
    '/api/v1/stickerpacks/search',
    {
      schema: {
        tags: ['Stickerpacks'],
        summary: 'Search sticker packs by name',
        deprecated: true,
        querystring: {
          type: 'object',
          properties: {
            q: { type: 'string' },
            search: { type: 'string' },
          },
        },
        response: {
          200: {
            type: 'object',
            properties: {
              results: {
                type: 'array',
                items: stickerpackSchema,
              },
            },
            required: ['results'],
          },
          400: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const search = request.query.q?.trim() || request.query.search?.trim() || '';

      if (!search) {
        return reply.code(400).send({ error: 'Missing search query' });
      }

      const [rows] = await pool.query<(StickerpackRow & RowDataPacket)[]>(
        `SELECT *
         FROM stickerpacks
         WHERE (type = 'maunium' OR visibility = 'public')
           AND name LIKE ?`,
        [`%${search}%`],
      );

      return { results: rows };
    },
  );

  fastify.get<{ Params: StickerpackShareParams }>(
    '/api/v1/stickerpacks/share/:shareId/export',
    {
      schema: {
        tags: ['Stickerpacks'],
        summary: 'Export a sticker pack by share id for federation/import',
        params: {
          type: 'object',
          properties: {
            shareId: { type: 'string' },
          },
          required: ['shareId'],
        },
        response: {
          200: {
            type: 'object',
            properties: {
              stickerpack: stickerpackSchema,
              stickers: {
                type: 'array',
                items: stickerpackStickerSchema,
              },
            },
            required: ['stickerpack', 'stickers'],
          },
          400: errorResponseSchema,
          404: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const shareId = request.params.shareId?.trim();
      if (!shareId) {
        return reply.code(400).send({ error: 'Missing share id' });
      }

      const stickerpack = await getStickerpackByShareId(shareId);
      if (!stickerpack) {
        return reply.code(404).send({ error: 'Stickerpack not found' });
      }

      if (!isMatrixBackedStickerpack(stickerpack.type)) {
        return reply.code(400).send({ error: 'Stickerpack cannot be exported through this endpoint' });
      }

      const stickers = await listStickerpackStickers(stickerpack.id);
      return {
        stickerpack,
        stickers: stickers.map((sticker) => toStickerpackStickerView(stickerpack, sticker)),
      };
    },
  );

  fastify.get<{ Params: StickerpackParams }>(
    '/api/v1/stickerpacks/:stickerpackId/stickers',
    {
      schema: {
        tags: ['Stickerpacks'],
        summary: 'Get stickers for a Matrix MXC-backed sticker pack',
        params: {
          type: 'object',
          properties: {
            stickerpackId: { type: 'string' },
          },
          required: ['stickerpackId'],
        },
        response: {
          200: {
            type: 'object',
            properties: {
              stickers: {
                type: 'array',
                items: stickerpackStickerSchema,
              },
            },
            required: ['stickers'],
          },
          400: errorResponseSchema,
          403: errorResponseSchema,
          404: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const stickerpackId = Number(request.params.stickerpackId);
      if (!Number.isInteger(stickerpackId) || stickerpackId < 1) {
        return reply.code(400).send({ error: 'Invalid stickerpack id' });
      }

      const stickerpack = await getStickerpackById(stickerpackId);
      if (!stickerpack) {
        return reply.code(404).send({ error: 'Stickerpack not found' });
      }

      if (!isMatrixBackedStickerpack(stickerpack.type)) {
        return reply.code(400).send({ error: 'Stickerpack is not served by backend sticker storage' });
      }

      const user = (await getOptionalUser(request)) as UserRow | undefined;
      const allowed = await canReadStickerpack(stickerpack, user?.id);
      if (!allowed) {
        return reply.code(403).send({ error: 'You do not have access to this stickerpack' });
      }

      const stickers = await listStickerpackStickers(stickerpackId);
      return { stickers: stickers.map((sticker) => toStickerpackStickerView(stickerpack, sticker)) };
    },
  );

  fastify.post<{ Params: StickerpackParams; Body: { body?: string; url?: string; info?: unknown } }>(
    '/api/v1/stickerpacks/:stickerpackId/stickers/add',
    {
      preHandler: authMiddleware,
      schema: {
        tags: ['Stickerpacks'],
        summary: 'Add a sticker to a Matrix MXC-backed sticker pack',
        security: authSecuritySchema,
        params: {
          type: 'object',
          properties: {
            stickerpackId: { type: 'string' },
          },
          required: ['stickerpackId'],
        },
        body: matrixStickerPayloadSchema,
        response: {
          200: {
            type: 'object',
            properties: {
              sticker_id: { type: 'integer' },
              sticker: stickerpackStickerSchema,
            },
            required: ['sticker_id', 'sticker'],
          },
          400: errorResponseSchema,
          401: errorResponseSchema,
          403: errorResponseSchema,
          404: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const stickerpackId = Number(request.params.stickerpackId);
      if (!Number.isInteger(stickerpackId) || stickerpackId < 1) {
        return reply.code(400).send({ error: 'Invalid stickerpack id' });
      }

      const stickerpack = await ensureStickerpackOwner(stickerpackId, request.user!.id, reply);
      if (!stickerpack || 'statusCode' in stickerpack) {
        return stickerpack;
      }

      const { body, url, info } = request.body;
      if (!body || !url) {
        return reply.code(400).send({ error: 'Missing required fields' });
      }

      const stickerId = await createStickerpackSticker(stickerpack.id, body, url, info);
      const stickers = await listStickerpackStickers(stickerpack.id);
      const createdSticker = stickers.find((sticker) => sticker.id === stickerId);

      if (!createdSticker) {
        return reply.code(500).send({ error: 'Sticker was created but could not be loaded back' });
      }

      return {
        sticker_id: stickerId,
        sticker: toStickerpackStickerView(stickerpack, createdSticker),
      };
    },
  );

  fastify.post<{ Params: StickerParams; Body: UpdateStickerBody }>(
    '/api/v1/stickerpacks/:stickerpackId/stickers/:stickerId/edit',
    {
      preHandler: authMiddleware,
      schema: {
        tags: ['Stickerpacks'],
        summary: 'Edit sticker metadata inside a Matrix MXC-backed sticker pack',
        security: authSecuritySchema,
        params: {
          type: 'object',
          properties: {
            stickerpackId: { type: 'string' },
            stickerId: { type: 'string' },
          },
          required: ['stickerpackId', 'stickerId'],
        },
        body: {
          type: 'object',
          properties: {
            body: { type: 'string' },
          },
          required: ['body'],
        },
        response: {
          200: successResponseSchema,
          400: errorResponseSchema,
          401: errorResponseSchema,
          403: errorResponseSchema,
          404: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const stickerpackId = Number(request.params.stickerpackId);
      const stickerId = Number(request.params.stickerId);
      if (!Number.isInteger(stickerpackId) || !Number.isInteger(stickerId) || stickerpackId < 1 || stickerId < 1) {
        return reply.code(400).send({ error: 'Invalid sticker or stickerpack id' });
      }

      const stickerpack = await ensureStickerpackOwner(stickerpackId, request.user!.id, reply);
      if (!stickerpack || 'statusCode' in stickerpack) {
        return stickerpack;
      }

      const { body } = request.body;
      if (!body) {
        return reply.code(400).send({ error: 'Missing body' });
      }

      const [result] = await pool.query<ResultSetHeader>(
        `UPDATE stickerpack_stickers
         SET body = ?
         WHERE id = ?
           AND stickerpack_id = ?`,
        [body, stickerId, stickerpack.id],
      );

      if (result.affectedRows === 0) {
        return reply.code(404).send({ error: 'Sticker not found' });
      }

      return { success: true };
    },
  );

  fastify.delete<{ Params: StickerParams }>(
    '/api/v1/stickerpacks/:stickerpackId/stickers/:stickerId/remove',
    {
      preHandler: authMiddleware,
      schema: {
        tags: ['Stickerpacks'],
        summary: 'Remove a sticker from a Matrix MXC-backed sticker pack',
        security: authSecuritySchema,
        params: {
          type: 'object',
          properties: {
            stickerpackId: { type: 'string' },
            stickerId: { type: 'string' },
          },
          required: ['stickerpackId', 'stickerId'],
        },
        response: {
          200: successResponseSchema,
          400: errorResponseSchema,
          401: errorResponseSchema,
          403: errorResponseSchema,
          404: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const stickerpackId = Number(request.params.stickerpackId);
      const stickerId = Number(request.params.stickerId);
      if (!Number.isInteger(stickerpackId) || !Number.isInteger(stickerId) || stickerpackId < 1 || stickerId < 1) {
        return reply.code(400).send({ error: 'Invalid sticker or stickerpack id' });
      }

      const stickerpack = await ensureStickerpackOwner(stickerpackId, request.user!.id, reply);
      if (!stickerpack || 'statusCode' in stickerpack) {
        return stickerpack;
      }

      const [result] = await pool.query<ResultSetHeader>(
        `DELETE
         FROM stickerpack_stickers
         WHERE id = ?
           AND stickerpack_id = ?`,
        [stickerId, stickerpack.id],
      );

      if (result.affectedRows === 0) {
        return reply.code(404).send({ error: 'Sticker not found' });
      }

      return { success: true };
    },
  );

  fastify.delete<{ Params: StickerpackParams }>(
    '/api/v1/stickerpacks/:stickerpackId/delete',
    {
      preHandler: authMiddleware,
      schema: {
        tags: ['Stickerpacks'],
        summary: 'Delete a Matrix MXC-backed sticker pack',
        security: authSecuritySchema,
        params: {
          type: 'object',
          properties: {
            stickerpackId: { type: 'string' },
          },
          required: ['stickerpackId'],
        },
        response: {
          200: successResponseSchema,
          400: errorResponseSchema,
          401: errorResponseSchema,
          403: errorResponseSchema,
          404: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const stickerpackId = Number(request.params.stickerpackId);
      if (!Number.isInteger(stickerpackId) || stickerpackId < 1) {
        return reply.code(400).send({ error: 'Invalid stickerpack id' });
      }

      const stickerpack = await ensureStickerpackOwner(stickerpackId, request.user!.id, reply);
      if (!stickerpack || 'statusCode' in stickerpack) {
        return stickerpack;
      }

      await pool.query(
        `DELETE
         FROM stickerpacks
         WHERE id = ?`,
        [stickerpack.id],
      );

      return { success: true };
    },
  );

  fastify.post<{ Params: StickerpackParams }>(
    '/api/v1/stickerpacks/:stickerpackId/fork',
    {
      preHandler: authMiddleware,
      schema: {
        tags: ['Stickerpacks'],
        summary: 'Fork a readable sticker pack into a user-owned editable pack',
        security: authSecuritySchema,
        params: {
          type: 'object',
          properties: {
            stickerpackId: { type: 'string' },
          },
          required: ['stickerpackId'],
        },
        response: {
          200: {
            type: 'object',
            properties: {
              stickerpack_id: { type: 'integer' },
              stickerpack: stickerpackSchema,
            },
            required: ['stickerpack_id', 'stickerpack'],
          },
          400: errorResponseSchema,
          401: errorResponseSchema,
          403: errorResponseSchema,
          404: errorResponseSchema,
        },
      },
    },
    async (request, reply): Promise<ForkStickerpackResponse | FastifyReply> => {
      const stickerpackId = Number(request.params.stickerpackId);
      if (!Number.isInteger(stickerpackId) || stickerpackId < 1) {
        return reply.code(400).send({ error: 'Invalid stickerpack id' });
      }

      const sourceStickerpack = await getStickerpackById(stickerpackId);
      if (!sourceStickerpack) {
        return reply.code(404).send({ error: 'Stickerpack not found' });
      }

      const allowed = await canReadStickerpack(sourceStickerpack, request.user!.id);
      if (!allowed) {
        return reply.code(403).send({ error: 'You do not have access to fork this stickerpack' });
      }

      const homeserverHost = getHomeserverFromMatrixId(request.user!.matrix_id);
      const homeserver = `https://${homeserverHost}`;
      const internalName = `matrix-mxc-${generateToken().slice(0, 12)}`;
      const repository = `matrix-mxc://${homeserverHost}/`;
      const forkName = normalizeName(`${sourceStickerpack.name} (Fork)`, internalName);
      const shareId = generateStickerpackShareId();
      const sourceStickers = isMatrixBackedStickerpack(sourceStickerpack.type)
        ? (await listStickerpackStickers(sourceStickerpack.id)).map((sticker) => ({
            body: sticker.body,
            url: sticker.url,
            info: sticker.info,
          }))
        : ((await fetchMauniumPack(sourceStickerpack.repository, sourceStickerpack.internal_name)).packJson.stickers ?? [])
            .map((sticker) => ({
              body: sticker.body || '😀',
              url: resolveStickerAssetUrl(sourceStickerpack.repository, sticker.url),
              info: sticker.info,
            }))
            .filter((sticker): sticker is { body: string; url: string; info: unknown } => Boolean(sticker.url));

      if (sourceStickers.length > MAX_FORK_STICKERS) {
        return reply.code(400).send({
          error: `Stickerpack is too large to fork right now. Maximum supported size is ${MAX_FORK_STICKERS} stickers.`,
        });
      }

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
          forkName,
          internalName,
          'user_owned',
          request.user!.id,
          'private',
          shareId,
          null,
          null,
          null,
          null,
          null,
        ],
      );

      await createStickerpackAttachment(request.user!.id, result.insertId);

      for (const sticker of sourceStickers) {
        await createStickerpackSticker(result.insertId, sticker.body, sticker.url, sticker.info);
      }

      const createdStickerpack = await getStickerpackById(result.insertId);
      if (!createdStickerpack) {
        return reply.code(500).send({ error: 'Forked stickerpack was created but could not be loaded back' });
      }

      return {
        stickerpack_id: result.insertId,
        stickerpack: createdStickerpack,
      };
    },
  );
}

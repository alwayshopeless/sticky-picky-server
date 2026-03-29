import type { FastifyInstance } from 'fastify';
import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { pool } from '../db/pool.js';
import { errorResponseSchema, stickerpackSchema } from '../docs/schemas.js';
import type { StickerpackCountRow, StickerpackRow } from '../types/models.js';
import { normalizeName } from '../utils/text.js';

interface CreateStickerpackBody {
  repository?: string;
  homeserver?: string;
  internal_name?: string;
  name?: string;
  type?: string;
}

interface ImportStickerpacksBody {
  repository?: string;
  type?: string;
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

interface ImportedIndex {
  homeserver_url: string;
  packs: string[];
}

interface ImportedPack {
  title?: string;
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
            internal_name: { type: 'string', description: "Mainium stickers json-file name" },
            name: { type: 'string', description: "Stickerpack name displayed to the user" },
            type: { type: 'string', description: "Always ```maunium```" },
          },
          required: ['repository', 'homeserver', 'internal_name'],
        },
        response: {
          200: {
            type: 'object',
            properties: {
              stickerpack_id: { type: 'integer' },
            },
            required: ['stickerpack_id'],
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
        const [result] = await pool.query<ResultSetHeader>(
          `INSERT INTO stickerpacks (repository, homeserver, name, internal_name, type)
           VALUES (?, ?, ?, ?, ?)`,
          [repository, homeserver, normalizeName(name, internalName), internalName, type],
        );

        return { stickerpack_id: result.insertId };
      } catch (error) {
        return reply.code(400).send({ error: (error as Error).message });
      }
    },
  );

  fastify.post<{ Body: ImportStickerpacksBody }>(
    '/api/v1/stickerpacks/import',
    {
      schema: {
        tags: ['Stickerpacks'],
        summary: 'Import sticker packs from a remote repository.',
        description: "Reads index.json inside target repository and imports all stickerpack from it.",
        body: {
          type: 'object',
          properties: {
            repository: {
              type: 'string',
              description: "Base URL of the sticker repository. Must be directory containing /packs folder.\n\n For example: https://user.github.io/matrix-stickerpicker/web/",
            },
            type: { type: 'string', description: "Always ```maunium```" },
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

          const [result] = await pool.query<ResultSetHeader>(
            `INSERT INTO stickerpacks (repository, homeserver, name, internal_name, type)
             VALUES (?, ?, ?, ?, ?)`,
            [repository, indexJson.homeserver_url, packJson.title || pack, pack, type],
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

  fastify.get<{ Querystring: StickerpackListQuery }>(
    '/api/v1/stickerpacks/all',
    {
      schema: {
        tags: ['Stickerpacks'],
        summary: 'List sticker packs',
        description: "Show and search stickerpacks by name",
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
      let rows: (StickerpackRow & RowDataPacket)[];
      let totalRows: (StickerpackCountRow & RowDataPacket)[];

      if (search) {
        [rows] = await pool.query<(StickerpackRow & RowDataPacket)[]>(
          `SELECT *
           FROM stickerpacks
           WHERE name LIKE ?
           ORDER BY id ASC LIMIT ?
           OFFSET ?`,
          [searchTerm, limit, offset],
        );

        [totalRows] = await pool.query<(StickerpackCountRow & RowDataPacket)[]>(
          `SELECT COUNT(*) AS total
           FROM stickerpacks
           WHERE name LIKE ?`,
          [searchTerm],
        );
      } else {
        [rows] = await pool.query<(StickerpackRow & RowDataPacket)[]>(
          `SELECT *
           FROM stickerpacks
           ORDER BY id ASC LIMIT ?
           OFFSET ?`,
          [limit, offset],
        );

        [totalRows] = await pool.query<(StickerpackCountRow & RowDataPacket)[]>(
          `SELECT COUNT(*) AS total
           FROM stickerpacks`,
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
         WHERE name LIKE ?`,
        [`%${search}%`],
      );

      return { results: rows };
    },
  );
}

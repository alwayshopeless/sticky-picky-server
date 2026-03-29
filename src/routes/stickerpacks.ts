import type { FastifyInstance } from 'fastify';
import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { pool } from '../db/pool.js';
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
  fastify.post<{ Body: CreateStickerpackBody }>('/api/v1/stickerpacks', async (request, reply) => {
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
  });

  fastify.post<{ Body: ImportStickerpacksBody }>('/api/v1/stickerpacks/import', async (request, reply) => {
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
  });

  fastify.get<{ Querystring: StickerpackListQuery }>('/api/v1/stickerpacks/all', async (request) => {
    const query = request.query ?? {};
    const limit = Math.min(Math.max(Number(query.limit) || 20, 1), 100);
    const offset = Math.max(Number(query.offset) || 0, 0);
    const search = (query.search || '').toString().trim();
    const searchTerm = `%${search}%`;

    const [rows] = await pool.query<(StickerpackRow & RowDataPacket)[]>(
      `SELECT *
       FROM stickerpacks
       WHERE ? = ''
          OR name LIKE ?
       ORDER BY id ASC LIMIT ?
       OFFSET ?`,
      [search, searchTerm, limit, offset],
    );

    const [totalRows] = await pool.query<(StickerpackCountRow & RowDataPacket)[]>(
      `SELECT COUNT(*) AS total
       FROM stickerpacks
       WHERE ? = ''
          OR name LIKE ?`,
      [search, searchTerm],
    );

    const total = Number(totalRows[0]?.total) || 0;
    const hasMore = offset + rows.length < total;
    const stickerpacks = Object.fromEntries(rows.map((item) => [item.id, item]));

    return { stickerpacks, total, hasMore, limit, offset, search };
  });

  fastify.get<{ Querystring: StickerpackSearchQuery }>('/api/v1/stickerpacks/search', async (request, reply) => {
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
  });
}

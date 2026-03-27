import Fastify from 'fastify'
import mysql from 'mysql2/promise';
import fs from 'fs';
import cors from '@fastify/cors'
import * as crypto from 'crypto';
import {dbConfig} from "./config/db.js";

const fastify = Fastify({logger: true})

await fastify.register(cors, {origin: '*'})

// MySQL pool
const pool = mysql.createPool(dbConfig);

// Инициализация схемы из файла
async function initSchema() {
 const schema = fs.readFileSync('./schema.sql', 'utf-8');
 const statements = schema.split(';').map(s => s.trim()).filter(s => s.length);
 const conn = await pool.getConnection();
 try {
  for (const stmt of statements) {
   await conn.query(stmt);
  }
 } finally {
  conn.release();
 }
}

await initSchema();

// Helpers
function normalizeName(name, internal_name) {
 if (!name) return internal_name.substring(0, 40);
 return name.substring(0, 40);
}

function generateToken() {
 return crypto.randomBytes(32).toString('hex')
}

function generateSpUid() {
 return 'sp-uid-' + crypto.randomBytes(8).toString('hex');
}

// Authenticate Matrix user
async function authenticateMatrixUser(user_token, homeserver) {
 const url = `https://${homeserver}/_matrix/federation/v1/openid/userinfo?access_token=${encodeURIComponent(user_token)}`;
 let response;
 try {
  response = await fetch(url);
 } catch (e) {
  return null;
 }

 if (!response.ok) return null;
 const data = await response.json();

 let username = data.sub.split(":")[0].replace("@", "");
 const expected = `@${username}:${homeserver}`;
 return data.sub === expected ? expected : null;
}

// Authenticate by token
async function authenticateByToken(token) {
 const [rows] = await pool.query(`SELECT *
                                  FROM users
                                  WHERE token = ?`, [token]);
 return rows[0];
}

// Middleware
const authMiddle = async (req, reply) => {
 const token = req.headers['authorization']?.replace('Bearer ', '');
 if (!token) return reply.code(401).send({error: "Missing token"});

 const user = await authenticateByToken(token);
 if (!user) return reply.code(401).send({error: "Invalid token"});

 req.user = user;
};

// Routes
fastify.post('/api/v1/auth/login', async (req, reply) => {
 const {user_token, homeserver} = req.body;
 if (!user_token || !homeserver) return reply.code(400).send({error: "Missing required fields"});

 const matrixId = await authenticateMatrixUser(user_token, homeserver);
 if (!matrixId) return reply.code(401).send({error: "Invalid Matrix token"});

 const [rows] = await pool.query(`SELECT *
                                  FROM users
                                  WHERE matrix_id = ?`, [matrixId]);
 let user = rows[0];

 if (!user) {
  const token = generateToken();
  const [result] = await pool.query(`INSERT INTO users (matrix_id, token)
                                     VALUES (?, ?)`, [matrixId, token]);
  user = {id: result.insertId, matrix_id: matrixId, token};
 }

 if (!user.token) {
  const token = generateToken();
  await pool.query(`UPDATE users
                    SET token = ?
                    WHERE id = ?`, [token, user.id]);
  user.token = token;
 }

 return {token: user.token, matrix_id: user.matrix_id};
});

// Stickerpacks CRUD
fastify.post('/api/v1/stickerpacks', async (req, reply) => {
 const {repository, homeserver, internal_name, name, type = "maunium"} = req.body;
 if (!repository || !homeserver || !internal_name) return reply.code(400).send({error: "Missing required fields"});
 if (!/^https?:\/\/.+\/$/.test(repository)) return reply.code(400).send({error: "repository must be http(s)://.../ and end with /"});

 try {
  const [result] = await pool.query(
   `INSERT INTO stickerpacks (repository, homeserver, name, internal_name, type)
    VALUES (?, ?, ?, ?, ?)`,
   [repository, homeserver, normalizeName(name, internal_name), internal_name, type]
  );
  return {stickerpack_id: result.insertId};
 } catch (err) {
  return reply.code(400).send({error: err.message});
 }
});

fastify.post('/api/v1/stickerpacks/import', async (req, reply) => {
 let {repository, type = "maunium"} = req.body;
 if (!repository || !/^https?:\/\//.test(repository)) return reply.code(400).send({error: "Invalid repository"});
 repository = repository.replace(/\/+$/, '');
 let indexJson;
 try {
  const res = await fetch(repository + "/packs/index.json");
  if (!res.ok) return reply.code(400).send({error: "Failed to fetch index.json"});
  indexJson = await res.json();
 } catch (e) {
  return reply.code(400).send({error: "Fetch error"});
 }

 const created = [];
 for (const pack of indexJson.packs) {
  try {
   const packUrl = `${repository}/packs/${pack}`;
   let packJson;
   try {
    const res = await fetch(packUrl);
    if (!res.ok) throw new Error(`Failed to fetch ${packUrl}`);
    packJson = await res.json();
   } catch {
    created.push({internal_name: pack, status: "error", error: "Failed to fetch pack.json"});
    continue;
   }

   const [result] = await pool.query(
    `INSERT INTO stickerpacks (repository, homeserver, name, internal_name, type)
     VALUES (?, ?, ?, ?, ?)`,
    [repository, indexJson.homeserver_url, packJson.title || pack, pack, type]
   );
   created.push({internal_name: pack, stickerpack_id: result.insertId, status: "success"});
  } catch (e) {
   let status = "error";
   if (e.code === "ER_DUP_ENTRY") status = "already_exists";
   created.push({internal_name: pack, status});
  }
 }
 return {imported: created};
});

fastify.get('/api/v1/stickerpacks/all', async (req, reply) => {
 const q = req.query ?? {};
 const limit = Math.min(Math.max(Number(q.limit) || 20, 1), 100);
 const offset = Math.max(Number(q.offset) || 0, 0);
 const search = (q.search || "").toString().trim();
 const searchTerm = `%${search}%`;

 const [rows] = await pool.query(
  `SELECT *
   FROM stickerpacks
   WHERE ? = ''
      OR name LIKE ?
   ORDER BY id ASC LIMIT ?
   OFFSET ?`,
  [search, searchTerm, limit, offset]
 );

 const [totalRows] = await pool.query(
  `SELECT COUNT(*) AS total
   FROM stickerpacks
   WHERE ? = ''
      OR name LIKE ?`,
  [search, searchTerm]
 );
 const total = Number(totalRows[0].total) || 0;
 const hasMore = offset + rows.length < total;

 let packsMap = {};
 rows.forEach(item => packsMap[item.id] = item);

 return {stickerpacks: packsMap, total, hasMore, limit, offset, search};
});

// User stickerpacks
fastify.post('/api/v1/user/stickerpacks', {preHandler: authMiddle}, async (req, reply) => {
 const user = req.user;
 const [rows] = await pool.query(
  `SELECT s.*, usp.stickerpack_id
   FROM user_stickerpacks usp
            JOIN stickerpacks s ON usp.stickerpack_id = s.id
   WHERE usp.user_id = ?`,
  [user.id]
 );
 return {stickerpacks: rows};
});

fastify.post('/api/v1/user/stickerpacks/add', {preHandler: authMiddle}, async (req, reply) => {
 const {stickerpack_id} = req.body;
 const user = req.user;
 try {
  await pool.query(`INSERT INTO user_stickerpacks (user_id, stickerpack_id)
                    VALUES (?, ?)`, [user.id, stickerpack_id]);
 } catch (e) {
  return reply.code(400).send({error: e.message});
 }
 return {success: true};
});

fastify.post('/api/v1/user/stickerpacks/remove', {preHandler: authMiddle}, async (req, reply) => {
 const {stickerpack_id} = req.body;
 const user = req.user;
 await pool.query(`DELETE
                   FROM user_stickerpacks
                   WHERE user_id = ?
                     AND stickerpack_id = ?`, [user.id, stickerpack_id]);
 return {success: true};
});

// User stickers (favorites/recent)
async function updateUserStickers(user, column, sticker, limit) {
 let stickers = JSON.parse(user[column] || '[]');
 const spUid = generateSpUid();
 const newSticker = {spUid, ...sticker};

 stickers = stickers.filter(s => s.url !== sticker.url);
 if (stickers.length >= limit) stickers.pop();
 stickers.unshift(newSticker);

 await pool.query(`UPDATE users
                   SET ${column} = ?
                   WHERE id = ?`, [JSON.stringify(stickers), user.id]);
 return newSticker;
}

fastify.get('/api/v1/user/stickers', {preHandler: authMiddle}, async (req, reply) => {
 const user = req.user;
 return {
  favorites: JSON.parse(user.favorites || '[]'),
  recent: JSON.parse(user.recent || '[]')
 };
});

fastify.post('/api/v1/user/stickers/favorites/add', {preHandler: authMiddle}, async (req, reply) => {
 const {repository, body, url, info} = req.body;
 if (!repository || !body || !url || !info) return reply.code(400).send({error: "Missing required fields"});

 const sticker = {repository, body, url, info};
 const newSticker = await updateUserStickers(req.user, 'favorites', sticker, 10);
 return {success: true, sticker: newSticker};
});

fastify.post('/api/v1/user/stickers/favorites/remove', {preHandler: authMiddle}, async (req, reply) => {
 const {spUid} = req.body;
 if (!spUid) return reply.code(400).send({error: "Missing spUid"});

 const user = req.user;
 let favorites = JSON.parse(user.favorites || '[]');
 favorites = favorites.filter(sticker => sticker.spUid !== spUid);
 await pool.query(`UPDATE users
                   SET favorites = ?
                   WHERE id = ?`, [JSON.stringify(favorites), user.id]);
 return {success: true};
});

fastify.post('/api/v1/user/stickers/recent/add', {preHandler: authMiddle}, async (req, reply) => {
 const {repository, body, url, info} = req.body;
 if (!repository || !body || !url || !info) return reply.code(400).send({error: "Missing required fields"});

 const sticker = {repository, body, url, info};
 const newSticker = await updateUserStickers(req.user, 'recent', sticker, 20);
 return {success: true, sticker: newSticker};
});

fastify.post('/api/v1/user/stickers/recent/remove', {preHandler: authMiddle}, async (req, reply) => {
 const {spUid} = req.body;
 if (!spUid) return reply.code(400).send({error: "Missing spUid"});

 const user = req.user;
 let recent = JSON.parse(user.recent || '[]');
 recent = recent.filter(sticker => sticker.spUid !== spUid);
 await pool.query(`UPDATE users
                   SET recent = ?
                   WHERE id = ?`, [JSON.stringify(recent), user.id]);
 return {success: true};
});

// Stickerpacks search
fastify.get('/api/v1/stickerpacks/search', async (req, reply) => {
 const {q} = req.query;
 if (!q) return reply.code(400).send({error: "Missing search query"});

 const [rows] = await pool.query(`SELECT *
                                  FROM stickerpacks
                                  WHERE name LIKE ?`, [`%${q}%`]);
 return {results: rows};
});


fastify.get('/cors/*', async (request, reply) => {
 let targetUrl = request.params['*'];

 if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
  targetUrl = 'https://' + targetUrl;
 }

 try {
  const res = await fetch(targetUrl);

  const contentType = res.headers.get('content-type') || '';
  let data;
  if (contentType.includes('application/json')) {
   data = await res.json();
   reply.header('Content-Type', 'application/json');
  } else {
   data = await res.text();
  }

  reply
   .header('Access-Control-Allow-Origin', '*')
   .header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
   .header('Access-Control-Allow-Headers', 'Content-Type')
   .send(data);

 } catch (err) {
  reply.status(500).send({error: 'Request failed', details: err.message});
 }
});


// Start server
const PORT = process.env.APP_PORT || 3000;
const HOST = process.env.APP_HOST || '0.0.0.0';

try {
 await fastify.listen({port: Number(PORT), host: HOST});
} catch (err) {
 fastify.log.error(err);
 process.exit(1);
}

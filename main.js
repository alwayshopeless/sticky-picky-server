import Fastify from 'fastify'
import fastifyBetterSqlite3 from "@punkish/fastify-better-sqlite3";
import Database from 'better-sqlite3';
import * as fs from 'fs';
import cors from '@fastify/cors'
import * as crypto from 'crypto';

const fastify = Fastify({
 logger: true
})

await fastify.register(cors, {origin: '*'})

fastify.register(fastifyBetterSqlite3, {
 class: Database, pathToDb: './db.sqlite',
});

fastify.after(() => {
 const db = fastify.betterSqlite3;
 const schema = fs.readFileSync('./schema.sql', 'utf-8');
 db.exec(schema);
});

// helpers
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

async function authenticateMatrixUser(user_token, homeserver) {
 const url = `https://${homeserver}/_matrix/federation/v1/openid/userinfo?access_token=${encodeURIComponent(user_token)}`;
 let response
 try {
  response = await fetch(url)
 } catch (e) {
  return null
 }

 if (!response.ok) return null
 const data = await response.json()

 let username = data.sub.split(":")[0].replace("@", "")
 const expected = `@${username}:${homeserver}`

 if (data.sub === expected) return expected
 return null
}


function authenticateByToken(token, fastify) {
 const db = fastify.betterSqlite3
 console.log(db.prepare(`SELECT *
                         FROM users
                         WHERE token = ?`).get(token))
 return db.prepare(`SELECT *
                    FROM users
                    WHERE token = ?`).get(token)
}


const authMiddle = async (req, reply) => {

 const token = req.headers['authorization']?.replace('Bearer ', '')
 if (!token) return reply.code(401).send({error: "Missing token"})

 const user = authenticateByToken(token, fastify)
 if (!user) return reply.code(401).send({error: "Invalid token"})

 req.user = user
};


fastify.post('/api/v1/auth/login', async (req, reply) => {
 const {user_token, homeserver} = req.body
 if (!user_token || !homeserver) return reply.code(400).send({error: "Missing required fields"})

 const matrixId = await authenticateMatrixUser(user_token, homeserver)
 if (!matrixId) return reply.code(401).send({error: "Invalid Matrix token"})

 const db = fastify.betterSqlite3
 let user = db.prepare(`SELECT *
                        FROM users
                        WHERE matrix_id = ?`).get(matrixId)

 if (!user) {
  const token = generateToken()
  const info = db.prepare(`INSERT INTO users (matrix_id, token)
                           VALUES (?, ?)`).run(matrixId, token)
  user = {id: info.lastInsertRowid, matrix_id: matrixId, token}
 }

 // If user already exists but has no token (old users), generate one
 if (!user.token) {
  const token = generateToken()
  db.prepare(`UPDATE users
              SET token = ?
              WHERE id = ?`).run(token, user.id)
  user.token = token
 }

 return {token: user.token, matrix_id: user.matrix_id}
})


// routes
fastify.post('/api/v1/stickerpacks', async (req, reply) => {
 const {repository, homeserver, internal_name, name, type = "maunium"} = req.body;
 if (!repository || !homeserver || !internal_name) {
  return reply.code(400).send({error: "Missing required fields"});
 }
 if (!/^https?:\/\/.+\/$/.test(repository)) {
  return reply.code(400).send({error: "repository must be http(s)://.../ and end with /"});
 }

 const db = fastify.betterSqlite3;
 try {
  const stmt = db.prepare(`
      INSERT INTO stickerpacks (repository, homeserver, name, internal_name, type)
      VALUES (?, ?, ?, ?, ?)
  `);
  const info = stmt.run(repository, homeserver, normalizeName(name, internal_name), internal_name, type);
  return {stickerpack_id: info.lastInsertRowid};
 } catch (err) {
  return reply.code(400).send({error: err.message});
 }
});


/*
* Import stickerpacks from standart Maunium repository
* */
fastify.post('/api/v1/stickerpacks/import', async (req, reply) => {
 let {repository, type = "maunium"} = req.body;
 if (!repository || !/^https?:\/\//.test(repository)) {
  return reply.code(400).send({error: "Invalid repository"});
 }
 repository = repository.replace(/\/+$/, '');
 let indexJson;
 try {
  const res = await fetch(repository + "/packs/index.json");
  if (!res.ok) return reply.code(400).send({error: "Failed to fetch index.json"});
  indexJson = await res.json();
 } catch (e) {
  return reply.code(400).send({error: "Fetch error"});
 }

 const db = fastify.betterSqlite3;
 const created = [];

 for (const pack of indexJson.packs) {
  try {
   const packUrl = `${repository}/packs/${pack}`;
   let packJson;
   try {
    const res = await fetch(packUrl);
    if (!res.ok) throw new Error(`Failed to fetch ${packUrl}`);
    packJson = await res.json();
   } catch (e) {
    created.push({internal_name: pack, status: "error", error: "Failed to fetch pack.json"});
    continue;
   }

   const stmt = db.prepare(`
       INSERT INTO stickerpacks (repository, homeserver, name, internal_name, type)
       VALUES (?, ?, ?, ?, ?)
   `);
   const info = stmt.run(
    repository,
    indexJson.homeserver_url,
    packJson.title || pack,
    pack,
    type
   );
   created.push({internal_name: pack, stickerpack_id: info.lastInsertRowid, status: "success"});
  } catch (e) {
   // console.log(e);
   let status = "error";
   if (e.code == "SQLITE_CONSTRAINT_UNIQUE") {
    status = "already_exists";
   }
   created.push({internal_name: pack, status: status});
  }
 }

 return {imported: created};
});


fastify.get('/api/v1/stickerpacks/all', {}, async (req, reply,) => {
 const db = fastify.betterSqlite3
 const rows = db.prepare(`
     SELECT *
     FROM stickerpacks
 `).all()

 return {stickerpacks: rows}
});

fastify.post('/api/v1/user/stickerpacks', {
 preHandler: authMiddle
}, async (req, reply,) => {
 const db = fastify.betterSqlite3
 const user = req.user
 const rows = db.prepare(`
     SELECT s.*, usp.stickerpack_id
     FROM user_stickerpacks usp
              JOIN stickerpacks s ON usp.stickerpack_id = s.id
     WHERE usp.user_id = ?
 `).all(user.id)

 return {stickerpacks: rows}
});

fastify.post('/api/v1/user/stickerpacks/add', {
 preHandler: authMiddle
}, async (req, reply) => {
 const {stickerpack_id} = req.body
 const db = fastify.betterSqlite3
 const user = req.user

 try {
  db.prepare(`INSERT INTO user_stickerpacks (user_id, stickerpack_id)
              VALUES (?, ?)`).run(user.id, stickerpack_id)
 } catch (e) {
  return reply.code(400).send({error: e.message})
 }
 return {success: true}
})

fastify.post('/api/v1/user/stickerpacks/remove', {
 preHandler: authMiddle
}, async (req, reply) => {
 const {stickerpack_id} = req.body
 const db = fastify.betterSqlite3
 const user = req.user
 console.log(stickerpack_id)
 db.prepare(`DELETE
             FROM user_stickerpacks
             WHERE user_id = ?
               AND stickerpack_id = ?`)
  .run(user.id, stickerpack_id)
 return {success: true}
});


fastify.get('/api/v1/user/stickers', {preHandler: authMiddle}, async (req, reply) => {
 const user = req.user;

 let favorites = [];
 let recent = [];

 try {
  favorites = JSON.parse(user.favorites || '[]');
 } catch (e) {
  favorites = [];
 }

 try {
  recent = JSON.parse(user.recent || '[]');
 } catch (e) {
  recent = [];
 }

 return {
  favorites,
  recent
 };
});

fastify.get('/api/v1/stickerpacks/search', async (req, reply) => {
 const {q} = req.query;
 if (!q) return reply.code(400).send({error: "Missing search query"});

 const db = fastify.betterSqlite3;
 const rows = db.prepare(`SELECT *
                          FROM stickerpacks
                          WHERE name LIKE ?`).all(`%${q}%`);
 return {results: rows};
});


fastify.post('/api/v1/user/stickers/favorites/add', {preHandler: authMiddle}, async (req, reply) => {
 const {repository, body, url, info} = req.body;
 if (!repository || !body || !url || !info) return reply.code(400).send({error: "Missing required fields"});

 const db = fastify.betterSqlite3;
 const user = req.user;

 let favorites = JSON.parse(user.favorites || '[]');
 const spUid = generateSpUid();

 const newSticker = {spUid, repository, body, url, info};

 // Удаляем дубликаты по url
 favorites = favorites.filter(sticker => sticker.url !== url);

 // Удаляем последний, если больше 10
 if (favorites.length >= 10) favorites.pop();

 favorites.unshift(newSticker); // добавляем в начало

 db.prepare(`UPDATE users
             SET favorites = ?
             WHERE id = ?`)
  .run(JSON.stringify(favorites), user.id);

 return {success: true, sticker: newSticker};
});

fastify.post('/api/v1/user/stickers/favorites/remove', {preHandler: authMiddle}, async (req, reply) => {
 const {spUid} = req.body;
 if (!spUid) return reply.code(400).send({error: "Missing spUid"});

 const db = fastify.betterSqlite3;
 const user = req.user;

 let favorites = JSON.parse(user.favorites || '[]');
 favorites = favorites.filter(sticker => sticker.spUid !== spUid);

 db.prepare(`UPDATE users
             SET favorites = ?
             WHERE id = ?`)
  .run(JSON.stringify(favorites), user.id);

 return {success: true};
});

fastify.post('/api/v1/user/stickers/recent/add', {preHandler: authMiddle}, async (req, reply) => {
 const {repository, body, url, info} = req.body;
 if (!repository || !body || !url || !info) return reply.code(400).send({error: "Missing required fields"});

 const db = fastify.betterSqlite3;
 const user = req.user;

 let recent = JSON.parse(user.recent || '[]');
 const spUid = generateSpUid();

 const newSticker = {spUid, repository, body, url, info};

 // Удаляем дубликаты по url
 recent = recent.filter(sticker => sticker.url !== url);

 if (recent.length >= 20) recent.pop();

 recent.unshift(newSticker);

 db.prepare(`UPDATE users
             SET recent = ?
             WHERE id = ?`)
  .run(JSON.stringify(recent), user.id);

 return {success: true, sticker: newSticker};
});

fastify.post('/api/v1/user/stickers/recent/remove', {preHandler: authMiddle}, async (req, reply) => {
 const {spUid} = req.body;
 if (!spUid) return reply.code(400).send({error: "Missing spUid"});

 const db = fastify.betterSqlite3;
 const user = req.user;

 let recent = JSON.parse(user.recent || '[]');
 recent = recent.filter(sticker => sticker.spUid !== spUid);

 db.prepare(`UPDATE users
             SET recent = ?
             WHERE id = ?`)
  .run(JSON.stringify(recent), user.id);

 return {success: true};
});


try {
 await fastify.listen({port: 3000})
} catch (err) {
 fastify.log.error(err)
 process.exit(1)
}

import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { pool } from '../db/pool.js';
import type { UserRow } from '../types/models.js';
import { generateToken } from '../utils/token.js';

interface MatrixUserInfo {
  sub: string;
}

export async function authenticateMatrixUser(userToken: string, homeserver: string) {
  const url = `https://${homeserver}/_matrix/federation/v1/openid/userinfo?access_token=${encodeURIComponent(userToken)}`;

  let response: Response;
  try {
    response = await fetch(url);
  } catch {
    return null;
  }

  if (!response.ok) {
    return null;
  }

  const data = (await response.json()) as MatrixUserInfo;
  const username = data.sub.split(':')[0]?.replace('@', '');
  const expected = `@${username}:${homeserver}`;

  return data.sub === expected ? expected : null;
}

export async function authenticateByToken(token: string) {
  const [rows] = await pool.query<(UserRow & RowDataPacket)[]>(
    `SELECT *
     FROM users
     WHERE token = ?`,
    [token],
  );

  return rows[0] as UserRow | undefined;
}

export async function findUserByMatrixId(matrixId: string) {
  const [rows] = await pool.query<(UserRow & RowDataPacket)[]>(
    `SELECT *
     FROM users
     WHERE matrix_id = ?`,
    [matrixId],
  );

  return rows[0] as UserRow | undefined;
}

export async function ensureUserToken(user: UserRow) {
  if (user.token) {
    return user;
  }

  const token = generateToken();
  await pool.query(
    `UPDATE users
     SET token = ?
     WHERE id = ?`,
    [token, user.id],
  );

  return { ...user, token };
}

export async function createUser(matrixId: string) {
  const token = generateToken();
  const [result] = await pool.query<ResultSetHeader>(
    `INSERT INTO users (matrix_id, token)
     VALUES (?, ?)`,
    [matrixId, token],
  );

  return {
    id: result.insertId,
    matrix_id: matrixId,
    token,
    favorites: '[]',
    recent: '[]',
  } satisfies UserRow;
}

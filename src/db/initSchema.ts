import fs from 'node:fs';
import { pool } from './pool.js';

export async function initSchema() {
  const schemaPath = new URL('../../schema.sql', import.meta.url);
  const schema = fs.readFileSync(schemaPath, 'utf-8');
  const statements = schema
    .split(';')
    .map((statement) => statement.trim())
    .filter(Boolean);

  const connection = await pool.getConnection();

  try {
    for (const statement of statements) {
      await connection.query(statement);
    }
  } finally {
    connection.release();
  }
}

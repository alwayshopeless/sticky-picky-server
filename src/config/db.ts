import type { PoolOptions } from 'mysql2/promise';

export const dbConfig: PoolOptions = {
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || '3306'),
  user: process.env.DB_USER || 'sticky-picky',
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || 'sticky_picky',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
};

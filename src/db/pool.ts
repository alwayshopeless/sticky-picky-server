import mysql from 'mysql2/promise';
import { dbConfig } from '../config/db.js';

export const pool = mysql.createPool(dbConfig);

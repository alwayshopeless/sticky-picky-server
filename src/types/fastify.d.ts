import 'fastify';
import type { UserRow } from './models.js';

declare module 'fastify' {
  interface FastifyRequest {
    user?: UserRow;
  }
}

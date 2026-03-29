import type { FastifyReply, FastifyRequest } from 'fastify';
import { authenticateByToken } from '../services/auth.js';

export async function authMiddleware(request: FastifyRequest, reply: FastifyReply) {
  const token = request.headers.authorization?.replace('Bearer ', '');

  if (!token) {
    return reply.code(401).send({ error: 'Missing token' });
  }

  const user = await authenticateByToken(token);
  if (!user) {
    return reply.code(401).send({ error: 'Invalid token' });
  }

  request.user = user;
}

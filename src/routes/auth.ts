import type { FastifyInstance } from 'fastify';
import { authenticateMatrixUser, createUser, ensureUserToken, findUserByMatrixId } from '../services/auth.js';

interface LoginBody {
  user_token?: string;
  homeserver?: string;
}

export async function registerAuthRoutes(fastify: FastifyInstance) {
  fastify.post<{ Body: LoginBody }>('/api/v1/auth/login', async (request, reply) => {
    const { user_token: userToken, homeserver } = request.body;

    if (!userToken || !homeserver) {
      return reply.code(400).send({ error: 'Missing required fields' });
    }

    const matrixId = await authenticateMatrixUser(userToken, homeserver);
    if (!matrixId) {
      return reply.code(401).send({ error: 'Invalid Matrix token' });
    }

    let user = await findUserByMatrixId(matrixId);
    if (!user) {
      user = await createUser(matrixId);
    }

    user = await ensureUserToken(user);
    return { token: user.token, matrix_id: user.matrix_id };
  });
}

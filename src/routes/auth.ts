import type { FastifyInstance } from 'fastify';
import { errorResponseSchema } from '../docs/schemas.js';
import { authenticateMatrixUser, createUser, ensureUserToken, findUserByMatrixId } from '../services/auth.js';

interface LoginBody {
  user_token?: string;
  homeserver?: string;
}


// Verify the user by his home server
export async function registerAuthRoutes(fastify: FastifyInstance) {
  fastify.post<{ Body: LoginBody }>(
    '/api/v1/auth/login',
    {
      schema: {
        tags: ['Auth'],
        summary: 'Log in with a Matrix access token',
        body: {
          type: 'object',
          properties: {
            user_token: { type: 'string' },
            homeserver: { type: 'string' },
          },
          required: ['user_token', 'homeserver'],
        },
        response: {
          200: {
            type: 'object',
            properties: {
              token: { type: 'string' },
              matrix_id: { type: 'string' },
            },
            required: ['token', 'matrix_id'],
          },
          400: errorResponseSchema,
          401: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
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
    },
  );
}

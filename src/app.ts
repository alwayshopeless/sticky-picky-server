import cors from '@fastify/cors';
import Fastify from 'fastify';
import { initSchema } from './db/initSchema.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerCorsProxyRoutes } from './routes/corsProxy.js';
import { registerStickerpackRoutes } from './routes/stickerpacks.js';
import { registerUserRoutes } from './routes/user.js';

export async function buildApp() {
  const fastify = Fastify({ logger: true });

  await fastify.register(cors, { origin: '*' });
  await initSchema();

  await registerAuthRoutes(fastify);
  await registerStickerpackRoutes(fastify);
  await registerUserRoutes(fastify);
  await registerCorsProxyRoutes(fastify);

  return fastify;
}

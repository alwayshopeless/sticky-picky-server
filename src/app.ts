import cors from '@fastify/cors';
import Fastify from 'fastify';
import { env } from './config/env.js';
import { initSchema } from './db/initSchema.js';
import { registerApiDocs } from './docs/registerApiDocs.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerCorsProxyRoutes } from './routes/corsProxy.js';
import { registerStickerpackRoutes } from './routes/stickerpacks.js';
import { registerUserRoutes } from './routes/user.js';

export async function buildApp() {
  const fastify = Fastify({ logger: true });

  await fastify.register(cors, {
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  if (env.apiDocsEnabled) {
    await registerApiDocs(fastify);
  }

  await initSchema();

  await registerAuthRoutes(fastify);
  await registerStickerpackRoutes(fastify);
  await registerUserRoutes(fastify);
  await registerCorsProxyRoutes(fastify);

  return fastify;
}

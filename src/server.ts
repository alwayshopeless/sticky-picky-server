import { buildApp } from './app.js';
import { env } from './config/env.js';

const fastify = await buildApp();

try {
  await fastify.listen({ port: env.appPort, host: env.appHost });
} catch (error) {
  fastify.log.error(error);
  process.exit(1);
}

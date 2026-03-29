import swagger from '@fastify/swagger';
import scalarApiReference from '@scalar/fastify-api-reference';
import type { FastifyInstance } from 'fastify';

export async function registerApiDocs(fastify: FastifyInstance) {
  await fastify.register(swagger, {
    openapi: {
      openapi: '3.0.3',
      info: {
        title: 'Sticky Picky Server API',
        description: 'API for the Sticky Picky Matrix sticker picker backend.',
        version: '1.0.0',
      },
      tags: [
        { name: 'Auth', description: 'Authentication endpoints' },
        { name: 'Stickerpacks', description: 'Sticker pack management endpoints' },
        { name: 'User', description: 'User sticker data endpoints' },
      ],
      components: {
        securitySchemes: {
          bearerAuth: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'Bearer <token>',
          },
        },
      },
    },
  });

  await fastify.register(scalarApiReference, {
    routePrefix: '/docs',
    configuration: {
      title: 'Sticky Picky Server API',
      theme: 'kepler',
      layout: 'modern',
      defaultHttpClient: {
        targetKey: 'js',
        clientKey: 'fetch',
      },
    },
  });
}

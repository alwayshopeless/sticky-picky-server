import type { FastifyInstance } from 'fastify';

interface CorsProxyParams {
  '*': string;
}

export async function registerCorsProxyRoutes(fastify: FastifyInstance) {
  fastify.get<{ Params: CorsProxyParams }>('/cors/*', async (request, reply) => {
    let targetUrl = request.params['*'];

    if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
      targetUrl = `https://${targetUrl}`;
    }

    try {
      const response = await fetch(targetUrl);
      const contentType = response.headers.get('content-type') || '';

      let data: unknown;
      if (contentType.includes('application/json')) {
        data = await response.json();
        reply.header('Content-Type', 'application/json');
      } else {
        data = await response.text();
      }

      return reply
        .header('Access-Control-Allow-Origin', '*')
        .header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
        .header('Access-Control-Allow-Headers', 'Content-Type')
        .send(data);
    } catch (error) {
      return reply.status(500).send({ error: 'Request failed', details: (error as Error).message });
    }
  });
}

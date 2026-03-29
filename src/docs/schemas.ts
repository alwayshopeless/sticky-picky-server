export const errorResponseSchema = {
  type: 'object',
  properties: {
    error: { type: 'string' },
  },
  required: ['error'],
} as const;

export const successResponseSchema = {
  type: 'object',
  properties: {
    success: { type: 'boolean' },
  },
  required: ['success'],
} as const;

export const stickerpackSchema = {
  type: 'object',
  properties: {
    id: { type: 'integer' },
    repository: { type: 'string' },
    homeserver: { type: 'string' },
    name: { type: 'string' },
    internal_name: { type: 'string' },
    type: { type: 'string' },
  },
  required: ['id', 'repository', 'homeserver', 'name', 'internal_name', 'type'],
} as const;

export const stickerPayloadSchema = {
  type: 'object',
  properties: {
    repository: { type: 'string' },
    body: { type: 'string' },
    url: { type: 'string' },
    info: {},
  },
  required: ['repository', 'body', 'url', 'info'],
} as const;

export const stickerWithUidSchema = {
  type: 'object',
  properties: {
    spUid: { type: 'string' },
    repository: { type: 'string' },
    body: { type: 'string' },
    url: { type: 'string' },
    info: {},
  },
  required: ['spUid', 'repository', 'body', 'url', 'info'],
} as const;

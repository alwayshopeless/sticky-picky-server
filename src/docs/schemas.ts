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
    owner_user_id: { anyOf: [{ type: 'integer' }, { type: 'null' }] },
    visibility: { type: 'string' },
    created_at: { type: 'string' },
    updated_at: { type: 'string' },
  },
  required: ['id', 'repository', 'homeserver', 'name', 'internal_name', 'type', 'owner_user_id', 'visibility', 'created_at', 'updated_at'],
} as const;

export const stickerpackStickerSchema = {
  type: 'object',
  properties: {
    id: { type: 'integer' },
    stickerpack_id: { type: 'integer' },
    stickerpack_type: { type: 'string' },
    repository: { type: 'string' },
    body: { type: 'string' },
    url: { type: 'string' },
    info: {},
    sort_order: { type: 'integer' },
  },
  required: ['id', 'stickerpack_id', 'stickerpack_type', 'repository', 'body', 'url', 'info', 'sort_order'],
} as const;

export const matrixStickerPayloadSchema = {
  type: 'object',
  properties: {
    body: { type: 'string' },
    url: { type: 'string' },
    info: {},
  },
  required: ['body', 'url', 'info'],
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

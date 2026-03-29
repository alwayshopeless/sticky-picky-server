export const env = {
  appHost: process.env.APP_HOST || '0.0.0.0',
  appPort: Number(process.env.APP_PORT || 3000),
  apiDocsEnabled:
    process.env.API_DOCS_ENABLED === 'true' ||
    (process.env.API_DOCS_ENABLED !== 'false' && process.env.NODE_ENV !== 'production'),
};

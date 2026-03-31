FROM node:20-slim

ENV NODE_ENV=production

RUN corepack enable && corepack prepare pnpm@latest --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml tsconfig.json ./
RUN pnpm config set shamefully-hoist true
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build
RUN test -f dist/db/migrator.js
RUN test -f dist/db/migrations/0001_initial.js
RUN test -f dist/db/migrations/0004_stickerpack_parent_refs.js
EXPOSE 3000

CMD ["node", "dist/server.js"]

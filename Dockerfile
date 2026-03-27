FROM node:20-slim

ENV NODE_ENV=production

RUN corepack enable && corepack prepare pnpm@latest --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm config set shamefully-hoist true
RUN pnpm install --frozen-lockfile
COPY . .
EXPOSE 3000

CMD ["node", "main.js"]
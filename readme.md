# Sticky Picky Server

Backend service for [sticky-picky](https://github.com/alwayshopeless/sticky-picky), a Matrix sticker picker client.

This server stores sticker pack metadata, keeps per-user sticker data, and provides a small API layer that the client can use to authenticate users, browse/import sticker packs, and manage favorites and recent stickers.

## What This Server Does

The project is a Fastify + MySQL backend for the Sticky Picky project. In general, it is responsible for:

- authenticating users through their Matrix homeserver using a Matrix access token
- issuing and storing an internal API token for the client
- storing sticker pack records in MySQL
- storing Matrix MXC-backed sticker packs and their sticker metadata
- importing sticker packs from remote repositories
- attaching sticker packs to user accounts
- storing user-specific `favorites` and `recent` sticker lists
- exposing a simple CORS proxy endpoint for remote resources

## Common info

- Matrix-based login flow
- automatic schema migrations on startup
- sticker pack creation and bulk import
- custom stickers list for every user
- favorites and recent sticker history management

## Tech Stack

- Node.js
- TypeScript
- Fastify
- MySQL
- Docker
- Scalar API Reference
- `pnpm`

## API Overview

The server registers the following route groups:

- `/api/v1/auth`
  Handles login through Matrix OpenID-style user verification and returns an internal token for further API calls.

- `/api/v1/stickerpacks`
  Creates sticker pack records, imports packs from remote repositories, lists public packs, supports search, and manages Matrix MXC-backed sticker packs and sticker entries.

- `/api/v1/user`
  Returns the current user's sticker packs, favorites, and recent stickers, and allows modifying that data.

- `/cors/*`
  Fetches remote resources and returns them with permissive CORS headers. Can be deprecated in future updates.

## Authentication

The login endpoint expects:

- `user_token`: a Matrix user access token
- `homeserver`: the Matrix homeserver domain

After successful verification, the backend returns its own internal token. That token is then used by authenticated user routes through the project's auth middleware.

## Data Model

The database now contains four main application tables:

- `users`
  Stores the Matrix user ID, internal API token, and JSON arrays for `favorites` and `recent`.

- `stickerpacks`
  Stores repository information, homeserver, display name, internal pack name, pack type, ownership, and visibility.

- `user_stickerpacks`
  A join table linking users and sticker packs.

- `stickerpack_stickers`
  Stores per-pack sticker metadata for backend-managed Matrix MXC packs.

## Running Locally

### 1. Install dependencies

```bash
pnpm install
```

### 2. Configure the database

Make sure a MySQL database exists and matches your environment variables.

By default, the schema expects the `sticky_picky` database:

```sql
CREATE DATABASE sticky_picky;
```

### 3. Start the development server

```bash
pnpm dev
```

The app will start on `APP_HOST:APP_PORT` and automatically run pending database migrations before serving requests.

## API Documentation

The project includes OpenAPI-based API documentation rendered with Scalar.

- In non-production environments, the docs are available at `/docs`
- In `production`, the docs are disabled by default
- You can override this behavior with `API_DOCS_ENABLED=true` or `API_DOCS_ENABLED=false`

## Recommended Deployment

The current self-hosting path is the Traefik-based setup in [`deployment/traefik/`](deployment/traefik/README.md).

This is the recommended way to deploy the full application at a pinned release version:

```bash
git clone --branch v1.0.0 --depth 1 https://github.com/alwayshopeless/sticky-picky-server.git
cd sticky-picky-server/deployment/traefik
cp .env.example .env
```

Then edit `.env` and set at least:

- `APP_DOMAIN`
- `FRONTEND_VERSION`
- `TRAEFIK_NETWORK`
- `TRAEFIK_CERTRESOLVER`
- `MYSQL_DATABASE`
- `MYSQL_USER`
- `MYSQL_PASSWORD`
- `MYSQL_ROOT_PASSWORD`

After that, start the stack:

```bash
docker compose up -d --build
```

This deployment flow will:

- build the backend container from this repository
- run database migrations automatically on startup
- download the frontend release artifact for `FRONTEND_VERSION` during the frontend image build
- serve the frontend through nginx
- route `/api` to the backend through Traefik on the same domain
- replace `__BACKEND_URL__` in the frontend with `https://APP_DOMAIN/api/v1/` at container startup

This setup expects:

- an existing Traefik instance
- a shared external Docker network for Traefik, for example `traefik`
- a public DNS record pointing `APP_DOMAIN` to your server

## Local Docker Compose

For local backend-only development, this repository still includes the older root compose files:

```bash
docker compose up --build
```

There is also a local development variant with an extra reverse proxy:

```bash
docker compose -f docker-compose.yaml -f docker-compose.dev.yaml up --build
```

These are still useful for local work, but they are no longer the main documented self-hosting path.

## Notes

- Database migrations are applied automatically during app startup using `Umzug` and the migrations in `src/db/migrations`.
- Existing instances can update in place: new columns and tables are added through migrations without requiring a fresh database.
- The frontend is versioned independently and is expected to be deployed from its GitHub release artifacts by tag, for example `v1.0.0`.
- CORS is currently configured with `origin: *`.
- API docs are enabled by default only outside production.
- Imported sticker packs are expected to expose a `packs/index.json` file and individual pack JSON files under `packs/` from Maunium Stickerpicker: https://github.com/maunium/stickerpicker

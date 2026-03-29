# Sticky Picky Server

Backend service for [sticky-picky](https://github.com/alwayshopeless/sticky-picky), a Matrix sticker picker client.

This server stores sticker pack metadata, keeps per-user sticker data, and provides a small API layer that the client can use to authenticate users, browse/import sticker packs, and manage favorites and recent stickers.

## What This Server Does

The project is a Fastify + MySQL backend for the Sticky Picky project. In general, it is responsible for:

- authenticating users through their Matrix homeserver using a Matrix access token
- issuing and storing an internal API token for the client
- storing sticker pack records in MySQL
- importing sticker packs from remote repositories
- attaching sticker packs to user accounts
- storing user-specific `favorites` and `recent` sticker lists
- exposing a simple CORS proxy endpoint for remote resources

## Common info

- Matrix-based login flow
- automatic schema initialization on startup
- sticker pack creation and bulk import
- custom stickers list for every user
- favorites and recent sticker history management

## Tech Stack

- Node.js
- TypeScript
- Fastify
- MySQL
- Docker
- `pnpm`

## API Overview

The server registers the following route groups:

- `/api/v1/auth`
  Handles login through Matrix OpenID-style user verification and returns an internal token for further API calls.

- `/api/v1/stickerpacks`
  Creates sticker pack records, imports packs from remote repositories, lists all stored packs, and supports search.

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

The database contains three main tables:

- `users`
  Stores the Matrix user ID, internal API token, and JSON arrays for `favorites` and `recent`.

- `stickerpacks`
  Stores repository information, homeserver, display name, internal pack name, and pack type.

- `user_stickerpacks`
  A join table linking users and sticker packs.

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

The app will start on `APP_HOST:APP_PORT` and initialize the database schema automatically from schema.sql.

## Running With Docker Compose

This repository includes a MySQL + app setup:

```bash
docker compose up --build
```

There is also a development compose file with an additional Caddy-based reverse proxy:

```bash
docker compose -f docker-compose.yaml -f docker-compose.dev.yaml up --build
```

There is also a separate Traefik override config for deployments behind an existing Traefik instance:

```bash
docker compose -f docker-compose.yaml -f docker-compose.traefik.yaml up --build
```

## Notes

- The schema is initialized automatically during app startup.
- CORS is currently configured with `origin: *`.
- Imported sticker packs are expected to expose a `packs/index.json` file and individual pack JSON files under `packs/` from Maunium Stickerpicker: https://github.com/maunium/stickerpicker

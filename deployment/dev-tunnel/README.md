# Dev Tunnel Setup

This setup is intended for local development behind a single public tunnel domain.

It runs:

- MySQL in Docker
- the backend in Docker with `pnpm dev`
- nginx in Docker as a local reverse proxy
- Vite on the host machine for HMR

Traffic flow:

- `/api/v1/*` -> backend container
- everything else -> local Vite dev server on `host.docker.internal:5173`

## 1. Prepare env

From this directory:

```bash
cp .env.example .env
```

Adjust ports if needed and set `DEV_TUNNEL_DOMAIN` to your Cloudflare hostname.
Also set `DEV_TUNNEL_NAME` to an existing named Cloudflare Tunnel.
`DEV_TUNNEL_ID` is optional; if omitted, the helper script derives it from the credentials JSON.

## 2. Start the local stack

From `deployment/dev-tunnel/` run:

```bash
docker compose up --build
```

This exposes the local reverse proxy on `http://127.0.0.1:8080` by default.

## 3. Start Vite on the host

From the frontend repository run:

```bash
pnpm dev
```

Vite should listen on `0.0.0.0:5173`.

## 4. Expose it through Cloudflare Tunnel

Create a named tunnel once if you do not have one yet:

```bash
cloudflared tunnel create sticky-picky-dev
cloudflared tunnel route dns sticky-picky-dev your-dev-domain.example.com
```

The helper script in the repository root starts the tunnel for `DEV_TUNNEL_DOMAIN` automatically:

```bash
./run-dev.sh
```

If you want to start only the Docker stack without `cloudflared`:

```bash
./run-dev.sh --no-tunnel
```

## Notes

- Local HTTPS is not required here because TLS is terminated by Cloudflare Tunnel.
- The frontend uses the current origin for backend requests, so both UI and API should stay on the same public host.
- `host.docker.internal` is enabled through `extra_hosts` for Linux Docker.
- The helper script expects named tunnel credentials at `~/.cloudflared/<DEV_TUNNEL_NAME>.json` unless `DEV_TUNNEL_CREDENTIALS_FILE` is set.
- The generated Cloudflare config is based on [`cloudflared.yml.template`](/run/media/who/Files/Development/vzlomDjop/matrix/sitcky-picky/sticky-picky-server/deployment/dev-tunnel/cloudflared.yml.template).

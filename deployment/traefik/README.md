# Traefik Deployment

This setup runs Sticky Picky behind an existing Traefik instance.

It expects:

- a Docker network already shared with Traefik, for example `traefik`
- a public DNS record pointing `APP_DOMAIN` to your server

## 1. Configure environment

Copy the example env file:

```bash
cp .env.example .env
```

Fill in:

- `APP_DOMAIN`
- `FRONTEND_VERSION`
- `TRAEFIK_NETWORK`
- `TRAEFIK_CERTRESOLVER`
- database credentials

`FRONTEND_VERSION` should match a frontend GitHub release tag, for example:

```env
FRONTEND_VERSION=v1.0.0
```

## 2. Start the stack

From `deployment/traefik/` run:

```bash
docker compose up -d --build
```

## Notes

- The backend applies database migrations automatically on startup.
- The frontend image downloads the release artifact for `FRONTEND_VERSION` during `docker compose build`.
- The frontend container replaces `__BACKEND_URL__` in `index.html` with `https://APP_DOMAIN/api/v1/` on startup.
- This setup assumes Traefik already exposes the `websecure` entrypoint and the configured cert resolver.

# WAHA — local GOWS ARM64

Build this checkout with Docker Compose on an ARM64 Docker host (for example,
Apple Silicon). Other hosts require ARM64 emulation. The image is tagged
`waha-local:gows-arm` locally; nothing is pushed to Docker Hub.

## Setup

```sh
make init
```

This builds the image and uses WAHA's `init-waha` command to generate `.env`
with random API and Dashboard/Swagger credentials. It refuses to overwrite
an existing nonempty `.env`. For an existing configuration, run `make build`
instead and ensure `WHATSAPP_DEFAULT_ENGINE=GOWS` is set in `.env`.

Edit `.env`, then start:

```sh
docker compose up -d --build
```

Open http://localhost:3000/dashboard or http://localhost:3000 for Swagger.
Credentials are in `.env`; API requests use the `X-Api-Key` header.

Runtime configuration uses the official WAHA [`env_file: .env` convention](https://waha.devlike.pro/docs/how-to/config/).
Keep the internal API port at 3000 to match Compose. Sessions persist in
`./sessions` and media in `./media`. `docker compose down` retains both folders.

```sh
docker compose logs -f waha
docker compose down
```

The Dockerfile builds the application from this checkout and downloads the
GOWS ARM64 binary and Dashboard pinned in `waha.config.json`. It installs no
browser or Go compiler. Application sources and dependencies remain intact
because engine modules share imports. Node and Yarn versions follow the
Dockerfile and `package.json`.

[WAHA documentation](https://waha.devlike.pro/) · [GOWS](https://waha.devlike.pro/docs/engines/gows/)

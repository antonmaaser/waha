# WAHA — local GOWS ARM64

This checkout builds `waha-local:gows-arm` locally for `linux/arm64`.
The image includes the WAHA API, MCP app, Dashboard, and GOWS binary.
An ARM64 Docker host is recommended; other hosts need ARM64 emulation.

## Build

```sh
touch .env
docker compose build
```

Edit `src/apps/mcp/` before building. Tool definitions are in `tools/*.tools.ts`
and their input schemas in `tools/*.zod.ts`. Building compiles this checkout;
it does not start or replace a running container.

The Dockerfile separates cached dependencies, TypeScript compilation,
production dependencies, downloaded assets, native media tooling, and the final
runtime. Source edits reuse dependency and native-runtime layers. The release
image contains production Node dependencies, compiled code in `/app/dist`,
and a copy of the MCP source in `/app/src/apps/mcp` for inspection.

Node `24.11.1-bookworm-slim` and Alpine `3.22.2` bases are pinned by digest.
Alpine only downloads assets: the supplied GOWS ARM64 binary needs glibc and
libvips, so compilation and execution use Debian slim. GOWS and Dashboard
versions are pinned in `waha.config.json`. No browser or compiler is installed
in the release image.

## Configure and serve

Generate credentials once using the built image:

```sh
docker compose run --rm --no-deps -v "$PWD:/app/env" waha init-waha /app/env
chmod 600 .env
```

This refuses to overwrite a nonempty `.env`. Existing installations keep their
configuration. Set `WHATSAPP_DEFAULT_ENGINE=GOWS` in `.env`.

```sh
docker compose up -d --no-build --wait
```

Compose runs the locally built image and never pulls a published WAHA image.
The readiness check uses WAHA's `/ping` endpoint. Open
http://localhost:3000/dashboard or http://localhost:3000 for Swagger.
Use credentials from `.env`; API requests use `X-Api-Key`.

Runtime configuration follows WAHA's [`env_file: .env` convention](https://waha.devlike.pro/docs/how-to/config/).
The build excludes credentials and local session/media data. Only
`./sessions` and `./media` are mounted; application code runs from the image.
Keep the internal HTTP port at 3000 to match Compose. Changes to runtime settings
require `docker compose up -d --no-build --wait` to recreate the container.

After editing source, repeat `docker compose build`, then
`docker compose up -d --no-build --wait`. The running container keeps its previous
image until the second command replaces it. `docker compose restart` does not
apply a new image or changed `.env` values.

## Inspect and stop

```sh
docker compose ps
docker compose logs -f waha
docker compose exec waha sh
```

Inside the container, inspect `/app/src/apps/mcp` and `/app/dist/apps/mcp`.
To inspect the built image without starting the service:

```sh
docker compose run --rm --no-deps --entrypoint sh waha
```

```sh
docker compose down
```

Stopping or replacing the container preserves `./sessions` and `./media`.

## Upstream model

The official [Dockerfile](https://github.com/devlikeapro/waha/blob/core/Dockerfile)
assembles application code, Dashboard, GOWS, and native runtime libraries.
The [release workflow](https://github.com/devlikeapro/waha/blob/core/.github/workflows/build.yaml)
selects architecture, browser, and default engine, tests each variant, and pushes
it to Docker Hub. The official [Compose file](https://github.com/devlikeapro/waha/blob/core/docker-compose.yaml)
then serves that published image with `.env` and persistent data mounts.

Here Compose builds the single browserless GOWS ARM64 variant from local source
and serves that local image using the same runtime configuration model.

# Explicit versions and digests keep base image selection reproducible.
ARG NODE_IMAGE=node:24.11.1-bookworm-slim@sha256:48abc13a19400ca3985071e287bd405a1d99306770eb81d61202fb6b65cf0b57
ARG ASSETS_IMAGE=alpine:3.22.2@sha256:4b7ce07002c69e8f3d704a9c5d6fd3053be500b7f1c69fc0d80990c2ad8dd412

FROM ${NODE_IMAGE} AS dependencies
ENV PUPPETEER_SKIP_DOWNLOAD=True
WORKDIR /git
RUN apt-get update && \
    apt-get install -y --no-install-recommends git python3 build-essential curl ca-certificates unzip && \
    rm -rf /var/lib/apt/lists/*
RUN npm install -g corepack@0.34.5 && corepack enable
COPY package.json yarn.lock .yarnrc.yml ./
RUN --mount=type=cache,id=waha-yarn-arm64,target=/git/.yarn/cache yarn install --immutable

# Compile this checkout; source edits do not invalidate dependency installation.
FROM dependencies AS build
COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src ./src
RUN yarn build && find ./dist -name '*.d.ts' -delete

# Prune build tools independently of source compilation.
FROM dependencies AS production-dependencies
RUN --mount=type=cache,id=waha-yarn-arm64,target=/git/.yarn/cache yarn workspaces focus --all --production

# These stages only download assets; they do not run the glibc GOWS binary.
FROM ${ASSETS_IMAGE} AS assets
RUN apk add --no-cache ca-certificates curl jq unzip
COPY waha.config.json /tmp/waha.config.json

FROM assets AS dashboard
RUN set -eu; \
    repo=$(jq -r '.waha.dashboard.repo' /tmp/waha.config.json); \
    ref=$(jq -r '.waha.dashboard.ref' /tmp/waha.config.json); \
    curl --fail --location --retry 3 "https://github.com/${repo}/archive/${ref}.zip" -o /tmp/dashboard.zip; \
    unzip -q /tmp/dashboard.zip -d /tmp/dashboard; \
    mv "/tmp/dashboard/dashboard-${ref}" /dashboard

FROM assets AS gows
ARG TARGETARCH
RUN test "$TARGETARCH" = arm64
RUN set -eu; \
    repo=$(jq -r '.waha.gows.repo' /tmp/waha.config.json); \
    ref=$(jq -r '.waha.gows.ref' /tmp/waha.config.json); \
    curl --fail --location --retry 3 "https://github.com/${repo}/releases/download/${ref}/gows-${TARGETARCH}" -o /gows; \
    chmod +x /gows

FROM ${NODE_IMAGE} AS opustags
ARG OPUSTAGS_VERSION=1.10.1
RUN apt-get update && \
    apt-get install -y --no-install-recommends build-essential cmake pkg-config libogg-dev curl ca-certificates && \
    rm -rf /var/lib/apt/lists/*
RUN set -eu; \
    curl --fail --location --retry 3 "https://github.com/fmang/opustags/archive/refs/tags/${OPUSTAGS_VERSION}.tar.gz" -o /tmp/opustags.tar.gz; \
    tar -xzf /tmp/opustags.tar.gz -C /tmp; \
    cmake -S "/tmp/opustags-${OPUSTAGS_VERSION}" -B /tmp/build -DCMAKE_BUILD_TYPE=Release; \
    cmake --build /tmp/build; \
    cmake --install /tmp/build --prefix /output

# GOWS and the Node native addons need a glibc runtime.
FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production \
    PUPPETEER_SKIP_DOWNLOAD=True \
    NODE_OPTIONS=--max-old-space-size=16384 \
    WHATSAPP_DEFAULT_ENGINE=GOWS \
    WAHA_GOWS_PATH=/app/gows \
    WAHA_GOWS_SOCKET=/tmp/gows.sock \
    WAHA_ZIPPER=ZIPUNZIP \
    GODEBUG=netdns=cgo
RUN apt-get update && \
    apt-get install -y --no-install-recommends ffmpeg libvips42 libogg0 zip unzip ca-certificates tini && \
    rm -rf /var/lib/apt/lists/*
COPY --from=opustags /output/bin/opustags /usr/local/bin/opustags
WORKDIR /app
COPY .env.example ./.env.example
COPY scripts/init-waha.js ./scripts/init-waha.js
RUN printf '%s\n' '#!/bin/sh' 'exec node /app/scripts/init-waha.js "$@"' > /usr/local/bin/init-waha && \
    chmod +x /usr/local/bin/init-waha
COPY --chmod=755 entrypoint.sh /entrypoint.sh
EXPOSE 3000
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["/entrypoint.sh"]

# Stable runtime artifacts precede the layers that change with local MCP edits.
FROM runtime AS release
COPY package.json ./
COPY --from=production-dependencies /git/node_modules ./node_modules
COPY --from=gows /gows ./gows
COPY --from=dashboard /dashboard ./dist/dashboard
COPY --from=build /git/dist ./dist
COPY --from=build /git/src/apps/mcp ./src/apps/mcp

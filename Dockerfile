ARG NODE_IMAGE_TAG=24.11-bookworm-slim

#
# Build
#
FROM node:${NODE_IMAGE_TAG} AS build
ENV PUPPETEER_SKIP_DOWNLOAD=True

# git + build toolchain for git deps
RUN apt-get update && \
    apt-get install -y --no-install-recommends git python3 build-essential curl ca-certificates unzip && \
    rm -rf /var/lib/apt/lists/*

# npm packages
WORKDIR /git
COPY package.json .
COPY yarn.lock .
COPY .yarnrc.yml .
ENV YARN_CHECKSUM_BEHAVIOR=update

RUN npm install -g corepack && corepack enable
RUN yarn install

# App
WORKDIR /git
ADD . /git
RUN yarn install
RUN yarn build && find ./dist -name "*.d.ts" -delete

#
# Dashboard
#
FROM node:${NODE_IMAGE_TAG} AS dashboard

# jq to parse json
RUN apt-get update && apt-get install -y jq && rm -rf /var/lib/apt/lists/*

# wget, unzip
RUN apt-get update && apt-get install -y wget unzip && rm -rf /var/lib/apt/lists/*

COPY waha.config.json /tmp/waha.config.json
RUN \
    WAHA_DASHBOARD_GITHUB_REPO=$(jq -r '.waha.dashboard.repo' /tmp/waha.config.json) && \
    WAHA_DASHBOARD_SHA=$(jq -r '.waha.dashboard.ref' /tmp/waha.config.json) && \
    wget https://github.com/${WAHA_DASHBOARD_GITHUB_REPO}/archive/${WAHA_DASHBOARD_SHA}.zip \
    && unzip ${WAHA_DASHBOARD_SHA}.zip -d /tmp/dashboard \
    && mkdir -p /dashboard \
    && mv /tmp/dashboard/dashboard-${WAHA_DASHBOARD_SHA}/* /dashboard/ \
    && rm -rf ${WAHA_DASHBOARD_SHA}.zip \
    && rm -rf /tmp/dashboard/dashboard-${WAHA_DASHBOARD_SHA}

#
# GOWS
#
FROM node:${NODE_IMAGE_TAG} AS gows
ARG TARGETARCH
RUN test "$TARGETARCH" = "arm64"
RUN apt-get update && \
    apt-get install -y --no-install-recommends jq wget ca-certificates && \
    rm -rf /var/lib/apt/lists/*

COPY waha.config.json /tmp/waha.config.json
WORKDIR /go/gows
RUN \
    GOWS_GITHUB_REPO=$(jq -r '.waha.gows.repo' /tmp/waha.config.json) && \
    GOWS_SHA=$(jq -r '.waha.gows.ref' /tmp/waha.config.json) && \
    mkdir -p /go/gows/bin && \
    wget -O /go/gows/bin/gows https://github.com/${GOWS_GITHUB_REPO}/releases/download/${GOWS_SHA}/gows-${TARGETARCH} && \
    chmod +x /go/gows/bin/gows


#
# Final
#
FROM node:${NODE_IMAGE_TAG} AS release
ENV PUPPETEER_SKIP_DOWNLOAD=True
# Quick fix for memory potential memory leaks
# https://github.com/devlikeapro/waha/issues/347
ENV NODE_OPTIONS="--max-old-space-size=16384"
ENV WHATSAPP_DEFAULT_ENGINE=GOWS
ARG OPUSTAGS_VERSION="1.10.1"

# Media processing, session archives, TLS, and process supervision.
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        ffmpeg libvips zip unzip curl ca-certificates libc6 tini && \
    rm -rf /var/lib/apt/lists/*

# Build and install opustags so audio metadata can be cleaned up inside the container
RUN set -eux; \
    buildDeps='build-essential cmake pkg-config libogg-dev'; \
    apt-get update; \
    apt-get install -y --no-install-recommends ${buildDeps}; \
    mkdir -p /tmp/opustags; \
    curl -L https://github.com/fmang/opustags/archive/refs/tags/${OPUSTAGS_VERSION}.tar.gz \
      | tar -xz -C /tmp/opustags; \
    cd /tmp/opustags/opustags-${OPUSTAGS_VERSION}; \
    cmake -S . -B build -DCMAKE_INSTALL_PREFIX=/usr/local -DCMAKE_BUILD_TYPE=Release; \
    cmake --build build --config Release; \
    cmake --install build; \
    rm -rf /tmp/opustags; \
    apt-get purge -y --auto-remove ${buildDeps}; \
    rm -rf /var/lib/apt/lists/*

# Attach sources, install packages
WORKDIR /app
COPY package.json ./
COPY --from=build /git/node_modules ./node_modules
COPY --from=build /git/dist ./dist
COPY --from=dashboard /dashboard ./dist/dashboard
COPY --from=gows /go/gows/bin/gows /app/gows
COPY .env.example ./.env.example
COPY scripts/init-waha.js ./scripts/init-waha.js
RUN chmod +x ./scripts/init-waha.js \
  && printf '%s\n' '#!/bin/sh' 'exec node /app/scripts/init-waha.js "$@"' > /usr/local/bin/init-waha \
  && chmod +x /usr/local/bin/init-waha
ENV WAHA_GOWS_PATH=/app/gows
ENV WAHA_GOWS_SOCKET=/tmp/gows.sock

COPY entrypoint.sh /entrypoint.sh

# Chokidar options to monitor file changes
ENV CHOKIDAR_USEPOLLING=1
ENV CHOKIDAR_INTERVAL=5000

# WAHA variables
ENV WAHA_ZIPPER=ZIPUNZIP

# GOWS - use libc DNS resolver
ENV GODEBUG=netdns=cgo

# Run command, etc
EXPOSE 3000
# Use tini as init system to handle zombie processes properly
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["/entrypoint.sh"]

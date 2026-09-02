# syntax=docker/dockerfile:1.7

FROM node:22-alpine AS toolchain

ENV PNPM_HOME=/pnpm
ENV PATH=${PNPM_HOME}:${PATH}

RUN corepack enable && corepack prepare pnpm@11.10.0 --activate

WORKDIR /app

FROM toolchain AS dependencies

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    PNPM_NETWORK_CONCURRENCY=4 pnpm install --fetch-retries=5 --frozen-lockfile

FROM dependencies AS build

COPY . .
RUN pnpm build

# Source maps stay in CI artifacts when explicitly requested, but neither the
# maps nor stale sourceMappingURL trailers enter the production container.
RUN find dist server-dist -type f -name '*.map' -delete \
    && find dist server-dist -type f -name '*.js' \
        -exec sed -i '/sourceMappingURL=.*\.map/d' {} +

FROM build AS production-dependencies

ENV NODE_ENV=production

# Reuse the completed build dependency tree instead of starting a second large
# registry install in parallel. This makes small VPS builds much less fragile.
RUN pnpm prune --prod

FROM node:22-alpine AS runtime

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8787 \
    CLIENT_DIST_DIR=/app/dist

RUN addgroup -S app && adduser -S -G app app

WORKDIR /app

COPY --from=production-dependencies --chown=app:app /app/node_modules ./node_modules
COPY --from=build --chown=app:app /app/dist ./dist
COPY --from=build --chown=app:app /app/server-dist ./server-dist
COPY --chown=app:app package.json ./package.json

USER app

EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:8787/healthz').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"]

CMD ["node", "server-dist/index.js"]

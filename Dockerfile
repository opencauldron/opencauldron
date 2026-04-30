# syntax=docker/dockerfile:1.7
# OpenCauldron self-host runtime image.
# Multi-stage: deps -> builder -> runner. Final image is alpine + Node 20 +
# Next.js standalone bundle + drizzle migrations + entrypoint orchestrator.

# ---------------------------------------------------------------------------
# deps — install pnpm + node_modules (used only by the builder stage).
# ---------------------------------------------------------------------------
FROM node:20-alpine AS deps
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.5.2 --activate
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# ---------------------------------------------------------------------------
# builder — full source build, emits .next/standalone.
# ---------------------------------------------------------------------------
FROM node:20-alpine AS builder
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.5.2 --activate
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Page-data collection in `next build` evaluates server modules eagerly. The
# existing src/lib/db/index.ts asserts DATABASE_URL is set (`process.env.DATABASE_URL!`)
# so the build needs a dummy URL just to pass the module-eval gate. No actual
# connection is opened during build — `Pool` is lazy. Real value comes from
# the runtime env_file at container start.
ENV DATABASE_URL="postgres://build:build@localhost:5432/build" \
    NEXTAUTH_SECRET="build-only-placeholder" \
    GOOGLE_CLIENT_ID="build-only-placeholder" \
    GOOGLE_CLIENT_SECRET="build-only-placeholder"
RUN pnpm run build

# ---------------------------------------------------------------------------
# runner — final image. Slim alpine + node + standalone bundle + entrypoint.
# Runs as the built-in `node` user (UID 1000).
# ---------------------------------------------------------------------------
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# busybox provides wget for the Dockerfile HEALTHCHECK; alpine has it natively.
# No extra apk install needed.

# Standalone Next bundle: server.js + traced node_modules + .next/server/*.
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
COPY --from=builder --chown=node:node /app/public ./public

# Migration assets — Drizzle SQL folder + the .mjs runners. These live OUTSIDE
# the Next bundle because they're invoked by the entrypoint, not the server.
COPY --from=builder --chown=node:node /app/drizzle ./drizzle
COPY --from=builder --chown=node:node /app/scripts/migrate-runtime.mjs ./scripts/migrate-runtime.mjs
COPY --from=builder --chown=node:node /app/scripts/bootstrap-runtime.mjs ./scripts/bootstrap-runtime.mjs

# Runtime deps of the .mjs migration/bootstrap runners.
#   - `pg` is traced into the standalone bundle via src/lib/db/index.ts, so it
#     is already at /app/node_modules/pg.
#   - `drizzle-orm` is dynamic-required from src/lib/db/index.ts and the Next
#     tracer drops it from the standalone copy. Copy it explicitly from the
#     deps stage so `import "drizzle-orm/node-postgres/migrator"` resolves.
COPY --from=deps --chown=node:node /app/node_modules/drizzle-orm ./node_modules/drizzle-orm

# Entrypoint script (POSIX sh).
COPY --chown=node:node docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh

# Writable runtime dirs:
#   /app/.state   — persisted NEXTAUTH_SECRET (mounted as named volume).
#   /app/uploads  — local-storage uploads (mounted as named volume).
RUN mkdir -p /app/.state /app/uploads \
    && chown -R node:node /app/.state /app/uploads

USER node

EXPOSE 3000

# Healthcheck polls /api/health (DB-backed). Generous start period to cover
# cold migrations on a fresh install.
HEALTHCHECK --interval=10s --timeout=5s --start-period=60s --retries=5 \
  CMD wget -qO- http://127.0.0.1:3000/api/health >/dev/null 2>&1 || exit 1

ENTRYPOINT ["./docker-entrypoint.sh"]

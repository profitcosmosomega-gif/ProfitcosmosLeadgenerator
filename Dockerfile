# syntax=docker/dockerfile:1

# ---- base -------------------------------------------------------------------
FROM node:22-alpine AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH NEXT_TELEMETRY_DISABLED=1
RUN corepack enable
WORKDIR /app

# ---- all dependencies (build) -----------------------------------------------
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

# ---- production dependencies only -------------------------------------------
FROM base AS prod-deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --prod

# ---- build the Next.js app --------------------------------------------------
FROM deps AS build
COPY . .
RUN pnpm build

# ---- web: Next.js standalone server -----------------------------------------
FROM node:22-alpine AS web
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
WORKDIR /app
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD wget -qO- http://127.0.0.1:3000/api/health >/dev/null || exit 1
CMD ["node", "server.js"]

# ---- worker: background jobs; also runs migrations and seed -----------------
FROM node:22-alpine AS worker
ENV NODE_ENV=production SERVICE_NAME=worker
WORKDIR /app
COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node package.json tsconfig.json ./
COPY --chown=node:node src ./src
COPY --chown=node:node config ./config
COPY --chown=node:node scripts ./scripts
USER node
# Migrations: docker run <image> node --import tsx scripts/migrate.ts
CMD ["node", "--import", "tsx", "src/worker/index.ts"]

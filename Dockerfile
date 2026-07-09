# ---- build stage: install deps (compiles better-sqlite3) and build TS ----
FROM node:22-bookworm AS builder
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Drop dev dependencies but keep the compiled native binding (better-sqlite3).
RUN npm prune --omit=dev

# ---- run stage: slim runtime with just node_modules + dist ----
FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
# SQLite database lives on a mounted volume so data survives restarts/redeploys.
ENV DB_PATH=/data/store.db
ENV TZ=Asia/Kolkata

COPY package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist

# Persistent data (the SQLite DB). Mount a volume here in compose / on the VPS.
VOLUME ["/data"]

# Long-polling bot: no inbound port needed. The catalogue auto-seeds on first boot.
CMD ["node", "dist/index.js"]

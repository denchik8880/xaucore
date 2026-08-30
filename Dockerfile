# XAUCORE — DEMO / SYNTHETIC XAUUSD trading simulator
# Zero npm dependencies: uses node:http + node:sqlite (Node >= 22.5).
FROM node:24-alpine

WORKDIR /app

# app files (no `npm install` needed — no dependencies)
COPY package.json ./
COPY server.js ./
COPY public ./public

ENV NODE_ENV=production
ENV PORT=8777
# SQLite database lives on a mounted volume so state survives restarts / redeploys
ENV DB_PATH=/data/xaucore.db
VOLUME ["/data"]

EXPOSE 8777

# tiny healthcheck against /api/health
HEALTHCHECK --interval=30s --timeout=4s --start-period=5s --retries=3 \
  CMD wget -q -O- http://127.0.0.1:8777/api/health || exit 1

CMD ["node", "server.js"]

# Nova Launcher API — деплой на blitz.cloud (Dockerfile в корне репозитория).
# blitz.cloud даёт PORT=8080; данные (SQLite + загрузки) — в /data.
FROM node:22-slim AS deps
WORKDIR /app
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev

FROM node:22-slim
ENV NODE_ENV=production PORT=8080 DATA_DIR=/data
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY server/package.json ./
COPY server/src ./src
# uid 1000 = "node" в образе = тот же uid, под которым blitz.cloud запускает приложения
RUN mkdir -p /data && chown -R node:node /data
USER node
EXPOSE 8080
# Запуск напрямую через node: npm не пробрасывает SIGTERM надёжно
CMD ["node", "src/index.js"]

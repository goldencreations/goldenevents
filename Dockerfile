FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:24-bookworm-slim
ENV NODE_ENV=production PORT=3001 DATA_DIR=/app/data SEED_DEMO=false PAYMENT_DRIVER=disabled
WORKDIR /app
COPY --from=build --chown=node:node /app/package.json /app/package-lock.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/server ./server
COPY --from=build --chown=node:node /app/scripts ./scripts
RUN mkdir -p /app/data && chown node:node /app/data
USER node
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s CMD node scripts/healthcheck.js
CMD ["node", "server/index.js"]

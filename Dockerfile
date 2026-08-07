# syntax=docker/dockerfile:1

FROM node:24-bookworm-slim AS client-build
WORKDIR /app

# Install the frontend independently so npm uses client/package-lock.json.
# That lockfile contains the Linux-native optional packages required by
# Rollup, esbuild, and Tailwind instead of reusing a Windows installation.
COPY client/package.json client/package-lock.json ./client/
RUN npm ci --prefix client --include=optional

COPY client ./client
RUN npm --prefix client run build


FROM node:24-bookworm-slim AS server-dependencies
WORKDIR /app

COPY package.json package-lock.json ./
COPY server/package.json ./server/package.json
COPY client/package.json ./client/package.json
RUN npm ci --omit=dev --ignore-scripts --workspace server


FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production \
    PORT=3000 \
    DATABASE_PATH=/data/quotebook.db \
    SHARE_SECRET_FILE=/data/.share-secret
WORKDIR /app

COPY --from=server-dependencies --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node package.json ./package.json
COPY --chown=node:node server ./server
COPY --from=client-build --chown=node:node /app/client/dist ./client/dist

RUN mkdir -p /data && chown node:node /data

USER node
EXPOSE 3000
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "server/src/index.js"]

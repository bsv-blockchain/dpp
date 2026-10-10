# One image: the API serving the built web app. The wallet's SQLite driver is
# a native module; it ships prebuilt binaries for common platforms, and the
# build stage carries the tools to compile it where it does not.
FROM node:22-bookworm-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json* ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
# npm ci with the committed lockfile; a fresh scaffold without one installs instead.
RUN if [ -f package-lock.json ]; then npm ci --no-audit --no-fund; else npm install --no-audit --no-fund; fi
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./
COPY --from=build /app/apps/api/package.json ./apps/api/
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/web/dist ./apps/web/dist
# The wallet file and anything else the application keeps on disk.
RUN mkdir -p /app/local && chown -R node:node /app
USER node
VOLUME ["/app/local"]
EXPOSE 3000
CMD ["node", "apps/api/dist/main.js"]

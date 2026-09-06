# The DPP overlay node. One artefact, any host: nothing here is specific to
# any platform, so the same image hands to any container host unchanged.
#
# Build context is the REPOSITORY ROOT, not this directory, because the
# service depends on the @bsv/dpp-core workspace:
#
#   docker build -f packages/overlay-topics/Dockerfile -t dpp-overlay .
#
# Configuration is environment only; the Configuration table in this
# directory's README.md lists the variables and the root .dockerignore keeps
# .env files out of the context.

FROM node:22-slim AS build
WORKDIR /repo

# Manifests first, so a dependency change is the only thing that busts the
# install layer. npm ci needs every workspace manifest the lockfile knows.
COPY package.json package-lock.json ./
COPY packages/dpp-core/package.json packages/dpp-core/
COPY packages/overlay-topics/package.json packages/overlay-topics/
COPY packages/vsc/package.json packages/vsc/
COPY packages/dpp-profiles/package.json packages/dpp-profiles/
RUN npm ci --ignore-scripts \
      -w @bsv/dpp-overlay-topics -w @bsv/dpp-core --include-workspace-root

COPY tsconfig.base.json ./
COPY packages ./packages
RUN npm run build -w @bsv/dpp-core -w @bsv/dpp-overlay-topics

FROM node:22-slim
WORKDIR /repo
ENV NODE_ENV=production

COPY package.json package-lock.json ./
COPY packages/dpp-core/package.json packages/dpp-core/
COPY packages/overlay-topics/package.json packages/overlay-topics/
COPY packages/vsc/package.json packages/vsc/
COPY packages/dpp-profiles/package.json packages/dpp-profiles/
RUN npm ci --omit=dev --ignore-scripts \
      -w @bsv/dpp-overlay-topics -w @bsv/dpp-core --include-workspace-root \
    && npm cache clean --force

COPY --from=build /repo/packages/dpp-core/dist packages/dpp-core/dist
COPY --from=build /repo/packages/overlay-topics/dist packages/overlay-topics/dist

# Informational: the service binds PORT when the platform injects one.
EXPOSE 8080

# node directly, not npm: npm as PID 1 does not forward SIGTERM, so the
# graceful shutdown in src/index.ts would never run and every stop would be a
# hard kill mid-write.
CMD ["node", "packages/overlay-topics/dist/index.js"]

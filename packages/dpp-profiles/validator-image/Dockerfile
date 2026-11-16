# The DPP validator service: the validation engine of @bsv/dpp-profiles behind
# the dpp-validator/1 contract (contracts/validator.schema.json). It answers
# two operations, JSON-LD expansion and SHACL validation with SPARQL
# constraints, over the files each request carries.
#
# Build context is the REPOSITORY ROOT, as for the index image:
#
#   docker build -f packages/dpp-profiles/validator-image/Dockerfile -t dpp-validator .
#   docker run --rm -p 127.0.0.1:8090:8090 dpp-validator
#
# What is in the image, and what is not:
#
#   - the engine libraries, installed from this folder's own package.json and
#     package-lock.json. The lockfile is the engine libraries' part of the
#     repository's lockfile (lock.mjs), so the image runs the versions the
#     tests ran. No workspace is installed, so nothing the index or an
#     application needs is here, and nothing here is in the index image;
#   - seven files of the built profiles package: the command, the service,
#     the wire contract's reader, the engine adapter and its thread;
#   - LICENSE, NOTICE and PATENTS, licence-inventory.json and
#     THIRD-PARTY-NOTICES.txt, which the build writes from what it installed
#     and holds to the inventory;
#   - no profile, no binding, no context and no shapes. Every rule file
#     arrives in a request. No file published by GS1 or by a profile's
#     publisher is copied here.
#
# Configuration is environment only: the settings are listed at the top of
# src/validator-command.ts and in docs/packages/dpp-profiles.md. The image
# runs as the unprivileged node user, needs no writable file system and no
# capability, and makes no outbound connection.
#
# The build arguments SOURCE_REVISION, SOURCE_STATE, RELEASE_SET and
# PACKAGE_VERSION say which release the image belongs to and are written as
# labels, exactly as for the index image; PACKAGE_VERSION is the version of
# @bsv/dpp-profiles, held to the package manifest the image carries.

# The base image is a build argument so the same Docker Official Image can
# come from a mirror, exactly as for the index image.
ARG BASE_IMAGE=node:22.23.4-slim@sha256:5ec23b7c622b00547753bc6ffd78085dd868a68aeb41c8e0a1418f033e13d96d

FROM ${BASE_IMAGE} AS build
RUN test "$(node --version)" = "v22.23.4"
WORKDIR /repo

# Manifests first, so a dependency change is the only thing that busts the
# install layer. npm ci needs every workspace manifest the lockfile knows.
COPY package.json package-lock.json ./
COPY packages/dpp-protocol/package.json packages/dpp-protocol/
COPY packages/dpp-overlay/package.json packages/dpp-overlay/
COPY packages/dpp-credentials/package.json packages/dpp-credentials/
COPY packages/dpp-profiles/package.json packages/dpp-profiles/
COPY packages/create-dpp-app/package.json packages/create-dpp-app/
RUN npm ci --ignore-scripts -w @bsv/dpp-profiles --include-workspace-root

# The compiler alone: the service's files are plain modules of the package,
# and nothing the package generates from its manifests is needed here.
COPY tsconfig.base.json ./
COPY packages/dpp-profiles/tsconfig.json packages/dpp-profiles/
COPY packages/dpp-profiles/src packages/dpp-profiles/src
RUN npx tsc -p packages/dpp-profiles/tsconfig.json

FROM ${BASE_IMAGE}
RUN test "$(node --version)" = "v22.23.4"
WORKDIR /app
ENV NODE_ENV=production

COPY LICENSE NOTICE PATENTS ./
COPY packages/dpp-profiles/validator-image/package.json packages/dpp-profiles/validator-image/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

# What was installed is held to the inventory, and the notices are written
# from the installed packages. A difference stops the build.
COPY packages/dpp-profiles/validator-image/licence-inventory.json packages/dpp-profiles/validator-image/notices.mjs ./
RUN node notices.mjs && rm notices.mjs

# The package manifest gives the files their module type and the service the
# version it reports. The files are the command's whole import closure and
# the engine thread's, which a test holds this list to.
COPY packages/dpp-profiles/package.json packages/dpp-profiles/package.json
COPY --from=build /repo/packages/dpp-profiles/dist/strict-json.js packages/dpp-profiles/dist/
COPY --from=build /repo/packages/dpp-profiles/dist/validation-engine.js packages/dpp-profiles/dist/
COPY --from=build /repo/packages/dpp-profiles/dist/validator-cli.js packages/dpp-profiles/dist/
COPY --from=build /repo/packages/dpp-profiles/dist/validator-command.js packages/dpp-profiles/dist/
COPY --from=build /repo/packages/dpp-profiles/dist/validator-service.js packages/dpp-profiles/dist/
COPY --from=build /repo/packages/dpp-profiles/dist/validator-wire.js packages/dpp-profiles/dist/
COPY --from=build /repo/packages/dpp-profiles/dist/validator-worker.js packages/dpp-profiles/dist/

# Inside a container the service listens on every address of the container,
# which is its own network namespace. Publish the port only where callers are.
ENV VALIDATOR_HOST=0.0.0.0
ENV VALIDATOR_PORT=8090
EXPOSE 8090

# Last, so that a new revision rebuilds no layer above. The licence label
# names the licence of this repository's code in the image; the base image
# and the installed libraries keep their own terms, listed in
# licence-inventory.json and reproduced in THIRD-PARTY-NOTICES.txt.
ARG SOURCE_REVISION=unknown
ARG SOURCE_STATE=unknown
ARG RELEASE_SET=unknown
ARG PACKAGE_VERSION=unknown
RUN test "$PACKAGE_VERSION" = unknown \
    || test "$(node -p "require('./packages/dpp-profiles/package.json').version")" = "$PACKAGE_VERSION"
LABEL org.opencontainers.image.title="dpp-validator" \
      org.opencontainers.image.description="The DPP validator service: the validation engine of @bsv/dpp-profiles behind the dpp-validator/1 contract" \
      org.opencontainers.image.source="https://github.com/bsv-blockchain/dpp" \
      org.opencontainers.image.revision="${SOURCE_REVISION}" \
      org.opencontainers.image.version="${PACKAGE_VERSION}" \
      org.opencontainers.image.licenses="Apache-2.0" \
      io.github.bsv-blockchain.dpp.package="@bsv/dpp-profiles" \
      io.github.bsv-blockchain.dpp.release-set="${RELEASE_SET}" \
      io.github.bsv-blockchain.dpp.source-state="${SOURCE_STATE}" \
      io.github.bsv-blockchain.dpp.node="22.23.4" \
      io.github.bsv-blockchain.dpp.licence-scope="Apache-2.0 covers this repository's code (LICENSE, NOTICE and PATENTS in /app). The base image and every installed library keep their own terms: licence-inventory.json and THIRD-PARTY-NOTICES.txt in /app."

USER node

HEALTHCHECK --interval=10s --timeout=5s --start-period=10s --retries=6 \
  CMD ["node", "packages/dpp-profiles/dist/validator-cli.js", "health"]

# node directly, not npm: npm as PID 1 does not forward SIGTERM, so the
# service would never close its listener and every stop would be a hard kill.
CMD ["node", "packages/dpp-profiles/dist/validator-cli.js"]

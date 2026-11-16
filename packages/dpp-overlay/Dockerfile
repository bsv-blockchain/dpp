# The DPP overlay node. One artefact, any host: nothing here is specific to
# any platform, so the same image hands to any container host unchanged.
#
# Build context is the REPOSITORY ROOT, not this directory, because the
# service depends on the @bsv/dpp-protocol and @bsv/dpp-profiles workspaces:
#
#   docker build -f packages/dpp-overlay/Dockerfile -t dpp-overlay .
#
# Configuration is environment only; the Configuration table in this
# directory's README.md lists the variables and the root .dockerignore keeps
# .env files out of the context.
#
# The image is one delivery of @bsv/dpp-overlay and the npm package is the
# other: the same built files, started by the same code. Four build arguments
# say which release an image belongs to, and the build writes them as labels
# (scripts/release-images.mjs build passes them, and its inspect command
# reads them back and holds them to the files inside the image):
#
#   SOURCE_REVISION   the commit the image was built from
#   SOURCE_STATE      committed, or working-tree for a checkout with changes
#   RELEASE_SET       the release set the revision belongs to
#   PACKAGE_VERSION   the version of @bsv/dpp-overlay, which the build holds
#                     to the package manifest it copied
#
# A build that names none of them still works and is labelled unknown, which
# no release accepts.

# The base image is a build argument so the same Docker Official Image can
# come from a mirror: the repository workflows take it from the first of
# Google's Docker Hub mirror (mirror.gcr.io), Amazon ECR Public or Docker Hub
# that serves it. All three serve the same manifest digests, so one
# registry's pull limit or outage cannot block a release gate. The default
# below names the image by digest as well as by tag, so a build without the
# argument starts from exactly the layers the release set records.
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
RUN npm ci --ignore-scripts \
      -w @bsv/dpp-overlay -w @bsv/dpp-protocol -w @bsv/dpp-profiles --include-workspace-root

COPY tsconfig.base.json ./
COPY scripts/package-schemas.mjs ./scripts/package-schemas.mjs
COPY contracts ./contracts
COPY packages ./packages
RUN npm run build -w @bsv/dpp-protocol -w @bsv/dpp-profiles -w @bsv/dpp-overlay

FROM ${BASE_IMAGE}
RUN test "$(node --version)" = "v22.23.4"
WORKDIR /repo
ENV NODE_ENV=production

# The attribution notice and the patent statement travel with the licence,
# so the image carries the same three files the packages do.
COPY LICENSE NOTICE PATENTS ./
COPY package.json package-lock.json ./
COPY packages/dpp-protocol/package.json packages/dpp-protocol/
COPY packages/dpp-overlay/package.json packages/dpp-overlay/
COPY packages/dpp-credentials/package.json packages/dpp-credentials/
COPY packages/dpp-profiles/package.json packages/dpp-profiles/
COPY packages/create-dpp-app/package.json packages/create-dpp-app/
RUN npm ci --omit=dev --ignore-scripts \
      -w @bsv/dpp-overlay -w @bsv/dpp-protocol -w @bsv/dpp-profiles --include-workspace-root \
    && npm cache clean --force

COPY --from=build /repo/packages/dpp-protocol/dist packages/dpp-protocol/dist
COPY --from=build /repo/packages/dpp-protocol/schemas packages/dpp-protocol/schemas
COPY --from=build /repo/packages/dpp-overlay/dist packages/dpp-overlay/dist
# The GS1 key lookup reads the profiles package, whose entry point loads its
# manifests and generated schemas at import.
COPY --from=build /repo/packages/dpp-profiles/dist packages/dpp-profiles/dist
COPY --from=build /repo/packages/dpp-profiles/manifests packages/dpp-profiles/manifests
COPY --from=build /repo/packages/dpp-profiles/schemas packages/dpp-profiles/schemas
COPY --from=build /repo/packages/dpp-profiles/generated packages/dpp-profiles/generated
COPY --from=build /repo/packages/dpp-profiles/frozen.json packages/dpp-profiles/frozen.json

# Informational: the service binds PORT when the platform injects one.
EXPOSE 8080

# Last, so that a new revision rebuilds no layer above. The licence label
# names the licence of this repository's code in the image; the base image
# and the installed dependencies keep their own terms, and the scope label
# says so.
ARG SOURCE_REVISION=unknown
ARG SOURCE_STATE=unknown
ARG RELEASE_SET=unknown
ARG PACKAGE_VERSION=unknown
RUN test "$PACKAGE_VERSION" = unknown \
    || test "$(node -p "require('./packages/dpp-overlay/package.json').version")" = "$PACKAGE_VERSION"
LABEL org.opencontainers.image.title="dpp-overlay" \
      org.opencontainers.image.description="The DPP reference index: @bsv/dpp-overlay started by its own entry point" \
      org.opencontainers.image.source="https://github.com/bsv-blockchain/dpp" \
      org.opencontainers.image.revision="${SOURCE_REVISION}" \
      org.opencontainers.image.version="${PACKAGE_VERSION}" \
      org.opencontainers.image.licenses="Apache-2.0" \
      io.github.bsv-blockchain.dpp.package="@bsv/dpp-overlay" \
      io.github.bsv-blockchain.dpp.release-set="${RELEASE_SET}" \
      io.github.bsv-blockchain.dpp.source-state="${SOURCE_STATE}" \
      io.github.bsv-blockchain.dpp.node="22.23.4" \
      io.github.bsv-blockchain.dpp.licence-scope="Apache-2.0 covers this repository's code (LICENSE, NOTICE and PATENTS in /repo). The base image and every installed dependency keep their own terms and notices."

# node directly, not npm: npm as PID 1 does not forward SIGTERM, so the
# graceful shutdown in src/index.ts would never run and every stop would be a
# hard kill mid-write.
CMD ["node", "packages/dpp-overlay/dist/index.js"]

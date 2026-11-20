# Builds either backend: PACKAGE=vendor-api or PACKAGE=quote-service.
# Build context is the repo root (npm workspaces share one lockfile).

# --- build: install the workspace, bundle the backend with esbuild ---
FROM node:22-alpine AS build
WORKDIR /app

# Manifests first, so the npm ci layer is cached until dependencies change.
COPY package.json package-lock.json ./
COPY packages/contract/package.json packages/contract/
COPY packages/vendor-api/package.json packages/vendor-api/
COPY packages/quote-service/package.json packages/quote-service/
COPY packages/web/package.json packages/web/
RUN npm ci

COPY tsconfig.base.json ./
COPY packages ./packages
ARG PACKAGE
RUN npm run build -w packages/${PACKAGE}

# --- runtime: just Node and the self-contained bundle ---
FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
ARG PACKAGE
COPY --from=build /app/packages/${PACKAGE}/dist/ ./
# Somewhere the unprivileged user can write: vendor-api keeps its
# idempotency file here, on a Compose volume (unused by quote-service).
RUN mkdir data && chown node:node data
# The image's built-in unprivileged user.
USER node
CMD ["node", "--enable-source-maps", "server.cjs"]

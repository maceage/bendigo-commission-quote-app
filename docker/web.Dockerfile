# The front end: built with Vite, served by nginx, which also proxies
# /api to quote-service (the production stand-in for Vite's dev proxy).
# Build context is the repo root (npm workspaces share one lockfile).

# --- build: type-check and bundle the React app ---
FROM node:22-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/contract/package.json packages/contract/
COPY packages/vendor-api/package.json packages/vendor-api/
COPY packages/quote-service/package.json packages/quote-service/
COPY packages/web/package.json packages/web/
RUN npm ci

# vite.config.ts (type-checked by the build) imports the shared Vitest settings.
COPY tsconfig.base.json vitest.shared.ts ./
COPY packages ./packages
RUN npm run build -w packages/web

# --- runtime: static files + reverse proxy ---
FROM nginx:1.28-alpine
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/packages/web/dist /usr/share/nginx/html

# syntax=docker/dockerfile:1

# Build the Vite application and download the browser-side compiler assets.
FROM node:24.13.1-bookworm-slim AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
# Regenerate configuration from texlyre.config.ts, then create the optimised
# Vite bundle. build:prod also runs repository-wide auto-fixing lint checks,
# which are not required to produce the distributable and can fail on existing
# unrelated lint findings.
RUN npm run generate:configs && npm run build:local

# Serve the pre-built application. TLS is selected at runtime by the standard
# nginx entrypoint hook, allowing the same image to support HTTP and HTTPS.
FROM nginx:1.27-alpine

COPY docker/nginx/http.conf /etc/texlyre/nginx/http.conf
COPY docker/nginx/https.conf /etc/texlyre/nginx/https.conf
COPY docker/nginx/locations.conf /etc/texlyre/nginx/locations.conf
COPY docker/nginx/typesetter.conf.template /etc/texlyre/nginx/typesetter.conf.template
COPY --chmod=755 docker/entrypoint/30-select-texlyre-config.sh /docker-entrypoint.d/30-select-texlyre-config.sh
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80 443

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
	CMD wget --spider --quiet http://127.0.0.1/healthz || exit 1

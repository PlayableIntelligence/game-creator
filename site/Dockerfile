# syntax=docker/dockerfile:1.7
#
# Static-site image for the game-creator landing page + template gallery.
#
# Stage 1: build _site/ from site/manifest.json (no npm deps — build.js uses
#          only Node built-ins).
# Stage 2: serve _site/ via nginx with $PORT-aware listen so Railway can map
#          to whatever port it chooses.
#
# Build context is the repo ROOT (one level above this file). We only need
# the `site/` directory.
#
# Build:  docker build -f site/Dockerfile -t game-creator-site .
# Run:    docker run -p 8080:8080 -e PORT=8080 game-creator-site

# ---------- Stage 1: build ----------
FROM node:24-alpine AS builder

WORKDIR /build
# Only need site/ — build.js writes _site/ to one level up (per its
# `path.resolve(__dirname, '..')` convention).
COPY site ./site
RUN node site/build.js

# ---------- Stage 2: serve ----------
FROM nginx:1.27-alpine AS runtime

# Built static files
COPY --from=builder /build/_site /usr/share/nginx/html

# Render the nginx config from a template at startup so we honor Railway's
# $PORT env var (the official nginx image runs `envsubst` on every file in
# /etc/nginx/templates/ → /etc/nginx/conf.d/).
COPY site/nginx.conf.template /etc/nginx/templates/default.conf.template

ENV PORT=8080
EXPOSE 8080

# Health check piggybacks on /index.html — wget is in the base image.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --quiet --spider http://localhost:${PORT:-8080}/ || exit 1

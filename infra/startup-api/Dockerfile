# infra/startup-api/Dockerfile
# Node.js 22 slim — mirrors infra/graph-api/Dockerfile (Phase 18) for
# operational consistency across the Fly proxy fleet.
#
# This image holds the `pg` npm client used to talk to internjobs-student-db
# from the Cloudflare Workers runtime (which cannot connect to Fly's private
# Postgres directly). Production deps only; no dev tooling shipped.

FROM node:22-slim AS base
WORKDIR /app

# Install production deps only
COPY package.json package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund

COPY src ./src
EXPOSE 3000
CMD ["node", "src/index.mjs"]

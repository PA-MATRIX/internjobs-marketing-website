# infra/graph-api/Dockerfile
# Node.js 22 slim — consistent with internjobs-ai-student-app Docker pattern.
# We use Node (not Bun) per ARCHITECTURE.md: operational consistency across
# the Fly apps takes priority over Bun's smaller image size advantage.
# falkordb@6.6.2 is pinned to match apps/app/src/memory/graph.mjs — same
# client version = same wire behavior, same Cypher semantics.

FROM node:22-slim AS base
WORKDIR /app

# Install production deps only
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src ./src
EXPOSE 3000
CMD ["node", "src/index.mjs"]

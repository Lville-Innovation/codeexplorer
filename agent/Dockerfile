# syntax=docker/dockerfile:1
FROM node:22-slim AS build
WORKDIR /app
RUN apt-get update -qq && apt-get install --no-install-recommends -y ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:22-slim
WORKDIR /app
RUN apt-get update -qq && apt-get install --no-install-recommends -y ca-certificates && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
COPY assets ./assets
RUN chown -R node:node /app
USER node
# Pre-download any model files the SDK needs so the first session starts quickly.
RUN node dist/agent.js download-files
CMD ["node", "dist/agent.js", "start"]

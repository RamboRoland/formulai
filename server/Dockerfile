# The game server (build context: server/).
#   docker build -t formulai-server server
#   docker run -p 8080:8080 -e EDITOR_PASSWORD=… formulai-server
# Settings come from the environment (see .env.example). Tracks and saved
# sessions live inside the container for now (lost when it is removed).

FROM node:24-alpine AS build
WORKDIR /srv
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
COPY scripts ./scripts
RUN npm run build

# Laid out like the source tree (src/, sessions/, tracks/ side by side), so
# config.ts finds the folders next to it as in development.
FROM node:24-alpine
ENV NODE_ENV=production
WORKDIR /srv
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /srv/dist/src ./src
COPY --chown=node:node sessions ./sessions
COPY --chown=node:node tracks ./tracks
RUN mkdir -p sessions/saved tracks/drafts && chown node:node sessions/saved tracks/drafts
USER node
EXPOSE 8080
CMD ["node", "src/index.js"]

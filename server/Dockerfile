# The game server (build context: server/).
#   docker build -t formulai-server server
#   docker run -p 8080:8080 -e S3_ENDPOINT=… -e EDITOR_PASSWORD=… formulai-server
#   docker run -e S3_ENDPOINT=… formulai-server node scripts/seed.js
# Settings come from the environment (see .env.example). The data lives in
# S3; the image carries the repo's tracks, sessions and backgrounds only
# as seed data.

FROM node:24-alpine AS build
WORKDIR /srv
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
COPY scripts ./scripts
RUN npm run build

# Laid out like the source tree (src/, scripts/, sessions/, tracks/,
# backgrounds/ side by side), so the seed script finds its files as in development.
FROM node:24-alpine
ENV NODE_ENV=production
WORKDIR /srv
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /srv/dist/src ./src
COPY --from=build /srv/dist/scripts ./scripts
COPY sessions ./sessions
COPY tracks ./tracks
COPY backgrounds ./backgrounds
USER node
EXPOSE 8080
CMD ["node", "src/index.js"]

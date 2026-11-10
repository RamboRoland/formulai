# The game server (build context: server/).
#   docker build -t formulai-server server
#   docker run -p 8080:8080 -e S3_ENDPOINT=… -e EDITOR_PASSWORD=… formulai-server
# Settings come from the environment (see .env.example). The data lives in
# S3 only (the DigitalOcean Space; locally `npm run fetch`) — no tracks,
# sessions or backgrounds in the image.

FROM node:24-alpine AS build
WORKDIR /srv
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
COPY scripts ./scripts
RUN npm run build

FROM node:24-alpine
ENV NODE_ENV=production
WORKDIR /srv
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /srv/dist/src ./src
COPY --from=build /srv/dist/scripts ./scripts
USER node
EXPOSE 8080
CMD ["node", "src/index.js"]

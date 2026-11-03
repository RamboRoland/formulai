# The App (build context: app/).
#   docker build -t formulai-app --build-arg VITE_WS_URL=wss://game.example.com app
#   docker run -p 3000:3000 formulai-app
# VITE_WS_URL (the game server's PUBLIC address) and VITE_API_URL are baked
# in at build time (see .env.example) — a new address needs a new image.

FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ARG VITE_WS_URL
ARG VITE_API_URL
RUN npm run build

FROM node:24-alpine
ENV NODE_ENV=production
ENV PORT=3000
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/build ./build
USER node
EXPOSE 3000
CMD ["npm", "start"]

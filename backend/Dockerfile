FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json ./
COPY server.js createApp.js ./
COPY config ./config
COPY controllers ./controllers
COPY db ./db
COPY middleware ./middleware
COPY queues ./queues
COPY routes ./routes
COPY services ./services
COPY utils ./utils
COPY workers ./workers
COPY assets ./assets
EXPOSE 3000
CMD ["node", "server.js"]

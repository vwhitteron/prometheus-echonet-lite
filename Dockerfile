FROM node:20-slim AS builder

WORKDIR /usr/src/app

COPY package*.json tsconfig.json config.json ./
RUN npm ci
COPY src/ ./src/
RUN npm run build

FROM node:20-slim

WORKDIR /usr/src/app

COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=builder /usr/src/app/dist ./dist
COPY config.json ./

CMD [ "node", "dist/index.js" ]
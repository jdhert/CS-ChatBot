# Backend Dockerfile (Fastify)
FROM node:20-alpine AS base

# Install dependencies only when needed
FROM base AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app

# Copy package files
COPY package*.json ./
RUN npm ci --only=production

# Build stage
FROM base AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .

# Type check and build
RUN npm run typecheck
RUN npm run build

# Production stage
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3101

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 fastify

# Copy built application
COPY --from=builder --chown=fastify:nodejs /app/dist ./dist
COPY --from=builder --chown=fastify:nodejs /app/package*.json ./
COPY --from=deps --chown=fastify:nodejs /app/node_modules ./node_modules

USER fastify

EXPOSE 3101

CMD ["node", "dist/app/server.js"]

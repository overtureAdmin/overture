# ---------- deps ----------
FROM node:24-alpine AS deps
WORKDIR /app

# Install dependencies based on lockfile
COPY package*.json ./
RUN npm ci

# ---------- build ----------
FROM node:24-alpine AS build
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# ---------- run ----------
FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

# Create non-root user
RUN addgroup -S nextjs && adduser -S nextjs -G nextjs

# Copy the minimal output
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/next.config.* ./
COPY --from=build /app/public ./public
COPY --from=build /app/.next ./.next
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/db ./db
COPY --from=build /app/node_modules ./node_modules

USER nextjs
EXPOSE 3000

CMD ["npm", "run", "start", "--", "-p", "3000"]

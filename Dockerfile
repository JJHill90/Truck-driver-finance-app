# Haulage finance app — production image (works on any container host).
FROM node:22-slim

WORKDIR /app

# Install production dependencies first for better layer caching.
COPY package*.json ./
RUN npm ci --omit=dev || npm install --omit=dev

# App source.
COPY . .

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

# Runtime data (JSON store, receipts, user accounts) lives here. Mount a
# persistent volume at /app/data to keep data across restarts/redeploys.
VOLUME ["/app/data"]

CMD ["node", "server.js"]

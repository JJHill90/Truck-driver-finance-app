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
# Dedicated Go Taxation Suite host: APP_PRODUCT=suite (see render.yaml).
# Do not set DATA_DIR here — a baked /app/data would hide the Render disk at
# /opt/render/project/src/data. render.yaml sets DATA_DIR on the service.
EXPOSE 3000

# Runtime data (JSON store, receipts, user accounts) lives here. Mount a
# persistent volume at /app/data, or set DATA_DIR to the host mount path.
VOLUME ["/app/data"]

CMD ["node", "server.js"]

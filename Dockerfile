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

# Do not declare VOLUME /app/data. On the Suite image that instruction creates
# a second mount next to the Render disk. lib/storage.js writes photos there,
# Render's disk graph stays empty, and the volume is thrown away on every deploy.
# Local docker run still persists with -v gotax-data:/app/data. On Render the
# disk is DATA_DIR (/opt/render/project/src/data), same path Driver Hub uses.

CMD ["node", "server.js"]

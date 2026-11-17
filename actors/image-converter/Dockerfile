# Build context is this actor directory (apify push uploads only this folder).
# Debian, not apify/actor-node (Alpine): Debian's libheif decodes HEIC.
# sharp (prebuilt libvips) does all other image work, Node runs the actor.
FROM node:22-bookworm-slim AS builder
WORKDIR /usr/src/app
COPY package*.json ./
RUN npm install --include=dev --audit=false --fund=false
COPY . ./
RUN npm run build

FROM node:22-bookworm-slim
# heif-convert (libheif with libde265) decodes HEIC/HEIF photos to PNG in a
# separate process: sharp's prebuilt libvips has no HEVC decoder.
RUN apt-get update \
    && apt-get install -y --no-install-recommends libheif-examples \
    && rm -rf /var/lib/apt/lists/* \
    && command -v heif-convert
WORKDIR /usr/src/app
COPY package*.json ./
# No --omit=optional: sharp's prebuilt binaries are optional dependencies.
RUN npm install --omit=dev --audit=false --fund=false \
    && echo "Installed NPM packages:" \
    && (npm list --omit=dev --all || true) \
    && echo "Node.js version:" && node --version \
    && node -e "const s=require('sharp'); console.log('libvips', s.versions.vips)" \
    && rm -r ~/.npm
COPY --from=builder /usr/src/app/dist ./dist
COPY . ./
USER node
CMD ["npm", "run", "start", "--silent"]

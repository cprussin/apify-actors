# Build context is this actor directory (apify push uploads only this folder).
# Debian, not apify/actor-node (Alpine): markitdown needs onnxruntime (via
# magika), which has no musl wheels. Python + markitdown convert documents,
# Tesseract OCRs scanned PDF pages, Node runs the actor (src/).
FROM node:22-bookworm-slim AS builder
WORKDIR /usr/src/app
COPY package*.json ./
RUN npm install --include=dev --audit=false --fund=false
COPY . ./
RUN npm run build

FROM node:22-bookworm-slim
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
       python3 python3-venv ca-certificates tesseract-ocr \
       tesseract-ocr-eng tesseract-ocr-deu tesseract-ocr-fra tesseract-ocr-spa \
       tesseract-ocr-ita tesseract-ocr-por tesseract-ocr-nld \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /usr/src/app
COPY requirements.txt ./
RUN python3 -m venv /opt/venv \
    && /opt/venv/bin/pip install --no-cache-dir -r requirements.txt \
    && /opt/venv/bin/python -c "import markitdown, magika; magika.Magika()" \
    && tesseract --version
ENV DOC2MD_PYTHON=/opt/venv/bin/python
COPY package*.json ./
RUN npm install --omit=dev --omit=optional --audit=false --fund=false \
    && echo "Installed NPM packages:" \
    && (npm list --omit=dev --all || true) \
    && echo "Node.js version:" && node --version \
    && rm -r ~/.npm
COPY --from=builder /usr/src/app/dist ./dist
COPY . ./
USER node
CMD ["npm", "run", "start", "--silent"]

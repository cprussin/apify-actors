# Build context is this actor directory (apify push uploads only this folder).
# Debian, not apify/actor-node (Alpine): ONNX Runtime has no musl wheels.
# Python + ONNX Runtime upscale (Real-ESRGAN), Pillow decodes and encodes
# images, Node runs the actor (src/).
FROM node:22-bookworm-slim AS builder
WORKDIR /usr/src/app
COPY package*.json ./
RUN npm install --include=dev --audit=false --fund=false
COPY . ./
RUN npm run build

# Convert the Real-ESRGAN weights (SHA-256 pinned in export_model.py) to
# ONNX. PyTorch is only needed for this and stays out of the final image.
FROM node:22-bookworm-slim AS model
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 python3-venv ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY requirements-export.txt python/export_model.py /tmp/
RUN python3 -m venv /opt/export \
    && /opt/export/bin/pip install --no-cache-dir -r /tmp/requirements-export.txt \
    && mkdir -p /opt/models \
    && /opt/export/bin/python /tmp/export_model.py /opt/models/realesr-general-x4v3.onnx

FROM node:22-bookworm-slim
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 python3-venv ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /usr/src/app
COPY requirements.txt ./
RUN python3 -m venv /opt/venv \
    && /opt/venv/bin/pip install --no-cache-dir -r requirements.txt
# The model weights are baked into the image so runs never download them.
COPY --from=model /opt/models /opt/models
RUN /opt/venv/bin/python -c "import onnxruntime as o; o.InferenceSession('/opt/models/realesr-general-x4v3.onnx', providers=['CPUExecutionProvider'])"
ENV UPSCALER_PYTHON=/opt/venv/bin/python \
    UPSCALER_MODEL=/opt/models/realesr-general-x4v3.onnx
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

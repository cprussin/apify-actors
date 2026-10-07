# Build context is this actor directory (apify push uploads only this folder).
# Debian, not apify/actor-node (Alpine): CTranslate2 and ONNX Runtime have no
# musl wheels. FFmpeg decodes the media, Python + faster-whisper transcribes,
# Node runs the actor (src/).
FROM node:22-bookworm-slim AS builder
WORKDIR /usr/src/app
COPY package*.json ./
RUN npm install --include=dev --audit=false --fund=false
COPY . ./
RUN npm run build

# A minimal LGPL FFmpeg from the official source release: native demuxers and
# decoders only (no --enable-gpl, no external codec libraries). Debian's
# ffmpeg package and PyAV's wheels are GPL builds.
FROM debian:bookworm-slim AS ffmpeg
ARG FFMPEG_VERSION=7.1.2
ARG FFMPEG_SHA256=089bc60fb59d6aecc5d994ff530fd0dcb3ee39aa55867849a2bbc4e555f9c304
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
       build-essential nasm curl ca-certificates xz-utils \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /src
RUN curl -fsSL -o ffmpeg.tar.xz "https://ffmpeg.org/releases/ffmpeg-${FFMPEG_VERSION}.tar.xz" \
    && echo "${FFMPEG_SHA256}  ffmpeg.tar.xz" | sha256sum -c - \
    && tar -xJf ffmpeg.tar.xz --strip-components=1 \
    && ./configure --prefix=/opt/ffmpeg \
       --disable-debug --disable-doc --disable-ffplay --disable-network \
       --disable-autodetect --disable-everything --disable-avdevice --disable-swscale \
       --enable-protocol=file,pipe --enable-demuxers --enable-parsers \
       --enable-decoders --enable-encoder=pcm_s16le --enable-muxer=pcm_s16le,wav \
       --enable-filter=aresample,aformat,anull,atrim,abuffer,abuffersink \
       --enable-swresample \
    && make -j"$(nproc)" \
    && make install \
    && /opt/ffmpeg/bin/ffmpeg -hide_banner -L | grep -q "Lesser General Public" \
    && cp COPYING.LGPLv2.1 /opt/ffmpeg/

FROM node:22-bookworm-slim
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 python3-venv ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY --from=ffmpeg /opt/ffmpeg/bin/ffmpeg /opt/ffmpeg/bin/ffprobe /usr/local/bin/
COPY --from=ffmpeg /opt/ffmpeg/COPYING.LGPLv2.1 /usr/share/doc/ffmpeg/
WORKDIR /usr/src/app
COPY requirements.txt ./
RUN python3 -m venv /opt/venv \
    && /opt/venv/bin/pip install --no-cache-dir -r requirements.txt \
    && /opt/venv/bin/pip install --no-cache-dir --no-deps faster-whisper==1.2.1
# Bake the model weights into the image so runs never download them.
COPY python/transcribe.py /tmp/transcribe.py
RUN /opt/venv/bin/python /tmp/transcribe.py --download-models /opt/models base small \
    && rm /tmp/transcribe.py \
    && ffmpeg -hide_banner -version | head -n 1
ENV MEDIA_PYTHON=/opt/venv/bin/python \
    MEDIA_MODELS_DIR=/opt/models \
    HF_HUB_OFFLINE=1
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

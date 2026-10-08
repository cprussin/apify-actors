# Build context is this actor directory (apify push uploads only this folder).
# Debian, not apify/actor-node (Alpine): FFmpeg is compiled against Debian's
# codec libraries below. FFmpeg does all the media work, Node runs the actor
# (src/).
FROM node:22-bookworm-slim AS builder
WORKDIR /usr/src/app
COPY package*.json ./
RUN npm install --include=dev --audit=false --fund=false
COPY . ./
RUN npm run build

# A minimal LGPL FFmpeg from the official source release: native demuxers,
# decoders and filters, dav1d for AV1 (FFmpeg has no native software AV1
# decoder), and the encoders the actor writes (JPEG, PNG, GIF and AAC are
# native; WebP, Opus and MP3 use libwebp, libopus and LAME). dav1d, libwebp
# and libopus are BSD, LAME is LGPL. No --enable-gpl, no --enable-nonfree,
# no x264/x265. Debian's ffmpeg package is a GPL build.
FROM debian:bookworm-slim AS ffmpeg
ARG FFMPEG_VERSION=7.1.2
ARG FFMPEG_SHA256=089bc60fb59d6aecc5d994ff530fd0dcb3ee39aa55867849a2bbc4e555f9c304
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
       build-essential nasm pkg-config curl ca-certificates xz-utils \
       zlib1g-dev libwebp-dev libopus-dev libmp3lame-dev libdav1d-dev \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /src
RUN curl -fsSL -o ffmpeg.tar.xz "https://ffmpeg.org/releases/ffmpeg-${FFMPEG_VERSION}.tar.xz" \
    && echo "${FFMPEG_SHA256}  ffmpeg.tar.xz" | sha256sum -c - \
    && tar -xJf ffmpeg.tar.xz --strip-components=1 \
    && ./configure --prefix=/opt/ffmpeg \
       --disable-debug --disable-doc --disable-ffplay --disable-network \
       --disable-autodetect --disable-everything --disable-avdevice \
       --enable-protocol=file,pipe --enable-demuxers --enable-parsers \
       --enable-decoders --enable-filters --enable-bsfs \
       --enable-zlib --enable-libwebp --enable-libopus --enable-libmp3lame \
       --enable-libdav1d \
       --enable-encoder=mjpeg,png,gif,libwebp,aac,libopus,libmp3lame,wrapped_avframe \
       --enable-muxer=image2,gif,ipod,mp3,opus,null \
       --enable-swscale --enable-swresample \
    && make -j"$(nproc)" \
    && make install \
    && /opt/ffmpeg/bin/ffmpeg -hide_banner -L | grep -q "Lesser General Public" \
    && cp COPYING.LGPLv2.1 /opt/ffmpeg/

FROM node:22-bookworm-slim
# Runtime codec libraries for the FFmpeg build above (zlib is in the base).
RUN apt-get update \
    && apt-get install -y --no-install-recommends libwebp7 libopus0 libmp3lame0 libdav1d6 \
    && rm -rf /var/lib/apt/lists/*
COPY --from=ffmpeg /opt/ffmpeg/bin/ffmpeg /opt/ffmpeg/bin/ffprobe /usr/local/bin/
COPY --from=ffmpeg /opt/ffmpeg/COPYING.LGPLv2.1 /usr/share/doc/ffmpeg/
RUN ffmpeg -hide_banner -version | head -n 1 \
    && ffmpeg -hide_banner -encoders | grep -E " (mjpeg|png|gif|libwebp|aac|libopus|libmp3lame) "
WORKDIR /usr/src/app
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

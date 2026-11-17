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

# A minimal FFmpeg from the official source release: native demuxers,
# decoders and filters, dav1d for AV1 input, and only the encoders the actor
# writes. H.264 needs x264 (GPL-2.0+), which makes this FFmpeg binary GPL;
# everything else is LGPL or BSD: libvpx (VP9), libopus and dav1d are BSD,
# LAME is LGPL, AAC, PCM and MPEG-4 (the self-test clip) are FFmpeg's own.
# No --enable-nonfree, no x265, no other GPL libraries. The actor runs
# ffmpeg/ffprobe as separate programs and does not link them.
FROM debian:bookworm-slim AS ffmpeg
ARG FFMPEG_VERSION=7.1.2
ARG FFMPEG_SHA256=089bc60fb59d6aecc5d994ff530fd0dcb3ee39aa55867849a2bbc4e555f9c304
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
       build-essential nasm pkg-config curl ca-certificates xz-utils \
       zlib1g-dev libx264-dev libvpx-dev libopus-dev libmp3lame-dev libdav1d-dev \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /src
RUN curl -fsSL -o ffmpeg.tar.xz "https://ffmpeg.org/releases/ffmpeg-${FFMPEG_VERSION}.tar.xz" \
    && echo "${FFMPEG_SHA256}  ffmpeg.tar.xz" | sha256sum -c - \
    && tar -xJf ffmpeg.tar.xz --strip-components=1 \
    && ./configure --prefix=/opt/ffmpeg \
       --enable-gpl \
       --disable-debug --disable-doc --disable-ffplay --disable-network \
       --disable-autodetect --disable-everything --disable-avdevice \
       --enable-protocol=file,pipe --enable-demuxers --enable-parsers \
       --enable-decoders --enable-filters --enable-bsfs \
       --enable-zlib --enable-libx264 --enable-libvpx --enable-libopus \
       --enable-libmp3lame --enable-libdav1d \
       --enable-encoder=libx264,libvpx_vp9,aac,libopus,libmp3lame,pcm_s16le,mpeg4 \
       --enable-muxer=mp4,ipod,webm,mp3,wav \
       --enable-swscale --enable-swresample \
    && make -j"$(nproc)" \
    && make install \
    && /opt/ffmpeg/bin/ffmpeg -hide_banner -L | grep -q "GNU General Public License" \
    && cp COPYING.GPLv2 COPYING.LGPLv2.1 /opt/ffmpeg/

FROM node:22-bookworm-slim
# Runtime codec libraries for the FFmpeg build above (zlib is in the base).
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
       libx264-164 libvpx7 libopus0 libmp3lame0 libdav1d6 \
    && rm -rf /var/lib/apt/lists/*
COPY --from=ffmpeg /opt/ffmpeg/bin/ffmpeg /opt/ffmpeg/bin/ffprobe /usr/local/bin/
COPY --from=ffmpeg /opt/ffmpeg/COPYING.GPLv2 /opt/ffmpeg/COPYING.LGPLv2.1 /usr/share/doc/ffmpeg/
RUN ffmpeg -hide_banner -version | head -n 1 \
    && ffmpeg -hide_banner -encoders | grep -E " (libx264|libvpx-vp9|aac|libopus|libmp3lame|pcm_s16le|mpeg4) " \
    && ffmpeg -hide_banner -nostdin -v error \
       -filter_complex "testsrc=size=64x48:duration=1[v];sine=duration=1[a]" \
       -map "[v]" -map "[a]" -c:v libx264 -preset veryfast -pix_fmt yuv420p -c:a aac -f mp4 /tmp/t.mp4 \
    && ffprobe -v error -show_entries stream=codec_name -of csv=p=0 /tmp/t.mp4 \
    && rm /tmp/t.mp4
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

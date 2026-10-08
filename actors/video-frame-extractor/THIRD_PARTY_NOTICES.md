# Third-party notices

The actor's Docker image installs the open-source software below. None of it
is modified. Versions come from the `Dockerfile` (Debian 12 "bookworm"
packages for the codec libraries).

| Software                                                        | Use                                 | License      |
| --------------------------------------------------------------- | ----------------------------------- | ------------ |
| [FFmpeg](https://ffmpeg.org/) 7.1.2 (LGPL build, see below)     | Decoding, filters, JPEG/PNG/GIF/AAC | LGPL-2.1+    |
| [dav1d](https://code.videolan.org/videolan/dav1d) 1.0.0         | AV1 decoding                        | BSD-2-Clause |
| [libwebp](https://chromium.googlesource.com/webm/libwebp) 1.2.4 | WebP frame encoding                 | BSD-3-Clause |
| [libopus](https://opus-codec.org/) 1.3.1                        | Opus audio encoding                 | BSD-3-Clause |
| [LAME](https://lame.sourceforge.io/) 3.100                      | MP3 audio encoding                  | LGPL-2.0+    |
| [zlib](https://zlib.net/)                                       | PNG compression (Debian base image) | Zlib         |

## FFmpeg (LGPL)

FFmpeg is built in the `Dockerfile` from the unmodified official source
release `https://ffmpeg.org/releases/ffmpeg-7.1.2.tar.xz` (SHA-256 pinned
there), configured with native demuxers, decoders and filters, the native
MJPEG, PNG, GIF and AAC encoders, the external dav1d decoder and the
external libwebp, libopus and LAME encoders: no `--enable-gpl`, no `--enable-nonfree`, and no GPL codec
libraries (no x264, x265 or Xvid), so the build is licensed under the GNU
Lesser General Public License, version 2.1 or later. The build checks
`ffmpeg -L` for the LGPL notice. The configure flags are in the
`Dockerfile`; the license text is in the image at
`/usr/share/doc/ffmpeg/COPYING.LGPLv2.1`. The actor runs the `ffmpeg` and
`ffprobe` programs as separate processes; it does not link FFmpeg's
libraries.

## Codec libraries

dav1d, libwebp, libopus and LAME are Debian's unmodified `libdav1d6`,
`libwebp7`, `libopus0` and `libmp3lame0` packages, linked dynamically by FFmpeg. Their full
copyright and license files are in the image at
`/usr/share/doc/<package>/copyright`. LAME is licensed under the GNU
Lesser General Public License, version 2 or later; its source is at
https://lame.sourceforge.io/ and in Debian's `lame` source package. dav1d
also comes with the Alliance for Open Media Patent License 1.0, reproduced
in full in `/usr/share/doc/libdav1d6/copyright`.

### dav1d

```
Copyright 2018-2022, VideoLAN and dav1d authors
Copyright 2018-2022, Two Orioles, LLC

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are
met:

   Redistributions of source code must retain the above copyright
   notice, this list of conditions and the following disclaimer.

   Redistributions in binary form must reproduce the above copyright
   notice, this list of conditions and the following disclaimer in
   the documentation and/or other materials provided with the
   distribution.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
"AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT
HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
(INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

### libwebp

```
Copyright (C) 2010, Google Inc. All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are
met:

  * Redistributions of source code must retain the above copyright
    notice, this list of conditions and the following disclaimer.

  * Redistributions in binary form must reproduce the above copyright
    notice, this list of conditions and the following disclaimer in
    the documentation and/or other materials provided with the
    distribution.

  * Neither the name of Google nor the names of its contributors may
    be used to endorse or promote products derived from this software
    without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
"AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT
HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
(INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

### libopus

```
Copyright 2001-2018 Xiph.Org, Skype Limited, Octasic, Jean-Marc Valin,
Timothy B. Terriberry, CSIRO, Gregory Maxwell, Mark Borgerding,
Erik de Castro Lopo

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions
are met:

- Redistributions of source code must retain the above copyright
notice, this list of conditions and the following disclaimer.

- Redistributions in binary form must reproduce the above copyright
notice, this list of conditions and the following disclaimer in the
documentation and/or other materials provided with the distribution.

- Neither the name of Internet Society, IETF or IETF Trust, nor the
names of specific contributors, may be used to endorse or promote
products derived from this software without specific prior written
permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
"AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT OWNER
OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL,
EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO,
PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR
PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF
LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING
NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

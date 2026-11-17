# Third-party notices

The actor's Docker image installs the open-source software below. None of it
is modified. Versions come from the `Dockerfile` (Debian 12 "bookworm"
packages for the codec libraries).

| Software                                                    | Use                                       | License      |
| ----------------------------------------------------------- | ----------------------------------------- | ------------ |
| [FFmpeg](https://ffmpeg.org/) 7.1.2 (GPL build, see below)  | Decoding, filters, AAC/PCM/MPEG-4, muxing | GPL-2.0+     |
| [x264](https://www.videolan.org/developers/x264.html) 0.164 | H.264 video encoding (MP4 output)         | GPL-2.0+     |
| [libvpx](https://www.webmproject.org/) 1.12.0               | VP9 video encoding (WebM output)          | BSD-3-Clause |
| [libopus](https://opus-codec.org/) 1.3.1                    | Opus audio encoding (WebM output)         | BSD-3-Clause |
| [LAME](https://lame.sourceforge.io/) 3.100                  | MP3 audio encoding                        | LGPL-2.0+    |
| [dav1d](https://code.videolan.org/videolan/dav1d) 1.0.0     | AV1 decoding                              | BSD-2-Clause |
| [zlib](https://zlib.net/)                                   | Decompression (Debian base image)         | Zlib         |

## FFmpeg (GPL)

FFmpeg is built in the `Dockerfile` from the unmodified official source
release `https://ffmpeg.org/releases/ffmpeg-7.1.2.tar.xz` (SHA-256 pinned
there), configured with native demuxers, decoders and filters, FFmpeg's own
AAC, PCM and MPEG-4 encoders, the external dav1d decoder and the external
x264, libvpx, libopus and LAME encoders, and only the MP4, M4A, WebM, MP3
and WAV muxers. It is configured with `--enable-gpl` because x264, the
H.264 encoder, is licensed under the GNU General Public License, version 2
or later; with it, this FFmpeg binary is licensed under the GPL, version 2
or later, as a whole. There is no `--enable-nonfree` and no other GPL
library (no x265, Xvid, rubberband or vid.stab). The build checks
`ffmpeg -L` for the GPL notice. The configure flags are in the
`Dockerfile`; the license texts are in the image at
`/usr/share/doc/ffmpeg/COPYING.GPLv2` and `COPYING.LGPLv2.1`.

The actor runs the `ffmpeg` and `ffprobe` programs as separate processes
and passes them files; it does not link FFmpeg's or x264's libraries, so
the GPL applies to those programs and not to the actor's own code. The
complete corresponding source of the FFmpeg binary is the release tarball
above plus the configure flags in the `Dockerfile`; the source of the
Debian packages it links is in Debian's `x264`, `libvpx`, `opus`, `lame`
and `dav1d` source packages (https://sources.debian.org/).

## Codec libraries

x264, libvpx, libopus, LAME and dav1d are Debian's unmodified
`libx264-164`, `libvpx7`, `libopus0`, `libmp3lame0` and `libdav1d6`
packages, linked dynamically by FFmpeg. Their full copyright and license
files are in the image at `/usr/share/doc/<package>/copyright`.

- **x264** is licensed under the GNU General Public License, version 2 or
  later (Copyright 2003-2022 x264 project); its source is at
  https://code.videolan.org/videolan/x264.
- **LAME** is licensed under the GNU Lesser General Public License, version
  2 or later; its source is at https://lame.sourceforge.io/.
- **libvpx** comes with Google's additional patent grant for the WebM
  codecs, reproduced in full in `/usr/share/doc/libvpx7/copyright`.
- **dav1d** comes with the Alliance for Open Media Patent License 1.0,
  reproduced in full in `/usr/share/doc/libdav1d6/copyright`.

H.264 and AAC are covered by patent pools in some countries. The open-source
licences above are copyright licences only and include no patent licence for
those formats.

### libvpx

```
Copyright (c) 2010-2018, The WebM Project authors. All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are
met:

  * Redistributions of source code must retain the above copyright
    notice, this list of conditions and the following disclaimer.

  * Redistributions in binary form must reproduce the above copyright
    notice, this list of conditions and the following disclaimer in
    the documentation and/or other materials provided with the
    distribution.

  * Neither the name of Google, nor the WebM Project, nor the names
    of its contributors may be used to endorse or promote products
    derived from this software without specific prior written
    permission.

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

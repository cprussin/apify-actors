# Third-party notices

The actor's Docker image installs the open-source software and model weights
below. None of it is modified. Versions come from `requirements.txt` and the
`Dockerfile`.

| Software                                                                         | Use                               | License      |
| -------------------------------------------------------------------------------- | --------------------------------- | ------------ |
| [faster-whisper](https://github.com/SYSTRAN/faster-whisper) 1.2.1                | Whisper transcription             | MIT          |
| [CTranslate2](https://github.com/OpenNMT/CTranslate2)                            | Inference engine (int8 on CPU)    | MIT          |
| [Whisper](https://github.com/openai/whisper) model weights (`base`, `small`)     | Speech recognition models         | MIT          |
| [Systran/faster-whisper-base, -small](https://huggingface.co/Systran)            | CTranslate2 conversions of them   | MIT          |
| [Silero VAD](https://github.com/snakers4/silero-vad) (bundled in faster-whisper) | Voice activity detection          | MIT          |
| [FFmpeg](https://ffmpeg.org/) 7.1.2 (LGPL build, see below)                      | Audio/video decoding              | LGPL-2.1+    |
| [ONNX Runtime](https://github.com/microsoft/onnxruntime)                         | Runs the VAD model                | MIT          |
| [tokenizers](https://github.com/huggingface/tokenizers), huggingface_hub         | Whisper tokenizer, model download | Apache-2.0   |
| [NumPy](https://numpy.org/)                                                      | Audio buffers                     | BSD-3-Clause |

## FFmpeg (LGPL)

FFmpeg is built in the `Dockerfile` from the unmodified official source
release `https://ffmpeg.org/releases/ffmpeg-7.1.2.tar.xz` (SHA-256 pinned
there), configured with native demuxers and decoders only: no
`--enable-gpl`, no `--enable-nonfree` and no external codec libraries, so
the build is licensed under the GNU Lesser General Public License, version
2.1 or later. The configure flags are in the `Dockerfile`; the license text
is in the image at `/usr/share/doc/ffmpeg/COPYING.LGPLv2.1`. The actor runs
the `ffmpeg` and `ffprobe` programs as separate processes; it does not link
FFmpeg's libraries.

faster-whisper depends on PyAV, whose wheels bundle a GPL FFmpeg build. The
image does not install PyAV (faster-whisper is installed with `--no-deps`
and its decoder is not used).

## faster-whisper

```
MIT License

Copyright (c) 2023 SYSTRAN

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## CTranslate2

```
MIT License

Copyright (c) 2018-     SYSTRAN.
Copyright (c) 2019-     The OpenNMT Authors.

(Same terms as faster-whisper above.)
```

## Whisper

```
MIT License

Copyright (c) 2022 OpenAI

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

The other packages' license texts ship with them in the image
(`/opt/venv/lib/python3*/site-packages/*.dist-info/`).

# Third-party notices

The actor's Docker image installs the open-source software and model weights
below. Versions come from `requirements.txt`, `requirements-export.txt` and
the `Dockerfile`.

| Software                                                                     | Use                              | License           |
| ---------------------------------------------------------------------------- | -------------------------------- | ----------------- |
| [Real-ESRGAN](https://github.com/xinntao/Real-ESRGAN) `realesr-general-x4v3` | Upscaling model weights          | BSD-3-Clause      |
| [ONNX Runtime](https://github.com/microsoft/onnxruntime) 1.30.0              | Runs the model on CPU            | MIT               |
| [Pillow](https://python-pillow.org/) 12.3.0                                  | Image decoding, resizing, saving | MIT-CMU           |
| [NumPy](https://numpy.org/) 2.4.6                                            | Image buffers                    | BSD-3-Clause      |
| [PyTorch](https://pytorch.org/), [ONNX](https://onnx.ai/) (build stage only) | Converts the weights to ONNX     | BSD-3, Apache-2.0 |

## Real-ESRGAN

The model weights `realesr-general-x4v3.pth` are downloaded during the Docker
build from the project's v0.2.5.0 release (SHA-256 pinned in
`python/export_model.py`) and converted, unchanged, to ONNX format. The
network definition in `python/export_model.py` (`SRVGGNetCompact`) follows
`realesrgan/archs/srvgg_arch.py` from the same project.

```
BSD 3-Clause License

Copyright (c) 2021, Xintao Wang
All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this
   list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.

3. Neither the name of the copyright holder nor the names of its
   contributors may be used to endorse or promote products derived from
   this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

## ONNX Runtime

```
MIT License

Copyright (c) Microsoft Corporation

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

## Pillow

Pillow's wheels bundle image codec libraries (libjpeg-turbo, libpng, zlib,
libtiff, libwebp, libavif with dav1d/aom, OpenJPEG, Little CMS and others)
under their own permissive licenses, listed in Pillow's license file.

The license texts of all Python packages ship with them in the image
(`/opt/venv/lib/python3*/site-packages/*.dist-info/`).

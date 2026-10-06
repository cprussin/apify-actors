# Third-party notices

The actor's Docker image installs the open-source software below. None of it
is modified. Versions come from `requirements.txt` (Python) and Debian
bookworm packages (Tesseract).

| Software                                                                            | Use                              | License                    |
| ----------------------------------------------------------------------------------- | -------------------------------- | -------------------------- |
| [MarkItDown](https://github.com/microsoft/markitdown) 0.1.8                         | Document to Markdown conversion  | MIT                        |
| [Tesseract OCR](https://github.com/tesseract-ocr/tesseract)                         | OCR of scanned PDF pages         | Apache-2.0                 |
| [tessdata](https://github.com/tesseract-ocr/tessdata) (Debian)                      | OCR language models              | Apache-2.0                 |
| [pdfminer.six](https://github.com/pdfminer/pdfminer.six)                            | PDF text extraction              | MIT                        |
| [pdfplumber](https://github.com/jsvine/pdfplumber)                                  | PDF table detection              | MIT                        |
| [pypdfium2](https://github.com/pypdfium2-team/pypdfium2) / PDFium                   | PDF page rendering for OCR       | Apache-2.0 or BSD-3-Clause |
| [mammoth](https://github.com/mwilliamson/python-mammoth)                            | DOCX conversion                  | BSD-2-Clause               |
| [python-pptx](https://github.com/scanny/python-pptx)                                | PPTX conversion                  | MIT                        |
| [openpyxl](https://foss.heptapod.net/openpyxl/openpyxl), pandas                     | XLSX conversion                  | MIT, BSD-3-Clause          |
| [markdownify](https://github.com/matthewwithanm/python-markdownify), Beautiful Soup | HTML to Markdown                 | MIT                        |
| [Magika](https://github.com/google/magika), ONNX Runtime                            | File type detection (MarkItDown) | Apache-2.0, MIT            |
| [Pillow](https://github.com/python-pillow/Pillow)                                   | Image handling                   | MIT-CMU                    |

## MarkItDown

```
MIT License

Copyright (c) Microsoft Corporation.

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

## Tesseract OCR

Tesseract is licensed under the Apache License, Version 2.0
(https://www.apache.org/licenses/LICENSE-2.0). It is installed unmodified from
the Debian `tesseract-ocr` packages, which carry the full license text and
notices in `/usr/share/doc/tesseract-ocr*/copyright` inside the image.

The other packages' license texts ship with them in the image
(`/opt/venv/lib/python3*/site-packages/*.dist-info/`).

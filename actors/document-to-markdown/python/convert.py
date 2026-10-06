"""Document conversion worker: markitdown for every format, plus per-page PDF
extraction (with tesseract OCR for pages without a text layer).

Protocol: one JSON request per line on stdin, one JSON response per line on
stdout, in order. Library output is redirected to stderr so it can't corrupt
the protocol.

Request:  {"id", "path", "type", "ocr", "ocrLanguage", "maxOcrPages",
           "maxPages"}
Response: {"id", "ok": true, "title", "markdown"}            (non-PDF)
          {"id", "ok": true, "title", "pages": [{"text", "ocr"}],
           "pageCount", "ocrSkipped"}                           (PDF)
          {"id", "ok": false, "error"}
"""

import json
import os
import subprocess
import sys
import tempfile
import zipfile

_out = sys.stdout
sys.stdout = sys.stderr

from markitdown import MarkItDown, StreamInfo  # noqa: E402

# PDF helpers from markitdown's own PDF converter (version pinned in
# requirements.txt): table/form detection per page.
from markitdown.converters._pdf_converter import (  # noqa: E402
    _extract_form_content_from_words,
    _merge_partial_numbering_lines,
)

EXTENSIONS = {
    "docx": ".docx",
    "pptx": ".pptx",
    "xlsx": ".xlsx",
    "html": ".html",
    "epub": ".epub",
    "csv": ".csv",
    "txt": ".txt",
}
# Pages with fewer extracted characters than this are treated as scanned.
MIN_TEXT_CHARS = 25
OCR_DPI = 300
# Cap the rendered image size (pixels per side) so huge pages can't exhaust
# memory.
MAX_OCR_SIDE = 6000
OCR_TIMEOUT_SECS = 180
# Zip-based formats: refuse archives that expand beyond this (zip bombs).
MAX_UNZIPPED_BYTES = 1024 * 1024 * 1024

_md = None


class UserError(Exception):
    """An error caused by the document itself (reported verbatim)."""


def markitdown():
    global _md
    if _md is None:
        _md = MarkItDown(enable_plugins=False)
    return _md


def check_zip(path):
    try:
        with zipfile.ZipFile(path) as z:
            total = sum(i.file_size for i in z.infolist())
    except zipfile.BadZipFile:
        raise UserError("The file is corrupt (not a valid ZIP-based document).")
    if total > MAX_UNZIPPED_BYTES:
        raise UserError("The document expands to more than 1 GB; refusing it.")


def ocr_page(pdfium_doc, index, language):
    page = pdfium_doc[index]
    try:
        w, h = page.get_size()
        scale = min(OCR_DPI / 72, MAX_OCR_SIDE / max(w, h, 1))
        image = page.render(scale=scale, grayscale=True).to_pil()
    finally:
        page.close()
    with tempfile.TemporaryDirectory() as tmp:
        png = os.path.join(tmp, "page.png")
        image.save(png)
        image.close()
        res = subprocess.run(
            ["tesseract", png, "stdout", "-l", language],
            capture_output=True,
            timeout=OCR_TIMEOUT_SECS,
            check=False,
        )
    if res.returncode != 0:
        msg = res.stderr.decode("utf-8", "replace").strip().splitlines()
        raise RuntimeError(f"tesseract failed: {msg[-1] if msg else res.returncode}")
    return res.stdout.decode("utf-8", "replace").strip()


def convert_pdf(req):
    import pdfminer.high_level
    import pdfplumber
    import pypdfium2
    from pdfminer.pdfdocument import PDFPasswordIncorrect

    path = req["path"]
    max_pages = int(req.get("maxPages") or 0)
    try:
        prose = pdfminer.high_level.extract_text(
            path, maxpages=max_pages
        ).split("\f")
    except PDFPasswordIncorrect:
        raise UserError("The PDF is password-protected.")
    except Exception as e:  # noqa: BLE001
        raise UserError(f"The PDF could not be read: {e}") from e

    pages = []
    title = None
    with pdfplumber.open(path) as pdf:
        meta_title = (pdf.metadata or {}).get("Title")
        if isinstance(meta_title, bytes):
            meta_title = meta_title.decode("utf-8", "replace")
        if isinstance(meta_title, str) and meta_title.strip():
            title = meta_title.strip()
        page_count = len(pdf.pages)
        n = min(page_count, max_pages) if max_pages else page_count
        for i in range(n):
            page = pdf.pages[i]
            text = None
            try:
                text = _extract_form_content_from_words(page)
            except Exception:  # noqa: BLE001 - fall back to plain text
                text = None
            if text is None:
                text = prose[i] if i < len(prose) else (page.extract_text() or "")
            page.close()
            pages.append({"text": _merge_partial_numbering_lines(text).strip(), "ocr": False})

    scanned = [i for i, p in enumerate(pages) if len(p["text"]) < MIN_TEXT_CHARS]
    ocr_skipped = 0
    if not req.get("ocr"):
        ocr_skipped = len(scanned)
    elif scanned:
        budget = int(req.get("maxOcrPages") or 0)
        ocr_skipped = max(0, len(scanned) - budget)
        doc = pypdfium2.PdfDocument(path)
        try:
            for i in scanned[:budget]:
                text = ocr_page(doc, i, req.get("ocrLanguage") or "eng")
                if len(text) > len(pages[i]["text"]):
                    pages[i] = {"text": text, "ocr": True}
        finally:
            doc.close()

    return {
        "title": title,
        "pages": pages,
        "pageCount": page_count,
        "ocrSkipped": ocr_skipped,
    }


def convert_other(req):
    kind = req["type"]
    if kind in ("docx", "pptx", "xlsx", "epub"):
        check_zip(req["path"])
    ext = EXTENSIONS[kind]
    res = markitdown().convert_local(
        req["path"], stream_info=StreamInfo(extension=ext, charset=req.get("charset"))
    )
    return {"title": res.title, "markdown": res.markdown or ""}


def handle(req):
    if req["type"] == "pdf":
        return convert_pdf(req)
    if req["type"] in EXTENSIONS:
        return convert_other(req)
    raise UserError(f"Unsupported document type: {req['type']}")


def main():
    for line in sys.stdin:
        if not line.strip():
            continue
        req = json.loads(line)
        try:
            res = {"id": req["id"], "ok": True, **handle(req)}
        except UserError as e:
            res = {"id": req["id"], "ok": False, "error": str(e)}
        except Exception as e:  # noqa: BLE001
            res = {
                "id": req["id"],
                "ok": False,
                "error": f"Conversion failed: {type(e).__name__}: {e}"[:500],
            }
        _out.write(json.dumps(res) + "\n")
        _out.flush()


if __name__ == "__main__":
    main()

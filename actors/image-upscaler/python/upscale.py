"""Upscaling worker: Pillow decodes the image, Real-ESRGAN
(realesr-general-x4v3, an ONNX export run by ONNX Runtime on CPU) upscales
it 4x tile by tile, Pillow resizes to the requested scale and encodes it.

Protocol: one JSON request per line on stdin, one JSON response per line on
stdout, in order. Library output is redirected to stderr so it can't corrupt
the protocol.

Requests:
  {"id", "op": "probe", "path"}
    -> {"id", "ok": true, "format", "width", "height", "frames"}
  {"id", "op": "upscale", "path", "outPath", "scale" (2-4),
   "format" ("png" | "jpg" | "webp"), "quality" (1-100), "threads",
   "maxPixels"}
    -> {"id", "ok": true, "inputWidth", "inputHeight", "outputWidth",
        "outputHeight", "outputBytes", "hasAlpha", "seconds", "cpuSeconds",
        "warnings"}
Errors: {"id", "ok": false, "error", "code"}
  code: "decode" | "too_large" | "internal"
"""

import json
import math
import os
import sys
import time

_out = sys.stdout
sys.stdout = sys.stderr

import numpy as np  # noqa: E402
from PIL import Image, ImageOps  # noqa: E402

MODEL = os.environ.get(
    "UPSCALER_MODEL", "/opt/models/realesr-general-x4v3.onnx"
)
MODEL_SCALE = 4
# Formats Pillow may decode (no EPS/PSD/etc.: smaller attack surface).
FORMATS = ["JPEG", "PNG", "WEBP", "GIF", "BMP", "TIFF", "AVIF"]
# Input pixels per tile edge, and context pixels added around each tile so
# tile seams don't show.
TILE = 512
TILE_PAD = 24
# Hard caps, whatever the request says.
HARD_MAX_INPUT_PIXELS = 2_000_000
HARD_MAX_OUTPUT_PIXELS = 32_000_000
WEBP_MAX_SIDE = 16383
JPEG_MAX_SIDE = 65500
# EXIF orientations that swap width and height.
TRANSPOSED = {5, 6, 7, 8}

# We check the header size ourselves before decoding.
Image.MAX_IMAGE_PIXELS = None

_sessions = {}


class UserError(Exception):
    """An error caused by the image itself (reported verbatim)."""

    def __init__(self, message, code="decode"):
        super().__init__(message)
        self.code = code


def session(threads):
    import onnxruntime as ort

    if threads not in _sessions:
        _sessions.clear()
        so = ort.SessionOptions()
        so.intra_op_num_threads = threads
        so.inter_op_num_threads = 1
        so.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
        # Idle threads must not spin: CPU time is billed.
        so.add_session_config_entry("session.intra_op.allow_spinning", "0")
        _sessions[threads] = ort.InferenceSession(
            MODEL, so, providers=["CPUExecutionProvider"]
        )
    return _sessions[threads]


def fmt_mp(pixels):
    return f"{pixels / 1e6:.2f} MP"


def open_image(path):
    try:
        im = Image.open(path, formats=FORMATS)
    except Exception as e:  # noqa: BLE001 - Pillow raises many types
        raise UserError(
            "Not a supported image. Use JPEG, PNG, WebP, GIF, BMP, TIFF or "
            "AVIF."
        ) from e
    return im


def oriented_size(im):
    w, h = im.size
    try:
        orientation = im.getexif().get(0x0112)
    except Exception:  # noqa: BLE001 - broken EXIF: ignore it
        orientation = None
    return (h, w) if orientation in TRANSPOSED else (w, h)


def probe(req):
    with open_image(req["path"]) as im:
        w, h = oriented_size(im)
        return {
            "ok": True,
            "format": (im.format or "").lower() or None,
            "width": w,
            "height": h,
            "frames": int(getattr(im, "n_frames", 1) or 1),
        }


def to_arrays(im):
    """RGB float32 HWC in [0, 1], alpha uint8 HW (or None), grayscale flag."""
    if im.mode in ("I;16", "I;16B", "I;16L", "I", "F"):
        a = np.asarray(im.convert("I"), dtype=np.float64)
        top = 65535.0 if a.max() > 255 else 255.0
        im = Image.fromarray(
            (np.clip(a / top, 0, 1) * 255).round().astype(np.uint8)
        )
    gray = im.mode in ("1", "L", "LA", "La") or (
        im.mode == "P" and im.palette and im.palette.mode == "L"
    )
    has_alpha = im.mode in ("RGBA", "LA", "La", "RGBa", "PA") or (
        im.mode == "P" and "transparency" in im.info
    )
    alpha = None
    if has_alpha:
        rgba = im.convert("RGBA")
        a = np.asarray(rgba)[:, :, 3]
        if a.min() < 255:
            alpha = a.copy()
        rgb = np.asarray(rgba)[:, :, :3]
    else:
        rgb = np.asarray(im.convert("RGB"))
    return rgb.astype(np.float32) / 255.0, alpha, gray


def splits(n, tile):
    """[start, end) ranges of near-equal size, at most `tile` long."""
    count = max(1, math.ceil(n / tile))
    size = math.ceil(n / count)
    return [(i, min(i + size, n)) for i in range(0, n, size)]


def run_model(sess, rgb):
    """4x upscale of an HWC float image, tile by tile; returns HWC uint8."""
    h, w, _ = rgb.shape
    s = MODEL_SCALE
    out = np.empty((h * s, w * s, 3), dtype=np.uint8)
    chw = np.ascontiguousarray(rgb.transpose(2, 0, 1))
    for y0, y1 in splits(h, TILE):
        for x0, x1 in splits(w, TILE):
            ya, yb = max(y0 - TILE_PAD, 0), min(y1 + TILE_PAD, h)
            xa, xb = max(x0 - TILE_PAD, 0), min(x1 + TILE_PAD, w)
            tile = np.ascontiguousarray(chw[None, :, ya:yb, xa:xb])
            res = sess.run(None, {"input": tile})[0][0]
            crop = res[
                :,
                (y0 - ya) * s : (y1 - ya) * s,
                (x0 - xa) * s : (x1 - xa) * s,
            ]
            out[y0 * s : y1 * s, x0 * s : x1 * s] = (
                (np.clip(crop, 0, 1) * 255).round().astype(np.uint8)
            ).transpose(1, 2, 0)
    return out


def save(img, path, fmt, quality, icc):
    if fmt == "jpg" and img.mode in ("RGBA", "LA"):
        # JPEG has no alpha: flatten onto white.
        bg = Image.new(img.mode[:-1], img.size, "white")
        bg.paste(img, mask=img.getchannel("A"))
        img = bg
    if fmt == "webp" and img.mode in ("L", "LA"):
        img = img.convert("RGBA" if img.mode == "LA" else "RGB")
    # Keep the colour profile only when it matches the output colour space
    # (e.g. not a CMYK profile on the RGB result).
    space = icc[16:20] if icc and len(icc) >= 20 else None
    keep = (space == b"RGB " and img.mode in ("RGB", "RGBA")) or (
        space == b"GRAY" and img.mode in ("L", "LA")
    )
    extra = {"icc_profile": icc} if keep else {}
    if fmt == "png":
        img.save(path, "PNG", compress_level=3, **extra)
    elif fmt == "jpg":
        img.save(
            path,
            "JPEG",
            quality=quality,
            subsampling=0 if quality >= 90 else 2,
            **extra,
        )
    elif fmt == "webp":
        img.save(path, "WEBP", quality=quality, method=4, **extra)
    else:
        raise ValueError(f"unknown format {fmt}")


def upscale(req):
    started = time.time()
    cpu_started = time.process_time()
    scale = int(req.get("scale") or 4)
    if scale not in (2, 3, 4):
        raise ValueError("scale must be 2, 3 or 4")
    fmt = req.get("format") or "png"
    quality = max(1, min(100, int(req.get("quality") or 90)))
    threads = max(1, int(req.get("threads") or 1))
    max_pixels = min(
        int(req.get("maxPixels") or HARD_MAX_INPUT_PIXELS), HARD_MAX_INPUT_PIXELS
    )
    warnings = []

    with open_image(req["path"]) as im:
        w, h = oriented_size(im)
        if w * h > max_pixels:
            raise UserError(
                f"The image is {w}x{h} ({fmt_mp(w * h)}), over the "
                f"{fmt_mp(max_pixels)} input limit (maxInputMegapixels).",
                code="too_large",
            )
        ow, oh = w * scale, h * scale
        if ow * oh > HARD_MAX_OUTPUT_PIXELS:
            raise UserError(
                f"The {scale}x output would be {ow}x{oh}, over the "
                f"{fmt_mp(HARD_MAX_OUTPUT_PIXELS)} output limit.",
                code="too_large",
            )
        side = WEBP_MAX_SIDE if fmt == "webp" else JPEG_MAX_SIDE
        if fmt in ("webp", "jpg") and max(ow, oh) > side:
            raise UserError(
                f"The {scale}x output would be {ow}x{oh}; {fmt.upper()} images "
                f"can be at most {side} pixels wide or tall. Use PNG.",
                code="too_large",
            )
        if getattr(im, "n_frames", 1) > 1:
            warnings.append(
                "Animated or multi-page image: only the first frame was upscaled."
            )
        icc = im.info.get("icc_profile")
        try:
            im.load()
            im = ImageOps.exif_transpose(im)
            rgb, alpha, gray = to_arrays(im)
        except UserError:
            raise
        except MemoryError:
            raise
        except Exception as e:  # noqa: BLE001 - truncated or corrupt data
            raise UserError(
                f"The image could not be decoded (damaged file): {str(e)[:200]}"
            ) from e

    big = Image.fromarray(run_model(session(threads), rgb), "RGB")
    del rgb
    if scale != MODEL_SCALE:
        big = big.resize((ow, oh), Image.Resampling.LANCZOS)
    if gray:
        big = big.convert("L")
    if alpha is not None:
        a = Image.fromarray(alpha, "L").resize((ow, oh), Image.Resampling.LANCZOS)
        big = big.convert("LA" if gray else "RGB")
        big.putalpha(a)
        if fmt == "jpg":
            warnings.append("JPEG has no transparency: flattened onto white.")
    save(big, req["outPath"], fmt, quality, icc)
    return {
        "ok": True,
        "inputWidth": w,
        "inputHeight": h,
        "outputWidth": ow,
        "outputHeight": oh,
        "outputBytes": os.path.getsize(req["outPath"]),
        "hasAlpha": alpha is not None,
        "seconds": round(time.time() - started, 3),
        "cpuSeconds": round(time.process_time() - cpu_started, 3),
        "warnings": warnings,
    }


def handle(req):
    try:
        if req.get("op") == "probe":
            return probe(req)
        return upscale(req)
    except UserError as e:
        return {"ok": False, "error": str(e), "code": e.code}
    except MemoryError:
        return {
            "ok": False,
            "error": "Out of memory. Raise the run's memory or lower "
            "maxInputMegapixels.",
            "code": "internal",
        }
    except Exception as e:  # noqa: BLE001 - report, keep serving
        msg = str(e).splitlines()[0] if str(e) else type(e).__name__
        return {
            "ok": False,
            "error": f"Upscaling failed: {msg[:300]}",
            "code": "internal",
        }


def main():
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
        except json.JSONDecodeError:
            continue
        res = handle(req)
        res["id"] = req.get("id")
        _out.write(json.dumps(res) + "\n")
        _out.flush()


if __name__ == "__main__":
    main()

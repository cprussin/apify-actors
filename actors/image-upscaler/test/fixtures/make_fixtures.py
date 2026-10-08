"""Writes tiny test images to the directory given as the only argument."""

import io
import os
import sys

from PIL import Image

out = sys.argv[1]


def gradient(w, h, mode="RGB"):
    im = Image.new("RGB", (w, h))
    im.putdata(
        [(x * 255 // max(1, w - 1), y * 255 // max(1, h - 1), (x * 7 + y * 13) % 256)
         for y in range(h) for x in range(w)]
    )  # fmt: skip
    return im.convert(mode)


def path(name):
    return os.path.join(out, name)


gradient(40, 30).save(path("rgb.png"))
gradient(40, 30).save(path("photo.jpg"), quality=90)
gradient(24, 24, "L").save(path("gray.png"))

# Left half transparent.
rgba = gradient(32, 32, "RGBA")
alpha = Image.new("L", (32, 32), 255)
alpha.paste(0, (0, 0, 16, 32))
rgba.putalpha(alpha)
rgba.save(path("alpha.png"))

# EXIF orientation 6 (rotate 90 degrees clockwise to display): 40x20 stored,
# 20x40 shown.
exif = Image.Exif()
exif[0x0112] = 6
gradient(40, 20).save(path("rotated.jpg"), exif=exif)

frames = [gradient(16, 16), gradient(16, 16).transpose(Image.Transpose.FLIP_LEFT_RIGHT)]
frames[0].save(path("animated.gif"), save_all=True, append_images=frames[1:])

gradient(16, 12).save(path("photo.webp"))
gradient(20, 20, "CMYK").save(path("cmyk.jpg"))
gray_alpha = gradient(20, 20, "LA")
gray_alpha.putalpha(alpha.resize((20, 20)))
gray_alpha.save(path("gray-alpha.png"))

# 1500x1000 (1.5 MP) of flat colour: tiny file, over a 1 MP limit.
Image.new("RGB", (1500, 1000), (90, 120, 150)).save(path("large.png"))
# 5000x10 at 4x is 20000 px wide: too wide for WebP.
Image.new("RGB", (5000, 10), (10, 20, 30)).save(path("wide.png"))

buf = io.BytesIO()
gradient(64, 64).save(buf, "PNG")
with open(path("truncated.png"), "wb") as f:
    f.write(buf.getvalue()[: len(buf.getvalue()) // 2])

with open(path("not-image.png"), "wb") as f:
    f.write(b"definitely not an image")

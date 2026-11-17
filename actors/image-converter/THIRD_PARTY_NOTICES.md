# Third-party notices

The actor's Docker image installs the open-source software below. None of it
is modified. npm versions come from `package.json` (sharp's prebuilt
binaries); Debian versions are the Debian 12 "bookworm" packages installed by
the `Dockerfile`.

| Software                                              | Use                                     | License    |
| ----------------------------------------------------- | --------------------------------------- | ---------- |
| [sharp](https://sharp.pixelplumbing.com/) 0.35        | Image decoding, resizing and encoding   | Apache-2.0 |
| [libvips](https://www.libvips.org/) 8.18 (in sharp)   | The image-processing library sharp uses | LGPL-3.0+  |
| [libheif](https://github.com/strukturag/libheif) 1.15 | HEIC/HEIF decoding (`heif-convert`)     | LGPL-3.0+  |
| [libde265](https://github.com/strukturag/libde265)    | HEVC decoding for HEIC                  | LGPL-3.0+  |

## sharp and libvips

sharp is installed from npm with its prebuilt `@img/sharp-linux-x64` and
`@img/sharp-libvips-linux-x64` packages, which bundle libvips and the libraries
it uses (libjpeg-turbo/mozjpeg, libpng, libwebp, libaom, libheif for AVIF,
librsvg, libtiff, cgif, lcms2 and others). Their licenses are listed in the
"Licensing" section of `node_modules/@img/sharp-libvips-linux-x64/README.md`
in the image. The libvips package is distributed under LGPL-3.0-or-later; it
is dynamically linked, and its source is at
https://github.com/libvips/libvips.

## libheif and libde265 (HEIC)

HEIC is decoded by the `heif-convert` program from Debian's unmodified
`libheif-examples` package, run as a separate process; the actor does not
link libheif. Debian's `libheif1` also depends on `libaom3`, `libdav1d6` and
`libx265-199` (an HEVC **encoder**, GPL-2.0+, which decoding does not use).
Their full copyright and license files are in the image at
`/usr/share/doc/<package>/copyright`, and their sources are in Debian's
`libheif`, `libde265`, `aom`, `dav1d` and `x265` source packages.

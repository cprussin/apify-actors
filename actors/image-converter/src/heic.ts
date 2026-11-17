import { execFile } from "node:child_process";

/** libheif's command-line decoder (Debian libheif-examples, with libde265). */
export const HEIF_CONVERT = process.env.HEIF_CONVERT ?? "heif-convert";

/**
 * Decodes the primary image of a HEIC/HEIF file to a PNG with
 * heif-convert, as a separate process (sharp's prebuilt libvips has no
 * HEVC decoder). Rotation and mirroring in the file are applied.
 */
export function decodeHeic(
  inPath: string,
  outPath: string,
  timeoutMs: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(
      HEIF_CONVERT,
      [inPath, outPath],
      { timeout: timeoutMs, maxBuffer: 1024 * 1024 },
      (err, _stdout, stderr) => {
        if (!err) return resolve();
        const e = err as NodeJS.ErrnoException & { killed?: boolean };
        if (e.code === "ENOENT")
          return reject(
            new Error("HEIC decoding is not available (heif-convert missing)."),
          );
        if (e.killed)
          return reject(
            new Error(`HEIC decoding timed out after ${timeoutMs / 1000} s.`),
          );
        const why = String(stderr).trim().split("\n").at(-1) || e.message;
        reject(new Error(`HEIC decoding failed: ${why.slice(0, 300)}`));
      },
    );
  });
}

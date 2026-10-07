"""Transcription worker: the FFmpeg CLI (an LGPL build) decodes any audio or
video file to 16 kHz mono PCM, faster-whisper (CTranslate2, int8 on CPU)
transcribes it with Silero VAD.

Protocol: one JSON request per line on stdin, one JSON response per line on
stdout, in order. Library output is redirected to stderr so it can't corrupt
the protocol.

Request:  {"id", "path", "model", "language" (null = detect), "threads",
           "maxSeconds", "budgetMinutes" (null = unlimited)}
Response: {"id", "ok": true, "language", "languageProbability", "duration",
           "segments": [{"start", "end", "text"}], "warnings"}
          {"id", "ok": false, "error", "code", "duration"}
          code: "too_long" | "budget" | "no_audio" | "decode" | "internal"
"""

import json
import math
import os
import subprocess
import sys
import tempfile
import time
import types

_out = sys.stdout
sys.stdout = sys.stderr

import numpy as np  # noqa: E402

try:
    import av  # noqa: F401
except ImportError:
    # faster-whisper imports PyAV for its own decoder, which this worker
    # doesn't use. The image leaves PyAV out: its wheels bundle GPL codecs.
    sys.modules["av"] = types.ModuleType("av")

FFMPEG = os.environ.get("MEDIA_FFMPEG", "ffmpeg")
FFPROBE = os.environ.get("MEDIA_FFPROBE", "ffprobe")
SAMPLE_RATE = 16000
# Long files are transcribed in windows of about this length, cut at the
# quietest moment of the last WINDOW_SLACK seconds: faster-whisper computes
# the spectrogram of its whole input at once, which for hours of audio would
# need several GB.
WINDOW_SECS = 600
WINDOW_SLACK = 30
# Files with less audio than this are treated as empty.
MIN_SECONDS = 0.3
# Header durations of VBR files are estimates: only reject before decoding
# when the header says clearly too long.
HEADER_TOLERANCE = 1.1
PROBE_TIMEOUT_SECS = 120

_models = {}


class UserError(Exception):
    """An error caused by the file itself (reported verbatim)."""

    def __init__(self, message, code="decode", duration=None):
        super().__init__(message)
        self.code = code
        self.duration = duration


def fmt_minutes(seconds):
    return f"{seconds / 60:.1f} min"


def last_line(data):
    lines = [
        ln.strip()
        for ln in data.decode("utf-8", "replace").splitlines()
        if ln.strip()
    ]
    return lines[-1][:200] if lines else ""


def model_path(name):
    root = os.environ.get("MEDIA_MODELS_DIR")
    if root and os.path.isdir(os.path.join(root, name)):
        return os.path.join(root, name)
    return name  # Downloaded from Hugging Face on first use (local dev).


def load_model(name, threads):
    from faster_whisper import WhisperModel

    key = (name, threads)
    if key not in _models:
        _models.clear()
        _models[key] = WhisperModel(
            model_path(name),
            device="cpu",
            compute_type="int8",
            cpu_threads=threads,
            num_workers=1,
        )
    return _models[key]


def probe(path):
    """Header duration in seconds (or None); fails for non-media files."""
    try:
        res = subprocess.run(
            [FFPROBE, "-v", "error", "-show_entries",
             "format=duration:stream=codec_type", "-of", "json", path],
            capture_output=True,
            timeout=PROBE_TIMEOUT_SECS,
            check=False,
        )  # fmt: skip
    except subprocess.TimeoutExpired as e:
        raise UserError("The file could not be read (probing timed out).") from e
    if res.returncode != 0:
        detail = last_line(res.stderr).replace(f"{path}: ", "")
        raise UserError(
            "Not a supported audio or video file"
            + (f" ({detail})." if detail else ".")
        )
    info = json.loads(res.stdout or b"{}")
    if not any(s.get("codec_type") == "audio" for s in info.get("streams", [])):
        raise UserError("The file has no audio track.", code="no_audio")
    try:
        duration = float(info.get("format", {}).get("duration"))
    except (TypeError, ValueError):
        return None
    return duration if math.isfinite(duration) and duration > 0 else None


def decode(path, max_seconds):
    """The file's first audio stream as 16 kHz mono int16, plus warnings."""
    warnings = []
    declared = probe(path)
    if declared and declared > max_seconds * HEADER_TOLERANCE:
        raise UserError(
            f"The media is {fmt_minutes(declared)} long, over the "
            f"{fmt_minutes(max_seconds)} limit (maxDurationMinutes).",
            code="too_long",
            duration=declared,
        )
    cap = int(max_seconds * SAMPLE_RATE) * 2
    # Preallocate from the header duration (int16: 1.9 MB per minute); grow
    # if it was an underestimate.
    size = int(min(max_seconds, (declared or 600) * 1.05 + 5) * SAMPLE_RATE) * 2
    buf = bytearray(max(size, SAMPLE_RATE * 2))
    n = 0
    with tempfile.TemporaryFile() as err:
        proc = subprocess.Popen(
            [FFMPEG, "-nostdin", "-v", "error", "-i", path, "-map", "0:a:0",
             "-vn", "-sn", "-dn", "-ac", "1", "-ar", str(SAMPLE_RATE),
             "-f", "s16le", "-acodec", "pcm_s16le", "-"],
            stdout=subprocess.PIPE,
            stderr=err,
        )  # fmt: skip
        try:
            while True:
                if n == len(buf):
                    if n > cap:
                        raise UserError(
                            "The media is longer than the "
                            f"{fmt_minutes(max_seconds)} limit "
                            "(maxDurationMinutes).",
                            code="too_long",
                            duration=n / 2 / SAMPLE_RATE,
                        )
                    grown = bytearray(min(cap + 2, len(buf) * 2))
                    grown[:n] = buf
                    buf = grown
                with memoryview(buf) as mv:
                    k = proc.stdout.readinto(mv[n:])
                if not k:
                    break
                n += k
        finally:
            if proc.poll() is None:
                proc.kill()
            proc.wait()
            proc.stdout.close()
        err.seek(0)
        detail = last_line(err.read()).replace(f"{path}: ", "")
    if n > cap:
        raise UserError(
            f"The media is longer than the {fmt_minutes(max_seconds)} limit "
            "(maxDurationMinutes).",
            code="too_long",
            duration=n / 2 / SAMPLE_RATE,
        )
    samples = n // 2
    if proc.returncode != 0:
        if samples < SAMPLE_RATE:
            raise UserError(
                "The audio could not be decoded (damaged file or unsupported "
                "codec" + (f": {detail})." if detail else ").")
            )
        warnings.append(
            f"Decoding stopped at {samples / SAMPLE_RATE:.0f} s (damaged or "
            "truncated file); the rest was not transcribed."
        )
    if samples < MIN_SECONDS * SAMPLE_RATE:
        raise UserError("The file contains no audio.", code="no_audio")
    return np.frombuffer(buf, dtype=np.int16, count=samples), warnings


def windows(audio):
    """[start, end) sample ranges of at most WINDOW_SECS, cut at quiet spots."""
    total = len(audio)
    size = WINDOW_SECS * SAMPLE_RATE
    slack = WINDOW_SLACK * SAMPLE_RATE
    frame = SAMPLE_RATE // 4
    out = []
    start = 0
    while total - start > size:
        lo = start + size - slack
        region = audio[lo : start + size].astype(np.float32)
        frames = len(region) // frame
        energy = (region[: frames * frame].reshape(frames, frame) ** 2).mean(axis=1)
        cut = lo + int(np.argmin(energy)) * frame + frame // 2
        out.append((start, cut))
        start = cut
    out.append((start, total))
    return out


def transcribe(req):
    model_name = req.get("model") or "base"
    threads = max(1, int(req.get("threads") or 1))
    max_seconds = float(req.get("maxSeconds") or 3 * 3600)
    audio, warnings = decode(req["path"], max_seconds)
    duration = round(len(audio) / SAMPLE_RATE, 3)

    budget = req.get("budgetMinutes")
    minutes = max(1, math.ceil(duration / 60))
    if budget is not None and minutes > budget:
        raise UserError(
            f"Not transcribed: {minutes} min of audio is more than the "
            f"remaining max charge per run pays for ({int(budget)} min).",
            code="budget",
            duration=duration,
        )

    model = load_model(model_name, threads)
    language = req.get("language") or None
    probability = 1.0 if language else None
    segments = []
    started = time.time()
    parts = windows(audio)
    for i, (a, b) in enumerate(parts):
        chunk = audio[a:b].astype(np.float32) / 32768.0
        segs, info = model.transcribe(
            chunk,
            language=language,
            vad_filter=True,
            beam_size=5,
        )
        offset = a / SAMPLE_RATE
        found = False
        for s in segs:
            text = s.text.strip()
            if not text:
                continue
            found = True
            segments.append(
                {
                    "start": round(s.start + offset, 3),
                    "end": round(min(s.end + offset, b / SAMPLE_RATE), 3),
                    "text": text,
                }
            )
        # Keep the language detected in the first window with speech.
        if found and language is None:
            language = info.language
            probability = round(float(info.language_probability), 4)
        if len(parts) > 1:
            print(
                f"window {i + 1}/{len(parts)} done in {time.time() - started:.0f} s",
                file=sys.stderr,
            )
    return {
        "ok": True,
        "language": language if segments else None,
        "languageProbability": probability if segments else None,
        "duration": duration,
        "segments": segments,
        "warnings": warnings,
    }


def handle(req):
    try:
        return transcribe(req)
    except UserError as e:
        return {"ok": False, "error": str(e), "code": e.code, "duration": e.duration}
    except MemoryError:
        return {
            "ok": False,
            "error": "Out of memory. Raise the run's memory or lower maxDurationMinutes.",
            "code": "internal",
            "duration": None,
        }
    except Exception as e:  # noqa: BLE001 - report, keep serving
        msg = str(e).splitlines()[0] if str(e) else type(e).__name__
        return {
            "ok": False,
            "error": f"Transcription failed: {msg[:300]}",
            "code": "internal",
            "duration": None,
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
        _out.write(json.dumps(res, ensure_ascii=False) + "\n")
        _out.flush()


def download_models(root, names):
    """Docker build: bake the model weights into the image, check they load."""
    from faster_whisper import WhisperModel, download_model

    for name in names:
        path = os.path.join(root, name)
        download_model(name, output_dir=path)
        WhisperModel(path, device="cpu", compute_type="int8")
        print(f"model {name} ready in {path}", file=sys.stderr)


if __name__ == "__main__":
    if len(sys.argv) > 2 and sys.argv[1] == "--download-models":
        download_models(sys.argv[2], sys.argv[3:])
    else:
        main()

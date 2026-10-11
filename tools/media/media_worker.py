# SPDX-License-Identifier: GPL-3.0-only
# Additional terms: see LICENSE-ADDITIONAL-TERMS
"""Fixed host-only media worker; no CLI URL/options, credentials or provider logs."""
import hashlib
import io
import json
import os
from pathlib import Path
import re
import stat
import sys
import time
import urllib.request
from urllib.parse import urlsplit
import zipfile

MAX_BYTES = 512 * 1024 * 1024
DENO_BYTES = 42630221
DENO_SHA256 = "a0c3101b4158d1dfb7d6a78a7bf0f3de80c96bb423c152beec8beb22786f2238"
DENO_EXE_SHA256 = "e020f3e232bd16e33768dee528e5983349c962952051ced0a5d58ad42f5d9b33"
DENO_URL = "https://github.com/denoland/deno/releases/download/v2.9.7/deno-x86_64-pc-windows-msvc.zip"
RUNTIMES = {
    "deno": (DENO_URL, DENO_BYTES, DENO_SHA256, "deno.exe", 97462048, DENO_EXE_SHA256),
    "ffmpeg": ("https://github.com/GyanD/codexffmpeg/releases/download/9.0.2/ffmpeg-9.0.2-essentials_build.zip", 114768076,
               "60f467265b1e312373dbcd92200c2618a74850f98d3d078e94296bb3fa2047ba", "ffmpeg-9.0.2-essentials_build/bin/ffmpeg.exe", 105423872,
               "3256173f3f8bffd7df12227c68adf68025edb1832273a9530688a7bb1ed8edec"),
}
WHEELS = (
    ("yt_dlp-2026.8.19-py3-none-any.whl", "1d57897e94c6665a0a6f9bc54b34e584284e32c034ffab3a7df25d8f7b24eedf"),
    ("yt_dlp_ejs-0.8.0-py3-none-any.whl", "79300e5fca7f937a1eeede11f0456862c1b41107ce1d726871e0207424f4bdb4"),
)


class SafeFailure(Exception):
    def __init__(self, code):
        self.code = code


def runtime_address_allowed(url):
    address = urlsplit(url)
    return address.scheme == "https" and address.hostname in ("github.com", "release-assets.githubusercontent.com", "objects.githubusercontent.com") and address.port in (None, 443) and address.username is None and address.password is None


class RuntimeRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        if not runtime_address_allowed(newurl):
            raise SafeFailure("runtime-integrity")
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def runtime_response(url):
    if not runtime_address_allowed(url):
        raise SafeFailure("runtime-integrity")
    return urllib.request.build_opener(RuntimeRedirect()).open(url, timeout=20)


def emit(event, **fields):
    sys.stdout.buffer.write((json.dumps({"event": event, **fields}, separators=(",", ":")) + "\n").encode("ascii"))
    sys.stdout.buffer.flush()


def bounded_input():
    raw = sys.stdin.buffer.read(8193)
    if len(raw) > 8192:
        raise SafeFailure("invalid-request")
    request = json.loads(raw)
    if not isinstance(request, dict):
        raise SafeFailure("invalid-request")
    return request


def hash_file(path):
    h = hashlib.sha256()
    with path.open("rb") as f:
        while block := f.read(256 * 1024):
            h.update(block)
    return h.hexdigest()


def deno_entry(zip_bytes):
    if len(zip_bytes) != DENO_BYTES or hashlib.sha256(zip_bytes).hexdigest() != DENO_SHA256:
        raise SafeFailure("runtime-integrity")
    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as archive:
        entries = archive.infolist()
        if len(entries) != 1:
            raise SafeFailure("runtime-integrity")
        entry = entries[0]
        mode = entry.external_attr >> 16
        if entry.filename != "deno.exe" or entry.is_dir() or stat.S_ISLNK(mode) or entry.file_size > 160 * 1024 * 1024:
            raise SafeFailure("runtime-integrity")
        exe = archive.read(entry)
        if hashlib.sha256(exe).hexdigest() != DENO_EXE_SHA256:
            raise SafeFailure("runtime-integrity")
        return exe


def provision(request):
    if set(request) != {"mode", "directory", "engine"} or request["engine"] not in RUNTIMES:
        raise SafeFailure("invalid-request")
    directory = Path(request["directory"])
    if not directory.is_absolute() or not directory.is_dir():
        raise SafeFailure("invalid-request")
    url, zip_size, zip_hash, member, exe_size, exe_hash = RUNTIMES[request["engine"]]
    target = directory / (request["engine"] + ".exe")
    archive_path = directory / (request["engine"] + ".zip")
    if target.exists():
        raise SafeFailure("runtime-integrity")
    # The fixed official URL and HTTPS redirects are the only provisioning request.
    downloaded = 0
    digest = hashlib.sha256()
    with runtime_response(url) as response, archive_path.open("xb") as stored:
        if not runtime_address_allowed(response.url):
            raise SafeFailure("runtime-integrity")
        while block := response.read(256 * 1024):
            downloaded += len(block)
            if downloaded > zip_size:
                raise SafeFailure("runtime-integrity")
            digest.update(block)
            stored.write(block)
            emit("runtime-progress", downloaded=downloaded, total=zip_size)
    if downloaded != zip_size or digest.hexdigest() != zip_hash:
        raise SafeFailure("runtime-integrity")
    with zipfile.ZipFile(archive_path) as archive:
        entries = archive.infolist()
        if len(entries) > 64 or (request["engine"] == "deno" and len(entries) != 1):
            raise SafeFailure("runtime-integrity")
        matches = []
        for entry in entries:
            if entry.filename.startswith(("/", "\\")) or "\\" in entry.filename or ":" in entry.filename or ".." in entry.filename.split("/") or stat.S_ISLNK(entry.external_attr >> 16) or entry.flag_bits & 1:
                raise SafeFailure("runtime-integrity")
            if entry.filename == member:
                matches.append(entry)
        if len(matches) != 1 or matches[0].is_dir() or matches[0].file_size != exe_size:
            raise SafeFailure("runtime-integrity")
        written = 0
        digest = hashlib.sha256()
        with archive.open(matches[0]) as source, target.open("xb") as output:
            while block := source.read(256 * 1024):
                written += len(block)
                if written > exe_size:
                    raise SafeFailure("runtime-integrity")
                digest.update(block)
                output.write(block)
            output.flush()
            os.fsync(output.fileno())
        if written != exe_size or digest.hexdigest() != exe_hash:
            raise SafeFailure("runtime-integrity")
    emit("runtime-ready", sha256=exe_hash, size=exe_size)


class SilentLogger:
    def debug(self, _message):
        pass

    def warning(self, _message):
        pass

    def error(self, _message):
        # Classify internally; never emit the provider's free-form message.
        message = str(_message).lower()
        if "sign in" in message or "bot" in message:
            raise SafeFailure("authentication-required")
        if "requested format" in message or "no video formats" in message:
            raise SafeFailure("combined-format-unavailable")
        if "video unavailable" in message or "private video" in message or "not available" in message:
            raise SafeFailure("restricted-video")
        if "certificate" in message or "ssl" in message:
            raise SafeFailure("network-certificate")
        if "timed out" in message or "unable to download" in message:
            raise SafeFailure("network-unavailable")


def download(request):
    if set(request) != {"mode", "videoId", "directory", "deno"}:
        raise SafeFailure("invalid-request")
    video = request["videoId"]
    if not isinstance(video, str) or re.fullmatch(r"[A-Za-z0-9_-]{11}", video) is None:
        raise SafeFailure("invalid-request")
    directory = Path(request["directory"])
    deno = Path(request["deno"])
    if not directory.is_absolute() or not directory.is_dir() or not deno.is_absolute() or not deno.is_file():
        raise SafeFailure("invalid-request")
    if hash_file(deno) != DENO_EXE_SHA256:
        raise SafeFailure("runtime-integrity")
    own = Path(__file__).resolve().parent
    for name, expected in WHEELS:
        wheel = own / name
        if hash_file(wheel) != expected:
            raise SafeFailure("runtime-integrity")
        sys.path.insert(0, str(wheel))
    import yt_dlp
    from yt_dlp.globals import plugin_dirs
    plugin_dirs.value = []  # API mode also has default plugin search paths; never use them.
    last = [0.0]
    completed_bytes = [0]

    def progress(info):
        stream_count = info.get("downloaded_bytes", 0)
        if type(stream_count) is not int:
            raise SafeFailure("size-limit")
        count = completed_bytes[0] + stream_count
        total = info.get("total_bytes") or info.get("total_bytes_estimate")
        if total is not None:
            if type(total) is not int:
                raise SafeFailure("size-limit")
            total += completed_bytes[0]
        if type(count) is not int or count < 0 or count > MAX_BYTES:
            raise SafeFailure("size-limit")
        if total is not None and (type(total) is not int or total < 0 or total > MAX_BYTES):
            raise SafeFailure("size-limit")
        now = time.monotonic()
        if now - last[0] >= 0.25 or info.get("status") == "finished":
            emit("progress", downloaded=count, total=total)
            last[0] = now

    options = {
        "noplaylist": True, "allowed_extractors": ["youtube"], "format": "bestvideo+bestaudio/best",
        "outtmpl": str(directory / "video.%(ext)s"), "max_filesize": MAX_BYTES,
        "overwrites": False, "continuedl": False, "fixup": "never", "postprocessors": [],
        "js_runtimes": {"deno": {"path": str(deno)}}, "remote_components": [],
        "cachedir": False, "proxy": "", "socket_timeout": 15, "retries": 2, "fragment_retries": 2,
        "extractor_retries": 2, "file_access_retries": 0, "quiet": True, "no_warnings": True,
        "noprogress": True, "logger": SilentLogger(), "progress_hooks": [progress],
        "usenetrc": False, "cookiefile": None, "cookiesfrombrowser": None,
    }
    with yt_dlp.YoutubeDL(options) as downloader:
        info = downloader.extract_info("https://www.youtube.com/watch?v=" + video, download=False)
        if not isinstance(info, dict) or info.get("id") != video or info.get("_type", "video") != "video":
            raise SafeFailure("restricted-video")
        if info.get("is_live") or info.get("live_status") in ("is_live", "is_upcoming") or info.get("availability") not in (None, "public", "unlisted"):
            raise SafeFailure("restricted-video")
        formats = info.get("formats", [])
        videos = [f for f in formats if f.get("ext") == "mp4" and f.get("protocol") == "https" and str(f.get("vcodec", "")).startswith("avc1") and f.get("acodec") == "none" and type(f.get("height")) is int and f["height"] <= 720 and (f.get("fps") or 30) <= 30]
        audios = [f for f in formats if f.get("ext") == "m4a" and f.get("protocol") == "https" and str(f.get("acodec", "")).startswith("mp4a") and f.get("vcodec") == "none"]
        if not videos or not audios:
            combined = [f for f in formats if f.get("ext") == "mp4" and f.get("protocol") == "https" and str(f.get("vcodec", "")).startswith("avc1") and str(f.get("acodec", "")).startswith("mp4a") and type(f.get("height")) is int and f["height"] <= 720 and (f.get("fps") or 30) <= 30]
            if not combined:
                raise SafeFailure("combined-format-unavailable")
            selected = max(combined, key=lambda f:(f["height"], f.get("tbr") or 0))
            downloader.params["outtmpl"] = {"default":str(directory / "video.mp4")}
            download_info = {**info, **selected}
            download_info.pop("requested_formats", None)
            download_info.pop("requested_downloads", None)
            downloader.process_info(download_info)
            size = (directory / "video.mp4").stat().st_size
            if size == 0 or size > MAX_BYTES:
                raise SafeFailure("size-limit")
            emit("done",size=size)
            return
        video_format = max(videos, key=lambda f: (f["height"], f.get("tbr") or 0))
        audio_format = max(audios, key=lambda f: f.get("abr") or f.get("tbr") or 0)
        declared = [(f.get("filesize") or f.get("filesize_approx")) for f in (video_format, audio_format)]
        if all(type(n) is int for n in declared) and sum(declared) > MAX_BYTES:
            raise SafeFailure("size-limit")
        completed = 0
        for fixed_name, selected in (("video-only.mp4", video_format), ("audio-only.m4a", audio_format)):
            downloader.params["outtmpl"] = {"default": str(directory / fixed_name)}
            download_info = {**info, **selected}
            download_info.pop("requested_formats", None)
            download_info.pop("requested_downloads", None)
            downloader.process_info(download_info)
            size = (directory / fixed_name).stat().st_size
            if size == 0 or size + completed > MAX_BYTES:
                raise SafeFailure("size-limit")
            completed += size
            completed_bytes[0] = completed
    emit("done", size=completed)


def main():
    try:
        request = bounded_input()
        if request.get("mode") == "provision":
            provision(request)
        elif request.get("mode") == "download":
            download(request)
        else:
            raise SafeFailure("invalid-request")
    except SafeFailure as error:
        emit("error", code=error.code)
        return 1
    except BaseException:
        # No provider traceback, URL, token, path, title or filename leaves this worker.
        emit("error", code="provider-failed")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

"""Install optional English/Chinese model packs; voice names come from provider metadata."""
import argparse
import html
import json
from pathlib import Path
import re
import tarfile
import urllib.request
import zipfile
import shutil
import subprocess
import tempfile
import time
import sys
import hashlib

BASE = "https://alphacephei.com/vosk/models/"
KOKORO = "kokoro-{precision}multi-lang-"
KOKORO_SOURCE = "https://k2-fsa.github.io/sherpa/onnx/tts/all/Chinese-English/kokoro-multi-lang-"


def progress(phase, downloaded=0, total=0):
    print(json.dumps({"phase": phase, "downloaded": downloaded, "total": total}), flush=True)


def install(root, name, url):
    target = root / name
    if target.is_dir():
        return target
    with tempfile.TemporaryDirectory(prefix=".install-", dir=root) as temp:
        staging = Path(temp)
        archive = staging / url.rsplit("/", 1)[1]
        progress("downloading")
        with urllib.request.urlopen(url, timeout=60) as response, archive.open("wb") as output:
            total = int(response.headers.get("Content-Length", 0))
            count, last = 0, 0
            while chunk := response.read(1024 * 1024):
                output.write(chunk)
                count += len(chunk)
                if time.monotonic() - last > 0.25:
                    progress("downloading", count, total)
                    last = time.monotonic()
            progress("downloading", count, total)
        progress("extracting")
        if archive.suffix == ".zip":
            with zipfile.ZipFile(archive) as source:
                for member in source.namelist():
                    if not (staging / member).resolve().is_relative_to(staging.resolve()):
                        raise ValueError("Archive contains an unsafe path")
                source.extractall(staging)
        else:
            with tarfile.open(archive) as source:
                source.extractall(staging, filter="data")
        extracted = staging / name
        if not extracted.is_dir():
            raise ValueError("Archive does not contain the selected model")
        extracted.rename(target)
    return target


def voice_metadata(page):
    """Read provider speaker IDs; prefix conventions supply locale and gender."""
    locales = {
        "a": ("en-US", "American"), "b": ("en-GB", "British"),
        "z": ("zh-CN", "Chinese"), "e": ("es-ES", "Spanish"),
        "f": ("fr-FR", "French"), "h": ("hi-IN", "Indian"),
        "i": ("it-IT", "Italian"), "j": ("ja-JP", "Japanese"),
        "p": ("pt-BR", "Brazilian"),
    }
    voices = []
    for sid, code in re.findall(r"<td>(\d+) -> ([a-z]{2}_[a-z0-9_]+)</td>", html.unescape(page)):
        prefix, name = code.split("_", 1)
        locale, region = locales[prefix[0]]
        label = name.replace("_", " ").title() if not name.isdigit() else code.upper().replace("_", " ")
        voices.append({"id": sid, "name": label, "languages": [locale],
                       "gender": "female" if prefix[1] == "f" else "male", "region": region})
    if not voices or len({v["id"] for v in voices}) != len(voices):
        raise ValueError("Provider voice metadata is missing or ambiguous")
    return voices


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directory", type=Path)
    parser.add_argument("--kind", choices=["stt", "tts", "both"], default="both")
    parser.add_argument("--runtime", type=Path)
    parser.add_argument("--languages", nargs="+", choices=["en", "zh"], default=["en", "zh"])
    parser.add_argument("--kokoro-version", choices=["v1_0", "v1_1"], default="v1_0")
    parser.add_argument("--precision", choices=["fp32", "int8"], default="fp32")
    args = parser.parse_args()
    args.directory.mkdir(parents=True, exist_ok=True)
    if args.runtime:
        progress("runtime")
        npm = shutil.which("npm")
        if not npm:
            raise RuntimeError("Node.js and npm are required to install local speech")
        fingerprint = hashlib.sha256((args.runtime / "package-lock.json").read_bytes()).hexdigest()
        marker = args.runtime / ".installed-lock"
        if not marker.exists() or marker.read_text() != fingerprint or not (args.runtime / "node_modules").is_dir():
            subprocess.run([npm, "ci", "--no-audit", "--no-fund"], cwd=args.runtime,
                           stdout=sys.stderr, stderr=sys.stderr, check=True)
            marker.write_text(fingerprint)

    for language in (args.languages if args.kind != "tts" else []):
        model, name, locale = (
            ("vosk-model-small-en-us-0.15", "Vosk English (US), small", "en-US")
            if language == "en" else ("vosk-model-small-cn-0.22", "Vosk Chinese, small", "zh-CN")
        )
        directory = install(args.directory, model, BASE + model + ".zip")
        (directory / "voice-model.json").write_text(json.dumps({
            "kind": "stt", "name": name, "languages": [locale], "sourceUrl": BASE,
        }, indent=2) + "\n", encoding="utf-8")
    if args.kind == "stt":
        progress("complete")
        return
    model_id = KOKORO.format(precision="int8-" if args.precision == "int8" else "") + args.kokoro_version
    source_url = KOKORO_SOURCE + args.kokoro_version + ".html"
    directory = install(args.directory, model_id,
        "https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/" + model_id + ".tar.bz2")
    with urllib.request.urlopen(source_url, timeout=30) as response:
        voices = voice_metadata(response.read().decode())
    (directory / "voice-model.json").write_text(json.dumps({
        "kind": "tts", "name": "Kokoro " + args.kokoro_version.replace("_", ".") + " " + args.precision.upper(), "languages": sorted({locale for voice in voices for locale in voice["languages"]}),
        "sourceUrl": source_url, "voices": voices,
        "kokoro": {"model": "model.int8.onnx" if args.precision == "int8" else "model.onnx", "voices": "voices.bin", "tokens": "tokens.txt",
                   "dataDir": "espeak-ng-data", "lexicon": "lexicon-us-en.txt,lexicon-zh.txt", "dictDir": "dict"},
    }, indent=2) + "\n", encoding="utf-8")
    progress("complete")


if __name__ == "__main__":
    if sys.version_info < (3, 12):
        raise RuntimeError("Python 3.12 or newer is required")
    if len(sys.argv) < 2 or sys.argv[1].startswith("-"):
        main()
    else:
        root = Path(sys.argv[1])
        root.mkdir(parents=True, exist_ok=True)
        with (root / ".install.lock").open("a+b") as lock:
            if sys.platform == "win32":
                import msvcrt
                lock.write(b"0")
                lock.flush()
                lock.seek(0)
                msvcrt.locking(lock.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            main()

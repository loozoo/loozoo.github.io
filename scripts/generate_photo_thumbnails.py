#!/usr/bin/env python
"""Keep images/photos-thumb/ in sync with images/photos/.

Run manually after adding/replacing/deleting photos:
    python scripts/generate_photo_thumbnails.py

Also runs automatically in CI (see .github/workflows/photo-thumbnails.yml)
on every push that touches images/photos/**.

Sync is based on a content hash (scripts/.thumbnail-manifest.json), not file
mtime, so it correctly detects a photo replaced under the same filename even
after a fresh git checkout (which resets mtimes). Thumbnails whose source
photo no longer exists are deleted automatically.
"""
import hashlib
import json
import sys
from pathlib import Path

from PIL import Image, ImageOps

MAX_DIM = 640
JPEG_QUALITY = 72
FORMATS = {".jpg": "JPEG", ".jpeg": "JPEG", ".png": "PNG", ".webp": "WEBP"}

ROOT = Path(__file__).resolve().parent.parent
SRC_DIR = ROOT / "images" / "photos"
DST_DIR = ROOT / "images" / "photos-thumb"
MANIFEST_PATH = Path(__file__).resolve().parent / ".thumbnail-manifest.json"


def file_hash(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def load_manifest():
    if MANIFEST_PATH.exists():
        return json.loads(MANIFEST_PATH.read_text())
    return {}


def save_manifest(manifest):
    MANIFEST_PATH.write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n")


def make_thumbnail(src, dst):
    fmt = FORMATS[src.suffix.lower()]
    with Image.open(src) as img:
        icc_profile = img.info.get("icc_profile")
        img = ImageOps.exif_transpose(img)
        img.thumbnail((MAX_DIM, MAX_DIM), Image.LANCZOS)
        save_kwargs = {"optimize": True, "icc_profile": icc_profile}
        if fmt == "JPEG":
            img = img.convert("RGB")
            save_kwargs["quality"] = JPEG_QUALITY
        elif fmt == "WEBP":
            save_kwargs["quality"] = JPEG_QUALITY
        img.save(dst, fmt, **save_kwargs)


def generate(force=False):
    DST_DIR.mkdir(parents=True, exist_ok=True)
    manifest = {} if force else load_manifest()
    sources = sorted(
        p for p in SRC_DIR.iterdir()
        if p.is_file() and p.suffix.lower() in FORMATS
    )
    source_names = {p.name for p in sources}

    created, updated, skipped = 0, 0, 0
    for src in sources:
        digest = file_hash(src)
        dst = DST_DIR / src.name
        if manifest.get(src.name, {}).get("hash") == digest and dst.exists():
            skipped += 1
            continue

        existed = dst.exists()
        make_thumbnail(src, dst)
        manifest[src.name] = {"hash": digest}
        if existed:
            updated += 1
            print(f"updated  {src.name}: {src.stat().st_size // 1024}KB -> {dst.stat().st_size // 1024}KB")
        else:
            created += 1
            print(f"created  {src.name}: {src.stat().st_size // 1024}KB -> {dst.stat().st_size // 1024}KB")

    removed = 0
    for name in list(manifest):
        if name not in source_names:
            stale = DST_DIR / name
            if stale.exists():
                stale.unlink()
            del manifest[name]
            removed += 1
            print(f"removed  {name} (source photo deleted)")

    save_manifest(manifest)
    print(f"done: {created} created, {updated} updated, {removed} removed, {skipped} unchanged")


if __name__ == "__main__":
    generate(force="--force" in sys.argv)

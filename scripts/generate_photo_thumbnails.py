#!/usr/bin/env python
"""Keep images/photos-thumb/ and _data/photos.yml in sync with images/photos/.

Run manually after adding/replacing/deleting photos:
    python scripts/generate_photo_thumbnails.py

Also runs automatically in CI (see .github/workflows/photo-thumbnails.yml)
on every push that touches images/photos/**.

Sync is based on a content hash (scripts/.thumbnail-manifest.json), not file
mtime, so it correctly detects a photo replaced under the same filename even
after a fresh git checkout (which resets mtimes). Thumbnails whose source
photo no longer exists are deleted automatically.

Alongside thumbnails, this also keeps _data/photos.yml (the per-photo
metadata used by the gallery/map on /photos/) in sync: `date` and `lat`/`lng`
are auto-filled from EXIF (GPS tags, when present) the first time a photo is
seen, or whenever they're still unset. `caption` and `location` are never
touched by this script -- they're written by hand. Entries for deleted
photos are removed automatically, same as their thumbnails.
"""
import hashlib
import json
import sys
from pathlib import Path

import yaml
from PIL import Image, ImageOps

MAX_DIM = 640
JPEG_QUALITY = 72
FORMATS = {".jpg": "JPEG", ".jpeg": "JPEG", ".png": "PNG", ".webp": "WEBP"}
GPS_IFD_TAG = 0x8825
EXIF_IFD_TAG = 0x8769
DATETIME_ORIGINAL_TAG = 36867

ROOT = Path(__file__).resolve().parent.parent
SRC_DIR = ROOT / "images" / "photos"
DST_DIR = ROOT / "images" / "photos-thumb"
MANIFEST_PATH = Path(__file__).resolve().parent / ".thumbnail-manifest.json"
PHOTOS_DATA_PATH = ROOT / "_data" / "photos.yml"
PHOTOS_DATA_HEADER = (
    "# Per-photo metadata for the gallery/map on /photos/.\n"
    "# `date` and `lat`/`lng` are auto-filled from EXIF by\n"
    "# scripts/generate_photo_thumbnails.py (only when unset -- edits here are\n"
    "# preserved). `caption` and `location` are always written by hand.\n"
)


def file_hash(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def load_manifest():
    if MANIFEST_PATH.exists():
        return json.loads(MANIFEST_PATH.read_text())
    return {}


def save_manifest(manifest):
    MANIFEST_PATH.write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n")


def load_photos_data():
    if PHOTOS_DATA_PATH.exists():
        return yaml.safe_load(PHOTOS_DATA_PATH.read_text()) or {}
    return {}


def save_photos_data(data):
    PHOTOS_DATA_PATH.parent.mkdir(parents=True, exist_ok=True)
    body = yaml.dump(data, sort_keys=True, allow_unicode=True) if data else ""
    PHOTOS_DATA_PATH.write_text(PHOTOS_DATA_HEADER + "\n" + body)


def dms_to_decimal(dms, ref):
    degrees, minutes, seconds = (float(v) for v in dms)
    decimal = degrees + minutes / 60 + seconds / 3600
    return round(-decimal if ref in ("S", "W") else decimal, 6)


def read_exif_metadata(path):
    """Best-effort (date, lat, lng) from EXIF; any field may come back None."""
    date, lat, lng = None, None, None
    try:
        with Image.open(path) as img:
            exif = img.getexif()
            exif_ifd = exif.get_ifd(EXIF_IFD_TAG)
            raw_date = exif_ifd.get(DATETIME_ORIGINAL_TAG) or exif.get(306)
            if raw_date:
                date = raw_date.split(" ")[0].replace(":", "-")

            gps = exif.get_ifd(GPS_IFD_TAG)
            if gps.get(2) and gps.get(4):
                lat = dms_to_decimal(gps[2], gps.get(1, "N"))
                lng = dms_to_decimal(gps[4], gps.get(3, "E"))
    except Exception:
        pass
    return date, lat, lng


def sync_photos_data(source_names):
    data = load_photos_data()

    for name in source_names:
        entry = data.setdefault(name, {})
        if entry.get("date") and entry.get("lat") is not None:
            continue
        date, lat, lng = read_exif_metadata(SRC_DIR / name)
        entry.setdefault("caption", None)
        entry.setdefault("location", None)
        if entry.get("date") is None:
            entry["date"] = date
        if entry.get("lat") is None:
            entry["lat"] = lat
        if entry.get("lng") is None:
            entry["lng"] = lng

    for name in list(data):
        if name not in source_names:
            del data[name]

    save_photos_data(data)


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
    sync_photos_data(source_names)
    print(f"done: {created} created, {updated} updated, {removed} removed, {skipped} unchanged")


if __name__ == "__main__":
    generate(force="--force" in sys.argv)

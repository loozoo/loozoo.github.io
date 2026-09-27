#!/usr/bin/env python
"""Precompute the "Chromatic Geography" data on /photos/.

Run automatically by .github/workflows/photo-thumbnails.yml whenever gallery
photos (or their captions/visibility) change. To run it by hand:
    python -m pip install -r scripts/requirements-chromatic.txt   # once
    python scripts/chromatic_analysis.py

Writes assets/data/chromatic-analysis.json, which the page fetches as a plain
static file -- GitHub Pages never runs any of this. Commit the JSON.

Pipeline (all offline):
  1. Photos are the same set the gallery shows: images/photos/*, minus any
     marked `visible: false` in _data/photos.yml.
  2. Each photo is EXIF-rotated, downsampled, and a deterministic sample of
     its opaque pixels is converted to CIELAB.
  3. MiniBatchKMeans on the pooled samples gives K global colour centres
     c_1..c_K shared by every photo; each photo becomes a histogram mu_i on
     those centres (a probability vector).
  4. D_ij = W_1(mu_i, mu_j), the exact 1-Wasserstein / Earth Mover's distance
     with ground cost ||c_a - c_b||_2 in Lab (POT's network-simplex ot.emd2).
  5. Classical MDS: B = -1/2 J (D o D) J with J = I - 11^T/N, B = V L V^T.
     Mode k's coordinates are sqrt(l_k) v_k for each positive eigenvalue l_k;
     modes 1-2 are the map. W_1 need not be Euclidean, so B can have negative
     eigenvalues -- they're reported, not hidden.

Deterministic: fixed seeds, eigenvector signs fixed (largest-magnitude entry
positive), floats rounded, no timestamps -- unchanged photos give an
unchanged JSON.
"""
import json
import sys
import warnings
import zlib
from pathlib import Path

import numpy as np
import ot
import yaml
from PIL import Image, ImageOps
from skimage.color import lab2rgb, rgb2lab
from sklearn.cluster import MiniBatchKMeans

SEED = 42
N_CENTRES = 64
PIXELS_PER_PHOTO = 5000
CODEBOOK_PIXELS = 180000
ANALYSIS_MAX_DIM = 256   # px on the long side before sampling
N_NEIGHBOURS = 5
N_MODES = 12             # modes exported (coordinates + extremes)
N_EXTREMES = 4           # photos saved at each end of a mode
PALETTE_SIZE = 8         # top codebook colours saved per photo

ROOT = Path(__file__).resolve().parent.parent
SRC_DIR = ROOT / "images" / "photos"
THUMB_DIR = ROOT / "images" / "photos-thumb"
PHOTOS_DATA_PATH = ROOT / "_data" / "photos.yml"
OUT_PATH = ROOT / "assets" / "data" / "chromatic-analysis.json"
EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}


def warn(msg):
    print(f"warning: {msg}", file=sys.stderr)


def gallery_photos():
    """Same selection/order as _pages/photos.html: visible files, name descending."""
    meta = {}
    if PHOTOS_DATA_PATH.exists():
        meta = yaml.safe_load(PHOTOS_DATA_PATH.read_text(encoding="utf-8")) or {}
    files = sorted(
        (p for p in SRC_DIR.iterdir() if p.suffix.lower() in EXTENSIONS),
        key=lambda p: p.name, reverse=True,
    )
    return [(p, meta.get(p.name) or {}) for p in files
            if (meta.get(p.name) or {}).get("visible") is not False]


def sample_lab(path):
    """Deterministic sample of up to PIXELS_PER_PHOTO opaque pixels, in Lab."""
    with Image.open(path) as img:
        img.draft("RGB", (ANALYSIS_MAX_DIM * 2, ANALYSIS_MAX_DIM * 2))  # fast JPEG downscale
        img = ImageOps.exif_transpose(img)
        img = img.convert("RGBA")  # handles greyscale, palette and alpha alike
        img.thumbnail((ANALYSIS_MAX_DIM, ANALYSIS_MAX_DIM), Image.Resampling.LANCZOS)
        px = np.asarray(img, dtype=np.float64).reshape(-1, 4)
    px = px[px[:, 3] >= 128, :3] / 255.0  # drop (mostly) transparent pixels
    if len(px) == 0:
        raise ValueError("no opaque pixels")
    rng = np.random.default_rng([SEED, zlib.crc32(path.name.encode())])
    if len(px) > PIXELS_PER_PHOTO:
        px = px[np.sort(rng.choice(len(px), PIXELS_PER_PHOTO, replace=False))]
    return rgb2lab(px[None, :, :])[0]


def lab_to_hex(lab):
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")  # out-of-gamut clipping warnings
        rgb = lab2rgb(np.asarray(lab, dtype=np.float64).reshape(1, 1, 3))[0, 0]
    return "#" + "".join(f"{int(round(v * 255)):02x}" for v in np.clip(rgb, 0, 1))


def r(x, digits=6):
    """Round for stable, compact JSON (significant digits)."""
    return float(f"{float(x):.{digits}g}")


def main():
    photos = gallery_photos()
    samples, kept = [], []
    for path, meta in photos:
        try:
            samples.append(sample_lab(path))
            kept.append((path, meta))
        except Exception as exc:
            warn(f"skipping {path.name}: could not read it ({exc})")
    n = len(kept)
    if n < 3:
        sys.exit(f"error: need at least 3 readable photos, found {n}")
    print(f"{n} photos ({len(photos) - n} unreadable)")

    # Global colour codebook.
    pooled = np.concatenate(samples)
    rng = np.random.default_rng(SEED)
    if len(pooled) > CODEBOOK_PIXELS:
        pooled = pooled[np.sort(rng.choice(len(pooled), CODEBOOK_PIXELS, replace=False))]
    k = min(N_CENTRES, len(pooled))
    km = MiniBatchKMeans(n_clusters=k, random_state=SEED, batch_size=4096, n_init=5,
                         max_iter=300).fit(pooled)
    # Order centres canonically (by L, a, b) so the codebook itself is stable.
    order = np.lexsort(km.cluster_centers_.T[::-1])
    centres = km.cluster_centers_[order]
    km.cluster_centers_ = centres

    # Per-photo histograms on the shared support.
    hists = np.zeros((n, k))
    for i, s in enumerate(samples):
        hists[i] = np.bincount(km.predict(s), minlength=k)
    hists /= hists.sum(axis=1, keepdims=True)
    assert np.allclose(hists.sum(axis=1), 1.0)

    # Exact 1-Wasserstein distances (network simplex, 64x64 plans -- fast).
    cost = ot.dist(centres, centres, metric="euclidean")
    D = np.zeros((n, n))
    for i in range(n):
        for j in range(i + 1, n):
            D[i, j] = D[j, i] = ot.emd2(hists[i], hists[j], cost, numItermax=1_000_000)
    assert np.allclose(D, D.T) and np.allclose(np.diag(D), 0)
    assert np.all(D >= -1e-9)

    # Classical MDS.
    J = np.eye(n) - np.ones((n, n)) / n
    B = -0.5 * J @ (D * D) @ J
    B = (B + B.T) / 2  # symmetric up to rounding already; make it exact
    evals, evecs = np.linalg.eigh(B)
    idx = np.argsort(evals)[::-1]
    evals, evecs = evals[idx], evecs[:, idx]
    assert np.all(np.diff(evals) <= 1e-9)
    # Deterministic sign: largest-magnitude entry of each eigenvector positive.
    signs = np.sign(evecs[np.argmax(np.abs(evecs), axis=0), np.arange(n)])
    evecs *= np.where(signs == 0, 1, signs)

    # One eigenvalue is ~0 (the centring kills the all-ones direction);
    # anything below this tolerance counts as zero rather than +/-.
    tol = 1e-9 * max(abs(evals).max(), 1e-12)
    pos = evals > tol
    neg = evals < -tol
    n_pos = int(pos.sum())
    if n_pos < 2:
        sys.exit("error: fewer than two positive eigenvalues; nothing to map")
    coords = evecs[:, :n_pos] * np.sqrt(evals[:n_pos])
    assert np.all(np.isfinite(coords))

    pos_mass = evals[pos].sum()
    neg_mass = -evals[neg].sum()
    capture_2d = (evals[0] + evals[1]) / pos_mass
    # Kruskal stress-1 of the 2D map against the original distances.
    X2 = coords[:, :2]
    iu = np.triu_indices(n, 1)
    d2 = np.linalg.norm(X2[:, None] - X2[None], axis=-1)[iu]
    stress = np.sqrt(((D[iu] - d2) ** 2).sum() / (D[iu] ** 2).sum())

    # Photo records.
    ids = [p.name for p, _ in kept]
    mean_lab = [s.mean(axis=0) for s in samples]
    n_modes = min(N_MODES, n_pos)
    records = []
    for i, (path, meta) in enumerate(kept):
        others = [j for j in np.argsort(D[i], kind="stable") if j != i][:N_NEIGHBOURS]
        top = np.argsort(-hists[i], kind="stable")[:PALETTE_SIZE]
        thumb = THUMB_DIR / path.name
        if not thumb.exists():
            warn(f"{path.name} has no thumbnail in images/photos-thumb/; using the full image")
        records.append({
            "id": path.name,
            "src": f"/images/photos/{path.name}",
            "thumb": f"/images/photos-thumb/{path.name}" if thumb.exists() else f"/images/photos/{path.name}",
            "title": meta.get("caption") or None,
            "location": meta.get("location") or None,
            "average_hex": lab_to_hex(mean_lab[i]),
            "palette": [[lab_to_hex(centres[c]), r(hists[i, c], 4)] for c in top if hists[i, c] > 0],
            "x": r(coords[i, 0]),
            "y": r(coords[i, 1]),
            "modes": [r(v) for v in coords[i, :n_modes]],
            "mean_distance": r(D[i].sum() / (n - 1)),
            "nearest": [{"id": ids[j], "distance": r(D[i, j], 4)} for j in others],
        })

    modes = []
    for m in range(n_modes):
        o = np.argsort(coords[:, m], kind="stable")
        modes.append({
            "index": m + 1,
            "eigenvalue": r(evals[m]),
            "share_of_positive_mass": r(evals[m] / pos_mass, 4),
            "low": [ids[j] for j in o[:N_EXTREMES]],
            "high": [ids[j] for j in o[::-1][:N_EXTREMES]],
        })

    Dm = D + np.diag(np.full(n, np.inf))
    ci, cj = np.unravel_index(np.argmin(Dm), D.shape)
    fi, fj = np.unravel_index(np.argmax(D), D.shape)
    iso = int(np.argmax(D.sum(axis=1)))

    out = {
        "method": {
            "colour_space": "CIELAB (D65, from sRGB)",
            "colour_centres": int(k),
            "pixels_per_photo": PIXELS_PER_PHOTO,
            "codebook": "MiniBatchKMeans on pooled Lab samples",
            "distance": "1-Wasserstein / Earth Mover's Distance (exact, network simplex)",
            "ground_cost": "Euclidean distance in Lab",
            "embedding": "classical multidimensional scaling",
            "seed": SEED,
        },
        "diagnostics": {
            "photo_count": n,
            "positive_eigenvalues": n_pos,
            "negative_eigenvalues": int(neg.sum()),
            "positive_spectral_mass_2d": r(capture_2d, 4),
            "stress_2d": r(stress, 4),
            "negative_eigenvalue_mass": r(neg_mass / (pos_mass + neg_mass), 4),
            "most_negative_eigenvalue": r(evals[-1]) if neg.any() else 0.0,
            "most_negative_over_first": r(-evals[-1] / evals[0], 4) if neg.any() else 0.0,
        },
        "spectrum": {"eigenvalues": [r(v) for v in evals]},
        "modes": modes,
        "closest_pair": {"ids": [ids[ci], ids[cj]], "distance": r(D[ci, cj], 4)},
        "furthest_pair": {"ids": [ids[fi], ids[fj]], "distance": r(D[fi, fj], 4)},
        "most_distinct": {"id": ids[iso], "mean_distance": r(D[iso].sum() / (n - 1), 4)},
        "photos": records,
    }

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps(out, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")

    dg = out["diagnostics"]
    print(f"D: {n}x{n}, W1 range {D[iu].min():.2f}-{D[iu].max():.2f} (Lab units)")
    print("leading eigenvalues:", ", ".join(f"{v:.1f}" for v in evals[:6]))
    print(f"positive/negative eigenvalues: {n_pos}/{dg['negative_eigenvalues']}, "
          f"negative mass {dg['negative_eigenvalue_mass']:.1%}")
    print(f"2D spectral capture {capture_2d:.1%}, stress {stress:.3f}")
    print(f"wrote {OUT_PATH.relative_to(ROOT)}")


if __name__ == "__main__":
    main()

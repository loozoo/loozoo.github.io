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
  3. Each photo gets its own colour signature: KMeans on its own samples
     (COLOURS_PER_PHOTO clusters), then any two clusters closer than MERGE_DE
     (Delta E*ab) merged into one, repeatedly -- so a sky is one blue, not
     three near-identical ones. mu_i is the resulting set of colours with
     their pixel shares. (Earlier versions used one codebook shared by the
     whole gallery; its colours followed the gallery's most common pixels,
     so a colour prominent in only one photo -- purple flowers, a red door
     -- had no centre of its own and was counted as some duller neighbour.)
  4. D_ij = W_1(mu_i, mu_j), the exact 1-Wasserstein / Earth Mover's distance
     between the two signatures, with ground cost ||c_a - c_b||_2 in Lab
     between photo i's colours and photo j's (POT's network-simplex ot.emd2).
     Each photo's palette is its signature's largest colours -- distinct by
     construction, so an accent isn't crowded out by shades of one sky.
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
from sklearn.cluster import KMeans

SEED = 42
COLOURS_PER_PHOTO = 20   # KMeans clusters per photo, before merging
MERGE_DE = 10.0          # clusters closer than this (Delta E*ab) become one colour
PALETTE_MERGE_DE = 18.0  # ...and for the palette shown, closer than this
ACCENT_SLOTS = 2         # palette places kept for small but colourful accents
ACCENT_MIN_SHARE = 0.01  # an accent covers at least this much of the photo
ACCENT_MIN_CHROMA = 15.0 # ...and is at least this colourful (C*ab)
ACCENT_HUE_GAP = 25.0    # degrees of hue within which one colour stands in for another
PIXELS_PER_PHOTO = 5000
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


def colour_signature(lab, name):
    """A photo's own colours: (centres, weights), largest share first.

    KMeans on the photo's Lab samples, then the closest pair of clusters is
    merged while any pair is nearer than MERGE_DE. A merged centre is the
    share-weighted mean of the two -- exactly the mean of their pixels,
    since each centre is the mean of its own.
    """
    k = min(COLOURS_PER_PHOTO, len(np.unique(lab.round(1), axis=0)))
    seed = (SEED + zlib.crc32(name.encode())) % (2 ** 32)
    km = KMeans(n_clusters=k, random_state=seed, n_init=4).fit(lab)
    w = np.bincount(km.labels_, minlength=k) / len(lab)
    keep = w > 0  # drop any cluster KMeans left empty
    return merge_close(km.cluster_centers_[keep], w[keep], MERGE_DE)


def merge_close(centres, weights, threshold):
    """Merge the closest pair of colours while any pair is nearer than
    threshold (Delta E*ab); largest share first."""
    centres, weights = [c for c in centres], list(weights)
    while len(centres) > 1:
        C = np.asarray(centres)
        d = np.linalg.norm(C[:, None] - C[None], axis=-1)
        np.fill_diagonal(d, np.inf)
        a, b = np.unravel_index(np.argmin(d), d.shape)
        if d[a, b] >= threshold:
            break
        wa, wb = weights[a], weights[b]
        centres[a] = (centres[a] * wa + centres[b] * wb) / (wa + wb)
        weights[a] = wa + wb
        del centres[b], weights[b]
    C, w = np.asarray(centres), np.asarray(weights)
    # Largest share first; ties broken by (L, a, b) so the order is stable.
    order = np.lexsort((C[:, 2], C[:, 1], C[:, 0], -w))
    C, w = C[order], w[order]
    return C, w / w.sum()


def chroma(lab):
    return np.hypot(lab[..., 1], lab[..., 2])


def palette_of(C, w):
    """The colours shown for a photo: its main colours plus its accents.

    Main colours: the signature merged further (PALETTE_MERGE_DE), so the
    ring shows distinct colours rather than steps of one sky. Accents: of
    the signature's small colours (>= ACCENT_MIN_SHARE, >= ACCENT_MIN_CHROMA)
    that no main colour stands in for, those whose hue is furthest from
    every main colour's. The eye goes to purple wisteria or pink blossom
    however few pixels they cover, but by area alone they'd be merged into
    a grey or ranked out of the palette. Judged by hue angle rather than
    Delta E, which is mostly lightness and chroma: a grey is "near" a pink
    in Delta E, never in hue. Largest share first.
    """
    def hue(c):
        return np.degrees(np.arctan2(c[..., 2], c[..., 1])) % 360

    def hue_gap(h, hs):
        d = np.abs(hs - h) % 360
        return np.minimum(d, 360 - d)

    # Only the main colours that fit in the palette alongside the accents
    # can stand in for one (a small pink can survive the merge as its own
    # colour and still be ranked out by area), and only colourful ones.
    main, _ = merge_close(C, w, PALETTE_MERGE_DE)
    main = main[:PALETTE_SIZE - ACCENT_SLOTS]
    main = main[chroma(main) >= ACCENT_MIN_CHROMA * 2 / 3]
    main_h, main_c = hue(main), chroma(main)

    def represented(c):
        # A main colour of much the same hue, nearly as colourful.
        return np.any((hue_gap(hue(c), main_h) < ACCENT_HUE_GAP) & (main_c >= 0.6 * chroma(c)))

    def novelty(c):
        return hue_gap(hue(c), main_h).min() if len(main) else 180.0

    cand = [i for i in range(len(w))
            if w[i] >= ACCENT_MIN_SHARE and chroma(C[i]) >= ACCENT_MIN_CHROMA
            and not represented(C[i])]
    # Most novel hue first, then the more colourful.
    cand.sort(key=lambda i: (-novelty(C[i]), -chroma(C[i])))
    accents = []
    for i in cand:  # each a different hue from the last
        if len(accents) < ACCENT_SLOTS and all(hue_gap(hue(C[i]), hue(C[j])) >= ACCENT_HUE_GAP for j in accents):
            accents.append(i)
    rest = np.ones(len(w), bool)
    rest[accents] = False
    # The main colours without the accents' pixels, so nothing counts twice.
    mc, mw = merge_close(C[rest], w[rest], PALETTE_MERGE_DE)
    mw = mw * w[rest].sum()  # back to shares of the whole photo
    keep = PALETTE_SIZE - len(accents)
    cols = list(mc[:keep]) + [C[i] for i in accents]
    shares = list(mw[:keep]) + [w[i] for i in accents]
    order = np.argsort(-np.asarray(shares), kind="stable")
    return [cols[i] for i in order], [shares[i] for i in order]


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

    # Each photo's own colour signature.
    sigs = [colour_signature(s, path.name) for s, (path, _) in zip(samples, kept)]
    for C, w in sigs:
        assert np.isclose(w.sum(), 1.0) and np.all(w > 0)
    sizes = [len(w) for _, w in sigs]
    print(f"colours per photo after merging: {min(sizes)}-{max(sizes)}, "
          f"median {int(np.median(sizes))}")

    # Exact 1-Wasserstein distances between signatures (network simplex on
    # at most 20x20 plans -- fast).
    D = np.zeros((n, n))
    for i in range(n):
        for j in range(i + 1, n):
            cost = ot.dist(sigs[i][0], sigs[j][0], metric="euclidean")
            D[i, j] = D[j, i] = ot.emd2(sigs[i][1], sigs[j][1], cost, numItermax=1_000_000)
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
        pal_c, pal_w = palette_of(*sigs[i])
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
            "palette": [[lab_to_hex(c), r(w, 4)] for c, w in zip(pal_c, pal_w)],
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
            "colours_per_photo": COLOURS_PER_PHOTO,
            "merge_delta_e": MERGE_DE,
            "pixels_per_photo": PIXELS_PER_PHOTO,
            "signatures": "per-photo KMeans on Lab samples, clusters nearer than merge_delta_e merged",
            "palette": (f"signature merged below Delta E {PALETTE_MERGE_DE:g}, plus up to {ACCENT_SLOTS} "
                        f"accents (>= {ACCENT_MIN_SHARE:.0%} share, C >= {ACCENT_MIN_CHROMA:g}, hue >= "
                        f"{ACCENT_HUE_GAP:g} deg from the main colours'); {PALETTE_SIZE} colours at most"),
            "distance": "1-Wasserstein / Earth Mover's Distance between signatures (exact, network simplex)",
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
        # Below tol is rounding noise (it flips sign between runs): write it as 0.
        "spectrum": {"eigenvalues": [r(v) if abs(v) > tol else 0.0 for v in evals]},
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

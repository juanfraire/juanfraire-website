#!/usr/bin/env python3
"""Copy, resize and strip the site's images and data from their sources.

Every web asset is derived from a file elsewhere on this machine; this script
records where each one comes from, so swapping an image means editing one
entry and re-running. Outputs are committed; the site has no build step.

    python3 scripts/make_assets.py

Needs Pillow and numpy. Saving through Pillow drops EXIF and other metadata.
"""
from pathlib import Path
import csv
import json
import random
import shutil

import numpy as np
from PIL import Image, ImageDraw

SITE = Path(__file__).resolve().parent.parent
DRIVE = Path("/Users/jfraire/My Drive")
CODE = Path("/Users/jfraire/Documents/Code")
CV = DRIVE / "var/0000-00-cv"
SLIDE = CV / "presentation-slide/assets"
IMG = SITE / "assets/img"
DATA = SITE / "data"

# Topic panels from the intro slide (already cropped and graded by its make-assets.py).
PANELS = {
    "p1-dtn": SLIDE / "p1-dtn.jpg",
    "p2-iot": SLIDE / "p2-dtsiot.jpg",
    "p3-mega": SLIDE / "p3-mega.jpg",
    "p4-orbital": SLIDE / "p4-orbital.jpg",
}

# Wide topic-page heroes: name -> (source, layout or None). With a layout, the source is
# placed on a 16:9 canvas so its subject sits on the right, clear of the title:
# cx, cy = subject centre (fractions of the source), at = where it lands (fraction of the
# canvas width), scale = canvas height / source height, blackout = boxes to erase (source px),
# mirror = fill the margins with a starfield patch from the source corner instead of black.
HEROES = {
    "orbital-hero": (CODE / "tessera/video/odc-constellation-background/out/deck/jpg/a1-ring-right.jpg", None),
    # the same sources as the intro-slide panels 1 to 3
    "dtn-hero": (CODE / "ipn-v/documentation/mars-earth-network.png",
                 dict(cx=0.497, cy=0.47, at=0.68, scale=1.0,
                      blackout=[(1300, 1020, 1560, 1105), (0, 400, 280, 520), (850, 455, 935, 505)])),  # HUD, "Mercury", "Earth"
    "iot-hero": (DRIVE / "inria/0000-oo-old/0000-00-phd-insa-diego/g21985.png",
                 dict(cx=0.5, cy=0.5, at=0.75, scale=1.5, blackout=[], mirror=False)),
    "mega-hero": (CODE / "tessera/video/odc-constellation-v1/out/still_f0120_hero.png",
                  dict(cx=0.5, cy=0.5, at=0.72, scale=1.3, blackout=[])),
}

PHOTO = CV / "jfraire-profile-2-byn.jpg"          # 2023 portrait, black and white
ASTRONAUT = CV / "jfraire-profile-fun-1.jpeg"     # cartoon, used on the 404 page
OG_SOURCE = CV / "presentation-slide/intro-slide.png"

# Solar System Scope 2k maps (CC BY 4.0), as bundled with Contact Plan Designer.
TEXTURES = {
    "earth-day.jpg": (CODE / "cpd/contact-plan-designer/web/assets/planets/earth.jpg", 2048, 80),
    "earth-night.jpg": (CODE / "cpd/contact-plan-designer/web/assets/planets/earth_nightmap.jpg", 2048, 80),
    "mars.jpg": (CODE / "cpd/contact-plan-designer/web/assets/planets/mars.jpg", 2048, 72),
}

IPNV_DSN_CSV = CODE / "ipn-v/ipn-d/Assets/Data/input/network/dsn-network.csv"
ODC_SHELLS = CODE / "tessera/video/odc-constellation-v1/orbits/constellation.json"


def save_pair(im, stem, quality=82, webp_quality=78):
    """Write stem.jpg and stem.webp side by side."""
    im = im.convert("RGB")
    im.save(stem.with_suffix(".jpg"), quality=quality, optimize=True, progressive=True)
    im.save(stem.with_suffix(".webp"), quality=webp_quality, method=6)


def fit_width(im, width):
    if im.width <= width:
        return im
    return im.resize((width, round(im.height * width / im.width)), Image.LANCZOS)


def panels():
    out = IMG / "panels"
    out.mkdir(parents=True, exist_ok=True)
    for name, src in PANELS.items():
        save_pair(Image.open(src), out / name)
        print("panel ", name, "<-", src.name)


def place_on_canvas(src, cx, cy, at, scale, blackout, mirror=True):
    """Put the subject of `src` at `at` across a 16:9 canvas, filling the margins."""
    im = Image.open(src)
    if im.mode in ("RGBA", "LA", "P"):
        im = im.convert("RGBA")
        flat = Image.new("RGB", im.size, (0, 0, 0))
        flat.paste(im, mask=im.split()[-1])
        im = flat
    im = im.convert("RGB")
    draw = ImageDraw.Draw(im)
    for box in blackout:
        draw.rectangle(box, fill=(0, 0, 0))
    src_arr = np.asarray(im)
    w, h = im.size
    ch = round(h * scale)
    cw = round(ch * 16 / 9)
    x0, y0 = round(at * cw - cx * w), round(ch / 2 - cy * h)    # where the source lands
    if mirror:
        # Fill the canvas with the empty top-left corner of the source (a patch of stars),
        # tiled with alternating flips so it does not repeat visibly.
        patch = src_arr[: h * 3 // 10, : w // 4]
        row = np.concatenate([patch, patch[:, ::-1]] * (cw // (2 * patch.shape[1]) + 1), axis=1)
        canvas = np.concatenate([row, row[::-1]] * (ch // (2 * patch.shape[0]) + 1), axis=0)[:ch, :cw].copy()
    else:
        canvas = np.zeros((ch, cw, 3), dtype=np.uint8)
    sx0, sy0 = max(-x0, 0), max(-y0, 0)
    sx1, sy1 = min(w, cw - x0), min(h, ch - y0)
    canvas[sy0 + y0:sy1 + y0, sx0 + x0:sx1 + x0] = src_arr[sy0:sy1, sx0:sx1]
    return Image.fromarray(canvas).resize((1600, 900), Image.LANCZOS)


def heroes():
    out = IMG / "topics"
    out.mkdir(parents=True, exist_ok=True)
    for name, (src, layout) in HEROES.items():
        im = place_on_canvas(src, **layout) if layout else fit_width(Image.open(src), 1600)
        save_pair(im, out / name, quality=80, webp_quality=74)
        print("hero  ", name, "<-", src.name)


def logos():
    out = IMG / "logos"
    out.mkdir(parents=True, exist_ok=True)
    for src in sorted((SLIDE / "logos").iterdir()):
        if src.suffix in {".svg", ".png"}:
            shutil.copy(src, out / src.name)
    print("logos  <-", SLIDE / "logos")


def photos():
    out = IMG / "photo"
    out.mkdir(parents=True, exist_ok=True)
    im = Image.open(PHOTO).convert("RGB")
    # 4:5 head-and-shoulders crop for the site; the full file is the press download.
    w = im.width
    save_pair(im.crop((0, 0, w, round(w * 5 / 4))).resize((560, 700), Image.LANCZOS),
              out / "juan-a-fraire")
    im.save(out / "juan-a-fraire-press.jpg", quality=90, optimize=True, progressive=True)
    save_pair(Image.open(ASTRONAUT).resize((480, 480), Image.LANCZOS), out / "astronaut")
    print("photo  <-", PHOTO.name, "+", ASTRONAUT.name)


def og_image():
    im = Image.open(OG_SOURCE).convert("RGB")
    im = im.resize((1200, round(im.height * 1200 / im.width)), Image.LANCZOS)
    top = (im.height - 630) // 2
    im.crop((0, top, 1200, top + 630)).save(IMG / "og.jpg", quality=84, optimize=True)
    print("og     <-", OG_SOURCE.name)


def textures():
    out = IMG / "tex"
    out.mkdir(parents=True, exist_ok=True)
    for name, (src, width, q) in TEXTURES.items():
        fit_width(Image.open(src).convert("RGB"), width).save(out / name, quality=q, optimize=True)
        print("tex   ", name, "<-", src.name)


def sensors(n=520, seed=7):
    """Random land points for the IoT stop, sampled from the day map (ocean is dark blue)."""
    a = np.asarray(Image.open(TEXTURES["earth-day.jpg"][0]).convert("RGB")).astype(int)
    h, w, _ = a.shape
    rng = random.Random(seed)
    pts = []
    while len(pts) < n:
        lat = rng.uniform(-56, 72)
        lon = rng.uniform(-180, 180)
        if rng.random() > np.cos(np.radians(lat)):  # uniform on the sphere
            continue
        x = min(w - 1, int((lon + 180) / 360 * w))
        y = min(h - 1, int((90 - lat) / 180 * h))
        r, g, b = a[y, x]
        if b > r + 8 and b >= g - 4 and r + g + b < 330:  # water
            continue
        pts.append([round(lat, 2), round(lon, 2)])
    (DATA / "sensors.json").write_text(json.dumps(pts, separators=(",", ":")))
    print("data   sensors.json:", len(pts), "land points")


def dsn():
    """Ground stations, rovers and Mars orbiters from the IPN-V dsn-network scenario."""
    nodes = []
    for row in csv.reader(l for l in IPNV_DSN_CSV.read_text().splitlines()
                          if l.strip() and not l.startswith("#")):
        kind, name, nid, body = row[:4]
        node = {"id": int(nid), "name": name, "type": kind.lower(), "body": body}
        if kind == "Lander":
            node.update(lat=float(row[4]), lon=float(row[5]))
        else:
            alt, inc, ecc, raan, argp, ma = map(float, row[4:10])
            node.update(alt=alt, inc=inc, ecc=ecc, raan=raan, argp=argp, ma=ma)
        nodes.append(node)
    out = {"source": "IPN-V scenario dsn-network (Interplanetary Network Visualiser)", "nodes": nodes}
    (DATA / "dsn.json").write_text(json.dumps(out, indent=1))
    print("data   dsn.json:", len(nodes), "nodes")


def odc():
    """The five default dawn-dusk shells of the ODC constellation sample (tessera)."""
    c = json.loads(ODC_SHELLS.read_text())
    keep = ("name", "altitude_km", "ltan_hours", "n_planes", "sats_per_plane",
            "raan_band_deg", "raan_center_offset_deg", "walker_phase_f", "color_hex")
    shells = [{k: s[k] for k in keep} for s in c["shells"] if s.get("enabled_by_default")]
    out = {"source": "Sample modelled on a public FCC filing for orbital data centres "
                     "(SAT-LOA-20260108-00016); five dawn-dusk sun-synchronous shells.",
           "shells": shells}
    (DATA / "odc.json").write_text(json.dumps(out, indent=1))
    print("data   odc.json:", sum(s["n_planes"] * s["sats_per_plane"] for s in shells), "satellites")


def cv_pdf():
    """The full Inria CV, built in the folder above with latexmk."""
    out = SITE / "assets/cv"
    out.mkdir(parents=True, exist_ok=True)
    shutil.copy(CV / "cv-juan-fraire-inria.pdf", out / "juan-a-fraire-cv.pdf")
    print("cv     <- cv-juan-fraire-inria.pdf")


def main():
    DATA.mkdir(exist_ok=True)
    cv_pdf()
    panels()
    heroes()
    logos()
    photos()
    og_image()
    textures()
    sensors()
    dsn()
    odc()


if __name__ == "__main__":
    main()

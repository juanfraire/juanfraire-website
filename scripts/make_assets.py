#!/usr/bin/env python3
"""Copy, resize and strip the site's images and data from their sources.

Every web asset is derived from a file elsewhere on this machine; this script
records where each one comes from, so swapping an image means editing one
entry and re-running. Outputs are committed; the site has no build step.

    python3 scripts/make_assets.py

Needs Pillow and numpy, and for the paper figures poppler's pdftoppm and librsvg's
rsvg-convert (brew install poppler librsvg). Saving through Pillow drops EXIF and other metadata.
The heroes of topic pages 01 to 03 are stills of the 3D tour, captured with Google Chrome from
the preview server (scripts/serve.py); without it they are skipped and the committed ones stay.

Sources that must not be named in this public repo are read from
scripts/sources.local.json (git-ignored), which maps a key to a local path:
"orbital-hero", "odc-shells", and "about-photos" (the folder of
originals for the photo carousel).
"""
from pathlib import Path
import csv
import io
import json
import math
import random
import shutil
import subprocess
import tempfile
import urllib.request

import numpy as np
from PIL import Image, ImageChops, ImageCms, ImageDraw, ImageOps

SITE = Path(__file__).resolve().parent.parent
DRIVE = Path("/Users/jfraire/My Drive")
CODE = Path("/Users/jfraire/Documents/Code")
CV = DRIVE / "var/0000-00-cv"
SLIDE = CV / "presentation-slide/assets"
IMG = SITE / "assets/img"
DATA = SITE / "data"
LOCAL_SOURCES = SITE / "scripts/sources.local.json"
PRIVATE = json.loads(LOCAL_SOURCES.read_text()) if LOCAL_SOURCES.exists() else {}


def private(key):
    """A source path kept out of the repo; see the module docstring."""
    if key not in PRIVATE:
        raise SystemExit(f"{LOCAL_SOURCES.name} has no entry {key!r}")
    return Path(PRIVATE[key]).expanduser()

# Topic panels from the intro slide (already cropped and graded by its make-assets.py).
PANELS = {
    "p1-dtn": SLIDE / "p1-dtn.jpg",
    "p2-iot": SLIDE / "p2-dtsiot.jpg",
    "p3-mega": SLIDE / "p3-mega.jpg",
    "p4-orbital": SLIDE / "p4-orbital.jpg",
}

# Wide topic-page heroes, 1600 x 900. Orbital computing's is a render (a key of
# sources.local.json); the other three are stills of the home page's 3D tour, one stop each,
# drawn by scripts/og-card.html?hero=N (moments and framing are set there).
HEROES = {"orbital-hero": "orbital-hero"}
TOUR_HEROES = {"dtn-hero": 0, "iot-hero": 1, "mega-hero": 2}
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
OG_CARD = "http://localhost:8765/scripts/og-card.html?hero={}"

PHOTO = CV / "profile/jfraire-profile-2-byn.jpg"          # portrait, black and white (2023 edit)
PHOTO_COLOUR = CV / "profile/jfraire-profile-full.jpg"    # the same shot in colour, uncropped
PHOTO_IN_COLOUR = (1222.5, 196, 1766)                     # where PHOTO sits in it: x, y, width (px)
ASTRONAUT = CV / "profile/jfraire-profile-fun-1.jpeg"     # cartoon, used on the 404 page

# The photo carousel next to "About me" (home and about pages): output name -> (file in the
# "about-photos" folder, crop box x, y, width in source pixels; the height is width * 5/4).
# Each crop keeps some of the scene around the face, and both people when there are two.
# The list of photos, with their alt text, is written out in index.html and about/index.html.
ABOUT_PHOTOS = {
    "balcony": ("pic-1-pau.jpg", (478, 0, 1324)),
    "yellow-glasses": ("pic-2-glasses.jpg", (650, 0, 1324)),
    "kitchen": ("pic-3-beni.jpg", (0, 0, 1242)),
    "ietf-126": ("pic-4.jpg", (0, 0, 1192)),
    "pool": ("pic-5-fran.jpg", (55, 110, 1067)),
    "polito": ("pic-6-polito.jpg", (810, 147, 1079)),
    "astronaut": ("pic-7-astro.jpg", (74, 92, 1168)),
    "bucket-hat": ("pic-8-beni.jpg", (630, 0, 1324)),
    "blaster": ("pic-9-gun.jpg", (0, 0, 1242)),
    "vader": ("pic-10-vader.jpg", (810, 0, 1324)),
}
FAVICON_BG = (7, 11, 22)                                  # --bg, also the favicon's tile

# Solar System Scope 2k maps (CC BY 4.0), as bundled with Contact Plan Designer.
TEXTURES = {
    "earth-day.jpg": (CODE / "cpd/contact-plan-designer/web/assets/planets/earth.jpg", 2048, 80),
    "earth-night.jpg": (CODE / "cpd/contact-plan-designer/web/assets/planets/earth_nightmap.jpg", 2048, 80),
    "mars.jpg": (CODE / "cpd/contact-plan-designer/web/assets/planets/mars.jpg", 2048, 72),
}

IPNV_DSN_CSV = CODE / "ipn-v/ipn-d/Assets/Data/input/network/dsn-network.csv"

# One figure per paper for the cards under "Selected papers": bib key -> (output name, source,
# crop, alt text, credit). Sources are the authors' own files (LaTeX figures, the redrawn copies
# in the HDR thesis, or the authors' version on HAL); a PDF crop is (page, x0, y0, x1, y1) in PDF
# points. The credit follows each publisher's author-reuse terms: IEEE asks for "© year IEEE" with
# every reprinted graphic, open-access papers name their licence, and Springer's LNCS consent to
# publish (2018-19) lets authors reuse illustrations in later work. The book shows its cover.
# Figures with third-party icons or renders are left out; scripts/generate.py gives a paper
# without an entry a topic tile instead.
HDR = DRIVE / "inria/0000-oo-old/2023-11-hdr/[Juan] HDR/img"
PAPER_FIGURES = {
    "fraire2017delayBook": ("delay-tolerant-satellite-networks-book", DRIVE / "unc/0000-00-papers/2018-Artech-book-cover.pdf",
        (1, 64, 72, 531, 776),
        "Front cover of Delay-Tolerant Satellite Networks by Juan A. Fraire, Jorge M. Finochietto "
        "and Scott C. Burleigh: teal rings on a dark ground", "Cover © 2018 Artech House"),
    "DBLP:conf/asms-spsc/StockFH22": ("starlink-on-demand-routing", HDR / "discoroute.pdf", (1, 0, 0, 505, 155),
        "Ground tracks of a Walker constellation over latitude and longitude, with two example routes "
        "stepping from satellite to satellite along and across orbital planes", "© 2022 IEEE"),
    "DBLP:conf/adhoc-now/FraireCA19": ("direct-to-satellite-iot-survey",
        "https://laas.hal.science/hal-02315399/file/AdHocNow2019_042_original_v4.pdf", (5, 130, 112, 485, 240),
        "Bandwidth against range for personal, cellular, LPWA and satellite networks, with "
        "direct-to-satellite IoT in the gap between LPWA and satellite networks",
        "© 2019 Springer Nature Switzerland AG"),
    "DBLP:journals/cn/FlorezFPR25": ("ml-satellite-iot-survey", HDR / "role_ml_iot_content.pdf", None,
        "Tree of the survey's topics: radio access, resource and network management, and applications "
        "and services, each split into the techniques reviewed", "© 2025 Elsevier"),
    "DBLP:journals/jsac/CapezCABFFG24": ("mega-constellation-services", DRIVE / "polito/2024-03-paper-mcss/architecture-ntn-mcss.png", None,
        "Four use cases side by side, from ground terminals using a mega-constellation today "
        "to satellites in low orbit using it as a 6G network in space", "© 2024 IEEE"),
    "DBLP:journals/cm/FraireIV22": ("space-terrestrial-iot", DRIVE / "inria/0000-oo-old/2021-06-dts-iot-commag/architecture.svg", None,
        "Space-terrestrial integrated IoT: devices on the ground reach low-orbit and geostationary "
        "satellites directly or through gateways, up to the network server", "© 2022 IEEE"),
    "DBLP:journals/taes/CapezHFG22": ("sparse-constellations",
        DRIVE / "unc/0000-00-old/2021-09-cpgd-polito/[IEEE TAES 2021] Sparse Satellite Constellation Design for DtS-IoT with CPGD/img/protocols-2.svg", None,
        "Bandwidth against range for sensor, LPWA, cellular and satellite networks, above a sketch "
        "of indirect and direct-to-satellite IoT", "CC BY 4.0"),
    "DBLP:journals/jnca/FraireJB21": ("cgr-tutorial", HDR / "store-and-forward-table.pdf", None,
        "Store, carry and forward across space: data moves from Earth to a Moon satellite and on "
        "to Mars, waiting at each node for the next contact", "© 2020 Elsevier"),
    "DBLP:journals/jcnc/FraireMBFFCZV17": ("cgr-reliability", DRIVE / "unc/0000-00-papers/2017-Hindawi-CGRReliability.pdf",
        (4, 49, 65, 550, 208),
        "Contact plans are generated from orbits and radio models, distributed to the satellites, "
        "and used by contact graph routing to build route tables", "CC BY 4.0"),
    "DBLP:journals/cm/FraireF15": ("contact-plan-design-challenges", HDR / "cpd_constraints.pdf", None,
        "Four ways a satellite can serve several nodes: one transponder, a power switch, "
        "two antennas, or a steerable antenna", "© 2015 IEEE"),
    "DBLP:journals/adhoc/FraireF15": ("fair-contact-plans", HDR / "racp_method_1.pdf", None,
        "Flow of the method: a contact topology becomes a fair contact plan, which three heuristics "
        "then refine into a route-improved plan", "© 2014 Elsevier"),
    "ohs2026darkclouds": ("dark-clouds", DRIVE / "saaruni/2026-04-paper-dark-clouds/paper-dark-clouds/design-space-1kw-carbon-heatmap-comparison.pdf", None,
        "Two heatmaps of carbon per GPU-hour against mission years and number of spares, "
        "for Starship and for Falcon 9", "CC BY 4.0"),
}

# One picture per tool or project on the software page: output name -> (source, crop, kind).
# kind "shot" is cropped to 16:10 and shown edge to edge; "figure" keeps its white background;
# "logo" and "logo-dark" centre a project's logo on a 16:10 light or dark ground. A bitmap crop
# is a pixel box. The alt text is written in software/index.html; the others show their name.
# The pyCGR picture is drawn from a pyCGR run on its tutorial contact plan: see scripts/pycgr-figure/.
# Screenshots of a website or a video are kept in scripts/shots/, with the date they were taken.
SOFTWARE_SHOTS = {
    "dtnsim": (HDR / "dtn_sim.pdf", (1, 15, 144, 210, 266), "shot"),   # Fig. 3 of the SMC-IT 2017 paper, © 2017 IEEE
    "pycgr": (SITE / "scripts/pycgr-figure/pycgr-route.png", None, "figure"),
    "mission": (DRIVE / "proyects/2020-03-rise-mission/0000-website/mission-web/assets/images/mission-logo2.svg", None, "logo-dark"),
    "dorsal-iot": (DRIVE / "inria/0000-00-project-ea-stsud-dorsal/dorsal-website/dorsal-website/dorsal-logo.png",
                   (160, 88, 490, 540), "logo"),       # the mark and a little of its drop shadow
    "d3-connect": (DRIVE / "inria/0000-00-project-ea-d3connect/website/d3-connect-website/logo.svg", None, "logo"),
    "conopscon": (DRIVE / "saaruni/2026-04-esa-conopscon/management-dgit/_theme/assets/logo-conopscon-lockup.svg", None, "logo"),
    "donuts": (DRIVE / "inria/0000-00-project-pepr-donuts/website/donuts-project-website/img-logo-donuts.svg", None, "logo-dark"),
    "esa": (SITE / "assets/img/logos/esa.svg", None, "logo-dark"),        # ESA-funded work without a logo of its own
    "vista": (HDR / "store-and-forward-table.pdf", None, "figure"),         # the CGR tutorial's figure, © 2020 Elsevier
    "stereo": (SITE / "scripts/shots/stereo-project-space.jpg", None, "shot"),          # stereo-project.space, 8 Oct 2026
    "foundation": (SITE / "scripts/shots/foundation-video.jpg", (98, 0, 1922, 1140), "shot"),   # a frame of the video
    "ipn-v": (DRIVE / "ipnsig/0000-00-ipnv-screenshots/image_008_0000.png", (0, 760, 4320, 3460), "shot"),
    "contact-plan-designer": (CODE / "cpd/contact-plan-designer/docs/img/workbench.png", (555, 140, 1920, 993), "shot"),  # keeps the Cesium ion logo whole
    "a-sabr": (CODE / "a-sabr/asabr/examples/inter-regional_routing/images/irr-cp.svg", (0, 140, 1600, 910), "figure"),  # without the title line
    "florasat": (CODE / "omnetpp-6.3.0/samples/florasat/images/screenshot.jpg", (330, 70, 1275, 661), "shot"),
    "espas": (CODE / "espas/docs/images/espas.png", None, "figure"),
    "meteornet": (DRIVE / "tesis/postdoc-unige-2022-09-camilo/2024-10-paper-asms-latency-tradeoff/1571096826 paper.pdf",
                  (3, 29, 237, 300, 354), "figure"),   # Fig. 2 of the ASMS/SPSC 2025 paper, © 2025 IEEE
}


def save_pair(im, stem, quality=82, webp_quality=78):
    """Write stem.jpg and stem.webp side by side."""
    im = im.convert("RGB")
    im.save(stem.with_suffix(".jpg"), quality=quality, optimize=True, progressive=True)
    im.save(stem.with_suffix(".webp"), quality=webp_quality, method=6)


def fit_width(im, width):
    if im.width <= width:
        return im
    return im.resize((width, round(im.height * width / im.width)), Image.LANCZOS)


def load_figure(src, crop=None, trim=True, ground=(255, 255, 255)):
    """A figure as RGB on `ground` (white by default). PDF: crop = (page, x0, y0, x1, y1) in points,
    rendered at 300 dpi with poppler's pdftoppm (page 1, uncropped, without a crop). SVG: rendered
    1600 px wide with librsvg's rsvg-convert, crop in pixels of that. Bitmap: crop in pixels. A source
    given as an https URL (a PDF on HAL) is downloaded first. Margins of the ground colour are trimmed."""
    if isinstance(src, str):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / Path(src).name
            with urllib.request.urlopen(src) as r:
                path.write_bytes(r.read())
            return load_figure(path, crop, trim, ground)
    if src.suffix == ".pdf":
        page, *box = crop or (1,)
        cmd = ["pdftoppm", "-f", str(page), "-l", str(page), "-r", "300", "-png", "-singlefile"]
        if box:
            x0, y0, x1, y1 = (round(v * 300 / 72) for v in box)
            cmd += ["-x", str(x0), "-y", str(y0), "-W", str(x1 - x0), "-H", str(y1 - y0)]
        with tempfile.TemporaryDirectory() as tmp:          # pdftoppm writes files, not stdout
            subprocess.run(cmd + [str(src), f"{tmp}/fig"], check=True)
            im = Image.open(f"{tmp}/fig.png")
            im.load()
        crop = None
    elif src.suffix == ".svg":
        bg = "white" if ground == (255, 255, 255) else "#%02x%02x%02x" % ground
        png = subprocess.run(["rsvg-convert", "-w", "1600", "-b", bg, str(src)], check=True, capture_output=True).stdout
        im = Image.open(io.BytesIO(png))
    else:
        im = Image.open(src)
    if im.mode in ("RGBA", "LA", "P"):
        im = im.convert("RGBA")
        flat = Image.new("RGB", im.size, ground)
        flat.paste(im, mask=im.split()[-1])
        im = flat
    im = im.convert("RGB")
    if crop:
        im = im.crop(crop)
    if trim:
        box = ImageChops.difference(im, Image.new("RGB", im.size, ground)).getbbox()
        im = im.crop(box) if box else im
    return im


LOGO_GROUNDS = {"logo": (238, 241, 246), "logo-dark": (12, 19, 36)}   # .fig's light grey, --bg-raised


def logo_card(src, crop, kind):
    """A project logo centred on a 720 x 450 ground, at most 62 % of its width and 56 % of its height."""
    ground = LOGO_GROUNDS[kind]
    logo = load_figure(src, crop, trim=crop is None, ground=ground)
    scale = min(720 * 0.62 / logo.width, 450 * 0.56 / logo.height)
    logo = logo.resize((round(logo.width * scale), round(logo.height * scale)), Image.LANCZOS)
    card = Image.new("RGB", (720, 450), ground)
    card.paste(logo, ((720 - logo.width) // 2, (450 - logo.height) // 2))
    return card


def paper_figures():
    """The figures on the selected-paper cards, and data/pub-figures.json for scripts/generate.py."""
    out = IMG / "pubs"
    out.mkdir(parents=True, exist_ok=True)
    manifest = {}
    for key, (name, src, crop, alt, credit) in PAPER_FIGURES.items():
        im = fit_width(load_figure(src, crop), 720)
        if im.height > im.width:                         # a book cover: twice the card's height is enough
            im = im.resize((round(im.width * 400 / im.height), 400), Image.LANCZOS)
        save_pair(im, out / name, quality=84, webp_quality=82)
        manifest[key] = {"img": f"/assets/img/pubs/{name}", "width": im.width, "height": im.height,
                         "alt": alt, "credit": credit}
    (DATA / "pub-figures.json").write_text(json.dumps(manifest, indent=1, ensure_ascii=False) + "\n")
    print("pubs   <-", len(manifest), "paper figures; data/pub-figures.json")


def software_shots():
    """720 x 450 screenshots (16:10) and 720-px-wide figures for the tool cards."""
    out = IMG / "software"
    out.mkdir(parents=True, exist_ok=True)
    for name, (src, crop, kind) in SOFTWARE_SHOTS.items():
        if kind in LOGO_GROUNDS:
            save_pair(logo_card(src, crop, kind), out / name, quality=86, webp_quality=82)
            continue
        im = load_figure(src, crop, trim=kind == "figure")
        if kind == "shot":
            assert abs(im.width / im.height - 1.6) < 0.02, f"{name}: crop is not 16:10"
            im = im.resize((720, 450), Image.LANCZOS)
        save_pair(fit_width(im, 720), out / name, quality=84, webp_quality=80)
    print("tools  <-", len(SOFTWARE_SHOTS), "pictures")


def panels():
    out = IMG / "panels"
    out.mkdir(parents=True, exist_ok=True)
    for name, src in PANELS.items():
        save_pair(Image.open(src), out / name)
        print("panel ", name, "<-", src.name)


def heroes():
    out = IMG / "topics"
    out.mkdir(parents=True, exist_ok=True)
    for name, key in HEROES.items():
        src = private(key)
        save_pair(fit_width(Image.open(src), 1600), out / name, quality=80, webp_quality=74)
        print("hero  ", name, "<-", src.name)


def tour_heroes():
    """The heroes of topic pages 01 to 03: scripts/og-card.html?hero=N captured with headless Chrome
    at 1600 x 900. Needs the preview server; without it (or without Chrome) they are left as they are."""
    try:
        urllib.request.urlopen(OG_CARD.format(0), timeout=2).close()
    except OSError:
        print("hero   tour stills skipped: start the preview server (scripts/serve.py) first")
        return
    if not Path(CHROME).exists():
        print("hero   tour stills skipped: no Google Chrome at", CHROME)
        return
    out = IMG / "topics"
    out.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        for name, stop in TOUR_HEROES.items():
            png = Path(tmp) / f"{name}.png"
            subprocess.run([CHROME, "--headless", "--hide-scrollbars", "--window-size=1600,900",
                            "--force-device-scale-factor=1", "--virtual-time-budget=60000",
                            f"--screenshot={png}", OG_CARD.format(stop)], check=True, capture_output=True)
            im = Image.open(png)
            assert im.size == (1600, 900), f"{name}: capture is {im.size}, not 1600 x 900"
            save_pair(im, out / name, quality=80, webp_quality=74)
            print("hero  ", name, "<- og-card.html?hero", stop)


def logos():
    out = IMG / "logos"
    out.mkdir(parents=True, exist_ok=True)
    for src in sorted((SLIDE / "logos").iterdir()):
        if src.suffix in {".svg", ".png"}:
            shutil.copy(src, out / src.name)
    print("logos  <-", SLIDE / "logos")


SRGB = ImageCms.ImageCmsProfile(ImageCms.createProfile("sRGB"))


def open_srgb(path):
    """Open a photo upright and in sRGB. The portraits are Adobe RGB and phone photos Display P3;
    the web copies carry no profile, so browsers read them as sRGB and the colours would fade."""
    im = Image.open(path)
    icc = im.info.get("icc_profile")
    im = ImageOps.exif_transpose(im)
    if icc:
        im = ImageCms.profileToProfile(im, ImageCms.ImageCmsProfile(io.BytesIO(icc)), SRGB, outputMode="RGB")
    return im.convert("RGB")


def photos():
    """The portrait in black and white and in colour, framed the same, for the press kit."""
    out = IMG / "photo"
    out.mkdir(parents=True, exist_ok=True)
    bw = open_srgb(PHOTO)
    x, y, w = PHOTO_IN_COLOUR
    colour = open_srgb(PHOTO_COLOUR).resize(bw.size, Image.LANCZOS, box=(x, y, x + w, y + w * bw.height / bw.width))
    for im, suffix in ((bw, ""), (colour, "-colour")):
        # 4:5 head-and-shoulders crop for the site; the full file is the press download.
        save_pair(im.crop((0, 0, im.width, round(im.width * 5 / 4))).resize((560, 700), Image.LANCZOS),
                  out / f"juan-a-fraire{suffix}")
        im.save(out / f"juan-a-fraire-press{suffix}.jpg", quality=90, optimize=True, progressive=True,
                icc_profile=SRGB.tobytes())
    save_pair(Image.open(ASTRONAUT).resize((480, 480), Image.LANCZOS), out / "astronaut")
    print("photo  <-", PHOTO.name, "+", PHOTO_COLOUR.name, "+", ASTRONAUT.name)


def about_photos():
    """4:5 crops for the carousel, at twice the 240 x 300 px they are shown at."""
    src = private("about-photos")
    if not src.is_dir():                     # the crops are committed; nothing to redo
        print("about  skipped,", src, "not found")
        return
    out = IMG / "photo/about"
    out.mkdir(parents=True, exist_ok=True)
    for name, (file, (x, y, w)) in ABOUT_PHOTOS.items():
        im = open_srgb(src / file)                             # boxes are in upright pixels
        h = round(w * 5 / 4)
        assert x + w <= im.width and y + h <= im.height, f"{file}: crop box outside the photo"
        save_pair(im.crop((x, y, x + w, y + h)).resize((480, 600), Image.LANCZOS), out / name)
    print("about  <-", len(ABOUT_PHOTOS), "photos from", src)


def og_image():
    """1200x630 social cards for the topic pages, a hero crop each. The site's own card,
    assets/img/og.jpg, is a capture of scripts/og-card.html (see README.md), not made here."""
    out = IMG / "og"
    out.mkdir(parents=True, exist_ok=True)
    for name in ("dtn", "iot", "mega", "orbital"):
        hero = Image.open(IMG / f"topics/{name}-hero.jpg").convert("RGB")   # 16:9, from heroes()
        hero = hero.resize((1200, round(hero.height * 1200 / hero.width)), Image.LANCZOS)
        top = (hero.height - 630) // 2
        hero.crop((0, top, 1200, top + 630)).save(out / f"og-{name}.jpg", quality=84, optimize=True)
    print("og     <- topics/*-hero.jpg")


def icons():
    """apple-touch-icon.png and favicon.ico, redrawn from favicon.svg (Pillow cannot read SVG)."""
    def draw(size):
        k = 4 * size / 64                                  # supersample, then shrink
        im = Image.new("RGBA", (round(64 * k),) * 2, (0, 0, 0, 0))
        g = ImageDraw.Draw(im)
        g.rounded_rectangle((0, 0, 64 * k - 1, 64 * k - 1), radius=14 * k, fill=FAVICON_BG)
        g.ellipse(((32 - 11) * k, (32 - 11) * k, (32 + 11) * k, (32 + 11) * k), fill=(0x5b, 0x9b, 0xd5))
        a, c = math.radians(-28), 32 * k                   # the orbit: an ellipse rotated by -28 degrees
        ellipse = lambda rx, ry: [(c + rx * k * math.cos(t) * math.cos(a) - ry * k * math.sin(t) * math.sin(a),
                                   c + rx * k * math.cos(t) * math.sin(a) + ry * k * math.sin(t) * math.cos(a))
                                  for t in (2 * math.pi * i / 720 for i in range(720))]
        band = Image.new("L", im.size, 0)                  # a 3-unit stroke: outer ellipse minus inner
        ImageDraw.Draw(band).polygon(ellipse(26.5, 11.5), fill=255)
        ImageDraw.Draw(band).polygon(ellipse(23.5, 8.5), fill=0)
        im.paste((0x82, 0xe0, 0xd4, 255), (0, 0), band)
        g = ImageDraw.Draw(im)
        g.ellipse(((53 - 4.5) * k, (21 - 4.5) * k, (53 + 4.5) * k, (21 + 4.5) * k), fill=(0xe8, 0xa5, 0x41))
        return im.resize((size, size), Image.LANCZOS)
    touch = Image.new("RGB", (180, 180), FAVICON_BG)       # iOS fills transparency with black
    touch.paste(draw(180), (0, 0), draw(180))
    touch.save(SITE / "apple-touch-icon.png", optimize=True)
    draw(48).save(SITE / "favicon.ico", sizes=[(16, 16), (32, 32), (48, 48)])
    print("icons  <- favicon.svg (redrawn)")


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
    """The five default dawn-dusk shells of the orbital data-centre sample (a private source)."""
    c = json.loads(private("odc-shells").read_text())
    keep = ("name", "altitude_km", "ltan_hours", "n_planes", "sats_per_plane",
            "raan_band_deg", "raan_center_offset_deg", "walker_phase_f", "color_hex")
    shells = [{k: s[k] for k in keep} for s in c["shells"] if s.get("enabled_by_default")]
    out = {"source": "Sample modelled on a public FCC filing for orbital data centres "
                     "(SAT-LOA-20260108-00016); five dawn-dusk sun-synchronous shells.",
           "shells": shells}
    (DATA / "odc.json").write_text(json.dumps(out, indent=1))
    print("data   odc.json:", sum(s["n_planes"] * s["sats_per_plane"] for s in shells), "satellites")


def cv_pdf():
    """The full Inria CV, built in ../cv with latexmk."""
    out = SITE / "assets/cv"
    out.mkdir(parents=True, exist_ok=True)
    shutil.copy(CV / "cv/cv-juan-fraire-inria.pdf", out / "juan-a-fraire-cv.pdf")
    print("cv     <- cv-juan-fraire-inria.pdf")


def main():
    DATA.mkdir(exist_ok=True)
    cv_pdf()
    panels()
    heroes()
    tour_heroes()
    logos()
    photos()
    about_photos()
    paper_figures()
    software_shots()
    og_image()
    icons()
    textures()
    sensors()
    dsn()
    odc()


if __name__ == "__main__":
    main()

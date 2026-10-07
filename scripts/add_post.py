#!/usr/bin/env python3
"""Copy LinkedIn posts into the site's news: text, images, video and link preview.

    python3 scripts/add_post.py <post URL> [<post URL> ...] [--force]
    python3 scripts/generate.py

Any form of post URL works: feed/update/urn:li:activity:…, posts/…-activity-<id>-…, or a
share or ugcPost URN. The script reads LinkedIn's public embed of the post (no login, so the
post must be public) and writes:

- data/news/YYYY-MM-DD-slug.md   the post: a few header lines, then the text as on LinkedIn;
- assets/img/news/…              its images as JPG and WebP, at most 1400 px wide;
- assets/video/news/…            its video, if any, as MP4 with a poster image.

Everything is copied once, here, so visitors never load anything from LinkedIn. LinkedIn
rarely has alt text for images, so the script lists the `alt:` lines left to fill in.
An existing post file is kept unless --force is given.

Needs Pillow; ffmpeg, if installed, re-encodes videos over 12 MB and adds fast start.
"""
from datetime import datetime, timezone
from html import unescape
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse
import io
import json
import re
import shutil
import subprocess
import sys
import tempfile
import unicodedata
import urllib.request

from PIL import Image, ImageOps

SITE = Path(__file__).resolve().parent.parent
POSTS = SITE / "data/news"
IMG = SITE / "assets/img/news"
VIDEO = SITE / "assets/video/news"
EMBED = "https://www.linkedin.com/embed/feed/update/urn:li:{kind}:{id}"
UA = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 "
                    "(KHTML, like Gecko) Chrome/140 Safari/537.36"}
MAX_W = 1400
VIDEO_MB = 12
STOP = {"a", "an", "the", "of", "to", "and", "in", "on", "for", "is", "are", "my", "our", "we", "i", "at"}


def get(url, binary=False):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30) as r:
        data = r.read()
        return data if binary else (data.decode("utf-8", "replace"), r.geturl())


def post_id(arg):
    """(kind, id) from any LinkedIn post URL or URN."""
    m = re.search(r"(activity|share|ugcPost)[:-](\d{15,})", unquote(arg))
    if not m:
        sys.exit(f"not a LinkedIn post URL: {arg}")
    return m.group(1), m.group(2)


def destination(href):
    """The real target of a link in a post: unwrap LinkedIn's redirect and lnkd.in short links."""
    if "linkedin.com/redir/redirect" in href:
        href = parse_qs(urlparse(href).query).get("url", [href])[0]
    if urlparse(href).netloc == "lnkd.in":
        try:
            page, final = get(href)
            if urlparse(final).netloc != "lnkd.in":
                return final
            out = [unescape(h) for h in re.findall(r'href="(https?://[^"]+)"', page)
                   if not re.search(r"linkedin\.com|licdn\.com|lnkd\.in", h)]
            return out[0] if out else href
        except OSError:
            return href
    return href


def post_text(page):
    m = re.search(r'<p[^>]*attributed-text-segment-list__content[^>]*>(.*?)</p>', page, re.S)
    if not m:
        return ""

    def anchor(a):
        href, inner = unescape(a.group(1)), unescape(re.sub(r"<[^>]+>", "", a.group(2))).strip()
        if inner.startswith("#"):
            return inner                                   # a hashtag
        if re.match(r"https?://|lnkd\.in/", inner):
            return destination(href)                       # a link written out in the text
        return inner                                       # a mention: keep the name

    s = re.sub(r'<a\b[^>]*?href="([^"]*)"[^>]*>(.*?)</a>', anchor, m.group(1), flags=re.S)
    s = unescape(re.sub(r"<[^>]+>", "", re.sub(r"<br\s*/?>", "\n", s)))
    lines = [line.rstrip() for line in s.strip().split("\n")]
    return re.sub(r"\n{3,}", "\n\n", "\n".join(lines))


def slug(text):
    first = unicodedata.normalize("NFKC", text.split("\n")[0])
    ascii_ = unicodedata.normalize("NFKD", first).encode("ascii", "ignore").decode().lower()
    words = [w for w in re.findall(r"[a-z0-9]+", ascii_) if w not in STOP]
    return "-".join(words[:6]) or "post"


def save_image(url, stem):
    im = ImageOps.exif_transpose(Image.open(io.BytesIO(get(url, binary=True)))).convert("RGB")
    if im.width > MAX_W:
        im = im.resize((MAX_W, round(im.height * MAX_W / im.width)), Image.LANCZOS)
    IMG.mkdir(parents=True, exist_ok=True)
    im.save(IMG / f"{stem}.jpg", quality=82, optimize=True, progressive=True)
    im.save(IMG / f"{stem}.webp", quality=78, method=6)
    return f"{stem}.jpg"


def save_video(url, stem):
    VIDEO.mkdir(parents=True, exist_ok=True)
    out = VIDEO / f"{stem}.mp4"
    with tempfile.TemporaryDirectory() as tmp:
        raw = Path(tmp) / "in.mp4"
        raw.write_bytes(get(url, binary=True))
        if shutil.which("ffmpeg"):
            big = raw.stat().st_size > VIDEO_MB * 1e6
            codec = (["-vf", "scale='min(1280,iw)':-2", "-c:v", "libx264", "-crf", "28", "-preset", "slow",
                      "-c:a", "aac", "-b:a", "96k"] if big else ["-c", "copy"])
            subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", str(raw), *codec,
                            "-movflags", "+faststart", str(out)], check=True)
        else:
            shutil.copy(raw, out)
    return out.name


def add(arg, force=False):
    kind, pid = post_id(arg)
    page, _ = get(EMBED.format(kind=kind, id=pid))
    activity = (re.search(r"urn:li:activity:(\d+)", page) or [None, pid if kind == "activity" else None])[1]
    if not activity:
        sys.exit(f"{arg}: could not find the post (is it public?)")
    when = datetime.fromtimestamp((int(activity) >> 22) / 1000, timezone.utc).date().isoformat()
    text = post_text(page)
    if not text:
        sys.exit(f"{arg}: the embed has no text (is the post public?)")
    stem = f"{when}-{slug(text)}"
    target = POSTS / f"{stem}.md"
    if target.exists() and not force:
        print(f"skip  {target.relative_to(SITE)} (exists; --force to replace)")
        return
    head = [f"date: {when}", f"source: https://www.linkedin.com/feed/update/urn:li:activity:{activity}/"]
    missing_alt = 0

    images = [(unescape(u), unescape(a)) for u, a in re.findall(
        r'<img[^>]*?data-delayed-url="([^"]*feedshare[^"]*)"[^>]*?alt="([^"]*)"', page, re.S)]
    for n, (url, alt) in enumerate(images, 1):
        head.append(f"image: {save_image(url, f'{stem}-{n}')}")
        alt = "" if re.match(r"no alternative text", alt, re.I) else alt.strip()
        missing_alt += not alt
        head.append(f"alt: {alt}")

    video = re.search(r'<video[^>]*data-sources="([^"]+)"[^>]*>', page, re.S)
    if video:
        sources = sorted(json.loads(unescape(video.group(1))), key=lambda s: s.get("data-bitrate", 0))
        poster = re.search(r'data-poster-url="([^"]+)"', video.group(0))
        head.append(f"video: {save_video(sources[-1]['src'], stem)}")
        if poster:
            head.append(f"poster: {save_image(unescape(poster.group(1)), f'{stem}-poster')}")

    card = re.search(r'<a[^>]*href="([^"]*)"[^>]*data-tracking-control-name="public_post_embed_feed-article-content"'
                     r'[^>]*>(.*?)</a>', page, re.S)
    if card:
        lines = [unescape(t).strip() for t in re.sub(r"<[^>]+>", "\n", card.group(2)).split("\n") if t.strip()]
        head.append(f"preview: {destination(unescape(card.group(1)))}")
        if lines:
            head.append(f"preview-title: {lines[0]}")
        thumb = re.search(r'data-delayed-url="([^"]*articleshare[^"]*)"', page)
        if thumb:
            head.append(f"preview-image: {save_image(unescape(thumb.group(1)), f'{stem}-preview')}")
    if re.search(r"document-s-container|feed-shared-document", page):
        print(f"note  {stem}: the post has a document (PDF carousel); only its text and link are copied")

    POSTS.mkdir(parents=True, exist_ok=True)
    target.write_text("---\n" + "\n".join(head) + "\n---\n" + text + "\n", encoding="utf-8")
    print(f"wrote {target.relative_to(SITE)}: {len(images)} image(s){', video' if video else ''}"
          f"{', link preview' if card else ''}" + (f"; {missing_alt} alt line(s) to fill in" if missing_alt else ""))


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if not args:
        sys.exit(__doc__)
    for a in args:
        add(a, force="--force" in sys.argv)

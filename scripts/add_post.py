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
A post that shares someone else's post with a comment ("quote repost") keeps the comment
and links to the shared post, without copying its media. A post already copied (same
LinkedIn post, whatever its file name) is kept unless --force is given. A post in Spanish or French gets a `lang:` line, so screen readers switch voice.

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
import time
import unicodedata
import urllib.error
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
LANGS = {"en": "the and of to is for with this that are our".split(),       # common words, to guess a post's language
         "es": "el la los las que de del y en para con una por es".split(),
         "fr": "le la les des du et est pour une dans avec sur nous".split()}


class Failed(Exception):
    pass


def get(url, binary=False):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30) as r:
        data = r.read()
        return data if binary else (data.decode("utf-8", "replace"), r.geturl())


def post_id(arg):
    """(kind, id) from any LinkedIn post URL or URN."""
    m = re.search(r"(activity|share|ugcPost)[:-](\d{15,})", unquote(arg))
    if not m:
        raise Failed(f"not a LinkedIn post URL: {arg}")
    return m.group(1), m.group(2)


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args):
        return None


def location(url):
    """Where a short link points, without following it (t.co answers browsers with a page)."""
    try:
        urllib.request.build_opener(NoRedirect).open(url, timeout=30)
    except urllib.error.HTTPError as e:
        return e.headers.get("Location") or url
    except OSError:
        pass
    return url


TWEET_MEDIA = re.compile(r"https?://(twitter|x)\.com/\w+/status/\d+/(photo|video)/")


def destination(href):
    """The real target of a link in a post: unwrap LinkedIn's redirect, lnkd.in and t.co short links.
    Empty for a t.co link to a tweet's own photo (posts cross-posted from Twitter end with one)."""
    if "linkedin.com/redir/redirect" in href:
        href = parse_qs(urlparse(href).query).get("url", [href])[0]
    href = re.sub(r"(%C2%A0|%20|\s)+$", "", href)            # LinkedIn keeps a trailing (non-breaking) space
    if urlparse(href).netloc == "t.co":
        href = location(href)
        return "" if TWEET_MEDIA.match(href) else href
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


def post_text(page, which="main-feed-activity-embed-card__commentary"):
    m = (re.search(rf'<p[^>]*data-test-id="{which}"[^>]*>(.*?)</p>', page, re.S)
         or re.search(r'<p[^>]*attributed-text-segment-list__content[^>]*>(.*?)</p>', page, re.S))
    if not m:
        return ""

    def anchor(a):
        href, inner = unescape(a.group(1)), unescape(re.sub(r"<[^>]+>", "", a.group(2))).strip()
        if inner.startswith("#"):
            return inner                                   # a hashtag
        if re.match(r"https?://|lnkd\.in/|t\.co/", inner):
            return destination(href)                       # a link written out in the text
        return inner                                       # a mention: keep the name

    s = re.sub(r'<a\b[^>]*?href="([^"]*)"[^>]*>(.*?)</a>', anchor, m.group(1), flags=re.S)
    s = unescape(re.sub(r"<[^>]+>", "", re.sub(r"<br\s*/?>", "\n", s)))
    s = re.sub(r"https?://t\.co/\w+", lambda m: destination(m.group(0)), s)   # any left as plain text
    lines = [line.rstrip() for line in s.strip().split("\n")]
    return re.sub(r"\n{3,}", "\n\n", "\n".join(lines))


def language(text):
    """'es' or 'fr' when the post is clearly in that language; None for English."""
    words = re.findall(r"[a-zà-ÿ]+", unicodedata.normalize("NFKC", text).lower())
    score = {lang: sum(w in common for w in words) for lang, common in LANGS.items()}
    best = max(score, key=score.get)
    return best if best != "en" and score[best] >= 5 and score[best] > 1.5 * score["en"] else None


def copied():
    """Post files already in data/news, by LinkedIn activity id."""
    out = {}
    for f in POSTS.glob("*.md"):
        m = re.search(r"^source: .*?activity:(\d+)", f.read_text(encoding="utf-8"), re.M)
        if m:
            out[m.group(1)] = f
    return out


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
    full, _ = get(EMBED.format(kind=kind, id=pid))
    reshare = re.search(r'<article[^>]*data-test-id="feed-reshare-content"[^>]*>', full)
    page = full[:reshare.start()] if reshare else full     # the post itself, without the post it shares
    activity = pid if kind == "activity" else (re.search(r"urn:li:activity:(\d+)", page) or [None, None])[1]
    if not activity:
        raise Failed(f"{arg}: could not find the post (is it public?)")
    when = datetime.fromtimestamp((int(activity) >> 22) / 1000, timezone.utc).date().isoformat()
    text = post_text(page)
    if not text:
        raise Failed(f"{arg}: " + ("a repost with no text of its own" if reshare else
                                    "the embed has no text (is the post public?)"))
    stem = f"{when}-{slug(text)}"
    target = POSTS / f"{stem}.md"
    old = copied().get(activity)
    if old and not force:
        print(f"skip  {old.relative_to(SITE)} (already copied; --force to replace)")
        return
    if old and old != target:
        old.unlink()                                   # the text changed, and with it the file name
    head = [f"date: {when}", f"source: https://www.linkedin.com/feed/update/urn:li:activity:{activity}/"]
    lang = language(text)
    if lang:
        head.append(f"lang: {lang}")
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
    video_link = re.search(r'<a[^>]*href="([^"]*)"[^>]*data-tracking-control-name="[^"]*external-video-content"'
                           r'[^>]*>(.*?)</a>', page, re.S)
    if video_link and not card:                        # a YouTube or Vimeo video: a link card, never an embed
        url = destination(unescape(video_link.group(1)))
        head += [f"preview: {url}", "preview-title: " + (unescape(re.sub(r"<[^>]+>", "", video_link.group(2))).strip() or "Video")]
        yt = re.search(r"(?:youtube\.com/watch\?v=|youtu\.be/)([\w-]{11})", url)
        for size in ("maxresdefault", "hqdefault") if yt else ():
            try:                                       # its thumbnail, copied here like the other images
                head.append(f"preview-image: {save_image(f'https://i.ytimg.com/vi/{yt.group(1)}/{size}.jpg', f'{stem}-preview')}")
                break
            except OSError:
                continue
    if reshare:                                        # link to the shared post; its media stay there
        tag, rest = reshare.group(0), full[reshare.start():]
        urn = re.search(r'data-activity-urn="([^"]+)"', tag) or re.search(r'data-attributed-urn="([^"]+)"', tag)
        who = re.search(r'reshare_feed-actor-name"[^>]*>(.*?)</a>', rest, re.S)
        who = unescape(re.sub(r"<[^>]+>", "", who.group(1))).strip() if who else "LinkedIn"
        first = unicodedata.normalize("NFKC", post_text(rest, "feed-reshare-content__commentary")).strip().split("\n")[0]
        first = first if len(first) <= 140 else first[:139].rsplit(" ", 1)[0] + "…"
        head += [f"preview: https://www.linkedin.com/feed/update/{urn.group(1)}/" if urn else f"preview: {head[1][8:]}",
                 f"preview-title: {first or 'Shared post'}", f"preview-site: {who} on LinkedIn"]
    if re.search(r"document-s-container|feed-shared-document", page):
        print(f"note  {stem}: the post has a document (PDF carousel); only its text and link are copied")

    POSTS.mkdir(parents=True, exist_ok=True)
    target.write_text("---\n" + "\n".join(head) + "\n---\n" + text + "\n", encoding="utf-8")
    print(f"wrote {target.relative_to(SITE)}: {len(images)} image(s){', video' if video else ''}"
          f"{', link preview' if card else ''}{', video link' if video_link and not card else ''}"
          f"{', shared post' if reshare else ''}" + (f"; {missing_alt} alt line(s) to fill in" if missing_alt else ""))


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if not args:
        sys.exit(__doc__)
    failed = []
    for n, a in enumerate(args):
        if n:
            time.sleep(1.5)                            # go easy on LinkedIn
        try:
            add(a, force="--force" in sys.argv)
        except (Failed, OSError) as e:
            print(f"FAIL  {e}")
            failed.append(a)
    if failed:
        sys.exit(f"{len(failed)} of {len(args)} post(s) not copied")

#!/usr/bin/env python3
"""Rewrite the generated blocks in the site's HTML.

Sources of truth:
- publications: ../cv/cv-juan-fraire.bib (the CV bibliography)
- news:         data/news/*.md, one file per post (scripts/add_post.py copies LinkedIn posts)

It also rewrites sitemap.xml: every page except 404.html, with the date of the page's
last commit as lastmod (today for a page with uncommitted changes).

A generated block is everything between a start marker and its end marker:

    <!-- gen:pubs topic=orbital limit=5 -->  ...  <!-- /gen -->   featured papers of one topic
    <!-- gen:pubs all -->                   ...  <!-- /gen -->   the full list, grouped by year
    <!-- gen:pubs selected -->              ...  <!-- /gen -->   the CV's selected papers
    <!-- gen:news limit=3 -->               ...  <!-- /gen -->   the latest posts, as cards
    <!-- gen:news all -->                   ...  <!-- /gen -->   every post, as a feed

A news post is a few header lines between `---` lines, then the text as written on LinkedIn:

    ---
    date: 2026-07-03                 (or 2026-07: a month-only date leads its month)
    source: https://www.linkedin.com/feed/update/urn:li:activity:…/   (optional)
    image: 2026-07-03-cpd-1.jpg      (in assets/img/news/, with a .webp twin; repeat per image)
    alt: What the image shows        (follows its image)
    video: 2026-07-03-cpd.mp4        (in assets/video/news/), poster: 2026-07-03-cpd-poster.jpg
    preview: https://…               preview-title: …   preview-image: … (a link card)
    link: https://…                  link-text: Paper   (an extra link under the post)
    lang: es                         (for a post not in English)
    ---
    The text. Blank lines separate paragraphs; URLs, #hashtags, *italics* and LinkedIn's
    Unicode bold (𝗹𝗶𝗸𝗲 𝘁𝗵𝗶𝘀) are rendered as such.

Run after editing the bib or the news, then commit the changed HTML:

    python3 scripts/generate.py

Standard library only. Bib conventions (see ../CLAUDE.md): `keywords` holds the
type (book, journal, conference, preprint; arxiv and thesis are not printed), the
topics (dtn, iot, mega, orbital), and the flags `selected` (CV flagship list) and
`featured` (extra papers shown on a topic page). A topic page shows the papers of
that topic flagged selected or featured, newest first. An optional `weburl` field
overrides the link on the website only (biber ignores it, so the CV keeps the DOI).
"""
from datetime import date
from html import escape, unescape
from pathlib import Path
import re
import struct
import subprocess
import sys
import unicodedata

SITE = Path(__file__).resolve().parent.parent
BIB = SITE.parent / "cv/cv-juan-fraire.bib"
NEWS = SITE / "data/news"
NEWS_IMG, NEWS_VIDEO = "/assets/img/news/", "/assets/video/news/"
PAGES = sorted(p for p in SITE.rglob("*.html") if "vendor" not in p.parts)
ORIGIN = "https://juanfraire.space"
PRESS = {"en": "/press/", "es": "/es/prensa/", "fr": "/fr/presse/"}   # one page in three languages

PRINTED = ("book", "journal", "conference", "preprint")
TOPICS = ("dtn", "iot", "mega", "orbital")
TYPE_LABEL = {"book": "Book or chapter", "journal": "Journal", "conference": "Conference", "preprint": "Preprint"}
MONTHS = ["January", "February", "March", "April", "May", "June", "July",
          "August", "September", "October", "November", "December"]

# ---------------------------------------------------------------- bib parsing

def parse_bib(text):
    """Return a list of {type, key, fields} from a BibTeX string (brace-balanced values)."""
    entries = []
    for m in re.finditer(r"@(\w+)\s*\{\s*([^,\s]+)\s*,", text):
        kind, key = m.group(1).lower(), m.group(2)
        if kind in ("comment", "string", "preamble"):
            continue
        i, depth = m.end(), 1
        start = i
        while i < len(text) and depth:  # find the entry's closing brace
            depth += {"{": 1, "}": -1}.get(text[i], 0)
            i += 1
        entries.append({"type": kind, "key": key, "fields": parse_fields(text[start:i - 1])})
    return entries


def parse_fields(body):
    fields, i = {}, 0
    while True:
        m = re.compile(r"\s*,?\s*([A-Za-z_-]+)\s*=\s*").match(body, i)
        if not m:
            break
        name, i = m.group(1).lower(), m.end()
        if i < len(body) and body[i] == "{":
            depth, j = 1, i + 1
            while j < len(body) and depth:
                depth += {"{": 1, "}": -1}.get(body[j], 0)
                j += 1
            value, i = body[i + 1:j - 1], j
        elif i < len(body) and body[i] == '"':
            j = body.index('"', i + 1)
            value, i = body[i + 1:j], j + 1
        else:
            m2 = re.compile(r"[^,\s}]+").match(body, i)
            value, i = m2.group(0), m2.end()
        fields[name] = re.sub(r"\s+", " ", value).strip()
    return fields


ACCENTS = {"'": "\u0301", "`": "\u0300", "^": "\u0302", '"': "\u0308", "~": "\u0303",
           "=": "\u0304", ".": "\u0307", "c": "\u0327", "v": "\u030c", "u": "\u0306", "H": "\u030b"}


def detex(s):
    """LaTeX accents and a few macros to Unicode; drop grouping braces."""
    s = s.replace(r"$\mu$", "µ").replace(r"\&", "&").replace(r"\_", "_").replace(r"\%", "%")
    s = re.sub(r"\\([`'^\"~=.cvuH])\s*\{?\s*(?:\\([ij])\b|([A-Za-z]))\s*\}?",
               lambda m: (m.group(2) or m.group(3)) + ACCENTS[m.group(1)], s)
    s = re.sub(r"\\(o|O|l|L|ss|ae|AE)\b\s*", lambda m: {"o": "ø", "O": "Ø", "l": "ł", "L": "Ł",
               "ss": "ß", "ae": "æ", "AE": "Æ"}[m.group(1)], s)
    s = s.replace("---", "\u2014").replace("--", "\u2013")
    s = s.replace("{", "").replace("}", "").replace("\\", "")
    return unicodedata.normalize("NFC", re.sub(r"\s+", " ", s).strip())


def authors(field):
    names = []
    for raw in re.split(r"\s+and\s+", field):
        raw = detex(raw)
        if "," in raw:
            last, first = [p.strip() for p in raw.split(",", 1)]
            raw = f"{first} {last}"
        names.append(raw)
    return names


def to_pub(entry):
    f = entry["fields"]
    kws = [k.strip() for k in f.get("keywords", "").split(",") if k.strip()]
    kind = next((k for k in PRINTED if k in kws), None)
    if not kind:
        return None
    venue = f.get("journal") or f.get("booktitle") or f.get("publisher") or f.get("school") or ""
    if not venue and f.get("eprinttype", "").lower() == "arxiv":
        venue = "arXiv"
    link = ""
    if f.get("weburl"):                       # website-only override, e.g. a corrected version
        link = f["weburl"]
    elif f.get("doi"):
        link = "https://doi.org/" + f["doi"].replace(r"\_", "_")
    elif f.get("url"):
        link = f["url"].replace(r"\_", "_")
    elif f.get("eprint") and f.get("eprinttype", "").lower() == "arxiv":
        link = "https://arxiv.org/abs/" + f["eprint"]
    return {
        "key": entry["key"],
        "kind": kind,
        "title": detex(f.get("title", "")),
        "authors": authors(f.get("author", f.get("editor", ""))),
        "venue": detex(venue),
        "year": int(re.sub(r"\D", "", f.get("year", "0")) or 0),
        "link": link,
        "topics": [t for t in TOPICS if t in kws],
        "selected": "selected" in kws,
        "flagged": "selected" in kws or "featured" in kws,
    }


def load_pubs():
    pubs = [p for p in (to_pub(e) for e in parse_bib(BIB.read_text(encoding="utf-8"))) if p]
    pubs.sort(key=lambda p: (-p["year"], p["title"].lower()))
    return pubs

# ---------------------------------------------------------------- rendering

def render_pub(p, indent):
    names = [f"<strong>{escape(n)}</strong>" if n.endswith("Fraire") else escape(n) for n in p["authors"]]
    who = ", ".join(names[:-1]) + (", and " if len(names) > 2 else " and ") + names[-1] if len(names) > 1 else "".join(names)
    title = escape(p["title"])
    if p["link"]:
        title = f'<a href="{escape(p["link"])}">{title}</a>'
    venue = escape(p["venue"]) + (", " if p["venue"] else "") + str(p["year"])
    attrs = f'data-type="{p["kind"]}" data-topics="{" ".join(p["topics"])}"'
    pad = " " * indent
    return (f'{pad}<li class="pub" {attrs}>\n'
            f'{pad}  <span class="pub-title">{title}</span>\n'
            f'{pad}  <span class="pub-authors">{who}</span>\n'
            f'{pad}  <span class="pub-venue">{venue}</span>\n'
            f'{pad}</li>')


def block_pubs(args, pubs, indent):
    if "all" in args:
        out, year = [], None
        for p in pubs:
            if p["year"] != year:
                if year is not None:
                    out.append(" " * indent + "</ol>")
                year = p["year"]
                out.append(" " * indent + f'<h3 class="pub-year" id="y{year}">{year}</h3>')
                out.append(" " * indent + '<ol class="pubs">')
            out.append(render_pub(p, indent + 2))
        out.append(" " * indent + "</ol>")
        return "\n".join(out)
    if "selected" in args:                    # the CV's flagship list, newest first
        lines = [" " * indent + '<ol class="pubs">'] + [render_pub(p, indent + 2) for p in pubs if p["selected"]]
        return "\n".join(lines + [" " * indent + "</ol>"])
    topic, limit = args.get("topic"), int(args.get("limit", 5))
    chosen = [p for p in pubs if topic in p["topics"] and p["flagged"]][:limit]
    if not chosen:
        sys.exit(f"no selected/featured papers for topic {topic!r}")
    lines = [" " * indent + '<ol class="pubs">'] + [render_pub(p, indent + 2) for p in chosen]
    return "\n".join(lines + [" " * indent + "</ol>"])


# ---------------------------------------------------------------- news

def load_news():
    """Posts from data/news/*.md, newest first (a month-only date leads its month)."""
    posts = []
    for f in sorted(NEWS.glob("*.md")):
        m = re.match(r"---\n(.*?)\n---\n?(.*)", f.read_text(encoding="utf-8"), re.S)
        if not m:
            sys.exit(f"{f.name}: the post must start with a --- header")
        post = {"id": f.stem, "images": [], "text": m.group(2).strip()}
        for line in m.group(1).split("\n"):
            key, _, value = (s.strip() for s in line.partition(":"))
            if key == "image":
                post["images"].append({"file": value, "alt": ""})
            elif key == "alt" and post["images"]:
                post["images"][-1]["alt"] = value
            elif key:
                post[key] = value
        if not re.fullmatch(r"\d{4}-\d{2}(-\d{2})?", post.get("date", "")):
            sys.exit(f"{f.name}: needs a date line, YYYY-MM-DD or YYYY-MM")
        for im in post["images"]:
            if not im["alt"]:
                print(f"warning: {f.name}: {im['file']} has no alt text")
        posts.append(post)
    posts.sort(key=lambda p: p["date"] if len(p["date"]) > 7 else p["date"] + "-99", reverse=True)
    return posts


def nice_date(iso):
    parts = iso.split("-")
    month = f"{MONTHS[int(parts[1]) - 1]} {parts[0]}"
    return f"{int(parts[2])} {month}" if len(parts) == 3 else month


MATH = "\U0001D400-\U0001D7FF"          # LinkedIn's "bold" and "italic" are these letters
STYLED = re.compile(f"[{MATH}](?:[{MATH}\\s'’,.:;!?()–-]*[{MATH}])?")
URL = re.compile(r"(?<![\"'=>])\bhttps?://[^\s<]+[^\s<.,;:!?)\]'\"]")


def shown(url):
    s = re.sub(r"^https?://(www\.)?", "", url).rstrip("/")
    return s if len(s) <= 42 else s[:40] + "…"


def post_text(text):
    """A post's plain text as HTML paragraphs."""
    def styled(m):
        name = unicodedata.name(m.group(0)[0], "")
        tag = "em" if "ITALIC" in name and "BOLD" not in name else "strong"
        return f"<{tag}>{unicodedata.normalize('NFKC', m.group(0))}</{tag}>"

    def link(url, label=None):
        raw = unescape(url)
        return f'<a href="{escape(raw)}">{label if label is not None else escape(shown(raw))}</a>'

    s = escape(text, quote=False)
    s = STYLED.sub(styled, s)
    s = re.sub(r"\[([^\]\n]+)\]\((https?://[^)\s]+)\)", lambda m: link(m.group(2), m.group(1)), s)
    s = URL.sub(lambda m: link(m.group(0)), s)
    s = re.sub(r"(?<![\w/#&;])#(\w[\w-]*)", r'<span class="hashtag">#\1</span>', s)
    s = re.sub(r"(?<![\w*])\*(?!\s)([^*\n]+?)(?<!\s)\*(?![\w*])", r"<em>\1</em>", s)
    return "".join(f"<p>{p.strip().replace(chr(10), '<br>' + chr(10))}</p>" for p in re.split(r"\n\s*\n", s) if p.strip())


def image_size(path):
    """Width and height of a JPEG, from its frame header (standard library only)."""
    data, i = path.read_bytes(), 2
    while i < len(data) - 9:
        if data[i] != 0xFF:
            i += 1
            continue
        if data[i + 1] in (0xC0, 0xC1, 0xC2):
            h, w = struct.unpack(">HH", data[i + 5:i + 9])
            return w, h
        i += 2 + struct.unpack(">H", data[i + 2:i + 4])[0]
    sys.exit(f"{path}: not a JPEG")


def picture(name, alt, lazy=True):
    path = SITE / NEWS_IMG.strip("/") / name
    if not path.exists():
        sys.exit(f"missing {path.relative_to(SITE)}")
    w, h = image_size(path)
    webp = path.with_suffix(".webp")
    source = f'<source srcset="{NEWS_IMG}{webp.name}" type="image/webp">' if webp.exists() else ""
    attrs = ' loading="lazy" decoding="async"' if lazy else ""
    return f'<picture>{source}<img src="{NEWS_IMG}{name}" width="{w}" height="{h}" alt="{escape(alt)}"{attrs}></picture>'


def render_post(p, pad, card):
    """One post: date, text, then media as on LinkedIn, then its links. Cards show at most four images."""
    out = [f'{pad}<article class="post">',
           f'{pad}  <p class="post-date">' + (f'<a href="/news/#post-{p["id"]}">' if card else "")
           + f'<time datetime="{p["date"]}">{nice_date(p["date"])}</time>' + ("</a>" if card else "") + "</p>",
           f'{pad}  <div class="post-text" id="text-{p["id"]}"{" data-clamp" if card else ""}'
           + (f' lang="{escape(p["lang"])}"' if p.get("lang") else "") + f'>{post_text(p["text"])}</div>']
    images = p["images"]
    if images:
        shown_imgs = images[:4] if card else images
        kind = f"n{len(shown_imgs)}" if len(shown_imgs) <= 4 else "many"
        out.append(f'{pad}  <div class="post-media {kind}">')
        for k, im in enumerate(shown_imgs):
            more = f'<span class="more" aria-hidden="true">+{len(images) - 4}</span>' if card and k == 3 and len(images) > 4 else ""
            out.append(f'{pad}    <a href="{NEWS_IMG}{im["file"]}">{picture(im["file"], im["alt"])}{more}</a>')
        out.append(f"{pad}  </div>")
    if p.get("video"):
        poster = SITE / NEWS_IMG.strip("/") / p.get("poster", "")
        size = 'width="{}" height="{}" '.format(*image_size(poster)) if p.get("poster") and poster.exists() else ""
        captions = f'<track kind="captions" src="{NEWS_VIDEO}{p["captions"]}" default>' if p.get("captions") else ""
        out.append(f'{pad}  <video class="post-video" controls preload="none" playsinline {size}'
                   + (f'poster="{NEWS_IMG}{p["poster"]}">' if p.get("poster") else ">")
                   + f'<source src="{NEWS_VIDEO}{p["video"]}" type="video/mp4">{captions}</video>')
    if p.get("preview"):
        img = picture(p["preview-image"], "") if p.get("preview-image") else ""
        title = escape(p.get("preview-title", shown(p["preview"])))
        out.append(f'{pad}  <a class="post-preview" href="{escape(p["preview"])}">{img}'
                   f'<span><b>{title}</b><small>{escape(shown(p["preview"]).split("/")[0])}</small></span></a>')
    links = []
    if p.get("link"):
        links.append(f'<a href="{escape(p["link"])}">{escape(p.get("link-text", "More"))}</a>')
    if p.get("source"):
        links.append(f'<a href="{escape(p["source"])}">On LinkedIn <span aria-hidden="true">↗</span></a>')
    if links:
        out.append(f'{pad}  <p class="post-foot">{"".join(links)}</p>')
    return "\n".join(out + [f"{pad}</article>"])


def block_news(args, news, indent):
    pad = " " * indent
    card = "all" not in args
    items = news[: int(args.get("limit", 3))] if card else news
    out = [pad + f'<ol class="posts {"cards" if card else "feed"}">']
    for p in items:
        li = "<li>" if card else f'<li id="post-{p["id"]}">'     # the feed's posts are the cards' targets
        out += [f"{pad}  {li}", render_post(p, pad + "    ", card), f"{pad}  </li>"]
    return "\n".join(out + [pad + "</ol>"])


MARK = re.compile(r"(?P<indent>[ \t]*)<!-- gen:(?P<name>\w+)(?P<args>[^>]*?)-->\n(?P<body>.*?)(?P=indent)<!-- /gen -->",
                  re.S)


def lastmod(page):
    """Date of the page's last commit, or today if it has uncommitted changes (or no git)."""
    rel = str(page.relative_to(SITE))
    git = lambda *a: subprocess.run(["git", *a, "--", rel], cwd=SITE, capture_output=True, text=True).stdout.strip()
    try:
        if not git("status", "--porcelain"):
            return git("log", "-1", "--format=%cs") or date.today().isoformat()
    except OSError:
        pass
    return date.today().isoformat()


def write_sitemap():
    pages = [p for p in PAGES if p.name == "index.html"]
    urls = sorted(("/" + str(p.parent.relative_to(SITE)) + "/").replace("/./", "/") for p in pages)
    urls.sort(key=lambda u: u != "/")                    # home first
    out = ['<?xml version="1.0" encoding="UTF-8"?>',
           '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">']
    for u in urls:
        page = SITE / u.lstrip("/") / "index.html"
        out += ["  <url>", f"    <loc>{ORIGIN}{u}</loc>", f"    <lastmod>{lastmod(page)}</lastmod>"]
        if u in PRESS.values():
            alts = [*PRESS.items(), ("x-default", PRESS["en"])]
            out += [f'    <xhtml:link rel="alternate" hreflang="{lang}" href="{ORIGIN}{href}"/>' for lang, href in alts]
        out.append("  </url>")
    text = "\n".join(out + ["</urlset>"]) + "\n"
    target = SITE / "sitemap.xml"
    if not target.exists() or target.read_text(encoding="utf-8") != text:
        target.write_text(text, encoding="utf-8")
        print("updated sitemap.xml")


def parse_args(s):
    args = {}
    for tok in s.split():
        k, _, v = tok.partition("=")
        args[k] = v or True
    return args


def main():
    pubs = load_pubs()
    news = load_news()
    for page in PAGES:
        html = page.read_text(encoding="utf-8")

        def fill(m):
            indent, args = len(m.group("indent").expandtabs()), parse_args(m.group("args"))
            if m.group("name") == "pubs":
                body = block_pubs(args, pubs, indent)
            elif m.group("name") == "news":
                body = block_news(args, news, indent)
            else:
                sys.exit(f"{page}: unknown block gen:{m.group('name')}")
            return f'{m.group("indent")}<!-- gen:{m.group("name")}{m.group("args")}-->\n{body}\n{m.group("indent")}<!-- /gen -->'

        new = MARK.sub(fill, html)
        if new != html:
            page.write_text(new, encoding="utf-8")
            print("updated", page.relative_to(SITE))
    write_sitemap()
    counts ={t: sum(t in p["topics"] for p in pubs) for t in TOPICS}
    print(f"{len(pubs)} printed publications;", ", ".join(f"{t} {n}" for t, n in counts.items()))


if __name__ == "__main__":
    main()

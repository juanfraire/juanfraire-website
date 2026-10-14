#!/usr/bin/env python3
"""Rewrite the generated blocks in the site's HTML, and write one page per publication.

Sources of truth:
- publications: ../cv/cv-juan-fraire.bib (the CV bibliography), with each paper's abstract and
                open copy from data/pub-meta.json (scripts/fetch_pubs.py, the only script that goes online)
- news:         data/news/*.md, one file per post (scripts/add_post.py copies LinkedIn posts)

Every printed publication gets a page of its own, publications/<slug>/index.html, written whole
(abstract, links, citation, share buttons); it is the address that "Share" hands out. The slug is
the year and the start of the title, e.g. /publications/2022-space-terrestrial-integrated-internet-of-things/.
A bib field `slug = {...}` pins it, for a paper whose title is corrected after its page was shared.
Pages whose paper left the bib are deleted.

It also rewrites sitemap.xml: every page except 404.html and the UNLISTED folders, with the date of the page's
last commit as lastmod (today for a page with uncommitted changes).

A generated block is everything between a start marker and its end marker:

    <!-- gen:pubs topic=orbital limit=5 -->  ...  <!-- /gen -->   featured papers of one topic
    <!-- gen:pubs all -->                   ...  <!-- /gen -->   the full list, grouped by year
    <!-- gen:pubs selected -->              ...  <!-- /gen -->   the CV's selected papers, as cards with a figure
                                                                 (data/pub-figures.json, from make_assets.py)
    <!-- gen:ld selected -->                ...  <!-- /gen -->   the same papers as JSON-LD (in <head>)
    <!-- gen:news limit=10 -->              ...  <!-- /gen -->   the latest posts, as a row of cards
    <!-- gen:news all -->                   ...  <!-- /gen -->   every post, as a feed

A news post is a few header lines between `---` lines, then the text as written on LinkedIn:

    ---
    date: 2026-07-03                 (or 2026-07: a month-only date leads its month)
    source: https://www.linkedin.com/feed/update/urn:li:activity:…/   (optional)
    image: 2026-07-03-cpd-1.jpg      (in assets/img/news/, with a .webp twin; repeat per image)
    alt: What the image shows        (follows its image)
    video: 2026-07-03-cpd.mp4        (in assets/video/news/), poster: 2026-07-03-cpd-poster.jpg
    preview: https://…               preview-title: …   preview-image: … (a link card)
                                     preview-site: D3TN on LinkedIn   (instead of the domain)
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
overrides the link on the website only (biber ignores it, so the CV keeps the DOI);
it also wins over the open copy that fetch_pubs.py found. So does a `url` on HAL or arXiv.
"""
from datetime import date
from html import escape, unescape
from pathlib import Path
from urllib.parse import quote
import json
import re
import shutil
import struct
import subprocess
import sys
import unicodedata

SITE = Path(__file__).resolve().parent.parent
BIB = SITE.parent / "cv/cv-juan-fraire.bib"
NEWS = SITE / "data/news"
NEWS_IMG, NEWS_VIDEO = "/assets/img/news/", "/assets/video/news/"
UNLISTED = {"timeline"}   # reachable by URL only: never rewritten, never in sitemap.xml


def site_pages():
    return sorted(p for p in SITE.rglob("*.html")
                  if "vendor" not in p.parts and not UNLISTED & set(p.relative_to(SITE).parts))


PAGES = site_pages()
ORIGIN = "https://juanfraire.space"
PRESS = {"en": "/press/", "es": "/es/prensa/", "fr": "/fr/presse/"}   # one page in three languages

PRINTED = ("book", "journal", "conference", "preprint")
TOPICS = ("dtn", "iot", "mega", "orbital")
TYPE_LABEL = {"book": "Book or chapter", "journal": "Journal", "conference": "Conference", "preprint": "Preprint"}
TOPIC_TILE = {"dtn": ("01", "t1", "Delay-tolerant networks"), "iot": ("02", "t2", "Satellite IoT"),
              "mega": ("03", "t3", "Mega-constellations"), "orbital": ("04", "t4", "Orbital computing")}
FIGURES_JSON = SITE / "data/pub-figures.json"          # written by make_assets.py: bib key -> figure
FIGURES = json.loads(FIGURES_JSON.read_text(encoding="utf-8")) if FIGURES_JSON.exists() else {}
META_JSON = SITE / "data/pub-meta.json"             # written by fetch_pubs.py: bib key -> abstract, open copy
META = json.loads(META_JSON.read_text(encoding="utf-8")) if META_JSON.exists() else {}
PAPERS = SITE / "publications"                       # each paper's page: publications/<slug>/index.html
GENERATED = "<!-- Written by scripts/generate.py from the bib and data/pub-meta.json; edits here are overwritten. -->"
TOPIC_PAGE = {"dtn": "/dtn/", "iot": "/satellite-iot/", "mega": "/mega-constellations/",
              "orbital": "/orbital-computing/"}
TYPE_NAME = {"book": "Book", "journal": "Journal article", "conference": "Conference paper", "preprint": "Preprint"}
# A paper's own link (bib url or weburl) on one of these hosts is a free copy, named as on the site.
OPEN_HOSTS = ((r"arxiv\.org/", "arXiv"), (r"hal\.science/|archives-ouvertes\.fr/", "HAL"), (r"ceur-ws\.org/", "CEUR-WS"),
              (r"digitalcommons\.usu\.edu/", "Digital Commons (USU)"), (r"sedici\.unlp\.edu\.ar/", "SEDICI (UNLP)"),
              (r"hdl\.handle\.net/2117/", "UPCommons"))
SLUG_STOP = {"a", "an", "and", "the", "of", "for", "in", "on", "to", "with", "via", "from", "by", "under",
             "towards", "toward", "at", "or", "its", "their"}
MONTHS =["January", "February", "March", "April", "May", "June", "July",
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
        link = doi_url(f["doi"].replace(r"\_", "_"))
    elif f.get("url"):
        link = f["url"].replace(r"\_", "_")
    elif f.get("eprint") and f.get("eprinttype", "").lower() == "arxiv":
        link = "https://arxiv.org/abs/" + f["eprint"]
    return {
        "key": entry["key"],
        "entry": entry,
        "bibtype": entry["type"],
        "doi": f.get("doi", "").replace(r"\_", "_"),
        "isbn": f.get("isbn", ""),
        "kind": kind,
        "title": detex(f.get("title", "")),
        "authors": authors(f.get("author", f.get("editor", ""))),
        "venue": detex(venue),
        "volume": f.get("volume", ""),
        "number": f.get("number", ""),
        "pages": detex(f.get("pages", "")),
        "year": int(re.sub(r"\D", "", f.get("year", "0")) or 0),
        "link": link,
        "weburl": f.get("weburl", ""),
        "slug": f.get("slug", ""),
        "topics": [t for t in TOPICS if t in kws],
        "selected": "selected" in kws,
        "flagged": "selected" in kws or "featured" in kws,
    }


def doi_url(doi):
    """DBLP gives some ACM papers a 10.5555 DOI that doi.org does not resolve; the ACM library does."""
    return ("https://dl.acm.org/doi/" if doi.startswith("10.5555/") else "https://doi.org/") + doi


def slugify(title, year):
    """The year and the start of the title: the part before a colon when it has three words or more."""
    ascii_title = unicodedata.normalize("NFKD", title).encode("ascii", "ignore").decode().lower()
    word = r"[a-z0-9]+(?:['-][a-z0-9]+)*"               # "non-terrestrial" is one word: never cut inside it
    words = [w.replace("'", "-") for w in re.findall(word, ascii_title)]
    head = [w.replace("'", "-") for w in re.findall(word, ascii_title.split(":")[0])]
    words, out = head if len(head) >= 3 else words, []
    for w in words:
        if out and len("-".join(out + [w])) > 52:
            break
        out.append(w)
    while len(out) > 2 and out[-1] in SLUG_STOP:
        out.pop()
    return f"{year}-{'-'.join(out)}"


def open_host(url):
    return next((label for pattern, label in OPEN_HOSTS if re.search(pattern, url or "")), None)


def same_url(a, b):
    norm = lambda u: re.sub(r"^https?://(www\.)?", "", u or "").rstrip("/").lower()
    return norm(a) == norm(b)


def paper_links(p, meta):
    """The free copy (HAL first, from fetch_pubs.py) and the publisher's version, each {url, label} or None.

    The bib wins: a weburl, or a url on HAL or arXiv, is the paper's free copy whatever was found."""
    found, main = meta.get("open"), p["link"]
    if open_host(main):
        return {"url": main, "label": open_host(main)}, None
    if found and same_url(found["url"], main):
        return found, None
    publisher = {"url": main, "label": "Publisher", "open": bool(meta.get("publisher_oa"))} if main else None
    return found, publisher


def load_pubs():
    pubs = [p for p in (to_pub(e) for e in parse_bib(BIB.read_text(encoding="utf-8"))) if p]
    pubs.sort(key=lambda p: (-p["year"], p["title"].lower()))
    seen = {}
    for p in sorted(pubs, key=lambda p: p["key"]):            # a fixed order, so a clash always resolves alike
        slug = p["slug"] or slugify(p["title"], p["year"])
        if slug in seen:
            n = 2
            while f"{slug}-{n}" in seen:
                n += 1
            print(f"warning: {p['key']} and {seen[slug]} share the slug {slug}; "
                  f"{p['key']} gets -{n} (pin one with a slug field in the bib)")
            slug = f"{slug}-{n}"
        seen[slug], p["slug"] = p["key"], slug
    for p in pubs:
        m = META.get(p["key"], {})
        p["abstract"], p["abstract_lang"] = m.get("abstract", ""), m.get("lang", "")
        p["open"], p["publisher"] = paper_links(p, m)
    return pubs

# ---------------------------------------------------------------- rendering

def by_line(p):
    names = [f"<strong>{escape(n)}</strong>" if n.endswith("Fraire") else escape(n) for n in p["authors"]]
    return ", ".join(names[:-1]) + (", and " if len(names) > 2 else " and ") + names[-1] if len(names) > 1 else "".join(names)


def page_url(p):
    return f"/publications/{p['slug']}/"


def linked_title(p):
    return f'<a href="{page_url(p)}">{escape(p["title"])}</a>'


def abstract_html(p):
    lang = f' lang="{escape(p["abstract_lang"])}"' if p["abstract_lang"] else ""
    return "".join(f"<p{lang}>{escape(para)}</p>" for para in p["abstract"].split("\n\n"))


def links_html(p):
    """Free copy, publisher, share. Free to read is marked by the class oa (an open padlock in the CSS)."""
    out, o, pub = [], p["open"], p["publisher"]
    if o:
        out.append(f'<a class="oa" href="{escape(o["url"])}" title="Free to read on {escape(o["label"])}">'
                   f'{escape(o["label"])}</a>')
    if pub:
        free = ' class="oa" title="Free to read at the publisher"' if pub["open"] else ""
        out.append(f'<a{free} href="{escape(pub["url"])}">Publisher</a>')
    out.append(f'<button type="button" class="share" data-share="{page_url(p)}" hidden>Share</button>')
    return "".join(out)


def render_pub(p, indent, anchor=False):
    """One entry of a list: title (to the paper's page), authors, venue, then the abstract and the links."""
    who, title = by_line(p), linked_title(p)
    venue = escape(p["venue"]) + (", " if p["venue"] else "") + str(p["year"])
    attrs = (f' id="{p["slug"]}"' if anchor else "") + f' data-type="{p["kind"]}" data-topics="{" ".join(p["topics"])}"'
    pad = " " * indent
    lines = [f'{pad}<li class="pub"{attrs}>',
             f'{pad}  <span class="pub-title">{title}</span>',
             f'{pad}  <span class="pub-authors">{who}</span>',
             f'{pad}  <span class="pub-venue">{venue}</span>']
    if p["abstract"]:
        lines.append(f'{pad}  <details class="pub-abs"><summary>Abstract</summary><div class="abs">{abstract_html(p)}</div></details>')
    lines.append(f'{pad}  <p class="pub-links">{links_html(p)}</p>')
    return "\n".join(lines + [f"{pad}</li>"])


def render_card(p, indent):
    """A selected paper as a card: its figure (from make_assets.py), or a topic tile without one."""
    num, cls, label = TOPIC_TILE.get(p["topics"][0] if p["topics"] else "", ("", "", TYPE_LABEL[p["kind"]]))
    f, pad = FIGURES.get(p["key"]), " " * indent
    if f:
        credit = f["credit"] if f["credit"].startswith("Cover") else f'Figure {f["credit"]}'   # a book's cover
        fig = (f'<figure class="fig"><picture><source srcset="{f["img"]}.webp" type="image/webp">'
               f'<img src="{f["img"]}.jpg" width="{f["width"]}" height="{f["height"]}" alt="{escape(f["alt"])}" '
               f'loading="lazy" decoding="async"></picture><figcaption>{escape(credit)}</figcaption></figure>')
    else:
        fig = f'<div class="fig nofig" aria-hidden="true"><b>{num}</b><small>{label}</small></div>'
    return (f'{pad}<li class="paper-card {cls}">\n'
            f'{pad}  {fig}\n'
            f'{pad}  <div class="body">\n'
            f'{pad}    <p class="meta">{label} · {p["year"]}</p>\n'
            f'{pad}    <h3>{linked_title(p)}</h3>\n'
            f'{pad}    <p class="pub-authors">{by_line(p)}</p>\n'
            f'{pad}    <p class="pub-venue">{escape(p["venue"])}</p>\n'
            f'{pad}  </div>\n'
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
            out.append(render_pub(p, indent + 2, anchor=True))
        out.append(" " * indent + "</ol>")
        return "\n".join(out)
    if "selected" in args:                    # the CV's flagship list, newest first, as cards
        lines = [" " * indent + '<ol class="paper-cards">'] + [render_card(p, indent + 2) for p in pubs if p["selected"]]
        return "\n".join(lines + [" " * indent + "</ol>"])
    topic, limit = args.get("topic"), int(args.get("limit", 5))
    chosen = [p for p in pubs if topic in p["topics"] and p["flagged"]][:limit]
    if not chosen:
        sys.exit(f"no selected/featured papers for topic {topic!r}")
    lines = [" " * indent + '<ol class="pubs">'] + [render_pub(p, indent + 2) for p in chosen]
    return "\n".join(lines + [" " * indent + "</ol>"])


def ld_work(p, abstract=False):
    """One paper as schema.org: a ScholarlyArticle, a Book or a Chapter, with what the bib gives.
    Its url is its page here; the publisher's version and the free copy are sameAs."""
    me = {"@type": "Person", "@id": ORIGIN + "/#person", "name": "Juan A. Fraire"}
    work = {"@type": {"book": "Book", "incollection": "Chapter", "inbook": "Chapter"}.get(p["bibtype"], "ScholarlyArticle"),
            "name": p["title"],
            "author": [me if n.endswith("Fraire") else {"@type": "Person", "name": n} for n in p["authors"]],
            "datePublished": str(p["year"])}
    if work["@type"] == "Book":
        work["publisher"] = {"@type": "Organization", "name": p["venue"]}
        if p["isbn"]:
            work["isbn"] = p["isbn"]
    elif p["kind"] == "journal":
        work["isPartOf"] = {"@type": "Periodical", "name": p["venue"]}
    work["url"] = ORIGIN + page_url(p)
    same = list(dict.fromkeys(u for u in (doi_url(p["doi"]) if p["doi"] else "", p["link"],
                                          (p["open"] or {}).get("url", "")) if u))
    if same:
        work["sameAs"] = same if len(same) > 1 else same[0]
    if abstract and p["abstract"]:
        work["abstract"] = p["abstract"]
    return work


def block_ld(args, pubs, indent):
    """JSON-LD for the publications page: a collection whose main entity is the list of selected papers."""
    pad = " " * indent
    items = [json.dumps({"@type": "ListItem", "position": k, "item": ld_work(p)}, ensure_ascii=False)
             for k, p in enumerate((p for p in pubs if p["selected"]), 1)]
    page = ORIGIN + "/publications/"
    head = [pad + '<script type="application/ld+json">', pad + "{",
            f'{pad}  "@context": "https://schema.org",',
            f'{pad}  "@type": "CollectionPage",',
            f'{pad}  "@id": "{page}#webpage",',
            f'{pad}  "url": "{page}",',
            f'{pad}  "name": "Publications of Juan A. Fraire",',
            f'{pad}  "inLanguage": "en",',
            f'{pad}  "isPartOf": {{"@id": "{ORIGIN}/#website"}},',
            f'{pad}  "about": {{"@id": "{ORIGIN}/#person"}},',
            f'{pad}  "mainEntity": {{',
            f'{pad}    "@type": "ItemList",',
            f'{pad}    "name": "Selected papers",',
            f'{pad}    "numberOfItems": {len(items)},',
            f'{pad}    "itemListElement": [']
    body = [pad + "      " + item.replace("</", "<\\/") + ("," if k < len(items) - 1 else "")
            for k, item in enumerate(items)]
    return "\n".join(head + body + [pad + "    ]", pad + "  }", pad + "}", pad + "</script>"])

# ---------------------------------------------------------------- one page per paper

CITE_FIELDS = ("author", "editor", "title", "journal", "booktitle", "series", "volume", "number", "pages",
               "publisher", "address", "school", "year", "isbn", "doi", "url", "eprint", "eprinttype")


def bibtex(p):
    """The bib entry to copy, without the fields that only the CV and this site read."""
    f, e = p["entry"]["fields"], p["entry"]
    keep = [n for n in CITE_FIELDS if f.get(n) and not (n == "url" and f.get("doi"))]
    width = max(map(len, keep), default=0)
    lines = [f"  {n.ljust(width)} = {{{f[n]}}}" for n in keep]
    return f"@{e['type']}{{{e['key']},\n" + ",\n".join(lines) + "\n}"


def short(text, limit):
    """The start of a text, cut at a word, for descriptions."""
    text = " ".join(text.split())
    return text if len(text) <= limit else text[:limit].rsplit(" ", 1)[0].rstrip(",;:") + "…"


def full_venue(p):
    """Venue with volume, number and pages when the bib has them: 'IEEE …, vol. 64, no. 6, pp. 30–36, 2026'."""
    parts = [escape(p["venue"])] if p["venue"] else []
    if p["volume"]:
        parts.append(f"vol. {escape(p['volume'])}")
    if p["number"]:
        parts.append(f"no. {escape(p['number'])}")
    if p["pages"]:
        parts.append(("pp. " if "–" in p["pages"] else "p. ") + escape(p["pages"]))
    return ", ".join(parts + [str(p["year"])])


def related(p, pubs, n=3):
    """A few other papers of the paper's first topic: flagged ones first, then the closest in time."""
    if not p["topics"]:
        return []
    same = [q for q in pubs if q is not p and p["topics"][0] in q["topics"]]
    return sorted(same, key=lambda q: (not q["flagged"], abs(q["year"] - p["year"]), -q["year"]))[:n]


def share_targets(url, title):
    """Where "Share" can send a paper: plain links, no script from those services."""
    q = lambda s: quote(s, safe="")
    return [("LinkedIn", f"https://www.linkedin.com/sharing/share-offsite/?url={q(url)}"),
            ("X", f"https://x.com/intent/post?text={q(title)}&url={q(url)}"),
            ("Bluesky", f"https://bsky.app/intent/compose?text={q(title + ' ' + url)}"),
            ("Email", f"mailto:?subject={q(title)}&body={q(title + chr(10) + url)}")]


def paper_page(p, pubs, chrome):
    """A paper's own page: what the list shows, plus the abstract in full, its citation and share links."""
    url, topic = ORIGIN + page_url(p), (p["topics"] or [""])[0]
    _, tone, topic_name = TOPIC_TILE.get(topic, ("", "", ""))
    desc = short(p["abstract"], 155) if p["abstract"] else short(
        f"{TYPE_NAME[p['kind']]} by {', '.join(p['authors'])}, {p['venue']}, {p['year']}.", 155)
    og_image, og_alt = chrome["og"].get(topic, chrome["og"][""])
    work = ld_work(p, abstract=True)
    ld = {"@context": "https://schema.org", "@type": work.pop("@type"), "@id": url + "#paper", "mainEntityOfPage": url,
          **work, "isAccessibleForFree": bool(p["open"] or (p["publisher"] or {}).get("open"))}
    ld_text = json.dumps(ld, ensure_ascii=False, indent=2).replace("</", "<\\/").replace("\n", "\n  ")
    o, pub = p["open"], p["publisher"]
    actions = []
    if o:
        actions.append(f'<a class="button oa" href="{escape(o["url"])}">Read on {escape(o["label"])}'
                       f'<small>free</small></a>')
    if pub:
        actions.append(f'<a class="button{" oa" if pub["open"] else ""}" href="{escape(pub["url"])}">'
                       f'Publisher’s version{"<small>free</small>" if pub["open"] else ""}</a>')
    doi = (f'<p class="paper-doi">DOI <a href="{escape(doi_url(p["doi"]))}">{escape(p["doi"])}</a></p>'
           if p["doi"] else "")
    fig = FIGURES.get(p["key"])
    figure = ""
    if fig:
        credit = fig["credit"] if fig["credit"].startswith("Cover") else f'Figure {fig["credit"]}'
        figure = (f'      <figure class="fig paper-fig"><picture><source srcset="{fig["img"]}.webp" type="image/webp">'
                  f'<img src="{fig["img"]}.jpg" width="{fig["width"]}" height="{fig["height"]}" alt="{escape(fig["alt"])}" '
                  f'decoding="async"></picture><figcaption>{escape(credit)}</figcaption></figure>\n')
    shares = "".join(f'<a href="{escape(href)}" target="_blank" rel="noopener">{name}</a>'
                     for name, href in share_targets(url, p["title"]))
    more = related(p, pubs)
    more_html = ""
    if more:
        items = "\n".join(render_pub(q, 8) for q in more)
        count = sum(topic in q["topics"] for q in pubs)
        more_html = (f'    <section class="wrap section paper-more" aria-labelledby="more-title">\n'
                     f'      <h2 id="more-title">More on {topic_name[0].lower() + topic_name[1:]}</h2>\n'
                     f'      <ol class="pubs">\n{items}\n      </ol>\n'
                     f'      <p class="links"><a href="{TOPIC_PAGE[topic]}">{topic_name}: the topic page</a>'
                     f' <a href="/publications/#{topic}">All {count} papers on this topic</a></p>\n'
                     f'    </section>\n')
    abstract = (f'      <section class="paper-abstract" aria-labelledby="abstract-title">\n'
                f'        <h2 id="abstract-title">Abstract</h2>\n'
                f'        {abstract_html(p)}\n'
                f'      </section>\n') if p["abstract"] else ""
    kicker = " · ".join(x for x in (TYPE_NAME[p["kind"]], topic_name, str(p["year"])) if x)
    body_style = f' style="--accent: var(--{tone})"' if tone else ""
    return f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{escape(p["title"])} · Juan A. Fraire</title>
  <meta name="description" content="{escape(desc)}">
  <link rel="canonical" href="{url}">
  <meta name="author" content="Juan A. Fraire">
  <meta name="theme-color" content="#070b16">
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="apple-touch-icon" href="/apple-touch-icon.png">
  <meta property="og:site_name" content="Juan A. Fraire">
  <meta property="og:type" content="article">
  <meta property="og:title" content="{escape(p["title"])}">
  <meta property="og:description" content="{escape(short(p["abstract"], 200) if p["abstract"] else desc)}">
  <meta property="og:locale" content="en_GB">
  <meta property="og:url" content="{url}">
  <meta property="og:image" content="{ORIGIN}{og_image}">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="og:image:alt" content="{escape(og_alt)}">
  <meta name="twitter:card" content="summary_large_image">
  <script type="application/ld+json">
  {ld_text}
  </script>
  <link rel="preload" href="/assets/fonts/inria-sans-latin-400-normal.woff2" as="font" type="font/woff2" crossorigin>
  <link rel="preload" href="/assets/fonts/inria-sans-latin-700-normal.woff2" as="font" type="font/woff2" crossorigin>
  <link rel="stylesheet" href="/assets/css/site.css">
  <script type="module" src="/assets/js/share.js"></script>
</head>
<body{body_style}>
  {GENERATED}
  <a class="skip" href="#main">Skip to content</a>

{chrome["header"]}
  <main id="main">
    <article class="wrap page-head paper-page" data-url="{url}">
      <p class="kicker"><a href="/publications/">Publications</a> <span aria-hidden="true">/</span> {escape(kicker)}</p>
      <h1>{escape(p["title"])}</h1>
      <p class="pub-authors">{by_line(p)}</p>
      <p class="pub-venue">{full_venue(p)}</p>
{f'      <p class="paper-actions">{"".join(actions)}</p>{chr(10)}' if actions else ""}      <div class="paper-share" role="group" aria-label="Share this paper">
        <span class="label">Share</span><button type="button" class="copy" data-copy="{url}" hidden>Copy link</button>{shares}
      </div>
{abstract}{figure}      <section class="paper-cite" aria-labelledby="cite-title">
        <h2 id="cite-title">Cite</h2>
        {doi}
        <details class="bibtex"><summary>BibTeX</summary><pre><code>{escape(bibtex(p))}</code></pre><button type="button" class="copy" data-copy-from="pre" hidden>Copy BibTeX</button></details>
      </section>
    </article>
{more_html}  </main>

{chrome["footer"]}</body>
</html>
"""


def page_chrome():
    """Header, footer and social cards shared with the hand-written pages, read from them."""
    shell = (SITE / "publications/index.html").read_text(encoding="utf-8")
    header = re.search(r"  <header class=\"site-head\">.*?</header>\n", shell, re.S).group(0)
    header = header.replace('aria-current="page"', 'aria-current="true"')   # the section, not this page
    footer = re.search(r"  <footer class=\"site-foot\">.*?</footer>\n", shell, re.S).group(0)
    og = {}
    for topic, path in [("", "/"), *TOPIC_PAGE.items()]:
        html = (SITE / path.strip("/") / "index.html").read_text(encoding="utf-8")
        image = re.search(r'<meta property="og:image" content="https://juanfraire\.space([^"]+)"', html).group(1)
        alt = unescape(re.search(r'<meta property="og:image:alt" content="([^"]*)"', html).group(1))
        og[topic] = (image, alt)
    return {"header": header, "footer": footer, "og": og}


def write_paper_pages(pubs):
    """publications/<slug>/index.html for every paper; pages of papers no longer in the bib are deleted."""
    chrome, written, wanted = page_chrome(), 0, set()
    for p in pubs:
        target = PAPERS / p["slug"] / "index.html"
        wanted.add(target.parent)
        html = paper_page(p, pubs, chrome)
        if not target.exists() or target.read_text(encoding="utf-8") != html:
            target.parent.mkdir(exist_ok=True)
            target.write_text(html, encoding="utf-8")
            written += 1
    for d in sorted(PAPERS.iterdir()):
        page = d / "index.html"
        if d.is_dir() and d not in wanted and page.exists() and GENERATED in page.read_text(encoding="utf-8"):
            shutil.rmtree(d)
            print(f"removed {d.relative_to(SITE)}/ (its paper left the bib, or its title changed: if the old "
                  f"address was shared, pin it with slug = {{{d.name}}} in the bib)")
    if written:
        print(f"wrote {written} paper pages in publications/")


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
                   f'<span><b>{title}</b><small>{escape(p.get("preview-site", shown(p["preview"]).split("/")[0]))}</small></span></a>')
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
    out = [pad + ('<ol class="posts cards" id="latest-posts">' if card else '<ol class="posts feed">')]
    for p in items:
        li = "<li>" if card else f'<li id="post-{p["id"]}">'     # the feed's posts are the cards' targets
        out += [f"{pad}  {li}", render_post(p, pad + "    ", card), f"{pad}  </li>"]
    if card:                                                     # the row of cards ends on a tile to the feed
        first = news[-1]["date"][:4] if news else ""
        out.append(f'{pad}  <li class="post-end"><a href="/news/">All news'
                   f'<small>{len(news)} posts since {first}</small></a></li>')
    return "\n".join(out + [pad + "</ol>"])


MARK = re.compile(r"(?P<indent>[ \t]*)<!-- gen:(?P<name>\w+)(?P<args>[^>]*?)-->\n(?P<body>.*?)(?P=indent)<!-- /gen -->",
                  re.S)


def commit_dates():
    """A lastmod(page) function: the date of the page's last commit, or today if it has uncommitted
    changes (or there is no git). Two git calls in all, however many pages."""
    today = date.today().isoformat()
    run = lambda *a: subprocess.run(["git", *a], cwd=SITE, capture_output=True, text=True).stdout
    try:
        log, status = run("log", "--format=%x00%cs", "--name-only"), run("status", "--porcelain", "--untracked-files=all")
    except OSError:
        return lambda page: today
    dates, current = {}, None
    for line in log.splitlines():
        if line.startswith("\0"):
            current = line[1:]
        elif line and line not in dates:
            dates[line] = current
    changed = {line[3:].split(" -> ")[-1].strip('"') for line in status.splitlines()}
    def lastmod(page):
        rel = str(page.relative_to(SITE))
        return today if rel in changed else dates.get(rel, today)
    return lastmod


def write_sitemap():
    pages = [p for p in site_pages() if p.name == "index.html"]
    urls = sorted(("/" + str(p.parent.relative_to(SITE)) + "/").replace("/./", "/") for p in pages)
    urls.sort(key=lambda u: u != "/")                    # home first
    out = ['<?xml version="1.0" encoding="UTF-8"?>',
           '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">']
    lastmod = commit_dates()
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
            elif m.group("name") == "ld":
                body = block_ld(args, pubs, indent)
            elif m.group("name") == "news":
                body = block_news(args, news, indent)
            else:
                sys.exit(f"{page}: unknown block gen:{m.group('name')}")
            return f'{m.group("indent")}<!-- gen:{m.group("name")}{m.group("args")}-->\n{body}\n{m.group("indent")}<!-- /gen -->'

        new = MARK.sub(fill, html)
        if new != html:
            page.write_text(new, encoding="utf-8")
            print("updated", page.relative_to(SITE))
    write_paper_pages(pubs)
    write_sitemap()
    counts ={t: sum(t in p["topics"] for p in pubs) for t in TOPICS}
    print(f"{len(pubs)} printed publications;", ", ".join(f"{t} {n}" for t, n in counts.items()))
    with_abs, with_open = sum(bool(p["abstract"]) for p in pubs), sum(bool(p["open"]) for p in pubs)
    print(f"{with_abs} with an abstract, {with_open} with a free copy (scripts/fetch_pubs.py --report lists the rest)")


if __name__ == "__main__":
    main()

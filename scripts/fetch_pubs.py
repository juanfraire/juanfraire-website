#!/usr/bin/env python3
"""Find each publication's abstract and open copy, and keep them in data/pub-meta.json.

generate.py reads that file and never goes online; this script is the only one that does.
It asks public services that need no account or key:

- HAL (api.archives-ouvertes.fr): every record with Fraire as an author, in one query;
- arXiv (export.arxiv.org): the same, in one query;
- OpenAlex (api.openalex.org): by DOI, in batches, and by title for entries without a DOI;
- Semantic Scholar (api.semanticscholar.org): by DOI in one batch, by title for the others;
- Crossref (api.crossref.org): the abstracts that publishers deposit, by DOI.

A record is matched to a bib entry by DOI, or else by a near-identical title of a nearby year
(the closest pairs first, and each record to one entry only).

Open copy, the first that exists: the HAL record with its full text; arXiv; another repository
that OpenAlex knows (a university's, Zenodo…). `publisher_oa` says the publisher's version is
itself free to read. Abstract, the first that passes the checks in `usable()`: Crossref
(the publisher's), Semantic Scholar, OpenAlex, HAL, arXiv. HAL comes late because its
abstract field is typed in by whoever deposits the file, and it sometimes holds a cover
letter or a publisher's notice instead.

    python3 scripts/fetch_pubs.py            # new entries, and those still missing something
    python3 scripts/fetch_pubs.py --all      # every entry again
    python3 scripts/fetch_pubs.py --key K    # one entry again, e.g. after depositing it on HAL
    python3 scripts/fetch_pubs.py --report   # what is missing, offline: no queries
    then: python3 scripts/generate.py

A service that is down or refuses (OpenAlex has a daily budget without a key; a free key in
OPENALEX_API_KEY raises it) is skipped with a warning, and entries keep what they had from it.

Hand edits survive: an abstract whose `abstract_from` is "manual", or an open copy whose `from`
is "manual", is never replaced, and an entry with "keep": true is never touched. Entries whose
bib key is gone are dropped. Standard library only.
"""
from concurrent.futures import ThreadPoolExecutor
from difflib import SequenceMatcher
from html import unescape
from pathlib import Path
import argparse
import json
import os
import re
import sys
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET

sys.path.insert(0, str(Path(__file__).resolve().parent))
import generate  # noqa: E402  (the bib parser)

SITE = generate.SITE
META = SITE / "data/pub-meta.json"
CONTACT = "juan.fraire@inria.fr"           # OpenAlex and Crossref ask callers to identify themselves
AGENT = f"juanfraire.space/1.0 (https://juanfraire.space; mailto:{CONTACT})"
SOURCE_ORDER = ("crossref", "semanticscholar", "openalex", "hal", "arxiv")

# Repositories as OpenAlex names them -> the label on the site. None: an index or an aggregator
# that points elsewhere, never a copy of its own.
REPOSITORIES = {
    "HAL (Le Centre pour la Communication Scientifique Directe)": "HAL",
    "INRIA a CCSD electronic archive server": "HAL",
    "arXiv (Cornell University)": "arXiv",
    "Conicet": "CONICET Digital",
    "CONICET Digital (CONICET)": "CONICET Digital",
    "Publications of the UdS (Saarland University)": "Saarland University",
    "PORTO@Iris": "PORTO@Iris (Politecnico di Torino)",
    "UPCommons institutional repository (Universitat Politècnica de Catalunya)": "UPCommons",
    "University of Twente Research Information": "University of Twente",
    "Universidad de Chile": "Universidad de Chile",
    "Zenodo (CERN European Organization for Nuclear Research)": "Zenodo",
    "El Servicio de Difusión de la Creación Intelectual": "SEDICI (UNLP)",
    "Digital Commons - USU": "Digital Commons (USU)",
    "DOAJ (DOAJ: Directory of Open Access Journals)": None,
    "Greater South Information System": None,
    "LA Referencia (Red Federada de Repositorios Institucionales de Publicaciones Científicas)": None,
    "Americanae (AECID Library)": None,
}

DISCIPLINES = {"info": "computer science", "spi": "engineering sciences", "chim": "chemical sciences",
               "phys": "physics", "math": "mathematics", "scco": "cognitive science", "sdv": "life sciences"}

# ---------------------------------------------------------------- web


def get(url, data=None, tries=5, accept="application/json"):
    """Fetch a URL, waiting and retrying when a service says it is busy."""
    headers = {"User-Agent": AGENT, "Accept": accept}
    if data is not None:
        headers["Content-Type"] = "application/json"
        data = json.dumps(data).encode()
    for k in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, data, headers), timeout=60) as r:
                body = r.read()
            return json.loads(body) if accept == "application/json" else body.decode("utf-8")
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None
            if e.code not in (429, 500, 502, 503, 504) or k == tries - 1:
                raise
            wait = e.headers.get("Retry-After", "")
            if wait.isdigit() and int(wait) > 120:      # a daily budget spent (OpenAlex): no use waiting
                raise
            if wait.isdigit():
                time.sleep(int(wait))
                continue
        except (urllib.error.URLError, TimeoutError):
            if k == tries - 1:
                raise
        time.sleep(3 * 2 ** k)


def ask(name, fn, *args, default=None):
    """Call one service; if it stays down or refuses, say so and go on without it. Entries then keep
    what data/pub-meta.json already had from that service (see fetch)."""
    try:
        return fn(*args)
    except (urllib.error.URLError, TimeoutError, ET.ParseError, json.JSONDecodeError) as e:
        if name not in DOWN:
            print(f"  warning: {name} unavailable ({e}); entries keep what they had from it")
        DOWN.add(name)
        return default


DOWN = set()


# ---------------------------------------------------------------- text


def fold(s):
    """Lowercase ASCII words only, for comparing titles."""
    s = unicodedata.normalize("NFKD", generate.detex(s or "")).encode("ascii", "ignore").decode()
    return " ".join(re.findall(r"[a-z0-9]+", s.lower()))


def is_me(name):
    """Juan A. Fraire in any spelling the services use, and nobody else called Fraire."""
    n = fold(name)
    return n.endswith("fraire") and (n.startswith("j ") or n.startswith("juan")) and not n.startswith("juan c ")


LATEX_MATH = {r"\mu": "µ", r"\times": "×", r"\leq": "≤", r"\geq": "≥", r"\approx": "≈", r"\sim": "~",
              r"\pm": "±", r"\%": "%", r"\alpha": "α", r"\beta": "β", r"\gamma": "γ", r"\lambda": "λ"}


def clean(text):
    """An abstract as plain text: no markup, no 'Abstract' label, no copyright line; paragraphs kept."""
    if not text:
        return ""
    s = text.replace("\r", "")
    s = re.sub(r"</?(?:jats:)?(?:p|sec|div|br)\b[^>]*>", "\n\n", s)            # block tags: paragraph breaks
    s = re.sub(r"<(?:jats:)?title>\s*Abstract\s*</(?:jats:)?title>", "", s, flags=re.I)
    s = re.sub(r"<(?:jats:)?sub>(.*?)</(?:jats:)?sub>", r"\1", s)             # CO<sub>2</sub> -> CO2
    s = re.sub(r"<[^>]+>", "", s)
    s = unescape(s)
    for tex, char in LATEX_MATH.items():
        s = s.replace(tex, char)
    font = r"\\(?:emph|textit|textbf|texttt|text|mathrm|mathbf|mathit|mathsf|mathcal|boldsymbol)\s*\{([^{}]*)\}"
    while re.search(font, s):                                                  # $\boldsymbol{µ}\mathbf{D}$ -> $µD$
        s = re.sub(font, r"\1", s)
    s = re.sub(r"\$([^$]{1,80})\$", lambda m: re.sub(r"[{}\\]", "", m.group(1)), s)          # $h_{Delay}$ -> h_Delay
    s = s.replace("~", " ").replace("``", "“").replace("''", "”").replace("---", "—").replace("--", "–")
    s = re.sub(r"^\s*(?:International audience|Abstract|ABSTRACT)\s*[:.—–-]?\s*", "", s)
    s = re.sub(r"\s*(?:©|\(c\)|Copyright)\s*(?:19|20)\d\d\b[^\n]*$", "", s, flags=re.I)
    paras = [re.sub(r"[ \t\n]+", " ", p).strip() for p in re.split(r"\n\s*\n", s)]
    return "\n\n".join(p for p in paras if p)


BOILERPLATE = re.compile(
    r"this is a pdf file of an article|article in press|accepted manuscript|response to (?:the )?reviewers?"
    r"|we thank the (?:anonymous )?reviewers|the reviewers? (?:asked|suggested|pointed)|^\s*1\.\s|^\s*\(1\)\s"
    r"|this paper is withdrawn|no abstract available", re.I)


def usable(text):
    """Why an abstract cannot be used, or '' when it can."""
    if len(text) < 200:
        return "too short"
    if len(text) > 4000:
        return "too long"
    if BOILERPLATE.search(text):
        return "not an abstract"
    return ""


def overlap(title, abstract):
    """Share of the title's longer words found in the abstract: a check that both are the same paper."""
    words = {w for w in fold(title).split() if len(w) > 4}
    found = set(fold(abstract).split())
    return len(words & found) / len(words) if words else 1.0


# ---------------------------------------------------------------- sources


def hal_records():
    fields = ("halId_s,uri_s,submitType_s,docType_s,doiId_s,arxivId_s,title_s,producedDateY_i,"
              "abstract_s,en_abstract_s,fileMain_s,openAccess_bool,authFullName_s,language_s,domain_s")
    q = urllib.parse.urlencode({"q": "authLastName_s:Fraire", "fl": fields, "rows": 2000, "wt": "json"})
    docs = get("https://api.archives-ouvertes.fr/search/?" + q)["response"]["docs"]
    out = []
    for d in docs:
        if not any(is_me(n) for n in d.get("authFullName_s", [])):
            continue
        fields_of = {s.split(".")[1] for s in d.get("domain_s", []) if s.startswith("0.")}
        if "sdv" in fields_of:          # another Juan Fraire, in life sciences (some of these HAL also files under
            continue                    # Juan A.'s idHal); not "chim": a few of Juan A.'s papers were filed there
        abstract = (d.get("en_abstract_s") or d.get("abstract_s") or [""])[0]
        out.append({"id": d["halId_s"], "doi": (d.get("doiId_s") or "").lower(), "titles": d.get("title_s", []),
                    "year": d.get("producedDateY_i") or 0, "abstract": abstract,
                    "lang": "en" if d.get("en_abstract_s") else (d.get("language_s") or ["en"])[0],
                    "file": d.get("submitType_s") == "file" and bool(d.get("openAccess_bool")),
                    "embargo": d.get("submitType_s") == "file" and not d.get("openAccess_bool"),
                    "kind": d.get("submitType_s"), "arxiv": d.get("arxivId_s", ""),
                    "domains": sorted(fields_of)})
    return out


def arxiv_records():
    q = urllib.parse.urlencode({"search_query": "au:Fraire", "start": 0, "max_results": 500})
    root = ET.fromstring(get("https://export.arxiv.org/api/query?" + q, accept="application/atom+xml"))
    ns = {"a": "http://www.w3.org/2005/Atom", "x": "http://arxiv.org/schemas/atom"}
    out = []
    for e in root.findall("a:entry", ns):
        if not any(is_me(a.findtext("a:name", "", ns)) for a in e.findall("a:author", ns)):
            continue
        doi = e.find("x:doi", ns)
        out.append({"id": re.sub(r"v\d+$", "", e.findtext("a:id", "", ns).split("/abs/")[-1]),
                    "doi": (doi.text if doi is not None else "").lower(),
                    "titles": [" ".join(e.findtext("a:title", "", ns).split())],
                    "year": int(e.findtext("a:published", "0", ns)[:4]),
                    "abstract": e.findtext("a:summary", "", ns)})
    return out


OPENALEX_FIELDS = "id,doi,title,publication_year,abstract_inverted_index,open_access,locations,authorships"


def openalex(params):
    """OpenAlex grants a small daily budget without a key, enough for the usual run on new entries;
    a free key (openalex.org) in OPENALEX_API_KEY raises it, for --all runs."""
    params = {**params, "select": OPENALEX_FIELDS, "mailto": CONTACT}
    if os.environ.get("OPENALEX_API_KEY"):
        params["api_key"] = os.environ["OPENALEX_API_KEY"]
    return get("https://api.openalex.org/works?" + urllib.parse.urlencode(params, safe=":/|"))["results"]


def openalex_abstract(work):
    index = work.get("abstract_inverted_index")
    if not index:
        return ""
    return " ".join(w for _, w in sorted((p, w) for w, ps in index.items() for p in ps))


def openalex_by_doi(dois):
    works = {}
    for i in range(0, len(dois), 40):
        for w in openalex({"filter": "doi:" + "|".join(dois[i:i + 40]), "per_page": 50}):
            works[(w.get("doi") or "").replace("https://doi.org/", "").lower()] = w
    return works


def openalex_by_title(pub):
    for w in openalex({"search": fold(pub["title"]), "per_page": 5}):
        mine = any(is_me(a["author"].get("display_name", "")) for a in w.get("authorships", []))
        if mine and SequenceMatcher(None, fold(w.get("title")), fold(pub["title"])).ratio() > 0.93:
            return w
    return None


def s2_by_doi(dois):
    fields = "title,abstract,externalIds,year"
    rows = get(f"https://api.semanticscholar.org/graph/v1/paper/batch?fields={fields}",
               data={"ids": ["DOI:" + d for d in dois]}) or []
    return {d: r for d, r in zip(dois, rows) if r}


def s2_by_title(pub):
    q = urllib.parse.urlencode({"query": pub["title"], "fields": "title,abstract,year,authors"})
    try:
        r = get("https://api.semanticscholar.org/graph/v1/paper/search/match?" + q)
    except urllib.error.HTTPError:
        return None
    for w in (r or {}).get("data", []):
        mine = any(is_me(a.get("name", "")) for a in w.get("authors", []))
        if mine and SequenceMatcher(None, fold(w.get("title")), fold(pub["title"])).ratio() > 0.93:
            return w
    return None


def crossref_abstract(doi):
    r = get("https://api.crossref.org/works/" + urllib.parse.quote(doi) + "?mailto=" + CONTACT)
    return ((r or {}).get("message") or {}).get("abstract", "")


# ---------------------------------------------------------------- matching


def match(pubs, records, years_before=1, years_after=1, threshold=0.9):
    """{bib key: record}. DOI pairs first, then title pairs from the closest down; one record per entry.

    A record's year may precede the paper's by up to `years_before` (a preprint) and follow it
    by `years_after` (an early-access paper whose volume came out later)."""
    pairs = []
    for p in pubs:
        for r in records:
            if p["doi"] and r["doi"] and p["doi"].lower() == r["doi"]:
                pairs.append((2.0, r.get("file", False), p["key"], r["id"]))
                continue
            if r["year"] and p["year"] and not -years_before <= r["year"] - p["year"] <= years_after:
                continue
            score = max((SequenceMatcher(None, fold(t), fold(p["title"])).ratio() for t in r["titles"]), default=0)
            if score >= threshold:
                pairs.append((score, r.get("file", False), p["key"], r["id"]))
    pairs.sort(reverse=True)
    by_id, taken, out = {r["id"]: r for r in records}, set(), {}
    for score, _, key, rid in pairs:
        if key not in out and rid not in taken:
            out[key] = dict(by_id[rid], score=round(score, 3))
            taken.add(rid)
    return out


def open_copy(pub, hal, arx, work):
    """The open copy to link, HAL first. None when only the publisher has the paper."""
    if hal and hal["file"]:
        return {"url": f"https://hal.science/{hal['id']}", "label": "HAL", "from": "hal"}
    if arx:
        return {"url": f"https://arxiv.org/abs/{arx['id']}", "label": "arXiv", "from": "arxiv"}
    for loc in (work or {}).get("locations", []):
        source = (loc.get("source") or {})
        name = source.get("display_name", "")
        if not loc.get("is_oa") or source.get("type") != "repository":
            continue
        label = REPOSITORIES.get(name, re.sub(r"\s*\(.*\)$", "", name)) if name else None
        url = loc.get("landing_page_url") or loc.get("pdf_url")
        if label and url and "doi.org/" not in url and "proxy" not in url:      # a library proxy is not public
            if label == "arXiv":
                url = re.sub(r"v\d+$", "", url.replace("http://", "https://"))
            return {"url": url, "label": label, "from": "openalex"}
    return None


def publisher_open(work):
    """True when the publisher's own page is free to read (gold, hybrid, bronze or diamond)."""
    oa = (work or {}).get("open_access") or {}
    return oa.get("oa_status") in ("gold", "hybrid", "bronze", "diamond")


# ---------------------------------------------------------------- main


def load_meta():
    return json.loads(META.read_text(encoding="utf-8")) if META.exists() else {}


def save_meta(meta, pubs):
    order = {p["key"]: k for k, p in enumerate(pubs)}
    meta = {k: meta[k] for k in sorted(meta, key=lambda k: order.get(k, 1e9))}
    META.write_text(json.dumps(meta, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")


def complete(entry):
    return bool(entry.get("abstract")) and bool(entry.get("open") or entry.get("publisher_oa"))


def fetch(pubs, meta, everything, keys=()):
    todo = [p for p in pubs if not meta.get(p["key"], {}).get("keep")
            and (p["key"] in keys if keys else everything or not complete(meta.get(p["key"], {})))]
    if not todo:
        print("nothing to fetch; --all fetches every entry again")
        return meta
    print(f"fetching {len(todo)} of {len(pubs)} entries")
    dois = sorted({p["doi"].lower() for p in todo if p["doi"]})

    # HAL and arXiv come whole, so they are also matched against every bib entry, printed or not:
    # what is left over is on HAL or arXiv but not in the CV.
    hal_all, arx_all = ask("HAL", hal_records, default=[]), ask("arXiv", arxiv_records, default=[])
    hal = match(pubs, hal_all, years_before=2, years_after=1)
    arx = match(pubs, arx_all, years_before=3, years_after=1)
    print(f"  HAL: {len(hal)} of {len(pubs)} matched, arXiv: {len(arx)}")
    bib = [{"key": e["key"], "doi": e["fields"].get("doi", "").lower(), "title": generate.detex(e["fields"].get("title", "")),
            "year": int(re.sub(r"\D", "", e["fields"].get("year", "0")) or 0)}
           for e in generate.parse_bib(generate.BIB.read_text(encoding="utf-8"))]
    used = {r["id"] for r in match(bib, hal_all, 2, 1).values()} | {r["id"] for r in match(bib, arx_all, 3, 1).values()}
    extra = [r for r in hal_all if r["id"] not in used and r["kind"] == "file"] + \
            [r for r in arx_all if r["id"] not in used]
    if extra:
        print("  on HAL or arXiv with full text, but in no bib entry (missing from the CV, or a preprint):")
        for r in sorted(extra, key=lambda r: -r["year"]):
            print(f"    {r['year']}  {r['id']}  {r['titles'][0][:90]}" + (f"  doi:{r['doi']}" if r["doi"] else ""))
    works = ask("OpenAlex", openalex_by_doi, dois, default={})
    for p in todo:
        if not p["doi"]:
            w = ask("OpenAlex", openalex_by_title, p)
            if w:
                works[p["key"]] = w
    print(f"  OpenAlex: {len(works)} found")
    s2 = ask("Semantic Scholar", s2_by_doi, dois, default={}) if dois else {}
    for p in todo:
        if not p["doi"]:
            w = ask("Semantic Scholar", s2_by_title, p)
            if w:
                s2[p["key"]] = w
            time.sleep(1.1)                      # Semantic Scholar's limit without a key
    print(f"  Semantic Scholar: {len(s2)} found")
    with ThreadPoolExecutor(5) as ex:
        crossref = dict(zip(dois, ex.map(lambda d: ask("Crossref", crossref_abstract, d, default=""), dois)))
    print(f"  Crossref: {sum(1 for a in crossref.values() if a)} abstracts")

    for p in todo:
        key, doi = p["key"], p["doi"].lower()
        old = meta.get(key, {})
        h, a, w = hal.get(key), arx.get(key), works.get(doi) or works.get(key)
        s = s2.get(doi) or s2.get(key)
        candidates = {"crossref": crossref.get(doi, ""), "semanticscholar": (s or {}).get("abstract") or "",
                      "openalex": openalex_abstract(w) if w else "", "hal": (h or {}).get("abstract", ""),
                      "arxiv": (a or {}).get("abstract", "")}
        entry = {"title": p["title"]}
        if old.get("abstract_from") == "manual":
            entry.update({k: old[k] for k in ("abstract", "abstract_from", "lang") if k in old})
        else:
            rejected, texts = [], {s: clean(candidates[s]) for s in SOURCE_ORDER}
            for source in SOURCE_ORDER:
                text = texts[source]
                why = usable(text) if text else ""
                # an abstract without a word of the title may belong to another paper (OpenAlex has given
                # one about radiometry to a SmallSat paper): it stands only if another source agrees
                if text and not why and overlap(p["title"], text) < 0.1 and not any(
                        s != source and t and SequenceMatcher(None, t, text).ratio() > 0.5 for s, t in texts.items()):
                    why = "no word of the title, and no other source agrees"
                if text and not why:
                    entry["abstract"], entry["abstract_from"] = text, source
                    if source == "hal" and h.get("lang") not in ("en", None):
                        entry["lang"] = h["lang"]
                    break
                if text:
                    rejected.append(f"{source}: {why}")
            if rejected:
                entry["rejected"] = rejected
            if "abstract" not in entry and old.get("abstract") and not texts.get(old.get("abstract_from")):
                entry.update({k: old[k] for k in ("abstract", "abstract_from", "lang") if k in old})   # a service that was down
        found = open_copy(p, h, a, w)
        if (old.get("open") or {}).get("from") == "manual":
            entry["open"] = old["open"]
        elif found:
            entry["open"] = found
        elif old.get("open"):
            entry["open"] = old["open"]
        entry["publisher_oa"] = publisher_open(w) or old.get("publisher_oa", False)
        if h:
            entry["hal"] = h["id"] + ("" if h["file"] else f" ({'embargo' if h['embargo'] else h['kind']})")
            hal_text, fixes = clean(h["abstract"]), []                 # worth fixing on HAL itself
            if h["file"] and (not hal_text or usable(hal_text)):
                fixes.append(f"abstract field: {usable(hal_text) if hal_text else 'empty'}")
            if "chim" in h["domains"]:                                  # filed under chemistry by mistake
                fixes.append(f"discipline: {', '.join(DISCIPLINES.get(d, d) for d in h['domains'])}")
            if fixes:
                entry["hal_fix"] = fixes
        if a:
            entry["arxiv"] = a["id"]
        if h and h.get("score", 2) < 2 or a and a.get("score", 2) < 2:
            entry["matched_by_title"] = [f"{n} {r['id']} {r['score']}" for n, r in (("hal", h), ("arxiv", a)) if r and r["score"] < 2]
        meta[key] = entry
    return meta


def report(pubs, meta):
    links = {p["key"]: generate.paper_links(p, meta.get(p["key"], {})) for p in pubs}   # as the site shows them
    missing_abs = [p for p in pubs if not meta.get(p["key"], {}).get("abstract")]
    missing_open = [p for p in pubs if not links[p["key"]][0]]
    closed = [p for p in missing_open if not (links[p["key"]][1] or {}).get("open")]
    print(f"\n{len(pubs)} publications: {len(pubs) - len(missing_abs)} with an abstract, "
          f"{len(pubs) - len(missing_open)} with a free copy, {len(missing_open) - len(closed)} more "
          f"free at the publisher, {len(closed)} closed")
    if missing_abs:
        print("\nno abstract:")
        for p in missing_abs:
            print(f"  {p['year']}  {p['key']}  {p['title'][:80]}")
    if closed:
        print("\nno open copy (candidates for HAL):")
        for p in closed:
            note = meta.get(p["key"], {}).get("hal", "")
            print(f"  {p['year']}  {p['key']}  {p['title'][:80]}" + (f"  [HAL {note}]" if note else ""))
    fix = [(p, meta[p["key"]]) for p in pubs if meta.get(p["key"], {}).get("hal_fix")]
    if fix:
        print("\nHAL records to fix on HAL:")
        for p, e in fix:
            print(f"  {e['hal']}  {p['title'][:60]}: {'; '.join(e['hal_fix'])}")
    flagged = [(p, meta[p["key"]]) for p in pubs if p["key"] in meta and meta[p["key"]].get("abstract")
               and meta[p["key"]].get("abstract_from") != "manual"         # checked by hand already
               and overlap(p["title"], meta[p["key"]]["abstract"]) < 0.25]
    if flagged:
        print("\nabstracts that share few words with their title (check they are the right paper):")
        for p, e in flagged:
            print(f"  {p['key']}  ({e['abstract_from']})  {p['title'][:70]}")


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--all", action="store_true", help="fetch every entry again, not only new or incomplete ones")
    ap.add_argument("--key", action="append", default=[], help="fetch only this bib key (repeatable)")
    ap.add_argument("--report", action="store_true", help="only print what is missing; no queries")
    args = ap.parse_args()
    pubs = generate.load_pubs()
    meta = load_meta()
    unknown = set(args.key) - {p["key"] for p in pubs}
    if unknown:
        sys.exit(f"not a printed bib entry: {', '.join(sorted(unknown))}")
    if not args.report:
        keys = {p["key"] for p in pubs}
        meta = {k: v for k, v in meta.items() if k in keys}
        meta = fetch(pubs, meta, args.all, set(args.key))
        save_meta(meta, pubs)
        print(f"wrote {META.relative_to(SITE)}")
    report(pubs, meta)


if __name__ == "__main__":
    main()

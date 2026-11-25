"""Review official-source signals or print a Brazil draft; never write holiday data."""

import argparse
import hashlib
import json
import os
import sys
import unicodedata
from datetime import date
from html import escape
from html.parser import HTMLParser
from http.client import HTTPException, IncompleteRead
from pathlib import Path
from typing import NamedTuple
from urllib.error import HTTPError, URLError
from urllib.parse import urldefrag, urljoin, urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / "scripts" / "holiday-source-review.json"
REGIONS = ("in", "br")
MAX_BYTES = 16 * 1024 * 1024
BLOCKS = {"br", "div", "dl", "dt", "dd", "h1", "h2", "h3", "li", "p", "td", "th", "tr"}


class Result(NamedTuple):
    level: str
    message: str


def normalize(text):
    return " ".join(unicodedata.normalize("NFC", text).split())


def fingerprint(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False).encode("utf-8")).hexdigest()


def document_link(base, href):
    if not href or href.strip().startswith("#"):
        return None
    url = urldefrag(urljoin(base, href.strip())).url
    return url if urlsplit(url).scheme in {"http", "https"} else None


class Section(HTMLParser):
    """Capture one known HTML section, excluding site chrome and script/style text."""

    def __init__(self, selector, url):
        super().__init__()
        self.selector = selector
        self.url = url
        self.tag = selector.split("#")[0].split(".")[0]
        self.depth = self.matches = 0
        self.ignored = None
        self.text = []
        self.links = set()
        self.notices = set()
        self.fields = {}
        self.headline = ""

    def handle_starttag(self, tag, attrs):
        if self.ignored:
            return
        attrs = dict(attrs)
        if not self.depth:
            if tag == self.tag and (self.selector == tag or
                                     self.selector == f"{tag}#{attrs.get('id')}" or
                                     self.selector in {f"{tag}.{cls}" for cls in (attrs.get("class") or "").split()}):
                self.depth = 1
                self.matches += 1
            return
        if tag in {"script", "style"}:
            self.ignored = tag
            return
        if tag == self.tag:
            self.depth += 1
        if tag in BLOCKS:
            self.text.append(" ")
        link = document_link(self.url, attrs.get("href")) if tag == "a" else None
        if link:
            self.links.add(link)
            if "p" in self.fields:
                self.fields["p"][1].add(link)
        if tag in {"h2", "p", "a"}:
            self.fields[tag] = ([], {link} if link else set())

    def handle_endtag(self, tag):
        if self.ignored:
            if self.ignored == tag:
                self.ignored = None
            return
        if not self.depth:
            return
        if tag == self.tag:
            self.depth -= 1
        if tag in BLOCKS:
            self.text.append(" ")
        if tag in self.fields:
            parts, links = self.fields.pop(tag)
            text = normalize("".join(parts))
            if tag == "h2":
                self.headline = text
            if text or (tag == "p" and links):
                self.notices.add((tag, self.headline if tag == "p" else "", text, tuple(sorted(links))))

    def handle_data(self, data):
        if self.depth and not self.ignored:
            self.text.append(data)
            for parts, _ in self.fields.values():
                parts.append(data)


def observe(source, body, charset):
    kind = source["kind"]
    if kind == "pdf":
        if not body.startswith(b"%PDF-") or not body.rstrip().endswith(b"%%EOF"):
            raise ValueError("response is not a complete PDF")
        return hashlib.sha256(body).hexdigest()

    section = Section(source["section"], source["url"])
    section.feed(body.decode(charset or "utf-8", errors="strict"))
    section.close()
    text = normalize("".join(section.text))
    if section.matches != 1 or section.depth or source["contains"] not in text:
        raise ValueError(f"expected one complete {source['section']} section with the source identity marker")
    links = sorted(section.links)
    if kind == "bulletin":
        if not links:
            raise ValueError("bulletin section has no notice links")
        # Compare links explicitly for actionable alerts; also catch edits or links reassigned in place.
        return {"links": links, "notices_sha256": fingerprint(sorted(section.notices))}
    if kind == "html":
        return fingerprint({"text": text, "links": links})
    raise ValueError(f"unsupported source type: {kind}")


class NoRedirects(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        # A moved source needs review, not a silent switch to a different publisher/document.
        return None


def fetch_once(url):
    if urlsplit(url).scheme != "https":
        raise ValueError("only HTTPS sources are supported")
    request = Request(url, headers={"User-Agent": "HolidaySourceReview/1.0"})
    with build_opener(NoRedirects()).open(request, timeout=12) as response:
        if response.status != 200:
            raise ValueError(f"expected a full HTTP 200 response, got {response.status}")
        length = response.length  # http.client uses None for chunked/EOF-delimited responses.
        body = response.read(MAX_BYTES + 1)
        if len(body) > MAX_BYTES:
            raise ValueError("source exceeds the download limit")
        if length is not None and len(body) != length:
            raise IncompleteRead(body, length - len(body))
        return body, response.headers.get_content_charset()


def fetch(url):
    try:
        return fetch_once(url)
    except HTTPError as exc:
        if exc.code not in {429, 500, 502, 503, 504}:
            raise
    except (URLError, TimeoutError, ConnectionError, IncompleteRead):
        pass
    # Transient failures can occur even after the payload arrives (e.g., missing chunk framing).
    # Re-fetch once; never use a partial body or retry a changed/invalid signal.
    return fetch_once(url)


def describe_change(expected, actual):
    if isinstance(actual, str):
        return f"fingerprint {expected} → {actual}"
    changes = []
    for action, left, right in (("added", actual, expected), ("removed", expected, actual)):
        urls = sorted(set(left["links"]) - set(right["links"]))
        if urls:
            changes.append(f"{action} notice links: {', '.join(urls)}")
    if actual["notices_sha256"] != expected["notices_sha256"]:
        changes.append(f"notice text/link context changed (observed SHA-256 {actual['notices_sha256']})")
    return "; ".join(changes)


def coverage(region, root, today):
    path = root / "data" / f"holidays-{region}.json"
    try:
        years = json.loads(path.read_text(encoding="utf-8"))["years"]
        if not isinstance(years, dict):
            raise ValueError("years is not a mapping")
    except (OSError, ValueError, KeyError, TypeError) as exc:
        return Result("warning", f"{region.upper()} coverage could not be read from {path.name}: {exc}")
    missing = [str(year) for year in (today.year, today.year + 1)
               if not isinstance(years.get(str(year)), list) or not years[str(year)]]
    if missing:
        return Result("warning", f"{region.upper()} snapshot has no rows for {', '.join(missing)}. "
                      "Review official sources before adding dates; do not extrapolate from this alert.")
    return Result("ok", f"{region.upper()} snapshot has rows for {today.year} and {today.year + 1} (presence only).")


def review_sources(region, sources, download):
    for source in sources:
        url = source["url"]
        name = f"{region.upper()} {source['label']} ({url})"
        try:
            actual = observe(source, *download(url))
        except (OSError, HTTPException, ValueError, LookupError) as exc:
            yield Result("error", f"{name}: unavailable or unexpected response ({exc}). "
                         "Retry; if it persists, verify the publisher, URL and source format manually.")
            continue
        expected = source["expected"]
        if actual != expected:
            yield Result("error", f"{name}: changed — {describe_change(expected, actual)}. "
                         "Review the official document and snapshot scope before updating the baseline.")
        else:
            yield Result("ok", f"{name}: matches the reviewed signal.")


def review(sources, root, today, download):
    results = []
    for region in REGIONS:
        results.extend(review_sources(region, sources[region], download))
        results.append(coverage(region, root, today))
    return results


def brazil_proposal(year):
    if not 2025 <= year <= 2100:
        raise ValueError("Brazil proposal year must be between 2025 and 2100")
    # Laws 662 (as amended by 10.607), 6.802 and 14.759; excludes local and
    # optional federal-office dates. Compare this rule with all reviewed years.
    fixed = [(1, 1, "元旦"), (4, 21, "蒂拉登特斯纪念日"), (5, 1, "劳动节"),
             (9, 7, "巴西独立日"), (10, 12, "阿帕雷西达圣母日"), (11, 2, "追思亡者节"),
             (11, 15, "共和国宣告日"), (11, 20, "黑人意识日"), (12, 25, "圣诞节")]
    return {str(year): [[date(year, month, day).isoformat(), name] for month, day, name in fixed]}


def load_sources():
    sources = json.loads(MANIFEST.read_text(encoding="utf-8"))["sources"]
    for region in REGIONS:
        if not isinstance(sources[region], list) or not sources[region]:
            raise ValueError(f"{region.upper()} must have reviewed sources")
        for source in sources[region]:
            kind = source["kind"]
            if not source["label"] or not source["url"].startswith("https://"):
                raise ValueError("each source needs a label and HTTPS URL")
            if kind not in {"pdf", "bulletin", "html"}:
                raise ValueError(f"unsupported source type: {kind}")
            if kind != "pdf" and not (source["section"] and source["contains"]):
                raise ValueError("HTML sources need a section and identity marker")
            expected = source["expected"]
            if kind == "bulletin":
                if not isinstance(expected["links"], list) or not expected["links"]:
                    raise ValueError("bulletin baseline needs reviewed notice links")
                expected = expected["notices_sha256"]
            if not isinstance(expected, str) or len(expected) != 64 or any(c not in "0123456789abcdef" for c in expected):
                raise ValueError("each source needs a reviewed SHA-256 signal")
    return sources


def main(propose_br=None):
    try:
        sources = load_sources()
    except (OSError, ValueError, KeyError, TypeError, AttributeError) as exc:
        results = [Result("error", f"Invalid review manifest {MANIFEST.name}: {exc}. Fix it before trusting alerts.")]
    else:
        if propose_br is None:
            results = review(sources, ROOT, date.today(), fetch)
        else:
            results = list(review_sources("br", sources["br"], fetch))

    failed = sum(row.level == "error" for row in results)
    if propose_br is not None:
        if failed:
            for row in results:
                if row.level == "error":
                    print(normalize(row.message), file=sys.stderr)
            return 1
        print("Draft only: review for new laws before adding to the snapshot.", file=sys.stderr)
        print(json.dumps(brazil_proposal(propose_br), ensure_ascii=False, indent=2))
        return 0
    warnings = sum(row.level == "warning" for row in results)
    status = f"{failed} source/configuration alert(s), {warnings} coverage warning(s). No holiday data written."
    print(status)
    for level, message in results:
        message = normalize(message)
        if os.environ.get("GITHUB_STEP_SUMMARY") and level != "ok":
            print(f"::{level}::{message.replace('%', '%25')}")
        else:
            print(f"[{level.upper()}] {message}")
    if summary := os.environ.get("GITHUB_STEP_SUMMARY"):
        with Path(summary).open("a", encoding="utf-8") as out:
            out.write(f"## India and Brazil holiday source review\n\n{status}\n\n")
            for level, message in results:
                out.write(f"- **{level.upper()}**: <code>{escape(normalize(message))}</code>\n")
            out.write("\nA matching signal is not legal verification. For changed or unavailable sources, verify the "
                      "official notice or legislation and decide manually whether the calendar needs an update.\n")
    return 1 if failed else 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--propose-br", metavar="YEAR", type=int,
                        help="print a draft for 2025–2100 only after the reviewed Brazilian legal sources match")
    args = parser.parse_args()
    if args.propose_br is not None and not 2025 <= args.propose_br <= 2100:
        parser.error("--propose-br YEAR must be between 2025 and 2100")
    raise SystemExit(main(args.propose_br))

import contextlib
import io
import json
import os
import unittest
from datetime import date
from hashlib import sha256
from http.client import IncompleteRead
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch
from urllib.error import HTTPError

import check_holiday_sources as check


BULLETIN = """
<a href="/outside.pdf">Site navigation</a>
<div class="blog">
  <h1>Vacations &amp; Holidays</h1>
  <h2>Delhi / New Delhi holidays</h2>
  <dl><dd>Last Updated on Monday</dd></dl>
  <p>List of holidays <a href="/notice.pdf#page=1"><img src="download.png"></a></p>
  <div class="items-more"><a href="/revision">Correction notice</a></div>
</div>
"""
PDF = b"%PDF-1.4\nReviewed PDF\n%%EOF\n"
LAW = """
<nav>Menu</nav><div id="content"><h1>LEI Nº 662</h1>
<p>Não consta revogação expressa.</p><a href="amendment.html">Alteração</a>
</div><footer>Site traffic counter</footer>
"""
IN = "https://www.aiims.edu/bulletin"
BR = "https://www2.camara.leg.br/legin/law.html"
BULLETIN_SOURCE = {"kind": "bulletin", "label": "AIIMS notices", "url": IN,
                   "section": "div.blog", "contains": "Vacations & Holidays"}
PDF_SOURCE = {"kind": "pdf", "label": "DoPT annex", "url": "https://www.aiims.edu/notice.pdf"}
LAW_SOURCE = {"kind": "html", "label": "Lei 662", "url": BR,
              "section": "div#content", "contains": "LEI Nº 662"}


def observe(source, text):
    return check.observe(source, text.encode("utf-8"), "utf-8")


class SignalTests(unittest.TestCase):
    def test_bulletin_ignores_navigation_timestamps_whitespace_and_link_order(self):
        first = observe(BULLETIN_SOURCE, BULLETIN)
        changed = BULLETIN.replace("/outside.pdf", "/other.pdf").replace("Monday", "Tuesday")
        changed = changed.replace("/notice.pdf#page=1", "https://www.aiims.edu/notice.pdf")
        changed = changed.replace("Delhi / New Delhi", "Delhi  /\n New Delhi")
        changed = changed.replace('<a href="/revision">Correction notice</a>', "")
        changed = changed.replace("<h2>", '<a href="/revision">Correction notice</a><h2>')
        self.assertEqual(first, observe(BULLETIN_SOURCE, changed))
        self.assertEqual(first["links"], ["https://www.aiims.edu/notice.pdf",
                                          "https://www.aiims.edu/revision"])

    def test_new_revised_and_removed_notice_links_are_described(self):
        changed = BULLETIN.replace("/revision", "/revision-v2").replace(
            "</h2>", '</h2><a href="/new-notice">New notice</a>')
        expected = observe(BULLETIN_SOURCE, BULLETIN)
        actual = observe(BULLETIN_SOURCE, changed)
        description = check.describe_change(expected, actual)
        self.assertIn("added", description)
        self.assertIn("https://www.aiims.edu/new-notice", description)
        self.assertIn("https://www.aiims.edu/revision-v2", description)
        self.assertIn("removed", description)
        self.assertIn("https://www.aiims.edu/revision", description)

    def test_same_url_with_revised_notice_text_is_a_change(self):
        expected = observe(BULLETIN_SOURCE, BULLETIN)
        actual = observe(BULLETIN_SOURCE, BULLETIN.replace("Correction notice", "Notice withdrawn"))
        self.assertEqual(expected["links"], actual["links"])
        self.assertIn("notice text", check.describe_change(expected, actual))

    def test_empty_unclosed_or_wrong_bulletin_is_rejected(self):
        for html in ('<div class="blog">Vacations &amp; Holidays</div>', BULLETIN[:-8],
                     BULLETIN.replace("Vacations", "News"), '<html>Access denied</html>'):
            with self.subTest(html=html), self.assertRaises(ValueError):
                observe(BULLETIN_SOURCE, html)

    def test_pdf_requires_pdf_bytes_and_changes_at_same_url(self):
        digest = check.observe(PDF_SOURCE, PDF, None)
        self.assertEqual(digest, sha256(PDF).hexdigest())
        self.assertNotEqual(digest, check.observe(PDF_SOURCE, PDF.replace(b"Reviewed", b"Revised"), None))
        for body in [b"<html>Access denied</html>", PDF[:-8]]:
            with self.subTest(body=body), self.assertRaises(ValueError):
                check.observe(PDF_SOURCE, body, None)

    def test_brazil_law_text_and_amendment_href_changes_but_chrome_does_not(self):
        expected = observe(LAW_SOURCE, LAW)
        harmless = LAW.replace("<nav>Menu</nav>", "<nav>New menu</nav>").replace(
            "Site traffic counter", "New count").replace("Não consta", "Não&nbsp; <b>consta</b>")
        self.assertEqual(expected, observe(LAW_SOURCE, harmless))
        for actual in (LAW.replace("Não consta", "Consta"), LAW.replace("amendment.html", "new.html")):
            self.assertNotEqual(expected, observe(LAW_SOURCE, actual))
        with self.assertRaises(ValueError):
            observe(LAW_SOURCE, LAW.replace("LEI Nº 662", "LEI Nº 663"))


class FetchTests(unittest.TestCase):
    def test_single_retry_of_incomplete_transport(self):
        with patch.object(check, "fetch_once", side_effect=[IncompleteRead(b"partial"), (PDF, None)]) as read:
            self.assertEqual(check.fetch(PDF_SOURCE["url"]), (PDF, None))
            self.assertEqual(read.call_count, 2)

    def test_transient_failure_after_retry_is_not_accepted(self):
        with patch.object(check, "fetch_once", side_effect=IncompleteRead(b"partial")) as read:
            with self.assertRaises(IncompleteRead):
                check.fetch(BR)
            self.assertEqual(read.call_count, 2)

    def test_redirect_is_not_retried_or_followed(self):
        error = HTTPError(IN, 302, "Moved", {}, None)
        with patch.object(check, "fetch_once", side_effect=error) as read:
            with self.assertRaises(HTTPError):
                check.fetch(IN)
            read.assert_called_once_with(IN)
        self.assertIsNone(check.NoRedirects().redirect_request(None, None, 302, "Moved", {}, BR))


class ReviewTests(unittest.TestCase):
    def setUp(self):
        temporary = TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        (self.root / "data").mkdir()
        for region in ("in", "br"):
            (self.root / "data" / f"holidays-{region}.json").write_text(json.dumps({"years": {
                "2026": [["2026-01-01", "Example"]], "2027": [["2027-01-01", "Example"]], "2028": []
            }}), encoding="utf-8")
        self.sources = {
            "in": [dict(BULLETIN_SOURCE, expected=observe(BULLETIN_SOURCE, BULLETIN)),
                   dict(PDF_SOURCE, expected=sha256(PDF).hexdigest())],
            "br": [dict(LAW_SOURCE, expected=observe(LAW_SOURCE, LAW))],
        }

    def review(self, fetch):
        return check.review(self.sources, self.root, date(2027, 1, 1), fetch)

    def test_coverage_is_only_a_warning_and_never_writes_calendar_or_manifest(self):
        bodies = {IN: BULLETIN.encode(), PDF_SOURCE["url"]: PDF, BR: LAW.encode()}
        before = {p: p.read_bytes() for p in self.root.rglob("*.json")}
        results = self.review(lambda url: (bodies[url], "utf-8"))
        self.assertEqual([row.level for row in results].count("ok"), 3)
        self.assertEqual([row.level for row in results].count("warning"), 2)
        self.assertTrue(all("2028" in row.message for row in results if row.level == "warning"))
        self.assertEqual(before, {p: p.read_bytes() for p in self.root.rglob("*.json")})

    def test_unreachable_source_does_not_stop_pdf_or_other_country_review(self):
        def fetch(url):
            if url == IN:
                raise HTTPError(url, 503, "Unavailable", {}, None)
            if url == PDF_SOURCE["url"]:
                return PDF.replace(b"Reviewed", b"Revised"), None
            return LAW.encode(), "utf-8"

        results = self.review(fetch)
        failures = [row for row in results if row.level == "error"]
        self.assertEqual(len(failures), 2)
        self.assertIn("503", failures[0].message)
        self.assertIn(IN, failures[0].message)
        self.assertIn("changed", failures[1].message)
        self.assertIn(PDF_SOURCE["url"], failures[1].message)
        self.assertTrue(any(row.level == "ok" and BR in row.message for row in results))

    def test_brazil_proposal_matches_vetted_years_does_not_shift_weekend_dates(self):
        snapshot = json.loads((check.ROOT / "data/holidays-br.json").read_text(encoding="utf-8"))
        for year, rows in snapshot["years"].items():
            self.assertEqual(check.brazil_proposal(int(year)), {year: rows})
        rows = check.brazil_proposal(2028)["2028"]
        self.assertIn(["2028-01-01", "元旦"], rows)  # Saturday stays on January 1.
        self.assertEqual(len(rows), 9)
        self.assertNotIn("2028-01-03", [row[0] for row in rows])

    def test_brazil_proposal_is_blocked_by_law_change_and_only_writes_to_stdout(self):
        for law, status in [(LAW, 0), (LAW.replace("Não consta", "Consta"), 1)]:
            with self.subTest(status=status), \
                patch.object(check, "load_sources", return_value=self.sources), \
                patch.object(check, "fetch", return_value=(law.encode(), "utf-8")) as fetch, \
                contextlib.redirect_stdout(io.StringIO()) as output, \
                contextlib.redirect_stderr(io.StringIO()) as errors:
                self.assertEqual(check.main(propose_br=2028), status)
                fetch.assert_called_once_with(BR)
                if status:
                    self.assertEqual(output.getvalue(), "")
                    self.assertIn("changed", errors.getvalue())
                else:
                    self.assertEqual(json.loads(output.getvalue()), check.brazil_proposal(2028))

    def test_main_reports_review_failure_and_summary_without_swallowing_exit_status(self):
        summary = self.root / "summary"
        rows = [check.Result("error", "IN Example inaccessible; review source"),
                check.Result("warning", "BR 2028 coverage missing")]
        stdout = io.StringIO()
        manifest = self.root / "manifest.json"
        original = json.dumps({"sources": self.sources})
        manifest.write_text(original, encoding="utf-8")
        with patch.object(check, "MANIFEST", manifest), \
            patch.object(check, "review", return_value=rows), \
            patch.dict(os.environ, {"GITHUB_STEP_SUMMARY": str(summary)}), \
            contextlib.redirect_stdout(stdout):
            self.assertEqual(check.main(), 1)
        self.assertEqual(manifest.read_text(encoding="utf-8"), original)
        self.assertIn("::error::IN Example inaccessible", stdout.getvalue())
        self.assertIn("::warning::BR 2028", stdout.getvalue())
        self.assertIn("IN Example inaccessible", summary.read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()

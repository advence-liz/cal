#!/usr/bin/env python3
"""Validate official US/SG holiday schedules before changing the bundled data.

Dry run by default. Only --apply writes, and then only after every check for
that region passes. --input-dir replays downloaded sources without networking.
"""
import argparse
from collections import Counter, defaultdict
from datetime import date, timedelta
from html.parser import HTMLParser
import json
from pathlib import Path
import re
import sys
from urllib.request import Request, HTTPRedirectHandler, build_opener

BASE = Path(__file__).resolve().parents[1]
OPM = 'https://www.opm.gov/policy-data-oversight/pay-leave/federal-holidays/holidays.ics'
MOM = 'https://www.mom.gov.sg/employment-practices/public-holidays'
MOM_ICS = 'https://www.mom.gov.sg/-/media/mom/documents/employment-practices/public-holidays/public-holidays-sg-{}.ics'
US_NAMES = {
    "New Year's Day": '元旦', 'Birthday of Martin Luther King, Jr.': '马丁·路德·金纪念日',
    "Washington's Birthday": '华盛顿诞辰', 'Memorial Day': '阵亡将士纪念日',
    'Juneteenth National Independence Day': '六月节', 'Independence Day': '美国独立日',
    'Labor Day': '美国劳动节', 'Columbus Day': '哥伦布日', 'Veterans Day': '退伍军人节',
    'Thanksgiving Day': '感恩节', 'Christmas Day': '圣诞节',
}
FIXED_US = {'元旦': (1, 1), '六月节': (6, 19), '美国独立日': (7, 4), '退伍军人节': (11, 11), '圣诞节': (12, 25)}
SG_NAMES = {
    "New Year's Day": '元旦', 'Chinese New Year': '春节', 'Hari Raya Puasa': '开斋节',
    'Good Friday': '耶稣受难日', 'Labour Day': '劳动节', 'Polling Day': '投票日', 'Vesak Day': '卫塞节',
    'Hari Raya Haji': '哈芝节', 'National Day': '新加坡国庆日', 'Deepavali': '屠妖节', 'Christmas Day': '圣诞节',
}
SG_CORE = Counter({name: 2 if name == '春节' else 1 for name in SG_NAMES.values() if name != '投票日'})
MONTHS = 'January February March April May June July August September October November December'.split()
MOM_DATE = r'(\d{1,2} [A-Za-z]+ \d{4})'
MOM_NOTE = re.compile(rf'([A-Za-z]+), {MOM_DATE}, will be a public holiday if your rest day falls on {MOM_DATE}\.?', re.I)
WEEKDAYS = 'Monday Tuesday Wednesday Thursday Friday Saturday Sunday'.split()


class MergeError(ValueError):
    pass


def clean(text):
    return ' '.join(text.replace('’', "'").split())


def translated(names, value):
    if value not in names:
        raise MergeError(f'Unrecognized official holiday name: {value!r}')
    return names[value]


def parse_ics(text):
    # RFC 5545 line folding: remove exactly one leading space/tab.
    lines = re.sub(r'\r?\n[ \t]', '', text).strip().splitlines()
    if not lines or lines[0] != 'BEGIN:VCALENDAR' or lines[-1] != 'END:VCALENDAR':
        raise MergeError('Incomplete iCalendar document')
    events, event = [], None
    for line in lines[1:-1]:
        if line == 'BEGIN:VEVENT':
            if event is not None:
                raise MergeError('Unclosed iCalendar event')
            event = {}
        elif line == 'END:VEVENT':
            if event is None or event.keys() != {'date', 'name'}:
                raise MergeError('Incomplete all-day iCalendar event')
            events.append((event['date'], event['name']))
            event = None
        elif event is not None:
            key, sep, value = line.partition(':')
            if sep and key in {'DTSTART;VALUE=DATE', 'SUMMARY'}:
                field = 'date' if key.startswith('DTSTART') else 'name'
                if field in event:
                    raise MergeError(f'Duplicate iCalendar field: {field}')
                if field == 'date':
                    if not re.fullmatch(r'\d{8}', value):
                        raise MergeError(f'Bad all-day date: {value!r}')
                    try:
                        event[field] = date.fromisoformat(f'{value[:4]}-{value[4:6]}-{value[6:]}')
                    except ValueError as error:
                        raise MergeError(f'Invalid iCalendar date: {value!r}') from error
                else:
                    event[field] = clean(value.replace(r'\,', ',').replace(r'\;', ';'))
    if event is not None or not events or len(set(events)) != len(events):
        raise MergeError('Missing or duplicate iCalendar events')
    return events


def observed(day):
    return day + timedelta(days={5: -1, 6: 1}.get(day.weekday(), 0))


def rows(entries):
    if len({day for day, *_ in entries}) != len(entries):
        raise MergeError('Multiple holidays on one calendar date; review data model before updating')
    return [[day.isoformat(), name] + ([original.isoformat()] if original else [])
            for day, name, original in sorted(entries)]


def us_years(ics, first_year):
    by_nominal, by_calendar = defaultdict(list), defaultdict(list)
    for day, official in parse_ics(ics):
        if official == 'Inauguration Day' or day.year < first_year - 1:
            continue
        name = translated(US_NAMES, official)
        original = None
        if name in FIXED_US:
            targets = (date(y, *FIXED_US[name]) for y in range(day.year - 1, day.year + 2))
            original = next((d for d in targets if observed(d) == day), None)
            if original is None:
                raise MergeError(f'Unexpected OPM observed date for {official}: {day}')
        if day.weekday() >= 5:
            raise MergeError(f'OPM holiday not on a workday: {day}')
        by_nominal[(original or day).year].append(name)
        by_calendar[day.year].append((day, name, original if original != day else None))
    expected = Counter(US_NAMES.values())
    complete = {y for y, names in by_nominal.items() if y >= first_year and Counter(names) == expected}
    if not complete:
        raise MergeError('No complete nationwide OPM schedule found')
    latest = max(complete)
    for y in range(first_year, latest + 1):
        if y not in complete:
            raise MergeError(f'Incomplete OPM holiday schedule for {y}')
    # If next Jan 1 falls on Saturday its observed Friday belongs to this
    # year's snapshot; do not expose that year as complete without the record.
    next_new_year = date(latest + 1, 1, 1)
    if observed(next_new_year).year == latest and (observed(next_new_year), '元旦', next_new_year) not in by_calendar[latest]:
        latest -= 1
    return {str(y): rows(by_calendar[y]) for y in range(first_year, latest + 1)}


class MOMTables(HTMLParser):
    """Extract only the holiday tables, keeping announced substitute notes."""
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.tables, self.table, self.row, self.cell = [], None, None, None
        self.capture = None

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        classes = (attrs.get('class') or '').split()
        if tag == 'table' and 'table--holiday' in classes:
            if self.table is not None:
                raise MergeError('Nested MOM holiday tables')
            self.table = []
        elif self.table is not None and tag == 'tr':
            self.row = []
        elif self.row is not None and tag == 'td':
            self.cell = [[], []]
        elif self.cell is not None:
            if tag == 'span' and 'text-date-mobile' in classes:
                self.capture = 'ignore'
            elif tag == 'em' and 'cell-holiday-alert' in classes:
                self.capture = 'note'
            elif tag == 'br' and self.capture is None:
                self.cell[0].append('\n')

    def handle_data(self, text):
        if self.cell is not None and self.capture != 'ignore':
            self.cell[int(self.capture == 'note')].append(text)

    def handle_endtag(self, tag):
        if tag == 'span' and self.capture == 'ignore' or tag == 'em' and self.capture == 'note':
            self.capture = None
        if tag == 'td' and self.cell is not None:
            self.row.append(tuple(''.join(parts).strip() for parts in self.cell))
            self.cell = None
        if tag == 'tr' and self.row is not None:
            if self.row:
                self.table.append(self.row)
            self.row = None
        if tag == 'table' and self.table is not None:
            self.tables.append(self.table)
            self.table = None


def mom_date(text):
    if not re.fullmatch(MOM_DATE, text):
        raise MergeError(f'Unknown MOM date format: {text!r}')
    day, month, year = text.split()
    return date(int(year), MONTHS.index(month.title()) + 1, int(day))


def parse_mom(html):
    parser = MOMTables()
    parser.feed(html)
    parser.close()
    if not parser.tables or parser.table is not None:
        raise MergeError('MOM holiday tables missing or incomplete')
    result = {}
    for table in parser.tables:
        entries = []
        for cells in table:
            if len(cells) != 4:
                raise MergeError('Unexpected MOM table layout')
            name = translated(SG_NAMES, clean(cells[3][0]))
            dates = [mom_date(clean(part)) for part in cells[0][0].splitlines() if part.strip()]
            entries.extend((day, name, None) for day in dates)
            note = clean(cells[3][1])
            sundays = [day for day in dates if day.weekday() == 6]
            if not sundays and not note:
                continue
            match = MOM_NOTE.fullmatch(note)
            if not match:
                raise MergeError(f'Missing or unrecognized MOM substitute-day note for {dates}')
            weekday, paid_day, original = match.groups()
            paid_day, original = mom_date(paid_day), mom_date(original)
            if (sundays != [original] or weekday.title() != WEEKDAYS[paid_day.weekday()]
                or paid_day.weekday() >= 5 or not 0 < (paid_day - original).days <= 5):
                raise MergeError(f'Invalid MOM substitute dates: {original} → {paid_day}')
            entries.append((paid_day, name, original))
        years = {day.year for day, *_ in entries}
        actual = Counter(name for _, name, original in entries if original is None and name != '投票日')
        if len(years) != 1 or actual != SG_CORE:
            raise MergeError(f'Incomplete or mixed-year MOM holiday table: {sorted(years)}')
        year = str(years.pop())
        if year in result:
            raise MergeError(f'Duplicate MOM holiday table for {year}')
        result[year] = entries
    return result


def reconcile_sg(entries, ics, year):
    actual = {(day, name) for day, name, original in entries if original is None}
    allowed = {(day, name) for day, name, _ in entries}
    calendar = {(day, translated(SG_NAMES, name)) for day, name in parse_ics(ics)}
    if not actual <= calendar <= allowed:
        raise MergeError(f'MOM web table and iCalendar disagree for {year}')
    return rows(entries)


def merge_years(existing, fresh, current_year):
    if str(current_year) not in fresh:
        raise MergeError(f'Current year {current_year} is missing from the confirmed upstream schedules')
    first, last = min(map(int, fresh)), max(map(int, fresh))
    if set(fresh) != {str(y) for y in range(first, last + 1)}:
        raise MergeError('Non-contiguous upstream coverage')
    if any(int(year) > last for year in existing):
        raise MergeError('Upstream lost a year that was previously confirmed')
    return dict(sorted({**existing, **fresh}.items()))


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def load_source(url, fixture, input_dir):
    limit = 1_000_000
    if input_dir is not None:
        with (input_dir / fixture).open('rb') as stream:
            raw = stream.read(limit + 1)
    else:
        request = Request(url, headers={'User-Agent': 'Calendar holiday data checker'})
        with build_opener(NoRedirect()).open(request, timeout=20) as response:
            raw = response.read(limit + 1)
    if not raw or len(raw) > limit:
        raise MergeError(f'Empty or oversized upstream source: {fixture}')
    return raw.decode('utf-8-sig')


def render_snapshot(previous, years):
    # Preserve one row per line so PRs show dates, not array reformatting.
    blocks = []
    for year, days in years.items():
        lines = ',\n'.join('      ' + json.dumps(day, ensure_ascii=False) for day in days)
        blocks.append(f'    "{year}": [\n{lines}\n    ]')
    content = json.dumps({**previous, 'years': {}}, ensure_ascii=False, indent=2)
    return content.replace('  "years": {}', '  "years": {\n' + ',\n'.join(blocks) + '\n  }', 1) + '\n'


def main():
    args = argparse.ArgumentParser(description=__doc__)
    args.add_argument('region', choices=['us', 'sg'])
    args.add_argument('--apply', action='store_true')
    args.add_argument('--input-dir', type=Path)
    options = args.parse_args()
    path = BASE / 'data' / f'holidays-{options.region}.json'
    try:
        before = json.loads(path.read_text(encoding='utf-8'))
        current = date.today().year
        if options.region == 'us':
            raw = load_source(OPM, 'opm.ics', options.input_dir)
            # Preserve archived years if OPM moves its publication window.
            events = parse_ics(raw)
            earliest = min(d.year for d, name in events if name != 'Inauguration Day')
            start = max(earliest, min(map(int, before['years'])))
            fresh = us_years(raw, start)
        else:
            page = load_source(MOM, 'mom.html', options.input_dir)
            seasons = parse_mom(page)
            if len(seasons) > 8:
                raise MergeError('Unexpected number of published MOM years; review before fetching feeds')
            fresh = {year: reconcile_sg(entries, load_source(MOM_ICS.format(year), f'sg-{year}.ics', options.input_dir), year)
                     for year, entries in seasons.items()}
        years = merge_years(before['years'], fresh, current)
        changed = [year for year in years if years[year] != before['years'].get(year)]
        if options.apply and changed:
            # Stage the file beside the target; never leave a half-written JSON.
            tmp = path.with_suffix('.json.tmp')
            tmp.write_text(render_snapshot(before, years), encoding='utf-8')
            tmp.replace(path)
        print(f'{options.region.upper()} confirmed upstream: {", ".join(fresh)}; changed years: {", ".join(changed) or "none"}')
        print('changed=' + ('true' if changed else 'false'))
    except (ValueError, OSError, KeyError) as error:
        print(f'Holiday sync aborted without publishing: {error}', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())

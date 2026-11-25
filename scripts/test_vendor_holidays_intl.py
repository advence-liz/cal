import io
from socket import timeout as SocketTimeout
import unittest
from unittest.mock import patch
from urllib.error import HTTPError, URLError

from vendor_holidays_intl import MergeError, ZA_PAGE, load_source, parse_ics, parse_mom, reconcile_sg, us_years, merge_years


class SourceFetchTests(unittest.TestCase):
    @patch('vendor_holidays_intl.sleep')
    @patch('vendor_holidays_intl.build_opener')
    def test_timeout_retries_then_returns_official_payload(self, build, sleep):
        opener = build.return_value
        opener.open.side_effect = [URLError(SocketTimeout('connect')), TimeoutError('read'), io.BytesIO(b'official')]
        self.assertEqual(load_source(ZA_PAGE, 'za.html', None, attempts=3), 'official')
        self.assertEqual(opener.open.call_count, 3)
        self.assertEqual([call.args[0] for call in sleep.call_args_list], [2, 4])

    @patch('vendor_holidays_intl.sleep')
    @patch('vendor_holidays_intl.build_opener')
    def test_exhausted_timeouts_surface_failure(self, build, sleep):
        opener = build.return_value
        opener.open.side_effect = URLError(TimeoutError('connect'))
        with self.assertRaises(URLError):
            load_source(ZA_PAGE, 'za.html', None, attempts=3)
        self.assertEqual(opener.open.call_count, 3)
        self.assertEqual(sleep.call_count, 2)

    @patch('vendor_holidays_intl.sleep')
    @patch('vendor_holidays_intl.build_opener')
    def test_non_timeout_and_invalid_payload_fail_without_retry(self, build, sleep):
        opener = build.return_value
        opener.open.side_effect = HTTPError(ZA_PAGE, 302, 'redirect', {}, None)
        with self.assertRaises(HTTPError):
            load_source(ZA_PAGE, 'za.html', None, attempts=3)
        opener.open.assert_called_once()
        opener.open.reset_mock(side_effect=True)
        opener.open.return_value = io.BytesIO(b'')
        with self.assertRaisesRegex(MergeError, 'Empty or oversized'):
            load_source(ZA_PAGE, 'za.html', None, attempts=3)
        opener.open.assert_called_once()
        sleep.assert_not_called()


def ics(events):
    return 'BEGIN:VCALENDAR\r\n' + ''.join(
        f'BEGIN:VEVENT\r\nDTSTART;VALUE=DATE:{day}\r\nSUMMARY:{name}\r\nEND:VEVENT\r\n' for day, name in events
    ) + 'END:VCALENDAR\r\n'


US_2027 = [
    ('20270101', 'New Year’s Day'), ('20270118', r'Birthday of Martin Luther King\, Jr.'),
    ('20270215', 'Washington’s Birthday'), ('20270531', 'Memorial Day'),
    ('20270618', 'Juneteenth National Independence Day'), ('20270705', 'Independence Day'),
    ('20270906', 'Labor Day'), ('20271011', 'Columbus Day'), ('20271111', 'Veterans Day'),
    ('20271125', 'Thanksgiving Day'), ('20271224', 'Christmas Day'), ('20271231', "New Year's Day"),
]
SG_2027 = [
    ('1 January 2027', "New Year's Day"), ('6 February 2027<br>7 February 2027', 'Chinese New Year'),
    ('10 March 2027', 'Hari Raya Puasa'), ('26 March 2027', 'Good Friday'), ('1 May 2027', 'Labour Day'),
    ('17 May 2027', 'Hari Raya Haji'), ('20 May 2027', 'Vesak Day'), ('9 August 2027', 'National Day'),
    ('28 October 2027', 'Deepavali'), ('25 December 2027', 'Christmas Day'),
]
SG_ICS = [('20270101', "New Year's Day"), ('20270206', 'Chinese New Year'), ('20270207', 'Chinese New Year'),
          ('20270310', 'Hari Raya Puasa'), ('20270326', 'Good Friday'), ('20270501', 'Labour Day'),
          ('20270517', 'Hari Raya Haji'), ('20270520', 'Vesak Day'), ('20270809', 'National Day'),
          ('20271028', 'Deepavali'), ('20271225', 'Christmas Day')]
SG_NOTE = 'Monday, 8 February 2027, will be a public holiday if your rest day falls on 7 February 2027.'


def mom_html(note=SG_NOTE, rows=SG_2027):
    alert = f'<em class="cell-holiday-alert">{note}</em>' if note else ''
    body = ''.join(f'<tr><td>{day}</td><td>Day</td><td></td><td class="cell-holiday-name">{name}'
                   '<span class="text-date-mobile">ignore</span>'
                   f'{alert if name == "Chinese New Year" else ""}'
                   '</td></tr>' for day, name in rows)
    return f'<table class="table table--holiday"><tbody>{body}</tbody></table>'


NSW_2026_27 = '''<h2 id="nsw-public-holidays"><a id="public-holidays"></a>NSW public holidays 2026 to 2027</h2>
<table class="nsw-table nsw-table--striped"><thead><tr><th>Holiday</th><th>2026</th><th>2027</th></tr></thead><tbody>
<tr><td>New Year's Day</td><td>Thursday 1 January 2026</td><td>Friday 1 January 2027</td></tr>
<tr><td><sup>3</sup>Additional Day</td><td>Not applicable</td><td>Not applicable</td></tr>
<tr><td><sup>2</sup>Australia Day</td><td>Monday 26 January 2026</td><td>Tuesday 26 January 2027</td></tr>
<tr><td>Good Friday</td><td>Friday 3 April 2026</td><td>Friday 26 March 2027</td></tr>
<tr><td>Easter Saturday</td><td>Saturday 4 April 2026</td><td>Saturday 27 March 2027</td></tr>
<tr><td>Easter Sunday</td><td>Sunday 5 April 2026</td><td>Sunday 28 March 2027</td></tr>
<tr><td>Easter Monday</td><td>Monday 6 April 2026</td><td>Monday 29 March 2027</td></tr>
<tr><td>Anzac Day</td><td>Saturday 25 April 2026</td><td>Sunday 25 April 2027</td></tr>
<tr><td>Additional Day</td><td>Monday 27 April 2026</td><td>Monday 26 April 2027</td></tr>
<tr><td>King’s Birthday</td><td>Monday 8 June 2026</td><td>Monday 14 June 2027</td></tr>
<tr><td><sup>1</sup>Bank Holiday</td><td>Monday 3 August 2026</td><td>Monday 2 August 2027</td></tr>
<tr><td>Labour Day</td><td>Monday 5 October 2026</td><td>Monday 4 October 2027</td></tr>
<tr><td>Christmas Day</td><td>Friday 25 December 2026</td><td>Saturday 25 December 2027</td></tr>
<tr><td><sup>3</sup>Additional Day</td><td>Not applicable</td><td>Monday 27 December 2027</td></tr>
<tr><td>Boxing Day</td><td>Saturday 26 December 2026</td><td>Sunday 26 December 2027</td></tr>
<tr><td><sup>3</sup>Additional Day</td><td>Monday 28 December 2026</td><td>Tuesday 28 December 2027</td></tr>
</tbody></table>
<h2>Local holidays</h2><table class="nsw-table"><tr><td>Sydney local event</td><td>Friday 13 November 2026</td></tr></table>'''


SAMA_NOTE = ('If the National Day or Founding Day falls on a Friday then the holiday will be on a Thursday, '
             'and if they fall on a Saturday then the holiday will be on a Sunday.')


def sama_range(hijri, year, start, end):
    return f'''<div class="holiday-years__item">
      <div class="holiday-years__year"><div class="label">Year</div><div class="value">{hijri}H - {year}</div></div>
      <div class="holiday-years__details">
        <p class="holiday-years__line">Starts on {start}</p>
        <p class="holiday-years__line">Ends on {end}&#160;​<br/></p>
      </div>
    </div>'''


def sama_html(fitr, adha):
    buttons = ('Eid Al -Fitr Holiday', 'Eid Al-Adha Holiday', 'National&#160;Day and Founding Day')
    tabs = ''.join(f'<button id="tab{i}-tab" data-bs-target="#tab{i}-pane">{label}</button>'
                   for i, label in enumerate(buttons, 1))
    eids = ''.join(f'''<div id="tab{i}-pane" aria-labelledby="tab{i}-tab">
      <div class="holiday-card">
        <div class="holiday-card__header"><h3>Official Holidays of Financial Institutions</h3></div>
        <div class="holiday-card__body"><div class="holiday-years">{ranges}</div>
          <h3>Official Holidays for the Saudi Arabian Riyal Interbank Express System (RTGS)</h3>
          <div class="holiday-years">{rtgs}</div>
        </div>
      </div>
    </div>''' for i, ranges, rtgs in (
        (1, fitr, sama_range(1449, 2028, 'Wednesday (28/09/1449H) corresponding to (23/02/2028)',
                             'Thursday (29/09/1449H) corresponding to (24/02/2028)')),
        (2, adha, sama_range(1449, 2028, 'Thursday (09/12/1449H) corresponding to (04/05/2028)',
                             'Sunday (12/12/1449H) corresponding to (07/05/2028)'))))
    return tabs + eids + f'''<div id="tab3-pane" aria-labelledby="tab3-tab">
      <h3>National Day and Funding Day</h3>
      <h6 class="card-title">The Saudi National Day is on the 23rd of September every year .</h6>
      <h6 class="card-title">The Founding Day is on the 22nd of February every year.</h6>
      <span class="note-sub-title">{SAMA_NOTE}</span>
    </div>'''


SAMA_2028 = sama_html(
    sama_range(1449, 2028, 'Sunday (02/10/1449H) corresponding to (27/02/2028)',
               'Thursday (06/10/1449H) corresponding to (02/03/2028)'),
    sama_range(1449, 2028, 'Wednesday&#160;(08/12/1449H) corresponding to (03/05/2028)',
               'Tuesday&#160;(14/12/1449H) corresponding to (09/05/2028)'),
)


class IntlHolidayTests(unittest.TestCase):
    def test_nsw_statewide_only_and_additional_days(self):
        from vendor_holidays_intl import au_years
        out = au_years(NSW_2026_27)
        self.assertEqual(set(out), {'2026', '2027'})
        self.assertEqual([len(out[y]) for y in ('2026', '2027')], [13, 14])
        self.assertIn(['2026-04-25', '澳新军团日'], out['2026'])
        self.assertIn(['2026-04-27', '澳新军团日', '2026-04-25'], out['2026'])
        self.assertIn(['2027-04-26', '澳新军团日', '2027-04-25'], out['2027'])
        self.assertIn(['2027-12-27', '圣诞节', '2027-12-25'], out['2027'])
        self.assertIn(['2027-12-28', '节礼日', '2027-12-26'], out['2027'])
        self.assertFalse({'2026-08-03', '2026-11-13'} & {row[0] for row in out['2026']})

    def test_nsw_rejects_missing_or_shifted_rows_and_changed_layout(self):
        from vendor_holidays_intl import au_years
        for edited in (
            NSW_2026_27.replace('id="nsw-public-holidays"', 'id="local-public-holidays"'),
            NSW_2026_27.replace('<th>2026</th>', '<th>2025</th>'),
            NSW_2026_27.replace('Saturday 4 April', 'Sunday 4 April'),
            NSW_2026_27.replace('<td>Sunday 5 April 2026</td>', '<td>Sunday 5 April 2026</td><td>extra</td>'),
            NSW_2026_27.replace('Monday 27 April 2026', 'Not applicable'),
            NSW_2026_27.replace('Monday 28 December 2026', 'Not applicable'),
            NSW_2026_27.replace('Christmas Day</td>', 'A different holiday</td>'),
            NSW_2026_27.split('</table>', 1)[0],
        ):
            with self.subTest(edited=edited[:100]), self.assertRaises(MergeError):
                au_years(edited)

    def test_sama_expands_only_financial_institution_ranges_and_uses_sunday_substitute(self):
        from vendor_holidays_intl import sa_years
        out = sa_years(SAMA_2028)
        self.assertEqual(set(out), {'2028'})
        self.assertEqual(out['2028'][:6], [
            ['2028-02-22', '沙特建国日'], ['2028-02-27', '沙特开斋节'], ['2028-02-28', '沙特开斋节'],
            ['2028-02-29', '沙特开斋节'], ['2028-03-01', '沙特开斋节'], ['2028-03-02', '沙特开斋节'],
        ])
        self.assertIn(['2028-05-03', '宰牲节'], out['2028'])
        self.assertIn(['2028-05-09', '宰牲节'], out['2028'])
        self.assertEqual(len(out['2028']), 14)
        self.assertEqual(out['2028'][-1], ['2028-09-24', '沙特国庆日', '2028-09-23'])

    def test_sama_uses_thursday_substitute_for_friday(self):
        from vendor_holidays_intl import sa_years
        page = sama_html(
            sama_range(1451, 2030, 'Sunday (01/10/1451H) corresponding to (03/02/2030)',
                       'Thursday (05/10/1451H) corresponding to (07/02/2030)'),
            sama_range(1451, 2030, 'Sunday (08/12/1451H) corresponding to (07/04/2030)',
                       'Thursday (12/12/1451H) corresponding to (11/04/2030)'),
        )
        out = sa_years(page)['2030']
        self.assertIn(['2030-02-21', '沙特建国日', '2030-02-22'], out)
        self.assertNotIn('2030-02-22', {row[0] for row in out})

    def test_sama_rejects_wrong_boundaries_years_layout_or_clause(self):
        from vendor_holidays_intl import sa_years
        for old, new in (
            ('(27/02/2028)', '(30/02/2028)'),
            ('(27/02/2028)', '(27/02/2029)'),
            ('Sunday (02/10/1449H)', 'Monday (02/10/1449H)'),
            ('Thursday (06/10/1449H) corresponding to (02/03/2028)',
             'Saturday (06/10/1449H) corresponding to (26/02/2028)'),
            ('Ends on Thursday (06/10/1449H)', 'Starts on Thursday (06/10/1449H)'),
            ('1449H - 2028', '1450H - 2028'),
            ('Eid Al -Fitr Holiday', 'Eid Al-Adha Holiday'),
            ('Official Holidays of Financial Institutions', 'Official Holidays of Banks'),
            ('class="holiday-years"', 'class="replaced-layout"'),
            ('23rd of September', '24th of September'),
            ('holiday will be on a Thursday', 'holiday will be on a Friday'),
        ):
            with self.subTest(old=old), self.assertRaises(MergeError):
                sa_years(SAMA_2028.replace(old, new, 1))


    def test_folded_ics_and_us_observed_cross_year(self):
        raw = ics(US_2027 + [('20270120', 'Inauguration Day')]).replace('Birthday of Martin', 'Birthday of\r\n  Martin')
        out = us_years(raw, 2027)
        self.assertEqual(len(out['2027']), 12)
        self.assertEqual(out['2027'][-1], ['2027-12-31', '元旦', '2028-01-01'])
        self.assertIn(['2027-07-05', '美国独立日', '2027-07-04'], out['2027'])
        self.assertNotIn('2028', out)

    def test_us_rejects_incomplete_interior_year(self):
        with self.assertRaises(MergeError):
            us_years(ics([e for e in US_2027 if e[0] != '20271125']), 2027)

    def test_sg_uses_website_for_sunday_and_not_saturday(self):
        schedule = parse_mom(mom_html())
        out = reconcile_sg(schedule['2027'], ics(SG_ICS), '2027')
        self.assertIn(['2027-02-08', '春节', '2027-02-07'], out)
        self.assertFalse(any(row[0] == '2027-05-03' for row in out))

    def test_sg_accepts_ics_also_carrying_confirmed_substitute(self):
        data = ics(SG_ICS + [('20270208', 'Chinese New Year')])
        self.assertEqual(len(reconcile_sg(parse_mom(mom_html())['2027'], data, '2027')), 12)

    def test_sg_fails_closed_on_missing_note_or_ics_disagreement(self):
        with self.assertRaises(MergeError):
            parse_mom(mom_html(''))
        with self.assertRaises(MergeError):
            reconcile_sg(parse_mom(mom_html())['2027'], ics(SG_ICS[:-1]), '2027')

    def test_reject_truncated_payload_unknown_names_and_invalid_dates(self):
        with self.assertRaises(MergeError):
            parse_ics(ics([('20270230', 'Chinese New Year')]))
        with self.assertRaises(MergeError):
            parse_mom(mom_html(rows=SG_2027[:-1]))
        with self.assertRaises(MergeError):
            us_years(ics(US_2027 + [('20270706', 'Unrecognised holiday')]), 2027)

    def test_japan_substitute_and_bridge_day(self):
        from vendor_holidays_intl import jp_years
        data = '''国民の祝日・休日月日,国民の祝日・休日名称
2026/1/1,元日
2026/1/12,成人の日
2026/2/11,建国記念の日
2026/2/23,天皇誕生日
2026/3/20,春分の日
2026/4/29,昭和の日
2026/5/3,憲法記念日
2026/5/4,みどりの日
2026/5/5,こどもの日
2026/5/6,休日
2026/7/20,海の日
2026/8/11,山の日
2026/9/21,敬老の日
2026/9/22,休日
2026/9/23,秋分の日
2026/10/12,スポーツの日
2026/11/3,文化の日
2026/11/23,勤労感謝の日
'''
        out = jp_years(data, 2026)['2026']
        self.assertIn(['2026-05-06', '宪法纪念日', '2026-05-03'], out)
        self.assertIn(['2026-09-22', '国民休息日'], out)
        with self.assertRaises(MergeError):
            jp_years(data.replace('2026/5/6,休日\n', ''), 2026)
        with self.assertRaises(MergeError):
            jp_years(data.replace('2026/11/23,勤労感謝の日\n', ''), 2026)

    def test_gb_substitute_is_preserved_and_scotland_is_excluded(self):
        from vendor_holidays_intl import gb_years
        days = [('New Year’s Day', '2027-01-01'), ('Good Friday', '2027-03-26'),
                ('Easter Monday', '2027-03-29'), ('Early May bank holiday', '2027-05-03'),
                ('Spring bank holiday', '2027-05-31'), ('Summer bank holiday', '2027-08-30'),
                ('Christmas Day', '2027-12-27'), ('Boxing Day', '2027-12-28')]
        events = [{'title': name, 'date': day, 'notes': 'Substitute day' if day >= '2027-12-27' else ''}
                  for name, day in days]
        feed = {'england-and-wales': {'division': 'england-and-wales', 'events': events},
                'scotland': {'events': [{'title': 'St Andrew’s Day', 'date': '2027-11-30', 'notes': ''}]}}
        out = gb_years(feed, 2027)['2027']
        self.assertEqual(len(out), 8)
        self.assertEqual(out[-1], ['2027-12-28', '节礼日', '2027-12-26'])
        with self.assertRaises(MergeError):
            gb_years({'scotland': feed['scotland']}, 2027)
        events.pop()
        with self.assertRaises(MergeError):
            gb_years(feed, 2027)

    def test_france_requires_complete_metropolitan_feed_and_does_not_shift_weekends(self):
        from vendor_holidays_intl import fr_years
        dates = {'2026-01-01': '1er janvier', '2026-04-06': 'Lundi de Pâques',
                 '2026-05-01': '1er mai', '2026-05-08': '8 mai', '2026-05-14': 'Ascension',
                 '2026-05-25': 'Lundi de Pentecôte', '2026-07-14': '14 juillet',
                 '2026-08-15': 'Assomption', '2026-11-01': 'Toussaint', '2026-11-11': '11 novembre',
                 '2026-12-25': 'Jour de Noël'}
        out = fr_years(dates, 2026)['2026']
        self.assertIn(['2026-11-01', '诸圣节'], out)
        self.assertFalse(any(row[0] == '2026-11-02' for row in out))
        dates.pop('2026-11-01')
        with self.assertRaises(MergeError):
            fr_years(dates, 2026)

    def test_south_africa_sunday_rule_fills_an_omission_and_checks_explicit_dates(self):
        from vendor_holidays_intl import za_years
        page = '''<h2><a id="2027"></a><strong>2027</strong></h2>
        <p>1 January: New Year’s Day</p><p>21 March: Human Rights Day</p>
        <p>22 March: Public holiday Human Rights Day observed <a href="#**">**</a></p>
        <p>26 March: Good Friday <a href="#*">*</a><br><br>29 March: Family Day<br>27 April: Freedom Day<br>1 May: Workers' Day<br>16 June: Youth Day<br>9 August: National Women’s Day</p>
        <p>24 September: Heritage Day</p><p>16 December: Day of Reconciliation<br>25 December: Christmas Day<br>26 December: Day of Goodwill</p>
        <p><a id="**">**</a>The Public Holidays Act determines the dates.</p><h2>History</h2>'''
        out = za_years(page)['2027']
        self.assertIn(['2027-03-22', '人权日', '2027-03-21'], out)
        self.assertIn(['2027-12-27', '善意日', '2027-12-26'], out)
        self.assertFalse(any(row[0] == '2027-05-03' for row in out))
        with self.assertRaises(MergeError):
            za_years(page.replace('22 March:', '23 March:'))
        with self.assertRaises(MergeError):
            za_years(page.replace('<br>26 December: Day of Goodwill', ''))

    def test_keep_archived_year_but_never_replace_missing_latest_year(self):
        old = {'2025': [['2025-01-01', '元旦']], '2026': [['2026-01-01', '元旦']]}
        self.assertEqual(merge_years(old, {'2026': old['2026'], '2027': [['2027-01-01', '元旦']]}, 2026).keys(),
                         {'2025', '2026', '2027'})
        with self.assertRaises(MergeError):
            merge_years(old, {'2025': old['2025']}, 2026)


if __name__ == '__main__':
    unittest.main()

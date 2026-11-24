import unittest
from datetime import date

from vendor_holidays_intl import MergeError, parse_ics, parse_mom, reconcile_sg, us_years, merge_years


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


class IntlHolidayTests(unittest.TestCase):
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

    def test_keep_archived_year_but_never_replace_missing_latest_year(self):
        old = {'2025': [['2025-01-01', '元旦']], '2026': [['2026-01-01', '元旦']]}
        self.assertEqual(merge_years(old, {'2026': old['2026'], '2027': [['2027-01-01', '元旦']]}, 2026).keys(),
                         {'2025', '2026', '2027'})
        with self.assertRaises(MergeError):
            merge_years(old, {'2025': old['2025']}, 2026)


if __name__ == '__main__':
    unittest.main()

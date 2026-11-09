// Thin wrapper around vendor/lunar.js (6tail lunar-javascript v1.7.7, MIT).
// vendor/lunar.js is loaded as a classic <script> before this module and
// attaches `Solar`/`Lunar` onto the global scope — this file is the only
// place that touches those globals, so a future library swap only changes here.

import { YIJI_OVERRIDES } from './data/yiji-overrides.js';

// Fixed-date statutory holidays. The 放假/调休 arrangement is announced yearly,
// but the festival itself is known in advance, so label it even without data.
const SOLAR_PUBLIC_HOLIDAYS = ['元旦节', '劳动节', '国庆节'];

export function getDayInfo(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const solar = Solar.fromYmd(y, m, d);
  const lunar = solar.getLunar();
  const day = lunar.getDay();

  // 宜/忌: lunar.js's table is a frozen snapshot of 2345万年历's data
  // (~99.5% identical). The override file lists the dates where 2345's
  // current published values differ — we follow 2345 verbatim there.
  // Regenerated daily by .github/workflows/yiji-sync.yml.
  const override = YIJI_OVERRIDES[dateStr];

  return {
    date: dateStr,
    // Convention: show the lunar month name on day 1 instead of "初一".
    dayLabel: day === 1 ? `${lunar.getMonthInChinese()}月` : lunar.getDayInChinese(),
    fullLabel: `${lunar.getYearInGanZhi()}年 ${lunar.getMonthInChinese()}月${lunar.getDayInChinese()}`,
    jieqi: lunar.getJieQi() || '',
    solarFestival: solar.getFestivals().find((f) => SOLAR_PUBLIC_HOLIDAYS.includes(f)) || '',
    festival: lunar.getFestivals()[0] || lunar.getOtherFestivals()[0] || '',
    yi: override ? override.yi : lunar.getDayYi(),
    ji: override ? override.ji : lunar.getDayJi(),
  };
}

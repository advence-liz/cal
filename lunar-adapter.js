// Thin wrapper around vendor/lunar.js (6tail lunar-javascript v1.7.7, MIT).
// vendor/lunar.js is loaded as a classic <script> before this module and
// attaches `Solar`/`Lunar` onto the global scope — this file is the only
// place that touches those globals, so a future library swap only changes here.

export function getDayInfo(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const lunar = Solar.fromYmd(y, m, d).getLunar();
  const day = lunar.getDay();

  return {
    date: dateStr,
    // Convention: show the lunar month name on day 1 instead of "初一".
    dayLabel: day === 1 ? `${lunar.getMonthInChinese()}月` : lunar.getDayInChinese(),
    fullLabel: `${lunar.getYearInGanZhi()}年 ${lunar.getMonthInChinese()}月${lunar.getDayInChinese()}`,
    jieqi: lunar.getJieQi() || '',
    festival: lunar.getFestivals()[0] || lunar.getOtherFestivals()[0] || '',
    yi: lunar.getDayYi(),
    ji: lunar.getDayJi(),
  };
}

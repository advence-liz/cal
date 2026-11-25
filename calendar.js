// Month grid renderer. Monday-first (中国习惯).

import { formatDate, parseDate, addDays, isWeekend } from './workday.js';
import { t, english, holidayLabel, dateLabel } from './i18n.js';
import { getDayInfo } from './lunar-adapter.js';
import { JIEQI_INFO, FESTIVAL_INFO } from './almanac-info.js';

const MONTH_NAMES = ['一月', '二月', '三月', '四月', '五月', '六月',
                     '七月', '八月', '九月', '十月', '十一月', '十二月'];

// Curated subset of the ~40-term almanac vocabulary, mapped to friendlier
// labels. `term` must match lunar.js's getDayYi()/getDayJi() output exactly.
export const ACTIVITIES = [
  { label: '出行', term: '出行' },
  { label: '搬家', term: '移徙' },
  { label: '入宅', term: '入宅' },
  { label: '结婚', term: '嫁娶' },
  { label: '订婚', term: '订盟' },
  { label: '开业', term: '开市' },
  { label: '理发', term: '理发' },
  { label: '装修', term: '动土' },
  { label: '安床', term: '安床' },
];

function dowMonFirst(date) {
  // Mon=0 ... Sun=6
  return (date.getDay() + 6) % 7;
}

// Pure grid math, no DOM — returns the 7-wide cell list for a month
// (includes leading/trailing days from adjacent months to fill the grid).
export function getMonthCells(year, month) {
  const first = new Date(year, month - 1, 1);
  const firstDow = dowMonFirst(first);
  const daysInMonth = new Date(year, month, 0).getDate();
  const prevDays = new Date(year, month - 1, 0).getDate();

  const cells = [];
  for (let i = firstDow - 1; i >= 0; i--) {
    cells.push({ date: new Date(year, month - 2, prevDays - i), otherMonth: true });
  }
  for (let day = 1; day <= daysInMonth; day++) {
    cells.push({ date: new Date(year, month - 1, day), otherMonth: false });
  }
  const totalCells = firstDow + daysInMonth;
  const trail = (7 - (totalCells % 7)) % 7;
  for (let i = 1; i <= trail; i++) {
    cells.push({ date: new Date(year, month, i), otherMonth: true });
  }
  return cells;
}

// Pure day lookup: holiday meta + weekday + lunar info for one date.
// Shared by the grid cell (tooltip/tag) and the tap-to-view detail panel.
export function describeDay(dateStr, dataStore, { showLunar = true, showChineseFestivals = true, weekendDays } = {}) {
  const dateObj = parseDate(dateStr);
  const year = dateObj.getFullYear();
  const yearMap = dataStore.get(year);
  const meta = yearMap ? yearMap.get(dateStr) : undefined;
  const dow = dateObj.getDay(); // 0 Sun ... 6 Sat

  // Lunar year range is bounded (1900-2100 in vendor/lunar.js); dates near
  // that edge should degrade to solar-only rather than throw.
  let lunarInfo = null;
  if (showLunar) {
    try {
      lunarInfo = getDayInfo(dateStr);
      // This library supplies Chinese cultural festivals, not local holidays.
      if (!showChineseFestivals) lunarInfo = { ...lunarInfo, festival: '', solarFestival: '' };
    } catch {
      lunarInfo = null;
    }
  }

  return { dateStr, dow, weekend: isWeekend(dow, weekendDays), meta, lunarInfo };
}

const solarTerms = Object.fromEntries('小寒 大寒 立春 雨水 惊蛰 春分 清明 谷雨 立夏 小满 芒种 夏至 小暑 大暑 立秋 处暑 白露 秋分 寒露 霜降 立冬 小雪 大雪 冬至'.split(' ').map((term, i) => [term,
  ['Minor Cold', 'Major Cold', 'Start of Spring', 'Rain Water', 'Awakening of Insects', 'Spring Equinox', 'Clear and Bright', 'Grain Rain', 'Start of Summer', 'Grain Full', 'Grain in Ear', 'Summer Solstice', 'Minor Heat', 'Major Heat', 'Start of Autumn', 'End of Heat', 'White Dew', 'Autumn Equinox', 'Cold Dew', 'Frost Descent', 'Start of Winter', 'Minor Snow', 'Major Snow', 'Winter Solstice'][i]]));
const termsLabel = (name) => english() ? solarTerms[name] || name : name;
const lunarMonthLabel = (month) => month < 0 ? `Leap month ${-month}` : `Month ${month}`;

// Human-readable summary lines for a describeDay() result.
export function describeDayText(info) {
  const lines = [];
  if (info.meta) {
    const { name, isOffDay, observedFor } = info.meta;
    const translated = holidayLabel(name);
    if (observedFor) lines.push(t(`${name} · 补休（原节日 ${observedFor}）`, `${translated} · Observed (original date ${observedFor})`));
    else lines.push(isOffDay ? t(`${name} · 法定假`, `${translated} · Public holiday`) : t(`${name} · 调休补班`, `${translated} · Make-up workday`));
  } else if (info.weekend) {
    lines.push(t('周末', 'Weekend'));
  } else {
    lines.push(t('工作日', 'Workday'));
  }
  if (info.lunarInfo) {
    const { fullLabel, lunarMonth, lunarDay, jieqi, festival, solarFestival } = info.lunarInfo;
    lines.push(t(`农历 ${fullLabel}`, `Lunar calendar: ${lunarMonthLabel(lunarMonth)}, day ${lunarDay}`));
    if (jieqi) lines.push(t(`节气：${jieqi}`, `Solar term: ${termsLabel(jieqi)}`));
    if (festival) lines.push(t(`传统节日：${festival}`, `Traditional festival: ${holidayLabel(festival)}`));
    if (solarFestival) lines.push(t(`节日：${solarFestival}`, `Festival: ${holidayLabel(solarFestival)}`));
  }
  return lines;
}

// Background/科普 blurbs for this day's 节气/节日, if we have a curated
// entry for them. Deliberately returns nothing for terms we're not
// confident describing accurately (see almanac-info.js).
export function describeDayFacts(info) {
  const facts = [];
  if (!info.lunarInfo) return facts;
  const { jieqi, festival } = info.lunarInfo;
  if (jieqi && JIEQI_INFO[jieqi]) facts.push({ term: jieqi, kind: 'jieqi', blurb: JIEQI_INFO[jieqi] });
  if (festival && FESTIVAL_INFO[festival]) facts.push({ term: festival, kind: 'festival', blurb: FESTIVAL_INFO[festival] });
  return facts;
}

// Does this day's 宜 (suitable) list include the given almanac term?
export function suitsActivity(info, term) {
  return !!term && !!info.lunarInfo && info.lunarInfo.yi.includes(term);
}

// Scan forward from (not including) fromDateStr for the next date whose 宜
// list includes `term`. Pure algorithmic lunar lookup — no CDN/holiday data
// needed, so it can search arbitrarily far ahead. Returns null if nothing
// found within maxDays (shouldn't happen in practice; every activity in
// ACTIVITIES recurs at least every few weeks).
export function findNextSuitableDate(fromDateStr, term, dataStore, maxDays = 730) {
  let cursor = fromDateStr;
  for (let i = 0; i < maxDays; i++) {
    cursor = addDays(cursor, 1);
    if (suitsActivity(describeDay(cursor, dataStore), term)) return cursor;
  }
  return null;
}

export function renderMonth(year, month, container, dataStore, todayStr, selectedStr, activityTerm = '', leaveDates = null, dayOptions) {
  // month is 1-12
  // Clear existing day cells, keep header (7 .cal-head)
  const heads = container.querySelectorAll('.cal-head');
  for (const head of heads) {
    head.classList.toggle('cal-head--weekend', isWeekend(Number(head.dataset.weekday), dayOptions?.weekendDays));
  }
  container.replaceChildren(...heads);

  for (const { date, otherMonth } of getMonthCells(year, month)) {
    container.appendChild(makeCell(date, otherMonth, dataStore, todayStr, selectedStr, activityTerm, leaveDates, dayOptions));
  }
}

function makeCell(dateObj, otherMonth, dataStore, todayStr, selectedStr, activityTerm, leaveDates, dayOptions) {
  const dateStr = formatDate(dateObj);
  const info = describeDay(dateStr, dataStore, dayOptions);
  const { meta, weekend, lunarInfo } = info;

  const cell = document.createElement('div');
  cell.className = 'day';
  cell.dataset.date = dateStr;
  cell.tabIndex = 0;
  cell.setAttribute('role', 'button');
  if (otherMonth) cell.classList.add('day--other-month');
  if (dateStr === todayStr) cell.classList.add('day--today');
  if (dateStr === selectedStr) cell.classList.add('day--selected');
  if (suitsActivity(info, activityTerm)) cell.classList.add('day--suits');
  if (leaveDates && leaveDates.has(dateStr)) cell.classList.add('day--leave');

  const facts = describeDayFacts(info);
  if (facts.length > 0) cell.classList.add('day--has-fact');

  if (meta) {
    cell.classList.add(meta.isOffDay ? 'day--holiday' : 'day--makeup');
  } else if (weekend) {
    cell.classList.add('day--weekend');
  }
  const titleParts = describeDayText(info);
  if (leaveDates && leaveDates.has(dateStr)) titleParts.push(t('拼假攻略：建议请假', 'Leave planner: suggested day off'));
  if (titleParts.length > 0) {
    cell.title = titleParts.join(' · ');
    cell.setAttribute('aria-label', `${dateStr} ${titleParts.join('，')}`);
  }

  const num = document.createElement('span');
  num.className = 'num';
  num.textContent = dateObj.getDate();
  cell.appendChild(num);

  // Tag priority: 法定假/调休班 > 农历节日 > 节气 > 农历日.
  let tagText = '';
  let tagKind = '';
  if (meta) {
    tagText = meta.isOffDay ? holidayLabel(meta.name) : t('班', 'Work');
  } else if (lunarInfo && (lunarInfo.festival || lunarInfo.solarFestival)) {
    tagText = holidayLabel(lunarInfo.festival || lunarInfo.solarFestival);
    tagKind = 'festival';
  } else if (lunarInfo && lunarInfo.jieqi) {
    tagText = termsLabel(lunarInfo.jieqi);
    tagKind = 'jieqi';
  } else if (lunarInfo) {
    tagText = english() ? `${lunarInfo.lunarMonth < 0 ? 'L' : ''}${Math.abs(lunarInfo.lunarMonth)}/${lunarInfo.lunarDay}` : lunarInfo.dayLabel;
    tagKind = 'lunar';
  }

  if (tagText) {
    const tag = document.createElement('span');
    tag.className = 'tag';
    if (tagKind) tag.classList.add(`tag--${tagKind}`);
    tag.textContent = tagText;
    cell.appendChild(tag);
  }

  if (facts.length > 0) {
    const badge = document.createElement('span');
    badge.className = 'fact-badge';
    badge.textContent = '📖';
    badge.setAttribute('aria-hidden', 'true');
    cell.appendChild(badge);
  }

  return cell;
}

export function monthTitle(year, month) {
  return english() ? dateLabel(new Date(year, month - 1, 1), { year: 'numeric', month: 'long' }) : `${year} 年 ${MONTH_NAMES[month - 1]}`;
}

// Month grid renderer. Monday-first (中国习惯).

import { formatDate, parseDate } from './workday.js';
import { getDayInfo } from './lunar-adapter.js';

const MONTH_NAMES = ['一月', '二月', '三月', '四月', '五月', '六月',
                     '七月', '八月', '九月', '十月', '十一月', '十二月'];

function dowMonFirst(date) {
  // Mon=0 ... Sun=6
  return (date.getDay() + 6) % 7;
}

export function renderMonth(year, month, container, dataStore, todayStr, selectedStr) {
  // month is 1-12
  // Clear existing day cells, keep header (7 .cal-head)
  const heads = container.querySelectorAll('.cal-head');
  container.replaceChildren(...heads);

  const first = new Date(year, month - 1, 1);
  const firstDow = dowMonFirst(first); // how many blanks at start
  const daysInMonth = new Date(year, month, 0).getDate();

  // Prev-month tail
  const prevDays = new Date(year, month - 1, 0).getDate();
  for (let i = firstDow - 1; i >= 0; i--) {
    const d = new Date(year, month - 2, prevDays - i);
    container.appendChild(makeCell(d, dataStore, todayStr, true, selectedStr));
  }

  // Current month
  for (let day = 1; day <= daysInMonth; day++) {
    const d = new Date(year, month - 1, day);
    container.appendChild(makeCell(d, dataStore, todayStr, false, selectedStr));
  }

  // Next-month head to complete 6x7 grid
  const totalCells = firstDow + daysInMonth;
  const trail = (7 - (totalCells % 7)) % 7;
  for (let i = 1; i <= trail; i++) {
    const d = new Date(year, month, i);
    container.appendChild(makeCell(d, dataStore, todayStr, true, selectedStr));
  }
}

function makeCell(dateObj, dataStore, todayStr, otherMonth, selectedStr) {
  const dateStr = formatDate(dateObj);
  const year = dateObj.getFullYear();
  const yearMap = dataStore.get(year);
  const meta = yearMap ? yearMap.get(dateStr) : undefined;
  const dow = dateObj.getDay(); // 0 Sun, 6 Sat

  // Lunar year range is bounded (1900-2100 in vendor/lunar.js); other-month
  // bleed near that edge should degrade to solar-only rather than throw.
  let lunarInfo = null;
  try {
    lunarInfo = getDayInfo(dateStr);
  } catch (err) {
    lunarInfo = null;
  }

  const cell = document.createElement('div');
  cell.className = 'day';
  cell.dataset.date = dateStr;
  if (otherMonth) cell.classList.add('day--other-month');
  if (dateStr === todayStr) cell.classList.add('day--today');
  if (dateStr === selectedStr) cell.classList.add('day--selected');

  const titleParts = [];
  if (meta) {
    if (meta.isOffDay) {
      cell.classList.add('day--holiday');
      titleParts.push(`${meta.name} · 法定假`);
    } else {
      cell.classList.add('day--makeup');
      titleParts.push(`${meta.name} · 调休补班`);
    }
  } else if (dow === 0 || dow === 6) {
    cell.classList.add('day--weekend');
    titleParts.push('周末');
  }
  if (lunarInfo) {
    titleParts.push(`农历 ${lunarInfo.fullLabel}`);
    if (lunarInfo.jieqi) titleParts.push(`节气：${lunarInfo.jieqi}`);
    if (lunarInfo.festival) titleParts.push(`传统节日：${lunarInfo.festival}`);
  }
  if (titleParts.length > 0) cell.title = titleParts.join(' · ');

  const num = document.createElement('span');
  num.className = 'num';
  num.textContent = dateObj.getDate();
  cell.appendChild(num);

  // Tag priority: 法定假/调休班 > 农历节日 > 节气 > 农历日.
  let tagText = '';
  let tagKind = '';
  if (meta) {
    tagText = meta.isOffDay ? meta.name : '班';
  } else if (lunarInfo && lunarInfo.festival) {
    tagText = lunarInfo.festival;
    tagKind = 'festival';
  } else if (lunarInfo && lunarInfo.jieqi) {
    tagText = lunarInfo.jieqi;
    tagKind = 'jieqi';
  } else if (lunarInfo) {
    tagText = lunarInfo.dayLabel;
    tagKind = 'lunar';
  }

  if (tagText) {
    const tag = document.createElement('span');
    tag.className = 'tag';
    if (tagKind) tag.classList.add(`tag--${tagKind}`);
    tag.textContent = tagText;
    cell.appendChild(tag);
  }

  return cell;
}

export function monthTitle(year, month) {
  return `${year} 年 ${MONTH_NAMES[month - 1]}`;
}

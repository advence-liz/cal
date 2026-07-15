// Wiring: data load → calendar render → form bindings → countdown.

import {
  loadYears,
  getDataStore,
  hasYear,
} from './holidays.js';
import {
  countWorkdays,
  addWorkdays,
  nextHoliday,
  formatDate,
  parseDate,
} from './workday.js';
import { renderMonth, monthTitle } from './calendar.js';

const $ = (id) => document.getElementById(id);

const state = {
  year: 0,
  month: 0,
  today: '',
  selected: '',
};

function showBanner(msg, kind = 'warn') {
  const b = $('banner');
  b.textContent = msg;
  b.hidden = false;
  b.dataset.kind = kind;
}

function todayStr() {
  return formatDate(new Date());
}

async function ensureYears(years) {
  const needed = years.filter((y) => !hasYear(y));
  if (needed.length === 0) return [];
  return loadYears(needed);
}

function reportLoadResults(results) {
  const failed = results.filter((r) => r.source === 'failed');
  const stale = results.filter((r) => r.source === 'stale-cache');
  const unpublished = failed.filter((r) => r.error?.status === 404);

  if (failed.length === results.length && results.length > 0) {
    showBanner('⚠️ 法定假期数据加载失败（CDN 不可达且无缓存）。月历仅按周末渲染。');
    return;
  }
  if (unpublished.length > 0) {
    const years = unpublished.map((r) => r.year).join('、');
    showBanner(`ℹ️ ${years} 年度法定假期数据尚未发布，该年仅显示周末。`);
  } else if (stale.length > 0) {
    const years = stale.map((r) => r.year).join('、');
    showBanner(`ℹ️ ${years} 年使用了离线缓存（网络异常）。数据可能不是最新。`);
  }
}

async function gotoMonth(year, month) {
  // Normalize Dec/Jan overflow.
  if (month < 1) { year--; month = 12; }
  if (month > 12) { year++; month = 1; }
  state.year = year;
  state.month = month;

  // Ensure data for displayed year + adjacent (other-month cells may bleed).
  const wanted = [year - 1, year, year + 1];
  const results = await ensureYears(wanted);
  if (results.length > 0) reportLoadResults(results);

  $('monthTitle').textContent = monthTitle(year, month);
  renderMonth(year, month, $('calGrid'), getDataStore(), state.today, state.selected);
}

function renderNextHoliday() {
  const result = nextHoliday(state.today, getDataStore());
  const el = $('nextHoliday');
  if (!result) {
    el.textContent = '暂无后续法定假期数据';
    el.classList.remove('has-data');
    return;
  }
  el.innerHTML = `距 <strong>${result.name}</strong> 还有 <strong>${result.daysAway}</strong> 天 (${result.date})`;
  el.classList.add('has-data');
}

function bindCount() {
  const form = $('countForm');
  const out = $('countResult');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const start = form.start.value;
    const end = form.end.value;
    if (!start || !end) return;
    if (start > end) {
      out.textContent = '⚠️ 起始日期不能晚于结束日期';
      out.className = 'result error';
      return;
    }
    const startY = Number(start.slice(0, 4));
    const endY = Number(end.slice(0, 4));
    const wanted = [];
    for (let y = startY; y <= endY; y++) wanted.push(y);
    const results = await ensureYears(wanted);
    if (results.length > 0) reportLoadResults(results);
    try {
      const n = countWorkdays(start, end, getDataStore());
      const totalDays = Math.round((parseDate(end) - parseDate(start)) / 86400000) + 1;
      out.innerHTML = `区间共 ${totalDays} 天，其中工作日 <strong>${n}</strong> 天`;
      out.className = 'result ok';
    } catch (err) {
      out.textContent = '⚠️ ' + err.message;
      out.className = 'result error';
    }
  });
}

function bindAdd() {
  const form = $('addForm');
  const out = $('addResult');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const start = form.start.value;
    const n = Number(form.n.value);
    if (!start || !Number.isInteger(n)) {
      out.textContent = '⚠️ 请输入有效日期与整数 N';
      out.className = 'result error';
      return;
    }
    // Walking N workdays can cross years. Pre-load a generous window.
    const startY = Number(start.slice(0, 4));
    // ~250 workdays per year, so |n|/200 years buffer, min 1.
    const yearsSpan = Math.max(1, Math.ceil(Math.abs(n) / 200));
    const wanted = [];
    for (let dy = -yearsSpan; dy <= yearsSpan; dy++) wanted.push(startY + dy);
    const results = await ensureYears(wanted);
    if (results.length > 0) reportLoadResults(results);
    try {
      const result = addWorkdays(start, n, getDataStore());
      out.innerHTML = `结果：<strong>${result}</strong>`;
      out.className = 'result ok';
    } catch (err) {
      out.textContent = '⚠️ ' + err.message;
      out.className = 'result error';
    }
  });
}

function bindNav() {
  $('prevMonth').addEventListener('click', () => gotoMonth(state.year, state.month - 1));
  $('nextMonth').addEventListener('click', () => gotoMonth(state.year, state.month + 1));
  $('todayBtn').addEventListener('click', () => {
    state.today = todayStr();
    const t = parseDate(state.today);
    gotoMonth(t.getFullYear(), t.getMonth() + 1);
  });
}

function bindCalendarSelect() {
  $('calGrid').addEventListener('click', (e) => {
    const cell = e.target.closest('.day');
    if (!cell || !cell.dataset.date) return;

    state.selected = cell.dataset.date;
    $('countForm').start.value = state.selected;
    $('addForm').start.value = state.selected;

    $('calGrid').querySelectorAll('.day--selected').forEach((el) => el.classList.remove('day--selected'));
    cell.classList.add('day--selected');
  });
}

async function init() {
  state.today = todayStr();
  const t = parseDate(state.today);
  const initialYear = t.getFullYear();

  // Prefill forms with sensible defaults.
  $('countForm').start.value = state.today;
  $('countForm').end.value = formatDate(new Date(t.getFullYear(), t.getMonth() + 1, 0));
  $('addForm').start.value = state.today;

  bindNav();
  bindCalendarSelect();
  bindCount();
  bindAdd();

  await gotoMonth(initialYear, t.getMonth() + 1);
  renderNextHoliday();
}

init().catch((err) => {
  console.error(err);
  showBanner('启动失败：' + err.message);
});

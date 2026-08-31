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
import { renderMonth, monthTitle, describeDay, describeDayText, describeDayFacts, ACTIVITIES } from './calendar.js';

const $ = (id) => document.getElementById(id);
const WEEKDAY_CN = ['日', '一', '二', '三', '四', '五', '六'];

const state = {
  year: 0,
  month: 0,
  today: '',
  selected: '',
  activityTerm: '',
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

// --- URL 深链接：#YYYY-MM 或 #YYYY-MM-DD（含选中日）---
function parseHash() {
  const m = location.hash.match(/^#(\d{4})-(\d{2})(?:-(\d{2}))?$/);
  if (!m) return null;
  const [, y, mo, d] = m;
  return { year: Number(y), month: Number(mo), selected: d ? `${y}-${mo}-${d}` : '' };
}

function updateHash() {
  const y = state.year;
  const m = String(state.month).padStart(2, '0');
  const monthKey = `${y}-${m}`;
  const hash = state.selected.startsWith(monthKey) ? `#${state.selected}` : `#${monthKey}`;
  history.replaceState(null, '', hash);
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
  renderMonth(year, month, $('calGrid'), getDataStore(), state.today, state.selected, state.activityTerm);
  updateHash();
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

// --- 日期详情面板（tap-to-view，弥补移动端没有 title hover 的问题）---
function showDayDetail(dateStr) {
  const info = describeDay(dateStr, getDataStore());
  const d = parseDate(dateStr);
  $('dayDetailDate').textContent =
    `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 星期${WEEKDAY_CN[d.getDay()]}`;
  $('dayDetailLines').innerHTML = describeDayText(info).map((l) => `<li>${l}</li>`).join('');

  const yi = info.lunarInfo?.yi || [];
  const ji = info.lunarInfo?.ji || [];
  $('almanacYi').innerHTML = yi.map((t) => `<span class="almanac-tag almanac-tag--yi">${t}</span>`).join('')
    || '<span class="almanac-tag almanac-tag--empty">无</span>';
  $('almanacJi').innerHTML = ji.map((t) => `<span class="almanac-tag almanac-tag--ji">${t}</span>`).join('')
    || '<span class="almanac-tag almanac-tag--empty">无</span>';

  $('dayDetailFacts').innerHTML = describeDayFacts(info).map((f) =>
    `<p class="fact"><strong>${f.term}</strong>：${f.blurb}</p>`
  ).join('');

  // Collapse the almanac section again on every new day selection — keeps
  // the default view focused on "am I working today", per design review.
  $('almanacDetail').hidden = true;
  $('almanacToggle').setAttribute('aria-expanded', 'false');
  $('almanacToggle').classList.remove('almanac-toggle--open');

  $('dayDetail').hidden = false;
}

function bindAlmanacToggle() {
  const btn = $('almanacToggle');
  const panel = $('almanacDetail');
  btn.addEventListener('click', () => {
    const open = panel.hidden;
    panel.hidden = !open;
    btn.setAttribute('aria-expanded', String(open));
    btn.classList.toggle('almanac-toggle--open', open);
  });
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

// --- 活动筛选：点一个标签，高亮当月"宜"这件事的日子；再点一次取消 ---
function bindActivityFilters() {
  const container = $('activityFilters');
  container.innerHTML = ACTIVITIES.map((a) =>
    `<button type="button" class="activity-chip" data-term="${a.term}">${a.label}</button>`
  ).join('');

  container.addEventListener('click', (e) => {
    const btn = e.target.closest('.activity-chip');
    if (!btn) return;
    const term = btn.dataset.term;
    const label = btn.textContent;
    state.activityTerm = state.activityTerm === term ? '' : term;
    container.querySelectorAll('.activity-chip').forEach((el) =>
      el.classList.toggle('activity-chip--active', el.dataset.term === state.activityTerm));
    renderMonth(state.year, state.month, $('calGrid'), getDataStore(), state.today, state.selected, state.activityTerm);

    const status = $('activityFiltersStatus');
    if (state.activityTerm) {
      status.textContent = `当前显示：本月宜「${label}」的日子（绿框标出）`;
      status.hidden = false;
    } else {
      status.hidden = true;
    }
  });
}

function selectDay(cell) {
  state.selected = cell.dataset.date;
  $('countForm').start.value = state.selected;
  $('addForm').start.value = state.selected;

  $('calGrid').querySelectorAll('.day--selected').forEach((el) => el.classList.remove('day--selected'));
  cell.classList.add('day--selected');

  showDayDetail(state.selected);
  updateHash();
}

// Arrow-key movement is clamped to the cells currently rendered in the grid
// (35/42 cells incl. adjacent-month bleed) rather than crossing months —
// crossing would require an async re-render mid-keystroke.
function moveFocus(fromCell, deltaIndex) {
  const cells = [...$('calGrid').querySelectorAll('.day')];
  const idx = cells.indexOf(fromCell);
  const next = cells[idx + deltaIndex];
  if (next) next.focus();
}

function bindCalendarSelect() {
  $('calGrid').addEventListener('click', (e) => {
    const cell = e.target.closest('.day');
    if (!cell || !cell.dataset.date) return;
    selectDay(cell);
  });

  $('calGrid').addEventListener('keydown', (e) => {
    const cell = e.target.closest('.day');
    if (!cell || !cell.dataset.date) return;
    switch (e.key) {
      case 'Enter':
      case ' ':
        e.preventDefault();
        selectDay(cell);
        break;
      case 'ArrowRight': e.preventDefault(); moveFocus(cell, 1); break;
      case 'ArrowLeft': e.preventDefault(); moveFocus(cell, -1); break;
      case 'ArrowDown': e.preventDefault(); moveFocus(cell, 7); break;
      case 'ArrowUp': e.preventDefault(); moveFocus(cell, -7); break;
    }
  });
}

// --- 深色模式：手动切换优先，否则跟随系统 prefers-color-scheme ---
function bindTheme() {
  const KEY = 'cal:theme';
  const btn = $('themeToggle');
  const apply = (mode) => {
    if (mode) document.documentElement.dataset.theme = mode;
    else delete document.documentElement.dataset.theme;
    const isDark = mode === 'dark' ||
      (!mode && window.matchMedia('(prefers-color-scheme: dark)').matches);
    btn.textContent = isDark ? '☀️' : '🌙';
  };
  apply(localStorage.getItem(KEY));
  btn.addEventListener('click', () => {
    const current = document.documentElement.dataset.theme ||
      (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    const next = current === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem(KEY, next); } catch { /* ignore */ }
    apply(next);
  });
}

// Jump the view to whatever #YYYY-MM(-DD) is currently in the URL.
// Shared by init() and the hashchange listener (e.g. a pasted deep link
// while the app is already open — same-document hash nav doesn't reload).
async function applyHashView(fallbackYear, fallbackMonth) {
  const fromHash = parseHash();
  const year = fromHash ? fromHash.year : fallbackYear;
  const month = fromHash ? fromHash.month : fallbackMonth;
  state.selected = fromHash?.selected || '';

  await gotoMonth(year, month);
  if (state.selected) {
    const cell = $('calGrid').querySelector(`[data-date="${state.selected}"]`);
    if (cell) {
      cell.classList.add('day--selected');
      showDayDetail(state.selected);
    }
  }
}

function bindHashChange() {
  window.addEventListener('hashchange', () => applyHashView(state.year, state.month));
}

async function init() {
  state.today = todayStr();
  const t = parseDate(state.today);

  // Prefill forms with sensible defaults.
  $('countForm').start.value = state.today;
  $('countForm').end.value = formatDate(new Date(t.getFullYear(), t.getMonth() + 1, 0));
  $('addForm').start.value = state.today;

  bindTheme();
  bindNav();
  bindActivityFilters();
  bindCalendarSelect();
  bindAlmanacToggle();
  bindCount();
  bindAdd();
  bindHashChange();

  await applyHashView(t.getFullYear(), t.getMonth() + 1);
  if (state.selected) {
    $('countForm').start.value = state.selected;
    $('addForm').start.value = state.selected;
  }
  renderNextHoliday();
}

init().catch((err) => {
  console.error(err);
  showBanner('启动失败：' + err.message);
});

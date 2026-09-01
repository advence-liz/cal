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
import { renderMonth, monthTitle, describeDay, describeDayText, describeDayFacts, findNextSuitableDate, ACTIVITIES } from './calendar.js';
import { ACTIVITY_TERM_INFO } from './almanac-info.js';
import { suggestHolidayOpportunities, yearsInRange } from './bridge-plan.js';

const $ = (id) => document.getElementById(id);
const WEEKDAY_CN = ['日', '一', '二', '三', '四', '五', '六'];

// CSS `scroll-behavior` can't override a `behavior: 'smooth'` passed
// explicitly to scrollIntoView() — respecting prefers-reduced-motion for
// these JS-driven scrolls has to happen here instead.
function scrollBehavior() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
}

const state = {
  year: 0,
  month: 0,
  today: '',
  selected: '',
  activityTerm: '',
  activityLabel: '',
  leaveDates: new Set(),
};

// Single top-of-page status slot shared by two unrelated senders: data-load
// problems (banner) and the leave-plan teaser. They must never compete for
// space — a real data problem always wins; the teaser reappears on its own
// once the banner clears, no re-render needed from the leave-plan side.
const statusBar = { banner: null, teaser: null };

function renderStatusBar() {
  const el = $('statusBar');
  if (statusBar.banner) {
    el.innerHTML = '';
    el.textContent = statusBar.banner.msg;
    el.title = statusBar.banner.msg;
    el.dataset.kind = statusBar.banner.kind;
    el.hidden = false;
  } else if (statusBar.teaser) {
    el.innerHTML = '';
    el.title = '';
    el.dataset.kind = 'teaser';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'status-bar__teaser-btn';
    btn.textContent = statusBar.teaser.msg;
    btn.addEventListener('click', statusBar.teaser.onClick);
    el.appendChild(btn);
    el.hidden = false;
  } else {
    el.hidden = true;
    el.innerHTML = '';
  }
}

function showBanner(msg, kind = 'warn') {
  statusBar.banner = { msg, kind };
  renderStatusBar();
}

function hideBanner() {
  statusBar.banner = null;
  renderStatusBar();
}

function setLeaveTeaser(msg, onClick) {
  statusBar.teaser = { msg, onClick };
  renderStatusBar();
}

function clearLeaveTeaser() {
  statusBar.teaser = null;
  renderStatusBar();
}

// Turn one year's load outcome into a user-facing (non-technical) banner, or
// null if that year's data is fine and any leftover banner should be cleared.
function bannerForYearStatus(year, status, error) {
  if (status === 'failed') {
    if (error?.status === 404) {
      return { msg: `ℹ️ ${year} 年度的法定节假日安排还没有公布，暂时按普通周末显示。`, kind: 'info' };
    }
    return { msg: `⚠️ 假期数据暂时获取不到，${year} 年的日历先按普通周末显示，网络恢复后会自动补上节假日安排。`, kind: 'warn' };
  }
  if (status === 'stale-cache') {
    return { msg: `ℹ️ ${year} 年用的是之前保存的假期数据，可能不是最新的，网络恢复后会自动更新。`, kind: 'info' };
  }
  return null;
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
  const failed = results.filter((r) => r.source === 'failed' && r.error?.status !== 404);
  const unpublished = results.filter((r) => r.source === 'failed' && r.error?.status === 404);
  const stale = results.filter((r) => r.source === 'stale-cache');

  if (failed.length > 0) {
    const years = failed.map((r) => r.year).join('、');
    showBanner(`⚠️ ${years} 年的假期数据暂时获取不到，这些年份先按普通周末计算，网络恢复后会自动更新。`);
  } else if (unpublished.length > 0) {
    const years = unpublished.map((r) => r.year).join('、');
    showBanner(`ℹ️ ${years} 年度的法定节假日安排还没有公布，暂时按普通周末计算。`);
  } else if (stale.length > 0) {
    const years = stale.map((r) => r.year).join('、');
    showBanner(`ℹ️ ${years} 年用的是之前保存的假期数据，可能不是最新的，网络恢复后会自动更新。`);
  } else {
    hideBanner();
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

  // The banner reflects the year actually on screen, not the whole prefetch
  // batch — a still-failing neighbor year (e.g. next year's data not yet
  // published) shouldn't keep flagging a perfectly fine displayed year, and
  // switching back to a year that loaded fine must clear any old banner.
  const displayedResult = results.find((r) => r.year === year);
  const displayedStatus = displayedResult ? displayedResult.source : (hasYear(year) ? 'cache' : null);
  const banner = bannerForYearStatus(year, displayedStatus, displayedResult?.error);
  if (banner) showBanner(banner.msg, banner.kind); else hideBanner();

  $('monthTitle').textContent = monthTitle(year, month);
  $('monthTitleMobile').textContent = `${year}年${month}月`;
  renderMonth(year, month, $('calGrid'), getDataStore(), state.today, state.selected, state.activityTerm, state.leaveDates);
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
  el.innerHTML = `距 <strong>${result.name}</strong> 还有 <strong>${result.daysAway}</strong>&nbsp;天 (${result.date})`;
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
  $('almanacYi').innerHTML = yi.map((t) => `<span class="almanac-tag almanac-tag--yi" data-term="${t}">${t}</span>`).join('')
    || '<span class="almanac-tag almanac-tag--empty">无</span>';
  $('almanacJi').innerHTML = ji.map((t) => `<span class="almanac-tag almanac-tag--ji" data-term="${t}">${t}</span>`).join('')
    || '<span class="almanac-tag almanac-tag--empty">无</span>';

  $('dayDetailFacts').innerHTML = describeDayFacts(info).map((f) =>
    `<p class="fact"><strong>${f.term}</strong>：${f.blurb}</p>`
  ).join('');

  $('dayDetail').hidden = false;
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

// --- 拼假攻略：浏览近期每个法定节假日的自然连休 + 最划算的加钱升级 ---
function formatLeaveDateLabel(dateStr) {
  const d = parseDate(dateStr);
  return `${d.getMonth() + 1}月${d.getDate()}日(周${WEEKDAY_CN[d.getDay()]})`;
}

function bindLeavePlan() {
  const out = $('leavePlanResult');
  let currentList = [];

  function flashLeavePlanCard() {
    const card = $('leavePlanCard');
    card.scrollIntoView({ behavior: scrollBehavior(), block: 'start' });
    card.classList.remove('tool-card--flash');
    // Re-trigger the animation even if it just played.
    void card.offsetWidth;
    card.classList.add('tool-card--flash');
  }

  function renderList(list) {
    currentList = list;
    if (list.length === 0) {
      out.innerHTML = '<p class="hint">近期暂时没有查到法定节假日安排（可能还没公布），过阵子再来看看。</p>';
      clearLeaveTeaser();
      return;
    }
    out.innerHTML = list.map((row, idx) => {
      const names = (row.recommended ? row.recommended.names : row.naturalNames).join(' + ');
      const naturalLine = `<div class="leave-plan__natural">不请假：连休 ${row.naturalDays}&nbsp;天（${row.naturalStart} ~ ${row.naturalEnd}）</div>`;
      if (!row.recommended) {
        return `
          <div class="leave-plan">
            <div class="leave-plan__title">${names}</div>
            ${naturalLine}
            <p class="hint">附近没有能再拼的工作日缺口，这已经是自然最长的连休了。</p>
          </div>
        `;
      }
      const r = row.recommended;
      const ratio = (r.totalDays / r.cost).toFixed(1);
      return `
        <div class="leave-plan">
          <div class="leave-plan__title">${names}</div>
          ${naturalLine}
          <div class="leave-plan__summary">请假 <strong>${r.cost}</strong>&nbsp;天 → 连休 <strong>${r.totalDays}</strong>&nbsp;天（${r.start} ~ ${r.end}），平均每请&nbsp;1&nbsp;天换 <strong>${ratio}</strong>&nbsp;天连休</div>
          <div class="leave-plan__dates">需请假：${r.leaveDates.map(formatLeaveDateLabel).join('、')}</div>
          <button type="button" class="leave-plan__mark-btn" data-idx="${idx}">在日历中标出 →</button>
        </div>
      `;
    }).join('') + '<button type="button" class="leave-plan__clear-btn" id="leavePlanClearBtn">清除标注</button>';

    // 用最靠前的一条有加钱升级的机会做入口提示，放在日历上面，不用滚到底才发现有这功能。
    const best = list.find((row) => row.recommended);
    if (best) {
      setLeaveTeaser(
        `🎉 ${best.recommended.names.join('+')}请 ${best.recommended.cost} 天连休 ${best.recommended.totalDays} 天 →`,
        flashLeavePlanCard
      );
    } else {
      clearLeaveTeaser();
    }
  }

  async function load() {
    out.innerHTML = '<p class="hint">加载中…</p>';
    const results = await ensureYears(yearsInRange(state.today));
    if (results.length > 0) reportLoadResults(results);
    renderList(suggestHolidayOpportunities(getDataStore(), { fromDate: state.today }));
  }

  out.addEventListener('click', async (e) => {
    if (e.target.closest('#leavePlanClearBtn')) {
      state.leaveDates = new Set();
      renderMonth(state.year, state.month, $('calGrid'), getDataStore(), state.today, state.selected, state.activityTerm, state.leaveDates);
      return;
    }
    const btn = e.target.closest('.leave-plan__mark-btn');
    if (!btn) return;
    const row = currentList[Number(btn.dataset.idx)];
    if (!row || !row.recommended) return;
    state.leaveDates = new Set(row.recommended.leaveDates);
    deselectDay();
    const jumpTo = parseDate(row.recommended.leaveDates[0] || row.recommended.start);
    await gotoMonth(jumpTo.getFullYear(), jumpTo.getMonth() + 1);
    $('calGrid').scrollIntoView({ behavior: scrollBehavior(), block: 'center' });
  });

  load();
}

// Navigating to a different month invalidates whatever day was selected —
// otherwise the detail panel stays frozen on the old day (possibly one that
// isn't even part of the new month's grid) and a stray other-month bleed
// cell can end up wrongly marked .day--selected.
function deselectDay() {
  state.selected = '';
  $('dayDetail').hidden = true;
}

function bindNav() {
  $('prevMonth').addEventListener('click', () => { deselectDay(); gotoMonth(state.year, state.month - 1); });
  $('nextMonth').addEventListener('click', () => { deselectDay(); gotoMonth(state.year, state.month + 1); });
  $('todayBtn').addEventListener('click', () => {
    deselectDay();
    state.today = todayStr();
    const t = parseDate(state.today);
    gotoMonth(t.getFullYear(), t.getMonth() + 1);
  });

  // Mobile-only sticky bottom bar — same actions, duplicated so the reach
  // doesn't require scrolling back to the top of a long page.
  $('prevMonthMobile').addEventListener('click', () => { deselectDay(); gotoMonth(state.year, state.month - 1); });
  $('nextMonthMobile').addEventListener('click', () => { deselectDay(); gotoMonth(state.year, state.month + 1); });
  $('todayBtnMobile').addEventListener('click', () => {
    deselectDay();
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
    state.activityTerm = state.activityTerm === term ? '' : term;
    state.activityLabel = state.activityTerm ? btn.textContent : '';
    container.querySelectorAll('.activity-chip').forEach((el) =>
      el.classList.toggle('activity-chip--active', el.dataset.term === state.activityTerm));
    renderMonth(state.year, state.month, $('calGrid'), getDataStore(), state.today, state.selected, state.activityTerm, state.leaveDates);

    const status = $('activityFiltersStatus');
    if (state.activityTerm) {
      $('activityFiltersStatusText').textContent = `当前显示：本月宜「${state.activityLabel}」的日子（绿框标出）`;
      status.hidden = false;
    } else {
      status.hidden = true;
    }
  });

  $('activityFindBtn').addEventListener('click', async () => {
    if (!state.activityTerm) return;
    const btn = $('activityFindBtn');
    btn.disabled = true;
    btn.textContent = '查找中…';
    const found = findNextSuitableDate(state.today, state.activityTerm, getDataStore());
    btn.disabled = false;
    btn.textContent = '找最近一天 →';
    if (!found) {
      $('activityFiltersStatusText').textContent = `两年内没找到宜「${state.activityLabel}」的日子，这不太可能，建议检查一下`;
      return;
    }
    const d = parseDate(found);
    await gotoMonth(d.getFullYear(), d.getMonth() + 1);
    const cell = $('calGrid').querySelector(`[data-date="${found}"]`);
    if (cell) selectDay(cell);
    $('activityFiltersStatusText').textContent =
      `距今最近的宜「${state.activityLabel}」是 ${found}（已跳转，绿框标出）`;
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

// --- 科普速览：hover/聚焦有📖标记的格子，或宜/忌标签，直接弹出简介——
// 不用滚到底部详情面板才能看到，也不用猜"纳采"是什么意思 ---
function bindDayPopover() {
  const popover = $('dayPopover');
  const grid = $('calGrid');
  const detail = $('dayDetail');

  function positionNear(el) {
    const elRect = el.getBoundingClientRect();
    const popRect = popover.getBoundingClientRect();
    let top = elRect.bottom + 6;
    if (top + popRect.height > window.innerHeight - 8) top = elRect.top - popRect.height - 6;
    let left = elRect.left + elRect.width / 2 - popRect.width / 2;
    left = Math.max(8, Math.min(left, window.innerWidth - popRect.width - 8));
    popover.style.top = `${Math.max(8, top)}px`;
    popover.style.left = `${left}px`;
  }

  function showHtml(el, html) {
    if (!html) return;
    popover.innerHTML = html;
    popover.hidden = false;
    positionNear(el);
  }

  function hide() { popover.hidden = true; }

  function dayFactsHtml(dateStr) {
    const facts = describeDayFacts(describeDay(dateStr, getDataStore()));
    return facts.map((f) => `<p class="day-popover__fact"><strong>${f.term}</strong>：${f.blurb}</p>`).join('');
  }

  function termHtml(term) {
    const blurb = ACTIVITY_TERM_INFO[term];
    if (!blurb) return '';
    return `<p class="day-popover__fact"><strong>${term}</strong>：${blurb}</p>`;
  }

  grid.addEventListener('mouseover', (e) => {
    const cell = e.target.closest('.day--has-fact');
    if (cell) showHtml(cell, dayFactsHtml(cell.dataset.date));
  });
  grid.addEventListener('mouseout', (e) => {
    const cell = e.target.closest('.day--has-fact');
    if (cell && !cell.contains(e.relatedTarget)) hide();
  });
  grid.addEventListener('focusin', (e) => {
    const cell = e.target.closest('.day--has-fact');
    if (cell) showHtml(cell, dayFactsHtml(cell.dataset.date));
  });
  grid.addEventListener('focusout', hide);

  // 宜/忌术语解释：同一套弹层，触发源换成详情面板里的标签。
  detail.addEventListener('mouseover', (e) => {
    const tag = e.target.closest('.almanac-tag[data-term]');
    if (tag) showHtml(tag, termHtml(tag.dataset.term));
  });
  detail.addEventListener('mouseout', (e) => {
    const tag = e.target.closest('.almanac-tag[data-term]');
    if (tag && !tag.contains(e.relatedTarget)) hide();
  });
  detail.addEventListener('click', (e) => {
    const tag = e.target.closest('.almanac-tag[data-term]');
    if (tag) showHtml(tag, termHtml(tag.dataset.term));
  });

  window.addEventListener('scroll', hide, { passive: true });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hide(); });
}

// --- 深色模式：手动切换优先，否则跟随系统 prefers-color-scheme ---
function bindTheme() {
  const KEY = 'cal:theme';
  const btn = $('themeToggle');
  const themeColorMeta = document.querySelector('meta[name="theme-color"]');
  const apply = (mode) => {
    if (mode) document.documentElement.dataset.theme = mode;
    else delete document.documentElement.dataset.theme;
    const isDark = mode === 'dark' ||
      (!mode && window.matchMedia('(prefers-color-scheme: dark)').matches);
    btn.textContent = isDark ? '☀️' : '🌙';
    // <meta name="theme-color"> doesn't react to data-theme/media changes on
    // its own — keep it synced so the mobile browser chrome matches --bg.
    themeColorMeta.content = isDark ? '#121212' : '#fafafa';
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
  bindDayPopover();
  bindCount();
  bindAdd();
  bindLeavePlan();
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

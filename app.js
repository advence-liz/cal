// Wiring: data load → calendar render → form bindings → countdown.

import {
  DEFAULT_REGION,
  REGIONS,
  loadYears,
  getDataStore,
  hasYear,
} from './holidays.js';
import {
  countWorkdays,
  addWorkdays,
  addDays,
  nextHolidays,
  formatDate,
  parseDate,
} from './workday.js';
import { renderMonth, monthTitle, describeDay, describeDayText, describeDayFacts, findNextSuitableDate, ACTIVITIES } from './calendar.js';
import { ACTIVITY_TERM_INFO } from './almanac-info.js';
import { AUTO_CLOCK_ZONE, CLOCK_ZONES, clockZoneFor, regionClock } from './region-clock.js';
import { LANGUAGE_KEY, activityName, dateLabel, daysLabel, english, getLanguage, holidayLabel, setLanguage, t, translateStatic } from './i18n.js';
import { coveredDays, DEFAULT_HORIZON_DAYS, suggestHolidayOpportunities, yearsInRange, groupDateRanges } from './bridge-plan.js';

// 微信内置浏览器允许缩放时，用户一旦双指缩放就会弹出微信自己的缩放控件
// （这是 WeChat WebView 的行为，控件本身我们改不了）。只对微信 UA 关掉
// 这个页面在微信里的缩放能力来避免触发它；Safari/Chrome 等浏览器的无障
// 碍缩放能力完全不受影响，不能图省事直接全局禁用缩放。
if (/MicroMessenger/i.test(navigator.userAgent)) {
  const viewport = document.querySelector('meta[name="viewport"]');
  if (viewport) viewport.content = 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no';

  // 同一个坑的另一半：微信"跟随系统字体大小"会整体缩放页面文字，效果跟
  // 缩放控件一样突兀，用官方 JSBridge 把这页锁死在标准字号。
  const lockFontSize = () => {
    if (!window.WeixinJSBridge?.invoke) return;
    WeixinJSBridge.invoke('setFontSizeCallback', { fontSize: 0 });
    WeixinJSBridge.on('menu:setfont', () => WeixinJSBridge.invoke('setFontSizeCallback', { fontSize: 0 }));
  };
  if (window.WeixinJSBridge) lockFontSize();
  else document.addEventListener('WeixinJSBridgeReady', lockFontSize);
}

const $ = (id) => document.getElementById(id);
const WEEKDAY_CN = ['日', '一', '二', '三', '四', '五', '六'];

// CSS `scroll-behavior` can't override a `behavior: 'smooth'` passed
// explicitly to scrollIntoView() — respecting prefers-reduced-motion for
// these JS-driven scrolls has to happen here instead.
function scrollBehavior() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
}

const REGION_KEY = 'cal:holiday-region';
const CLOCK_ZONE_KEY = 'cal:clock-zone';
const state = {
  region: DEFAULT_REGION,
  clockZone: AUTO_CLOCK_ZONE,
  regionVersion: 0,
  monthRequest: 0,
  year: 0,
  month: 0,
  today: '',
  selected: '',
  showAlmanac: true,
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
  if (status === 'unavailable') {
    return { msg: t(`ℹ️ 当前地区未收录 ${year} 年的假期数据，暂时按普通周末显示。`, `ℹ️ No holiday data for ${year} in this region. Only weekends are shown.`), kind: 'info' };
  }
  if (status === 'failed') {
    if (error?.status === 404) {
      return { msg: t(`ℹ️ ${year} 年度的法定节假日安排还没有公布，暂时按普通周末显示。`, `ℹ️ The ${year} holiday schedule is not published yet. Only weekends are shown.`), kind: 'info' };
    }
    return { msg: t(`⚠️ 假期数据暂时获取不到，${year} 年的日历先按普通周末显示，网络恢复后会自动补上节假日安排。`, `⚠️ Could not load ${year} holidays. Only weekends are shown for now.`), kind: 'warn' };
  }
  if (status === 'stale-cache') {
    return { msg: t(`ℹ️ ${year} 年用的是之前保存的假期数据，可能不是最新的，网络恢复后会自动更新。`, `ℹ️ Showing previously saved ${year} holidays. This schedule may be out of date.`), kind: 'info' };
  }
  return null;
}

function todayStr() {
  return formatDate(new Date());
}

const currentStore = () => getDataStore(state.region);
const currentWeekend = () => REGIONS[state.region].weekendDays;

async function ensureYears(years, region = state.region) {
  const needed = years.filter((year) => !hasYear(year, region));
  if (needed.length === 0) return [];
  return loadYears(needed, region);
}

function estimateNote(start, end, store) {
  const firstYear = Number(start.slice(0, 4));
  const lastYear = Number(end.slice(0, 4));
  for (let year = firstYear; year <= lastYear; year++) {
    if (!store.has(year)) return t('（缺少假期数据的年份仅按周末估算）', ' (weekend-only estimate for years without holiday data)');
  }
  return '';
}

function dayViewOptions() {
  return { showLunar: state.showAlmanac, showChineseFestivals: state.region === DEFAULT_REGION, weekendDays: currentWeekend() };
}

function renderCalendar() {
  renderMonth(state.year, state.month, $('calGrid'), currentStore(), state.today, state.selected, state.activityTerm, state.leaveDates, dayViewOptions());
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
  // 合法域防御：曾出现过 gotoMonth(1, 7) 把日历真渲染到公元 1 年的事故
  // （旧版原生 month 弹层的年份列表可滚到 0001）。任何来源（hash、面板、
  // 未来新调用点）传入的年份超界一律拒绝，保持当前视图不动。
  if (!Number.isFinite(year) || !Number.isFinite(month) || year < 1900 || year > 2100) {
    console.error('gotoMonth: 拒绝非法年月', { year, month });
    return;
  }
  const request = ++state.monthRequest;
  const region = state.region;
  state.year = year;
  state.month = month;

  // Ensure data for displayed year + adjacent (other-month cells may bleed).
  const wanted = [year - 1, year, year + 1];
  const results = await ensureYears(wanted, region);
  if (request !== state.monthRequest) return false;

  // The banner reflects the year actually on screen, not the whole prefetch
  // batch — a still-failing neighbor year (e.g. next year's data not yet
  // published) shouldn't keep flagging a perfectly fine displayed year, and
  // switching back to a year that loaded fine must clear any old banner.
  const displayedResult = results.find((r) => r.year === year);
  const displayedStatus = displayedResult ? displayedResult.source : (hasYear(year, region) ? 'cache' : null);
  const banner = bannerForYearStatus(year, displayedStatus, displayedResult?.error);
  if (banner) showBanner(banner.msg, banner.kind); else hideBanner();

  $('monthTitle').textContent = monthTitle(year, month);
  $('monthTitleMobile').textContent = t(`${year}年${month}月`, dateLabel(new Date(year, month - 1, 1), { year: 'numeric', month: 'short' }));
  renderCalendar();
  if ($('calGrid').querySelector('.day--selected')) showDayDetail(state.selected);
  else $('dayDetail').hidden = true;
  updateHash();
  return true;
}

function renderNextHoliday(store) {
  // 窄屏（≤480px）只显示最近一个假期。
  const results = nextHolidays(state.today, store, 2);
  const el = $('nextHoliday');
  if (results.length === 0) {
    el.textContent = t('暂无后续法定假期数据', 'No upcoming holiday data');
    el.classList.remove('has-data');
    return;
  }
  const fmt = ({ name, date, daysAway }) =>
    t(`距 <strong>${name}</strong> 还有 <strong>${daysAway}</strong>&nbsp;天 (${date})`, `<strong>${holidayLabel(name)}</strong> in <strong>${daysLabel(daysAway)}</strong>`);
  const second = results[1] ? `<span class="next-holiday__second">&nbsp;·&nbsp;${fmt(results[1])}</span>` : '';
  el.innerHTML = `${fmt(results[0])}${second}`;
  el.classList.add('has-data');
}

// 一眼可见的摸鱼进度：今年还剩多少个工作日（含今天，与计算工具口径一致）。
function renderWorkdayRemaining(store) {
  const el = $('workdayRemaining');
  const year = state.today.slice(0, 4);
  const end = `${year}-12-31`;
  const remaining = countWorkdays(state.today, end, store, currentWeekend());
  const estimated = !store.has(Number(year));
  el.innerHTML = t(`今年还剩 <strong>${remaining}</strong>&nbsp;个工作日`, `<strong>${daysLabel(remaining, 'workday')}</strong> left this year`) +
    (estimated ? t('（仅按周末估算）', ' (weekend-only estimate)') : '');
  el.classList.add('has-data');
  el.hidden = false;
}

// --- 日期详情面板（tap-to-view，弥补移动端没有 title hover 的问题）---
function showDayDetail(dateStr) {
  const info = describeDay(dateStr, currentStore(), dayViewOptions());
  const d = parseDate(dateStr);
  $('dayDetailDate').textContent =
    t(`${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 星期${WEEKDAY_CN[d.getDay()]}`,
      dateLabel(d, { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' }));
  $('dayDetailLines').innerHTML = describeDayText(info).map((l) => `<li>${l}</li>`).join('');

  const yi = info.lunarInfo?.yi || [];
  const ji = info.lunarInfo?.ji || [];
  $('almanacYi').innerHTML = yi.map((t) => `<span class="almanac-tag almanac-tag--yi" data-term="${t}">${t}</span>`).join('')
    || `<span class="almanac-tag almanac-tag--empty">${t('无', 'None')}</span>`;
  $('almanacJi').innerHTML = ji.map((t) => `<span class="almanac-tag almanac-tag--ji" data-term="${t}">${t}</span>`).join('')
    || `<span class="almanac-tag almanac-tag--empty">${t('无', 'None')}</span>`;

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
    if (!start || !end || start > end) {
      delete out.dataset.calculated;
      if (!start || !end) return;
      out.textContent = t('⚠️ 起始日期不能晚于结束日期', '⚠️ Start date must not be after the end date.');
      out.className = 'result error';
      return;
    }
    out.dataset.calculated = 'true';
    const startY = Number(start.slice(0, 4));
    const endY = Number(end.slice(0, 4));
    const wanted = [];
    for (let y = startY; y <= endY; y++) wanted.push(y);
    const regionVersion = state.regionVersion;
    const store = currentStore();
    await ensureYears(wanted);
    if (regionVersion !== state.regionVersion) return;
    try {
      const n = countWorkdays(start, end, store, currentWeekend());
      const totalDays = Math.round((parseDate(end) - parseDate(start)) / 86400000) + 1;
      const note = estimateNote(start, end, store);
      out.innerHTML = t(`区间共 ${totalDays} 天，其中工作日 <strong>${n}</strong> 天`, `${daysLabel(totalDays)} total, <strong>${daysLabel(n, 'workday')}</strong>`) + note;
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
      delete out.dataset.calculated;
      out.textContent = t('⚠️ 请输入有效日期与整数 N', '⚠️ Enter a valid date and a whole number.');
      out.className = 'result error';
      return;
    }
    out.dataset.calculated = 'true';
    // Walking N workdays can cross years. Pre-load a generous window.
    const startY = Number(start.slice(0, 4));
    // ~250 workdays per year, so |n|/200 years buffer, min 1.
    const yearsSpan = Math.max(1, Math.ceil(Math.abs(n) / 200));
    const wanted = [];
    for (let dy = -yearsSpan; dy <= yearsSpan; dy++) wanted.push(startY + dy);
    const regionVersion = state.regionVersion;
    const store = currentStore();
    await ensureYears(wanted);
    if (regionVersion !== state.regionVersion) return;
    try {
      const result = addWorkdays(start, n, store, currentWeekend());
      const first = n === 0 ? start : addDays(start, Math.sign(n));
      const note = n === 0 ? '' : estimateNote(first < result ? first : result, first > result ? first : result, store);
      out.innerHTML = `${t('结果：', 'Result: ')}<strong>${result}</strong>${note}`;
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
  return t(`${d.getMonth() + 1}月${d.getDate()}日(周${WEEKDAY_CN[d.getDay()]})`,
    dateLabel(d, { weekday: 'short', month: 'short', day: 'numeric' }));
}

// 紧凑展示：单日保留周几（"6月10日(周四)"），连续日合并成区间（"4月6~9日"）。
// 19 天逐日罗列的文本墙是拼假卡片留白的最大来源。
function formatLeaveRangeLabel({ start, end }) {
  if (start === end) return formatLeaveDateLabel(start);
  const s = parseDate(start);
  const e = parseDate(end);
  if (english()) {
    const options = { month: 'short', day: 'numeric', ...(start.slice(0, 4) !== end.slice(0, 4) ? { year: 'numeric' } : {}) };
    return `${dateLabel(s, options)}–${dateLabel(e, options)}`;
  }
  if (start.slice(0, 4) !== end.slice(0, 4)) {
    return `${s.getFullYear()}年${s.getMonth() + 1}月${s.getDate()}日 ~ ${e.getFullYear()}年${e.getMonth() + 1}月${e.getDate()}日`;
  }
  if (s.getMonth() === e.getMonth()) return `${s.getMonth() + 1}月${s.getDate()}~${e.getDate()}日`;
  return `${s.getMonth() + 1}月${s.getDate()}日~${e.getMonth() + 1}月${e.getDate()}日`;
}

// 卡片内的日期一律用短格式 M/D：年份在"近 400 天"语境里不言自明，
// 全称 "2027-04-03 ~ 2027-05-05" 既宽又重复。
function shortDate(dateStr) {
  const [, m, d] = dateStr.split('-').map(Number);
  return `${m}/${d}`;
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
      out.innerHTML = `<p class="hint">${t('近期暂时没有查到法定节假日安排（可能还没公布），过阵子再来看看。', 'No upcoming holidays in the available data.')}</p>`;
      clearLeaveTeaser();
      return;
    }
    // 全年一览：回答"这段时间所有假期怎么拼"的全景问题，默认折叠免占空间。
    // 行内"标出"按钮复用卡片同款 class，走同一个事件委托。
    const overview = list.length > 1 ? `
      <details class="leave-plan__overview">
        <summary>${t(`全年一览（${list.length} 个假期，点「标出」直接画到日历）`, `Overview (${list.length} holiday breaks)`)}</summary>
        <table>
          <thead><tr><th>${t('假期', 'Holiday')}</th><th>${t('不请假', 'Without leave')}</th><th>${t('方案', 'Plan')}</th><th></th></tr></thead>
          <tbody>
            ${list.map((row, idx) => {
              const names = (row.recommended ? row.recommended.names : row.naturalNames).map(holidayLabel).join(' + ');
              const plan = row.recommended
                ? t(`请 ${row.recommended.cost} → 休 ${row.recommended.totalDays}`, `Use ${row.recommended.cost} → get ${row.recommended.totalDays}`)
                : '—';
              const btnAttrs = row.recommended
                ? ''
                : 'disabled';
              return `<tr>
                <td>${names}</td>
                <td>${t(`${row.naturalDays} 天`, daysLabel(row.naturalDays))}</td>
                <td>${plan}</td>
                <td><button type="button" class="leave-plan__mark-btn leave-plan__row-btn" data-idx="${idx}" ${btnAttrs}>${t('标出', 'Mark')}</button></td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </details>` : '';
    out.innerHTML = overview + list.map((row, idx) => {
      const names = (row.recommended ? row.recommended.names : row.naturalNames).map(holidayLabel).join(' + ');
      const naturalLine = `<div class="leave-plan__natural">${t(`不请假连休 ${row.naturalDays}&nbsp;天`, `${daysLabel(row.naturalDays)} off without leave`)} (${shortDate(row.naturalStart)}–${shortDate(row.naturalEnd)})</div>`;
      if (!row.recommended) {
        return `
          <div class="leave-plan">
            <div class="leave-plan__title">${names}</div>
            ${naturalLine}
            <p class="hint">${t('附近没有能再拼的工作日缺口，这已经是自然最长的连休了。', 'No nearby workdays to bridge into a longer break.')}</p>
          </div>
        `;
      }
      const r = row.recommended;
      const ratio = (r.totalDays / r.cost).toFixed(1);
      const ranges = groupDateRanges(r.leaveDates)
        .map((g) => `<span class="leave-plan__range">${formatLeaveRangeLabel(g)}</span>`)
        .join(t('、', ', '));
      return `
        <div class="leave-plan">
          <div class="leave-plan__head">
            <div class="leave-plan__title">${names}</div>
            <button type="button" class="leave-plan__mark-btn" data-idx="${idx}">${t('标出 →', 'Mark →')}</button>
          </div>
          ${naturalLine}
          <div class="leave-plan__summary">
            <span>${t(`请假 <strong>${r.cost}</strong>&nbsp;→ 连休 <strong>${r.totalDays}</strong>&nbsp;天`, `Use <strong>${r.cost}</strong> → get <strong>${daysLabel(r.totalDays)}</strong> off`)} (${shortDate(r.start)}–${shortDate(r.end)})</span>
            <span class="leave-plan__ratio" title="${t(`平均每请 1 天年假换 ${ratio} 天连休`, `${ratio} days off per leave day`)}">${t(`1 换 ${ratio}`, `1 : ${ratio}`)}</span>
          </div>
          <div class="leave-plan__dates">${t('需请假：', 'Take leave: ')}${ranges}</div>
        </div>
      `;
    }).join('') + `<button type="button" class="leave-plan__clear-btn" id="leavePlanClearBtn">${t('清除标注', 'Clear marks')}</button>`;

    // 用最靠前的一条有加钱升级的机会做入口提示，放在日历上面，不用滚到底才发现有这功能。
    const best = list.find((row) => row.recommended);
    if (best) {
      setLeaveTeaser(
        t(`🎉 ${best.recommended.names.join('+')}请 ${best.recommended.cost} 天连休 ${best.recommended.totalDays} 天 →`,
          `🎉 ${best.recommended.names.map(holidayLabel).join(' + ')}: use ${best.recommended.cost}, get ${daysLabel(best.recommended.totalDays)} off →`),
        flashLeavePlanCard
      );
    } else {
      clearLeaveTeaser();
    }
  }

  async function refreshOverview() {
    const regionVersion = state.regionVersion;
    const today = state.today;
    currentList = [];
    out.innerHTML = `<p class="hint">${t('加载中…', 'Loading…')}</p>`;
    await ensureYears(yearsInRange(today));
    if (regionVersion !== state.regionVersion || today !== state.today) return;
    const store = currentStore();
    const horizonDays = coveredDays(today, DEFAULT_HORIZON_DAYS, store);
    const covered = new Map(horizonDays ? yearsInRange(today, horizonDays).map((year) => [year, store.get(year)]) : []);
    renderNextHoliday(covered);
    renderWorkdayRemaining(store);
    renderList(horizonDays ? suggestHolidayOpportunities(store, { fromDate: today, horizonDays, weekendDays: currentWeekend() }) : []);
    $('leaveCoverage').hidden = horizonDays === DEFAULT_HORIZON_DAYS;
  }

  out.addEventListener('click', async (e) => {
    if (e.target.closest('#leavePlanClearBtn')) {
      state.leaveDates = new Set();
      renderCalendar();
      return;
    }
    const btn = e.target.closest('.leave-plan__mark-btn');
    if (!btn) return;
    const row = currentList[Number(btn.dataset.idx)];
    if (!row || !row.recommended) return;
    state.leaveDates = new Set(row.recommended.leaveDates);
    deselectDay();
    const jumpTo = parseDate(row.recommended.leaveDates[0] || row.recommended.start);
    if (await gotoMonth(jumpTo.getFullYear(), jumpTo.getMonth() + 1)) {
      $('calGrid').scrollIntoView({ behavior: scrollBehavior(), block: 'center' });
    }
  });

  return refreshOverview;
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

function syncActivity() {
  const activity = ACTIVITIES.find(({ term }) => term === state.activityTerm);
  state.activityLabel = activity ? activityName(activity) : '';
  $('activityFilters').querySelectorAll('.activity-chip').forEach((el) => {
    const active = el.dataset.term === state.activityTerm;
    el.classList.toggle('activity-chip--active', active);
    el.setAttribute('aria-pressed', String(active));
  });
  $('activityFiltersStatus').hidden = !activity;
  if (activity) $('activityFiltersStatusText').textContent = t(
    `当前显示：本月宜「${state.activityLabel}」的日子（绿框标出）`,
    `Green outlines mark dates suitable for “${state.activityLabel}”.`,
  );
}

function updateAlmanac(expanded) {
  const atTop = state.region === DEFAULT_REGION;
  const panel = $('activityPanel');
  const shelf = $('almanacShelf');
  const toggle = $('almanacToggle');
  const open = atTop || expanded;
  state.showAlmanac = open;
  if (atTop) $('calGrid').before(panel);
  else shelf.append(panel);
  shelf.hidden = atTop;
  panel.hidden = !open;
  $('almanacDetail').hidden = !open;
  $('suitsLegend').hidden = !open;
  toggle.setAttribute('aria-expanded', String(open));
  toggle.textContent = open ? t('收起农历宜忌', 'Hide lunar almanac') : t('显示农历宜忌', 'Show lunar almanac');
  $('activityPrompt').textContent = atTop
    ? t('按活动看这个月宜办的日子：', 'Find suitable dates this month:')
    : t('按传统黄历选日（与当地假期无关）：', 'Choose dates with the traditional Chinese almanac (independent of local holidays):');
  if (!open) {
    state.activityTerm = '';
    syncActivity();
    $('dayPopover').hidden = true;
  }
}

function renderActivityOptions() {
  $('activityFilters').innerHTML = ACTIVITIES.map((a) =>
    `<button type="button" class="activity-chip" data-term="${a.term}">${activityName(a)}</button>`
  ).join('');
  syncActivity();
}

// 点一个活动高亮宜办日期，再点一次取消。
function bindActivityFilters() {
  $('almanacToggle').addEventListener('click', () => {
    updateAlmanac(!state.showAlmanac);
    renderCalendar();
    if (state.selected && !$('dayDetail').hidden) showDayDetail(state.selected);
  });
  $('activityFilters').addEventListener('click', (e) => {
    const btn = e.target.closest('.activity-chip');
    if (!btn) return;
    const term = btn.dataset.term;
    state.activityTerm = state.activityTerm === term ? '' : term;
    syncActivity();
    renderCalendar();
  });

  $('activityFindBtn').addEventListener('click', async () => {
    if (!state.activityTerm) return;
    const btn = $('activityFindBtn');
    btn.disabled = true;
    btn.textContent = t('查找中…', 'Finding…');
    const found = findNextSuitableDate(state.today, state.activityTerm, currentStore());
    btn.disabled = false;
    btn.textContent = t('找最近一天 →', 'Find next date →');
    if (!found) {
      $('activityFiltersStatusText').textContent = t(`两年内没找到宜「${state.activityLabel}」的日子`, `No suitable date for “${state.activityLabel}” in the next two years.`);
      return;
    }
    const d = parseDate(found);
    const term = state.activityTerm;
    if (!await gotoMonth(d.getFullYear(), d.getMonth() + 1) || term !== state.activityTerm) return;
    const cell = $('calGrid').querySelector(`[data-date="${found}"]`);
    if (cell) selectDay(cell);
    $('activityFiltersStatusText').textContent =
      t(`距今最近的宜「${state.activityLabel}」是 ${found}（已跳转，绿框标出）`, `Next suitable date for “${state.activityLabel}”: ${found}.`);
  });
}

// 详情面板在日历下方。桌面视口较矮时它在折叠线之下——点了日期却毫无
// 反馈是最伤的体验；完整可见时不滚动（避免多余跳动）。
function ensureDetailVisible() {
  const detail = $('dayDetail');
  if (detail.hidden) return;
  const r = detail.getBoundingClientRect();
  if (r.top >= 0 && r.bottom <= window.innerHeight) return;
  detail.scrollIntoView({ behavior: scrollBehavior(), block: 'nearest' });
}

function selectDay(cell) {
  state.selected = cell.dataset.date;
  $('countForm').start.value = state.selected;
  $('addForm').start.value = state.selected;

  $('calGrid').querySelectorAll('.day--selected').forEach((el) => el.classList.remove('day--selected'));
  cell.classList.add('day--selected');

  showDayDetail(state.selected);
  ensureDetailVisible();
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
    const facts = describeDayFacts(describeDay(dateStr, currentStore(), dayViewOptions()));
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
  const colorSchemeMeta = document.querySelector('meta[name="color-scheme"]');
  const apply = (mode) => {
    if (mode) document.documentElement.dataset.theme = mode;
    else delete document.documentElement.dataset.theme;
    const isDark = mode === 'dark' ||
      (!mode && window.matchMedia('(prefers-color-scheme: dark)').matches);
    btn.textContent = isDark ? '☀️' : '🌙';
    // <meta name="theme-color"> doesn't react to data-theme/media changes on
    // its own — keep it synced so the mobile browser chrome matches --bg.
    themeColorMeta.content = isDark ? '#121212' : '#fafafa';
    // Once the user has explicitly picked a theme via this button, assert it
    // with `only` (stronger than `light dark`) — a clearer "I already chose,
    // don't second-guess me" signal for any renderer that respects
    // color-scheme at all. Following the system keeps `light dark` so native
    // form controls still track the OS preference.
    colorSchemeMeta.content = mode ? `only ${mode}` : 'light dark';
  };
  let savedTheme;
  try { savedTheme = localStorage.getItem(KEY); } catch { /* follow the system */ }
  apply(savedTheme);
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

  if (!await gotoMonth(year, month)) return;
  if (state.selected) ensureDetailVisible(); // 深链进入时让目标日的详情可见
}

function bindHashChange() {
  window.addEventListener('hashchange', () => applyHashView(state.year, state.month));
}

function renderRegionClock() {
  const clock = $('clockPicker');
  const zone = clockZoneFor(state.region, state.clockZone);
  let value;
  try {
    value = regionClock(zone);
  } catch {
    // Older WebViews may lack offset formatting. Keep the calendar usable.
    clock.hidden = true;
    return;
  }
  const city = t(...CLOCK_ZONES[zone].city);
  $('regionClockCity').textContent = city;
  const time = $('regionClockTime');
  time.textContent = value.time;
  time.dateTime = value.time;
  $('regionClockOffset').textContent = value.offset;
  $('clockTrigger').setAttribute('aria-label', t(`时钟时区：${city} ${value.time} ${value.offset}`, `Clock time zone: ${city} ${value.time} ${value.offset}`));
  clock.hidden = false;
}

function updateClockSelection() {
  for (const option of $('clockPicker').querySelectorAll('[data-zone]')) {
    option.setAttribute('aria-pressed', String(option.dataset.zone === state.clockZone));
  }
}

function renderClockOptions() {
  const buttons = Object.entries(CLOCK_ZONES).map(([zone, { city }]) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.zone = zone;
    button.textContent = t(...city);
    return button;
  });
  $('clockOptions').replaceChildren(...buttons);
  updateClockSelection();
}

function bindRegionClock() {
  bindHeaderPicker('clockPicker', 'clockTrigger', 'zone', (zone) => {
    if (zone !== AUTO_CLOCK_ZONE && !Object.hasOwn(CLOCK_ZONES, zone)) return;
    state.clockZone = zone;
    try { localStorage.setItem(CLOCK_ZONE_KEY, zone); } catch { /* optional preference */ }
    updateClockSelection();
    renderRegionClock();
  });
  function tick() {
    if (!document.hidden) renderRegionClock();
    setTimeout(tick, 60000 - Date.now() % 60000);
  }
  setTimeout(tick, 60000 - Date.now() % 60000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) renderRegionClock();
  });
}

function updateRegionChrome() {
  const { source, label, scope } = REGIONS[state.region];
  for (const option of $('holidayRegion').querySelectorAll('[data-region]')) {
    const selected = option.dataset.region === state.region;
    option.setAttribute('aria-pressed', String(selected));
    if (selected) {
      $('regionLabel').textContent = option.textContent;
      $('regionTrigger').setAttribute('aria-label', t(`假期地区：${option.textContent}`, `Holiday region: ${option.textContent}`));
    }
  }
  $('holidaySource').href = source;
  const sourceEn = {
    CN: label, US: 'U.S. Office of Personnel Management (OPM)', SG: 'Singapore Ministry of Manpower (MOM)',
    JP: 'Japan Cabinet Office', GB: 'GOV.UK', FR: 'French government public holiday data', ZA: 'South African Government',
    IN: 'Delhi central-government holiday notices', BR: 'Brazilian federal holiday law',
    AU: 'New South Wales Government', SA: 'Saudi Central Bank (SAMA)',
  };
  $('holidaySource').textContent = t(label, sourceEn[state.region]);
  const scopeEn = {
    CN: 'State Council holiday schedule, including make-up workdays.',
    US: 'Federal holidays observed on a Monday–Friday schedule. Excludes state and employer-specific holidays.',
    SG: 'Monday–Friday schedule with Sunday as the rest day. Saturday holidays do not automatically move to Monday.',
    JP: 'Japan’s national public holidays, including substitute holidays and weekdays between two national holidays.',
    GB: 'Bank holidays for England and Wales only, including substitute days; excludes Scotland and Northern Ireland.',
    FR: 'General metropolitan France public holidays; excludes regional and overseas additions. Check your employer’s schedule.',
    ZA: 'Nationwide public holidays. When a holiday falls on Sunday, the following Monday is also a public holiday.',
    IN: 'Gazetted holidays for Delhi/New Delhi central-government administrative offices. Excludes optional, state and private-sector holidays.',
    BR: 'Fixed nationwide statutory holidays only. Excludes state and municipal holidays, election days and optional federal-office closures.',
    AU: 'Statewide public holidays and additional days published by NSW. Excludes local and bank-only holidays.',
    SA: 'Uses the Saudi Central Bank’s holiday schedule for financial institutions, not a nationwide calendar. Friday and Saturday are weekends; Sunday through Thursday are workdays. Individual branches may differ.',
  };
  $('holidayScope').textContent = t(scope, scopeEn[state.region]);
  $('makeupLegend').hidden = state.region !== DEFAULT_REGION;
  renderRegionClock();
}

function bindHeaderPicker(pickerId, triggerId, key, select) {
  const picker = $(pickerId);
  const trigger = $(triggerId);
  const closeAndFocus = () => {
    picker.open = false;
    trigger.focus({ preventScroll: true });
  };
  document.addEventListener('click', (event) => {
    if (picker.open && !picker.contains(event.target)) picker.open = false;
  });
  picker.addEventListener('focusout', (event) => {
    if (event.relatedTarget && !picker.contains(event.relatedTarget)) picker.open = false;
  });
  picker.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !picker.open) return;
    event.preventDefault();
    closeAndFocus();
  });
  picker.addEventListener('click', (event) => {
    const option = event.target.closest(`button[data-${key}]`);
    if (!option) return;
    closeAndFocus();
    select(option.dataset[key]);
  });
}

function bindRegion(refreshOverview) {
  bindHeaderPicker('holidayRegion', 'regionTrigger', 'region', async (region) => {
    if (!Object.hasOwn(REGIONS, region) || region === state.region) return;
    state.region = region;
    state.regionVersion++;
    try { localStorage.setItem(REGION_KEY, region); } catch { /* optional preference */ }
    updateRegionChrome();
    updateAlmanac(false);
    state.leaveDates = new Set();
    $('dayDetail').hidden = true;
    $('dayPopover').hidden = true;
    $('calGrid').querySelectorAll('.day').forEach((cell) => cell.remove());
    clearLeaveTeaser();
    hideBanner();
    const countdown = $('nextHoliday');
    countdown.textContent = t('加载中…', 'Loading…');
    countdown.classList.remove('has-data');
    $('workdayRemaining').hidden = true;
    $('leaveCoverage').hidden = true;
    refreshFormResults();
    await Promise.all([gotoMonth(state.year, state.month), refreshOverview()]);
  });
}

function refreshFormResults() {
  for (const [formId, outputId] of [['countForm', 'countResult'], ['addForm', 'addResult']]) {
    const output = $(outputId);
    output.textContent = '';
    output.className = 'result';
    if (output.dataset.calculated === 'true') $(formId).requestSubmit();
  }
}

function renderLanguageChrome() {
  const expanded = state.showAlmanac;
  translateStatic(document);
  const button = $('languageToggle');
  button.textContent = t('English', '中文');
  button.lang = t('en', 'zh-CN');
  $('almanacTranslationNote').hidden = !english();
  renderClockOptions();
  updateRegionChrome();
  renderActivityOptions();
  updateAlmanac(expanded);
}

function bindLanguage(refreshOverview) {
  $('languageToggle').addEventListener('click', async () => {
    setLanguage(t('en', 'zh-CN'));
    try { localStorage.setItem(LANGUAGE_KEY, getLanguage()); } catch { /* optional preference */ }
    renderLanguageChrome();
    $('dayPopover').hidden = true;
    clearLeaveTeaser();
    hideBanner();
    refreshFormResults();
    await Promise.all([gotoMonth(state.year, state.month), refreshOverview()]);
  });
}

async function init() {
  try {
    setLanguage(localStorage.getItem(LANGUAGE_KEY));
    const saved = localStorage.getItem(REGION_KEY);
    if (Object.hasOwn(REGIONS, saved)) state.region = saved;
    const savedZone = localStorage.getItem(CLOCK_ZONE_KEY);
    if (Object.hasOwn(CLOCK_ZONES, savedZone)) state.clockZone = savedZone;
  } catch { /* use the default region and language */ }
  const today = todayStr();
  state.today = today;
  const date = parseDate(today);
  // Make the initial non-CN view collapsed on every load.
  updateAlmanac(false);
  renderLanguageChrome();

  // Prefill forms with sensible defaults.
  $('countForm').start.value = today;
  $('countForm').end.value = formatDate(new Date(date.getFullYear(), date.getMonth() + 1, 0));
  $('addForm').start.value = today;

  bindTheme();
  bindRegionClock();
  bindNav();
  bindActivityFilters();
  bindCalendarSelect();
  bindDayPopover();
  bindCount();
  bindAdd();
  const refreshOverview = bindLeavePlan();
  bindRegion(refreshOverview);
  bindLanguage(refreshOverview);
  bindHashChange();

  await Promise.all([applyHashView(date.getFullYear(), date.getMonth() + 1), refreshOverview()]);
  if (state.selected) {
    $('countForm').start.value = state.selected;
    $('addForm').start.value = state.selected;
  }
}

init().catch((err) => {
  console.error(err);
  showBanner(t('启动失败：', 'Could not start: ') + err.message);
});

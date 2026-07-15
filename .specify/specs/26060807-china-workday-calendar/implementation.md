# 执行计划: 中国工作日历 Web 工具

**对应**: `./spec.md` + `./design.md`  **DRI**: 用户本人

## 任务清单

> 顺序：先纯函数（含单测）→ 数据层 → UI → 装配 → 验收。这样底层 BUG 在 task 1-2 就暴露，不会被 UI 噪音掩盖。

### Task 1: 搭骨架 + workday.js 纯函数 + 单测
- **类型**: Create
- **文件**:
  - `workday.js` — 实现 `isWorkday / countWorkdays / addWorkdays / nextHoliday` 四个纯函数；签名以 `(dateStr, dataStore)` 形式，`dataStore` 是 `Map<year, Map<dateStr, {name, isOffDay}>>`
  - `workday.test.html` — 一个跑测试的 HTML，加载 `workday.js` + `workday.test.js`，用 `console.assert` 报告
  - `workday.test.js` — fixture：手写一个 2026 年迷你 dataStore（含元旦、春节、端午、国庆 + 1 个调休补班），覆盖：
    1. `isWorkday('2026-06-19')` → false（端午）
    2. `isWorkday('2026-06-20')` → false（周六，无补班）
    3. `isWorkday('2026-09-26')` → true（中秋调休补班，周六）
    4. `countWorkdays('2026-06-01', '2026-06-30')` → 期望值（手算）
    5. `countWorkdays('2026-06-30', '2026-06-01')` → throws
    6. `addWorkdays('2026-06-08', 5)` → '2026-06-15'
    7. `addWorkdays('2026-06-08', 0)` → '2026-06-08'
    8. `addWorkdays('2026-06-15', -5)` → '2026-06-08'
    9. `addWorkdays('2026-06-17', 3)` → 跨端午，应跳过 6/19
    10. `nextHoliday('2026-06-08')` → {name:'端午节', date:'2026-06-19', daysAway:11}
- **TDD 步骤**:
  1. 先在 `workday.test.js` 写 10 个 assertion，加载到 test.html → 全 RED（函数未实现）
  2. 在 `workday.js` 写最小实现 → 全 GREEN
  3. 重构：抽 `parseDate` / `formatDate` / `addDays` 小工具
- **验证命令**: `python3 -m http.server 8000 -d /home/devtest/plaud/cal` 后浏览器开 `http://localhost:8000/workday.test.html`，控制台无 assert 失败
- **commit**: `feat: workday pure functions + tests`

### Task 2: holidays.js 数据层（fetch + localStorage 缓存）
- **类型**: Create
- **文件**: `holidays.js`
- **导出**:
  - `loadYears(years: number[]): Promise<DataStore>` — 并发 fetch，命中未过期 cache 跳过网络
  - `getDataStore(): DataStore` — 返回当前内存 store
  - 内部：`CACHE_KEY = (y) => 'holiday-cn:' + y`，`TTL_MS = 7*24*3600*1000`
- **关键逻辑**:
  - fetch `https://cdn.jsdelivr.net/gh/NateScarlet/holiday-cn@master/{year}.json`
  - 失败 → 尝试读旧缓存（哪怕过 TTL）→ 都失败则 throw（带 year）
  - 成功 → 转成 `Map<dateStr, {name, isOffDay}>` 存 store + 写 localStorage
- **TDD 步骤**:
  1. 在 `workday.test.html` 加段集成测试：`await loadYears([2025])` 然后 `isWorkday('2025-10-01')` 应为 false → RED
  2. 写实现 → GREEN
  3. 手动断网（DevTools Offline）刷新页面，应仍能从缓存渲染
- **验证命令**: 同 Task 1 的 test.html；控制台看一条 "loaded 2025 from cdn" 或 "loaded 2025 from cache" log
- **commit**: `feat: holidays data layer with localStorage cache`

### Task 3: index.html + styles.css 骨架
- **类型**: Create
- **文件**:
  - `index.html` — 结构：顶部标题/年月导航；左主区月历 grid；右/下侧 3 张工具卡（区间工作日 / N 后日期 / 下个假期）；底部数据源声明
  - `styles.css` — 类：`.day` `.day--holiday` `.day--makeup` `.day--weekend` `.day--today` `.day--other-month`；色板：红 `#e53935` / 橙 `#fb8c00` / 灰 `#9e9e9e` / 今天蓝色边框 `#1e88e5`
- **TDD 步骤**: UI 任务跳过 TDD，直接构造静态 HTML 用占位日期看样式
- **验证命令**: 浏览器打开 `index.html`，月历样式正确（哪怕日期是写死的占位）
- **commit**: `feat: html skeleton + styles`

### Task 4: calendar.js 月历渲染
- **类型**: Create
- **文件**: `calendar.js`
- **导出**:
  - `renderMonth(year, month, container, dataStore, today)` — 构造 6×7 网格（周日起或周一起：用**周一起**，符合国内习惯）；对每个 cell 应用类：holiday / makeup / weekend / today / other-month；hover tooltip = 节日名
  - `attachNavigation(controls, onChange)` — 绑定上月/下月/今天按钮
- **TDD 步骤**:
  1. 在 `app.js` 调 `renderMonth(2026, 10, container, store, '2026-06-08')` 看 2026-10 月历
  2. 视觉抽查：10 月 1-8 国庆红、若 holiday-cn 有 9/27 周日补班则橙
- **验证命令**: 浏览器看 2025-10、2026-06 两个月的渲染
- **commit**: `feat: month calendar renderer with navigation`

### Task 5: app.js 装配 + 3 个工具卡
- **类型**: Create
- **文件**: `app.js`
- **逻辑**:
  1. `today = new Date()` → 计算 `[y-1, y, y+1]` 调 `loadYears`
  2. 失败 → 顶部黄条提示
  3. 渲染当前月历
  4. 绑定 3 个表单：
     - 卡 1：start + end → 显示 `countWorkdays`
     - 卡 2：start + N → 显示 `addWorkdays`，需要时 `loadYears([targetYear])`
     - 卡 3：自动渲染 `nextHoliday(today)` 倒计时（取离 today 最近的 isOffDay=true）
  5. 翻月时若目标年不在 store → await `loadYears([y])` 再渲染
- **TDD 步骤**: 集成层手测
- **验证命令**: 浏览器跑通 4 个 User Story 的全部验收场景（见 Task 6）
- **commit**: `feat: app wiring + 3 utility cards`

### Task 6（末位 · E2E 验收 · 不走 TDD）
- **映射**: spec.md 的 4 个 User Story 验收场景
- **文件**: `e2e-checklist.md`（手测清单，不写自动化）
- **执行步骤**:
  1. **US1**：清 localStorage → 刷新 → 月历显示当前月（2026-06）；端午（6/19 周五）标红；切到 2025-10 → 国庆 1-8 红、若 holiday-cn 列出补班日则橙；点「回到今天」回 2026-06
  2. **US2**：起 2025-12-20 / 止 2026-01-10（跨年）→ 看结果是否合理（手算复核）；起 > 止 → 红字提示
  3. **US3**：起 2026-06-08 / N=5 → 2026-06-15；N=0 → 2026-06-08；N=-5 → 跨回 6/1
  4. **US4**：顶部倒计时显示"距离 端午节 还有 11 天"（2026-06-08 视角）
  5. **断网测试**：DevTools Offline → 刷新 → 仍能用（localStorage 命中）
  6. **未来年度**：手动翻到 2030 → 应显示「2030 法定假期数据尚未发布」提示，月历仅显示周末灰

## 测试策略

- **L1 单测**：`workday.test.js` 跑 10 个 case（核心纯函数）
- **L2 手工 E2E**：上述 6 步 checklist
- 跳过 L3 / L4（无后端 / 个人工具）

## 原型/联调约定

无后端，不涉及 stub/mock。外部 CDN 直连，靠 localStorage 兜底。

## 跨团队依赖

无。

# 技术方案: 中国工作日历 Web 工具

**对应 spec**: `./spec.md`  **DRI**: 用户本人

## 架构概览与关键决策

**选定方案**：单页静态 HTML + 原生 JS (ES Modules) + 原生 CSS，无构建、无框架、无后端。文件结构：`index.html` / `styles.css` / `app.js` / `holidays.js`（数据层）/ `workday.js`（纯函数核心）/ `calendar.js`（月历渲染）。

**为何不选其他方案**：
- ❌ React + Vite：本工具复杂度（≤500 行核心代码）不值一个构建工具链；用户要"打开即用"
- ❌ 把数据全打包进 JS：holiday-cn 每年 ~2KB × 多年 ≈ 几十 KB 也行，但失去"最新政策自动同步"能力；CDN + localStorage 缓存是更优解
- ❌ Service Worker 离线包：过度工程，localStorage 已够

**关键架构决策**：
1. **数据源 = jsDelivr CDN + localStorage 缓存（TTL 7 天）**。失败时降级用旧缓存；首次失败且无缓存时显示明确提示。
2. **拉取策略 = 按需 + 预取**。首屏拉「去年 / 今年 / 明年」三年（覆盖跨年计算和常见浏览需求）；翻月触达其他年份时按需补拉。
3. **N=0 语义**：`addWorkdays(date, 0)` 返回 `date` 本身（无论是否工作日）。理由：与 SQL `DATE_ADD` 风格一致、最不"惊讶"。
4. **工作日区间含端点**：`countWorkdays(start, end)` 同时计入 `start` 和 `end`（如果它们是工作日）。
5. **时区**：所有日期按本地时区当作"无时区的日历日"处理，避免 UTC 偏移；用 `YYYY-MM-DD` 字符串作为主键。

## 模块 / 组件拆分

- **`holidays.js`** — 数据层
  - `loadYears(years: number[]): Promise<Map<year, YearData>>`：并发拉取，命中 localStorage 缓存（带 TTL）则跳过网络
  - `getDayMeta(dateStr): { isHoliday: bool, isMakeup: bool, name?: string }`：单日查询
  - 内部维护一个 `dataStore: Map<year, { days: Map<dateStr, HolidayDay> }>`
- **`workday.js`** — 纯函数核心（可单测、零 DOM 依赖）
  - `isWorkday(dateStr, dataStore): bool`
  - `countWorkdays(startStr, endStr, dataStore): number`（含两端）
  - `addWorkdays(startStr, n: integer, dataStore): string`（n 可正可负）
  - `nextHoliday(fromDateStr, dataStore): { name, date, daysAway }`
- **`calendar.js`** — 月历渲染
  - `renderMonth(year, month, container, dataStore)`：构造 6×7 网格、套样式 class、绑定 hover tooltip
  - `attachNavigation(controls, onChange)`：上月/下月/回到今天/年份选择
- **`app.js`** — 入口装配
  - 启动时调 `loadYears([year-1, year, year+1])` → 渲染月历 → 绑定 3 个工具卡 → 渲染倒计时
  - 翻月时若目标年不在 dataStore，await `loadYears([newYear])` 再渲染
- **`index.html`** — 布局：顶部标题 + 月历区 + 右/下侧工具栏（3 张卡片）+ 底部数据源声明

## 数据流与状态管理

- **数据流**：`jsDelivr → fetch → localStorage cache → in-memory dataStore (Map) → UI 读取`
- **状态持有者**：`app.js` 持单例 `dataStore`；UI 组件接收引用、不直接改
- **副作用边界**：`holidays.js` 是唯一允许 fetch 和读写 localStorage 的模块；`workday.js` 100% 纯函数；`calendar.js` 只做 DOM 操作
- **缓存 key 格式**：`holiday-cn:{year}` → `{ days: [...], fetchedAt: 1717804800000 }`，TTL 7 天
- **埋点**：无（个人工具）

## 接口契约

无跨团队接口。外部依赖仅 jsDelivr CDN，schema 见 `https://github.com/NateScarlet/holiday-cn/blob/master/schema.json`：

```json
{ "days": [{ "name": "端午节", "date": "2026-06-19", "isOffDay": true }] }
```

## 错误处理策略

| 场景 | 策略 |
|---|---|
| CDN fetch 失败（网络断 / 404） | 1. 先回退到 localStorage 缓存（哪怕过 TTL）；2. 仍无 → 顶部黄条提示"数据加载失败，仅显示周末" |
| 未来年度数据未发布（404） | 仅该年标记为"数据未发布"，其他年正常；月历正常显示但不上特殊色（保留周末灰） |
| 用户起 > 止 | 表单红字提示，不计算 |
| 用户日期非法 | `<input type="date">` 浏览器原生校验 |
| localStorage 不可用（隐私模式） | 静默跳过缓存，每次都拉网络 |

## 测试策略

- **单测（手写 test runner 或 console.assert 即可，无需 jest）**：
  - `workday.test.js`：用一份固定的 mini dataStore，断言 `isWorkday / countWorkdays / addWorkdays / nextHoliday` 在 8-10 个典型/边界 case 下返回值正确（含跨年、调休补班、正负 N、N=0）
- **手测**：
  - 浏览器跑 4 个 User Story 全部验收场景
  - 抽查 5 个真实调休日的视觉呈现
  - 断网测试（DevTools Offline 模式）
- **不做**：E2E（个人工具，过度）、跨浏览器测试（仅保证 Chrome/Edge 最新版）

## Open Questions

- [x] N=0 的语义？→ 已定：返回起始日本身
- [x] 区间是否含端点？→ 已定：含
- [x] 跨年数据策略？→ 已定：预取 3 年、翻月按需补
- [ ] 是否需要导出/复制结果按钮？→ 首版不做，看用户反馈

# 技术方案: v2 农历集成 + 视图增强 + 日期工具集 + ICS 导出

**对应 spec**: `./spec.md`  **DRI**: 用户本人

## 架构概览与关键决策

**选定方案**：在 v1 纯前端模块化结构基础上做"叠加式"扩展，不重写 v1 任何代码。新增 `vendor/`（第三方库）+ `views/`（视图分形）+ `tools/`（工具分形）+ adapter 层。

**为何不选其他方案**：
- ❌ **重构成 React/Vue**：v1 才几百行，重构成本高、用户感知不到、违反"只补能力"原则
- ❌ **直接调 lunar-javascript 全局函数**：lib 升级或替换时改动大；包一层 adapter 是最低成本的反腐层
- ❌ **CDN 引入 lunar.js**：用户已明确选 vendor 本地化（真离线可用、无 SPOF）

**关键架构决策**：
1. **Adapter 模式隔离第三方库**：`lunar-adapter.js` 是唯一引用 `vendor/lunar.js` 的入口，对外暴露纯函数：`getDayInfo(dateStr) → DayInfo`、`solarToLunar(...)`、`lunarToSolar(...)`、`nextJieqi(fromStr)`、`nextTradFestival(fromStr)`、`getYiJi(dateStr)`。其他模块只依赖 adapter。
2. **视图分形 (`views/`)**：把视图切换抽成 `views/month.js / year.js / list.js`，每个导出 `render(container, ctx)`。当前 `calendar.js` 重命名为 `views/month.js`。
3. **工具分形 (`tools/`)**：每个新工具一个文件（`date-diff.js / converter.js / leap.js / age.js`），都是纯函数 + 各自小 form 渲染器。
4. **ICS 用纯函数构建**：手写 `ics.js`，不引入 ical.js 等库。RFC 5545 必要字段够用。
5. **键盘模块全局事件代理**：`keyboard.js` 在 `document` 上挂 keydown，路由到注册的命令。输入框聚焦时跳过。
6. **视图状态用 URL hash**：`#month`/`#year`/`#list`，刷新保留 + 可分享链接。
7. **农历显示优先级冲突**：单元格 tag 文字按优先级选 1 条（法定假名 > 调休"班" > 农历节日 > 节气 > 农历日"初X"）；hover tooltip 显示全部信息。
8. **v1 兼容**：v1 的 `app.js`/`calendar.js`/`workday.js`/`holidays.js`/`workday.test.*` 全部保留；`calendar.js` 升级时只追加导出，不破坏老签名。

## 模块 / 组件拆分

### 保留 (v1)
- `workday.js` `holidays.js` `workday.test.*` — 不动
- `index.html` — 大改（结构调整、增工具卡、增 sidebar）
- `styles.css` — 增 v2 样式段
- `app.js` — 重写部分：增视图路由、初始化新模块；保留数据加载

### 新增
- `vendor/lunar.js` — 第三方库（v1.7.7 单文件，UMD 格式）
- `vendor/LICENSE-lunar` — MIT 许可副本（合规）
- `lunar-adapter.js` — 包装 lunar API，对外纯函数
- `views/month.js` — 月视图（从 v1 `calendar.js` 升级 + 农历显示）
- `views/year.js` — 年视图（12 迷你月历，CSS Grid）
- `views/list.js` — 列表/议程视图
- `views/router.js` — 视图路由（hash 监听）
- `tools/date-diff.js` — 精确日期差
- `tools/converter.js` — 阴阳历互转 + 时间戳互转（合并到一个文件，互转语义近似）
- `tools/leap.js` — 闰年/闰月查询
- `tools/age.js` — 生日/年龄
- `ics.js` — ICS 文件生成（VCALENDAR + VEVENT）
- `keyboard.js` — 键盘快捷键
- `yiji-panel.js` — 今天宜忌侧栏 + 择吉日小工具
- `countdown.js` — 增强倒计时（法定假 + 节气 + 农历节日，3 个并排）
- `lunar-adapter.test.js` + `tools.test.js` — 新增单测

### v1 → v2 文件 diff 概要
```
保留：workday.js holidays.js workday.test.*
新增：vendor/lunar.js  vendor/LICENSE-lunar
     lunar-adapter.js  keyboard.js  ics.js  countdown.js  yiji-panel.js
     views/{month,year,list,router}.js
     tools/{date-diff,converter,leap,age}.js
     lunar-adapter.test.js  tools.test.js
重写：app.js  index.html  styles.css
弃用：calendar.js → 替换为 views/month.js（保留 stub re-export 防外链）
```

## 数据流与状态管理

```
[holidays.js] ──┐
[lunar-adapter] ─┴─→ [views/*]  ←─ [router (URL hash)] ←─ [keyboard.js]
                     [tools/*]
                     [yiji-panel]
                     [countdown]
                     [ics.js]   ──→  Blob download
```

- **dataStore 持有者**：仍是 `holidays.js` 单例；views/tools 从 `getDataStore()` 取
- **农历 / 节气 / 宜忌**：lunar-adapter 内部无状态，每次现算（lunar 库内有自己的缓存）
- **视图状态**：URL hash (`#month`/`#year`/`#list`) + 当前年月（在 month 视图下 `#month/2026-06`）
- **副作用边界**：
  - 仅 holidays.js → fetch + localStorage
  - 仅 ics.js → Blob/Download
  - 仅 keyboard.js → 全局 keydown
  - 其他模块 100% 纯
- **不引入 store/redux**：状态简单到不需要

## 接口契约

无跨团队接口。

**lunar-adapter 对外契约（伪签名）**：
```js
type DayInfo = {
  date: string,              // '2026-06-08'
  solar: { y, m, d, dow },
  lunar: { y, m, d, yearGZ, monthGZ, dayGZ, zodiac, leap, dayName, monthName },
  jieqi?: string,            // 节气名，如 '芒种'
  tradFestival?: string,     // 农历传统节日名
  yi: string[],              // 宜
  ji: string[],              // 忌
  chong: { zodiac, direction },  // 冲煞
  zhishen: string,           // 值神
}

getDayInfo(dateStr: 'YYYY-MM-DD'): DayInfo
solarToLunar(y, m, d): { y, m, d, leap, monthName, dayName, yearGZ, ... }
lunarToSolar(y, m, d, isLeapMonth=false): { y, m, d }
nextJieqi(fromDateStr): { name, date, daysAway }
nextTradFestival(fromDateStr): { name, date, daysAway }
luckyDays(eventType, fromStr, days=30): Array<{date, score, yi, ji}>
```

## 错误处理策略

| 场景 | 策略 |
|---|---|
| lunar 库年份越界（< 1900 或 > 2100） | adapter 抛 `RangeError`，视图捕获后仅显示阳历，tooltip 显示「农历数据不可用」 |
| 阴阳历互转输入非法（如农历 13 月） | 表单红字提示，不计算 |
| 时间戳输入位数模糊（10 位 vs 13 位） | 自动判断（< 10 位数字看成秒、>= 13 位看成毫秒） |
| ICS 下载在 Safari 受限 | 用 `<a download>` + Blob URL，兼容主流；Safari iOS 实测降级到"在新标签打开"用户长按保存 |
| 键盘快捷键和系统快捷键冲突 | 避开 Ctrl/Meta+ 组合键，只用单字母（系统不拦） |
| URL hash 非法（手动改成 `#xxx`） | 视图 router 兜底回 `#month` |

## 测试策略

- **L1 单测**：
  - `lunar-adapter.test.js` ≥ 8 case：
    - solarToLunar(2026,6,8) → '丙午年 五月初四' （或库实际输出，固定一组）
    - lunarToSolar(2026, 闰六月, 1) → 正确处理闰月
    - 节气：getDayInfo('2026-06-06') → jieqi='芒种'
    - 传统节日：getDayInfo('2026-02-17') → tradFestival='春节'（2026 春节为 2/17）
    - nextJieqi('2026-06-08') → '夏至'
    - 宜忌数组非空
    - 边界：1899-12-31 → RangeError
    - 闰年农历：2025 年有闰六月
  - `tools.test.js`：date-diff / leap / age / ics-builder 各 2-3 case
- **L2 手测**：6 个 User Story + v1 回归
- **不做**：E2E 自动化、跨浏览器自动化

## Open Questions

- [x] 是否引入构建工具？→ 不引入，继续 ES Modules 静态
- [x] 农历日期格式？→ 沿用 lunar 库默认（「初一/初二/十五/廿三」）
- [x] 视图状态在哪存？→ URL hash（可分享）
- [ ] ICS 节气事件是否单独一档？建议节气单独一档供用户按需订阅 → 实现期决定（默认合并，预留参数）
- [ ] 择吉日的"score"算法？建议简单实现：宜列表里含目标事件即视为吉，匹配 +1，否则 0 → 实现期细化

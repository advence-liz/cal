---
name: cal-maintenance
description: 中国日历 PWA（本仓库）的项目维护手册——本地测试、宜忌/假日数据口径与自动同步机制、UI 改动验证与部署回归、Service Worker 缓存管理。触发：在这个仓库改代码/修 bug/改 UI 后要验证、"同步宜忌"、"升级 lunar.js"、"假日数据"、"跑测试"、"部署验证"、"sw 缓存"、"这个项目的口径/机制是什么"。
---

# cal-maintenance — 本项目维护手册

零构建静态 PWA（GitHub Pages 发布），无打包器。所有运行时外部依赖已于 2026-11-09 清零。
改动前先读 `docs/access-acceleration.md`（发布端路线）和本文档，别凭记忆动手。

## 口径知识（改数据相关代码前必读）

- **宜/忌没有行业权威**：各网站各流派口径互不相同，本站口径 = **2345万年历**（lunar.js 的 yiji 表是 6tail 对 tools.2345.com 的逆向快照，与 2345 实测 ~99.5% 一致）。
- 用户红线：**不一致不可接受，延迟可以接受**。任何宜忌改动都要过「与 2345 对照」这道闸。
- 残余差异三类：2345 侧错别字（verbatim 保留，如「雇庸」）、**临近午夜的节气日**（2345 与 lunar.js 的 ΔT 分钟级差异导致月建归属翻转，例：2026-06-05 芒种 23:48）、快照冻结漂移（靠每日同步覆盖层解决）。
- `getDayYi(sect)` 的 sect=1（节气当天切换月建）是本站口径，2345 观测行为与此一致，勿改。

## 数据/自动化机制（三条链路，全部无人值守）

| 机制 | 触发 | 内容 | 安全闸 |
|---|---|---|---|
| 宜忌每日同步 | cron `30 18 * * *`（北京 02:30） | `scripts/sync-yiji-2345.mjs` 爬 2345 今年+明年 → diff-only 覆盖层 `data/yiji-overrides.js` | 限流比例>1% 中止；覆盖>3% 打 `needs-human-decision` 不自动合并 |
| lunar.js 月度检查 | cron `0 3 2 * *` | `scripts/vendor-lunar-check.mjs` 发版检测 + 733 天金标比对 | 金标有漂移 → PR 挂标签人工决策（口径问题不是 bug） |
| 假日数据 vendoring | cron `0 4 2 * *` | `scripts/vendor-holiday-cn.mjs` 拉 holiday-cn [y-1,y,y+1] 入仓 | 上游占位文件(days:[])不覆盖已发布数据；fetch 失败 exit 1 不写 |

共通 CI 契约：脚本末尾打印 `changed=`/`suspicious=` 供 workflow `grep` 进 `$GITHUB_OUTPUT`；PR 自动 squash-merge 仅当「无漂移 && 测试绿」。跑手动触发用 `gh workflow run <name>`。

**改这些脚本时**：diff 比较用的是规范化 map（canonic JSON）而非文件文本——生成文件头带同步日期，比文本会天天假阳性。

## 本地测试

```bash
# 需要先起本地 server（8080 常被占，换端口）：
python3 -m http.server 8127 &
TEST_PORT=8127 npm test
```

- 套件是浏览器内跑的（`tests.html` + puppeteer 读取各 `summary-*` h2），不是 node test
- 新增异步测试套件：test-harness 有 `checkAsync`，`runTests()` 可为 async，tests.html 里对应 `await`
- runner 是轮询摘要完成制（不等 networkidle0），别改回去——会卡 30s 超时
- 当前规模：workday 10 + calendar 20 + lunar 8 + bridge-plan 11 + holidays 6 = 55 项

## 改动后验收三步（UI 改动必做）

1. **回归**：`TEST_PORT=<port> npm test` 全绿
2. **真机 UI check**：`agent-browser` 截图看实际渲染，多档视口（宽屏 1600 / 中屏 1280 / 手机 390）
   - **铁律：必须 `--session <name>` 隔离**（共享机器，default session 会撞别的窗口）；机器容器环境需 `--args "--no-sandbox"`
   - 设置视口：`agent-browser --session <name> set viewport <w> <h>`（没有单独的 resize 命令）
3. **部署回归**：push 后 `gh run list` 看 Tests + pages-build-deployment 两个 run 绿，再 curl 线上关键文件/agent-browser 开线上页验证（等到内容生效用 `until curl|grep` 轮询，别裸 sleep）

## 惯例与坑

- **改 shell 文件（index.html/app.js/styles.css/任一 js）必须 bump `service-worker.js` 的 `CACHE_NAME`**（写本文时 v7，以文件为准），否则老 PWA 客户端可能拿旧文件
- `.main` 布局是 grid-template-areas 三档：≥1360px 三栏（拼假|日历|工具）、821–1359 双栏、≤820 单列；调位置只动 `styles.css` 的 areas
- 2345 爬虫从**真实页面上下文**内 fetch（直连会被限流返回「无」）；CI 跑 7 分钟左右是正常的
- `node -e` 操作日期时用过 `getDay()`（星期几）冒充 `getDate()`（几号）导致整月数据错误——lunar.js 校验会拒，但别再犯
- bash 管道里跑 node 脚本必须 `set -o pipefail`（tee 会吞退出码，出现过假绿）
- 宜忌覆盖层数据 `data/yiji-overrides.js` 是 AUTO-GENERATED，手改会被下一次同步冲掉；要改口径先改脚本

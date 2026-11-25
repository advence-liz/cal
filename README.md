# 摸鱼日历

**在网页上看各地假期、算拼假，也可以把同一份假期数据接入 AI 客户端。** 网页还支持调休、工作日计算和农历宜忌。

| 你想做什么 | 入口 |
| --- | --- |
| 打开日历 | [GitHub Pages](https://advence-liz.github.io/cal/) · [Render](https://moyu-calendar.onrender.com/) |
| 让 AI 查假期或算工作日 | [接入只读 MCP](#用-mcp-查假期和算工作日) |

## 两个网页入口都能离线使用

两个站点使用同一套前端和假期数据，不依赖 MCP 后端。首次联网访问并成功缓存后，已缓存的页面和数据可离线使用。

## 用 MCP 查假期和算工作日

**默认用 Cloudflare；连接不上时，可手动把客户端里的 URL 换成 Render。** 两个入口都使用 **Streamable HTTP**，公开只读，不需要 API Key 或 OAuth。MCP 服务本身不调用模型；AI 客户端仍按自己的规则计费。

| 入口 | MCP URL |
| --- | --- |
| **首选 · Cloudflare Workers** | `https://calendar-mcp-benchmark.calendar-workday-lab.workers.dev/mcp` |
| 备用 · Render | `https://moyu-calendar-mcp.onrender.com/mcp` |

Render 免费实例闲置后，首次 MCP 调用可能要等约一分钟；两个独立的日历网站不依赖 MCP，不受影响。下方接入示例统一使用 Cloudflare 地址。

### Codex、Claude Code 和 Gemini CLI 可用一条命令接入

| 客户端 | 命令 |
| --- | --- |
| [Codex CLI](https://learn.chatgpt.com/docs/extend/mcp?surface=cli) | `codex mcp add moyu-calendar --url https://calendar-mcp-benchmark.calendar-workday-lab.workers.dev/mcp` |
| [Claude Code](https://code.claude.com/docs/en/mcp) | `claude mcp add --transport http moyu-calendar https://calendar-mcp-benchmark.calendar-workday-lab.workers.dev/mcp` |
| [Gemini CLI](https://geminicli.com/docs/tools/mcp-server/) | `gemini mcp add --transport http moyu-calendar https://calendar-mcp-benchmark.calendar-workday-lab.workers.dev/mcp` |

Codex CLI 和同一环境里的 Codex IDE 扩展共享配置。接入后，可在新会话里试一句：**「用摸鱼日历查一下，沙特金融机构从 2026 年 9 月 24 日到 27 日有几个工作日？」** 结果应为 **2 个（周四和周日）**。

### 网页版、桌面客户端和编辑器也能接入同一个 URL

| 客户端 | 在哪里添加 |
| --- | --- |
| [Claude 网页版 / Desktop](https://support.claude.com/en/articles/11175166-getting-started-with-custom-connectors-using-remote-mcp) | Customize → Connectors → Add custom connector。填 Cloudflare 的 MCP URL，认证选 **No sign in**。组织账号可能需要管理员先添加。 |
| [ChatGPT](https://developers.openai.com/api/docs/guides/developer-mode) | 打开 [Plugins](https://chatgpt.com/plugins) → `+` → Add custom MCP server。填 Cloudflare 的 MCP URL，认证选 **No authentication**，创建后安装。仅限开放自定义 MCP 的账号或工作区。 |
| [VS Code / GitHub Copilot](https://code.visualstudio.com/docs/copilot/customization/mcp-servers) | 在 Copilot 会话运行 **Chat: Open Customizations** → **MCP Servers** → **Add Server**，选择 HTTP 并填 URL。 |
| [Cursor](https://cursor.com/docs/context/mcp) | 在项目的 `.cursor/mcp.json` 中，向 `mcpServers` 添加命名条目，远程地址字段为 `url`。 |
| [OpenCode](https://opencode.ai/docs/mcp-servers/#remote) | 在项目的 `opencode.json` 中，向 `mcp.servers` 添加命名条目，字段为 `type: "remote"` 和 `url`。 |

<details>
<summary>查看 Cursor 和 OpenCode 配置示例</summary>

Cursor：`.cursor/mcp.json`

```json
{
  "mcpServers": {
    "moyu-calendar": {
      "url": "https://calendar-mcp-benchmark.calendar-workday-lab.workers.dev/mcp"
    }
  }
}
```

OpenCode：`opencode.json`

```json
{
  "mcp": {
    "servers": {
      "moyu-calendar": {
        "type": "remote",
        "url": "https://calendar-mcp-benchmark.calendar-workday-lab.workers.dev/mcp"
      }
    }
  }
}
```

已有同名配置文件时合并条目，不要覆盖其他服务。

</details>

### 八个工具都只读，时区和假期地区分开

| 工具 | 参数与用途 |
| --- | --- |
| `list_regions` | 无参数。返回假期地区代码、适用范围、周末规则和已核对的年份。 |
| `get_holidays` | `region`、`year`。返回某地区某年的假期和调休补班，含可识别的原假期日期。 |
| `count_workdays` | `region`、`start`、`end`。按该地区的周末、假期和调休规则计算，包含起止两天。 |
| `add_workdays` | `region`、`start`、`n`。`n` 是 -10,000 到 10,000 的整数，正数往后、负数往前，不计起始日；`n=0` 返回起始日。 |
| `convert_timezone` | `datetime`、`from_tz`、`to_tz`。输入带日期的 ISO 当地时间，返回目标时区的日期时间、UTC 偏移量和同一时刻的 UTC 时间。 |
| `get_local_time` | `time_zones`。一次查看 1–5 个 IANA 时区在同一时刻的当地日期、时间和 UTC 偏移量。 |
| `suggest_leave_plan` | `region`、`start`、`end`、`max_leave_days`。在 1–366 天内（含起止日），用不超过预算的请假天数找含法定假期的最长连休。预算是 0–30 的整数；并列时先选少请假的，再选开始日期较早的。 |
| `find_meeting_windows` | `start`、`end`、`participants`、可选 `duration_minutes`（最短重叠时长，默认 30 分钟）。按第一位参与者的时区查 1–7 天（含起止日），适用 2–4 人。每人分别提供假期 `region` 和 IANA `time_zone`，可自定义同日的 `work_start` 和 `work_end`（默认 `09:00`–`18:00`）。只计算共同办公时段，不查询个人忙闲，也不预约会议。 |

工作日工具用 `YYYY-MM-DD`；从起始年到结果年，每一年都必须有已核对的数据，否则报错，不按普通工作日估算。

时区用 `Asia/Shanghai`、`America/New_York` 等 IANA 名称，不代表适用哪套假期。比如上海的 `2026-07-15T08:30` 在洛杉矶是 `2026-07-14T17:30`（前一天）。遇到夏令时重复的本地时间，用 `2026-11-01T01:30-04:00` 这样的偏移量消歧；不存在的本地时间会报错。

# 摸鱼日历

**在网页上看各地假期、算拼假，也可以把同一份假期数据接入 AI 客户端。** 网页还支持调休、工作日计算和农历宜忌。

| 你想做什么 | 入口 |
| --- | --- |
| 打开日历 | [GitHub Pages](https://advence-liz.github.io/cal/) · [Render](https://moyu-calendar.onrender.com/) |
| 让 AI 查假期或算工作日 | [接入只读 MCP](#用-mcp-查假期和算工作日) |

## 两个网页入口都能离线使用

两个站点使用同一套前端和假期数据，不依赖 MCP 后端。首次联网访问并成功缓存后，已缓存的页面和数据可离线使用。

## 用 MCP 查假期和算工作日

在支持 **Streamable HTTP** 的客户端填入 `https://moyu-calendar-mcp.onrender.com/mcp`。这是公开的只读接口，不需要 API Key 或 OAuth。MCP 服务本身不调用模型；AI 客户端仍按自己的规则计费。Render 免费实例闲置后，首次调用可能要等约一分钟；这不影响网页。

### Codex、Claude Code 和 Gemini CLI 可用一条命令接入

| 客户端 | 命令 |
| --- | --- |
| [Codex CLI](https://learn.chatgpt.com/docs/extend/mcp?surface=cli) | `codex mcp add moyu-calendar --url https://moyu-calendar-mcp.onrender.com/mcp` |
| [Claude Code](https://code.claude.com/docs/en/mcp) | `claude mcp add --transport http moyu-calendar https://moyu-calendar-mcp.onrender.com/mcp` |
| [Gemini CLI](https://geminicli.com/docs/tools/mcp-server/) | `gemini mcp add --transport http moyu-calendar https://moyu-calendar-mcp.onrender.com/mcp` |

Codex CLI 和同一环境里的 Codex IDE 扩展共享配置。接入后，可在新会话里试一句：**「用摸鱼日历查一下，沙特金融机构从 2026 年 9 月 24 日到 27 日有几个工作日？」** 结果应为 **2 个（周四和周日）**。

### 网页版、桌面客户端和编辑器也能接入同一个 URL

| 客户端 | 在哪里添加 |
| --- | --- |
| [Claude 网页版 / Desktop](https://support.claude.com/en/articles/11175166-getting-started-with-custom-connectors-using-remote-mcp) | Customize → Connectors → Add custom connector。填上面的 URL，认证选 **No sign in**。组织账号可能需要管理员先添加。 |
| [ChatGPT](https://developers.openai.com/api/docs/guides/developer-mode) | 打开 [Plugins](https://chatgpt.com/plugins) → `+` → Add custom MCP server。填上面的 URL，认证选 **No authentication**，创建后安装。仅限开放自定义 MCP 的账号或工作区。 |
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
      "url": "https://moyu-calendar-mcp.onrender.com/mcp"
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
        "url": "https://moyu-calendar-mcp.onrender.com/mcp"
      }
    }
  }
}
```

已有同名配置文件时合并条目，不要覆盖其他服务。

</details>

### 三个工具都只读，缺失年份不估算

| 工具 | 参数与用途 |
| --- | --- |
| `list_regions` | 无参数。返回地区代码、适用范围、周末规则和已核对的年份。 |
| `get_holidays` | `region`、`year`。返回某地区某年的假期和调休补班，含可识别的原假期日期。 |
| `count_workdays` | `region`、`start`、`end`。按该地区的周末、假期和调休规则计算，包含起止两天；日期用 `YYYY-MM-DD`。 |

如果查询年份没有已核对的数据，MCP 会明确报错，不会将其当作「没有假期」。跨年计算时，区间覆盖的每一年都必须有该地区的数据。

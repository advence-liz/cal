# 国内访问加速 · 发布端升级路线

> 2026-11-09 记录。当前发布端 = GitHub Pages（`https://advence-liz.github.io/cal/`），数据层已完成自托管（见下），本文档记录**发布端**进一步提速的备选路线与决策树，供未来动手时直接照着执行。

## 现状盘点

| 层 | 状态 | 说明 |
|---|---|---|
| 应用壳/代码 | GitHub Pages + Fastly 全球 CDN | 海外快；国内走境外节点，可用性间歇波动 |
| 假日数据 | ✅ 已自托管（2026-11-09，`8dcac43`） | `data/holidays-YYYY.json` vendored 进仓库，每月 2 日 `holiday-vendor.yml` 自动更新，运行时**零 jsDelivr 依赖** |
| 离线 | ✅ Service Worker 全量缓存 shell + 数据 | 首次成功加载后完全离线可用 |
| 国内暴露面 | 仅剩「第一次打开」 | 首字节可达性与首连接延迟 |

**关键认知**：对本站（静态 + <100KB + SW 缓存），国内的问题不是带宽而是「可达性稳定 + 首连接」。回头客几乎无感，新访客感知最明显。

## 候选路线

| 路线 | 前提 | 费用 | 国内效果 | 备注 |
|---|---|---|---|---|
| ~~③ 数据自托管~~ | — | 0 | — | **已完成**，应对 jsDelivr 被墙的根治方案 |
| ② Cloudflare Pages + 自有域名 | 一个域名 | .com 成本价 ≈ $10.44/年（≈¥75） | 可达性大幅改善，速度中等偏好 | CF 零加价续费；`*.pages.dev` 国内间歇被墙，**必须配自有域名**才有意义 |
| ① 国内对象存储 + CDN + 分线路 DNS | **已备案域名** | 存储/流量费每月分钱级 | 最优（首字节几十 ms） | DNS 分线路：国内→国内 CDN，海外→GitHub Pages |

## 决策树

```
不想花钱/不动 ────────────────► 维持现状（③已消化掉最大痛点）
愿意买域名，不想备案 ─────────► ② CF Pages + 自有域名
愿意买域名 + 走备案流程(1~3周) ► ① 国内 CDN（体验最优）
```

**域名在哪买（影响未来路线选择）**：
- 只走 ② → 直接在 Cloudflare Registrar 买（成本价、注册=续费同价、含 WHOIS 隐私/DNSSEC）
- 可能将来走 ① 备案 → **在阿里云/腾讯云买**（备案要求域名在国内注册商名下，CF 买的域名不能备案），再把 NS 指向 Cloudflare，两头兼容

## ② 的执行清单（CF 路线，~10 分钟）

1. 注册/登录 Cloudflare 账号，Registrar 购买域名（需国际信用卡或 PayPal，不支持支付宝直付）
2. 创建 Pages 项目，连接 GitHub 仓库 `advence-liz/cal`（零构建，纯静态直出）
3. Pages 项目 → Custom domains → 绑定 `cal.<你的域名>`
4. GitHub Pages 侧可保留共存，旧链接不失效
5. 验证：国内网络访问 `cal.<域名>` 首屏可达性

注意：PWA 的 Service Worker 作用域绑定源（origin），换域名后老 SW 缓存不迁移，属于正常现象，新访问自建缓存即可。

## ① 的执行清单（国内 CDN 路线，备案完成后）

1. 域名 ICP 备案（阿里云/腾讯云流程，1–3 周）
2. 开通 OSS/COS 静态网站托管，CI 里加同步步骤（`ossutil`/`coscmd`，push 后 rsync 一份）
3. CDN 挂到备案域名，缓存策略：HTML 短缓存，`data/*.json` 中等缓存，带 hash 无资源基本不存在
4. DNS（DNSPod/阿里云 DNS）分线路解析：境内 → CDN CNAME，境外 → `advence-liz.github.io`
5. 验证两条线路各自的可达性与缓存命中率

## 费用核对记录（2026-11-09）

- CF Pages 免费版：构建 500 次/月、100 项目、100 自定义域名/项目、静态请求与带宽不计量（官方 limits 文档）
- CF Registrar：注册局成本价零加价，`.com` = Verisign 批发 $10.26 + ICANN $0.18 ≈ **$10.44/年**（Verisign 对 .com 有每年最多 7% 上调权，年费长期看小幅缓涨）
- 一个域名可挂 N 个子域名（DNS 记录免费），绑多个站点不产生额外费用——把它当「个人项目基础设施年费」摊销

## 相关仓库资产

- `scripts/vendor-holiday-cn.mjs` — 假日数据 vendoring（[y-1, y, y+1]）
- `.github/workflows/holiday-vendor.yml` — 月度自动更新 + PR/自动合并
- `holidays.js` — 本地优先加载链路（local → jsDelivr → localStorage TTL/陈旧缓存）
- `service-worker.js` — shell 缓存（当前 `cal-shell-v7`）

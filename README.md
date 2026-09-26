# FlareClash

基于 Cloudflare Workers（全免费额度）的 Clash 订阅转发服务：把多个机场/自建订阅聚合在统一门禁之后，通过 access token 分发给朋友，撤销权始终在你手里。

```text
管理员 → /admin   管理源订阅与 access token
用户   → /sub/<token>   Clash 客户端直接订阅
```

## 功能

- **多源聚合**：token 关联多个源订阅，节点加源前缀去重后合并返回
- **双格式自适应**：Clash/mihomo UA 收完整 Clash YAML（默认策略组 + 地区分组），其他客户端收 base64 分享链接；`?format=clash|base64` 可显式指定
- **上游格式探测**：Clash YAML 与 base64 分享链接（vmess/ss/trojan/hysteria2/vless）自动识别；VLESS 支持 Reality、TLS、TCP/WS/gRPC、IPv6 与 ALPN
- **手动节点源**：直接粘贴分享链接（每行一条，也兼容 base64 或 Clash YAML），内容存 D1，不回源、不占 KV 读写额度；可与 URL 源混合绑定 token
- **用量与到期透传**：采集并聚合上游 `subscription-userinfo`，Hiddify 可显示已用/总量/到期；管理后台按源展示用量
- **缓存与节流**：KV 同步缓存上游内容与用量元数据，回源频率受 `MIN_FETCH_INTERVAL` 硬性限制，仍保持每次成功回源 3 次 KV 写
- **token 生命周期**：随机 43 字符 token、可选过期时间、即时禁用/启用、最后使用时间记录
- **管理后台**：密码登录（HMAC 签名 cookie），源/token 增删改查与健康状态展示
- **登录防爆破**：按 IP（IPv6 按 /64）与全局两级限流锁定，计数存 D1、不占 KV 额度；弱密码 / 缺 `AUTH_SECRET` 时后台顶部提示

## 部署（从零开始，约 5 分钟）

前置：[Node.js](https://nodejs.org) ≥ 20 与一个 Cloudflare 账号（Free 计划即可）。

```bash
# 1. 安装依赖
npm install

# 2. 登录 Cloudflare（浏览器授权）
npx wrangler login

# 3. 创建 D1 数据库，记下输出的 database_id
npx wrangler d1 create flareclash

# 4. 创建 KV 命名空间，记下输出的 id
npx wrangler kv namespace create CACHE

# 5. 从模板生成本地配置（wrangler.toml 不入库）
cp wrangler.toml.example wrangler.toml
```

把两个 id 填入 `wrangler.toml`（替换占位符）：

```toml
[[d1_databases]]
binding = "DB"
database_name = "flareclash"
database_id = "<步骤 3 的 database_id>"   # ← 替换

[[kv_namespaces]]
binding = "KV"
id = "<步骤 4 的 id>"                     # ← 替换
```

```bash
# 6. 写入 secrets
npx wrangler secret put ADMIN_PASSWORD   # 管理员登录密码（建议 ≥16 位随机串）
npx wrangler secret put AUTH_SECRET      # 会话签名密钥：openssl rand -hex 32

# 7. 建表（D1 migrations）
npx wrangler d1 migrations apply flareclash --remote

# 8. 部署
npx wrangler deploy
```

部署完成后：

- 管理后台：`https://<your-worker>.workers.dev/admin/`
- Clash / Mihomo（确定性 YAML）：`https://<your-worker>.workers.dev/sub/clash/<token>`
- Hiddify / 通用（确定性 Base64）：`https://<your-worker>.workers.dev/sub/base64/<token>`
- 自动识别（按 UA，浏览器与 Hiddify 返回 Base64）：`https://<your-worker>.workers.dev/sub/<token>`

管理后台创建 token 后可分别复制这三种完整 URL。路径格式优先于 `?format=` 与 User-Agent。Hiddify 的 UA 同时含 `ClashMeta`，但自动端点会优先识别 `HiddifyNext` 并返回单行 Base64，避免其下载层破坏 Clash YAML 缩进。

### 本地开发

```bash
cp wrangler.toml.example wrangler.toml  # 本地 dev 只需要存在即可，id 可不填
cp .dev.vars.example .dev.vars   # 填入 ADMIN_PASSWORD / AUTH_SECRET
npx wrangler d1 migrations apply flareclash --local
npm run dev                      # http://localhost:8787
```

### 测试

```bash
npm test          # 单测 + 集成测试（vitest workers 池，真实 D1/KV/miniflare）
npm run typecheck
npx playwright install chromium  # 首次安装浏览器测试依赖
npm run test:browser              # 1024px / 390px，虚构 API 数据，不访问生产
```

## 使用流程

1. 打开 `/admin/`，用 `ADMIN_PASSWORD` 登录
2. 「源管理」→ 新建源：选择「URL 订阅」填写订阅地址，或选择「手动节点」粘贴分享链接；保存时探测格式与节点数。编辑时可双向切换类型，原 token 绑定不变
3. 「Token 管理」→ 新建 token：备注名（如「老王」）、可选过期时间、勾选可见的源
4. 按客户端复制对应地址：Clash/Mihomo 使用 `/sub/clash/<token>`，Hiddify 等使用 `/sub/base64/<token>`
5. 不想给了？禁用或删除 token，立即生效

## 网站分流设置

进入后台「分流设置」：按源建立策略组、编辑有序规则，选择未命中时的兜底动作。Clash 客户端更新订阅后使用新配置；上游机场自带的规则仍不会被合并。

- 默认配置在 [`config/routing.default.json`](config/routing.default.json)，可以直接手动编辑。文件打包到 Worker，修改后须重新部署。
- 网站保存的是 D1 覆盖；恢复默认会删除覆盖，使用当前部署的默认 JSON。不会回写仓库，也不访问 KV。
- JSON 导入和「应用 JSON 到表单」只修改草稿，需点击保存。导出配置 JSON 可用于本地备份和编辑。
- 条件支持完整域名、域名后缀、关键词、IPv4/IPv6 CIDR、GEOIP；目标为 `DIRECT`、`REJECT`、`PROXY` 或以 `g_` 开头的组 ID。`final` 始终编译到最后。
- 每个 token 的组成员仅来自其授权源。规则引用组没有可用成员时返回错误，不会退回直连。若源名称/前缀产生同名节点，按原有去重规则保留首个来源，不能借名称碰撞绕过组归属。
- 域名预览不查询 DNS、不执行 IP/GEOIP；存在前置 IP 条件时会标记结果不确定。

**Hiddify 与 Clash 的差异：**

Hiddify 4.1.1 继续使用 Base64 **节点**订阅。网站的「导出 Hiddify 规则」生成原生 RouteRule JSON，需在客户端路由规则页选择从 JSON 文件导入；导入会替换原列表，请先备份，修改后需重新导入。这不是 sing-box 完整配置，也不会自动随节点订阅刷新。

原生规则支持域名/IP CIDR以及直连、代理、拦截。不能指定自建/机场策略组，且没有独立 GEOIP 字段，因此含这些条件的配置会阻止导出并解释原因。默认配置为保持旧 Clash 行为保留了 `GEOIP,CN,DIRECT`，**不能直接完整导出到 Hiddify**；如需共同配置，应明确调整此规则，不能把 `.cn` 域名视为等价的中国 IP 判断。不要期待客户端的其他内置路由选项与导入规则天然等价。

Hiddify 的导出格式依据官方 v4.1.1 protobuf 定义与文件导入代码验证，实际流量效果仍需在目标客户端检查；网站不修改本机 Hiddify 配置，也不以「导出成功」冒充端到端分流生效。

详细格式与示例见 [分流 JSON 说明](config/README.md)。升级已有部署时，先应用 `0003_routing_config.sql` 再发布新版 Worker；此迁移不改旧数据或 KV。

## 登录安全

- 单 IP（IPv6 按 /64 归并）15 分钟内 5 次密码错误 → 锁定 15 分钟，重复触发逐次翻倍，最长 24 小时；登录成功清零
- 全站 1 小时内累计 50 次失败 → 暂停所有密码登录 1 小时；**已登录的会话不受影响**
- 锁定期间返回 429 + `Retry-After`，即使密码正确也拒绝；计数存 D1 表 `login_attempts`，不消耗 KV 写额度
- 升级已有部署：先应用 `0004_login_attempts.sql`（`npm run db:migrate:remote`），再发布新版 Worker

被攻击导致自己也登录不了时，可手动解锁：

```bash
npx wrangler d1 execute flareclash --remote --command "DELETE FROM login_attempts"
```

**可选加固**：在 Cloudflare Zero Trust 为 `/admin/*` 与 `/api/*` 配置 Cloudflare Access（免费 50 人内），登录接口对外不可达；`/sub/*` 须保持公开，否则客户端无法拉取订阅。

## 免费额度说明

| 资源 | 免费额度 | 本服务消耗 |
| --- | --- | --- |
| Workers 请求 | 10 万/天 | 每次订阅/后台操作 1 次 |
| D1 读写 | 500 万读 / 10 万写每天 | 每次订阅请求 ~十行级；登录失败 2~4 行写/次（全局锁封顶约 150 写/小时） |
| KV 写 | **1000/天** | 回源成功 3 写/次（受 TTL 限制），失败 1 写/次（受节流限制） |
| 静态资产 | 不计额度 | 管理页直接边缘分发 |

默认参数（TTL 30 分钟、节流 15 分钟）下 5 个源的 KV 写入约 150 次/天，余量充足。理论上限公式：`源数 × 3 × 86400 / MIN_FETCH_INTERVAL ≤ 1000`，调参时注意。

## 项目结构

```text
src/
  index.ts          # Hono 入口与路由挂载
  env.ts            # Worker 绑定类型
  auth.ts           # HMAC 签名会话
  repo.ts           # D1 数据访问层
  routes/
    sub.ts          # GET /sub/:token 订阅管道
    api.ts          # /api/* 管理端点
  lib/              # 纯逻辑：解析/聚合/渲染（全部有单测）
  cache/            # KV 缓存与回源节流
public/admin/       # 管理页 SPA（无构建，Static Assets 分发）
migrations/         # D1 迁移
tests/              # unit/ + integration/
```

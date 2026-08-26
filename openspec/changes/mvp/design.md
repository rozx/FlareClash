# MVP 技术设计

## Context

全新项目，无既有代码。约束来自两端：产品形态（单管理员、朋友分享、多源聚合、模型 B 绑定）与 Cloudflare 免费计划额度（KV 写 1000 次/天为唯一紧约束，见 proposal.md）。规格见 `specs/` 三个能力文件。

## Goals / Non-Goals

**Goals:**

- 单个 Worker 内完成全部逻辑（订阅服务 + 管理 API + 管理页托管），一次 `wrangler deploy` 上线
- 额度安全：KV 写入上限由节流参数硬性锁死，与朋友数量、刷新频率解耦
- 上游格式差异在聚合管道内部消化，输出端只见统一节点表示
- 管理页零框架依赖（或最多 Preact），构建产物小、免维护

**Non-Goals:**

- 不做多管理员/注册体系（单管理员密码）
- 不做规则编辑器、自定义策略组模板（第一期内置默认模板）
- 不做流量统计、节点延迟测试（涉及回源测速，烧额度）
- 不做订阅用户的 Web 界面（用户只接触 `/sub/:token`）
- 不支持 sing-box / Quantumult 等其他输出格式

## Decisions

### D1: 运行时与框架 — Hono + TypeScript

Hono 是 Cloudflare Workers 生态事实标准：路由/中间件/Typed Env 开箱即用，`hono/jsx` 可做服务端渲染备选。备选 Bare Workers fetch handler——需要手写路由，长期维护成本高。不用 Remix/Next/React SSR：为单管理员页面上 SSR 框架严重过重。

### D2: 存储 — D1 存元数据，KV 存上游内容缓存

```
D1 (SQLite)                          KV
┌──────────────────────────┐        ┌────────────────────────────────────┐
│ sources                  │        │ fc:src:<id>:data     正文+元数据 envelope│
│  id, name, url, prefix,  │        │ fc:src:<id>:dataAt   内容写入时间  │
│  format, cache_ttl,      │        │ fc:src:<id>:fetched  尝试回源时间  │
│  last_fetch_at,          │        └────────────────────────────────────┘
│  last_fetch_status,      │        data envelope 同时保存正文与订阅用量，
│  created_at              │        读取时兼容旧纯文本；成功回源仍为 3 写，
│                          │        失败尝试 = 1 写（仅 fetched）。
│                          │        分离 dataAt 与 fetched：新鲜度看前者，
│ tokens                   │        节流看后者，失败的尝试不会让旧数据
│  id, token, name,        │        被误判为新鲜。
│  enabled, expires_at,    │
│  last_used_at, created_at│        D1 写入场景：
│                          │        - 管理操作（源/token CRUD）
│ token_sources            │        - 回源后更新 last_fetch_*
│  token_id, source_id     │        - token 最后使用时间（每次订阅
│  (PK: token_id+source_id)│          请求写一次，30次/天量级，
└──────────────────────────┘          10万写/天额度内绰绰有余）
```

备选：全 KV 存元数据——无关联查询能力，token→sources 要手动维护冗余结构，删除源时一致性噩梦。备选 Durable Objects——免费档限制多且杀鸡用牛刀。

### D3: 订阅请求管道

```
GET /sub/:token
  │
  ▼
D1: SELECT token + JOIN sources        （1 次读，宽行）
  │  ├─ 不存在/禁用/过期 → 401/403
  │  └─ 无绑定源 → 400 明确提示
  ▼
对每个源（并行 Promise）:
  KV 读 fc:src:<id>:data + :dataAt + :fetched （每源 3 次读）
  │  ├─ 缓存新鲜（dataAt 距今 < cache_ttl）→ 用缓存
  │  ├─ 缓存过期但 fetched 距今 < MIN_FETCH_INTERVAL → 用旧缓存（节流）
  │  └─ 需要回源 → fetch 上游
  │        ├─ 成功 → 写 KV data+dataAt+fetched（3 次写）、更新 D1 last_fetch_*
  │        └─ 失败 → 仅推进 fetched（1 次写）+ 更新 D1 状态；
  │              保留旧缓存；无旧缓存则该源降级跳过
  ▼
聚合: 各源 → 解析为统一 Proxy[] → 加前缀改名 → 按名去重 → 拼接
  ▼
D1: UPDATE token.last_used_at          （异步 ctx.waitUntil，不阻塞响应）
  ▼
聚合响应元数据:
  ├─ subscription-userinfo: 各有效源 upload/download/total 求和，expire 取最早正值
  └─ profile-update-interval: 各有效源取最短正值；畸形/缺失元数据降级忽略
  ▼
输出: format 参数 > UA 判断
  ├─ Clash → YAML(proxies + 默认 proxy-groups + 默认 rules)
  └─ 其他  → Proxy[] → 分享链接 → 逐行 join → base64
两种输出均附带相同的聚合订阅元数据响应头
```

额度核算：默认 5 源、TTL 30 分钟 → 成功回源最多 48 次/天/源，每次 3 写 → 5 × 3 × 48 = 720 次/天；失败尝试每次仅 1 写且受节流限制（≤ 96 次/天/源）。参数在 wrangler.toml 中可调；MIN_FETCH_INTERVAL 同时是失败重试的额度安全阀（理论上限：源数 × 3 × 86400 / MIN_FETCH_INTERVAL，须 ≤ 1000）。

### D4: 统一节点表示与格式解析

内部以 `Proxy` 对象数组为中间表示（Clash proxy 字段的超集：name/type/server/port + 各协议字段）。

- Clash 上游：YAML 解析后 proxies 数组直接进入（字段即原生格式）
- base64 上游：解码 → 逐行解析 `vmess://`(JSON) / `ss://`(base64 userinfo 或 SIP002) / `trojan://` / `hysteria2://`(URI) → 转为 Proxy
- 输出 base64：Proxy 逆向转回分享链接（Clash 原生节点仅 vmess/ss/trojan/hysteria2 类型可逆向，其余类型跳过并计数）

YAML 解析用 `yaml` 包（纯 JS，Workers 兼容）。不选 js-yaml：API 更老旧且 Workers 打包体积大。

### D5: 会话认证 — 签名 cookie（HMAC）

`POST /api/login` 校验 `ADMIN_PASSWORD`（环境变量，secret）→ 签发 `exp.HMAC` 格式 cookie（HMAC-SHA256，密钥用启动时从 `AUTH_SECRET` 环境变量读取；未设置时首次部署自动生成并写回——wrangler secret 一次性操作）。会话 7 天。无状态，零存储。备选 JWT——同样无状态但需要引入库，HMAC 手写 30 行内。登录失败统一 401 + 固定延迟（防时序侧信道与爆破节奏）。

### D6: 管理页 — Static Assets + 无构建 SPA

`/admin/*` 走 Workers Static Assets，直接托管一个手写单页应用（原生 ES modules，`fetch` 调 `/api/*`，无框架无构建步骤）。静态资产请求不占用 Workers 免费额度。备选 hono/jsx SSR——每次页面导航都消耗 Worker 请求与 CPU；备选 Vite+Preact——构建链维护成本对 3 个页面的后台不值。

### D7: Token 生成

`crypto.getRandomValues` 32 字节 → base64url（43 字符），与 name 分离存储。URL 中直接用 token 值（`/sub/<token>`），无自增 ID 泄露。

## Risks / Trade-offs

- [大订阅超 Workers CPU 10ms 限制] → YAML 解析是 CPU 大头；聚合在 KV 读之后流式进行，超 500 节点的订阅少见；实测超标再考虑缓存"聚合后结果"于 KV（订阅响应级缓存，键含 token）
- [KV 写额度被管理页探测打爆] → 管理端点"立即探测"按钮也走同一节流阀；连续探测同一源在 MIN_FETCH_INTERVAL 内直接返回上次结果
- [上游机场风控 Worker 出口 IP] → 无法在 Worker 内解决；文档中注明风险，源 URL 支持带自定义 UA 头回源
- [旧缓存长期兜底掩盖上游故障] → 源健康状态独立记录（last_fetch_status），管理页可见故障；节流放行后的失败不覆盖缓存但状态照实更新
- [AUTH_SECRET 未设置导致会话不稳定] → 首次部署检测并提示写入 wrangler secret；缺省回退为 ADMIN_PASSWORD 派生密钥（可用但不推荐）
- [vmess JSON 字段混乱（各客户端实现不一）] → 解析容错：未知字段保留透传，字段缺失仅在该节点级别报错跳过，不影响整源

## Migration Plan

全新部署，无迁移。部署顺序：`wrangler d1 create` → `wrangler kv namespace create` → 写入 secrets（ADMIN_PASSWORD、AUTH_SECRET）→ `wrangler d1 migrations apply` → `wrangler deploy`。回滚 = 重新 `wrangler deploy` 上一版本。

## Open Questions

- 默认策略组模板的具体规则集（广告拦截/国内外分流粒度）——实现时选一份主流默认即可，不影响架构
- 地区分组正则的覆盖范围（HK/TW/JP/SG/US/EU 起步）——实现细节

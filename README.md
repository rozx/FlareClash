# FlareClash

基于 Cloudflare Workers（全免费额度）的 Clash 订阅转发服务：把多个机场/自建订阅聚合在统一门禁之后，通过 access token 分发给朋友，撤销权始终在你手里。

```text
管理员 → /admin   管理源订阅与 access token
用户   → /sub/<token>   Clash 客户端直接订阅
```

## 功能

- **多源聚合**：token 关联多个源订阅，节点加源前缀去重后合并返回
- **双格式自适应**：Clash/mihomo UA 收完整 Clash YAML（默认策略组 + 地区分组），其他客户端收 base64 分享链接；`?format=clash|base64` 可显式指定
- **上游格式探测**：Clash YAML 与 base64 分享链接（vmess/ss/trojan/hysteria2）自动识别
- **用量与到期透传**：采集并聚合上游 `subscription-userinfo`，Hiddify 可显示已用/总量/到期；管理后台按源展示用量
- **缓存与节流**：KV 同步缓存上游内容与用量元数据，回源频率受 `MIN_FETCH_INTERVAL` 硬性限制，仍保持每次成功回源 3 次 KV 写
- **token 生命周期**：随机 43 字符 token、可选过期时间、即时禁用/启用、最后使用时间记录
- **管理后台**：密码登录（HMAC 签名 cookie），源/token 增删改查与健康状态展示

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
npx wrangler secret put ADMIN_PASSWORD   # 管理员登录密码
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
npm test          # 109 个单测 + 集成测试（vitest workers 池，真实 D1/KV/miniflare）
npm run typecheck
```

## 使用流程

1. 打开 `/admin/`，用 `ADMIN_PASSWORD` 登录
2. 「源管理」→ 新建源：填机场订阅 URL，自动探测格式与节点数
3. 「Token 管理」→ 新建 token：备注名（如「老王」）、可选过期时间、勾选可见的源
4. 按客户端复制对应地址：Clash/Mihomo 使用 `/sub/clash/<token>`，Hiddify 等使用 `/sub/base64/<token>`
5. 不想给了？禁用或删除 token，立即生效

## 免费额度说明

| 资源 | 免费额度 | 本服务消耗 |
| --- | --- | --- |
| Workers 请求 | 10 万/天 | 每次订阅/后台操作 1 次 |
| D1 读写 | 500 万读 / 10 万写每天 | 每次订阅请求 ~十行级 |
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

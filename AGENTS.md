# AGENTS.md

面向 AI 编码代理的项目指南。FlareClash：基于 Cloudflare Workers 免费额度的 Clash 订阅转发服务（多源聚合 + token 门禁 + 管理后台）。

## 命令

```bash
npm run dev          # wrangler dev（本地，需 .dev.vars + 本地 D1 migration）
npm test             # vitest run（全部测试，workerd 池）
npm run typecheck    # tsc --noEmit
npm run dry-run      # wrangler deploy --dry-run
npm run deploy       # wrangler deploy（生产）
npm run db:migrate:remote   # 远端 D1 migration
```

改动后最低验证线：`typecheck` + `test` + `dry-run` 三绿再提交。

## 架构速览

```text
src/index.ts        Hono 入口：/sub 路由 + /api 路由 + 根占位；/admin/* 由 Workers Static Assets 直接服务（不占 Worker 请求额度）
src/routes/sub.ts   订阅端点：token 校验 → 并行取源 → 聚合 → 按 UA/format/路径输出
src/routes/api.ts   管理 API（登录、源 CRUD、token CRUD、探测）
src/repo.ts         全部 D1 访问（唯一出口）
src/cache/          KV 缓存封装 + 回源决策（新鲜/节流/回源三态）
src/lib/            纯函数：格式解析、聚合、渲染、订阅元数据
public/admin/       管理页 SPA：无构建、原生 ES module、纯 DOM 构造（el() helper，禁 innerHTML）
tests/unit/         纯逻辑单测；tests/integration/ 走真实 D1/KV（vitest-pool-workers / miniflare）
```

数据分片：**D1 存元数据**（sources / tokens / token_sources），**KV 存上游内容缓存**（`fc:src:<id>:data|dataAt|fetched` 三键）。

## 硬性约束（改代码前必读）

1. **KV 免费额度是唯一紧约束**：1000 写/天。成功回源 = 3 写（data+dataAt+fetched），失败 = 1 写（仅 fetched）。`MIN_FETCH_INTERVAL` 是额度安全阀——任何新功能不得增加回源写次数；订阅端点与管理端探测共用同一节流阀。
2. **绑定名不可改**：代码读 `env.DB` / `env.KV`（不是 wrangler 建议的资源名）。
3. **`wrangler.toml` 不入库**（含真实资源 ID），入库的是 `wrangler.toml.example` 模板；`.dev.vars` 同理。secrets 走 `wrangler secret put`。
4. **KV `data` 值是带版本的 envelope**（`fc-cache:v1:{json}`，含正文+订阅元数据）；读取必须兼容旧纯文本缓存（无前缀 → 视为无元数据正文）。升级 envelope 版本时保留向后兼容。
5. **订阅响应必须带标准头**：聚合后的 `subscription-userinfo`（流量求和、expire 取最早正值、任一源 total=0 则总量 0=无限）与 `profile-update-interval`（取最短正值）；两种输出格式（YAML/base64）行为一致。畸形元数据降级忽略，不得让订阅失败。

## 已知坑（真实 runtime 教训）

- **workerd 原生 fetch 不可解构调用**（Illegal invocation）：传 `fetchFn: fetch.bind(globalThis)`。
- **D1 batch 中 `last_insert_rowid()` 不可靠**：拿自增 ID 用独立查询，别混在 batch 里。
- **Hiddify UA 含 "ClashMeta" 但必须返回 base64**：其下载层逐行 trim 会破坏 YAML 缩进。UA 判定顺序：先 `/hiddify/i` → base64，再 clash/mihomo/stash → YAML。
- **wrangler `kv key` 命令默认查本地**，操作生产要显式 `--remote`。
- 管理页是宽表，新增列记得配 `.table-scroll` 横向滚动。

## 约定

- **语言**：文档、注释、commit message 用中文；commit 用 conventional 前缀（feat/fix/chore/style）。
- **格式**：编辑器/工具会自动排版（import 折行、缩进），单独的格式化改动独立提交（style: 前缀）。
- **测试**：新文件必须是 `*.test.ts`（vitest include 只认 ts）。回源 mock 用 `tests/integration/mock-upstream.ts`（stub globalThis.fetch）；集成测试请求要经 `createExecutionContext` + `waitOnExecutionContext` 冲刷 waitUntil。
- **测试驱动**：修 bug 先写能红的回归测试（用真实 UA/真实格式样例），再修到绿；改动行为同步更新 OpenSpec 规格。

## OpenSpec 工作流

规格在 `openspec/changes/<change>/`（spec-driven schema：proposal → specs → design → tasks）。规则：

- 行为变更 = 规格 + 实现 + 任务三同步；`openspec validate <change> --strict` 必须过。
- 需求文档里 `MUST/SHALL` 是硬性验收标准；新增能力在 specs 对应 capability 增补 ADDED/MODIFIED Requirement。
- 主规格在 `openspec/specs/`，change 归档时同步。

## 生产环境

- Worker: `flareclash`（`https://<your-worker>.workers.dev`，自定义域 `<your-sub-domain>`）
- D1: `flareclash`（region ENAM）；KV: `CACHE`
- 部署顺序：改 `wrangler.toml`（本地不入库文件）→ deploy → 需要时 `db:migrate:remote` → 验证生产响应头/内容。
- 生产验证涉及真实订阅 token 时，输出中不得打印 token 全量与订阅正文（打印结构化检查结果即可）。

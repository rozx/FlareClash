# 设计

## 数据
`sources.region TEXT NULL`。取值为地区键 `hk`/`tw`/`jp`/`sg`/`us`/`eu`，NULL 表示自动（按节点名匹配）。存键而不是显示名，以后调整组名（含 emoji）时无需迁移数据。

地区定义集中到 `src/lib/regions.ts`（键、组名、匹配正则），渲染层与 API 校验共用。管理页无构建步骤，不能 import `src/`，所以在 `public/admin/format.js` 维护一份键与显示名的副本，用单测断言两边一致，防止漂移。

## 归属规则：指定地区优先
节点所在源指定了地区时，该节点只进该地区组，不再跑节点名正则；未指定时保持原逻辑（可同时命中多个地区；一个都没命中则进「其余节点」）。

为什么不做「节点名优先、源地区兜底」：节点名包含源前缀，现有正则存在误命中（`\bUS\b` 会匹配 `derp-us` 里的 `us`，欧洲正则的 `UK` 没有词边界）。管理员显式设置地区是明确意图，作为兜底反而会被误命中覆盖，结果难以预测。源里地区混杂时保持「自动」即可。

## 数据流
`getSourcesForToken` 已返回 `s.*`，自然带上 `region`。`sub.ts` 从成功取到的源里收集 `sourceId → region`（过滤非法值），连同 `aggregateWithSources` 已有的 `members`（源 id → 去重后的最终节点名）传给 `buildClashConfig`。渲染层据此建立「节点名 → 指定地区」映射。归属沿用真实去重过程的记录，不靠名称前缀推断，与分流源分组的处理一致。

base64 输出没有策略组，不受影响。

## API
- `POST /api/sources`：`region` 缺省或 `null`/空串 → NULL；合法键 → 保存；其他 → 400。
- `PATCH /api/sources/:id`：`region` 缺省 → 不变；`null`/空串 → 改回自动；合法键 → 保存；其他 → 400。改地区不重置健康状态和格式，也不清 KV 缓存（地区只影响渲染）。

## 兼容与发布
迁移是纯加列，旧行为 NULL，行为不变。先 `db:migrate:remote` 再 deploy：如果先部署，新代码 INSERT/UPDATE `region` 列会因列不存在而失败。

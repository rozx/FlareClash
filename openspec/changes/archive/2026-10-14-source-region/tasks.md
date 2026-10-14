# 任务

- [x] 核对现有地区分组、源 CRUD、管理页与规格，写提案/设计/规格。
- [x] 先写会红的测试：渲染层源地区优先、API 校验与持久化、订阅端两个自建源得到「美国 + 香港」、管理页地区定义与后端一致。
- [x] 新增 `src/lib/regions.ts` 集中地区定义；`clash-render` 改为按源地区优先归属。
- [x] migration 0005 加 `sources.region`；同步测试 schema；repo 读写 `region`。
- [x] 管理 API 校验并保存 `region`；订阅端把源地区传给渲染层。
- [x] 管理页源表单加「地区分组」下拉，源列表加「地区」列。
- [x] typecheck、全量 test、dry-run、`openspec validate source-region --strict` 全部通过。
- [x] 生产：`db:migrate:remote`（0005 已执行）→ deploy → 验证 Clash 输出为「🇭🇰 香港 + 🇺🇸 美国」。管理员已把 derp-hk 源前缀改为含 HK，按节点名即可归入香港，因此未修改该源的 region 设置。

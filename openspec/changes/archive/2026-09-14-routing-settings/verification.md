# 验证记录

本记录为发布前验证，功能随后提交到 main（`c1c62a5`），基于已有格式化提交 `b9d6098`。未读取或修改客户端的私有配置；以下检查不等同于生产发布或客户端现场验证。

## 已通过

- `npm run typecheck`：Worker 和独立浏览器测试 tsconfig 均通过。
- `npm test`：19 文件、185 测试通过，其中新增 18 项分流集成测试。
- `npm run test:browser`：Chromium headless，1024×900、390×844 两项目通过。使用真实静态页面和虚构 API 响应；API 行为由独立 workerd/D1/KV 集成测试验证。
- `npm run dry-run`：构建通过，新增 JSON 默认值与管理页面模块正确打包。
- `npx openspec validate 2026-09-14-routing-settings --strict`：通过。
- `git diff --check`：通过。
- 内存 SQLite 顺序应用 0001→0003 migrations，routing_config 单例约束通过；不代表已应用生产迁移。

## 核心覆盖

- 默认文件、D1 覆盖、恢复默认与零 KV 访问。
- 认证、无效输入、未知字段、配置大小、规则数量、缺失目标/源。
- 域名规范化、后缀边界、有序匹配，前置 IP 条件的不确定提示。
- token 授权源隔离、相同前缀/节点名的真实来源归属、空引用组失败保护、手动/自动组。
- Hiddify 数字字段原生 JSON、规则顺序、公共目标映射、TCP/UDP 兜底；GEOIP 与定向组拒绝导出。
- 浏览器：分组选择、规则排序、保存重载、JSON 错误与应用、下载、保存失败、Hiddify 不兼容提示、恢复默认、无脚本错误、窄屏无横向溢出。

浏览器回归发现并修复了真实的 JSON 编辑竞争：details 的延迟 toggle 事件会覆盖新输入；改为展开前同步填充，错误 JSON 的回归断言已通过。

截图由 Playwright 输出到被 Git 忽略的 `test-results/`，桌面/手机均已查看。可通过 `npm run test:browser` 重建。

## 限制与后续

- Hiddify 4.1.1 导出依据官方 protobuf 和 JSON 文件导入代码。仅证实文件结构与声明能力，不声称真实客户端流量已按规则执行。需在目标版本备份、导入并检查运行时路由；独立导入不会随节点订阅自动刷新。
- 为保持既有 Clash 行为，默认 JSON 保留 `GEOIP,CN,DIRECT`。原生 Hiddify 没有独立 GEOIP 字段，该默认配置不能直接完整导出；界面会提示，管理员必须明确调整。不会将国家 IP 悄悄替换为国家域名后缀。
- 浏览器测试未覆盖 Safari/Firefox；未覆盖修改默认文件后自动迁移 D1 覆盖（设计上覆盖保持不变），并发管理编辑为最后保存生效。
- `npm audit` 显示 4 项 high，均来自既有开发依赖：@cloudflare/vitest-pool-workers 0.22.0、miniflare 5.20260815.0-alpha、sharp 0.35.2、wrangler 4.126.0，版本与基线相同；未执行破坏性的 audit fix --force。新加 Playwright/Node 类型依赖不在此列表。
- 现有本地 Wrangler observability.redact_query_string 字段仍有兼容性警告；未改本地配置，不能假定日志已脱敏。

发布顺序：先检查/应用 `0003_routing_config.sql`，再发布 Worker 与静态资产；Clash 更新订阅，Hiddify 根据兼容提示单独导入规则。归档与生产发布另行记录，不以本文件的测试结果替代线上检查。

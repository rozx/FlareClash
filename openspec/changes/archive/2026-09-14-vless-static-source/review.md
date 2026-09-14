# 归档前自审

范围：基于 `e5f5e96` 的未提交功能变更（VLESS/Reality、静态源、管理界面）。由当前会话直接审查；原计划的两路子代理因缺少 read 工具未启动成功，不算独立审查证据。

## 规范与安全

- 已修复：测试样例和 proposal 混入生产节点信息。已替换为虚构凭据和示例域名，生产域名、资源 ID 不进入本次提交。
- 已修复：静态源列表读取 KV、删除时访问 KV，与零 KV 的承诺不符。集成测试覆盖创建、列表、探测、订阅、删除的零访问。
- 已修复：源创建仍依赖跨查询 last_insert_rowid。改为使用 INSERT 返回的 last_row_id；URL 去重查询集中到 repo。

## 规格与行为

- 已修复：表单提交 kind，但 PATCH 忽略该字段。现在双向切换类型并清理不适用字段，保留 token 绑定，离开旧 fetch 时清缓存。
- 已修复：未知 kind 被默认为 fetch、PATCH URL 缺校验。创建和编辑共用输入校验，重复 URL 返回 409。
- 已修复：VLESS IPv6 渲染缺方括号、ALPN 丢失及 Clash 类型错误，缺少用户标识/Reality 公钥仍生成坏链接。补齐往返和拒绝不支持模式的测试。
- 已修复：新增 select/textarea 未复用暗色控件样式，宽度与 padding 不一致。统一样式；隐藏控件禁用，避免浏览器验证阻断提交。
- 已修复：MODIFIED delta 只含增量文字，直接归档会删除旧验收要求。恢复完整原要求和场景后追加新增行为。
- 已修复：proposal 声称 static 不支持 YAML，与 detectFormat 实现不符。文档明确复用格式探测，兼容明文/base64 链接和 YAML。

## 验证

- `npm run typecheck`：通过。
- `npm test`：18 个测试文件，167 测试通过。
- `npm run dry-run`：通过。
- OpenSpec change 严格验证：通过。
- `git diff --check`：通过。
- 浏览器回归：真实 admin 页面、虚构 API 数据；1024px 和 390px 下检查控件宽度、背景、padding、类型显隐，页面无脚本异常。修复前断言因 select 宽度不同失败，修复后通过。
- LSP 主动检查没有返回错误，但 6 个 push-only 文件未确认 clean；以 tsc 和实际测试结果为依据。

## 限制与非阻断警告

- 浏览器回归使用 Chromium 和虚构管理数据，未覆盖所有浏览器；不代表实际代理线路端到端连通性测试。
- 本次不支持 XHTTP 和额外 VLESS 加密模式，转换时拒绝而非降级。
- Wrangler dry-run 对现有本地 observability.redact_query_string 配置发出兼容性警告，未因此改动不入库的配置；不能据此保证生产日志会隐藏订阅查询参数。

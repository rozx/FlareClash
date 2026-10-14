# 任务

- [x] 核实 Loyalsoldier 规则集地址与格式、Telegram 官方 IP 段；写提案/设计/规格。
- [x] 先写会红的测试：配置解析（RULE-SET/备注/地区去向）、Clash 输出（rule-providers、地区回退）、Hiddify 拒绝与备注名、订阅集成、模板数据校验。
- [x] `src/lib/rulesets.ts`；`routing.ts` 模型/校验/编译；`clash-render.ts`；`hiddify-rules.ts`；`/api/routing` 返回目录。
- [x] 分流页：添加规则三标签页、模板数据 `templates.js`、规则行备注与规则集下拉、去向分组含地区。
- [x] 更新浏览器测试与 `config/README.md`、README。
- [x] typecheck、全量 test、浏览器测试、dry-run、`openspec validate routing-presets --strict`。

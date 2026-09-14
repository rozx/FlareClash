# 任务

- [x] 验证 Hiddify 版本与客户端边界，用户确认共同能力 + Clash 分组
- [x] JSON 默认规则与配置校验
- [x] D1 管理接口、恢复默认与隔离测试
- [x] Clash 按源分组、有序规则与失败保护
- [x] Hiddify 原生规则导出与格式兼容性检查；不支持的 GEOIP/定向组拒绝导出
- [x] 网站表单、JSON 导入导出、域名预览
- [x] 全量验证：185 测试、2 个浏览器项目、typecheck、dry-run、OpenSpec strict、diff check

## 未执行的发布与现场检查

- 本次未对生产 D1 应用 migration、未部署、未归档或提交功能代码。
- 未修改用户 Hiddify 路由列表，未执行客户端真实流量分流测试；导出结构通过不等于线路验证通过。
- 证据与已知限制见 `verification.md`。

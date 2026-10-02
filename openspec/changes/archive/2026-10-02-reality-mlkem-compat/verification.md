# 验证记录

## TDD
- 首次 npm test -- tests/unit/reality-compat.test.ts：1 个测试失败，实际 YAML 缺少 support-x25519mlkem768，与现场故障一致。
- 最小实现后解析/往返/回归组合：37 个测试通过。
- 补充 TLS、明文、无 security 负例和调用方显式 false 保留后，全量 22 文件 / 212 测试通过。
- 测试只使用虚构域名、UUID、公钥和 shortId。

## 发布前
- npm run typecheck：通过。
- npm test：212/212 通过。
- npm run dry-run：通过。
- openspec validate 2026-10-02-reality-mlkem-compat --strict 和 openspec validate --all --strict：通过。
- git diff --check：通过。
- 三个改动 TS 文件的主动 LSP error 检查：0 错误。解析模块既有通用风格提示没有扩展为无关重构。
- Wrangler 既有 observability.redact_query_string 未识别警告仍在，本次没有修改其配置或声称查询字符串脱敏。

## 生产验证
- 已按用户额外授权部署订阅转换代码，标识 9152796-reality-mlkem-dirty；实际 Cloudflare deployment/version ID 与回滚版本保存在私有运维记录中。
- 用户原订阅 URL HTTP200，实际 Reality YAML 含支持开关及完整认证字段。
- Hiddify（含 ClashMeta）UA 得到 base64，Reality/flow/SNI/pbk/sid 语义保留，URI 没有 Mihomo 专有参数。
- 用未修改的真实订阅启动独立 Mihomo v1.19.31：Reality+Vision HTTPS200、Hy2 HTTPS200。
- 负向对照：错误 Reality 公钥被拒绝，明文 VLESS 被拒绝。
- 正常刷新 Mac 原订阅并热加载：Reality 两次229ms，Hy2 228ms；凭据/策略组/分流未改，无本机专用覆盖脚本。
- DERP 未重启；Hy2 正规 CA 证书配置未改。临时客户端进程/目录及 OAuth 临时日志已清理。

## 限制
- 发布时采用尚未提交的工作区快照，因此明确使用 dirty 后缀，未冒充干净 HEAD；后续归档和 Git 提交不会自动重新部署生产版本。
- Android/Hiddify 设备没有本轮现场连接复测；仅验证其输出格式/参数。旧客户端对 MLKEM 的支持不在当前已验证范围。
- 真实节点凭据、分享链接、D1 CAS SQL、数据库/证书备份、订阅 token 与 Worker 历史均仅存在私有运维目录，不写入仓库。

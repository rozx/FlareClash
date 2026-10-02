# 实施前审查

## 已验证
- 真实故障与规则对应：Mihomo v1.19.31 无兼容开关时认证失败；只增加 support-x25519mlkem768=true 后认证和 HTTPS200 均成功。3x-ui v3.8.5 原生 Clash 导出启用同一字段。
- 数据可达：src/lib/link-parse.ts:322-387 的 parseVless 已能取得 security/pbk/sid/flow，且在生成节点前拒绝无公钥/未知 security；无需新增来源识别或 IO。
- 解析覆盖：parseBase64Sub 逐条调用公开 parseShareLink；static/fetch 的分享链接走同一规则，无持久化或时序新增需求。
- 渲染透传：src/lib/clash-render.ts:43-133 直接序列化 proxies，不裁掉 reality-opts。故无需对所有节点加渲染层补丁，直接 YAML 的显式 false 保留。
- 范围限定：只在 security=reality 分支派生，普通 TLS/明文与其他协议不受影响。
- 标准 URI 往返：src/lib/link-parse.ts:389-439 的 toVlessLink 只编码标准字段，不会把 Mihomo 专用布尔值写进 URI；重新解析会重新派生。
- 既有断言影响：tests/unit/link-parse.test.ts:231 的完整 reality-opts 精确断言需补新增布尔值；既有 round-trip 测试仍应成立。

## 已关闭的计划缺口
1. 不能只测解析对象：用户同意的回归必须经 buildClashConfig 再解析实际 YAML，以免中间输出丢字段。
2. 不能修改所有 Clash Reality 节点：实现限定为 URI 解析分支，避免覆盖显式配置。
3. 不能声称 Android/旧客户端均验证：记录当前 Mac Mihomo 和服务器 Xray 验证范围；旧客户端支持另行验证。
4. 不提交却用 HEAD 标识发布会产生误导：部署采用明确 dirty/修复后缀的版本标识，并记录实际 Cloudflare deployment ID。

## 结论
计划可实施。仅需可选类型字段与 Reality 分支初始化开关，无新增依赖、缓存写入、schema 或密钥变更。按单个失败测试→最小实现→非 Reality 负例顺序执行，不批量先写假想功能。
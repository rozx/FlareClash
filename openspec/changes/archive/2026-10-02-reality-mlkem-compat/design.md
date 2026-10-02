# 设计

## 位置与数据流
parseShareLink → parseVless 校验 security/pbk → Proxy.reality-opts → buildClashConfig 直接序列化。兼容开关在 URI 解析时派生，不在渲染层对所有节点进行重写。

## 最小实现
扩展 VlessOpts 的可选布尔字段，在 security === "reality" 分支初始化支持开关为 true，保留原有 pbk/sid/flow/sni/fp 校验与映射。无需新增外部依赖或改变缓存/数据库访问。

## 边界与兼容
- 普通 TLS、明文 VLESS、其他协议不生成 reality-opts。
- 无公钥/非法 security 的链接依旧拒绝，不降低安全类型。
- 已有 Clash YAML 的显式配置（含 false）保持原样。
- toShareLink 不把此 Mihomo 配置字段写入 URI；再次解析 Reality URI 时重新派生，原有标准参数与往返语义不变。
- 不将 enable MLKEM 等同于降低 Reality 认证或关闭证书校验。错误公钥和明文客户端应仍失败。

## 验证与发布
用户同意以 parseShareLink → buildClashConfig 公开边界测试。先添加失败回归，再最小实现，随后补非 Reality 负例并跑链接往返既有测试。发布前 typecheck、全量 test、dry-run、OpenSpec strict 全通过。发布后读取真实 Clash 与 base64 订阅，检查参数，然后用独立 Mihomo 验证 Reality 与 Hy2，并检查错公钥/明文失败。最后正常刷新 Mac 原订阅并热加载，无专用覆盖。

## 风险与限制
新增字段要求支持该选项的 Mihomo；当前验证内核 v1.19.31。旧版其他客户端是否支持新 Xray 要求需另行设备验证。生产真实凭据/节点 URI/D1 运维备份不得写入 Git，使用独立私有备份目录。部署未提交代码时版本标识必须明确标注 dirty/修复后缀，不能冒充 HEAD 对应的纯净构建。

## ADDED Requirements

### Requirement: Reality 混合密钥交换兼容
系统 SHALL 为从有效 VLESS Reality 分享链接转换出的 Clash/Mihomo 节点启用 X25519MLKEM768，以兼容 Xray 26.9.8+ 的 Reality 入站。

- 对成功解析的 security=reality 链接，Clash YAML 的 reality-opts MUST 包含 support-x25519mlkem768: true，并保留公钥、shortId、Vision flow、SNI 和客户端指纹。
- 普通 TLS 或明文 VLESS 分享链接 MUST NOT 因此新增 reality-opts。
- 已有 Clash YAML 源的显式 Reality 配置 MUST 保持原样，不在通用渲染层强制改写。
- Base64/分享链接输出 MUST 保留标准 URI 参数，不增加 Mihomo 专用 URI 参数；再次解析 Reality URI 时 SHALL 重新派生兼容开关。
- 不完整或不支持的 Reality 链接 MUST 按既有校验拒绝，不得静默降级为 TLS 或明文。

#### Scenario: Reality URI 转换为现代 Mihomo 配置
- **WHEN** 一个有效的 VLESS Reality + Vision 分享链接被解析并以 Clash YAML 输出
- **THEN** 对应 proxy 的 reality-opts 包含 support-x25519mlkem768: true，原有认证和 TLS 参数保留

#### Scenario: 非 Reality VLESS 不被改写
- **WHEN** 分享链接使用 security=tls、security=none 或省略 security
- **THEN** Clash YAML 节点不包含 reality-opts，原有 TLS/明文语义保持不变

#### Scenario: 标准分享链接往返
- **WHEN** 一个 Reality 节点经分享链接或 base64 输出后再次解析
- **THEN** 公钥、shortId、flow、SNI 与客户端指纹保留，Clash 配置重新派生混合密钥交换兼容开关

#### Scenario: 直接输入 Clash YAML
- **WHEN** 源已是 Clash YAML，Reality 选项包含用户显式指定的 support-x25519mlkem768: false
- **THEN** 通用 Clash 渲染不覆盖该显式值

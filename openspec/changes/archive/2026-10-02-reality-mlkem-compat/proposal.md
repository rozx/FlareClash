# Reality 订阅转换的混合密钥交换兼容修复

## Why
Xray 26.9.8+ 的 Reality 入站拒绝不带 X25519MLKEM768 key share 的握手。现有分享链接转 Clash YAML 时只导出公钥和 shortId，Mihomo 默认不启用该能力，导致认证失败。实测只补 support-x25519mlkem768=true 即可恢复连接；3x-ui v3.8.5 原生 Clash 导出也启用此项。

## What Changes
- 对成功解析的 security=reality VLESS 分享链接，在 reality-opts 中派生 support-x25519mlkem768: true。
- 增加公开“分享链接解析 → Clash YAML”链路回归，覆盖普通 TLS/明文 VLESS 不受影响及链接往返。
- 更新 subscription-serving 规格，并完成验证后部署现有 Worker。

## 非目标
不降级 Xray，不修改客户端专用脚本，不改变 Hysteria2、权限/绑定、分流、D1 schema 或 KV 回源行为，不给分享 URI 增加 Mihomo 专有参数。

## 影响
新增字段仅用于 Reality URI 转出的 Mihomo 配置。直接导入的 Clash YAML 不被强行改写。Hiddify/base64 保留标准分享链接语义；并不声称旧版客户端已支持新的密钥交换。

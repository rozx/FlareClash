# vless 协议支持与静态节点源

## Why

管理员在自建服务器上部署了 VLESS+Reality 与 Hysteria2 节点。现有管道只认 vmess/ss/trojan/hysteria2 四种分享链接——vless 会被静默丢弃；且源必须是可以回源的 http(s) URL，自建单节点没有「订阅地址」可填，只能把分享链接散播给每个朋友，违背「撤销权留在管理员手里」的初始定位。

## What Changes

- 分享链接解析/逆向支持 `vless://`（含 Reality 参数 pbk/sid/flow/fp、ws/grpc 传输层），base64 输出端可逆类型集合加入 vless
- 源新增 `kind = 'fetch' | 'static'` 两类：fetch 保持既有 URL 回源行为（默认值，迁移后存量行保持 fetch）；static 源内容（分享链接文本，每行一条）直接存 D1 `content` 列，订阅请求时本地解析，不回源、不读写 KV、不受回源节流阀约束
- 管理 API 与管理页表单支持创建/编辑 static 源；创建与改内容时预检「至少解析出 1 个节点」，防止存入死数据
- static 源的「探测」走本地解析并写健康状态与格式，无任何 KV 操作（KV 免费额度约束不变）

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `subscription-serving`: 多源聚合兼容 static 源（D1 内容直读）；vless 链接进出管道
- `admin-management`: 源订阅管理支持两种 kind；上游格式探测对 static 源改为本地解析
- `admin-ui`: 源管理表单按类型切换字段（URL+TTL vs 节点内容 textarea）

## 非目标

- 不实现 XHTTP、额外 VLESS 加密模式等长尾协议选项；不支持的传输/安全模式应拒绝转换而非静默降级。ALPN 与 IPv6 属于本次兼容范围。
- 不增加独立 YAML 编辑器；static 内容复用 detectFormat，兼容现有 Clash YAML 与明文/base64 分享链接格式。
- 不做 static 源的订阅用量元数据（自建节点无上游 userinfo 可透传）

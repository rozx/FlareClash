# 订阅服务规格（subscription-serving）delta

## MODIFIED Requirements

### Requirement: 多源聚合

系统 SHALL 将一个 token 关联的所有源订阅合并为单一订阅返回。

- 聚合 MUST 保留每个节点的可用信息（名称、类型、服务器、端口、凭证等）
- 每个节点的显示名 MUST 可区分其来源：默认为原名加源前缀，源未配置前缀时使用源名称
- 名称完全相同的节点（含前缀后）MUST 去重，仅保留一个
- 某个源获取失败时，聚合 MUST 降级为使用其余可用源，而非整体失败

#### Scenario: 两个源合并

- **WHEN** token 关联源 A（3 个节点）与源 B（2 个节点），全部获取成功
- **THEN** 返回的订阅包含 5 个节点，节点名分别带 A、B 的前缀

#### Scenario: 源获取失败降级

- **WHEN** token 关联 2 个源，其中 1 个上游请求失败且无可用缓存
- **THEN** 返回的订阅仅包含成功源的内容，HTTP 状态仍为 200

#### Scenario: 同名节点去重

- **WHEN** 两个源中存在改名后名称完全相同的节点
- **THEN** 合并结果中该名称只出现一次

系统 SHALL 聚合 token 关联的所有源，源分两类，行为不同：

- `fetch` 源（默认）：经 KV 缓存与回源节流从上游 URL 获取内容（行为不变）
- `static` 源：内容存于 D1 `sources.content`，订阅请求时直接本地解析，MUST NOT 发起任何上游请求、MUST NOT 读写 KV、MUST NOT 受 `MIN_FETCH_INTERVAL` 约束
- static 源解析失败时 MUST 与 fetch 源失败同等降级（跳过该源，不影响其他源）
- static 源不产生订阅用量元数据（按无元数据处理，参与求和时视为缺失项）

#### Scenario: static 源与 fetch 源混合聚合

- **WHEN** token 绑定一个 fetch 源与一个 static 源
- **THEN** 两种源的节点均出现在聚合结果中，各自加源前缀；static 源的获取不触发回源与 KV 写

#### Scenario: static 源内容解析失败

- **WHEN** static 源 content 被改为不可解析文本后发生订阅请求
- **THEN** 该源被跳过，订阅响应由其余源正常构成

### Requirement: 按客户端自适应输出

系统 SHALL 根据请求的 User-Agent 返回不同格式。

- UA 属于 Clash 系（含 `clash`、`mihomo` 等标识）时，MUST 返回完整 Clash YAML：含全部合并节点、默认策略组（自动选择 + 按节点名正则匹配的地区分组）与默认规则集
- Hiddify UA MUST 优先返回单行 base64，即使其 UA 同时含 `ClashMeta`；这是为了规避 Hiddify 下载层逐行 trim 破坏 YAML 缩进的兼容性问题
- 其他 UA MUST 返回 base64 编码的分享链接列表（每行一条 `vmess://`/`ss://`/`trojan://`/`hysteria2://`/`vless://` 链接后整体 base64）
- 请求可通过查询参数（如 `?format=clash` 或 `?format=base64`）显式指定格式，显式指定优先于 UA 判断
- 系统 MUST 提供路径即格式的确定性端点：`/sub/clash/:token` 强制返回 Clash YAML，`/sub/base64/:token` 强制返回 base64；路径格式优先于查询参数与 UA

#### Scenario: Clash 客户端请求

- **WHEN** UA 含 `clash` 或 `mihomo`
- **THEN** 响应为 Clash YAML，`Content-Type` 为 YAML 类型，含 proxies、proxy-groups、rules 三段

#### Scenario: 非 Clash 客户端请求

- **WHEN** UA 不含 Clash 系标识
- **THEN** 响应为 base64 编码的分享链接列表

#### Scenario: Hiddify UA 同时包含 ClashMeta

- **WHEN** UA 形如 `HiddifyNext/... like ClashMeta v2ray sing-box`
- **THEN** 响应仍为单行 base64，不返回会被客户端破坏缩进的 Clash YAML

#### Scenario: 显式格式覆盖

- **WHEN** 请求带 `?format=base64` 但 UA 为 Clash
- **THEN** 返回 base64 格式

#### Scenario: Clash 格式路径

- **WHEN** 任意 UA 请求 `/sub/clash/:token`
- **THEN** 返回 Clash YAML，即使查询参数要求 base64

#### Scenario: Base64 格式路径

- **WHEN** 任意 UA 请求 `/sub/base64/:token`
- **THEN** 返回 base64 编码的分享链接列表，即使 UA 为 Clash

分享链接解析与逆向 SHALL 支持 `vless://` 链接：uuid、flow、`security=reality|tls`、sni、fp、pbk/sid（Reality 公钥/短 ID）、`type=ws|grpc` 传输层参数 MUST 完整保留；base64 输出端 vless 为可逆类型。

#### Scenario: vless Reality 节点经 base64 输出

- **WHEN** 源含 vless Reality 节点且客户端收到 base64 输出
- **THEN** 输出包含原样语义的 vless 链接（uuid/pbk/sid/flow/sni 保留），节点名带源前缀

#### Scenario: vless Reality 节点经 Clash YAML 输出

- **WHEN** 同一节点以 Clash 格式输出
- **THEN** proxy 含 `type: vless`、`uuid`、`flow`、`tls: true`、`servername`、`client-fingerprint` 与 `reality-opts: {public-key, short-id}`

#### Scenario: VLESS IPv6 与 ALPN 往返

- **WHEN** 分享链接包含 IPv6 地址或 ALPN 列表
- **THEN** 输出链接 MUST 保留 IPv6 方括号与 ALPN 值，Clash 输出使用 ALPN 数组

#### Scenario: 无法安全转换的 VLESS 配置

- **WHEN** VLESS 缺少用户标识、Reality 缺少公钥，或链接请求本次不支持的传输/加密选项
- **THEN** 解析或逆向转换 MUST 返回不可用并由调用方跳过，不得静默降级为其他安全配置；本次支持 TCP（含 raw 别名）、WS、gRPC 及 none/TLS/Reality

# 订阅服务规格（subscription-serving）

## Purpose

面向最终用户的核心服务：凭 access token 通过单一端点获取由多个上游订阅聚合而成的订阅内容，按客户端类型自适应输出格式，并通过缓存与节流保护 Cloudflare 免费额度。

## Requirements

### Requirement: Token 校验

系统 SHALL 通过 `/sub/:token` 端点提供订阅访问，并对每次请求执行 token 校验。

- token 不存在、已禁用或已过期时，请求 MUST 被拒绝并返回 401/403
- token 有效但未绑定任何源时，MUST 返回明确错误而非空配置
- 校验通过后，系统 SHALL 记录该 token 的最后使用时间

#### Scenario: 有效 token 访问

- **WHEN** 客户端以存在的、启用的、未过期的 token 请求 `/sub/:token`
- **THEN** 系统返回 200 及该 token 关联的所有源聚合后的订阅内容

#### Scenario: token 不存在

- **WHEN** 客户端以不存在的 token 请求 `/sub/:token`
- **THEN** 系统返回 401，响应体不泄露任何源信息

#### Scenario: token 已禁用或已过期

- **WHEN** token 处于禁用状态，或当前时间超过其过期时间
- **THEN** 系统返回 403

#### Scenario: token 未绑定源

- **WHEN** 有效 token 没有关联任何源订阅
- **THEN** 系统返回明确的错误提示（含错误说明），不返回空配置文件

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

### Requirement: 订阅用量元数据

系统 SHALL 将上游订阅的流量限额与到期信息通过标准响应头传递给客户端。

- 回源成功时 MUST 采集合法的 `subscription-userinfo`（`upload`、`download`、`total`、可选 `expire`）与正整数 `profile-update-interval`
- 元数据 MUST 与对应内容一起缓存；缓存命中与节流使用旧内容时 MUST 同时使用同一版本的元数据
- 多个成功源包含合法用量元数据时，`upload`、`download` MUST 分别求和，`expire` MUST 取最早的正值；任一源 `total=0`（无限流量惯例）时聚合 `total` MUST 为 0
- 多个成功源包含更新间隔时，`profile-update-interval` MUST 取最短的正值
- 缺失或畸形元数据 MUST 被忽略，不得导致订阅请求失败；全部源均无合法元数据时 MUST 不输出对应响应头
- Clash YAML、base64 与 UA 自适应端点 MUST 使用相同的元数据响应头行为

#### Scenario: 单源用量透传

- **WHEN** 唯一成功源返回合法 `subscription-userinfo` 与 `profile-update-interval`
- **THEN** 订阅响应包含语义等价的两个标准响应头，Hiddify 可显示总量、已用量、到期时间与更新间隔

#### Scenario: 多源用量聚合

- **WHEN** 两个成功源均返回合法用量元数据
- **THEN** 响应中的流量数字为两源之和、到期时间为两源最早正值、更新间隔为两源最短正值

#### Scenario: 缓存命中保留用量

- **WHEN** 上游内容与元数据已缓存，后续请求命中缓存
- **THEN** 不回源且响应仍包含缓存版本的用量元数据

#### Scenario: 畸形用量元数据降级

- **WHEN** 某成功源的用量响应头缺字段、含负数或非数字
- **THEN** 该源节点仍参与聚合，但其畸形元数据被忽略

### Requirement: 上游内容缓存与回源节流

系统 SHALL 缓存上游订阅内容并限制回源频率，保证 KV 每日写入次数不超过 1000（免费额度）。

- 上游内容 MUST 按源缓存，缓存有效期可配置（默认 30 分钟）
- 缓存有效期内 MUST 直接使用缓存，不发起上游请求
- 缓存过期后，若距该源上次回源时间小于最短回源间隔（节流阀），系统 MUST 返回缓存中的旧内容（即使已过期），不发起上游请求
- 回源成功 MUST 同时记录内容与回源时间戳
- 回源结果在上游返回异常状态码或内容无法解析时 MUST NOT 覆盖已有可用缓存

#### Scenario: 缓存命中

- **WHEN** 源缓存在有效期内且有订阅请求
- **THEN** 不发起上游请求，直接用缓存响应，无 KV 写入

#### Scenario: 节流生效

- **WHEN** 缓存已过期但距上次回源小于最短回源间隔
- **THEN** 返回旧缓存内容，不发起上游请求

#### Scenario: 上游故障保留旧缓存

- **WHEN** 缓存过期且节流允许回源，但上游返回 500
- **THEN** 继续使用旧缓存内容响应，缓存不被破坏性覆盖

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

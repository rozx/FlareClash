# 订阅服务规格（subscription-serving）

## Purpose

面向最终用户的核心服务：凭 access token 通过单一端点获取由多个上游订阅聚合而成的订阅内容，按客户端类型自适应输出格式，并通过缓存与节流保护 Cloudflare 免费额度。

## ADDED Requirements

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

### Requirement: 按客户端自适应输出

系统 SHALL 根据请求的 User-Agent 返回不同格式。

- UA 属于 Clash 系（含 `clash`、`mihomo` 等标识）时，MUST 返回完整 Clash YAML：含全部合并节点、默认策略组（自动选择 + 按节点名正则匹配的地区分组）与默认规则集
- Hiddify UA MUST 优先返回单行 base64，即使其 UA 同时含 `ClashMeta`；这是为了规避 Hiddify 下载层逐行 trim 破坏 YAML 缩进的兼容性问题
- 其他 UA MUST 返回 base64 编码的分享链接列表（每行一条 `vmess://`/`ss://`/`trojan://`/`hysteria2://` 链接后整体 base64）
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

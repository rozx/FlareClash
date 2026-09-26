# 管理能力规格（admin-management）

## Purpose

为单管理员提供认证与全部管理 API：上游源订阅的增删改查与格式探测、access token 的完整生命周期管理及其与源的多对多绑定。

## Requirements

### Requirement: 管理员认证

系统 SHALL 以环境变量中的管理员密码保护所有管理 API（`/api/*`）与管理页面。

- 密码通过 `POST /api/login` 提交，正确时签发签名会话 cookie，错误时返回 401
- 会话 cookie MUST 由服务端密钥签名（防伪造）并设置过期时间
- 除登录端点外的所有管理 API MUST 校验会话 cookie，未认证请求返回 401；畸形 cookie MUST 视为未认证（401），不得导致 500
- 未认证访问管理页面时 MUST 跳转或呈现登录界面，不暴露任何管理数据
- 密码比较 MUST 为常量时间（不因前缀匹配长度产生时间差）
- 登录尝试 MUST 按客户端 IP（取 `CF-Connecting-IP`；IPv6 按 /64 前缀归并）与全局两级计数，计数存 D1，MUST NOT 写 KV
- 单 IP 在 15 分钟窗口内失败 5 次 MUST 锁定该 IP：首次 15 分钟，重复锁定逐次翻倍，上限 24 小时；该 IP 空闲 24 小时后翻倍级数清零；该 IP 登录成功时清零其计数
- 全局在 1 小时窗口内失败 50 次 MUST 暂停所有密码登录 1 小时；已签发的有效会话 MUST 不受影响
- 尝试额度 MUST 在比对密码之前原子预占，并发请求不得越过上限
- 处于锁定的请求 MUST 返回 429 与 `Retry-After`（秒），MUST NOT 比对密码（即使密码正确也拒绝），MUST NOT 产生 D1 写入
- `/api/_ping` MUST 返回 `warnings` 数组：`ADMIN_PASSWORD` 少于 16 个字符、未设置 `AUTH_SECRET` 时各给出一条提示；管理页 SHALL 展示这些提示。提示不得阻断登录

#### Scenario: 登录成功

- **WHEN** 以正确密码请求 `POST /api/login`
- **THEN** 返回 200 并设置签名会话 cookie

#### Scenario: 登录失败

- **WHEN** 以错误密码请求 `POST /api/login`
- **THEN** 返回 401，不签发 cookie

#### Scenario: 未认证 API 访问

- **WHEN** 不携带有效会话 cookie 请求任意 `/api/*` 管理端点
- **THEN** 返回 401，不执行任何管理操作

#### Scenario: 畸形会话 cookie

- **WHEN** 携带无法 base64 解码的会话 cookie 请求管理 API
- **THEN** 返回 401 而非 500

#### Scenario: 单 IP 连续失败被锁定

- **WHEN** 同一 IP 在 15 分钟内 5 次密码错误后，再以正确密码登录
- **THEN** 返回 429 与 `Retry-After`，不签发 cookie；其他 IP 仍可正常登录

#### Scenario: IPv6 同一 /64 共享计数

- **WHEN** 同一 /64 前缀下不同 IPv6 地址累计失败 5 次
- **THEN** 该 /64 下任意地址被锁定

#### Scenario: 锁定翻倍

- **WHEN** 某 IP 锁定期满后再次连续失败 5 次
- **THEN** 本次锁定时长为上次的两倍（上限 24 小时）

#### Scenario: 成功登录清零

- **WHEN** 某 IP 失败 4 次后以正确密码登录成功
- **THEN** 该 IP 计数清零，之后再失败 4 次仍未锁定

#### Scenario: 并发爆破

- **WHEN** 同一 IP 并发发起 20 次错误密码登录
- **THEN** 至多 5 次进入密码比对，其余返回 429

#### Scenario: 全局锁不影响已有会话

- **WHEN** 多个 IP 累计 1 小时内失败 50 次
- **THEN** 任何 IP 的密码登录均返回 429，但已持有有效会话 cookie 的管理请求正常返回

#### Scenario: 弱配置提示

- **WHEN** `ADMIN_PASSWORD` 少于 16 个字符或未设置 `AUTH_SECRET` 时请求 `/api/_ping`
- **THEN** 响应 `warnings` 含对应提示，登录功能不受影响

### Requirement: 源订阅管理

系统 SHALL 提供源订阅的增删改查能力。

- 源记录 MUST 包含：名称、源类型、上游 URL（fetch）或节点内容（static）、可选的节点名前缀、缓存有效期、创建时间、最近回源时间、最近回源状态
- 创建与更新源时，系统 SHALL 支持立即触发一次回源探测：验证上游可达性与内容格式，并将结果反馈给管理员
- 删除源时，已缓存的内容 MUST 一并清除
- 源列表 MUST 展示每个源的健康状态（最近回源成功/失败及时间）
- fetch 源列表 API MUST 从现有 KV 缓存读取并返回合法的订阅用量元数据（upload/download/total/expire/profile update interval），不得仅为展示触发回源

#### Scenario: 创建源

- **WHEN** 管理员提交源名称与上游 URL
- **THEN** 源被创建，并可选择立即回源探测，返回探测结果（成功/失败及识别出的格式）

#### Scenario: 更新源 URL

- **WHEN** 管理员修改某源的上游 URL
- **THEN** 该源的缓存被清除，下次订阅请求使用新 URL 回源

#### Scenario: 删除源

- **WHEN** 管理员删除一个源
- **THEN** 源记录、其与 token 的所有绑定、其缓存内容均被删除

#### Scenario: 查看源健康状态

- **WHEN** 管理员打开源列表
- **THEN** 每个源显示最近回源时间、成功或失败状态

#### Scenario: 查看源订阅用量

- **WHEN** 管理员打开源列表且某源缓存含合法订阅用量元数据
- **THEN** API 返回该源的已上传、已下载、总量、到期时间与建议更新间隔

#### Scenario: 无缓存元数据

- **WHEN** 某源尚未回源或上游未提供合法元数据
- **THEN** API 将该源元数据标记为不可用，不为展示额外回源

源 SHALL 具备 `kind` 属性（`fetch` | `static`，默认 `fetch`）：

- 创建 fetch 源：校验 name 与 http(s) URL、URL 去重（行为不变）
- 创建 static 源：MUST 校验 name 与非空 content，且 content MUST 能解析出至少 1 个节点，否则拒绝创建（400）；static 源 MUST NOT 参与 URL 去重
- 更新 static 源 content：MUST 重新预检可解析性；改内容后健康状态与格式失效化，待下次探测重建；内容改动在下次订阅请求立即生效
- 删除行为两类一致（级联删 token 绑定）

#### Scenario: 创建含 vless 与 hysteria2 的 static 源

- **WHEN** 管理员以 `kind=static`、每行一条分享链接的 content 创建源
- **THEN** 源创建成功，探测结果显示格式与节点数；全程零上游请求、零 KV 读写

#### Scenario: 创建不可解析的 static 源被拒

- **WHEN** content 为空或无法解析出任何节点
- **THEN** 返回 400 与原因，不产生任何数据写入

#### Scenario: 双向切换源类型

- **WHEN** 管理员 PATCH 源的 kind 并提供新类型的必需数据
- **THEN** 系统 MUST 校验目标类型并保存，切为 static 时清空 URL，切为 fetch 时清空 content；源 id 和 token 绑定保持不变
- **AND** 旧类型为 fetch 且 URL 或类型改变时 MUST 清理旧 KV 缓存；静态源的日常创建、读取、探测、订阅、编辑和删除 MUST NOT 访问 KV

#### Scenario: 非法类型或 URL

- **WHEN** 创建或编辑提交未知 kind，或 fetch 目标 URL 不合法，或与其他 fetch 源 URL 重复
- **THEN** 系统 MUST 拒绝（400 或重复 URL 的 409），不能静默改变类型或保存非法配置

### Requirement: 上游格式探测

系统 SHALL 自动识别上游订阅的格式。

- 支持的格式至少包括：Clash YAML（含 proxies 数组）与 base64 分享链接集合（`vmess://`/`ss://`/`trojan://`/`hysteria2://`/`vless://`）
- 无法识别的内容 MUST 报告为探测失败并给出原因，不得静默创建不可用源

#### Scenario: 识别 Clash YAML

- **WHEN** 上游返回内容解析出合法 proxies 数组
- **THEN** 该源被标记为 clash 格式，节点数被报告

#### Scenario: 识别 base64 链接集合

- **WHEN** 上游返回 base64 解码后为逐行分享链接
- **THEN** 该源被标记为 base64 格式，节点数被报告

#### Scenario: 无法识别

- **WHEN** 上游内容既非合法 Clash YAML 也非合法分享链接集合
- **THEN** 探测失败，报告原因，源不进入可用状态

探测 SHALL 按源类型分流：fetch 源走既有回源+节流管道；static 源 MUST 直接解析 D1 content 并写健康状态（ok/error）与格式，MUST NOT 产生 KV 操作或上游请求。

#### Scenario: static 源立即探测

- **WHEN** 管理员对 static 源点击探测
- **THEN** 立即返回解析结果（无节流等待），健康状态写库

### Requirement: Token 生命周期管理

系统 SHALL 提供 access token 的创建、禁用、启用、删除与查询能力。

- 创建 token MUST 生成不可预测的随机 token 值，并支持可选的过期时间与备注名
- token MUST 可被单独禁用与重新启用，禁用立即生效
- 删除 token 后其值立即失效
- token 列表 MUST 展示：名称、值、启用状态、过期时间、绑定的源、最后使用时间

#### Scenario: 创建 token 并绑定源

- **WHEN** 管理员创建 token 并勾选绑定 2 个源
- **THEN** token 创建成功，以该 token 访问 `/sub/:token` 可获取这 2 个源的聚合内容

#### Scenario: 禁用 token 立即生效

- **WHEN** 管理员禁用某 token 后，客户端立即以该 token 请求订阅
- **THEN** 请求被拒绝（403）

#### Scenario: 修改 token 的源绑定

- **WHEN** 管理员为一个已存在的 token 增减绑定源
- **THEN** 下次以该 token 请求即返回新绑定集合的聚合结果，无需重建 token

#### Scenario: 过期 token 自动失效

- **WHEN** token 的过期时间已过，客户端以该 token 请求订阅
- **THEN** 请求被拒绝（403），列表中该 token 显示已过期

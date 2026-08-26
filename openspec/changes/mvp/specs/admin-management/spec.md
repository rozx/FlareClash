# 管理能力规格（admin-management）

## Purpose

为单管理员提供认证与全部管理 API：上游源订阅的增删改查与格式探测、access token 的完整生命周期管理及其与源的多对多绑定。

## ADDED Requirements

### Requirement: 管理员认证

系统 SHALL 以环境变量中的管理员密码保护所有管理 API（`/api/*`）与管理页面。

- 密码通过 `POST /api/login` 提交，正确时签发签名会话 cookie，错误时返回 401
- 会话 cookie MUST 由服务端密钥签名（防伪造）并设置过期时间
- 除登录端点外的所有管理 API MUST 校验会话 cookie，未认证请求返回 401
- 未认证访问管理页面时 MUST 跳转或呈现登录界面，不暴露任何管理数据

#### Scenario: 登录成功

- **WHEN** 以正确密码请求 `POST /api/login`
- **THEN** 返回 200 并设置签名会话 cookie

#### Scenario: 登录失败

- **WHEN** 以错误密码请求 `POST /api/login`
- **THEN** 返回 401，不签发 cookie

#### Scenario: 未认证 API 访问

- **WHEN** 不携带有效会话 cookie 请求任意 `/api/*` 管理端点
- **THEN** 返回 401，不执行任何管理操作

### Requirement: 源订阅管理

系统 SHALL 提供源订阅的增删改查能力。

- 源记录 MUST 包含：名称、上游 URL、可选的节点名前缀、缓存有效期、创建时间、最近回源时间、最近回源状态
- 创建与更新源时，系统 SHALL 支持立即触发一次回源探测：验证上游可达性与内容格式，并将结果反馈给管理员
- 删除源时，已缓存的内容 MUST 一并清除
- 源列表 MUST 展示每个源的健康状态（最近回源成功/失败及时间）
- 源列表 API MUST 从现有 KV 缓存读取并返回合法的订阅用量元数据（upload/download/total/expire/profile update interval），不得仅为展示触发回源

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

### Requirement: 上游格式探测

系统 SHALL 自动识别上游订阅的格式。

- 支持的格式至少包括：Clash YAML（含 proxies 数组）与 base64 分享链接集合（`vmess://`/`ss://`/`trojan://`/`hysteria2://`）
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

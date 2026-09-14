# 管理能力规格（admin-management）delta

## MODIFIED Requirements

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

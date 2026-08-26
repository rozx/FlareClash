# 管理后台界面规格（admin-ui）

## Purpose

为管理员提供基于浏览器的管理后台：登录、源订阅管理、token 管理与健康状态查看，与管理 API 同域部署，随 Worker 一起发布。

### Requirement: 登录界面

管理后台 MUST 提供登录界面。

- 未认证访问 `/admin` 下任意路径 MUST 呈现登录界面，不加载任何管理数据
- 登录成功后进入管理主界面；会话过期后的任意操作 MUST 引导回登录界面
- 登录失败 MUST 给出明确提示

#### Scenario: 未登录访问

- **WHEN** 未认证状态访问 `/admin`
- **THEN** 呈现登录界面，无任何源或 token 数据被请求或展示

#### Scenario: 登录成功进入后台

- **WHEN** 输入正确密码提交登录
- **THEN** 进入管理主界面，展示源与 token 概览

#### Scenario: 会话过期

- **WHEN** 会话 cookie 过期后管理员在后台执行任意操作
- **THEN** 前端引导回登录界面

### Requirement: 源管理界面

后台 MUST 提供源订阅管理界面。

- MUST 支持新建源（填写名称、URL、可选前缀）并在提交后展示探测结果（成功/失败、识别格式、节点数）
- MUST 支持编辑源的名称、URL、前缀、缓存有效期
- MUST 支持删除源，删除 MUST 有二次确认
- 源列表 MUST 展示每个源的名称、格式、健康状态（最近回源时间与结果）、绑定的 token 数
- 源列表 MUST 展示缓存中的订阅已用量（upload + download）/总量、到期时间与建议更新间隔；无合法元数据时显示“暂无”

#### Scenario: 新建源并看到探测结果

- **WHEN** 管理员填写源名称与 URL 提交创建
- **THEN** 界面显示探测结果：识别出的格式与节点数，或失败原因

#### Scenario: 删除源二次确认

- **WHEN** 管理员点击删除某源
- **THEN** 弹出确认提示；确认后源消失，取消则不执行删除

#### Scenario: 查看源用量与到期时间

- **WHEN** 源缓存包含订阅用量元数据
- **THEN** 源列表显示人类可读的“已用 / 总量”、到期时间与更新间隔

#### Scenario: 源未提供用量

- **WHEN** 源缓存没有合法订阅用量元数据
- **THEN** 源列表相应位置显示“暂无”，其余管理功能不受影响

### Requirement: Token 管理界面

后台 MUST 提供 access token 管理界面。

- MUST 支持创建 token：填写备注名、可选过期时间、勾选绑定的源
- MUST 支持分别复制 Clash URL（`/sub/clash/:token`）、Base64 URL（`/sub/base64/:token`）与自动识别 URL（`/sub/:token`）到剪贴板
- MUST 支持禁用/启用、删除 token（删除需二次确认）
- MUST 支持修改已存在 token 的源绑定
- token 列表 MUST 展示：名称、状态（启用/禁用/过期）、绑定源、最后使用时间

#### Scenario: 创建 token 并复制订阅地址

- **WHEN** 管理员创建 token 成功后选择客户端格式并点击复制
- **THEN** 对应格式的完整订阅 URL 进入剪贴板，可直接发给 Clash/Mihomo 或 Hiddify 等客户端

#### Scenario: 查看最后使用时间

- **WHEN** 某 token 被客户端使用过
- **THEN** token 列表中该 token 显示最后使用时间

#### Scenario: 修改 token 绑定

- **WHEN** 管理员在 token 编辑界面勾选/取消源后保存
- **THEN** 列表反映新的绑定关系

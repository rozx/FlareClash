# 管理能力规格（admin-management）delta

## MODIFIED Requirements

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

# 管理后台规格（admin-management）delta

## ADDED Requirements

### Requirement: 源地区设置

源 SHALL 具备可选的 `region` 属性，用于声明该源节点所属地区。

- `region` 取值 MUST 为 `hk`、`tw`、`jp`、`sg`、`us`、`eu` 之一，或为空（NULL，表示按节点名自动识别）
- 创建源时 `region` 缺省、`null` 或空串 MUST 保存为 NULL；编辑源时缺省 MUST 保持不变，`null` 或空串 MUST 改回 NULL
- 非法 `region` 值 MUST 被拒绝（400），且不产生任何数据写入
- 修改 `region` MUST NOT 重置源的健康状态与格式，MUST NOT 清理 KV 缓存或触发回源
- 源列表与详情 API MUST 返回 `region`

#### Scenario: 创建带地区的源

- **WHEN** 管理员以 `region=hk` 创建 static 源
- **THEN** 源创建成功，API 返回的源记录 `region` 为 `hk`

#### Scenario: 非法地区被拒

- **WHEN** 创建或编辑源时提交 `region=mars`
- **THEN** 返回 400 与原因，源记录不变

#### Scenario: 地区改回自动

- **WHEN** 管理员 PATCH 源 `region=null`
- **THEN** 源的 `region` 变为 NULL，健康状态与格式保持不变

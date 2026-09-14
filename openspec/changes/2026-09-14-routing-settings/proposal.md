# 网站分流设置与本地 JSON 默认规则

## Why
多源聚合目前仅有硬编码规则。管理员需要统一维护分流，默认配置使用可直接编辑的仓库 JSON。

## What Changes
- 新增客户端无关的 JSON 默认规则；网站持久化 D1 覆盖，支持恢复默认和导入导出。
- Clash 支持有序规则、按源策略组；Hiddify 通过独立原生规则 JSON 导入共同能力，不修改既有 base64 订阅。
- 管理页新增分流设置、验证和域名规则预览。

## Capabilities
### New Capabilities
- `routing-policy`: 默认 JSON、配置管理、客户端编译、隔离与预览。
### Modified Capabilities
（无：现有格式端点和元数据约定保持；默认行为保持。）

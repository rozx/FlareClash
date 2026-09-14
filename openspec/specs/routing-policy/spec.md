# 分流配置规格（routing-policy）

## Purpose

以可本地编辑的 JSON 默认配置和网站 D1 覆盖统一管理分流，提供有序规则、按授权源分组的 Clash 输出，以及明确兼容边界的 Hiddify 原生规则导出。

## Requirements

### Requirement: 共享 JSON 配置

系统 MUST 将默认分流配置保存在仓库 `config/routing.default.json`，可人工编辑并经构建发布；管理 API MUST 支持读取、保存 D1 覆盖及恢复默认，MUST NOT 使用 KV。修改规则不应重新获取上游。

#### Scenario: 默认与覆盖

- **WHEN** 无已保存配置
- **THEN** API 和编译器使用本地 JSON 默认值，Clash 默认规则与既有行为一致
- **WHEN** 管理员保存合法配置后重新读取，或恢复默认
- **THEN** 分别返回持久化配置或本地默认配置，不改仓库文件

#### Scenario: 校验与认证

- **WHEN** 未认证请求管理端点，或提交未知字段、无效域名/CIDR/目标、重复组、过大配置或不存在的源
- **THEN** 系统 MUST 拒绝请求，不能覆盖有效配置

### Requirement: Clash 源分组与隔离

规则 MUST 按输入顺序编译，兜底规则 MUST 最后。PROXY 指向原有节点选择；自定义组支持手动或自动测速并从指定源获取节点。上游规则不合并。

#### Scenario: 限定授权节点

- **WHEN** 全局组包含多个源，而 token 只绑定部分源
- **THEN** 输出 MUST 仅包含已授权源的节点，不能按名称前缀推断权限

#### Scenario: 引用组不可用

- **WHEN** 生效规则或兜底引用组，而授权且成功获取的成员为空
- **THEN** 返回清晰错误，不能生成悬空引用或悄悄直连

### Requirement: Hiddify 共同规则导入

Hiddify base64 节点订阅 MUST 保持兼容；共同分流配置 MUST 支持导出 Hiddify 原生 RouteRule JSON，网站 MUST 说明独立导入和更新方式。不能以生成 sing-box JSON 作为 Hiddify 生效证据。

#### Scenario: 导出共同能力

- **WHEN** 配置仅使用 Hiddify 支持的条件和 DIRECT/PROXY/REJECT 目标
- **THEN** 导出原生字段编号 JSON，规则顺序和兜底动作保留；不得包含源内容、节点凭据或 token

#### Scenario: 不支持的目标

- **WHEN** 配置引用 Clash 自定义策略组
- **THEN** Hiddify 导出 MUST 拒绝并明确提示，而非忽略规则或替换目标

### Requirement: 网站编辑与预览

网站 MUST 提供按源分组、有序规则编辑、兜底选择、JSON 导入导出与恢复默认，并采用既有暗色 DOM 组件。保存前必须校验；错误显示在页面内。

#### Scenario: 域名预览

- **WHEN** 管理员输入域名进行预览
- **THEN** 使用与保存相同的规范化和规则顺序返回域名匹配及序号；明确说明未执行 DNS/IP/GEOIP 匹配，不把不确定结果说成真实最终流向

#### Scenario: 移动端操作

- **WHEN** 在窄屏编辑规则、调整顺序或导入 JSON
- **THEN** 表单不超出页面宽度，控件有可访问标签；无 innerHTML 拼接，异步错误可见

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

- 页面 MUST 以「添加规则 → 规则列表 → 测试网址」为主流程；节点组与备份/导出等高级功能 MUST 可折叠，不得挡在主流程之前
- 添加规则 MUST 支持一次输入多项（换行、逗号或空格分隔）并默认自动识别域名与 IP 段；完整网址 MUST 自动取域名；新规则 MUST 插入列表最前；加入前 MUST 经服务端校验，失败时逐项指出无效输入且不改动草稿
- 兜底 MUST 作为规则列表固定的最后一行展示，不可移动或删除
- 有未保存修改时 MUST 持续可见保存与撤销入口；站内切页或关闭页面前 MUST 提示确认，取消后草稿保持不变

#### Scenario: 域名预览

- **WHEN** 管理员输入域名或完整网址进行预览
- **THEN** 使用与保存相同的规范化和规则顺序返回域名匹配及序号，并高亮命中的规则行（未命中则高亮兜底）；明确说明未执行 DNS/IP/GEOIP 匹配，不把不确定结果说成真实最终流向

#### Scenario: 批量添加规则

- **WHEN** 管理员在添加框粘贴 `https://chat.openai.com/c/1`、`openai.com` 与 `10.8.0.0/16` 并选择去向「代理」
- **THEN** 列表最前新增 `chat.openai.com`、`openai.com`（域名及子域名）与 `10.8.0.0/16`（IP 段）三条代理规则，状态变为未保存

#### Scenario: 批量添加含无效项

- **WHEN** 输入中有一项无法通过服务端校验
- **THEN** 页面指出该项与原因，草稿不新增任何规则

#### Scenario: 未保存离开

- **WHEN** 草稿有修改时管理员点击其他导航页并在确认框选择取消
- **THEN** 仍停留在分流页，地址栏还原，草稿内容不变

#### Scenario: 移动端操作

- **WHEN** 在窄屏编辑规则、调整顺序或导入 JSON
- **THEN** 表单不超出页面宽度，控件有可访问标签；无 innerHTML 拼接，异步错误可见

### Requirement: 远程规则集

分流规则 SHALL 支持引用内置目录中的远程规则集。

- 规则类型 `RULE-SET` 的内容 MUST 是内置目录中的规则集 ID，未知 ID MUST 被拒绝；不支持任意自定义 URL
- Clash 输出 MUST 只为被引用的规则集生成 `rule-providers`（http 类型、目录给定的 behavior 与 URL），规则行为 `RULE-SET,<id>,<去向>`，顺序与配置一致
- Worker MUST NOT 下载或解析规则集内容，MUST NOT 为此读写 KV
- Hiddify 导出遇到 `RULE-SET` MUST 拒绝并说明；域名预览遇到前置 `RULE-SET` MUST 标记结果不确定
- `GET /api/routing` MUST 返回规则集目录（ID、名称、说明、类型、建议去向）

#### Scenario: 引用广告规则集

- **WHEN** 配置含 `{ "type": "RULE-SET", "value": "reject", "target": "REJECT" }` 且 Clash 客户端拉取订阅
- **THEN** YAML 含 `rule-providers.reject`（behavior domain、Loyalsoldier URL）与规则 `RULE-SET,reject,REJECT`，未引用的规则集不出现

#### Scenario: 未知规则集

- **WHEN** 保存的配置引用不在目录中的规则集 ID
- **THEN** 返回 400，不覆盖已保存配置

### Requirement: 地区去向

规则与兜底的去向 SHALL 可以是地区组（`region:hk`、`region:tw`、`region:jp`、`region:sg`、`region:us`、`region:eu`）。

- Clash 输出 MUST 将地区去向映射为对应的地区组名
- 当前 token 的订阅没有生成该地区组时，该去向 MUST 回退为 `🚀 节点选择`，订阅 MUST NOT 因此失败，MUST NOT 回退为直连
- 未知地区键 MUST 被拒绝；Hiddify 导出遇到地区去向 MUST 拒绝并说明

#### Scenario: 有该地区节点

- **WHEN** 规则 `openai.com → region:us` 且 token 的节点中有美国节点
- **THEN** Clash 规则为 `DOMAIN-SUFFIX,openai.com,🇺🇸 美国`

#### Scenario: 没有该地区节点

- **WHEN** 同一配置下另一个 token 没有任何美国节点
- **THEN** 该规则输出为 `DOMAIN-SUFFIX,openai.com,🚀 节点选择`，订阅正常返回

### Requirement: 规则备注

规则 SHALL 支持可选备注 `note`。

- 备注 MUST 不超过 64 个字符且不含控制字符；空白备注 MUST 视为未设置
- 备注 MUST NOT 出现在 Clash 规则行中；Hiddify 导出时 MUST 用备注作为规则名

#### Scenario: 备注只用于管理

- **WHEN** 规则带备注「ChatGPT」并导出 Clash 与 Hiddify
- **THEN** Clash 规则行不变；Hiddify 对应规则名为「ChatGPT」

### Requirement: 常用服务模板

分流页 SHALL 提供常用服务模板，一键生成普通规则。

- 模板 MUST 只生成现有的域名/IP 规则类型，带模板名备注，插入列表最前，生成后可像手写规则一样编辑或删除
- 模板中的每个域名与 IP 段 MUST 能通过服务端校验
- 模板与规则集的全部规则都已存在时 MUST 显示为已添加，不重复添加

#### Scenario: 一键添加 ChatGPT 并指向美国

- **WHEN** 管理员在「常用服务」勾选 OpenAI / ChatGPT，去向选「🇺🇸 美国」并添加
- **THEN** 列表最前出现 openai.com、chatgpt.com 等规则，去向均为美国，备注为模板名，状态为未保存

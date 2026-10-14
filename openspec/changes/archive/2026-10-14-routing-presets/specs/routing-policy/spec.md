# 分流配置规格（routing-policy）delta

## ADDED Requirements

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

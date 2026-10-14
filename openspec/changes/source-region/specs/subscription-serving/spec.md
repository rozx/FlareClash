# 订阅服务规格（subscription-serving）delta

## ADDED Requirements

### Requirement: 源级地区归属

Clash YAML 的地区分组 SHALL 支持由源显式指定地区。

- 源指定了地区（`hk`/`tw`/`jp`/`sg`/`us`/`eu`）时，该源经聚合去重后保留的全部节点 MUST 只归入对应地区组，不再按节点名正则匹配
- 源未指定地区（NULL）时 MUST 保持按节点名正则匹配的原有行为；未命中任何地区的节点进入「其余节点」组
- 节点归属 MUST 依据聚合去重过程中记录的真实来源，不得依据节点名前缀推断
- 数据库中出现的非法地区值 MUST 视为未指定，不得导致订阅失败
- base64 输出不含策略组，地区设置 MUST NOT 改变其内容

#### Scenario: 自建源节点名不含地区关键字

- **WHEN** token 绑定两个 static 源：A 指定地区 `hk`，节点名为 `VLESS Reality — migrated`；B 未指定地区，节点名含 `US`
- **THEN** Clash YAML 含「🇭🇰 香港」组（成员为 A 的全部节点）与「🇺🇸 美国」组（成员为 B 的节点），不生成「其余节点」组

#### Scenario: 指定地区优先于节点名

- **WHEN** 源指定地区 `hk`，但其某节点名含 `US`
- **THEN** 该节点只出现在「🇭🇰 香港」组，不出现在「🇺🇸 美国」组

#### Scenario: 未指定地区的源行为不变

- **WHEN** 所有源的地区均为空
- **THEN** 地区分组与现有按节点名正则匹配的结果完全一致

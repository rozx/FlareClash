# 分流 JSON

`routing.default.json` 是唯一内置默认值，Worker 构建时打包。网站 D1 覆盖优先于文件；修改文件后已存在的覆盖不会自动消失，应按需在网站恢复默认。

## 共同能力示例

下面只包含可导出到 Hiddify 原生格式的条件和目标（示例不是中国 IP 分流规则）：

```json
{
  "version": 1,
  "groups": [],
  "rules": [
    { "type": "DOMAIN-SUFFIX", "value": "local", "target": "DIRECT" },
    { "type": "IP-CIDR", "value": "10.0.0.0/8", "target": "DIRECT" },
    { "type": "IP-CIDR6", "value": "fc00::/7", "target": "DIRECT" },
    { "type": "DOMAIN-SUFFIX", "value": "ads.example.org", "target": "REJECT" }
  ],
  "final": "PROXY"
}
```

`DOMAIN` 为完整域名；`DOMAIN-SUFFIX` 同时匹配域名自身和以点分隔的子域；`DOMAIN-KEYWORD` 按包含匹配。域名输入不带协议、路径或 `*`，支持规范化 IDNA。CIDR 必须写掩码，IPv6 不带方括号。`GEOIP` 使用两位国家代码，仅支持 Clash 输出。

规则从上到下执行；`final` 是 TCP/UDP 兜底。Clash 的 `PROXY` 对应节点选择组；Hiddify 的 `PROXY` 对应客户端当前选择的代理。Hiddify 文件使用原生 protobuf 编号字段，不能直接当作本网站配置 JSON 导入。

## Clash 专属策略组

在 `groups` 添加：

```json
{
  "id": "g_self",
  "name": "自建节点",
  "sourceIds": [1],
  "mode": "url-test"
}
```

`sourceIds` 是**当前部署**的真实源 ID，示例 1 仅占位，跨部署导入必须重选。`mode` 为 `select` 或 `url-test`。规则的 `target` 或 `final` 可以使用 `g_self`。显示名称生成后附带 ID，重命名不会改变引用。

所有组均只从当前 token 的授权源中取节点，不能绑定组来绕过 token 授权。引用空组会使 Clash 订阅返回 502；未引用且无成员的组不输出。Hiddify 导出遇到定向组会返回 422，不自动改成普通代理。

## 限制与管理接口

- 文档最大 64 KiB；最多 32 组、256 规则；组 ID 唯一、单组至多 128 个非重复源 ID。
- 只接受声明的字段，无注释/尾逗号；不支持任意 YAML、规则脚本或自动合并上游规则。
- `GET /api/routing`：当前配置、来源、内置默认值。
- `PUT /api/routing`：校验后保存配置；`DELETE /api/routing`：恢复默认。
- `POST /api/routing/validate`：校验草稿并返回 Hiddify 不兼容项。
- `POST /api/routing/preview`：`{ "config": <配置>, "domain": "example.org" }`；不执行 DNS/IP/GEOIP。
- `POST /api/routing/hiddify`：用配置 JSON 请求，返回可下载的原生规则文件；不包含节点凭据。

以上均需管理员会话且不使用 KV。没有公开配置端点。多人同时编辑时最后一次保存生效，导入/导出包含域名策略信息，请按私有配置保管。

## Hiddify 证据与边界

针对 4.1.1（其他版本需重新确认）：

- [Rule 字段定义](https://github.com/hiddify/hiddify-app/blob/v4.1.1/lib/hiddifycore/generated/v2/config/route_rule.pb.dart)
- [Outbound 枚举](https://github.com/hiddify/hiddify-app/blob/v4.1.1/lib/hiddifycore/generated/v2/config/route_rule.pbenum.dart)
- [JSON 文件导入/导出](https://github.com/hiddify/hiddify-app/blob/v4.1.1/lib/features/route_rules/notifier/rules_notifier.dart)

导出格式采用 `RouteRule.writeToJson()` 的数字字段，不是标准 protobuf JSON 的字段名形式。兜底使用 `port_range: ["0:65535"]` 表达 TCP/UDP 全端口，避免空条件被判无效。验证覆盖文件结构、顺序、类型和拒绝不兼容项；未修改用户 Hiddify 设置，未宣称完成真实流量测试。导入可能覆盖客户端现有列表，应先备份；内置规则与客户端版本会影响实际行为，需检查导入后的列表和运行时路由。

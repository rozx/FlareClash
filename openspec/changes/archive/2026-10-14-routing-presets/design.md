# 设计

## 配置模型（version 仍为 1，向后兼容）
```ts
rule: { type: RuleType | "RULE-SET"; value: string; target: string; note?: string }
target: "PROXY" | "DIRECT" | "REJECT" | `g_${string}` | `region:${RegionKey}`
```
- `RULE-SET` 的 value MUST 是目录 ID；未知 ID 拒绝。
- `note`：可选，去首尾空白后为空则省略；≤64 字符，不含控制字符。
- `region:<key>` 的 key MUST 是 `lib/regions` 中的地区键。旧配置不含这些字段，解析结果不变。

## 规则集目录（`src/lib/rulesets.ts`）
固定条目：`{ id, name, description, behavior, url, suggested }`，url 指向 `cdn.jsdelivr.net/gh/Loyalsoldier/clash-rules@release/<id>.txt`（YAML payload，已逐个核实可访问）。不开放自定义 URL：订阅里的 URL 会被每个朋友的客户端拉取，内置目录可控、可审查。`GET /api/routing` 附带目录供前端展示，前端不再复制一份。

Clash 输出：
```yaml
rule-providers:
  reject: { type: http, behavior: domain, url: …, path: ./ruleset/reject.yaml, interval: 86400 }
rules:
  - RULE-SET,reject,REJECT
```
只输出被引用的规则集。ipcidr 规则集不加 `no-resolve`，与上游推荐配置一致（需要解析域名后按 IP 匹配，如国内 IP 直连）。

## 地区去向与回退
地区组按 token 的节点动态生成，某 token 可能没有某地区节点。与「节点组」不同（管理员显式绑定源，缺成员说明配置错误，应报错），地区去向是「优先用这个地区」的偏好，缺失时回退到 `🚀 节点选择` 更符合预期，不会悄悄直连。`clashRules(config, regions)` 接收实际生成的地区键集合完成映射。

## Hiddify
`RULE-SET` 与地区去向都无法用原生 RouteRule 表达，`hiddifyIssues` 明确列出，导出 422；有备注时用备注作为规则名（字段 3）。

## 域名预览
`RULE-SET` 与 IP/GEOIP 一样无法在服务端判断，视为「前面有无法预览的规则」，结果标记不确定。

## 前端
- 「添加规则」三个标签页（role=tablist）。手动输入沿用现有逻辑；常用服务为多选卡片 + 去向；远程规则集为多选列表，每项带默认建议去向可改。全部插到列表最前，按目录/模板顺序。已完整存在的模板或规则集标为「已添加」。
- 模板数据在 `public/admin/templates.js`（纯数据），单测用后端的域名/CIDR 校验逐项验证，保证一键添加不会触发校验错误。
- 规则行：`RULE-SET` 的内容是规则集下拉；内容下方是备注输入，内置说明（局域网等）作为占位提示。
- 去向下拉用 optgroup：基本（代理/直连/拦截）、地区（没有该地区节点时走代理）、节点组。

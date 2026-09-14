# 设计说明

## 为什么 static 源存 D1 而不是 KV

- KV 免费额度（1000 写/天）是全项目唯一紧约束，静态节点内容变更频率极低，放 D1 零 KV 写；读路径 `getSourcesForToken` 本来就要查 D1 sources 表，加一列 content 零额外查询
- D1 免费额度（500 万读/天）对此量级绰绰有余

## 为什么 kind 默认 'fetch' 而不是 nullable

`ALTER TABLE ... NOT NULL DEFAULT 'fetch'` 对存量行零迁移成本；应用层 `src.kind === "static"` 判定对 undefined 值自然落到 fetch 路径，双重保险。

## 为什么创建/改内容要预检

管理页是唯一写入口，但 API 可能被脚本直调；预检（detectFormat ≥ 1 节点）保证库里不存在「解析恒失败」的死源，省得订阅端每次请求空转解析。预检复用订阅端同一 detectFormat，行为一致。

## vless 解析的字段取舍

- 本次只支持 `encryption=none`，未提供时按 none 处理；其他模式拒绝转换，不冒充支持
- `type=tcp` 是默认值，不写入 Proxy.network（与 vmess 现状一致，Clash 端默认即 tcp）
- Reality：`security=reality` → `tls: true` + `reality-opts`（mihomo 要求 reality 也标 tls）；逆向时 `reality-opts` 存在 → `security=reality`
- ALPN 转为 Clash 数组并在分享链接中重新串接；IPv6 出站地址保留方括号
- 本次支持 TCP/raw、WS、gRPC；未知传输、安全或加密模式拒绝转换，Reality 无公钥、VLESS 无用户标识的节点不得生成错误分享链接

## 源类型切换

创建和 PATCH 共用 parseSourceLocation；切换类型同时清空不适用的 url/content，保留源 id 和 token 绑定。旧类型为 fetch 且 URL/类型变化时清一次旧 KV 缓存；static 的日常管理和订阅不访问 KV。状态重置由 repo.updateSource 集中处理。

## static 源与回源节流的交互

无交互——static 路径在 fetcher 之前分叉，节流阀、KV envelope、健康状态 KV 键均不触碰。健康状态（last_fetch_*）复用同一组列：static 探测直接写这些列，管理页零改动即能展示。

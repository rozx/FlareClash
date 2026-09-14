# 任务清单

## 1. vless 协议支持

- [x] `src/lib/link-parse.ts`：parseVless / toVlessLink（Reality + ws/grpc），SUPPORTED_SCHEMES 加 vless
- [x] `src/lib/types.ts`：REVERSIBLE_TYPES 加 vless
- [x] 单测：字段解析、往返无损、混合协议集合（tests/unit/link-parse.test.ts）

## 2. 静态源数据层

- [x] migrations/0002_static_source.sql：sources 加 kind/content
- [x] `src/repo.ts`：SourceRow / createSource / updateSource 支持 kind、content
- [x] tests/integration/schema.ts 同步列

## 3. 订阅管道

- [x] `src/routes/sub.ts`：static 源本地解析分叉（零回源、零 KV）

## 4. 管理 API 与界面

- [x] `src/routes/api.ts`：POST/PATCH 接受 kind/content + 预检；probeAndRecord static 分流
- [x] `public/admin/app.js`：源表单类型切换（URL+TTL ↔ textarea）

## 5. 验证

- [x] 集成测试：创建/预检/PATCH/订阅输出（base64 + clash）/ 零回源断言（tests/integration/static-source.test.ts）
- [x] typecheck + vitest 全绿 + wrangler deploy --dry-run
- [x] openspec validate --strict

## 6. 上线（本仓库外）

- [x] 首次上线：迁移 D1、部署、生产响应验证，录入自建节点并绑定既有 token

## 7. 归档前审查修复

- [x] 修复 PATCH 类型切换不生效，增加双向切换与缓存失效回归测试
- [x] 静态源列表和删除跳过 KV，测试完整生命周期零 KV 访问
- [x] VLESS 保留 IPv6 / ALPN，拒绝缺少必需字段或不支持的安全/传输模式
- [x] 源输入统一校验，未知 kind 和非法 URL 不再静默通过
- [x] 表单 select / textarea 统一主题、宽度、内边距，禁用隐藏字段的浏览器校验
- [x] 浏览器在 1024px / 390px 验证控件对齐和类型切换；测试样例不含生产凭据
- [x] MODIFIED delta 保留原规格完整要求和场景，README 与实现同步
- [x] 最终检查：167 测试、typecheck、dry-run、OpenSpec strict 通过

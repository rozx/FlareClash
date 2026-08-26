# MVP 任务分解

## 1. 项目脚手架与基础设施

- [x] 1.1 初始化项目：package.json、wrangler.toml（Worker 入口 + D1/KV 绑定 + Static Assets 配置 + MIN_FETCH_INTERVAL 等参数）、tsconfig、vitest 配置。验证：`wrangler deploy --dry-run` 通过
- [x] 1.2 编写 D1 migration（sources / tokens / token_sources 三表 + 索引）。验证：`wrangler d1 migrations apply <db> --local` 成功，本地 D1 可查询表结构
- [x] 1.3 搭建 Hono 应用骨架：路由注册（/sub/:token、/api/*、admin 静态资产兜底）、Env 类型定义、错误处理中间件。验证：本地 `wrangler dev` 启动无报错，GET / 返回占位响应

## 2. 统一节点表示与格式解析

- [x] 2.1 定义 Proxy 统一类型（Clash proxy 字段超集）与类型守卫。验证：类型检查通过，单测覆盖合法/非法节点判定
- [x] 2.2 实现 Clash YAML 解析：yaml 包解析、proxies 数组提取与校验。验证：单测覆盖正常 YAML、缺 proxies、非法节点三类输入
- [x] 2.3 实现 base64 分享链接解析：vmess(JSON)/ss(SIP002 与 legacy userinfo)/trojan/hysteria2 URI → Proxy。验证：单测覆盖每种协议各至少一个真实样例 + 容错样例（缺字段节点跳过不炸整源）
- [x] 2.4 实现格式探测函数：内容 → {format, proxies[]} 或 {error}。验证：单测覆盖 Clash YAML、base64 集合、两者皆非（如 HTML 错误页）三类
- [x] 2.5 实现 Proxy → 分享链接逆向转换（vmess/ss/trojan/hysteria2），不可逆类型跳过并计数。验证：单测断言往返转换（链接 → Proxy → 链接）字段无损

## 3. 聚合与输出

- [x] 3.1 实现聚合管道：多源 Proxy[] → 按源前缀改名（默认用源名）→ 按名去重 → 拼接。验证：单测覆盖前缀改名、跨源同名去重、空源数组
- [x] 3.2 实现默认策略组模板：自动选择 + 按节点名正则的地区分组（HK/TW/JP/SG/US/EU 起步）+ 默认规则集，Proxy[] → 完整 Clash YAML 输出。验证：单测断言输出含 proxies/proxy-groups/rules 三段且组内节点引用有效
- [x] 3.3 实现 base64 输出：Proxy[] → 逐行分享链接 → 整体 base64。验证：单测断言输出可被 2.3 的解析器无损读回

## 4. 缓存与回源层

- [x] 4.1 实现按源的缓存读取/写入封装（KV 键 fc:src:<id>:data / :fetched）。验证：单测（mock KV）覆盖读写与键格式
- [x] 4.2 实现回源决策逻辑：新鲜/过期但节流/需回源三态判定 + 回源 fetch（自定义 UA 支持）+ 失败保留旧缓存 + 成功写 KV 与 D1 last_fetch_*。验证：单测覆盖缓存命中、节流命中、回源成功、回源失败且无缓存（源降级跳过）四条路径
- [x] 4.3 管理端"立即探测"复用同一节流封装。验证：单测证明 MIN_FETCH_INTERVAL 内连续探测不产生第二次回源

## 5. 订阅端点

- [x] 5.1 实现 GET /sub/:token 完整管道：D1 校验（存在/启用/未过期/有绑定源）→ 各源并行取缓存或回源 → 聚合 → last_used_at 异步更新（waitUntil）。验证：集成测试（miniflare/mock D1+KV）覆盖规格 subscription-serving 全部场景：有效 token、不存在(401)、禁用/过期(403)、未绑定源(400)、部分源失败降级
- [x] 5.2 实现 UA 自适应输出、Hiddify UA 优先 base64 兼容、?format= 覆盖与确定性格式路径（/sub/clash/:token → YAML，/sub/base64/:token → base64）。验证：集成测试覆盖真实 Hiddify UA、查询参数、路径优先级与 Content-Type；Hiddify 官方 core 验证 base64 可解析

## 6. 管理 API 与认证

- [x] 6.1 实现签名 cookie 会话：HMAC-SHA256 签发/校验、AUTH_SECRET 缺省回退、登录失败固定延迟。验证：单测覆盖签发→校验往返、篡改 cookie 拒绝、过期拒绝
- [x] 6.2 实现 POST /api/login 与认证中间件（保护全部 /api/*，除 login）。验证：集成测试覆盖登录成功/失败、未认证 401
- [x] 6.3 实现源 CRUD API：创建（可选立即探测）、更新（改 URL 清缓存）、删除（含绑定与缓存清理）、列表（含健康状态与绑定 token 数）。验证：集成测试覆盖规格 admin-management「源订阅管理」全部场景
- [x] 6.4 实现 token CRUD API：创建（随机 43 字符 token + 可选过期 + 源绑定）、禁用/启用、删除、列表（含绑定与 last_used_at）、修改绑定。验证：集成测试覆盖规格「Token 生命周期管理」全部场景

## 7. 管理页 SPA

- [x] 7.1 实现登录页与认证状态管理（401 统一引导回登录）。验证：手动验证规格 admin-ui「登录界面」三场景
- [x] 7.2 实现源管理页：列表（名称/格式/健康/绑定数）、新建（含探测结果展示）、编辑、删除二次确认。验证：手动对照规格「源管理界面」场景
- [x] 7.3 实现 token 管理页：列表（名称/状态/绑定/最后使用）、创建（勾选源 + 过期时间）、分别复制 Clash/Base64/自动识别 URL、禁用/启用、删除二次确认、修改绑定。验证：手动对照规格「Token 管理界面」场景

## 8. 部署与验收

- [x] 8.1 部署脚本与文档：README 补充 D1/KV 创建、secrets 写入（ADMIN_PASSWORD/AUTH_SECRET）、migrations、deploy 完整步骤。验证：按文档从零走通部署
- [x] 8.2 端到端验收：部署后用真实 Clash 客户端 UA 与 curl 分别访问订阅 URL，验证两种格式输出；用管理页完成 源创建→探测→token 创建→绑定→订阅访问→禁用→访问被拒 全链路。验证：全链路通过并记录于本任务
  - 本地全链路（wrangler dev + 本地 mock 上游）2026-08-26 通过：登录✓ 源创建+探测（clash/base64 双格式）✓ token 创建+双源绑定✓ Clash UA→YAML（节点带前缀、地区分组、规则集）✓ 其他 UA→base64✓ 禁用→403✓ last_used_at 记录✓；期间修复两个仅真实 runtime 暴露的 bug（fetch 解构 Illegal invocation、D1 batch 中 last_insert_rowid 不可靠）
  - 生产验收（<https://<your-worker>.workers.dev）2026-08-26> 通过：部署（wrangler 4.126）✓ 远端 migration✓ /admin/ 静态资产✓ 未认证 /api/* 401✓ 不存在 token 401✓ 公网 mock 源（paste.rs）真实回源探测✓ Clash UA→YAML（3 策略组+7 规则）✓ base64 UA→链接列表✓ KV 缓存命中（last_fetch_at 不变验证）+ KV 键写入（--remote 查询验证）✓ last_used_at✓ 禁用→立即 403✓ 验收后清理全部测试数据✓
  - 剩余可选：用户用真实机场订阅在浏览器 UI（/admin/）做最终使用体验确认

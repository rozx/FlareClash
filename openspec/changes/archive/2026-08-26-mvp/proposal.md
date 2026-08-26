# MVP: Clash 订阅转发服务

## Why

把机场/自建订阅藏在自己控制的门禁后面：撤销权留在管理员手里，而不是把上游 URL 原样散播给朋友。同时把多个订阅聚合成一个统一出口，朋友只需要在客户端里填一个固定地址。全部运行在 Cloudflare 免费额度内，零成本长期运行。

## What Changes

这是全新项目的初始交付，包含：

- 订阅转发端点 `/sub/:token`：凭 access token 访问，校验通过后聚合该 token 关联的所有源订阅并返回
- 源订阅管理：管理员增删改查上游订阅（Clash YAML 与 v2ray base64 两种格式），带格式探测
- 聚合管道：解析多种上游格式为统一节点表示，按源加前缀改名去重后合并
- 按 User-Agent 自适应输出：Clash 客户端收到完整 Clash YAML（含默认策略组模板与地区分组），其他客户端收到 base64 分享链接列表
- Access token 管理：创建/禁用/删除 token，可选过期时间，记录最后使用时间；token 与源为多对多关联（一个 token 可绑定多个源）
- 源内容与订阅用量元数据缓存：KV 缓存上游正文及 `subscription-userinfo` / 更新间隔，带 TTL 与回源节流，保护免费额度
- 管理后台 `/admin`：单管理员密码登录（环境变量），签名 cookie 会话，SPA 管理页面（源管理、token 管理、状态查看）

## Capabilities

### New Capabilities

- `subscription-serving`: 面向用户的核心端点——token 校验、多源聚合、UA 自适应输出、缓存与回源节流
- `admin-management`: 管理员认证、源订阅 CRUD、token 生命周期管理（含源绑定）、格式探测
- `admin-ui`: 管理后台页面——登录、源/token 管理界面、源健康状态展示

### Modified Capabilities

（无——全新项目，无既有规格）

## Impact

- **新建全部代码**：Worker（Hono + TypeScript）、D1 schema（sources / tokens / token_sources）、KV 键设计、管理页 SPA（静态资产）
- **Cloudflare 资源**：Workers（免费档）、D1、KV、Static Assets——全部免费计划内
- **关键额度约束**：KV 写 1000 次/天是唯一紧约束，回源节流设计必须将写入上限锁死在该额度内
- **部署形态**：单个 Worker + wrangler.toml，含 D1/KV 绑定与 ADMIN_PASSWORD 环境变量

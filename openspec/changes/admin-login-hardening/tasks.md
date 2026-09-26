# 任务

- [x] 回归测试先红：单 IP 锁定、IPv6 /64、锁定翻倍、成功清零、并发爆破、全局锁不影响会话、弱配置提示、畸形 cookie
- [x] migration `0004_login_attempts.sql` + 测试 schema 同步
- [x] `src/lib/login-throttle.ts` 纯函数（IP 归一化、锁定时长）+ 单测
- [x] `repo.ts` login_attempts 读锁 / 预占 / 施锁 / 成功清理
- [x] `/api/login` 编排：读锁 → 预占 → 比对（timingSafeEqual）→ 施锁 / 清零
- [x] `verifySession` 畸形 cookie 返回 false
- [x] `/api/_ping` 返回 `warnings`；管理页警告条 + 429 等待提示
- [x] README 部署说明：迁移、紧急解锁、可选 Cloudflare Access
- [x] 全量验证：typecheck、test、dry-run、`openspec validate admin-login-hardening --strict`

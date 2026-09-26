# 设计说明

## 为什么存 D1 而不是 KV / Rate Limiting binding / Turnstile

- **KV**：1000 写/天是全项目唯一紧约束。失败计数由攻击者驱动写入，放 KV 等于把额度交给攻击者，订阅缓存会被连带打挂。
- **Workers Rate Limiting binding**：计数按 Cloudflare 机房独立、窗口只有 10s/60s，做不了「15 分钟 5 次」「锁 24 小时」这类长窗口锁定。
- **Turnstile**：有效但要额外密钥对 + 前端脚本，对单管理员后台而言锁定已足够；可作为后续增强。
- **D1**：免费 10 万写/天、500 万读/天；锁定期内只读不写，全局锁把攻击引发的写入压到约每小时 150 行。

更强的零代码方案是给 `/admin/*`、`/api/*` 套 Cloudflare Access，写入 README 作为可选加固，与本改动叠加。

## 数据模型

```sql
CREATE TABLE login_attempts (
  key TEXT PRIMARY KEY,          -- 'ip:<addr 或 v6 /64>' | 'global'
  attempts INTEGER NOT NULL,     -- 当前窗口已预占的尝试数（成功时回退）
  window_start INTEGER NOT NULL, -- 窗口起点 epoch ms
  locked_until INTEGER NOT NULL, -- 锁定截止 epoch ms，0 = 未锁
  lockouts INTEGER NOT NULL      -- 已触发锁定次数（翻倍级数）
);
```

## 登录流程（先预占、后比对）

1. **读锁**：`SELECT … WHERE key IN (ip, 'global')`。任一 `locked_until > now` → 429 + `Retry-After`，结束（零写）。
2. **预占**：batch 内对两个键各执行一次 UPSERT … RETURNING：窗口过期则 `attempts = 1` 并重置窗口，否则 `attempts + 1`；距 `MAX(window_start, locked_until)` 已空闲 24h 则 `lockouts = 0`。SQLite UPDATE 的 SET 右值全部引用旧行值，单语句原子。
3. **超额**：任一键返回的 `attempts > max` → 施加锁定（见下），429，不比对密码。并发突发下只有前 `max` 个请求拿到比对资格。
4. **比对**：SHA-256(输入) 与 SHA-256(ADMIN_PASSWORD) 做 `crypto.subtle.timingSafeEqual`。
5. **失败**：若某键 `attempts == max` → 施加锁定；返回 401（保留 300ms 延迟）。
6. **成功**：删除 IP 行；全局 `attempts - 1`（全局只统计失败）；顺手清理空闲超 24h 的陈旧行；签发会话。

施加锁定：

```sql
UPDATE login_attempts
SET lockouts = lockouts + 1,
    locked_until = :now + MIN(:base * (1 << MIN(lockouts, 10)), :max),
    attempts = 0, window_start = :now
WHERE key = :key AND locked_until <= :now
```

`WHERE locked_until <= now` 保证并发下只锁一次，不会连续翻倍。全局策略 `base = max = 1h`，即不翻倍。

## 客户端标识

- 取 `CF-Connecting-IP`（Cloudflare 边缘注入，客户端无法伪造）；缺失（本地 dev / 测试）归为 `ip:unknown`
- IPv6 展开 `::` 后取前 4 组（/64）：运营商通常整段下发 /64，按单地址计数形同虚设
- `::ffff:a.b.c.d` 映射地址按 IPv4 处理

## 配置强度提示为何不阻断

存量部署可能用短密码或未设 `AUTH_SECRET`，升级后直接 503 会把管理员锁在门外且只能改 secret 恢复。改为 `/_ping` 返回 `warnings`、管理页顶部常驻警告条，行为零破坏。

## 纯函数与 I/O 的切分

- `src/lib/login-throttle.ts`：策略常量、IP 归一化、锁定时长计算、Retry-After 计算——纯函数，单测覆盖
- `src/repo.ts`：`login_attempts` 的读锁 / 预占 / 施锁 / 成功清理 SQL（保持「repo 是唯一 D1 出口」）
- `src/routes/api.ts`：编排流程

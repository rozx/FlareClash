# 管理员登录防爆破

## Why

`POST /api/login` 目前只有失败后固定 300ms 延迟：攻击者并发发请求即可无视延迟，且无失败计数、无锁定，可无限次猜密码。密码比较用 `!==`，存在时序侧信道；弱密码 / 缺 `AUTH_SECRET` 也无任何提示。另外畸形会话 cookie 会让 `atob` 抛错返回 500。

## What Changes

- 新增 D1 表 `login_attempts`，按「客户端 IP（IPv6 取 /64）」与「全局」两级计数登录尝试：
  - 单 IP：15 分钟内 5 次失败 → 锁定 15 分钟，重复触发逐次翻倍，上限 24 小时；空闲 24 小时后翻倍级数清零
  - 全局：1 小时内 50 次失败 → 暂停密码登录 1 小时（已登录会话不受影响）
- 尝试额度**先预占后比对**（原子 UPSERT … RETURNING），并发请求无法越过计数上限
- 锁定期内请求直接 429 + `Retry-After`，不比对密码、不写 D1
- 密码比较改为 SHA-256 摘要后 `timingSafeEqual`
- `/api/_ping` 返回 `warnings`：`ADMIN_PASSWORD` 少于 16 位、未设置 `AUTH_SECRET` 时提示；管理页顶部展示警告条（仅提示，不阻断登录，避免存量部署升级后被锁在门外）
- 管理页登录遇 429 显示剩余等待时间
- 修复畸形会话 cookie 导致 500

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `admin-management`：「管理员认证」增补登录限流、锁定、常量时间比较与配置强度提示

## Impact

- 新 migration `0004_login_attempts.sql`，部署前需 `db:migrate:remote`
- 不使用 KV：失败计数若写 KV，攻击者可耗尽 1000 写/天额度拖垮订阅缓存；D1 免费额度（10 万写/天）充裕，且全局锁把攻击引发的写入上限压到约每小时 150 行
- 全局锁是可被利用的「登录 DoS」：攻击者可让管理员 1 小时内无法用密码登录；已有会话（7 天）照常可用，紧急时可 `wrangler d1 execute flareclash --remote --command "DELETE FROM login_attempts"` 解锁

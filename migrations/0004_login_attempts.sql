-- 登录尝试计数（防爆破）：key = 'ip:<addr 或 v6 /64>' | 'global'，时间列 epoch ms。
CREATE TABLE IF NOT EXISTS login_attempts (
    key TEXT PRIMARY KEY,
    attempts INTEGER NOT NULL DEFAULT 0,
    window_start INTEGER NOT NULL,
    locked_until INTEGER NOT NULL DEFAULT 0,
    lockouts INTEGER NOT NULL DEFAULT 0
);

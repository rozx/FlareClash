-- 仅保存网站覆盖；默认规则随 Worker 从本地 JSON 打包。
CREATE TABLE IF NOT EXISTS routing_config (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    content TEXT NOT NULL
);

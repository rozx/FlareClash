-- FlareClash 初始 schema：sources / tokens / token_sources
-- 详见 design.md D2

CREATE TABLE sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  prefix TEXT,                          -- 节点名前缀；NULL 时用 name
  format TEXT,                          -- 'clash' | 'base64'；NULL = 未探测
  cache_ttl INTEGER NOT NULL DEFAULT 1800,
  last_fetch_at INTEGER,                -- epoch ms；NULL = 从未回源
  last_fetch_status TEXT,               -- 'ok' | 'error'；NULL = 从未回源
  last_fetch_error TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token TEXT NOT NULL UNIQUE,           -- 43 字符 base64url（crypto.getRandomValues 32B）
  name TEXT NOT NULL DEFAULT '',
  enabled INTEGER NOT NULL DEFAULT 1,
  expires_at INTEGER,                   -- epoch ms；NULL = 永不过期
  last_used_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE TABLE token_sources (
  token_id INTEGER NOT NULL REFERENCES tokens(id) ON DELETE CASCADE,
  source_id INTEGER NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  PRIMARY KEY (token_id, source_id)
);

CREATE INDEX idx_tokens_token ON tokens(token);
CREATE INDEX idx_sources_url ON sources(url);

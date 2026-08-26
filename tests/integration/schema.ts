import { env } from "cloudflare:test";

/**
 * 测试用 schema：与 migrations/0001_init.sql 保持一致。
 * 注意：D1 exec() 对语句内 `--` 注释解析有缺陷，此处必须无注释。
 * migrations 目录由 wrangler 管理（生产/本地 dev），
 * 集成测试通过 ensureSchema() 直接应用本文件。
 */
export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  prefix TEXT,
  format TEXT,
  cache_ttl INTEGER NOT NULL DEFAULT 1800,
  last_fetch_at INTEGER,
  last_fetch_status TEXT,
  last_fetch_error TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL DEFAULT '',
  enabled INTEGER NOT NULL DEFAULT 1,
  expires_at INTEGER,
  last_used_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS token_sources (
  token_id INTEGER NOT NULL REFERENCES tokens(id) ON DELETE CASCADE,
  source_id INTEGER NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  PRIMARY KEY (token_id, source_id)
);

CREATE INDEX IF NOT EXISTS idx_tokens_token ON tokens(token);
CREATE INDEX IF NOT EXISTS idx_sources_url ON sources(url);
`;

/** 重置库（建表 + 清空三表），每个集成测试文件在 beforeAll 调用。
 * 注：workerd 的 D1 exec() 对多语句脚本切分有缺陷（截断于嵌套括号处），
 * 故自行切分后用 batch() 执行。 */
export async function ensureSchema(): Promise<void> {
 const stmts = splitSqlStatements(SCHEMA_SQL);
 await env.DB.batch(stmts.map((sql) => env.DB.prepare(sql)));
 await env.DB.batch(
  splitSqlStatements(
   "DELETE FROM token_sources; DELETE FROM tokens; DELETE FROM sources;" +
    " DELETE FROM sqlite_sequence WHERE name IN ('sources','tokens');",
  ).map((sql) => env.DB.prepare(sql)),
 );
}

/** 按 `;` 切分 SQL 脚本并去掉空片段。 */
export function splitSqlStatements(sql: string): string[] {
 return sql
  .split(";")
  .map((s) => s.trim())
  .filter((s) => s.length > 0);
}

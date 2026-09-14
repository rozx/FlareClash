/**
 * D1 数据访问层。INTEGER 时间列统一使用 epoch ms。
 */

export interface TokenRow {
  id: number;
  token: string;
  name: string;
  enabled: number;
  expires_at: number | null;
  last_used_at: number | null;
  created_at: number;
}

export interface SourceRow {
  id: number;
  name: string;
  /** 源类型：'fetch'（URL 回源）| 'static'（手动节点，内容在 content） */
  kind: "fetch" | "static";
  url: string;
  /** static 源的节点内容（分享链接文本，每行一条）；fetch 源为 null */
  content: string | null;
  prefix: string | null;
  format: string | null;
  cache_ttl: number;
  last_fetch_at: number | null;
  last_fetch_status: string | null;
  last_fetch_error: string | null;
  created_at: number;
}

/** 查询 token 及其绑定的源（两段查询；token 不存在返回 null）。 */
export async function getSourcesForToken(
  db: D1Database,
  token: string,
): Promise<{ token: TokenRow; sources: SourceRow[] } | null> {
  const t = await db
    .prepare("SELECT * FROM tokens WHERE token = ?")
    .bind(token)
    .first<TokenRow>();
  if (!t) return null;
  const sources = await db
    .prepare(
      `SELECT s.* FROM token_sources ts
       JOIN sources s ON s.id = ts.source_id
       WHERE ts.token_id = ? ORDER BY ts.source_id`,
    )
    .bind(t.id)
    .all<SourceRow>();
  return { token: t, sources: sources.results };
}

/** 记录 token 最后使用时间（订阅请求异步调用）。 */
export function touchTokenUsed(db: D1Database, tokenId: number): Promise<void> {
  return db
    .prepare("UPDATE tokens SET last_used_at = ? WHERE id = ?")
    .bind(Date.now(), tokenId)
    .run()
    .then(() => undefined);
}

/** 更新源健康状态（回源尝试后异步调用）。 */
export function updateSourceFetchStatus(
  db: D1Database,
  sourceId: number,
  status: "ok" | "error",
  error?: string,
): Promise<void> {
  return db
    .prepare(
      "UPDATE sources SET last_fetch_at = ?, last_fetch_status = ?, last_fetch_error = ? WHERE id = ?",
    )
    .bind(
      Date.now(),
      status,
      status === "ok" ? null : (error ?? "unknown"),
      sourceId,
    )
    .run()
    .then(() => undefined);
}

// ── 管理 API 仓储 ─────────────────────────────────────

export interface SourceListRow extends SourceRow {
  token_count: number;
}

export async function listSources(db: D1Database): Promise<SourceListRow[]> {
  const r = await db
    .prepare(
      `SELECT s.*, (SELECT COUNT(*) FROM token_sources ts WHERE ts.source_id = s.id) AS token_count
       FROM sources s ORDER BY s.id`,
    )
    .all<SourceListRow>();
  return r.results;
}

/** URL 去重查询；排除编辑中的源，所有 D1 查询集中在仓储层。 */
export async function findSourceByUrl(
  db: D1Database,
  url: string,
  excludeId = 0,
): Promise<{ id: number } | null> {
  return db
    .prepare(
      "SELECT id FROM sources WHERE kind = 'fetch' AND url = ? AND id != ?",
    )
    .bind(url, excludeId)
    .first<{ id: number }>();
}

export async function createSource(
  db: D1Database,
  data: {
    name: string;
    url: string;
    prefix: string | null;
    cacheTtl: number;
    kind?: "fetch" | "static";
    content?: string | null;
  },
): Promise<SourceRow> {
  const now = Date.now();
  const result = await db
    .prepare(
      "INSERT INTO sources (name, kind, url, content, prefix, cache_ttl, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(
      data.name,
      data.kind ?? "fetch",
      data.url,
      data.content ?? null,
      data.prefix,
      data.cacheTtl,
      now,
    )
    .run();
  const row = await db
    .prepare("SELECT * FROM sources WHERE id = ?")
    .bind(result.meta.last_row_id)
    .first<SourceRow>();
  return row!;
}

export async function getSource(
  db: D1Database,
  id: number,
): Promise<SourceRow | null> {
  return db
    .prepare("SELECT * FROM sources WHERE id = ?")
    .bind(id)
    .first<SourceRow>();
}

export async function updateSource(
  db: D1Database,
  id: number,
  fields: {
    name?: string;
    url?: string;
    prefix?: string | null;
    cacheTtl?: number;
    content?: string | null;
    kind?: "fetch" | "static";
  },
): Promise<SourceRow | null> {
  const sets: string[] = [];
  const binds: unknown[] = [];
  if (fields.name !== undefined) {
    sets.push("name = ?");
    binds.push(fields.name);
  }
  if (fields.url !== undefined) {
    sets.push("url = ?");
    binds.push(fields.url);
  }
  if (fields.prefix !== undefined) {
    sets.push("prefix = ?");
    binds.push(fields.prefix);
  }
  if (fields.cacheTtl !== undefined) {
    sets.push("cache_ttl = ?");
    binds.push(fields.cacheTtl);
  }
  if (fields.content !== undefined) {
    // static 源改内容即时生效，无需缓存失效（static 不走 KV 缓存）
    sets.push("content = ?");
    binds.push(fields.content);
  }
  if (fields.kind !== undefined) {
    sets.push("kind = ?");
    binds.push(fields.kind);
  }
  if (
    fields.url !== undefined ||
    fields.content !== undefined ||
    fields.kind !== undefined
  ) {
    sets.push(
      "last_fetch_at = NULL, last_fetch_status = NULL, last_fetch_error = NULL, format = NULL",
    );
  }
  if (sets.length === 0) return getSource(db, id);
  await db
    .prepare(`UPDATE sources SET ${sets.join(", ")} WHERE id = ?`)
    .bind(...binds, id)
    .run();
  return getSource(db, id);
}

export async function deleteSource(
  db: D1Database,
  sourceId: number,
): Promise<void> {
  await db.batch([
    db.prepare("DELETE FROM token_sources WHERE source_id = ?").bind(sourceId),
    db.prepare("DELETE FROM sources WHERE id = ?").bind(sourceId),
  ]);
}

export async function setSourceFormat(
  db: D1Database,
  sourceId: number,
  format: string,
): Promise<void> {
  await db
    .prepare("UPDATE sources SET format = ? WHERE id = ?")
    .bind(format, sourceId)
    .run();
}

export interface TokenListRow extends TokenRow {
  source_ids: number[];
}

export async function listTokens(db: D1Database): Promise<TokenListRow[]> {
  const tokens = await db
    .prepare("SELECT * FROM tokens ORDER BY id")
    .all<TokenRow>();
  const bindings = await db
    .prepare(
      "SELECT token_id, source_id FROM token_sources ORDER BY token_id, source_id",
    )
    .all<{ token_id: number; source_id: number }>();
  const byToken = new Map<number, number[]>();
  for (const b of bindings.results) {
    const arr = byToken.get(b.token_id) ?? [];
    arr.push(b.source_id);
    byToken.set(b.token_id, arr);
  }
  return tokens.results.map((t) => ({
    ...t,
    source_ids: byToken.get(t.id) ?? [],
  }));
}

export async function createToken(
  db: D1Database,
  data: {
    token: string;
    name: string;
    expiresAt: number | null;
    sourceIds: number[];
  },
): Promise<TokenRow> {
  const now = Date.now();
  // 显式取 last_row_id：workerd 的 D1 batch 中 last_insert_rowid() 语义不可靠（E2E 发现）
  const r = await db
    .prepare(
      "INSERT INTO tokens (token, name, enabled, expires_at, created_at) VALUES (?, ?, 1, ?, ?)",
    )
    .bind(data.token, data.name, data.expiresAt, now)
    .run();
  const tokenId = Number(r.meta.last_row_id);
  if (data.sourceIds.length > 0) {
    await db.batch(
      data.sourceIds.map((sid) =>
        db
          .prepare(
            "INSERT INTO token_sources (token_id, source_id) VALUES (?, ?)",
          )
          .bind(tokenId, sid),
      ),
    );
  }
  const row = await db
    .prepare("SELECT * FROM tokens WHERE token = ?")
    .bind(data.token)
    .first<TokenRow>();
  return row!;
}

export async function updateToken(
  db: D1Database,
  id: number,
  fields: { name?: string; enabled?: boolean; expiresAt?: number | null },
): Promise<TokenRow | null> {
  const sets: string[] = [];
  const binds: unknown[] = [];
  if (fields.name !== undefined) {
    sets.push("name = ?");
    binds.push(fields.name);
  }
  if (fields.enabled !== undefined) {
    sets.push("enabled = ?");
    binds.push(fields.enabled ? 1 : 0);
  }
  if (fields.expiresAt !== undefined) {
    sets.push("expires_at = ?");
    binds.push(fields.expiresAt);
  }
  if (sets.length === 0) {
    return db
      .prepare("SELECT * FROM tokens WHERE id = ?")
      .bind(id)
      .first<TokenRow>();
  }
  await db
    .prepare(`UPDATE tokens SET ${sets.join(", ")} WHERE id = ?`)
    .bind(...binds, id)
    .run();
  return db
    .prepare("SELECT * FROM tokens WHERE id = ?")
    .bind(id)
    .first<TokenRow>();
}

export async function setTokenSources(
  db: D1Database,
  tokenId: number,
  sourceIds: number[],
): Promise<void> {
  await db.batch([
    db.prepare("DELETE FROM token_sources WHERE token_id = ?").bind(tokenId),
    ...sourceIds.map((sid) =>
      db
        .prepare(
          "INSERT INTO token_sources (token_id, source_id) VALUES (?, ?)",
        )
        .bind(tokenId, sid),
    ),
  ]);
}

export async function deleteToken(
  db: D1Database,
  tokenId: number,
): Promise<void> {
  await db.batch([
    db.prepare("DELETE FROM token_sources WHERE token_id = ?").bind(tokenId),
    db.prepare("DELETE FROM tokens WHERE id = ?").bind(tokenId),
  ]);
}

export async function getToken(
  db: D1Database,
  id: number,
): Promise<TokenRow | null> {
  return db
    .prepare("SELECT * FROM tokens WHERE id = ?")
    .bind(id)
    .first<TokenRow>();
}

/** 校验 sourceIds 均存在，返回实际存在的 id 集合。 */
export async function existingSourceIds(
  db: D1Database,
  ids: number[],
): Promise<Set<number>> {
  if (ids.length === 0) return new Set();
  const placeholders = ids.map(() => "?").join(",");
  const r = await db
    .prepare(`SELECT id FROM sources WHERE id IN (${placeholders})`)
    .bind(...ids)
    .all<{ id: number }>();
  return new Set(r.results.map((x) => x.id));
}

import { Hono } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import {
  loginDelay,
  SESSION_COOKIE,
  signSession,
  verifySession,
} from "../auth";
import { probeSource, type FetcherDeps } from "../cache/fetcher";
import { clearSourceCache, readSourceCache } from "../cache/kv";
import { numVar, type Env } from "../env";
import {
  createSource,
  createToken,
  deleteSource,
  deleteToken,
  existingSourceIds,
  getSource,
  getToken,
  listSources,
  listTokens,
  setSourceFormat,
  setTokenSources,
  updateSource,
  updateSourceFetchStatus,
  updateToken,
  type SourceRow,
} from "../repo";

const api = new Hono<{ Bindings: Env }>();

// 部署时由 scripts/version.js 包装 wrangler --define 注入 git commit hash
// （见 package.json deploy/dev/dry-run 脚本，无 .git 时注入 "dev"）；
// 本地 vitest / 未注入时标识符不存在，typeof 守卫回退 "dev"
declare const COMMIT_HASH: string | undefined;

/** 认证中间件：保护除 /login 外的全部 /api/*（规格 admin-management「管理员认证」） */
api.use("*", async (c, next) => {
  if (c.req.path === "/api/login") return next();
  const ok = await verifySession(getCookie(c, SESSION_COOKIE), {
    authSecret: c.env.AUTH_SECRET,
    adminPassword: c.env.ADMIN_PASSWORD,
  });
  if (!ok) return c.json({ error: "unauthorized" }, 401);
  return next();
});

// 登录态探测：管理页启动/登录后探测会话，顺带返回部署版本供页脚展示
api.get("/_ping", (c) =>
  c.json({
    ok: true,
    version: typeof COMMIT_HASH === "undefined" ? "dev" : COMMIT_HASH,
  }),
);

// ── 认证 ─────────────────────────────────────────────

api.post("/login", async (c) => {
  const body =
    (await c.req.json<{ password?: string }>().catch(() => null)) ?? {};
  if (
    typeof body.password !== "string" ||
    body.password !== c.env.ADMIN_PASSWORD
  ) {
    await loginDelay();
    return c.json({ error: "invalid credentials" }, 401);
  }
  const session = await signSession({
    authSecret: c.env.AUTH_SECRET,
    adminPassword: c.env.ADMIN_PASSWORD,
  });
  setCookie(c, SESSION_COOKIE, session, {
    httpOnly: true,
    sameSite: "Lax",
    secure: true,
    path: "/",
    maxAge: 7 * 24 * 3600,
  });
  return c.json({ ok: true });
});

api.post("/logout", (c) => {
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
  return c.json({ ok: true });
});

// ── 源管理 ───────────────────────────────────────────

function fetcherDeps(env: Env): FetcherDeps {
  return {
    kv: env.KV,
    fetchFn: fetch.bind(globalThis), // workerd 原生 fetch 不可解构调用（Illegal invocation）
    now: () => Date.now(),
    minFetchIntervalSec: numVar(env.MIN_FETCH_INTERVAL, 900),
    fetchTimeoutMs: numVar(env.FETCH_TIMEOUT_MS, 10_000),
    userAgent: env.FETCH_USER_AGENT || "clash-verge/v1.7.7",
    onStatus: async () => {}, // 状态由探测结果统一写库，见 route 内
  };
}

/** 源探测：复用订阅端同一节流封装（规格：节流内不二次回源）。 */
async function probeAndRecord(env: Env, src: SourceRow) {
  const probe = await probeSource(fetcherDeps(env), {
    id: src.id,
    url: src.url,
    cacheTtl: src.cache_ttl,
  });
  await updateSourceFetchStatus(
    env.DB,
    src.id,
    probe.ok ? "ok" : "error",
    probe.error,
  );
  if (probe.ok && probe.format) {
    await setSourceFormat(env.DB, src.id, probe.format);
  }
  return probe;
}

api.get("/sources", async (c) => {
  const sources = await listSources(c.env.DB);
  const withMetadata = await Promise.all(
    sources.map(async (source) => {
      const cache = await readSourceCache(c.env.KV, source.id);
      return {
        ...source,
        subscription_meta: cache?.metadata ?? null,
      };
    }),
  );
  return c.json({ sources: withMetadata });
});

api.post("/sources", async (c) => {
  const body =
    (await c.req
      .json<{
        name?: string;
        url?: string;
        prefix?: string;
        cacheTtl?: number;
        probe?: boolean;
      }>()
      .catch(() => null)) ?? {};
  if (typeof body.name !== "string" || !body.name.trim()) {
    return c.json({ error: "name 必填" }, 400);
  }
  if (typeof body.url !== "string" || !/^https?:\/\//.test(body.url.trim())) {
    return c.json({ error: "url 必须是 http(s) 地址" }, 400);
  }
  const url = body.url.trim();
  const dup = await c.env.DB.prepare("SELECT id FROM sources WHERE url = ?")
    .bind(url)
    .first();
  if (dup) {
    return c.json({ error: "该 URL 已存在（源 id " + dup.id + "）" }, 409);
  }

  let src = await createSource(c.env.DB, {
    name: body.name.trim(),
    url,
    prefix: body.prefix?.trim() || null,
    cacheTtl: numVar(String(body.cacheTtl ?? 1800), 1800),
  });

  let probe = null;
  if (body.probe !== false) {
    probe = await probeAndRecord(c.env, src);
    src = (await getSource(c.env.DB, src.id)) ?? src; // 重新取行以反映探测写入的 format/状态
  }
  return c.json({ source: src, probe }, 201);
});

api.get("/sources/:id", async (c) => {
  const src = await getSource(c.env.DB, Number(c.req.param("id")));
  if (!src) return c.json({ error: "not found" }, 404);
  return c.json({ source: src });
});

api.patch("/sources/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const src = await getSource(c.env.DB, id);
  if (!src) return c.json({ error: "not found" }, 404);
  const body =
    (await c.req
      .json<{
        name?: string;
        url?: string;
        prefix?: string | null;
        cacheTtl?: number;
      }>()
      .catch(() => null)) ?? {};

  const urlChanged =
    typeof body.url === "string" && body.url.trim() !== src.url;
  const updated = await updateSource(c.env.DB, id, {
    name:
      typeof body.name === "string" && body.name.trim()
        ? body.name.trim()
        : undefined,
    url: urlChanged ? body.url!.trim() : undefined,
    prefix:
      body.prefix === undefined
        ? undefined
        : body.prefix === null
          ? null
          : body.prefix.trim() || null,
    cacheTtl:
      body.cacheTtl === undefined
        ? undefined
        : numVar(String(body.cacheTtl), 1800),
  });
  if (urlChanged) {
    await clearSourceCache(c.env.KV, id); // 规格：改 URL 清缓存
  }
  return c.json({ source: updated });
});

api.delete("/sources/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const src = await getSource(c.env.DB, id);
  if (!src) return c.json({ error: "not found" }, 404);
  await deleteSource(c.env.DB, id); // 级联删绑定
  await clearSourceCache(c.env.KV, id); // 级联清缓存
  return c.json({ ok: true });
});

api.post("/sources/:id/probe", async (c) => {
  const id = Number(c.req.param("id"));
  const src = await getSource(c.env.DB, id);
  if (!src) return c.json({ error: "not found" }, 404);
  const probe = await probeAndRecord(c.env, src);
  return c.json({ probe });
});

// ── token 管理 ───────────────────────────────────────

/** 43 字符 base64url（32 字节随机，design.md D7）。 */
function generateTokenValue(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function parseExpiresAt(v: unknown): number | null | "invalid" {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number" && Number.isFinite(v) && v > 0) return v;
  if (typeof v === "string") {
    const t = Date.parse(v);
    if (!Number.isNaN(t)) return t;
  }
  return "invalid";
}

api.get("/tokens", async (c) => {
  return c.json({ tokens: await listTokens(c.env.DB) });
});

api.post("/tokens", async (c) => {
  const body =
    (await c.req
      .json<{ name?: string; expiresAt?: unknown; sourceIds?: unknown }>()
      .catch(() => null)) ?? {};
  const expiresAt = parseExpiresAt(body.expiresAt);
  if (expiresAt === "invalid") {
    return c.json({ error: "expiresAt 必须是未来时间戳或 ISO 日期" }, 400);
  }
  const sourceIds = Array.isArray(body.sourceIds)
    ? body.sourceIds.filter((x): x is number => Number.isInteger(x))
    : [];
  if (sourceIds.length !== new Set(sourceIds).size) {
    return c.json({ error: "sourceIds 含重复项" }, 400);
  }
  const existing = await existingSourceIds(c.env.DB, sourceIds);
  if (existing.size !== sourceIds.length) {
    return c.json({ error: "sourceIds 含不存在的源" }, 400);
  }

  const t = await createToken(c.env.DB, {
    token: generateTokenValue(),
    name: typeof body.name === "string" ? body.name.trim() : "",
    expiresAt,
    sourceIds,
  });
  return c.json({ token: t }, 201);
});

api.patch("/tokens/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const t = await getToken(c.env.DB, id);
  if (!t) return c.json({ error: "not found" }, 404);
  const body =
    (await c.req
      .json<{
        name?: string;
        enabled?: boolean;
        expiresAt?: unknown;
        sourceIds?: unknown;
      }>()
      .catch(() => null)) ?? {};

  let expiresAt: number | null | undefined;
  if (body.expiresAt !== undefined) {
    const parsed = parseExpiresAt(body.expiresAt);
    if (parsed === "invalid") {
      return c.json({ error: "expiresAt 格式非法" }, 400);
    }
    expiresAt = parsed;
  }

  const updated = await updateToken(c.env.DB, id, {
    name: typeof body.name === "string" ? body.name.trim() : undefined,
    enabled: typeof body.enabled === "boolean" ? body.enabled : undefined,
    expiresAt,
  });

  if (Array.isArray(body.sourceIds)) {
    const ids = body.sourceIds.filter((x): x is number => Number.isInteger(x));
    const existing = await existingSourceIds(c.env.DB, ids);
    if (existing.size !== ids.length) {
      return c.json({ error: "sourceIds 含不存在的源" }, 400);
    }
    await setTokenSources(c.env.DB, id, ids);
  }

  const fresh = await listTokens(c.env.DB);
  return c.json({ token: fresh.find((x) => x.id === id) ?? updated });
});

api.delete("/tokens/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const t = await getToken(c.env.DB, id);
  if (!t) return c.json({ error: "not found" }, 404);
  await deleteToken(c.env.DB, id);
  return c.json({ ok: true });
});

export default api;

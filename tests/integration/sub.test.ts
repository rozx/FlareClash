import {
  createExecutionContext,
  env,
  reset,
  waitOnExecutionContext,
} from "cloudflare:test";
import { beforeEach, describe, expect, it, vi } from "vitest";
import app from "../../src/index";
import { ensureSchema } from "./schema";
import { installUpstreamMock, type UpstreamMock } from "./mock-upstream";

const UPSTREAM_A = [
  "ss://YWVzLTEyOC1nY206cGFzc3dvcmQ=@a1.example.com:8388#香港01",
  "ss://YWVzLTEyOC1nY206cGFzc3dvcmQ=@a2.example.com:8388#日本01",
  "trojan://pw@a3.example.com:443#美国01",
].join("\n");

const UPSTREAM_B = "trojan://pw@b1.example.com:443#台湾01";

const TOKEN = "test-token-123";

async function seed(opts?: {
  enabled?: number;
  expiresAt?: number | null;
  withSources?: boolean;
}) {
  const now = Date.now();
  await env.DB.prepare(
    "INSERT INTO tokens (token, name, enabled, expires_at, created_at) VALUES (?, ?, ?, ?, ?)",
  )
    .bind(TOKEN, "测试", opts?.enabled ?? 1, opts?.expiresAt ?? null, now)
    .run();
  if (opts?.withSources === false) return;
  await env.DB.prepare(
    "INSERT INTO sources (name, url, prefix, cache_ttl, created_at) VALUES (?, ?, ?, ?, ?)",
  )
    .bind("源A", "https://a.example.com/sub", "A", 1800, now)
    .run();
  await env.DB.prepare(
    "INSERT INTO sources (name, url, prefix, cache_ttl, created_at) VALUES (?, ?, ?, ?, ?)",
  )
    .bind("源B", "https://b.example.com/sub", null, 1800, now)
    .run();
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO token_sources (token_id, source_id) SELECT ?, id FROM sources WHERE name IN ('源A','源B')",
    ).bind(1),
  ]);
}

/** 请求并冲刷 waitUntil（确保异步写完成，避免与 reset() 竞态） */
async function request(path: string, headers: Record<string, string> = {}) {
  const ctx = createExecutionContext();
  const res = await app.request(path, { headers }, env, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

let mock: UpstreamMock;

beforeEach(async () => {
  vi.unstubAllGlobals();
  mock = installUpstreamMock();
  await reset(); // vpw 0.22 无 per-test 存储隔离，显式清空 KV/D1
  await ensureSchema();
});

describe("GET /sub/:token — token 校验", () => {
  it("不存在 → 401", async () => {
    const r = await request("/sub/no-such-token");
    expect(r.status).toBe(401);
    const body = (await r.json()) as { error: string };
    expect(body.error).not.toContain("源");
  });

  it("禁用 → 403", async () => {
    await seed({ enabled: 0 });
    const r = await request(`/sub/${TOKEN}`);
    expect(r.status).toBe(403);
  });

  it("过期 → 403", async () => {
    await seed({ expiresAt: Date.now() - 1000 });
    const r = await request(`/sub/${TOKEN}`);
    expect(r.status).toBe(403);
  });

  it("未绑定源 → 400 明确提示", async () => {
    await seed({ withSources: false });
    const r = await request(`/sub/${TOKEN}`);
    expect(r.status).toBe(400);
    const body = (await r.json()) as { error: string };
    expect(body.error).toContain("未绑定");
  });
});

describe("GET /sub/:token — 聚合与降级", () => {
  it("多源合并，节点带源前缀（Clash UA → YAML）", async () => {
    mock
      .get("https://a.example.com")
      .intercept({ path: "/sub" })
      .reply(200, UPSTREAM_A);
    mock
      .get("https://b.example.com")
      .intercept({ path: "/sub" })
      .reply(200, UPSTREAM_B);
    await seed();
    const r = await request(`/sub/${TOKEN}`, {
      "User-Agent": "clash-verge/v1.7.7",
    });
    expect(r.status).toBe(200);
    expect(r.headers.get("Content-Type")).toContain("text/yaml");
    const { parse: parseYaml } = await import("yaml");
    const cfg = parseYaml(await r.text()) as { proxies: { name: string }[] };
    expect(cfg.proxies.map((p) => p.name)).toEqual([
      "[A] 香港01",
      "[A] 日本01",
      "[A] 美国01",
      "[源B] 台湾01", // 未配置前缀时用源名
    ]);
  });

  it("部分源失败 → 降级只含成功源，仍 200", async () => {
    mock
      .get("https://a.example.com")
      .intercept({ path: "/sub" })
      .reply(200, UPSTREAM_A);
    mock
      .get("https://b.example.com")
      .intercept({ path: "/sub" })
      .reply(500, "err");
    await seed();
    const r = await request(`/sub/${TOKEN}`, { "User-Agent": "clash" });
    expect(r.status).toBe(200);
    const { parse: parseYaml } = await import("yaml");
    const cfg = parseYaml(await r.text()) as { proxies: { name: string }[] };
    expect(cfg.proxies.every((p) => p.name.startsWith("[A]"))).toBe(true);
    // 失败源记录了 error 状态
    const s = await env.DB.prepare(
      "SELECT last_fetch_status FROM sources WHERE name = '源B'",
    ).first<{ last_fetch_status: string }>();
    expect(s!.last_fetch_status).toBe("error");
  });

  it("全部源失败 → 502", async () => {
    mock
      .get("https://a.example.com")
      .intercept({ path: "/sub" })
      .reply(500, "err");
    mock
      .get("https://b.example.com")
      .intercept({ path: "/sub" })
      .reply(500, "err");
    await seed();
    const r = await request(`/sub/${TOKEN}`);
    expect(r.status).toBe(502);
  });

  it("last_used_at 被记录（waitUntil）", async () => {
    mock
      .get("https://a.example.com")
      .intercept({ path: "/sub" })
      .reply(200, UPSTREAM_A);
    mock
      .get("https://b.example.com")
      .intercept({ path: "/sub" })
      .reply(200, UPSTREAM_B);
    await seed();
    await request(`/sub/${TOKEN}`); // helper 已冲刷 waitUntil
    const t = await env.DB.prepare(
      "SELECT last_used_at FROM tokens WHERE id = 1",
    ).first<{ last_used_at: number }>();
    expect(t!.last_used_at).not.toBeNull();
  });
});

describe("GET /sub/:token — 格式自适应", () => {
  it("非 Clash UA → base64，内容可解析回节点", async () => {
    mock
      .get("https://a.example.com")
      .intercept({ path: "/sub" })
      .reply(200, UPSTREAM_A);
    mock
      .get("https://b.example.com")
      .intercept({ path: "/sub" })
      .reply(200, UPSTREAM_B);
    await seed();
    const r = await request(`/sub/${TOKEN}`, { "User-Agent": "v2rayN/6.0" });
    expect(r.status).toBe(200);
    expect(r.headers.get("Content-Type")).toContain("text/plain");
    const { parseBase64Sub } = await import("../../src/lib/link-parse");
    const back = parseBase64Sub(await r.text());
    expect(back.proxies.map((p) => p.name)).toEqual([
      "[A] 香港01",
      "[A] 日本01",
      "[A] 美国01",
      "[源B] 台湾01",
    ]);
  });

  it("?format=base64 显式覆盖 Clash UA", async () => {
    mock
      .get("https://a.example.com")
      .intercept({ path: "/sub" })
      .reply(200, UPSTREAM_A);
    mock
      .get("https://b.example.com")
      .intercept({ path: "/sub" })
      .reply(200, UPSTREAM_B);
    await seed();
    const r = await request(`/sub/${TOKEN}?format=base64`, {
      "User-Agent": "clash-verge/v1.7.7",
    });
    expect(r.headers.get("Content-Type")).toContain("text/plain");
    const text = await r.text();
    expect(() => atob(text)).not.toThrow();
  });

  it("?format=clash 显式覆盖普通 UA", async () => {
    mock
      .get("https://a.example.com")
      .intercept({ path: "/sub" })
      .reply(200, UPSTREAM_A);
    mock
      .get("https://b.example.com")
      .intercept({ path: "/sub" })
      .reply(200, UPSTREAM_B);
    await seed();
    const r = await request(`/sub/${TOKEN}?format=clash`, {
      "User-Agent": "curl/8.0",
    });
    expect(r.headers.get("Content-Type")).toContain("text/yaml");
  });
});

describe("GET /sub/:format/:token — 显式格式路径", () => {
  beforeEach(async () => {
    mock
      .get("https://a.example.com")
      .intercept({ path: "/sub" })
      .reply(200, UPSTREAM_A);
    mock
      .get("https://b.example.com")
      .intercept({ path: "/sub" })
      .reply(200, UPSTREAM_B);
    await seed();
  });

  it("/sub/clash/:token 浏览器 UA 也返回 YAML", async () => {
    const r = await request(`/sub/clash/${TOKEN}`, {
      "User-Agent": "Mozilla/5.0 (Macintosh) Chrome/120",
    });
    expect(r.status).toBe(200);
    expect(r.headers.get("Content-Type")).toContain("text/yaml");
    const text = await r.text();
    expect(text).toContain("proxies:");
  });

  it("/sub/base64/:token Clash UA 也返回 base64", async () => {
    const r = await request(`/sub/base64/${TOKEN}`, {
      "User-Agent": "clash-verge/v1.7.7",
    });
    expect(r.status).toBe(200);
    expect(r.headers.get("Content-Type")).toContain("text/plain");
    const text = await r.text();
    expect(() => atob(text)).not.toThrow();
  });

  it("?format= 不覆盖显式路径（路径优先）", async () => {
    const r = await request(`/sub/clash/${TOKEN}?format=base64`, {
      "User-Agent": "curl/8.0",
    });
    expect(r.headers.get("Content-Type")).toContain("text/yaml");
  });

  it("显式路径同样校验 token（401/403）", async () => {
    const r1 = await request(`/sub/clash/no-such-token`);
    expect(r1.status).toBe(401);
    await env.DB.prepare("UPDATE tokens SET enabled = 0 WHERE token = ?")
      .bind(TOKEN)
      .run();
    const r2 = await request(`/sub/base64/${TOKEN}`);
    expect(r2.status).toBe(403);
  });
});

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

const UPSTREAM = [
  "ss://YWVzLTEyOC1nY206cGFzc3dvcmQ=@a1.example.com:8388#香港01",
  "trojan://pw@a3.example.com:443#美国01",
].join("\n");

const UPSTREAM_B = "trojan://pw@b1.example.com:443#台湾01";

let cookie = "";

async function login() {
  const ctx = createExecutionContext();
  const r = await app.request(
    "/api/login",
    { method: "POST", body: JSON.stringify({ password: "test-admin-pass" }) },
    env,
    ctx,
  );
  await waitOnExecutionContext(ctx);
  const setCookie = r.headers.get("Set-Cookie") ?? "";
  cookie = setCookie.split(";")[0]!;
  return r;
}

/** 请求并冲刷 waitUntil（确保异步写完成，避免与 reset() 竞态） */
async function req(path: string, init: RequestInit = {}) {
  const ctx = createExecutionContext();
  const r = await app.request(
    path,
    {
      ...init,
      headers: {
        "Content-Type": "application/json",
        Cookie: cookie,
        ...init.headers,
      },
      body: init.body,
    },
    env,
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return r;
}

let mock: UpstreamMock;

beforeEach(async () => {
  vi.unstubAllGlobals();
  mock = installUpstreamMock();
  await reset(); // vpw 0.22 无 per-test 存储隔离，显式清空 KV/D1
  await ensureSchema();
  await login();
});

describe("管理员认证", () => {
  it("登录成功签发 cookie", async () => {
    // beforeEach 已登录；这里显式再验一次
    const r = await app.request(
      "/api/login",
      { method: "POST", body: JSON.stringify({ password: "test-admin-pass" }) },
      env,
      createExecutionContext(),
    );
    expect(r.status).toBe(200);
    expect(r.headers.get("Set-Cookie")).toContain("fc_session=");
  });

  it("错误密码 → 401 且无 cookie", async () => {
    const r = await app.request(
      "/api/login",
      { method: "POST", body: JSON.stringify({ password: "wrong" }) },
      env,
      createExecutionContext(),
    );
    expect(r.status).toBe(401);
    expect(r.headers.get("Set-Cookie")).toBeNull();
  });

  it("未认证访问管理 API → 401", async () => {
    const r = await app.request(
      "/api/sources",
      {},
      env,
      createExecutionContext(),
    );
    expect(r.status).toBe(401);
    const r2 = await app.request(
      "/api/tokens",
      {},
      env,
      createExecutionContext(),
    );
    expect(r2.status).toBe(401);
  });
});

describe("源订阅管理", () => {
  it("创建源并立即探测：返回格式与节点数", async () => {
    mock
      .get("https://a.example.com")
      .intercept({ path: "/sub" })
      .reply(200, UPSTREAM);
    const r = await req("/api/sources", {
      method: "POST",
      body: JSON.stringify({
        name: "源A",
        url: "https://a.example.com/sub",
        prefix: "A",
      }),
    });
    expect(r.status).toBe(201);
    const body = (await r.json()) as {
      source: { id: number; format: string | null };
      probe: { ok: boolean; format: string; nodeCount: number };
    };
    expect(body.probe).toMatchObject({
      ok: true,
      format: "base64",
      nodeCount: 2,
    });
    expect(body.source.format).toBe("base64");
  });

  it("探测失败：源仍创建但状态为 error 且给出原因", async () => {
    mock
      .get("https://bad.example.com")
      .intercept({ path: "/" })
      .reply(500, "err");
    const r = await req("/api/sources", {
      method: "POST",
      body: JSON.stringify({ name: "坏源", url: "https://bad.example.com/" }),
    });
    expect(r.status).toBe(201);
    const body = (await r.json()) as {
      probe: { ok: boolean; error: string };
      source: { id: number };
    };
    expect(body.probe.ok).toBe(false);
    expect(body.probe.error).toContain("500");
    const list = (await (await req("/api/sources")).json()) as {
      sources: { last_fetch_status: string | null }[];
    };
    expect(list.sources[0]!.last_fetch_status).toBe("error");
  });

  it("非法输入 → 400（缺 name / 非 http url / 重复 URL）", async () => {
    const r1 = await req("/api/sources", {
      method: "POST",
      body: JSON.stringify({ url: "https://x.com/" }),
    });
    expect(r1.status).toBe(400);
    const r2 = await req("/api/sources", {
      method: "POST",
      body: JSON.stringify({ name: "x", url: "ftp://x.com/" }),
    });
    expect(r2.status).toBe(400);
    await req("/api/sources", {
      method: "POST",
      body: JSON.stringify({
        name: "s",
        url: "https://dup.example.com/",
        probe: false,
      }),
    });
    const r3 = await req("/api/sources", {
      method: "POST",
      body: JSON.stringify({
        name: "s2",
        url: "https://dup.example.com/",
        probe: false,
      }),
    });
    expect(r3.status).toBe(409);
  });

  it("列表展示健康状态与绑定 token 数", async () => {
    await req("/api/sources", {
      method: "POST",
      body: JSON.stringify({
        name: "源A",
        url: "https://a.example.com/sub",
        probe: false,
      }),
    });
    await req("/api/tokens", {
      method: "POST",
      body: JSON.stringify({ name: "t", sourceIds: [1] }),
    });
    const r = await req("/api/sources");
    const body = (await r.json()) as {
      sources: {
        name: string;
        token_count: number;
        last_fetch_status: string | null;
        subscription_meta: unknown;
      }[];
    };
    expect(body.sources).toHaveLength(1);
    expect(body.sources[0]!.token_count).toBe(1);
    expect(body.sources[0]!.last_fetch_status).toBeNull();
    expect(body.sources[0]!.subscription_meta).toBeNull();
  });

  it("列表从 KV 缓存展示源用量，且不额外回源", async () => {
    mock
      .get("https://a.example.com")
      .intercept({ path: "/sub" })
      .reply(200, UPSTREAM, {
        "subscription-userinfo":
          "upload=1024; download=2048; total=10737418240; expire=2000000000",
        "profile-update-interval": "24",
      });
    await req("/api/sources", {
      method: "POST",
      body: JSON.stringify({
        name: "有用量源",
        url: "https://a.example.com/sub",
      }),
    });
    expect(mock.calls).toHaveLength(1);

    const r = await req("/api/sources");
    const body = (await r.json()) as {
      sources: {
        subscription_meta: {
          userInfo: {
            upload: number;
            download: number;
            total: number;
            expire: number;
          };
          profileUpdateInterval: number;
        };
      }[];
    };
    expect(body.sources[0]!.subscription_meta).toEqual({
      userInfo: {
        upload: 1024,
        download: 2048,
        total: 10737418240,
        expire: 2000000000,
      },
      profileUpdateInterval: 24,
    });
    expect(mock.calls).toHaveLength(1);
  });

  it("改 URL 清除缓存与健康状态", async () => {
    mock
      .get("https://a.example.com")
      .intercept({ path: "/sub" })
      .reply(200, UPSTREAM);
    const created = (await (
      await req("/api/sources", {
        method: "POST",
        body: JSON.stringify({ name: "源A", url: "https://a.example.com/sub" }),
      })
    ).json()) as { source: { id: number } };
    const id = created.source.id;
    // 探测后缓存已写入
    expect(await env.KV.get(`fc:src:${id}:data`)).not.toBeNull();

    const r = await req(`/api/sources/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ url: "https://a2.example.com/sub" }),
    });
    expect(r.status).toBe(200);
    expect(await env.KV.get(`fc:src:${id}:data`)).toBeNull();
    const src = (await (await req(`/api/sources/${id}`)).json()) as {
      source: { url: string; last_fetch_at: null };
    };
    expect(src.source.url).toBe("https://a2.example.com/sub");
    expect(src.source.last_fetch_at).toBeNull();
  });

  it("删除源：记录、绑定、缓存全部清除", async () => {
    mock
      .get("https://a.example.com")
      .intercept({ path: "/sub" })
      .reply(200, UPSTREAM);
    const created = (await (
      await req("/api/sources", {
        method: "POST",
        body: JSON.stringify({ name: "源A", url: "https://a.example.com/sub" }),
      })
    ).json()) as { source: { id: number } };
    const id = created.source.id;
    await req("/api/tokens", {
      method: "POST",
      body: JSON.stringify({ name: "t", sourceIds: [id] }),
    });

    const r = await req(`/api/sources/${id}`, { method: "DELETE" });
    expect(r.status).toBe(200);
    const list = (await (await req("/api/sources")).json()) as {
      sources: unknown[];
    };
    expect(list.sources).toHaveLength(0);
    const ts = (await (await req("/api/tokens")).json()) as {
      tokens: { source_ids: number[] }[];
    };
    expect(ts.tokens[0]!.source_ids).toEqual([]);
    expect(await env.KV.get(`fc:src:${id}:data`)).toBeNull();
  });

  it("手动探测复用节流：间隔内不二次回源", async () => {
    mock
      .get("https://a.example.com")
      .intercept({ path: "/sub" })
      .reply(200, UPSTREAM);
    const created = (await (
      await req("/api/sources", {
        method: "POST",
        body: JSON.stringify({ name: "源A", url: "https://a.example.com/sub" }),
      })
    ).json()) as { source: { id: number } };
    const r1 = await req(`/api/sources/${created.source.id}/probe`, {
      method: "POST",
    });
    const p1 = (await r1.json()) as { probe: { ok: boolean; origin: string } };
    // 创建时已探测并写缓存，间隔内手动探测走缓存（节流生效）
    expect(p1.probe.origin).toBe("cache");
    mock.assertNoPendingInterceptors(); // 未发生第二次回源
  });
});

describe("Token 生命周期管理", () => {
  async function createSourceB() {
    mock
      .get("https://b.example.com")
      .intercept({ path: "/sub" })
      .reply(200, UPSTREAM_B);
    await req("/api/sources", {
      method: "POST",
      body: JSON.stringify({ name: "源B", url: "https://b.example.com/sub" }),
    });
  }

  it("创建 token：43 字符随机值 + 绑定源 + 可访问订阅", async () => {
    mock
      .get("https://a.example.com")
      .intercept({ path: "/sub" })
      .reply(200, UPSTREAM);
    await req("/api/sources", {
      method: "POST",
      body: JSON.stringify({ name: "源A", url: "https://a.example.com/sub" }),
    });
    const r = await req("/api/tokens", {
      method: "POST",
      body: JSON.stringify({ name: "朋友X", sourceIds: [1] }),
    });
    expect(r.status).toBe(201);
    const body = (await r.json()) as {
      token: { token: string; enabled: number };
    };
    expect(body.token.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(body.token.enabled).toBe(1);

    // 订阅可访问（冲刷 waitUntil）
    const subCtx = createExecutionContext();
    const sub = await app.request(
      `/sub/${body.token.token}`,
      { headers: { "User-Agent": "clash" } },
      env,
      subCtx,
    );
    await waitOnExecutionContext(subCtx);
    expect(sub.status).toBe(200);
  });

  it("禁用 token 立即生效（403）", async () => {
    mock
      .get("https://a.example.com")
      .intercept({ path: "/sub" })
      .reply(200, UPSTREAM);
    await req("/api/sources", {
      method: "POST",
      body: JSON.stringify({ name: "源A", url: "https://a.example.com/sub" }),
    });
    const created = (await (
      await req("/api/tokens", {
        method: "POST",
        body: JSON.stringify({ name: "t", sourceIds: [1] }),
      })
    ).json()) as { token: { id: number; token: string } };

    await req(`/api/tokens/${created.token.id}`, {
      method: "PATCH",
      body: JSON.stringify({ enabled: false }),
    });
    const subCtx = createExecutionContext();
    const sub = await app.request(
      `/sub/${created.token.token}`,
      {},
      env,
      subCtx,
    );
    await waitOnExecutionContext(subCtx);
    expect(sub.status).toBe(403);
  });

  it("修改源绑定：下次请求即返回新集合", async () => {
    mock
      .get("https://a.example.com")
      .intercept({ path: "/sub" })
      .reply(200, UPSTREAM);
    mock
      .get("https://b.example.com")
      .intercept({ path: "/sub" })
      .reply(200, UPSTREAM_B);
    await req("/api/sources", {
      method: "POST",
      body: JSON.stringify({ name: "源A", url: "https://a.example.com/sub" }),
    });
    await createSourceB();
    const created = (await (
      await req("/api/tokens", {
        method: "POST",
        body: JSON.stringify({ name: "t", sourceIds: [1] }),
      })
    ).json()) as { token: { id: number; token: string } };

    // 改绑源 2
    await req(`/api/tokens/${created.token.id}`, {
      method: "PATCH",
      body: JSON.stringify({ sourceIds: [2] }),
    });
    const subCtx = createExecutionContext();
    const sub = await app.request(
      `/sub/${created.token.token}`,
      { headers: { "User-Agent": "clash" } },
      env,
      subCtx,
    );
    await waitOnExecutionContext(subCtx);
    expect(sub.status).toBe(200);
    const { parse: parseYaml } = await import("yaml");
    const cfg = parseYaml(await sub.text()) as { proxies: { name: string }[] };
    expect(cfg.proxies.every((p) => p.name.includes("台湾"))).toBe(true);
  });

  it("过期时间与过期失效", async () => {
    const created = (await (
      await req("/api/tokens", {
        method: "POST",
        body: JSON.stringify({ name: "t", expiresAt: Date.now() + 60_000 }),
      })
    ).json()) as { token: { id: number; expires_at: number } };
    expect(created.token.expires_at).toBeGreaterThan(Date.now());

    // 设为已过期
    await req(`/api/tokens/${created.token.id}`, {
      method: "PATCH",
      body: JSON.stringify({ expiresAt: Date.now() - 1 }),
    });
    const list = (await (await req("/api/tokens")).json()) as {
      tokens: { id: number; expires_at: number }[];
    };
    expect(list.tokens[0]!.expires_at).toBeLessThan(Date.now());
  });

  it("非法 sourceIds → 400", async () => {
    const r = await req("/api/tokens", {
      method: "POST",
      body: JSON.stringify({ sourceIds: [999] }),
    });
    expect(r.status).toBe(400);
  });

  it("删除 token 后列表消失", async () => {
    const created = (await (
      await req("/api/tokens", {
        method: "POST",
        body: JSON.stringify({ name: "t" }),
      })
    ).json()) as { token: { id: number } };
    const r = await req(`/api/tokens/${created.token.id}`, {
      method: "DELETE",
    });
    expect(r.status).toBe(200);
    const list = (await (await req("/api/tokens")).json()) as {
      tokens: unknown[];
    };
    expect(list.tokens).toHaveLength(0);
  });
});

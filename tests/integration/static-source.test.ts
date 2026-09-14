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
import { b64Decode } from "../../src/lib/b64";

/** 完全虚构的协议样例，不含生产凭据 */
const VLESS_REALITY =
  "vless://11111111-2222-4333-8444-555555555555@derp.example.com:8443?encryption=none&flow=xtls-rprx-vision&security=reality&sni=www.microsoft.com&fp=chrome&pbk=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA&sid=0123456789abcdef&type=tcp#vmiss-HK-Reality";
const HY2 =
  "hysteria2://xzMpassword@derp.example.com:8444/?insecure=1&sni=bing.com#vmiss-HK-Hy2";
const STATIC_CONTENT = `${VLESS_REALITY}\n${HY2}`;

const TOKEN = "static-token-123";
const ADMIN_PASS = "test-admin-pass";

let cookie = "";
let mock: UpstreamMock;

async function login() {
  const ctx = createExecutionContext();
  const r = await app.request(
    "/api/login",
    { method: "POST", body: JSON.stringify({ password: ADMIN_PASS }) },
    env,
    ctx,
  );
  await waitOnExecutionContext(ctx);
  cookie = (r.headers.get("Set-Cookie") ?? "").split(";")[0]!;
}

async function adminReq(path: string, init: RequestInit = {}) {
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
    },
    env,
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return r;
}

/** 种一个 token 并绑定指定源 id */
async function seedTokenWith(sourceIds: number[]) {
  const now = Date.now();
  await env.DB.prepare(
    "INSERT INTO tokens (token, name, enabled, expires_at, created_at) VALUES (?, ?, 1, NULL, ?)",
  )
    .bind(TOKEN, "static 测试", now)
    .run();
  for (const sid of sourceIds) {
    await env.DB.prepare(
      "INSERT INTO token_sources (token_id, source_id) VALUES ((SELECT id FROM tokens WHERE token = ?), ?)",
    )
      .bind(TOKEN, sid)
      .run();
  }
}

async function subReq(path: string, userAgent?: string) {
  const ctx = createExecutionContext();
  const r = await app.request(
    path,
    userAgent ? { headers: { "User-Agent": userAgent } } : {},
    env,
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return r;
}

beforeEach(async () => {
  vi.unstubAllGlobals();
  mock = installUpstreamMock();
  await reset();
  await ensureSchema();
  await login();
});

describe("静态源管理", () => {
  it("编辑时双向切换类型，保留绑定并清除旧内容/缓存", async () => {
    mock.get("https://upstream.example.com").intercept({ path: "/sub" }).reply(200, HY2);
    const created = await adminReq("/api/sources", {
      method: "POST", body: JSON.stringify({name: "切换", url: "https://upstream.example.com/sub"}),
    });
    expect(created.status).toBe(201);
    const {source} = await created.json() as {source: {id: number}};
    await seedTokenWith([source.id]);
    const patch = (body: object) => adminReq(`/api/sources/${source.id}`, {method: "PATCH", body: JSON.stringify(body)});
    const toStatic = await patch({kind: "static", content: VLESS_REALITY});
    expect(toStatic.status).toBe(200);
    expect(await toStatic.json()).toMatchObject({source: {kind: "static", url: "", content: VLESS_REALITY}});
    expect(b64Decode(await (await subReq(`/sub/${TOKEN}`)).text())).toContain("vless://");
    const back = await patch({kind: "fetch", url: "https://upstream.example.com/sub"});
    expect(back.status).toBe(200);
    expect(await back.json()).toMatchObject({source: {kind: "fetch", content: null}});
    expect(b64Decode(await (await subReq(`/sub/${TOKEN}`)).text())).toContain("hysteria2://");
    expect(mock.calls).toHaveLength(2); // 切换后不能复用上次 fetch 的缓存
  });
  it("创建 static 源：探测走本地解析，不回源", async () => {
    const r = await adminReq("/api/sources", {
      method: "POST",
      body: JSON.stringify({
        name: "derp",
        kind: "static",
        content: STATIC_CONTENT,
        prefix: "derp",
      }),
    });
    expect(r.status).toBe(201);
    const { source, probe } = (await r.json()) as {
      source: { kind: string; content: string; url: string };
      probe: { ok: boolean; format: string; nodeCount: number };
    };
    expect(source.kind).toBe("static");
    expect(source.content).toBe(STATIC_CONTENT);
    expect(source.url).toBe("");
    expect(probe.ok).toBe(true);
    expect(probe.format).toBe("base64");
    expect(probe.nodeCount).toBe(2);
    expect(mock.calls).toHaveLength(0); // 全程零回源
  });

  it("静态源完整生命周期零 KV 读写", async () => {
    const get = vi.spyOn(env.KV, "get");
    const put = vi.spyOn(env.KV, "put");
    const del = vi.spyOn(env.KV, "delete");
    try {
      const created = await adminReq("/api/sources", {method: "POST", body: JSON.stringify({name: "static", kind: "static", content: HY2})});
      const {source} = await created.json() as {source: {id: number}};
      expect(created.status).toBe(201);
      await seedTokenWith([source.id]);
      expect((await adminReq("/api/sources")).status).toBe(200);
      expect((await adminReq(`/api/sources/${source.id}/probe`, {method: "POST"})).status).toBe(200);
      expect((await subReq(`/sub/${TOKEN}`)).status).toBe(200);
      expect((await adminReq(`/api/sources/${source.id}`, {method: "DELETE"})).status).toBe(200);
      expect(mock.calls).toHaveLength(0);
      expect(get).not.toHaveBeenCalled();
      expect(put).not.toHaveBeenCalled();
      expect(del).not.toHaveBeenCalled();
    } finally { get.mockRestore(); put.mockRestore(); del.mockRestore(); }
  });

  it("content 缺失 / 不可解析 → 400", async () => {
    const r1 = await adminReq("/api/sources", {
      method: "POST",
      body: JSON.stringify({ name: "x", kind: "static", content: "  " }),
    });
    expect(r1.status).toBe(400);
    const r2 = await adminReq("/api/sources", {
      method: "POST",
      body: JSON.stringify({
        name: "x",
        kind: "static",
        content: "not-a-link",
      }),
    });
    expect(r2.status).toBe(400);
  });

  it("PATCH 更新 static 内容生效，坏内容被拒", async () => {
    const create = await adminReq("/api/sources", {
      method: "POST",
      body: JSON.stringify({
        name: "derp",
        kind: "static",
        content: VLESS_REALITY,
        probe: false,
      }),
    });
    const { source } = (await create.json()) as { source: { id: number } };

    const bad = await adminReq(`/api/sources/${source.id}`, {
      method: "PATCH",
      body: JSON.stringify({ content: "garbage" }),
    });
    expect(bad.status).toBe(400);

    const ok = await adminReq(`/api/sources/${source.id}`, {
      method: "PATCH",
      body: JSON.stringify({ content: STATIC_CONTENT }),
    });
    expect(ok.status).toBe(200);
    const row = (await ok.json()) as { source: { content: string } };
    expect(row.source.content).toBe(STATIC_CONTENT);
  });
});

describe("静态源订阅输出", () => {
  beforeEach(async () => {
    const r = await adminReq("/api/sources", {
      method: "POST",
      body: JSON.stringify({
        name: "derp",
        kind: "static",
        content: STATIC_CONTENT,
        prefix: "derp",
        probe: false,
      }),
    });
    const { source } = (await r.json()) as { source: { id: number } };
    await seedTokenWith([source.id]);
  });

  it("base64 输出（Hiddify UA）：vless reality 参数完整保留", async () => {
    const r = await subReq(`/sub/${TOKEN}`, "Hiddify/2.5.1 (like ClashMeta)");
    expect(r.status).toBe(200);
    const decoded = b64Decode(await r.text())!;
    const lines = decoded.split("\n");
    expect(lines).toHaveLength(2);
    // vless 链接：uuid、reality 公钥、shortId、flow、sni 均保留，名称加前缀
    expect(lines[0]).toContain("vless://11111111");
    expect(lines[0]).toContain(
      "pbk=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    );
    expect(lines[0]).toContain("sid=0123456789abcdef");
    expect(lines[0]).toContain("flow=xtls-rprx-vision");
    expect(lines[0]).toContain("security=reality");
    expect(lines[0]).toContain("%5Bderp%5D%20vmiss-HK-Reality");
    expect(lines[1]).toContain("hysteria2://");
    expect(mock.calls).toHaveLength(0);
  });

  it("clash 输出：vless 节点含 reality-opts", async () => {
    const r = await subReq(`/sub/${TOKEN}?format=clash`);
    expect(r.status).toBe(200);
    const yaml = await r.text();
    expect(yaml).toContain("type: vless");
    expect(yaml).toContain("uuid: 11111111-2222-4333-8444-555555555555");
    expect(yaml).toContain("reality-opts:");
    expect(yaml).toContain(
      "public-key: AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    );
    expect(yaml).toContain("short-id: 0123456789abcdef");
    expect(yaml).toContain("flow: xtls-rprx-vision");
    expect(yaml).toContain("type: hysteria2");
  });
});

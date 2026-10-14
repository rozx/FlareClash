import {
  createExecutionContext,
  env,
  reset,
  waitOnExecutionContext,
} from "cloudflare:test";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { parse as parseYaml } from "yaml";
import app from "../../src/index";
import { ensureSchema } from "./schema";
import { installUpstreamMock, type UpstreamMock } from "./mock-upstream";

/** 完全虚构的协议样例，节点名复现生产问题：香港源节点名不含地区关键字 */
const vless = (host: string, name: string) =>
  `vless://11111111-2222-4333-8444-555555555555@${host}:8443?encryption=none&flow=xtls-rprx-vision&security=reality&sni=www.microsoft.com&fp=chrome&pbk=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA&sid=0123456789abcdef&type=tcp#${encodeURIComponent(name)}`;
const hy2 = (host: string, name: string) =>
  `hysteria2://pw@${host}:8444/?insecure=1&sni=bing.com#${encodeURIComponent(name)}`;
const HK_CONTENT = `${vless("hk.example.com", "VLESS Reality — migrated")}\n${hy2("hk.example.com", "Hysteria2 — migrated")}`;
const US_CONTENT = `${vless("us.example.com", "US VLESS Reality")}\n${hy2("us.example.com", "US Hysteria2")}`;

const TOKEN = "region-token-123";
const CLASH_UA = "clash-verge/v2.4.2";

let cookie = "";
let mock: UpstreamMock;

async function request(path: string, init: RequestInit = {}) {
  const ctx = createExecutionContext();
  const r = await app.request(path, init, env, ctx);
  await waitOnExecutionContext(ctx);
  return r;
}

function adminReq(path: string, init: RequestInit = {}) {
  return request(path, {
    ...init,
    headers: { "Content-Type": "application/json", Cookie: cookie },
  });
}

async function createSource(body: object) {
  return adminReq("/api/sources", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

async function seedTokenWith(sourceIds: number[]) {
  await env.DB.prepare(
    "INSERT INTO tokens (token, name, enabled, expires_at, created_at) VALUES (?, ?, 1, NULL, ?)",
  )
    .bind(TOKEN, "地区测试", Date.now())
    .run();
  for (const sid of sourceIds) {
    await env.DB.prepare(
      "INSERT INTO token_sources (token_id, source_id) VALUES ((SELECT id FROM tokens WHERE token = ?), ?)",
    )
      .bind(TOKEN, sid)
      .run();
  }
}

beforeEach(async () => {
  vi.unstubAllGlobals();
  mock = installUpstreamMock();
  await reset();
  await ensureSchema();
  const r = await request("/api/login", {
    method: "POST",
    body: JSON.stringify({ password: "test-admin-pass" }),
  });
  cookie = (r.headers.get("Set-Cookie") ?? "").split(";")[0]!;
});

describe("源级地区归属", () => {
  it("两个自建源：指定香港的源与美国源分别成组，不出现其余节点", async () => {
    const hk = await createSource({
      name: "derp",
      kind: "static",
      content: HK_CONTENT,
      region: "hk",
    });
    expect(hk.status).toBe(201);
    const us = await createSource({
      name: "derp-us",
      kind: "static",
      content: US_CONTENT,
    });
    expect(us.status).toBe(201);
    const ids = await Promise.all(
      [hk, us].map(async (r) => ((await r.json()) as { source: { id: number } }).source.id),
    );
    await seedTokenWith(ids);

    const r = await request(`/sub/${TOKEN}`, {
      headers: { "User-Agent": CLASH_UA },
    });
    expect(r.status).toBe(200);
    const doc = parseYaml(await r.text()) as {
      "proxy-groups": { name: string; proxies: string[] }[];
    };
    const groups = new Map(doc["proxy-groups"].map((g) => [g.name, g.proxies]));
    expect(groups.get("🇭🇰 香港")).toEqual([
      "[derp] VLESS Reality — migrated",
      "[derp] Hysteria2 — migrated",
    ]);
    expect(groups.get("🇺🇸 美国")).toEqual([
      "[derp-us] US VLESS Reality",
      "[derp-us] US Hysteria2",
    ]);
    expect(groups.has("🌐 其余节点")).toBe(false);
    expect(mock.calls).toHaveLength(0);
  });

  it("创建与编辑：合法地区持久化，改回自动不重置健康状态", async () => {
    const created = await createSource({
      name: "derp",
      kind: "static",
      content: HK_CONTENT,
      region: "hk",
    });
    const { source } = (await created.json()) as {
      source: { id: number; region: string | null; last_fetch_status: string };
    };
    expect(source.region).toBe("hk");
    expect(source.last_fetch_status).toBe("ok");

    const list = (await (await adminReq("/api/sources")).json()) as {
      sources: { id: number; region: string | null }[];
    };
    expect(list.sources[0]!.region).toBe("hk");

    const patched = await adminReq(`/api/sources/${source.id}`, {
      method: "PATCH",
      body: JSON.stringify({ region: null }),
    });
    expect(patched.status).toBe(200);
    expect(await patched.json()).toMatchObject({
      source: { region: null, last_fetch_status: "ok", format: "base64" },
    });

    // 缺省 region 的编辑保持不变
    await adminReq(`/api/sources/${source.id}`, {
      method: "PATCH",
      body: JSON.stringify({ region: "jp" }),
    });
    const kept = await adminReq(`/api/sources/${source.id}`, {
      method: "PATCH",
      body: JSON.stringify({ name: "derp-jp" }),
    });
    expect(await kept.json()).toMatchObject({
      source: { name: "derp-jp", region: "jp" },
    });
  });

  it("非法地区被拒且不写库", async () => {
    const bad = await createSource({
      name: "derp",
      kind: "static",
      content: HK_CONTENT,
      region: "mars",
    });
    expect(bad.status).toBe(400);
    const count = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM sources",
    ).first<{ n: number }>();
    expect(count!.n).toBe(0);

    const ok = await createSource({
      name: "derp",
      kind: "static",
      content: HK_CONTENT,
    });
    const { source } = (await ok.json()) as { source: { id: number } };
    const patch = await adminReq(`/api/sources/${source.id}`, {
      method: "PATCH",
      body: JSON.stringify({ region: "mars", name: "改名" }),
    });
    expect(patch.status).toBe(400);
    const row = await env.DB.prepare(
      "SELECT name, region FROM sources WHERE id = ?",
    )
      .bind(source.id)
      .first<{ name: string; region: string | null }>();
    expect(row).toEqual({ name: "derp", region: null });
  });
});

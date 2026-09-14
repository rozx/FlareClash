import {
  createExecutionContext,
  env,
  reset,
  waitOnExecutionContext,
} from "cloudflare:test";
import { beforeEach, describe, expect, it, vi } from "vitest";
import app from "../../src/index";
import { parse as parseYaml } from "yaml";
import { ensureSchema } from "./schema";
import { installUpstreamMock } from "./mock-upstream";

let cookie = "";
async function req(path: string, method = "GET", body?: unknown, auth = true) {
  const ctx = createExecutionContext();
  const res = await app.request(
    path,
    {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(auth ? { Cookie: cookie } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
    env,
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return res;
}
beforeEach(async () => {
  vi.unstubAllGlobals();
  installUpstreamMock();
  await reset();
  await ensureSchema();
  const login = await req(
    "/api/login",
    "POST",
    { password: "test-admin-pass" },
    false,
  );
  cookie = login.headers.get("Set-Cookie")!.split(";")[0]!;
});

const basic = { version: 1, groups: [], rules: [], final: "PROXY" };
async function source(name: string, host: string) {
  const r = await req("/api/sources", "POST", {
    name,
    prefix: "共享前缀",
    kind: "static",
    content: `trojan://fictional@${host}:443#香港`,
  });
  expect(r.status).toBe(201);
  return ((await r.json()) as any).source.id as number;
}
async function token(sourceIds: number[]) {
  const r = await req("/api/tokens", "POST", { name: "测试", sourceIds });
  expect(r.status).toBe(201);
  return ((await r.json()) as any).token.token as string;
}
describe("网站分流配置", () => {
  it("配置过大或规则过多时拒绝；验证、预览和导出也需认证", async () => {
    expect(
      (await req("/api/routing", "PUT", { ...basic, extra: "x".repeat(65536) }))
        .status,
    ).toBe(413);
    const rules = Array.from({ length: 257 }, () => ({
      type: "DOMAIN",
      value: "example.org",
      target: "DIRECT",
    }));
    expect((await req("/api/routing", "PUT", { ...basic, rules })).status).toBe(
      400,
    );
    for (const suffix of ["validate", "preview", "hiddify"])
      expect(
        (await req(`/api/routing/${suffix}`, "POST", basic, false)).status,
      ).toBe(401);
    expect((await req("/api/routing")).headers.get("Cache-Control")).toBe(
      "no-store",
    );
  });
  it("两个授权源也不能利用同名前缀将首个来源的节点归给另一个源", async () => {
    const a = await source("A", "a.example.com"),
      b = await source("B", "b.example.com");
    const key = await token([a, b]);
    const config = {
      ...basic,
      groups: [{ id: "g_b", name: "B", sourceIds: [b], mode: "url-test" }],
      final: "g_b",
    };
    expect((await req("/api/routing", "PUT", config)).status).toBe(200);
    expect(
      (await req(`/sub/clash/${key}`, "GET", undefined, false)).status,
    ).toBe(502);
    // 明确区分节点名后，策略组应正常包含 B 而非 A。
    expect(
      (await req(`/api/sources/${b}`, "PATCH", { prefix: "B" })).status,
    ).toBe(200);
    const output = parseYaml(
      await (await req(`/sub/clash/${key}`, "GET", undefined, false)).text(),
    );
    expect(
      output["proxy-groups"].find((g: any) => g.name === "📂 B (g_b)"),
    ).toMatchObject({ type: "url-test", proxies: ["[B] 香港"], interval: 300 });
    expect(output.rules).toEqual(["MATCH,📂 B (g_b)"]);
  });
  it("Hiddify 原生 JSON 按字段编号导出，共同规则顺序与兜底保留", async () => {
    const config = {
      ...basic,
      final: "DIRECT",
      rules: [
        { type: "DOMAIN-SUFFIX", value: "example.org", target: "REJECT" },
        { type: "IP-CIDR6", value: "fc00::/7", target: "PROXY" },
      ],
    };
    const res = await req("/api/routing/hiddify", "POST", config);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Disposition")).toContain(
      "hiddify-rules.json",
    );
    expect(await res.json()).toEqual({
      "1": [
        {
          "1": 0,
          "2": true,
          "3": "DOMAIN-SUFFIX example.org",
          "4": 3,
          "16": ["example.org"],
        },
        {
          "1": 1,
          "2": true,
          "3": "IP-CIDR6 fc00::/7",
          "4": 0,
          "13": ["fc00::/7"],
        },
        {
          "1": 2,
          "2": true,
          "3": "FlareClash 兜底",
          "4": 1,
          "10": ["0:65535"],
        },
      ],
    });
  });
  it("Hiddify 明确拒绝定向组及 GEOIP，不静默导出另一套策略", async () => {
    const id = await source("自建", "a.example.com");
    const config = {
      ...basic,
      groups: [{ id: "g_test", name: "自建", sourceIds: [id], mode: "select" }],
      final: "g_test",
    };
    expect((await req("/api/routing/hiddify", "POST", config)).status).toBe(
      422,
    );
    const defaults = ((await (await req("/api/routing")).json()) as any).config;
    const res = await req("/api/routing/hiddify", "POST", defaults);
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({
      error: expect.stringContaining("GEOIP"),
    });
  });
  it.each(["GET", "PUT", "DELETE"])("%s 需管理员认证", async (method) => {
    expect(
      (
        await req(
          "/api/routing",
          method,
          method === "PUT" ? basic : undefined,
          false,
        )
      ).status,
    ).toBe(401);
  });
  it.each([
    { extra: true },
    { version: 2 },
    { final: "missing" },
    {
      groups: [{ id: "g_test", name: "组", mode: "select", sourceIds: [999] }],
    },
    {
      rules: [
        { type: "DOMAIN", value: "bad.example,REJECT", target: "DIRECT" },
      ],
    },
    { rules: [{ type: "IP-CIDR", value: "999.1.1.1/33", target: "DIRECT" }] },
    { rules: [{ type: "IP-CIDR6", value: "gggg::/64", target: "DIRECT" }] },
    { rules: [{ type: "MATCH", value: "", target: "DIRECT" }] },
  ])("非法配置不覆盖已存规则：%j", async (change) => {
    expect((await req("/api/routing", "PUT", basic)).status).toBe(200);
    expect(
      (await req("/api/routing", "PUT", { ...basic, ...change })).status,
    ).toBe(400);
    expect(await (await req("/api/routing")).json()).toMatchObject({
      config: basic,
      origin: "saved",
    });
  });
  it("域名预览有序、区分后缀边界，且提示前置 IP 规则的不确定性", async () => {
    const config = {
      ...basic,
      rules: [
        { type: "IP-CIDR", value: "10.0.0.0/8", target: "DIRECT" },
        { type: "DOMAIN-SUFFIX", value: "example.org", target: "REJECT" },
      ],
    };
    expect(
      await (
        await req("/api/routing/preview", "POST", {
          config,
          domain: "A.Example.org.",
        })
      ).json(),
    ).toMatchObject({ index: 1, target: "REJECT", uncertain: true });
    expect(
      await (
        await req("/api/routing/preview", "POST", {
          config,
          domain: "notexample.org",
        })
      ).json(),
    ).toMatchObject({ index: null, target: "PROXY", uncertain: true });
  });
  it("Clash 使用有序规则，分组只包含 token 授权的源，名称碰撞不泄露", async () => {
    const a = await source("自建", "a.example.com"),
      b = await source("私有", "b.example.com");
    const key = await token([a]);
    const config = {
      ...basic,
      groups: [
        { id: "g_self", name: "自建", sourceIds: [a, b], mode: "select" },
      ],
      rules: [
        { type: "DOMAIN-SUFFIX", value: "github.com", target: "g_self" },
        { type: "DOMAIN", value: "ads.example.com", target: "REJECT" },
      ],
    };
    expect((await req("/api/routing", "PUT", config)).status).toBe(200);
    const res = await req(`/sub/clash/${key}`, "GET", undefined, false);
    expect(res.status).toBe(200);
    const doc = parseYaml(await res.text());
    expect(doc.proxies.map((p: any) => p.server)).toEqual(["a.example.com"]);
    expect(
      doc["proxy-groups"].find((g: any) => g.name === "📂 自建 (g_self)"),
    ).toMatchObject({ type: "select", proxies: ["[共享前缀] 香港"] });
    expect(doc.rules).toEqual([
      "DOMAIN-SUFFIX,github.com,📂 自建 (g_self)",
      "DOMAIN,ads.example.com,REJECT",
      "MATCH,🚀 节点选择",
    ]);
    config.groups[0]!.sourceIds = [b];
    expect((await req("/api/routing", "PUT", config)).status).toBe(200);
    const failed = await req(`/sub/clash/${key}`, "GET", undefined, false);
    expect(failed.status).toBe(502);
    expect(await failed.json()).toMatchObject({
      error: expect.stringContaining("无可用节点"),
    });
    // 既有 base64 仍可用，不受 Clash 专属策略的可用性影响。
    expect(
      (await req(`/sub/base64/${key}`, "GET", undefined, false)).status,
    ).toBe(200);
  });
  it("读取默认 JSON、保存覆盖、恢复默认，且不访问 KV", async () => {
    const get = vi.spyOn(env.KV, "get"),
      put = vi.spyOn(env.KV, "put"),
      del = vi.spyOn(env.KV, "delete");
    try {
      const response = await req("/api/routing");
      expect(response.status).toBe(200);
      const initial = (await response.json()) as any;
      expect(initial.origin).toBe("default");
      expect(initial.config).toMatchObject({
        version: 1,
        groups: [],
        final: "PROXY",
      });
      const config = {
        ...initial.config,
        rules: [
          { type: "DOMAIN-SUFFIX", value: "Example.ORG", target: "REJECT" },
        ],
      };
      expect((await req("/api/routing", "PUT", config)).status).toBe(200);
      const saved = (await (await req("/api/routing")).json()) as any;
      expect(saved.origin).toBe("saved");
      expect(saved.config.rules).toEqual([
        { type: "DOMAIN-SUFFIX", value: "example.org", target: "REJECT" },
      ]);
      expect((await req("/api/routing", "DELETE")).status).toBe(200);
      expect(await (await req("/api/routing")).json()).toMatchObject(initial);
      expect(get).not.toHaveBeenCalled();
      expect(put).not.toHaveBeenCalled();
      expect(del).not.toHaveBeenCalled();
    } finally {
      get.mockRestore();
      put.mockRestore();
      del.mockRestore();
    }
  });
});

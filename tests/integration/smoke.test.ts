import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { ensureSchema } from "./schema";

/**
 * 集成测试基础设施冒烟：workers 池内 D1/KV 可用，
 * 且 ensureSchema() 能建出三张表。
 */
describe("smoke", () => {
  it("D1 reachable", async () => {
    const r = await env.DB.prepare("SELECT 1 AS one").first<{ one: number }>();
    expect(r).toEqual({ one: 1 });
  });

  it("KV reachable", async () => {
    await env.KV.put("smoke", "ok");
    expect(await env.KV.get("smoke")).toBe("ok");
  });

  it("ensureSchema creates tables", async () => {
    await ensureSchema();
    const r = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND (name LIKE '%token%' OR name='sources') ORDER BY name",
    ).all<{ name: string }>();
    expect(r.results.map((x) => x.name)).toEqual([
      "sources",
      "token_sources",
      "tokens",
    ]);
  });
});

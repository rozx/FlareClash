import { describe, expect, it } from "vitest";
import { aggregate } from "../../src/lib/aggregate";
import type { Proxy } from "../../src/lib/types";

const n = (name: string): Proxy => ({
  name,
  type: "ss",
  server: `${name}.example.com`,
  port: 443,
  cipher: "aes-128-gcm",
  password: "x",
});

describe("aggregate", () => {
  it("按源前缀改名（默认源名）", () => {
    const r = aggregate([
      { name: "机场A", proxies: [n("HK-01"), n("JP-01")] },
      { name: "机场B", proxies: [n("US-01")] },
    ]);
    expect(r.proxies.map((p) => p.name)).toEqual([
      "[机场A] HK-01",
      "[机场A] JP-01",
      "[机场B] US-01",
    ]);
    expect(r.duplicates).toBe(0);
  });

  it("自定义前缀优先于源名", () => {
    const r = aggregate([{ name: "机场A", prefix: "A✈", proxies: [n("HK")] }]);
    expect(r.proxies[0]!.name).toBe("[A✈] HK");
  });

  it("跨源同名去重（含前缀后完全相同）", () => {
    const r = aggregate([
      { name: "S1", proxies: [n("dup")] },
      { name: "S1", proxies: [n("dup"), n("ok")] },
      { name: "S2", proxies: [n("dup")] },
    ]);
    expect(r.proxies.map((p) => p.name)).toEqual([
      "[S1] dup",
      "[S1] ok",
      "[S2] dup",
    ]);
    expect(r.duplicates).toBe(1);
  });

  it("源内同名也去重", () => {
    const r = aggregate([{ name: "S", proxies: [n("x"), n("x")] }]);
    expect(r.proxies).toHaveLength(1);
    expect(r.duplicates).toBe(1);
  });

  it("空源数组返回空结果", () => {
    expect(aggregate([])).toEqual({ proxies: [], duplicates: 0 });
  });

  it("某源无节点不影响其他源", () => {
    const r = aggregate([
      { name: "A", proxies: [] },
      { name: "B", proxies: [n("k")] },
    ]);
    expect(r.proxies.map((p) => p.name)).toEqual(["[B] k"]);
  });

  it("改名保留节点其余字段", () => {
    const r = aggregate([{ name: "S", proxies: [n("HK")] }]);
    expect(r.proxies[0]).toMatchObject({
      type: "ss",
      server: "HK.example.com",
      port: 443,
    });
  });
});

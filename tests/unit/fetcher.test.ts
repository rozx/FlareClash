import { describe, expect, it } from "vitest";
import {
  fetchSourceContent,
  probeSource,
  type FetcherDeps,
} from "../../src/cache/fetcher";
import { readSourceCache, type KVLike } from "../../src/cache/kv";
import { b64Encode } from "../../src/lib/b64";

const UPSTREAM = b64Encode(
  "ss://YWVzLTEyOC1nY206cGFzcw@a.example.com:8388#node-a\n" +
    "trojan://pw@b.example.com:443#node-b",
);

/**
 * 时间语义（design.md D3）：
 * - TTL(1800s) > 节流间隔(900s) 的源：成功路径由 TTL 主导
 * - TTL(300s) < 节流间隔(900s) 的源：节流分支生效（含失败后防连环重试）
 */
function setup(opts?: { upstreamStatus?: number; upstreamBody?: string }) {
  const kvStore = new Map<string, string>();
  const kv: KVLike = {
    async get(k) {
      return kvStore.get(k) ?? null;
    },
    async put(k, v) {
      kvStore.set(k, v);
    },
    async delete(k) {
      kvStore.delete(k);
    },
  };
  let fetchCalls = 0;
  let now = 1_000_000;
  const statuses: ["ok" | "error", string | undefined][] = [];
  const deps: FetcherDeps = {
    kv,
    now: () => now,
    minFetchIntervalSec: 900,
    fetchTimeoutMs: 10_000,
    userAgent: "test-ua",
    fetchFn: async () => {
      fetchCalls++;
      const status = opts?.upstreamStatus ?? 200;
      return new Response(
        status === 200 ? (opts?.upstreamBody ?? UPSTREAM) : "err",
        {
          status,
        },
      );
    },
    onStatus: async (s, detail) => {
      statuses.push([s, detail]);
    },
  };
  const longTtl = { id: 1, url: "https://up.example.com/sub", cacheTtl: 1800 };
  const shortTtl = { id: 2, url: "https://up.example.com/sub", cacheTtl: 300 };
  return {
    deps,
    kv,
    longTtl,
    shortTtl,
    advance: (ms: number) => (now += ms),
    calls: () => fetchCalls,
    statuses,
    kvStore,
  };
}

describe("fetchSourceContent 决策路径", () => {
  it("无缓存 → 回源成功 → 写缓存 + onStatus(ok)", async () => {
    const t = setup();
    const r = await fetchSourceContent(t.deps, t.longTtl);
    expect(r).toMatchObject({ status: "fetched", content: UPSTREAM });
    expect(t.calls()).toBe(1);
    expect(await readSourceCache(t.kv, 1)).toMatchObject({ data: UPSTREAM });
    expect(t.statuses).toEqual([["ok", undefined]]);
  });

  it("缓存命中（未过 TTL）→ 不回源", async () => {
    const t = setup();
    await fetchSourceContent(t.deps, t.longTtl);
    const r = await fetchSourceContent(t.deps, t.longTtl);
    expect(r.status).toBe("cache");
    expect(t.calls()).toBe(1);
  });

  it("缓存过期但 < 最短回源间隔 → 节流返回旧内容，不回源", async () => {
    const t = setup();
    await fetchSourceContent(t.deps, t.shortTtl);
    t.advance(300 * 1000 + 1); // 刚过 TTL(300s)，仍在节流窗(900s)内
    const r = await fetchSourceContent(t.deps, t.shortTtl);
    expect(r.status).toBe("stale-cache");
    expect(t.calls()).toBe(1);
  });

  it("超过节流间隔 → 重新回源", async () => {
    const t = setup();
    await fetchSourceContent(t.deps, t.shortTtl);
    t.advance(900 * 1000 + 1);
    const r = await fetchSourceContent(t.deps, t.shortTtl);
    expect(r.status).toBe("fetched");
    expect(t.calls()).toBe(2);
  });

  it("回源失败但有旧缓存 → 降级返回旧内容，缓存未被破坏", async () => {
    const t = setup();
    await fetchSourceContent(t.deps, t.longTtl);
    t.advance(1800 * 1000 + 1); // 过 TTL 也过节流窗
    const t2 = setup({ upstreamStatus: 500 });
    for (const [k, v] of t.kvStore) t2.kvStore.set(k, v);
    t2.advance(1800 * 1000 + 1); // 同步时钟到缓存过期后
    const r = await fetchSourceContent(t2.deps, t2.longTtl);
    expect(r).toMatchObject({
      status: "fetch-failed-stale",
      content: UPSTREAM,
    });
    expect(await readSourceCache(t2.kv, 1)).toMatchObject({ data: UPSTREAM });
    expect(t2.statuses[0]![0]).toBe("error");
  });

  it("失败后节流窗内的请求不再重试（防连环打爆）", async () => {
    const t = setup();
    await fetchSourceContent(t.deps, t.longTtl);
    t.advance(1800 * 1000 + 1);
    const t2 = setup({ upstreamStatus: 500 });
    for (const [k, v] of t.kvStore) t2.kvStore.set(k, v);
    t2.advance(1800 * 1000 + 1);
    await fetchSourceContent(t2.deps, t2.longTtl); // 失败，touchFetchedAt
    t2.advance(600 * 1000); // 失败后 600s（< 900s 窗口）
    const r = await fetchSourceContent(t2.deps, t2.longTtl);
    expect(r.status).toBe("stale-cache");
    expect(t2.calls()).toBe(1); // 只有第一次失败的尝试，没有第二次
  });

  it("回源失败且无缓存 → fetch-failed（源降级跳过）", async () => {
    const t = setup({ upstreamStatus: 500 });
    const r = await fetchSourceContent(t.deps, t.longTtl);
    expect(r.status).toBe("fetch-failed");
    if (r.status === "fetch-failed") expect(r.error).toContain("500");
    // 失败也推进节流时间戳
    expect(t.kvStore.get("fc:src:1:fetched")).toBe(String(t.deps.now()));
  });

  it("内容无法解析 → 视为失败（保留旧缓存）", async () => {
    const t = setup();
    await fetchSourceContent(t.deps, t.longTtl);
    t.advance(1800 * 1000 + 1);
    const t2 = setup({ upstreamBody: "<html>error page</html>" });
    for (const [k, v] of t.kvStore) t2.kvStore.set(k, v);
    t2.advance(1800 * 1000 + 1);
    const r = await fetchSourceContent(t2.deps, t2.longTtl);
    expect(r.status).toBe("fetch-failed-stale");
    expect(t2.statuses[0]![0]).toBe("error");
  });
});

describe("probeSource 探测", () => {
  it("返回格式与节点数", async () => {
    const t = setup();
    const r = await probeSource(t.deps, t.longTtl);
    expect(r).toMatchObject({ ok: true, format: "base64", nodeCount: 2 });
  });

  it("MIN_FETCH_INTERVAL 内连续探测不产生第二次回源", async () => {
    const t = setup();
    const r1 = await probeSource(t.deps, t.shortTtl);
    expect(r1.origin).toBe("fetched");
    t.advance(300 * 1000 + 1); // 过 TTL(300s) 但在节流窗(900s)内
    const r2 = await probeSource(t.deps, t.shortTtl);
    expect(r2.origin).toBe("stale-cache");
    expect(t.calls()).toBe(1);
  });

  it("上游故障且无缓存 → ok:false 带原因", async () => {
    const t = setup({ upstreamStatus: 403 });
    const r = await probeSource(t.deps, t.longTtl);
    expect(r.ok).toBe(false);
    expect(r.error).toContain("403");
  });
});

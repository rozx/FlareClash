import { describe, expect, it } from "vitest";
import {
  clearSourceCache,
  readSourceCache,
  sourceDataAtKey,
  sourceDataKey,
  sourceFetchedKey,
  writeSourceCache,
  type KVLike,
} from "../../src/cache/kv";

/** 内存 mock KV */
function mockKV(): KVLike & { store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    store,
    async get(key) {
      return store.get(key) ?? null;
    },
    async put(key, value) {
      store.set(key, value);
    },
    async delete(key) {
      store.delete(key);
    },
  };
}

describe("KV 缓存封装", () => {
  it("键格式：fc:src:<id>:data / :fetched", () => {
    expect(sourceDataKey(42)).toBe("fc:src:42:data");
    expect(sourceFetchedKey(42)).toBe("fc:src:42:fetched");
  });

  it("写入后可读回", async () => {
    const kv = mockKV();
    await writeSourceCache(kv, 1, "content", 1000);
    expect(await readSourceCache(kv, 1)).toEqual({
      data: "content",
      metadata: null,
      dataAt: 1000,
      fetchedAt: 1000,
    });
    expect(kv.store.size).toBe(3);
  });

  it("dataAt 或 fetched 缺失视为无缓存", async () => {
    const kv = mockKV();
    await kv.put(sourceDataKey(1), "content");
    await kv.put(sourceFetchedKey(1), "1000");
    expect(await readSourceCache(kv, 1)).toBeNull();
    await kv.put(sourceDataAtKey(1), "1000");
    expect(await readSourceCache(kv, 1)).toEqual({
      data: "content",
      metadata: null,
      dataAt: 1000,
      fetchedAt: 1000,
    });
  });

  it("envelope 同步读写元数据并保持三个 key", async () => {
    const kv = mockKV();
    const metadata = {
      userInfo: { upload: 1, download: 2, total: 100, expire: 2000 },
      profileUpdateInterval: 24,
    };
    await writeSourceCache(kv, 1, "content", 1000, metadata);
    expect(await readSourceCache(kv, 1)).toEqual({
      data: "content",
      metadata,
      dataAt: 1000,
      fetchedAt: 1000,
    });
    expect(kv.store.size).toBe(3);
    expect(kv.store.get(sourceDataKey(1))).toMatch(/^fc-cache:v1:/);
  });

  it("兼容旧纯文本 data 值", async () => {
    const kv = mockKV();
    await kv.put(sourceDataKey(1), "legacy-content");
    await kv.put(sourceDataAtKey(1), "1000");
    await kv.put(sourceFetchedKey(1), "1000");
    expect(await readSourceCache(kv, 1)).toEqual({
      data: "legacy-content",
      metadata: null,
      dataAt: 1000,
      fetchedAt: 1000,
    });
  });

  it("清除删除三个键", async () => {
    const kv = mockKV();
    await writeSourceCache(kv, 1, "content", 1000);
    await clearSourceCache(kv, 1);
    expect(await readSourceCache(kv, 1)).toBeNull();
  });
});

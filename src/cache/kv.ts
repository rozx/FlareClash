import {
  isSubscriptionMetadata,
  type SubscriptionMetadata,
} from "../lib/subscription-meta";

/**
 * 按源的上游内容缓存封装（design.md D2/D3）。
 * 键约定：
 *   fc:src:<id>:data     带版本前缀的正文 + 订阅元数据 envelope
 *   fc:src:<id>:dataAt   内容写入时间（epoch ms）—— 新鲜度判定
 *   fc:src:<id>:fetched  上次回源尝试时间（epoch ms）—— 节流判定
 *
 * 分离两个时间戳的原因：失败的尝试只推进 fetched（防连环重试），
 * 绝不能让旧数据被误判为「新鲜」。
 */

/** KV 最小接口（KVNamespace 结构性满足，便于测试注入 mock） */
export interface KVLike {
 get(key: string): Promise<string | null>;
 put(key: string, value: string): Promise<void>;
 delete(key: string): Promise<void>;
}

export function sourceDataKey(id: number): string {
 return `fc:src:${id}:data`;
}

export function sourceDataAtKey(id: number): string {
 return `fc:src:${id}:dataAt`;
}

export function sourceFetchedKey(id: number): string {
 return `fc:src:${id}:fetched`;
}

export interface SourceCache {
  data: string;
  metadata: SubscriptionMetadata | null;
  /** 内容写入时间（epoch ms） */
  dataAt: number;
  /** 上次回源尝试时间（epoch ms） */
  fetchedAt: number;
}

const DATA_ENVELOPE_PREFIX = "fc-cache:v1:";

function encodeCachedData(
  data: string,
  metadata: SubscriptionMetadata | null,
): string {
  return `${DATA_ENVELOPE_PREFIX}${JSON.stringify({ data, metadata })}`;
}

function decodeCachedData(
  raw: string,
): Pick<SourceCache, "data" | "metadata"> | null {
  // 向后兼容部署前已经写入 KV 的纯文本正文。
  if (!raw.startsWith(DATA_ENVELOPE_PREFIX)) {
    return { data: raw, metadata: null };
  }
  try {
    const value: unknown = JSON.parse(raw.slice(DATA_ENVELOPE_PREFIX.length));
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return null;
    }
    const envelope = value as Record<string, unknown>;
    if (typeof envelope.data !== "string") return null;
    const metadata =
      envelope.metadata === null || envelope.metadata === undefined
        ? null
        : isSubscriptionMetadata(envelope.metadata)
          ? envelope.metadata
          : null;
    return { data: envelope.data, metadata };
  } catch {
    return null;
  }
}

/** 读取源缓存；三键任一缺失或非法视为无缓存。 */
export async function readSourceCache(
 kv: KVLike,
 id: number,
): Promise<SourceCache | null> {
 const [data, dataAt, fetchedAt] = await Promise.all([
  kv.get(sourceDataKey(id)),
  kv.get(sourceDataAtKey(id)),
  kv.get(sourceFetchedKey(id)),
 ]);
  if (data === null || dataAt === null || fetchedAt === null) return null;
  const decoded = decodeCachedData(data);
  if (!decoded) return null;
  const t1 = Number(dataAt);
  const t2 = Number(fetchedAt);
  if (!Number.isFinite(t1) || !Number.isFinite(t2)) return null;
  return { ...decoded, dataAt: t1, fetchedAt: t2 };
}

/** 回源成功：正文+元数据 envelope 与两个时间戳，共 3 次 KV 写。 */
export async function writeSourceCache(
  kv: KVLike,
  id: number,
  data: string,
  now = Date.now(),
  metadata: SubscriptionMetadata | null = null,
): Promise<void> {
  await Promise.all([
    kv.put(sourceDataKey(id), encodeCachedData(data, metadata)),
    kv.put(sourceDataAtKey(id), String(now)),
    kv.put(sourceFetchedKey(id), String(now)),
  ]);
}

/** 仅推进回源尝试时间戳（失败的尝试也走节流，防止连续打爆上游）。 */
export async function touchFetchedAt(
 kv: KVLike,
 id: number,
 now = Date.now(),
): Promise<void> {
 await kv.put(sourceFetchedKey(id), String(now));
}

/** 清除源缓存（源删除/改 URL 时）。 */
export async function clearSourceCache(kv: KVLike, id: number): Promise<void> {
 await Promise.all([
  kv.delete(sourceDataKey(id)),
  kv.delete(sourceDataAtKey(id)),
  kv.delete(sourceFetchedKey(id)),
 ]);
}

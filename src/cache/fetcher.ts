import { detectFormat } from "../lib/detect";
import {
  parseSubscriptionMetadata,
  type SubscriptionMetadata,
} from "../lib/subscription-meta";
import {
  type KVLike,
  readSourceCache,
  touchFetchedAt,
  writeSourceCache,
} from "./kv";

/** 回源所需的源字段（D1 sources 行的子集） */
export interface FetchSource {
  id: number;
  url: string;
  /** 缓存有效期（秒） */
  cacheTtl: number;
}

export interface FetcherDeps {
  kv: KVLike;
  fetchFn: typeof fetch;
  now: () => number;
  /** 回源尝试结果回调（更新 D1 last_fetch_*，调用方经 waitUntil 执行） */
  onStatus: (status: "ok" | "error", detail?: string) => Promise<void>;
  /** 最短回源间隔（秒，节流阀） */
  minFetchIntervalSec: number;
  /** 回源超时（毫秒） */
  fetchTimeoutMs: number;
  /** 回源 User-Agent */
  userAgent: string;
}

export type FetchOutcome =
  /** 缓存新鲜（未过 TTL） */
  | {
      status: "cache";
      content: string;
      metadata: SubscriptionMetadata | null;
      ageMs: number;
    }
  /** 缓存过期但节流命中：返回旧内容，不回源 */
  | {
      status: "stale-cache";
      content: string;
      metadata: SubscriptionMetadata | null;
      ageMs: number;
    }
  /** 回源成功并已写入缓存 */
  | {
      status: "fetched";
      content: string;
      metadata: SubscriptionMetadata | null;
    }
  /** 回源失败但旧缓存可用（降级返回旧内容） */
  | {
      status: "fetch-failed-stale";
      content: string;
      metadata: SubscriptionMetadata | null;
    }
  /** 回源失败且无任何缓存（调用方应跳过该源） */
  | { status: "fetch-failed"; error: string };

/** 从上游拉取并校验内容；HTTP 非 2xx、超时、内容无法解析均视为失败。 */
async function fetchUpstream(
  deps: FetcherDeps,
  source: FetchSource,
): Promise<
  { content: string; metadata: SubscriptionMetadata | null } | { error: string }
> {
  let resp: Response;
  try {
    resp = await deps.fetchFn(source.url, {
      headers: { "User-Agent": deps.userAgent },
      redirect: "follow",
      signal: AbortSignal.timeout(deps.fetchTimeoutMs),
    });
  } catch (e) {
    return { error: `回源请求失败: ${(e as Error).message}` };
  }
  if (!resp.ok) {
    return { error: `上游返回 ${resp.status}` };
  }
  const content = await resp.text();
  const detect = detectFormat(content);
  if ("error" in detect) {
    return { error: `内容无法解析: ${detect.error}` };
  }
  return { content, metadata: parseSubscriptionMetadata(resp.headers) };
}

/**
 * 源内容获取决策（design.md D3 管道）：
 * 新鲜缓存 → 直接用；过期但 < 最短回源间隔 → 节流返回旧内容；
 * 否则回源：成功写缓存，失败保留旧缓存（无旧缓存则报错）。
 * 失败的尝试同样推进 fetched 时间戳（防止对故障上游连环重试）。
 */
export async function fetchSourceContent(
  deps: FetcherDeps,
  source: FetchSource,
): Promise<FetchOutcome> {
  const now = deps.now();
  const cached = await readSourceCache(deps.kv, source.id);

  if (cached) {
    const ageMs = now - cached.dataAt;
    if (ageMs < source.cacheTtl * 1000) {
      return {
        status: "cache",
        content: cached.data,
        metadata: cached.metadata,
        ageMs,
      };
    }
    if (now - cached.fetchedAt < deps.minFetchIntervalSec * 1000) {
      return {
        status: "stale-cache",
        content: cached.data,
        metadata: cached.metadata,
        ageMs,
      };
    }
  }

  const result = await fetchUpstream(deps, source);
  if ("content" in result) {
    await writeSourceCache(
      deps.kv,
      source.id,
      result.content,
      deps.now(),
      result.metadata,
    );
    await deps.onStatus("ok");
    return {
      status: "fetched",
      content: result.content,
      metadata: result.metadata,
    };
  }

  // 失败：推进节流时间戳 + 记录状态；旧缓存继续兜底
  await touchFetchedAt(deps.kv, source.id, deps.now());
  await deps.onStatus("error", result.error);
  if (cached) {
    return {
      status: "fetch-failed-stale",
      content: cached.data,
      metadata: cached.metadata,
    };
  }
  return { status: "fetch-failed", error: result.error };
}

export interface ProbeResult {
  ok: boolean;
  /** 探测出的格式 */
  format?: "clash" | "base64";
  /** 解析出的节点数 */
  nodeCount?: number;
  /** 失败/降级原因 */
  error?: string;
  /** 内容实际来源（调试用） */
  origin?: "cache" | "stale-cache" | "fetched" | "fetch-failed-stale";
}

/**
 * 管理端「立即探测」：复用 fetchSourceContent 的同一节流阀
 * （规格 admin-management：MIN_FETCH_INTERVAL 内连续探测不产生第二次回源），
 * 在获取内容基础上额外解析格式与节点数。
 */
export async function probeSource(
  deps: FetcherDeps,
  source: FetchSource,
): Promise<ProbeResult> {
  const outcome = await fetchSourceContent(deps, source);
  switch (outcome.status) {
    case "cache":
    case "stale-cache":
    case "fetched":
    case "fetch-failed-stale": {
      const detect = detectFormat(outcome.content);
      if ("error" in detect) {
        return { ok: false, error: detect.error, origin: outcome.status };
      }
      return {
        ok: true,
        format: detect.format,
        nodeCount: detect.proxies.length,
        origin: outcome.status,
      };
    }
    case "fetch-failed":
      return { ok: false, error: outcome.error };
  }
}

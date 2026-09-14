import { Hono, type Context } from "hono";
import { fetchSourceContent, type FetcherDeps } from "../cache/fetcher";
import { aggregateWithSources } from "../lib/aggregate";
import { buildClashConfig } from "../lib/clash-render";
import { renderBase64Sub } from "../lib/base64-render";
import { detectFormat } from "../lib/detect";
import {
  aggregateSubscriptionMetadata,
  renderSubscriptionMetadataHeaders,
} from "../lib/subscription-meta";
import { numVar, type Env } from "../env";
import {
  getSourcesForToken,
  getRoutingConfig,
  touchTokenUsed,
  updateSourceFetchStatus,
} from "../repo";

const sub = new Hono<{ Bindings: Env }>();

function buildFetcherDeps(
  env: Env,
  sourceId: number,
  waitUntil: (p: Promise<unknown>) => void,
): FetcherDeps {
  return {
    kv: env.KV,
    fetchFn: fetch.bind(globalThis), // workerd 原生 fetch 不可解构调用（Illegal invocation）
    now: () => Date.now(),
    minFetchIntervalSec: numVar(env.MIN_FETCH_INTERVAL, 900),
    fetchTimeoutMs: numVar(env.FETCH_TIMEOUT_MS, 10_000),
    userAgent: env.FETCH_USER_AGENT || "clash-verge/v1.7.7",
    onStatus: async (status, detail) => {
      // 非阻塞：状态写库不拖慢订阅响应
      waitUntil(updateSourceFetchStatus(env.DB, sourceId, status, detail));
    },
  };
}

/** 输出格式：显式 ?format= 参数优先，其次 User-Agent（clash/mihomo/stash 系）。 */
function decideFormat(
  queryFormat: string | undefined,
  userAgent: string,
): "clash" | "base64" {
  const q = (queryFormat ?? "").toLowerCase();
  if (q === "clash" || q === "yaml") return "clash";
  if (q === "base64" || q === "b64" || q === "links") return "base64";
  // Hiddify UA 含 "like ClashMeta"，但其下载层会 trim 每一行并破坏
  // Clash YAML 缩进；必须先于 Clash 识别，改发单行 base64。
  if (/hiddify/i.test(userAgent)) return "base64";
  return /clash|mihomo|stash/i.test(userAgent) ? "clash" : "base64";
}

type Format = "clash" | "base64";

type SubContext = Context<{ Bindings: Env }>;

/** 订阅核心管道：校验 → 并行取源 → 聚合 → 按格式输出。 */
async function serveSubscription(
  c: SubContext,
  token: string,
  forced: Format | undefined,
): Promise<Response> {
  const data = await getSourcesForToken(c.env.DB, token);
  if (!data) {
    return c.json({ error: "invalid token" }, 401);
  }
  const { token: t, sources } = data;
  if (t.enabled !== 1) {
    return c.json({ error: "token disabled" }, 403);
  }
  if (t.expires_at !== null && t.expires_at < Date.now()) {
    return c.json({ error: "token expired" }, 403);
  }
  if (sources.length === 0) {
    return c.json({ error: "该 token 未绑定任何源订阅，请联系管理员" }, 400);
  }

  const waitUntil = (p: Promise<unknown>) => c.executionCtx.waitUntil(p);

  // 各源并行：取缓存或回源，失败源降级跳过（规格：源获取失败降级）
  // static 源内容存 D1，直接解析：不回源、不读写 KV，不受节流阀约束。
  const perSource = await Promise.all(
    sources.map(async (src) => {
      if (src.kind === "static") {
        const detect = detectFormat(src.content ?? "");
        if ("error" in detect) return null;
        return {
          id: src.id,
          name: src.name,
          prefix: src.prefix,
          proxies: detect.proxies,
          metadata: null, // 自建节点无上游用量元数据
        };
      }
      const deps = buildFetcherDeps(c.env, src.id, waitUntil);
      const outcome = await fetchSourceContent(deps, {
        id: src.id,
        url: src.url,
        cacheTtl: src.cache_ttl,
      });
      if (!("content" in outcome)) return null;
      const detect = detectFormat(outcome.content);
      if ("error" in detect) return null;
      return {
        id: src.id,
        name: src.name,
        prefix: src.prefix,
        proxies: detect.proxies,
        metadata: outcome.metadata,
      };
    }),
  );
  const okSources = perSource.filter(
    (s): s is NonNullable<typeof s> => s !== null,
  );

  if (okSources.length === 0) {
    return c.json({ error: "所有源订阅均不可用，请稍后再试" }, 502);
  }

  const { proxies, members } = aggregateWithSources(okSources);
  const metadataHeaders = renderSubscriptionMetadataHeaders(
    aggregateSubscriptionMetadata(okSources.map((s) => s.metadata)),
  );

  // 记录最后使用时间（不阻塞响应）
  waitUntil(touchTokenUsed(c.env.DB, t.id));

  const format: Format =
    forced ??
    decideFormat(c.req.query("format"), c.req.header("User-Agent") ?? "");
  if (format === "clash") {
    try {
      const { config } = await getRoutingConfig(c.env.DB);
      return c.body(buildClashConfig(proxies, config, members), 200, {
        "Content-Type": "text/yaml; charset=utf-8",
        "Cache-Control": "no-store",
        ...metadataHeaders,
      });
    } catch (e) {
      return c.json({ error: (e as Error).message }, 502);
    }
  }

  const rendered = renderBase64Sub(proxies);
  if (rendered.links === 0) {
    return c.json({ error: "聚合结果中无可转换为分享链接的节点" }, 502);
  }
  return c.body(rendered.content, 200, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store",
    ...metadataHeaders,
  });
}

/** GET /sub/clash/:token — 显式 Clash YAML（路径即格式，不同客户端分发不同链接） */
sub.get("/clash/:token", (c) =>
  serveSubscription(c, c.req.param("token"), "clash"),
);

/** GET /sub/base64/:token — 显式 base64 分享链接列表 */
sub.get("/base64/:token", (c) =>
  serveSubscription(c, c.req.param("token"), "base64"),
);

/** GET /sub/:token — UA 自适应（?format= 可覆盖），规格 subscription-serving */
sub.get("/:token", (c) =>
  serveSubscription(c, c.req.param("token"), undefined),
);

export default sub;

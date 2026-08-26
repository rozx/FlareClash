import { vi } from "vitest";

/**
 * vpw 0.22 移除了 cloudflare:test 的 fetchMock。
 * 集成测试与 app 同 isolate（直接 import app.request），
 * stub globalThis.fetch 即可拦截回源；app 侧 fetch.bind(globalThis)
 * 在每个请求内求值，能看到 stub。
 *
 * API 形状刻意模仿旧 fetchMock（get/intercept/reply），
 * 以最小化既有测试的改动。
 */
export interface UpstreamMock {
  get(origin: string): {
    intercept(o: { path: string }): {
      reply(status: number, body?: string): void;
    };
  };
  /** 实际发生的上游请求 URL 列表 */
  calls: string[];
  /** 兼容旧 API：按需匹配，无 pending 概念 */
  assertNoPendingInterceptors(): void;
}

export function installUpstreamMock(): UpstreamMock {
  const routes = new Map<string, { status: number; body: string }>();
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    async (input: RequestInfo | URL): Promise<Response> => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      calls.push(url);
      const r = routes.get(url);
      if (r) return new Response(r.body, { status: r.status });
      throw new Error(`unmocked fetch: ${url}`);
    },
  );
  return {
    get(origin) {
      return {
        intercept({ path }) {
          return {
            reply(status, body = "") {
              routes.set(origin + path, { status, body });
            },
          };
        },
      };
    },
    calls,
    assertNoPendingInterceptors() {},
  };
}

import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig({
  test: {
    // 全部测试统一跑在 workers 池（workerd）：单元测试为纯逻辑可直接运行，
    // 集成测试获得真实 D1/KV 绑定（miniflare）。
    // isolatedStorage 默认开启：每个测试文件获得独立存储。
    include: ["tests/unit/**/*.test.ts", "tests/integration/**/*.test.ts"],
    poolOptions: {
      workers: {
        // isolatedStorage 默认开启：每个测试获得独立 D1/KV 存储
        miniflare: {
          compatibilityDate: "2025-06-01",
          d1Databases: { DB: "flareclash-test" },
          kvNamespaces: { KV: "kv-test" },
          bindings: {
            ADMIN_PASSWORD: "test-admin-pass",
            AUTH_SECRET: "test-auth-secret",
            CACHE_TTL_DEFAULT: "1800",
            MIN_FETCH_INTERVAL: "900",
            FETCH_TIMEOUT_MS: "10000",
            FETCH_USER_AGENT: "clash-verge/v1.7.7",
          },
        },
      },
    },
  },
});

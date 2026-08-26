import { cloudflareTest } from "@cloudflare/vitest-pool-workers";

// vitest 4 + vpw 0.22：cloudflareTest() 作为 Vite 插件
// （取代 v3 的 defineWorkersConfig + poolOptions.workers；
//   isolatedStorage 选项已移除——per-test 隔离现为默认行为）
export default {
  plugins: [
    cloudflareTest({
      // 全部测试统一跑在 workerd 池：单元测试为纯逻辑可直接运行，
      // 集成测试获得真实 D1/KV 绑定（miniflare）。
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
    }),
  ],
  test: {
    include: ["tests/unit/**/*.test.ts", "tests/integration/**/*.test.ts"],
  },
} as const;

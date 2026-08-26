/// <reference types="@cloudflare/vitest-pool-workers" />
import type { Env } from "../src/env";

// 让 `import { env } from "cloudflare:test"` 携带项目自定义绑定类型
declare module "cloudflare:test" {
  interface ProvidedEnv extends Env {}
}

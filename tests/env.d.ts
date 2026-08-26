// vpw 0.22：类型经由 exports 子路径 "./types" 引入（bundler 解析走 exports map）
import type {} from "@cloudflare/vitest-pool-workers/types";
import type { Env as ProjectEnv } from "../src/env";

// vpw 0.22：env 类型改为全局 Cloudflare.Env 增强点（ProvidedEnv 已移除）
declare global {
  namespace Cloudflare {
    interface Env extends ProjectEnv {}
  }
}

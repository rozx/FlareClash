/** Worker 绑定与环境变量（见 wrangler.toml） */
export interface Env {
  DB: D1Database;
  KV: KVNamespace;
  ADMIN_PASSWORD: string;
  /** 会话签名密钥；缺省时由 ADMIN_PASSWORD 派生（design.md D5） */
  AUTH_SECRET?: string;
  /** 默认缓存有效期（秒），默认 1800 */
  CACHE_TTL_DEFAULT?: string;
  /** 最短回源间隔（秒，节流阀），默认 900 */
  MIN_FETCH_INTERVAL?: string;
  /** 回源超时（毫秒），默认 10000 */
  FETCH_TIMEOUT_MS?: string;
  /** 回源 User-Agent */
  FETCH_USER_AGENT?: string;
}

export function numVar(v: string | undefined, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

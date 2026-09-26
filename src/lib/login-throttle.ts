/**
 * 登录防爆破策略（纯函数）：客户端标识归一化、锁定时长、配置强度提示。
 * 计数的 D1 读写在 repo.ts，流程编排在 routes/api.ts（design: admin-login-hardening）。
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

export interface ThrottlePolicy {
  /** 窗口内允许进入密码比对的最大尝试数 */
  maxAttempts: number;
  windowMs: number;
  /** 首次锁定时长；此后逐次翻倍 */
  baseLockMs: number;
  maxLockMs: number;
}

/** 单 IP：15 分钟 5 次 → 锁 15 分钟起，逐次翻倍，上限 24 小时 */
export const IP_POLICY: ThrottlePolicy = {
  maxAttempts: 5,
  windowMs: 15 * MINUTE,
  baseLockMs: 15 * MINUTE,
  maxLockMs: 24 * HOUR,
};

/** 全局：1 小时 50 次 → 暂停密码登录 1 小时（不翻倍） */
export const GLOBAL_POLICY: ThrottlePolicy = {
  maxAttempts: 50,
  windowMs: HOUR,
  baseLockMs: HOUR,
  maxLockMs: HOUR,
};

export const GLOBAL_KEY = "global";

/** 空闲超过该时长后翻倍级数清零、陈旧行可清理 */
export const LOCKOUT_DECAY_MS = 24 * HOUR;

export const MIN_PASSWORD_LENGTH = 16;

/** 客户端计数键：IPv4 原样，IPv6 归并到 /64，缺失或畸形归为 unknown */
export function clientKey(ip: string | null | undefined): string {
  const raw = (ip ?? "").trim().toLowerCase();
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(raw);
  const v4 = mapped ? mapped[1]! : raw;
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(v4)) return `ip:${v4}`;
  const groups = expandIpv6(raw);
  return groups ? `ip:${groups.slice(0, 4).join(":")}::/64` : "ip:unknown";
}

/** 展开 `::` 压缩，返回 8 组去前导零的十六进制；非法返回 null */
function expandIpv6(s: string): string[] | null {
  if (!s.includes(":") || !/^[0-9a-f:]+$/.test(s)) return null;
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const fill = 8 - head.length - tail.length;
  if (halves.length === 2 ? fill < 1 : fill !== 0) return null;
  const all = [...head, ...Array<string>(Math.max(fill, 0)).fill("0"), ...tail];
  if (all.some((g) => g.length < 1 || g.length > 4)) return null;
  return all.map((g) => parseInt(g, 16).toString(16));
}

/** 第 lockouts+1 次锁定的时长：base × 2^lockouts，封顶 maxLockMs */
export function lockDurationMs(
  lockouts: number,
  policy: ThrottlePolicy,
): number {
  return Math.min(
    policy.baseLockMs * 2 ** Math.min(Math.max(lockouts, 0), 20),
    policy.maxLockMs,
  );
}

/** Retry-After 秒数：向上取整，至少 1 */
export function retryAfterSeconds(lockedUntil: number, now: number): number {
  return Math.max(1, Math.ceil((lockedUntil - now) / 1000));
}

/** 弱配置提示（仅提示，不阻断登录） */
export function configWarnings(env: {
  ADMIN_PASSWORD?: string;
  AUTH_SECRET?: string;
}): string[] {
  const warnings: string[] = [];
  if ((env.ADMIN_PASSWORD ?? "").length < MIN_PASSWORD_LENGTH)
    warnings.push(
      `ADMIN_PASSWORD 少于 ${MIN_PASSWORD_LENGTH} 个字符，建议改用更长的随机密码`,
    );
  if (!env.AUTH_SECRET)
    warnings.push("未设置 AUTH_SECRET，会话签名密钥由密码派生，建议单独设置");
  return warnings;
}

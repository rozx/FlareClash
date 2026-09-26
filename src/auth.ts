/**
 * 管理会话：HMAC-SHA256 签名 cookie（design.md D5）。
 * 格式：<exp epoch ms>.<base64url(HMAC)>
 * 无状态、零存储；密钥取 AUTH_SECRET，缺省由 ADMIN_PASSWORD 派生（不推荐）。
 */

export const SESSION_COOKIE = "fc_session";
/** 会话有效期：7 天 */
export const SESSION_TTL_MS = 7 * 24 * 3600 * 1000;

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** 从 ADMIN_PASSWORD 派生回退密钥（AUTH_SECRET 缺省时）。 */
async function deriveKey(
  authSecret: string | undefined,
  adminPassword: string,
): Promise<CryptoKey> {
  const material = new TextEncoder().encode(
    authSecret ?? `fallback:${adminPassword}`,
  );
  const raw = await crypto.subtle.digest("SHA-256", material);
  return crypto.subtle.importKey(
    "raw",
    raw,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

/** 签发会话 token：`exp.hmac` */
export async function signSession(opts: {
  authSecret?: string;
  adminPassword: string;
  now?: number;
}): Promise<string> {
  const now = opts.now ?? Date.now();
  const exp = now + SESSION_TTL_MS;
  const key = await deriveKey(opts.authSecret, opts.adminPassword);
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(String(exp)),
  );
  return `${exp}.${b64url(new Uint8Array(sig))}`;
}

/** 校验会话 token：签名正确且未过期。 */
export async function verifySession(
  token: string | undefined,
  opts: { authSecret?: string; adminPassword: string; now?: number },
): Promise<boolean> {
  if (!token) return false;
  const dot = token.indexOf(".");
  if (dot <= 0) return false;
  const exp = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  if (!/^\d+$/.test(exp)) return false;
  const now = opts.now ?? Date.now();
  if (Number(exp) < now) return false;

  let sigBytes: Uint8Array;
  try {
    sigBytes = new Uint8Array(
      atob(sig.replace(/-/g, "+").replace(/_/g, "/"))
        .split("")
        .map((c) => c.charCodeAt(0)),
    );
  } catch {
    return false; // 畸形 base64：视为未认证而非抛 500
  }
  const key = await deriveKey(opts.authSecret, opts.adminPassword);
  return crypto.subtle.verify(
    "HMAC",
    key,
    sigBytes,
    new TextEncoder().encode(exp),
  );
}

/** 常量时间比较密码：两侧先取 SHA-256 摘要，长度恒等后 timingSafeEqual。 */
export async function passwordMatches(
  input: string,
  expected: string,
): Promise<boolean> {
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(input)),
    crypto.subtle.digest("SHA-256", enc.encode(expected)),
  ]);
  return crypto.subtle.timingSafeEqual(a, b);
}

/** 登录失败固定延迟（防时序侧信道与爆破节奏，design.md D5）。 */
export async function loginDelay(): Promise<void> {
  await new Promise((r) => setTimeout(r, 300));
}

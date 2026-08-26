/**
 * UTF-8 安全的 base64 / base64url 工具。
 * atob/btoa 按 latin1 处理，中文名等必须经 TextEncoder/TextDecoder 转换。
 */

function bytesToBinaryString(bytes: Uint8Array): string {
  let s = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    s += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return s;
}

/** 标准与 url-safe base64 均可，自动补 padding；失败返回 null。 */
export function b64Decode(input: string): string | null {
  try {
    const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
    const bin = atob(padded);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

/** 标准 base64 编码（UTF-8 安全）。 */
export function b64Encode(text: string): string {
  return btoa(bytesToBinaryString(new TextEncoder().encode(text)));
}

/** base64url 编码（用于 ss 的 SIP002 userinfo）。 */
export function b64UrlEncode(text: string): string {
  return b64Encode(text)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

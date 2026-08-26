import { b64Encode } from "./b64";
import { toShareLink } from "./link-parse";
import { REVERSIBLE_TYPES, type Proxy } from "./types";

export interface Base64RenderResult {
  content: string;
  /** 成功转换的链接数 */
  links: number;
  /** 不可逆类型被跳过的节点数 */
  skipped: number;
}

/**
 * Proxy[] → 逐行分享链接 → 整体 base64（规格 subscription-serving
 * 「按客户端自适应输出」）。不可逆类型（socks5/http 等原生 Clash 节点）
 * 跳过并计数。
 */
export function renderBase64Sub(proxies: Proxy[]): Base64RenderResult {
  const lines: string[] = [];
  let skipped = 0;
  for (const p of proxies) {
    if (!REVERSIBLE_TYPES.has(p.type)) {
      skipped++;
      continue;
    }
    const link = toShareLink(p);
    if (link === null) {
      skipped++;
      continue;
    }
    lines.push(link);
  }
  return { content: b64Encode(lines.join("\n")), links: lines.length, skipped };
}

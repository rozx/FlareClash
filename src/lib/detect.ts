import { parseClash } from "./clash-parse";
import { parseBase64Sub } from "./link-parse";
import type { Proxy } from "./types";

export type DetectResult =
 | { format: "clash" | "base64"; proxies: Proxy[]; skipped: number }
 | { error: string };

/**
 * 上游格式探测：Clash YAML → base64/明文链接集合 → 失败。
 * 判定顺序：先试 Clash（要求 YAML 对象且含合法 proxies 数组），
 * 再试分享链接集合（要求至少解析出 1 个节点）。
 */
export function detectFormat(content: string): DetectResult {
 const trimmed = content.trim();
 if (!trimmed) return { error: "内容为空" };

 const clash = parseClash(trimmed);
 if (!("error" in clash)) {
  return { format: "clash", proxies: clash.proxies, skipped: clash.skipped };
 }

 const links = parseBase64Sub(trimmed);
 if (links.proxies.length > 0) {
  return { format: "base64", proxies: links.proxies, skipped: links.skipped };
 }

 return {
  error: `既非 Clash YAML 也非分享链接集合（Clash 判定: ${"error" in clash ? clash.error : "?"}；未解析出任何链接）`,
 };
}

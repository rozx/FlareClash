import { parse as parseYaml } from "yaml";
import { isProxy, type Proxy } from "./types";

interface ClashParseOk {
  proxies: Proxy[];
  /** 源内因字段缺失/非法被跳过的条目数 */
  skipped: number;
}
export type ClashParseResult = ClashParseOk | { error: string };

/**
 * 解析 Clash YAML 订阅。
 * 容错策略（design.md D4）：非法节点仅自身跳过，不影响整源；
 * proxies 数组缺失、YAML 语法错误、或无任何合法节点时报错。
 */
export function parseClash(content: string): ClashParseResult {
  let doc: unknown;
  try {
    doc = parseYaml(content);
  } catch (e) {
    return { error: `YAML 语法错误: ${(e as Error).message}` };
  }
  if (typeof doc !== "object" || doc === null) {
    return { error: "YAML 根节点不是对象" };
  }
  const proxiesField = (doc as Record<string, unknown>).proxies;
  if (!Array.isArray(proxiesField)) {
    return { error: "缺少 proxies 数组" };
  }
  const proxies: Proxy[] = [];
  let skipped = 0;
  for (const item of proxiesField) {
    if (isProxy(item)) proxies.push(item);
    else skipped++;
  }
  if (proxies.length === 0) {
    return { error: "proxies 数组中无合法节点" };
  }
  return { proxies, skipped };
}

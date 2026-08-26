/**
 * 统一节点表示：Clash proxy 字段的超集（design.md D4）。
 *
 * 核心字段强类型；各协议特有字段（uuid/password/cipher/sni/ws-opts…）
 * 通过索引签名保留为宽类型，解析→聚合→输出全程透传。
 */
export interface Proxy {
 name: string;
 type: string;
 server: string;
 port: number;
 [key: string]: unknown;
}

/**
 * 类型守卫：判定一个未知对象是否为可用节点。
 * 规则（design.md D4「解析容错」）：name/type/server 非空字符串，
 * port 为 1–65535 整数。其余字段不参与判定。
 */
export function isProxy(v: unknown): v is Proxy {
 if (typeof v !== "object" || v === null) return false;
 const p = v as Record<string, unknown>;
 if (typeof p.name !== "string" || p.name.length === 0) return false;
 if (typeof p.type !== "string" || p.type.length === 0) return false;
 if (typeof p.server !== "string" || p.server.length === 0) return false;
 return (
  typeof p.port === "number" &&
  Number.isInteger(p.port) &&
  p.port > 0 &&
  p.port <= 65535
 );
}

/** base64 输出端可逆向为分享链接的协议（其余类型跳过并计数） */
export const REVERSIBLE_TYPES: ReadonlySet<string> = new Set([
 "ss",
 "vmess",
 "trojan",
 "hysteria2",
]);

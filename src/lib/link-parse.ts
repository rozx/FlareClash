/**
 * 分享链接解析（vmess/ss/trojan/hysteria2/vless → Proxy）
 * 与逆向转换（Proxy → 分享链接）。
 *
 * 容错策略（design.md D4）：单条链接解析失败返回 null（调用方计数跳过），
 * 不抛异常；字段缺失仅影响该节点本身。
 */
import { b64Decode, b64Encode, b64UrlEncode } from "./b64";
import type { Proxy } from "./types";

export const SUPPORTED_SCHEMES = [
  "vmess",
  "ss",
  "trojan",
  "hysteria2",
  "hy2",
  "vless",
] as const;

function safeDecodeURIComponent(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** host:port 解析（支持 IPv6 [::1]:443）；port 在合法范围才返回。 */
function parseHostPort(s: string): { host: string; port: number } | null {
  const m = s.match(/^\[(.+)\]:(\d+)$/) ?? s.match(/^(.+):(\d+)$/);
  if (!m) return null;
  const port = Number(m[2]);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) return null;
  return { host: m[1]!, port };
}

function wsOpts(path?: string, host?: string): Proxy["ws-opts"] {
  return {
    path: path || "/",
    ...(host ? { headers: { Host: host } } : {}),
  };
}

// ── vmess ────────────────────────────────────────────────────────

interface VmessJson {
  v?: string | number;
  ps?: string;
  add?: string;
  port?: string | number;
  id?: string;
  aid?: string | number;
  scy?: string;
  net?: string;
  type?: string;
  host?: string;
  path?: string;
  tls?: string;
  sni?: string;
  alpn?: string;
  fp?: string;
}

function parseVmess(body: string): Proxy | null {
  const json = b64Decode(body);
  if (json === null) return null;
  let o: VmessJson;
  try {
    const parsed: unknown = JSON.parse(json);
    if (typeof parsed !== "object" || parsed === null) return null;
    o = parsed as VmessJson;
  } catch {
    return null;
  }
  const port = Number(o.port);
  if (!o.add || !o.id || !Number.isInteger(port) || port <= 0) return null;

  const net = o.net && o.net !== "tcp" ? o.net : undefined;
  const proxy: Proxy = {
    name: o.ps || o.add,
    type: "vmess",
    server: o.add,
    port,
    uuid: o.id,
    alterId: Number(o.aid ?? 0) || 0,
    cipher: o.scy || "auto",
    ...(net ? { network: net } : {}),
    ...(o.tls === "tls" ? { tls: true } : {}),
    ...(o.sni ? { servername: o.sni } : {}),
    ...(o.fp ? { "client-fingerprint": o.fp } : {}),
    ...(o.alpn ? { alpn: o.alpn } : {}),
  };
  if (net === "ws") proxy["ws-opts"] = wsOpts(o.path, o.host);
  if (net === "grpc")
    proxy["grpc-opts"] = { "grpc-service-name": o.path || "" };
  if (net === "h2")
    proxy["h2-opts"] = { host: [o.host || o.add], path: o.path || "/" };
  return proxy;
}

function toVmessLink(p: Proxy): string {
  const network = typeof p.network === "string" ? p.network : "tcp";
  const ws = p["ws-opts"] as
    | { path?: string; headers?: { Host?: string } }
    | undefined;
  const grpc = p["grpc-opts"] as { "grpc-service-name"?: string } | undefined;
  const h2 = p["h2-opts"] as { host?: string[]; path?: string } | undefined;
  const fp = p["client-fingerprint"];
  const alpn = p.alpn;
  const o: VmessJson = {
    v: "2",
    ps: p.name,
    add: p.server,
    port: String(p.port),
    id: String(p.uuid ?? ""),
    aid: String(typeof p.alterId === "number" ? p.alterId : 0),
    scy: typeof p.cipher === "string" ? p.cipher : "auto",
    net: network,
    type: "none",
    host:
      ws?.headers?.Host ??
      (Array.isArray(h2?.host) ? h2.host[0] : undefined) ??
      "",
    path: ws?.path ?? grpc?.["grpc-service-name"] ?? h2?.path ?? "/",
    tls: p.tls === true ? "tls" : "",
    sni: typeof p.servername === "string" ? p.servername : "",
    ...(alpn ? { alpn: String(alpn) } : {}),
    ...(typeof fp === "string" ? { fp } : {}),
  };
  return `vmess://${b64Encode(JSON.stringify(o))}`;
}

// ── ss（SIP002 + legacy）─────────────────────────────────────────

function parseSs(link: string): Proxy | null {
  const body = link.slice("ss://".length);
  const hashIdx = body.indexOf("#");
  const name =
    hashIdx >= 0 ? safeDecodeURIComponent(body.slice(hashIdx + 1)) : "";
  const main0 = hashIdx >= 0 ? body.slice(0, hashIdx) : body;
  const qIdx = main0.indexOf("?");
  const main = qIdx >= 0 ? main0.slice(0, qIdx) : main0;
  const query = qIdx >= 0 ? main0.slice(qIdx + 1) : "";

  let method: string, password: string, hp: { host: string; port: number };
  if (main.includes("@")) {
    const at = main.lastIndexOf("@");
    const userinfo = main.slice(0, at);
    const hostport = main.slice(at + 1);
    const decoded = b64Decode(userinfo);
    const cred =
      decoded !== null && decoded.includes(":")
        ? decoded
        : safeDecodeURIComponent(userinfo);
    const c = cred.indexOf(":");
    if (c < 0) return null;
    method = cred.slice(0, c);
    password = cred.slice(c + 1);
    const parsed = parseHostPort(hostport);
    if (!parsed) return null;
    hp = parsed;
  } else {
    // legacy：整体 base64(method:pass@host:port)
    const decoded = b64Decode(main);
    if (decoded === null) return null;
    const at = decoded.lastIndexOf("@");
    if (at < 0) return null;
    const cred = decoded.slice(0, at);
    const c = cred.indexOf(":");
    if (c < 0) return null;
    method = cred.slice(0, c);
    password = cred.slice(c + 1);
    const parsed = parseHostPort(decoded.slice(at + 1));
    if (!parsed) return null;
    hp = parsed;
  }

  // plugin 透传（SIP002 query）
  let plugin: string | undefined;
  if (query) {
    for (const kv of query.split("&")) {
      const eq = kv.indexOf("=");
      if (eq > 0 && kv.slice(0, eq) === "plugin") {
        plugin = safeDecodeURIComponent(kv.slice(eq + 1));
      }
    }
  }

  return {
    name: name || `${hp.host}:${hp.port}`,
    type: "ss",
    server: hp.host,
    port: hp.port,
    cipher: method,
    password,
    ...(plugin ? { plugin } : {}),
  };
}

function toSsLink(p: Proxy): string {
  const userinfo = b64UrlEncode(`${p.cipher}:${p.password}`);
  const plugin = typeof p.plugin === "string" ? p.plugin : undefined;
  const base = `ss://${userinfo}@${p.server}:${p.port}`;
  const q = plugin ? `?plugin=${encodeURIComponent(plugin)}` : "";
  return `${base}${q}#${encodeURIComponent(p.name)}`;
}

// ── trojan ───────────────────────────────────────────────────────

function parseTrojan(link: string): Proxy | null {
  let u: URL;
  try {
    u = new URL(link);
  } catch {
    return null;
  }
  const port = Number(u.port);
  if (!Number.isInteger(port) || port <= 0) return null;
  const password = safeDecodeURIComponent(
    u.password ? `${u.username}:${u.password}` : u.username,
  );
  if (!password) return null;

  const q = (k: string) => u.searchParams.get(k) ?? undefined;
  const sni = q("sni") ?? q("peer");
  const network = q("type") ?? q("network");
  const path = q("path");
  const host = q("host");
  const insecure =
    q("allowInsecure") === "1" ||
    q("insecure") === "1" ||
    q("allowInsecure") === "true";

  const proxy: Proxy = {
    name: safeDecodeURIComponent(u.hash ? u.hash.slice(1) : "") || u.hostname,
    type: "trojan",
    server: u.hostname.replace(/^\[|\]$/g, ""),
    port,
    password,
    ...(sni ? { sni } : {}),
    ...(insecure ? { "skip-cert-verify": true } : {}),
  };
  if (network === "ws") proxy["ws-opts"] = wsOpts(path, host);
  if (network === "grpc")
    proxy["grpc-opts"] = { "grpc-service-name": path || "" };
  return proxy;
}

function toTrojanLink(p: Proxy): string {
  const params = new URLSearchParams();
  if (typeof p.sni === "string") params.set("sni", p.sni);
  const ws = p["ws-opts"] as
    | { path?: string; headers?: { Host?: string } }
    | undefined;
  const grpc = p["grpc-opts"] as { "grpc-service-name"?: string } | undefined;
  if (ws) {
    params.set("type", "ws");
    if (ws.path) params.set("path", ws.path);
    if (ws.headers?.Host) params.set("host", ws.headers.Host);
  } else if (grpc) {
    params.set("type", "grpc");
    if (grpc["grpc-service-name"])
      params.set("path", grpc["grpc-service-name"]);
  }
  if (p["skip-cert-verify"] === true) params.set("allowInsecure", "1");
  const q = params.toString();
  return `trojan://${encodeURIComponent(String(p.password))}@${p.server}:${p.port}${q ? `?${q}` : ""}#${encodeURIComponent(p.name)}`;
}

// ── hysteria2 ────────────────────────────────────────────────────

function parseHysteria2(link: string): Proxy | null {
  let u: URL;
  try {
    u = new URL(link);
  } catch {
    return null;
  }
  const port = Number(u.port);
  if (!Number.isInteger(port) || port <= 0) return null;
  const password = safeDecodeURIComponent(
    u.password ? `${u.username}:${u.password}` : u.username,
  );
  if (!password) return null;

  const q = (k: string) => u.searchParams.get(k) ?? undefined;
  const sni = q("sni");
  const insecure = q("insecure") === "1" || q("insecure") === "true";
  const obfs = q("obfs");
  const obfsPassword = q("obfs-password");

  return {
    name: safeDecodeURIComponent(u.hash ? u.hash.slice(1) : "") || u.hostname,
    type: "hysteria2",
    server: u.hostname.replace(/^\[|\]$/g, ""),
    port,
    password,
    ...(sni ? { sni } : {}),
    ...(insecure ? { "skip-cert-verify": true } : {}),
    ...(obfs ? { obfs } : {}),
    ...(obfsPassword ? { "obfs-password": obfsPassword } : {}),
  };
}

function toHysteria2Link(p: Proxy): string {
  const params = new URLSearchParams();
  if (typeof p.sni === "string") params.set("sni", p.sni);
  if (p["skip-cert-verify"] === true) params.set("insecure", "1");
  if (typeof p.obfs === "string") params.set("obfs", p.obfs);
  if (typeof p["obfs-password"] === "string")
    params.set("obfs-password", p["obfs-password"]);
  const q = params.toString();
  return `hysteria2://${encodeURIComponent(String(p.password))}@${p.server}:${p.port}${q ? `?${q}` : ""}#${encodeURIComponent(p.name)}`;
}

// ── vless ────────────────────────────────────────────────────────

interface VlessOpts {
  "reality-opts"?: {
    "public-key"?: string;
    "short-id"?: string;
    "support-x25519mlkem768"?: boolean;
  };
}

function parseVless(link: string): Proxy | null {
  let u: URL;
  try {
    u = new URL(link);
  } catch {
    return null;
  }
  const port = Number(u.port);
  if (!Number.isInteger(port) || port <= 0) return null;
  const uuid = safeDecodeURIComponent(u.username);
  if (!uuid || !u.hostname || u.password) return null;

  const q = (k: string) => u.searchParams.get(k) ?? undefined;
  const security = q("security") ?? "none"; // none | tls | reality
  const sni = q("sni") ?? q("peer");
  const fp = q("fp");
  const pbk = q("pbk");
  const sid = q("sid");
  const flow = q("flow");
  const rawNetwork = q("type") ?? q("network") ?? "tcp";
  const network = rawNetwork === "raw" ? "tcp" : rawNetwork;
  if (
    !["none", "tls", "reality"].includes(security) ||
    !["tcp", "ws", "grpc"].includes(network) ||
    (q("encryption") ?? "none") !== "none" ||
    (security === "reality" && !pbk)
  )
    return null;
  const path = q("path");
  const host = q("host");
  const serviceName = q("serviceName");
  const alpn = q("alpn")
    ?.split(",")
    .map((v) => v.trim())
    .filter(Boolean);
  const insecure =
    q("allowInsecure") === "1" ||
    q("insecure") === "1" ||
    q("insecure") === "true" ||
    q("allowInsecure") === "true";

  const proxy: Proxy = {
    name: safeDecodeURIComponent(u.hash ? u.hash.slice(1) : "") || u.hostname,
    type: "vless",
    server: u.hostname.replace(/^\[|\]$/g, ""),
    port,
    uuid,
    ...(flow ? { flow } : {}),
    ...(network && network !== "tcp" ? { network } : {}),
    ...(security === "tls" || security === "reality" ? { tls: true } : {}),
    ...(sni ? { servername: sni } : {}),
    ...(fp ? { "client-fingerprint": fp } : {}),
    ...(alpn?.length ? { alpn } : {}),
    ...(insecure ? { "skip-cert-verify": true } : {}),
  };
  if (security === "reality") {
    // Xray 26.9.8+ 要求混合密钥交换；Mihomo 需显式启用。
    const reality: VlessOpts["reality-opts"] = {
      "support-x25519mlkem768": true,
    };
    if (pbk) reality["public-key"] = pbk;
    if (sid) reality["short-id"] = sid;
    proxy["reality-opts"] = reality;
  }
  if (network === "ws") proxy["ws-opts"] = wsOpts(path, host);
  if (network === "grpc")
    proxy["grpc-opts"] = { "grpc-service-name": serviceName || "" };
  return proxy;
}

function toVlessLink(p: Proxy): string | null {
  if (typeof p.uuid !== "string" || !p.uuid) return null;
  if (p.encryption !== undefined && p.encryption !== "none") return null;
  const params = new URLSearchParams();
  params.set("encryption", "none");
  if (typeof p.flow === "string") params.set("flow", p.flow);
  const reality = p["reality-opts"] as VlessOpts["reality-opts"] | undefined;
  if (reality) {
    if (typeof reality["public-key"] !== "string" || !reality["public-key"])
      return null;
    params.set("security", "reality");
    if (reality["public-key"]) params.set("pbk", reality["public-key"]);
    if (reality["short-id"]) params.set("sid", reality["short-id"]);
  } else if (p.tls === true) {
    params.set("security", "tls");
  }
  if (typeof p.servername === "string") params.set("sni", p.servername);
  const fp = p["client-fingerprint"];
  if (typeof fp === "string") params.set("fp", fp);
  const rawNetwork =
    typeof p.network === "string"
      ? p.network
      : p["ws-opts"]
        ? "ws"
        : p["grpc-opts"]
          ? "grpc"
          : "tcp";
  const network = rawNetwork === "raw" ? "tcp" : rawNetwork;
  if (!["tcp", "ws", "grpc"].includes(network)) return null;
  if (Array.isArray(p.alpn)) params.set("alpn", p.alpn.join(","));
  else if (typeof p.alpn === "string") params.set("alpn", p.alpn);
  if (network !== "tcp") params.set("type", network);
  const ws = p["ws-opts"] as
    | { path?: string; headers?: { Host?: string } }
    | undefined;
  const grpc = p["grpc-opts"] as { "grpc-service-name"?: string } | undefined;
  if (ws) {
    if (ws.path) params.set("path", ws.path);
    if (ws.headers?.Host) params.set("host", ws.headers.Host);
  } else if (grpc) {
    if (grpc["grpc-service-name"])
      params.set("serviceName", grpc["grpc-service-name"]);
  }
  if (p["skip-cert-verify"] === true) params.set("allowInsecure", "1");
  const q = params.toString();
  const host =
    p.server.includes(":") && !p.server.startsWith("[")
      ? `[${p.server}]`
      : p.server;
  return `vless://${encodeURIComponent(p.uuid)}@${host}:${p.port}${q ? `?${q}` : ""}#${encodeURIComponent(p.name)}`;
}

// ── 入口 ─────────────────────────────────────────────────────────

/** 单条分享链接 → Proxy；无法解析返回 null。 */
export function parseShareLink(link: string): Proxy | null {
  const idx = link.indexOf("://");
  if (idx < 0) return null;
  const scheme = link.slice(0, idx).toLowerCase();
  const body = link.slice(idx + 3);
  switch (scheme) {
    case "vmess":
      return parseVmess(body);
    case "ss":
      return parseSs(link);
    case "trojan":
      return parseTrojan(link);
    case "hysteria2":
    case "hy2":
      return parseHysteria2(link);
    case "vless":
      return parseVless(link);
    default:
      return null;
  }
}

/** Proxy → 分享链接；不可逆类型（见 REVERSIBLE_TYPES）返回 null。 */
export function toShareLink(p: Proxy): string | null {
  switch (p.type) {
    case "vmess":
      return toVmessLink(p);
    case "ss":
      return toSsLink(p);
    case "trojan":
      return toTrojanLink(p);
    case "hysteria2":
      return toHysteria2Link(p);
    case "vless":
      return toVlessLink(p);
    default:
      return null;
  }
}

/**
 * 解析 base64 订阅内容（或逐行明文链接集合）。
 * 返回解析出的节点与无法解析的行数。
 */
export function parseBase64Sub(content: string): {
  proxies: Proxy[];
  skipped: number;
} {
  const trimmed = content.trim();
  // 先尝试整体 base64 解码；解码结果含 "://" 才认为是 base64 包装
  const decoded = b64Decode(trimmed);
  const text = decoded !== null && decoded.includes("://") ? decoded : trimmed;

  const proxies: Proxy[] = [];
  let skipped = 0;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const p = parseShareLink(line);
    if (p) proxies.push(p);
    else skipped++;
  }
  return { proxies, skipped };
}

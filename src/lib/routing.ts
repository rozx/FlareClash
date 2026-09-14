import defaults from "../../config/routing.default.json";

export const RULE_TYPES = [
  "DOMAIN",
  "DOMAIN-SUFFIX",
  "DOMAIN-KEYWORD",
  "IP-CIDR",
  "IP-CIDR6",
  "GEOIP",
] as const;
export type RuleType = (typeof RULE_TYPES)[number];
export interface RoutingRule {
  type: RuleType;
  value: string;
  target: string;
}
export interface RoutingGroup {
  id: string;
  name: string;
  sourceIds: number[];
  mode: "select" | "url-test";
}
export interface RoutingConfig {
  version: 1;
  groups: RoutingGroup[];
  rules: RoutingRule[];
  final: string;
}
export const MAX_ROUTING_BYTES = 64 * 1024;
const BUILTINS = ["DIRECT", "REJECT", "PROXY"];

/** 只接受已知字段，避免导入配置时悄悄丢弃用户意图。 */
function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("配置必须是 JSON 对象");
  if (Object.keys(value).some((k) => !keys.includes(k)))
    throw new Error("配置包含未知字段");
  return value as Record<string, unknown>;
}
function text(value: unknown, label: string, max = 253): string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > max ||
    /[\x00-\x1f\x7f,]/.test(value)
  )
    throw new Error(`${label} 无效`);
  return value.trim();
}
export function normalizeDomain(value: unknown): string {
  const input = text(value, "域名").replace(/\.$/, "");
  if (/[\s/:@?#\\%*]/.test(input))
    throw new Error("请输入域名，不含协议、路径或通配符");
  let domain: string;
  try {
    domain = new URL(`http://${input}`).hostname.toLowerCase();
  } catch {
    throw new Error("域名格式无效");
  }
  if (
    /^[\d.]+$/.test(domain) ||
    domain.length > 253 ||
    domain
      .split(".")
      .some((x) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(x))
  )
    throw new Error("域名格式无效");
  return domain;
}
function cidr(value: string, ipv6: boolean): string {
  const parts = value.split("/");
  if (parts.length !== 2 || !/^\d+$/.test(parts[1]!))
    throw new Error("CIDR 必须包含合法掩码");
  const ip = parts[0]!,
    mask = Number(parts[1]);
  if (mask > (ipv6 ? 128 : 32)) throw new Error("CIDR 掩码超出范围");
  if (ipv6) {
    if (!ip.includes(":") || /[[\]%\s]/.test(ip))
      throw new Error("IPv6 CIDR 无效");
    try {
      return `${new URL(`http://[${ip}]`).hostname.slice(1, -1)}/${mask}`;
    } catch {
      throw new Error("IPv6 CIDR 无效");
    }
  }
  const octets = ip.split(".");
  if (
    octets.length !== 4 ||
    octets.some((x) => !/^(0|[1-9]\d{0,2})$/.test(x) || Number(x) > 255)
  )
    throw new Error("IPv4 CIDR 无效");
  return `${ip}/${mask}`;
}

/** 校验并规范化整个文档；返回新对象，不修改默认值或调用方数据。 */
export function parseRoutingConfig(input: unknown): RoutingConfig {
  if (
    new TextEncoder().encode(JSON.stringify(input) ?? "").length >
    MAX_ROUTING_BYTES
  )
    throw new Error("分流配置不能超过 64 KiB");
  const doc = object(input, ["version", "groups", "rules", "final"]);
  if (doc.version !== 1) throw new Error("仅支持 version: 1");
  if (!Array.isArray(doc.groups) || doc.groups.length > 32)
    throw new Error("策略组必须是数组，最多 32 个");
  if (!Array.isArray(doc.rules) || doc.rules.length > 256)
    throw new Error("规则必须是数组，最多 256 条");
  const ids = new Set<string>();
  const groups = doc.groups.map((v) => {
    const g = object(v, ["id", "name", "sourceIds", "mode"]);
    const id = text(g.id, "组 ID", 48);
    if (!/^g_[a-zA-Z0-9_-]+$/.test(id) || ids.has(id))
      throw new Error("组 ID 需以 g_ 开头且唯一");
    ids.add(id);
    const name = text(g.name, "组名称", 64);
    if (g.mode !== "select" && g.mode !== "url-test")
      throw new Error("策略组模式无效");
    if (
      !Array.isArray(g.sourceIds) ||
      !g.sourceIds.length ||
      g.sourceIds.length > 128 ||
      g.sourceIds.some((id) => !Number.isSafeInteger(id) || id <= 0) ||
      new Set(g.sourceIds).size !== g.sourceIds.length
    )
      throw new Error("每个组需选择有效且不重复的源 ID");
    return {
      id,
      name,
      sourceIds: [...g.sourceIds] as number[],
      mode: g.mode,
    } as RoutingGroup;
  });
  const target = (v: unknown): string => {
    if (typeof v !== "string" || !(BUILTINS.includes(v) || ids.has(v)))
      throw new Error("规则目标不存在");
    return v;
  };
  const rules = doc.rules.map((v, i) => {
    try {
      const r = object(v, ["type", "value", "target"]);
      if (!RULE_TYPES.includes(r.type as RuleType))
        throw new Error("不支持的规则类型");
      const type = r.type as RuleType;
      let value = text(r.value, "规则内容");
      if (type === "DOMAIN" || type === "DOMAIN-SUFFIX")
        value = normalizeDomain(value);
      else if (type === "DOMAIN-KEYWORD") {
        if (!/^[a-zA-Z0-9._-]+$/.test(value))
          throw new Error("域名关键词只支持字母、数字、点、横线和下划线");
        value = value.toLowerCase();
      } else if (type === "GEOIP") {
        if (!/^[a-zA-Z]{2}$/.test(value))
          throw new Error("GEOIP 使用两位国家代码");
        value = value.toUpperCase();
      } else value = cidr(value, type === "IP-CIDR6");
      return { type, value, target: target(r.target) };
    } catch (e) {
      throw new Error(`第 ${i + 1} 条规则：${(e as Error).message}`);
    }
  });
  return { version: 1, groups, rules, final: target(doc.final) };
}
export function defaultRoutingConfig(): RoutingConfig {
  return parseRoutingConfig(defaults);
}
export function groupTag(group: RoutingGroup): string {
  return `📂 ${group.name} (${group.id})`;
}
export function clashTarget(config: RoutingConfig, target: string): string {
  if (target === "PROXY") return "🚀 节点选择";
  const group = config.groups.find((g) => g.id === target);
  return group ? groupTag(group) : target;
}
export function clashRules(config: RoutingConfig): string[] {
  return [
    ...config.rules.map(
      (r) =>
        `${r.type},${r.value},${clashTarget(config, r.target)}${r.type.startsWith("IP-CIDR") ? ",no-resolve" : ""}`,
    ),
    `MATCH,${clashTarget(config, config.final)}`,
  ];
}
export function previewDomain(config: RoutingConfig, input: unknown) {
  const domain = normalizeDomain(input);
  let uncertain = false;
  for (const [index, r] of config.rules.entries()) {
    if (!r.type.startsWith("DOMAIN")) {
      uncertain = true;
      continue;
    }
    const match =
      r.type === "DOMAIN"
        ? domain === r.value
        : r.type === "DOMAIN-SUFFIX"
          ? domain === r.value || domain.endsWith(`.${r.value}`)
          : domain.includes(r.value);
    if (match)
      return {
        domain,
        index,
        target: r.target,
        uncertain,
        note: "仅预览域名规则；不执行 DNS/IP/GEOIP 匹配",
      };
  }
  return {
    domain,
    index: null,
    target: config.final,
    uncertain,
    note: "未命中域名规则；不执行 DNS/IP/GEOIP 匹配，实际结果可能不同",
  };
}

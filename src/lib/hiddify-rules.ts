import type { RoutingConfig } from "./routing";

/** Hiddify 4.1.1 的 Dart protobuf writeToJson 格式；不是 sing-box JSON。
 * 字段编号和枚举来源：hiddify-app v4.1.1 的 route_rule.pb.dart/pbenum.dart。
 * 原生 Rule 不包含独立 GEOIP 字段；rule_set 是外部引用，不能冒充已配置的 GEOIP。
 */
const OUTBOUND: Record<string, number> = { PROXY: 0, DIRECT: 1, REJECT: 3 };
const FIELDS: Record<string, string> = {
 DOMAIN: "15",
 "DOMAIN-SUFFIX": "16",
 "DOMAIN-KEYWORD": "17",
 "IP-CIDR": "13",
 "IP-CIDR6": "13",
};
export function hiddifyIssues(config: RoutingConfig): string[] {
 const errors: string[] = [];
 for (const [i, rule] of config.rules.entries()) {
  if (!(rule.target in OUTBOUND))
   errors.push(`第 ${i + 1} 条规则引用 Clash 专属策略组`);
  if (!(rule.type in FIELDS))
   errors.push(
    `第 ${i + 1} 条规则的 ${rule.type} 不能直接导入 Hiddify 原生规则；请明确调整配置，不会自动忽略`,
   );
 }
 if (!(config.final in OUTBOUND)) errors.push("兜底引用 Clash 专属策略组");
 return errors;
}
export function buildHiddifyRules(config: RoutingConfig) {
 const errors = hiddifyIssues(config);
 if (errors.length) throw new Error(errors.join("；"));
 const rules = config.rules.map((r, i) => ({
  "1": i,
  "2": true,
  "3": `${r.type} ${r.value}`,
  "4": OUTBOUND[r.target]!,
  [FIELDS[r.type]!]: [r.value],
 }));
 // 用完整目的端口范围表达 TCP/UDP 兜底，避免空条件被客户端当作无效规则。
 rules.push({
  "1": rules.length,
  "2": true,
  "3": "FlareClash 兜底",
  "4": OUTBOUND[config.final]!,
  "10": ["0:65535"],
 });
 return { "1": rules };
}

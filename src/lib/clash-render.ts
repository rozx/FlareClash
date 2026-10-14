import { stringify as stringifyYaml } from "yaml";
import { REGIONS, type RegionKey } from "./regions";
import type { Proxy } from "./types";
import {
  clashRules,
  defaultRoutingConfig,
  groupTag,
  ruleProviders,
  type RoutingConfig,
} from "./routing";

const AUTO_GROUP = "♻️ 自动选择";
const OTHER_GROUP = "🌐 其余节点";
const SELECT_GROUP = "🚀 节点选择";

const TEST_URL = "http://www.gstatic.com/generate_204";

interface ProxyGroup {
  name: string;
  type: string;
  proxies: string[];
  url?: string;
  interval?: number;
  tolerance?: number;
}

/**
 * 渲染完整 Clash 配置：proxies + 默认策略组（自动选择 / 地区分组 /
 * 其余节点 / 节点选择）+ 默认规则集（规格 subscription-serving
 * 「按客户端自适应输出」）。
 *
 * sourceRegions：源 id → 管理员指定的地区。指定地区的源，其节点只进该地区组，
 * 不再按节点名匹配（规格「源级地区归属」）；归属取自 sourceMembers 的真实去重记录。
 */
export function buildClashConfig(
  proxies: Proxy[],
  config: RoutingConfig = defaultRoutingConfig(),
  sourceMembers: Map<number, string[]> = new Map(),
  sourceRegions: Map<number, RegionKey> = new Map(),
): string {
  const names = proxies.map((p) => p.name);

  const groups: ProxyGroup[] = [];
  if (names.length > 0) {
    groups.push({
      name: AUTO_GROUP,
      type: "url-test",
      proxies: [...names],
      url: TEST_URL,
      interval: 300,
      tolerance: 50,
    });
  }

  const assigned = new Map<string, RegionKey>();
  for (const [id, key] of sourceRegions)
    for (const m of sourceMembers.get(id) ?? []) assigned.set(m, key);

  const matched = new Set<string>();
  const regionGroupNames: string[] = [];
  const regionKeys = new Set<string>();
  for (const region of REGIONS) {
    const members = names.filter((n) => {
      const key = assigned.get(n);
      return key ? key === region.key : region.re.test(n);
    });
    if (members.length === 0) continue;
    for (const m of members) matched.add(m);
    regionGroupNames.push(region.name);
    regionKeys.add(region.key);
    groups.push({
      name: region.name,
      type: "url-test",
      proxies: members,
      url: TEST_URL,
      interval: 300,
    });
  }

  const others = names.filter((n) => !matched.has(n));
  const otherGroupNames = others.length > 0 ? [OTHER_GROUP] : [];
  if (others.length > 0) {
    groups.push({
      name: OTHER_GROUP,
      type: "url-test",
      proxies: others,
      url: TEST_URL,
      interval: 300,
    });
  }

  const referenced = new Set([
    config.final,
    ...config.rules.map((r) => r.target),
  ]);
  const sourceGroupNames: string[] = [];
  for (const group of config.groups) {
    const members = [
      ...new Set(group.sourceIds.flatMap((id) => sourceMembers.get(id) ?? [])),
    ];
    if (!members.length) {
      if (referenced.has(group.id))
        throw new Error(
          "规则引用的策略组无可用节点，请管理员检查 token 绑定、源状态或重名去重",
        );
      continue;
    }
    const name = groupTag(group);
    sourceGroupNames.push(name);
    groups.push({
      name,
      type: group.mode,
      proxies: members,
      ...(group.mode === "url-test" ? { url: TEST_URL, interval: 300 } : {}),
    });
  }
  groups.push({
    name: SELECT_GROUP,
    type: "select",
    proxies: [
      ...(names.length > 0 ? [AUTO_GROUP] : []),
      ...regionGroupNames,
      ...otherGroupNames,
      ...sourceGroupNames,
      "DIRECT",
    ],
  });

  const rules = clashRules(config, regionKeys);
  const providers = ruleProviders(config);

  return stringifyYaml(
    {
      proxies,
      "proxy-groups": groups,
      ...(Object.keys(providers).length ? { "rule-providers": providers } : {}),
      rules,
    },
    { lineWidth: 0 },
  );
}

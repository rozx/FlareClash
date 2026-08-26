import { stringify as stringifyYaml } from "yaml";
import type { Proxy } from "./types";

/** 地区分组：按节点名正则匹配（design.md：HK/TW/JP/SG/US/EU 起步） */
const REGION_GROUPS: { name: string; re: RegExp }[] = [
  { name: "🇭🇰 香港", re: /(香港|🇭🇰|\bHK\b|Hong ?Kong)/i },
  { name: "🇹🇼 台湾", re: /(台湾|臺灣|🇹🇼|\bTW\b|Taiwan)/i },
  { name: "🇯🇵 日本", re: /(日本|🇯🇵|\bJP\b|Japan)/i },
  { name: "🇸🇬 新加坡", re: /(新加坡|狮城|🇸🇬|\bSG\b|Singapore)/i },
  { name: "🇺🇸 美国", re: /(美国|🇺🇸|\bUS\b|United States|America)/i },
  {
    name: "🇪🇺 欧洲",
    re: /(英国|德国|法国|荷兰|欧洲|🇬🇧|🇩🇪|🇫🇷|🇳🇱|\bEU\b|Europe|UK|United Kingdom|Germany|France)/i,
  },
];

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
 */
export function buildClashConfig(proxies: Proxy[]): string {
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

  const matched = new Set<string>();
  const regionGroupNames: string[] = [];
  for (const region of REGION_GROUPS) {
    const members = names.filter((n) => region.re.test(n));
    if (members.length === 0) continue;
    for (const m of members) matched.add(m);
    regionGroupNames.push(region.name);
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

  groups.push({
    name: SELECT_GROUP,
    type: "select",
    proxies: [
      ...(names.length > 0 ? [AUTO_GROUP] : []),
      ...regionGroupNames,
      ...otherGroupNames,
      "DIRECT",
    ],
  });

  const rules = [
    "DOMAIN-SUFFIX,local,DIRECT",
    "IP-CIDR,127.0.0.0/8,DIRECT,no-resolve",
    "IP-CIDR,10.0.0.0/8,DIRECT,no-resolve",
    "IP-CIDR,172.16.0.0/12,DIRECT,no-resolve",
    "IP-CIDR,192.168.0.0/16,DIRECT,no-resolve",
    "GEOIP,CN,DIRECT",
    `MATCH,${SELECT_GROUP}`,
  ];

  return stringifyYaml(
    { proxies, "proxy-groups": groups, rules },
    { lineWidth: 0 },
  );
}

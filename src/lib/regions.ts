/**
 * 地区定义（design.md：HK/TW/JP/SG/US/EU 起步）。
 * key 存入 D1 `sources.region`；name 是 Clash 组名；re 用于按节点名自动匹配。
 * 管理页 public/admin/format.js 维护 key/name 副本，单测保证一致。
 */
export const REGIONS = [
  { key: "hk", name: "🇭🇰 香港", re: /(香港|🇭🇰|\bHK\b|Hong ?Kong)/i },
  { key: "tw", name: "🇹🇼 台湾", re: /(台湾|臺灣|🇹🇼|\bTW\b|Taiwan)/i },
  { key: "jp", name: "🇯🇵 日本", re: /(日本|🇯🇵|\bJP\b|Japan)/i },
  {
    key: "sg",
    name: "🇸🇬 新加坡",
    re: /(新加坡|狮城|🇸🇬|\bSG\b|Singapore)/i,
  },
  {
    key: "us",
    name: "🇺🇸 美国",
    re: /(美国|🇺🇸|\bUS\b|United States|America)/i,
  },
  {
    key: "eu",
    name: "🇪🇺 欧洲",
    re: /(英国|德国|法国|荷兰|欧洲|🇬🇧|🇩🇪|🇫🇷|🇳🇱|\bEU\b|Europe|UK|United Kingdom|Germany|France)/i,
  },
] as const;

export type RegionKey = (typeof REGIONS)[number]["key"];

export function isRegionKey(v: unknown): v is RegionKey {
  return REGIONS.some((r) => r.key === v);
}

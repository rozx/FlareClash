/**
 * 远程规则集目录（Loyalsoldier/clash-rules，release 分支每日更新，YAML payload）。
 * 只开放内置目录、不接受自定义 URL：订阅里的 URL 会被每个朋友的客户端拉取，需可审查。
 * Worker 不下载规则集内容，只在 Clash 输出中声明 rule-providers。
 */
export interface RuleSet {
  id: string;
  name: string;
  description: string;
  behavior: "domain" | "ipcidr" | "classical";
  url: string;
  /** 管理页添加时的默认去向 */
  suggested: "PROXY" | "DIRECT" | "REJECT";
}

const BASE = "https://cdn.jsdelivr.net/gh/Loyalsoldier/clash-rules@release";
const set = (
  id: string,
  name: string,
  description: string,
  behavior: RuleSet["behavior"],
  suggested: RuleSet["suggested"],
): RuleSet => ({ id, name, description, behavior, url: `${BASE}/${id}.txt`, suggested });

/** 顺序即推荐的插入顺序（拦截与私有网络在前，IP 段在后）。 */
export const RULESETS: readonly RuleSet[] = [
  set("reject", "广告与追踪", "常见广告、追踪与恶意域名（约 5 MB，客户端首次下载稍慢）", "domain", "REJECT"),
  set("private", "私有网络", "路由器后台、局域网服务等本地域名", "domain", "DIRECT"),
  set("applications", "需直连的软件", "下载工具、内网穿透等应直连的进程（需客户端支持进程规则）", "classical", "DIRECT"),
  set("icloud", "iCloud", "iCloud 相关域名", "domain", "DIRECT"),
  set("apple", "Apple 国内服务", "Apple 在中国大陆可直连的域名", "domain", "DIRECT"),
  set("proxy", "需代理的网站", "在中国大陆访问受限的常见境外网站", "domain", "PROXY"),
  set("gfw", "GFWList", "GFWList 列表中的域名", "domain", "PROXY"),
  set("direct", "国内网站", "中国大陆常见网站与 CDN", "domain", "DIRECT"),
  set("tld-not-cn", "境外顶级域", "非中国大陆使用的顶级域名（如 .gov、.edu）", "domain", "PROXY"),
  set("telegramcidr", "Telegram IP 段", "Telegram 服务器 IP 段", "ipcidr", "PROXY"),
  set("lancidr", "局域网 IP 段", "私有与保留 IP 段", "ipcidr", "DIRECT"),
  set("cncidr", "中国大陆 IP 段", "中国大陆 IP 段（需要先解析域名）", "ipcidr", "DIRECT"),
];

export function findRuleSet(id: string): RuleSet | undefined {
  return RULESETS.find((r) => r.id === id);
}
